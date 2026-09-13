import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { canOpenStudio, readAccess } from '../lib/client-access';

test('database enforces separate client accounts and administrator-only approval', async t => {
  const db = new PGlite();
  try {
    // Minimal Auth fixtures reproduce the JWT claims PostgREST supplies after
    // validating a real token. No fixtures or test identities reach production.
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users (
        id uuid primary key, email text, raw_user_meta_data jsonb default '{}',
        email_confirmed_at timestamptz, is_anonymous boolean default false,
        banned_until timestamptz
      );
      create table auth.sessions (id uuid primary key, user_id uuid references auth.users(id) on delete cascade);
      create function auth.jwt() returns jsonb language sql stable as
        $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as
        $$ select (auth.jwt() ->> 'sub')::uuid $$;
      grant usage on schema public, auth to anon, authenticated;
      grant execute on function auth.jwt(), auth.uid() to anon, authenticated;
    `);
    const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
    for (const file of (await readdir(migrationDirectory)).filter(f => f.endsWith('.sql')).sort()) {
      await db.exec(await readFile(new URL(file, migrationDirectory), 'utf8'));
    }

    const ids = {
      admin: '10000000-0000-4000-8000-000000000001',
      alice: '10000000-0000-4000-8000-000000000002',
      bob: '10000000-0000-4000-8000-000000000003',
      unverified: '10000000-0000-4000-8000-000000000004',
    };
    const sessions = {
      admin: '20000000-0000-4000-8000-000000000001',
      alice: '20000000-0000-4000-8000-000000000002',
      bob: '20000000-0000-4000-8000-000000000003',
      unverified: '20000000-0000-4000-8000-000000000004',
    };
    type Person = keyof typeof ids;
    for (const who of Object.keys(ids) as Person[]) {
      await db.query(`insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data)
        values ($1, $2, $3, $4)`, [ids[who], who + '@example.invalid', who === 'unverified' ? null : new Date(),
        JSON.stringify({ display_name: who, company: 'Test workshop', role: 'admin', is_admin: true, status: 'approved' })]);
      await db.query('insert into auth.sessions(id, user_id) values ($1, $2)', [sessions[who], ids[who]]);
    }
    await db.query('insert into studio_private.administrators(user_id) values ($1)', [ids.admin]);

    async function asUser<T = Record<string, unknown>>(who: Person | null, sql: string, params: unknown[] = []) {
      return db.transaction(async tx => {
        await tx.exec(who ? 'set local role authenticated' : 'set local role anon');
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(who ? { sub: ids[who], session_id: sessions[who], role: 'authenticated' } : {})]);
        return tx.query<T>(sql, params);
      });
    }
    async function access(who: Person) {
      const result = await asUser<{ value: unknown }>(who, 'select public.studio_access() as value');
      return readAccess(result.rows[0].value, ids[who]);
    }
    const decide = (actor: Person | null, who: Person, next: string, expected: string) =>
      asUser(actor, 'select public.studio_set_client_status($1, $2, $3)', [ids[who], next, expected]);

    await t.test('signup metadata cannot grant access or administrator privileges', async () => {
      const a = await access('alice');
      assert.equal(a.account.status, 'pending');
      assert.equal(a.is_admin, false);
      assert.equal(canOpenStudio(a), false);
      assert.equal((await access('admin')).is_admin, true);
    });
    await t.test('anonymous callers cannot read accounts or execute account RPCs', async () => {
      for (const sql of ['select * from public.studio_accounts', 'select public.studio_access()', 'select public.studio_list_clients()']) {
        await assert.rejects(() => asUser(null, sql), /permission denied/);
      }
      await assert.rejects(() => decide(null, 'alice', 'approved', 'pending'), /permission denied/);
    });
    await t.test('a client only sees their own account, even without a UI filter', async () => {
      const rows = await asUser<{ user_id: string }>('alice', 'select user_id from public.studio_accounts');
      assert.deepEqual(rows.rows.map(row => row.user_id), [ids.alice]);
      const other = await asUser('alice', 'select * from public.studio_accounts where user_id = $1', [ids.bob]);
      assert.equal(other.rows.length, 0);
      await assert.rejects(() => asUser('alice', 'select public.studio_list_clients()'), /Administrator access required/);
      await assert.rejects(() => asUser('alice', 'select * from studio_private.administrators'), /permission denied/);
      await assert.rejects(() => asUser('alice', 'select * from studio_private.approval_events'), /permission denied/);
    });
    await t.test('clients cannot mutate approvals, reassign records, or promote themselves', async () => {
      await assert.rejects(() => decide('alice', 'alice', 'approved', 'pending'), /Administrator access required/);
      await assert.rejects(() => decide('alice', 'bob', 'approved', 'pending'), /Administrator access required/);
      for (const sql of [
        `update public.studio_accounts set status = 'approved'`,
        `update public.studio_accounts set user_id = '${ids.admin}'`,
        `insert into public.studio_accounts(user_id, email) values ('${ids.alice}', 'forged@example.invalid')`,
        `delete from public.studio_accounts`,
        `insert into studio_private.administrators(user_id) values ('${ids.alice}')`,
      ]) await assert.rejects(() => asUser('alice', sql), /permission denied/);
    });
    await t.test('approving one client does not unlock a different client', async () => {
      await decide('admin', 'alice', 'approved', 'pending');
      assert.equal(canOpenStudio(await access('alice')), true);
      assert.equal(canOpenStudio(await access('bob')), false);
      await assert.rejects(() => asUser('alice', 'select public.studio_list_clients()'), /Administrator access required/);
    });
    await t.test('revocation is read from the database despite an existing Auth session', async () => {
      await decide('admin', 'alice', 'revoked', 'approved');
      assert.equal(canOpenStudio(await access('alice')), false);
      await decide('admin', 'alice', 'approved', 'revoked');
      assert.equal(canOpenStudio(await access('alice')), true);
    });
    await t.test('stale admin decisions cannot overwrite newer decisions', async () => {
      await assert.rejects(() => decide('admin', 'alice', 'revoked', 'pending'), /Account changed/);
      assert.equal((await access('alice')).account.status, 'approved');
    });
    await t.test('unverified clients, invalid status values, and admin targets are rejected', async () => {
      await assert.rejects(() => decide('admin', 'unverified', 'approved', 'pending'), /verified, active email/);
      await assert.rejects(() => access('unverified'));
      await assert.rejects(() => decide('admin', 'bob', 'admin', 'pending'), /Invalid account decision/);
      await assert.rejects(() => decide('admin', 'admin', 'revoked', 'pending'), /Administrator accounts/);
    });
    await t.test('account search is literal and only administrators can list clients', async () => {
      const result = await asUser<{ value: { total: number } }>('admin', 'select public.studio_list_clients(null, $1, 0) as value', ['alice']);
      assert.equal(result.rows[0].value.total, 1);
      const escaped = await asUser<{ value: { total: number } }>('admin', 'select public.studio_list_clients(null, $1, 0) as value', ["%') OR true --"]);
      assert.equal(escaped.rows[0].value.total, 0);
      await assert.rejects(() => asUser('admin', 'select public.studio_list_clients(null, $1, -1)', ['']), /Invalid client filter/);
    });
    await t.test('email identity changes require approval again', async () => {
      await db.query('update auth.users set email = $2 where id = $1', [ids.alice, 'changed@example.invalid']);
      assert.equal((await access('alice')).account.status, 'pending');
    });
    await t.test('deleted sessions and banned users lose API access immediately', async () => {
      await db.query('delete from auth.sessions where user_id = $1', [ids.alice]);
      await assert.rejects(() => access('alice'));
      await db.query(`update auth.users set banned_until = now() + interval '1 day' where id = $1`, [ids.bob]);
      await assert.rejects(() => access('bob'));
      await assert.rejects(() => decide('admin', 'bob', 'approved', 'pending'), /verified, active email/);
      await db.query('delete from auth.sessions where user_id = $1', [ids.admin]);
      await assert.rejects(() => decide('admin', 'bob', 'revoked', 'pending'), /Administrator access required/);
    });
    await t.test('approval decisions are audited and no public function runs as definer', async () => {
      const events = await db.query<{ count: number }>('select count(*)::integer as count from studio_private.approval_events');
      assert.equal(events.rows[0].count, 3);
      const unsafe = await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'studio_%' and p.prosecdef`);
      assert.equal(unsafe.rows.length, 0);
    });
  } finally { await db.close(); }
});

test('malformed, unverified, or mismatched access responses fail closed', () => {
  assert.equal(canOpenStudio(null), false);
  assert.throws(() => readAccess({ is_admin: true }, '10000000-0000-4000-8000-000000000001'));
  assert.throws(() => readAccess({ account: { status: 'approved' }, is_admin: true }, '10000000-0000-4000-8000-000000000001'));
});
