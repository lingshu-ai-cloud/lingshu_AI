import { pbGet } from '../storage/pb.js';
import { isLocalDemoAuthorization, verifyLocalIdentity } from '../auth/localIdentity.js';
import { localAccountRecordsFile, readLocalAccountRecords } from './localAccountStore.js';
import { currentDataAuthority } from '../storage/dataAuthority.js';

export type OrganizationRole = 'super_admin' | 'admin' | 'social_operator' | 'customer_service';

const ORGANIZATION_ROLES = new Set<OrganizationRole>([
  'super_admin',
  'admin',
  'social_operator',
  'customer_service',
]);

export function organizationRoleOrNull(value: unknown): OrganizationRole | null {
  return ORGANIZATION_ROLES.has(value as OrganizationRole) ? value as OrganizationRole : null;
}

export function normalizeOrganizationRole(
  value: unknown,
  fallback: OrganizationRole = 'customer_service',
): OrganizationRole {
  return organizationRoleOrNull(value) ?? fallback;
}

function localTokenRole(authorization: string | undefined): OrganizationRole | null | undefined {
  if (!isLocalDemoAuthorization(authorization)) return undefined;
  return verifyLocalIdentity(authorization)?.role ?? null;
}

function localAuthorityRole(userId: string): OrganizationRole | null | undefined {
  if (currentDataAuthority() !== 'local') return undefined;
  const account = readLocalAccountRecords(localAccountRecordsFile())
    .find(candidate => candidate.userId === userId);
  return organizationRoleOrNull(account?.role);
}

/** Resolve a role for a security-sensitive action; missing or malformed roles fail closed. */
export async function requestOrganizationRoleStrict(
  authorization: string | undefined,
  userId: string,
): Promise<OrganizationRole | null> {
  const localRole = localTokenRole(authorization);
  if (localRole !== undefined) return localRole;
  // Asset-session cookies and browser-read sessions have already been verified
  // by requireAuth and bind the request to the local data authority. They do not
  // necessarily carry the original local-demo bearer header, so resolve the
  // persisted role from that same local authority instead of crossing into PB.
  const authorityRole = localAuthorityRole(userId);
  if (authorityRole !== undefined) return authorityRole;
  const user = await pbGet('users', userId) as { role?: unknown } | null;
  return organizationRoleOrNull(user?.role);
}
