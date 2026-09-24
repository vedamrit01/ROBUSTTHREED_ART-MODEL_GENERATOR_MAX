import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  listener: null as ((event: string, session: unknown) => void) | null,
  response: null as unknown,
  stall: false,
  pending: [] as ((value: { data: unknown; error: null }) => void)[],
}));

vi.mock('../lib/auth-client', () => ({
  authReturnUrl: () => 'https://example.invalid/ROBUSTTHREED_ART-MODEL_GENERATOR_MAX/',
  authClient: {
    auth: {
      onAuthStateChange: (listener: typeof harness.listener) => {
        harness.listener = listener;
        queueMicrotask(() => listener?.('INITIAL_SESSION', null));
        return { data: { subscription: { unsubscribe: () => { harness.listener = null; } } } };
      },
    },
    rpc: () => ({
      abortSignal: (signal: AbortSignal) => {
        if (!harness.stall) return Promise.resolve({ data: harness.response, error: null });
        return new Promise((resolve, reject) => {
          harness.pending.push(resolve);
          signal.addEventListener('abort', () => reject(new Error('Request aborted')), { once: true });
        });
      },
    }),
  },
}));
vi.mock('../components/studio', () => ({ default: function Workspace() {
  const [file, setFile] = useState<File | null>(null);
  return <section data-testid="studio"><input type="file" onChange={event => setFile(event.target.files?.[0] ?? null)}/><span>{file?.name ?? 'STL workspace'}</span></section>;
} }));
import ClientPortal from '../components/client-portal';

const alice = '10000000-0000-4000-8000-000000000002';
const bob = '10000000-0000-4000-8000-000000000003';
function profile(id: string, status: 'pending' | 'approved' | 'revoked') {
  return { is_admin: false, account: {
    user_id: id, email: 'client@example.invalid', display_name: 'Client', company: 'Workshop',
    status, email_verified: true, created_at: '2026-09-12T12:00:00Z',
    updated_at: '2026-09-12T12:00:00Z', decided_at: null,
  } };
}

let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  harness.response = null; harness.stall = false; harness.pending = [];
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<ClientPortal/>); });
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove(); vi.useRealTimers();
});
async function signIn(id: string) {
  await act(async () => {
    // Forged user metadata must not affect the database-derived approval.
    harness.listener?.('SIGNED_IN', { user: { id, email: 'client@example.invalid', user_metadata: { is_admin: true, status: 'approved' } } });
    await vi.advanceTimersByTimeAsync(0);
  });
}
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
const hasStudio = () => {
  const studio = container.querySelector('[data-testid="studio"]');
  return !!studio && !studio.closest('[hidden], [inert]');
};

test('a login alone does not mount the converter; approval and revocation are refreshed', async () => {
  expect(container.textContent).toContain('Sign in');
  expect(hasStudio()).toBe(false);
  harness.response = profile(alice, 'pending');
  await signIn(alice);
  expect(container.textContent).toContain('Awaiting approval');
  expect(hasStudio()).toBe(false);
  harness.response = profile(alice, 'approved');
  await advance(15_000);
  expect(hasStudio()).toBe(true);
  expect(container.textContent).not.toContain('Administrator');
  harness.response = profile(alice, 'revoked');
  await advance(15_000);
  expect(hasStudio()).toBe(false);
  expect(container.textContent).toContain('Your access is inactive');
});

test('offline and timed-out checks cannot reuse a cached approval', async () => {
  harness.response = profile(alice, 'approved'); await signIn(alice);
  expect(hasStudio()).toBe(true);
  await act(async () => { window.dispatchEvent(new Event('offline')); });
  expect(hasStudio()).toBe(false);
  await act(async () => { window.dispatchEvent(new Event('online')); });
  expect(hasStudio()).toBe(true);
  harness.stall = true;
  await advance(25_001);
  expect(hasStudio()).toBe(false);
  expect(container.textContent).toContain('could not verify your access');
});

test('switching accounts or signing out discards the previous client workspace', async () => {
  harness.response = profile(alice, 'approved'); await signIn(alice);
  expect(hasStudio()).toBe(true);
  harness.response = profile(bob, 'pending'); await signIn(bob);
  expect(hasStudio()).toBe(false);
  expect(container.textContent).toContain('Awaiting approval');
  await act(async () => { harness.listener?.('SIGNED_OUT', null); });
  expect(container.textContent).toContain('Sign in');
  expect(hasStudio()).toBe(false);
});

test('a response for another user cannot unlock the studio', async () => {
  harness.response = profile(alice, 'approved'); await signIn(bob);
  expect(hasStudio()).toBe(false);
  expect(container.textContent).toContain('could not verify your access');
});


test('returning after a suspended tab preserves the workspace while locking expired access', async () => {
  harness.response = profile(alice, 'approved'); await signIn(alice);
  const workspace = container.querySelector('[data-testid="studio"]');
  const input = workspace!.querySelector('input')!;
  Object.defineProperty(input, 'files', { value: [new File(['<svg/>'], 'client-art.svg')] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(workspace!.textContent).toContain('client-art.svg');
  // Moving wall time without firing timers reproduces a suspended background tab.
  vi.setSystemTime(Date.now() + 60_000);
  harness.stall = true;
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(hasStudio()).toBe(false);
  expect(container.querySelector('[data-testid="studio"]')).toBe(workspace);
  await act(async () => { harness.pending.shift()?.({ data: profile(alice, 'approved'), error: null }); });
  expect(hasStudio()).toBe(true);
  expect(container.querySelector('[data-testid="studio"]')).toBe(workspace);
  expect(workspace!.textContent).toContain('client-art.svg');
  harness.stall = false;
  await signIn(alice);
  await act(async () => {
    harness.listener?.('TOKEN_REFRESHED', { user: { id: alice, email: 'client@example.invalid' } });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(container.querySelector('[data-testid="studio"]')).toBe(workspace);
});

test('temporary network failures preserve work, but revocation destroys it', async () => {
  harness.response = profile(alice, 'approved'); await signIn(alice);
  const workspace = container.querySelector('[data-testid="studio"]');
  await act(async () => { window.dispatchEvent(new Event('offline')); });
  expect(hasStudio()).toBe(false);
  expect(container.querySelector('[data-testid="studio"]')).toBe(workspace);
  await act(async () => { window.dispatchEvent(new Event('online')); });
  expect(hasStudio()).toBe(true);
  expect(container.querySelector('[data-testid="studio"]')).toBe(workspace);
  harness.response = profile(alice, 'revoked');
  await advance(15_000);
  expect(container.querySelector('[data-testid="studio"]')).toBeNull();
});


test('changing to another approved account and signing out discard retained files', async () => {
  harness.response = profile(alice, 'approved'); await signIn(alice);
  const original = container.querySelector('[data-testid="studio"]');
  harness.response = profile(bob, 'approved'); await signIn(bob);
  expect(hasStudio()).toBe(true);
  expect(container.querySelector('[data-testid="studio"]')).not.toBe(original);
  await act(async () => { window.dispatchEvent(new Event('offline')); });
  await act(async () => { harness.listener?.('SIGNED_OUT', null); });
  expect(container.querySelector('[data-testid="studio"]')).toBeNull();
});
