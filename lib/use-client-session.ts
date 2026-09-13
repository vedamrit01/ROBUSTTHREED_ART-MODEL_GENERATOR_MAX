import { useCallback, useEffect, useRef, useState } from 'react';
import { authClient } from './auth-client';
import { ACCESS_LEASE_MS, ACCESS_REFRESH_MS, AUTH_REQUEST_TIMEOUT_MS, readAccess, type ClientAccess } from './client-access';

export function useClientSession() {
  const [identity, setIdentity] = useState<{ id: string; email: string } | null>(null);
  const [access, setAccess] = useState<ClientAccess | null>(null);
  const [checking, setChecking] = useState(!!authClient);
  const [error, setError] = useState('');
  const [recovery, setRecovery] = useState(false);
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!authClient) return;
    const client = authClient;
    let active = true;
    let userId: string | null = null;
    let generation = 0;
    let request: AbortController | null = null;
    let leaseTimer: ReturnType<typeof setTimeout> | undefined;
    let deadline = 0;

    function deny(message: string) {
      deadline = 0;
      clearTimeout(leaseTimer);
      setAccess(null);
      setError(message);
    }

    async function refresh() {
      if (!active || !userId || request) return;
      const expected = userId;
      const version = generation;
      const controller = new AbortController();
      request = controller;
      const timeout = setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);
      try {
        // The API verifies the JWT, and the SQL function checks the live Auth
        // session and current approval. Local session metadata grants no access.
        const result = await client.rpc('studio_access').abortSignal(controller.signal);
        if (!active || version !== generation) return;
        if (result.error) throw result.error;
        const next = readAccess(result.data, expected);
        setAccess(next);
        setError('');
        deadline = Date.now() + ACCESS_LEASE_MS;
        clearTimeout(leaseTimer);
        leaseTimer = setTimeout(() => {
          if (active) deny('Your access check expired. Reconnect and check access again.');
        }, ACCESS_LEASE_MS);
      } catch {
        if (active && version === generation) {
          deny('We could not verify your access. Check your connection, then retry or sign in again.');
        }
      } finally {
        clearTimeout(timeout);
        if (request === controller) request = null;
        if (active && version === generation) setChecking(false);
      }
    }

    refreshRef.current = () => { void refresh(); };
    const initialTimeout = setTimeout(() => {
      if (active) { setChecking(false); if (!userId) setError('Sign-in could not finish. Please try again.'); }
    }, AUTH_REQUEST_TIMEOUT_MS);

    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      clearTimeout(initialTimeout);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      const nextId = session?.user.id ?? null;
      if (nextId !== userId) {
        generation++;
        request?.abort();
        request = null;
        clearTimeout(leaseTimer);
        deadline = 0;
        setAccess(null);
        setError('');
      }
      userId = nextId;
      setIdentity(session ? { id: session.user.id, email: session.user.email ?? '' } : null);
      if (!session) {
        setChecking(false);
        setRecovery(false);
        return;
      }
      // Do not call other Supabase Auth methods inside the Auth callback lock.
      setTimeout(() => { void refresh(); }, 0);
    });

    const interval = setInterval(() => { void refresh(); }, ACCESS_REFRESH_MS);
    const onFocus = () => {
      if (document.visibilityState === 'hidden') return;
      if (userId && deadline && deadline <= Date.now()) deny('Checking your access again…');
      void refresh();
    };
    const onOffline = () => {
      if (userId) deny('You are offline. Reconnect to verify your client access.');
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      active = false;
      generation++;
      request?.abort();
      subscription.unsubscribe();
      clearInterval(interval);
      clearTimeout(initialTimeout);
      clearTimeout(leaseTimer);
      refreshRef.current = () => {};
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, []);

  const refresh = useCallback(() => refreshRef.current(), []);
  return { identity, access, checking, error, recovery, refresh };
}
