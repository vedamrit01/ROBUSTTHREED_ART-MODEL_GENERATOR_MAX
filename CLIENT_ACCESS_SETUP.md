# Client accounts and administrator approval

This update adds a separate email/password login for every client. New accounts
are pending until the owner approves them. Administrators can search accounts,
approve access, decline requests, revoke access, and restore access later.

## What access control protects

- Supabase Auth manages passwords, email verification, and password recovery.
- Database permissions protect client records and approval decisions. A client
  cannot read another client's record or change their own approval.
- Administrator roles live in a private database table. Signup metadata cannot
  grant permissions. Only a trusted project owner can provision administrators.
- The hosted UI checks current approval every 15 seconds and expires an unchecked
  approval after 30 seconds. Revocation, logout, or an access-check failure
  unmounts the converter and clears that workspace. Auth session deletion and
  user bans also deny database access without waiting for an old JWT to expire.
- Files and generated geometry remain on the device, not in Supabase.

**Important boundary:** GitHub Pages serves public JavaScript, and this repository
already contains the converter source. Login controls the normal hosted workflow
and protects account data; it is not copy protection or a server-enforced license
for the conversion engine. Someone can download or fork public code and remove
the UI gate. Protecting a proprietary engine requires serving that engine behind
server-side authorization. Previously published copies cannot be recalled.

## Production setup

1. Create a dedicated Supabase project in the owner's selected organization after
   confirming the current project cost. Do not reuse an unrelated application's
   authentication project.
2. Apply the SQL in `supabase/migrations/` to that project in order. For a new
   hosted project, apply the checked migration once using Supabase's migration
   tooling. The database creates pending profile rows automatically when users
   register. Keep `studio_private` out of the Data API's exposed schemas.
3. In Supabase Auth, enable email/password accounts and **keep email confirmation
   enabled**. Set the Site URL and allowed redirect URL to:

   `https://vedamrit01.github.io/ROBUSTTHREED_ART-MODEL_GENERATOR_MAX/`

   Add an exact localhost callback only for local development. The app uses PKCE;
   users should open confirmation and recovery links in the browser where they
   requested them. Use Supabase's default confirmation/reset link templates.
4. Configure a production SMTP sender for confirmation and password-reset emails.
   Supabase's default sender only delivers to authorized project-team addresses
   and is unsuitable for onboarding arbitrary clients. Do not disable email
   confirmation to work around email setup.
5. Set these **GitHub repository variables** in Settings → Secrets and variables
   → Actions → Variables:

   - `VITE_SUPABASE_URL`: the project's HTTPS URL.
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: the `sb_publishable_…` key.

   These values are intentionally public browser configuration. Never enter a
   secret key, service-role key, database password, or management token here.
   The deployment workflow fails before publication if configuration is absent.
6. Register and verify the owner's real account using the application. While it
   is pending, provision the administrator in the trusted Supabase SQL Editor.
   Copy the **verified owner's Auth user UUID**, verify the corresponding email,
   and substitute that UUID in the following SQL. No default admin password is
   created, and the first person to register is never automatically an admin.

   ```sql
   insert into studio_private.administrators (user_id)
   select id from auth.users
   where id = 'REPLACE_WITH_VERIFIED_OWNER_AUTH_UUID'::uuid
     and email_confirmed_at is not null
     and coalesce(is_anonymous, false) = false
     and (banned_until is null or banned_until <= now())
   on conflict (user_id) do nothing
   returning user_id;
   ```

   A successful insert must return the intended UUID. Refresh the app; the owner
   should now see the **Clients** button in the account bar. Choose **All
   accounts** to also see the administrator's account.
7. Verify with two separate test client accounts: both initially pending, approve
   only one, confirm only that one can open the studio, then revoke it and confirm
   it is locked on the next check. Run Supabase's security advisors and address
   any findings before production use. Use test addresses you control.

## Day-to-day use

- Send clients the existing studio link. They choose **Request access**, create
  their own password, confirm their email, and sign in.
- As administrator, open **Clients**, review **Pending approval**, then select
  **Approve** for the intended email address and confirm the action.
- Use **Approved** or **All accounts** to find a client and **Revoke** access.
- Use **Inactive** to find and approve a previously declined or revoked client.
- A client changing their email requires approval again. Administrator accounts
  cannot be revoked through this client-management screen.
- There is no single-device or concurrent-session limit in this version.
  Different clients can sign in and work independently.

## Development and verification

Copy `.env.example` to `.env.local` and fill the public configuration values.
Vite reads this file from the repository root. With no configuration, the app
fails closed with a setup message; it never silently opens the converter.

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm test:access
pnpm test:access-ui
pnpm build
pnpm test:pages
```

Database tests run the real migration in an isolated PostgreSQL instance using
PGlite. They exercise RLS, function grants, cross-client isolation, forged signup
metadata, administrator approval/revocation, email changes, stale decisions,
unverified users, deleted sessions, user bans, and audit records. UI tests mock
only the Auth transport and expensive converter to check the session gate and
workspace lifecycle. They do not replace a final test against hosted Supabase.

The existing 5-million-triangle engine, dimensions, and image/SVG processing
workflow are unchanged. Pull requests run validation without deploying. Merge
only after the authentication project, sender, and public configuration are ready.

## References

- [Supabase Auth with React](https://supabase.com/docs/guides/auth/quickstarts/react)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Production email delivery](https://supabase.com/docs/guides/auth/auth-smtp)
- [Explicit Data API grants](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
