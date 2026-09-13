import { lazy, Suspense, useState, type FormEvent, type ReactNode } from 'react';
import { Box, Clock3, LockKeyhole, LogOut, ShieldCheck, Users, LoaderCircle } from 'lucide-react';
import { Button } from './ui/button';
import { authClient, authReturnUrl } from '../lib/auth-client';
import { canOpenStudio } from '../lib/client-access';
import { useClientSession } from '../lib/use-client-session';

const Studio = lazy(() => import('./studio'));
const ClientAdmin = lazy(() => import('./client-admin'));

export function PortalFrame({ children }: { children: ReactNode }) {
  return <main className="client-page">
    <header className="client-brand"><Box size={27}/><span>robustthreed <small>STL Studio</small></span></header>
    {children}
    <footer className="client-footer">Artwork is processed on your device. Account details are stored securely for client access.</footer>
  </main>;
}

function authMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
  if (code === 'invalid_credentials') return 'The email or password is incorrect. Please try again.';
  if (code === 'email_not_confirmed') return 'Please confirm your email address before signing in.';
  if (code === 'weak_password') return 'Please choose a stronger password with at least 12 characters.';
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') return 'Too many attempts. Please wait a little before trying again.';
  if (code === 'email_address_not_authorized' || code === 'unexpected_failure') return 'Account email delivery is unavailable. Please contact Robustthreed.';
  return 'The request could not be completed. Check your connection and try again.';
}

export function LoginForm() {
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  function changeMode(next: typeof mode) {
    setMode(next); setPassword(''); setConfirmation(''); setError(''); setMessage('');
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!authClient || busy) return;
    setError(''); setMessage('');
    if (mode === 'signup' && password !== confirmation) { setError('The passwords do not match.'); return; }
    if (mode === 'signup' && name.trim().length < 2) { setError('Please enter your name.'); return; }
    setBusy(true);
    try {
      if (mode === 'signin') {
        const result = await authClient.auth.signInWithPassword({ email: email.trim(), password });
        if (result.error) throw result.error;
      } else if (mode === 'signup') {
        const result = await authClient.auth.signUp({
          email: email.trim(), password,
          options: { emailRedirectTo: authReturnUrl(), data: { display_name: name.trim(), company: company.trim() } },
        });
        if (result.error) throw result.error;
        setMessage('Check your email to confirm your account, then sign in. Robustthreed must approve your access before you can use the generator. Open the confirmation link in this browser.');
      } else {
        const result = await authClient.auth.resetPasswordForEmail(email.trim(), { redirectTo: authReturnUrl() });
        if (result.error) throw result.error;
        setMessage('If that email has an account, you will receive a password reset link. Open it in this browser to choose a new password.');
      }
      setPassword(''); setConfirmation('');
    } catch (failure) { setError(authMessage(failure)); }
    finally { setBusy(false); }
  }

  return <PortalFrame><section className="client-card" aria-labelledby="login-heading">
    <span className="client-kicker">CLIENT ACCESS</span>
    <h1 id="login-heading">{mode === 'signup' ? 'Request your account.' : mode === 'forgot' ? 'Reset your password.' : 'Welcome to your studio.'}</h1>
    <p>{mode === 'signup' ? 'Create your own login. Your account starts with access pending approval.' : mode === 'forgot' ? 'Enter your account email to receive a reset link.' : 'Sign in with your approved client account.'}</p>
    {error && <div className="client-alert" role="alert">{error}</div>}
    {message && <div className="client-success" role="status">{message}</div>}
    <form className="client-form" onSubmit={event => void submit(event)}>
      {mode === 'signup' && <>
        <label>Your name<input name="display_name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={100} disabled={busy}/></label>
        <label>Business or organization <span>(optional)</span><input name="company" autoComplete="organization" value={company} onChange={e => setCompany(e.target.value)} maxLength={150} disabled={busy}/></label>
      </>}
      <label>Email address<input name="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} disabled={busy}/></label>
      {mode !== 'forgot' && <label>Password<input name="password" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={mode === 'signup' ? 12 : undefined} maxLength={128} disabled={busy}/>{mode === 'signup' && <small>Use at least 12 characters.</small>}</label>}
      {mode === 'signup' && <label>Confirm password<input name="confirm_password" type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} required minLength={12} maxLength={128} disabled={busy}/></label>}
      <Button type="submit" disabled={busy}>{busy && <LoaderCircle className="spin" size={16}/>} {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Sign in'}</Button>
    </form>
    <div className="client-form-links">
      {mode === 'signin' ? <><button disabled={busy} onClick={() => changeMode('signup')}>New client? Request access</button><button disabled={busy} onClick={() => changeMode('forgot')}>Forgot password?</button></> : <button disabled={busy} onClick={() => changeMode('signin')}>Back to sign in</button>}
    </div>
    <div className="client-help"><ShieldCheck size={17}/><span>Your approval is managed by Robustthreed. You never need to share your password with us.</span></div>
  </section></PortalFrame>;
}

function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!authClient || busy) return;
    if (password !== confirmation) { setError('The passwords do not match.'); return; }
    setBusy(true); setError('');
    try {
      const result = await authClient.auth.updateUser({ password });
      if (result.error) throw result.error;
      const logout = await authClient.auth.signOut({ scope: 'global' });
      if (logout.error) throw logout.error;
    } catch (failure) { setError(authMessage(failure)); }
    finally { setBusy(false); }
  }
  return <PortalFrame><section className="client-card">
    <span className="client-kicker">ACCOUNT RECOVERY</span><h1>Choose a new password.</h1>
    <p>After saving, sign in again with your new password.</p>
    {error && <div className="client-alert" role="alert">{error}</div>}
    <form className="client-form" onSubmit={event => void save(event)}>
      <label>New password<input type="password" name="new_password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} disabled={busy}/><small>At least 12 characters.</small></label>
      <label>Confirm new password<input type="password" name="confirm_new_password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy}/></label>
      <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</Button>
    </form>
  </section></PortalFrame>;
}

export default function ClientPortal() {
  const session = useClientSession();
  const [view, setView] = useState<'studio' | 'clients'>('studio');
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  async function signOut() {
    if (!authClient || signingOut) return;
    setSigningOut(true); setLogoutError('');
    try {
      const result = await authClient.auth.signOut({ scope: 'local' });
      if (result.error) throw result.error;
      setView('studio');
    } catch { setLogoutError('Sign-out could not finish. Please check your connection and retry.'); }
    finally { setSigningOut(false); }
  }
  const logout = <Button variant="outline" onClick={() => void signOut()} disabled={signingOut}><LogOut size={15}/>{signingOut ? 'Signing out…' : 'Sign out'}</Button>;

  if (!authClient) return <PortalFrame><section className="client-card"><LockKeyhole className="client-state-icon"/><h1>Client access is being set up.</h1><p>The studio will reopen when account setup is complete. Please contact Robustthreed for access.</p></section></PortalFrame>;
  if (session.recovery && session.identity) return <ResetPassword/>;
  if (session.checking) return <PortalFrame><section className="client-card" role="status"><LoaderCircle className="spin client-state-icon"/><h1>Checking your access…</h1></section></PortalFrame>;
  if (!session.identity) return <LoginForm/>;
  if (!canOpenStudio(session.access)) return <PortalFrame><section className="client-card">
    <Clock3 className="client-state-icon"/>
    <span className="client-kicker">{session.identity.email}</span>
    <h1>{session.error ? 'Access check needed.' : session.access?.account.status === 'revoked' ? 'Your access is inactive.' : 'Awaiting approval.'}</h1>
    <p>{session.error || (session.access?.account.status === 'revoked' ? 'Robustthreed has disabled access for this account. Contact us if you need it restored.' : 'Your account is ready. Robustthreed will review your request before you can use the generator.')}</p>
    <div className="client-actions"><Button onClick={session.refresh}>Check access</Button>{logout}</div>
    {logoutError && <div className="client-alert" role="alert">{logoutError}</div>}
  </section></PortalFrame>;

  const admin = session.access!.is_admin;
  return <>
    <div className="client-account-bar">
      <div><span className="client-account-role">{admin ? 'Administrator' : 'Approved client'}</span><strong>{session.access!.account.display_name || session.access!.account.email}</strong></div>
      <nav aria-label="Account navigation">
        {admin && <><Button variant={view === 'studio' ? 'secondary' : 'ghost'} aria-pressed={view === 'studio'} onClick={() => setView('studio')}><Box size={16}/>Studio</Button><Button variant={view === 'clients' ? 'secondary' : 'ghost'} aria-pressed={view === 'clients'} onClick={() => setView('clients')}><Users size={16}/>Clients</Button></>}
        {logout}
      </nav>
    </div>
    {logoutError && <div className="client-alert client-global-alert" role="alert">{logoutError}</div>}
    <Suspense fallback={<p className="client-loading" role="status">Opening your workspace…</p>}>
      <div hidden={admin && view === 'clients'}><Studio key={session.identity.id}/></div>
      {admin && view === 'clients' && <ClientAdmin/>}
    </Suspense>
  </>;
}
