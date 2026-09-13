import { z } from 'zod';

export const accountSchema = z.object({
  user_id: z.string().uuid(),
  email: z.string(),
  display_name: z.string(),
  company: z.string(),
  status: z.enum(['pending', 'approved', 'revoked']),
  email_verified: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  decided_at: z.string().nullable(),
});
export type ClientAccount = z.infer<typeof accountSchema>;
export type ClientStatus = ClientAccount['status'];
export const accessSchema = z.object({
  account: accountSchema,
  is_admin: z.boolean(),
});
export type ClientAccess = z.infer<typeof accessSchema>;
export const clientListSchema = z.object({
  accounts: z.array(accountSchema.extend({ is_admin: z.boolean() })),
  total: z.number().int().nonnegative(),
});
export type ClientList = z.infer<typeof clientListSchema>;

export function readAccess(value: unknown, expectedUserId: string): ClientAccess {
  const access = accessSchema.parse(value);
  if (access.account.user_id !== expectedUserId || !access.account.email_verified) {
    throw new Error('Your account could not be verified. Please sign in again.');
  }
  return access;
}

export function canOpenStudio(access: ClientAccess | null): boolean {
  return !!access && access.account.email_verified &&
    (access.is_admin || access.account.status === 'approved');
}

// Approval leases are deliberately short. A missing server response never
// extends a previous approval, even when a cached Auth session still exists.
export const ACCESS_LEASE_MS = 30_000;
export const ACCESS_REFRESH_MS = 15_000;
export const AUTH_REQUEST_TIMEOUT_MS = 10_000;
