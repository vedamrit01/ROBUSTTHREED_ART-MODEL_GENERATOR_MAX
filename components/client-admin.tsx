import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, LoaderCircle, RefreshCw, Search, ShieldCheck, Users, X } from 'lucide-react';
import { Button } from './ui/button';
import { authClient } from '../lib/auth-client';
import { AUTH_REQUEST_TIMEOUT_MS, clientListSchema, type ClientList, type ClientStatus } from '../lib/client-access';

type ListedClient = ClientList['accounts'][number];
const statusLabels = { pending: 'Pending', approved: 'Approved', revoked: 'Inactive' };
const date = (value: string) => new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export default function ClientAdmin() {
  const [filter, setFilter] = useState<ClientStatus | 'all'>('pending');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [list, setList] = useState<ClientList>({ accounts: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [decision, setDecision] = useState<{ client: ListedClient; status: 'approved' | 'revoked' } | null>(null);
  const [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search.trim()); setPage(0); }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    if (!authClient) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timer = setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);
    setLoading(true); setError('');
    try {
      const result = await authClient.rpc('studio_list_clients', {
        p_status: filter === 'all' ? null : filter,
        p_search: query,
        p_offset: page * 25,
      }).abortSignal(controller.signal);
      if (request.current !== controller) return;
      if (result.error) throw result.error;
      const next = clientListSchema.parse(result.data);
      if (page > 0 && page * 25 >= next.total) { setPage(Math.max(0, Math.ceil(next.total / 25) - 1)); return; }
      setList(next);
    } catch {
      if (request.current === controller) {
        setList({ accounts: [], total: 0 });
        setError('Client accounts could not be loaded. Check your connection and administrator access, then retry.');
      }
    } finally {
      clearTimeout(timer);
      if (request.current === controller) setLoading(false);
    }
  }, [filter, query, page]);

  useEffect(() => { void load(); return () => { request.current?.abort(); request.current = null; }; }, [load]);
  useEffect(() => {
    if (decision && dialog.current && !dialog.current.open) dialog.current.showModal();
    if (!decision && dialog.current?.open) dialog.current.close();
  }, [decision]);

  async function saveDecision() {
    if (!authClient || !decision || saving) return;
    setSaving(true); setError(''); setMessage('');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);
    try {
      const result = await authClient.rpc('studio_set_client_status', {
        p_user_id: decision.client.user_id,
        p_status: decision.status,
        p_expected_status: decision.client.status,
      }).abortSignal(controller.signal);
      if (result.error) throw result.error;
      setMessage(`${decision.client.display_name || decision.client.email}: access ${decision.status === 'approved' ? 'approved' : 'disabled'}.`);
      setDecision(null);
      await load();
    } catch {
      setDecision(null);
      setError('The change was not confirmed. Refresh the list before trying again; another administrator may have changed this account.');
    } finally { clearTimeout(timer); setSaving(false); }
  }

  return <main className="client-admin">
    <header className="client-admin-heading"><div><span className="client-kicker">ROBUSTTHREED ADMIN</span><h1>Client access</h1><p>Approve each client’s account and manage who can open the studio.</p></div><Button variant="outline" onClick={() => void load()} disabled={loading || saving}><RefreshCw size={16}/>Refresh</Button></header>
    <section className="client-directory" aria-label="Client accounts">
      <div className="client-filters">
        <label className="client-search"><Search size={18}/><span className="visually-hidden">Search clients</span><input type="search" placeholder="Search name, email or business" value={search} onChange={e => setSearch(e.target.value)} maxLength={150}/></label>
        <label className="client-status-filter">Status<select value={filter} onChange={e => { setFilter(e.target.value as typeof filter); setPage(0); }}><option value="pending">Pending approval</option><option value="approved">Approved</option><option value="revoked">Inactive</option><option value="all">All accounts</option></select></label>
      </div>
      {error && <div className="client-alert" role="alert">{error}</div>}
      {message && <div className="client-success" role="status">{message}</div>}
      {loading ? <div className="client-empty" role="status"><LoaderCircle className="spin"/><p>Loading client accounts…</p></div> : !list.accounts.length ? <div className="client-empty"><Users size={30}/><h2>{error ? 'Accounts unavailable' : filter === 'pending' && !query ? 'No pending requests' : 'No matching accounts'}</h2><p>{error ? 'Use Refresh to try again.' : 'Clients can request an account from the sign-in page. You approve them here after they confirm their email.'}</p></div> : <>
        <div className="client-table-scroll"><table className="client-table"><caption className="visually-hidden">Client account approvals</caption><thead><tr><th scope="col">Client</th><th scope="col">Business</th><th scope="col">Requested</th><th scope="col">Access</th><th scope="col">Actions</th></tr></thead><tbody>
          {list.accounts.map(client => <tr key={client.user_id}>
            <th scope="row"><strong>{client.display_name || 'Client'}</strong><span>{client.email}</span>{!client.email_verified && <small>Email not confirmed</small>}</th>
            <td>{client.company || '—'}</td><td>{date(client.created_at)}</td>
            <td><span className={'client-status ' + (client.is_admin ? 'approved' : client.status)}>{client.is_admin ? 'Administrator' : statusLabels[client.status]}</span></td>
            <td><div className="client-row-actions">{client.is_admin ? <span className="client-protected"><ShieldCheck size={16}/>Admin account</span> : <>
              {client.status !== 'approved' && <Button size="sm" disabled={saving || !client.email_verified} title={!client.email_verified ? 'The client must confirm their email first.' : undefined} aria-label={'Approve ' + client.email} onClick={() => setDecision({ client, status: 'approved' })}><Check size={15}/>Approve</Button>}
              {client.status !== 'revoked' && <Button size="sm" variant="outline" disabled={saving} aria-label={'Disable access for ' + client.email} onClick={() => setDecision({ client, status: 'revoked' })}><X size={15}/>{client.status === 'pending' ? 'Decline' : 'Revoke'}</Button>}
            </>}</div></td>
          </tr>)}
        </tbody></table></div>
        <div className="client-pagination"><span>{page * 25 + 1}–{Math.min((page + 1) * 25, list.total)} of {list.total} accounts</span><div><Button size="sm" variant="outline" disabled={page === 0 || saving} onClick={() => setPage(p => p - 1)}><ChevronLeft size={16}/>Previous</Button><Button size="sm" variant="outline" disabled={(page + 1) * 25 >= list.total || saving} onClick={() => setPage(p => p + 1)}>Next<ChevronRight size={16}/></Button></div></div>
      </>}
    </section>
    <p className="client-admin-note">Access is checked regularly. Revoking approval locks the hosted workspace on its next check, normally within 30 seconds. Each client’s artwork stays on their device.</p>
    <dialog ref={dialog} className="client-dialog" aria-labelledby="decision-title" onCancel={event => { if (saving) event.preventDefault(); else setDecision(null); }}>
      {decision && <><h2 id="decision-title">{decision.status === 'approved' ? 'Approve this client?' : 'Disable client access?'}</h2><p><strong>{decision.client.display_name}</strong><br/>{decision.client.email}</p><p>{decision.status === 'approved' ? 'This account will be able to use the image and SVG model generator.' : 'This account will lose access to the hosted generator. You can approve it again later.'}</p><div className="client-actions"><Button variant="outline" autoFocus disabled={saving} onClick={() => setDecision(null)}>Cancel</Button><Button disabled={saving} onClick={() => void saveDecision()}>{saving ? 'Saving…' : decision.status === 'approved' ? 'Approve access' : 'Disable access'}</Button></div></>}
    </dialog>
  </main>;
}
