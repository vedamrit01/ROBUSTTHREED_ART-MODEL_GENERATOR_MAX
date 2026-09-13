import { createClient } from '@supabase/supabase-js';

function configuredClient() {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  // Only a publishable key belongs in this static application. Never accept
  // a service-role JWT or a secret key as a frontend configuration value.
  if (!url || !key?.startsWith('sb_publishable_')) return null;
  try {
    const parsed = new URL(url);
    const local = import.meta.env.DEV && ['localhost', '127.0.0.1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !local) return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    return createClient(url, key, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Different applications on the same GitHub Pages origin must not
        // accidentally share an authentication storage slot.
        storageKey: 'robustthreed-max-client-session',
      },
    });
  } catch {
    return null;
  }
}

export const authClient = configuredClient();

export function authReturnUrl(): string {
  // Keep the repository subpath; never redirect to the github.io domain root.
  return new URL('./', window.location.href).href;
}
