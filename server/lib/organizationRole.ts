import { pbGet } from '../storage/pb.js';
import { isLocalDemoAuthorization, verifyLocalIdentity } from '../auth/localIdentity.js';

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

/** Resolve a role for a security-sensitive action; missing or malformed roles fail closed. */
export async function requestOrganizationRoleStrict(
  authorization: string | undefined,
  userId: string,
): Promise<OrganizationRole | null> {
  const localRole = localTokenRole(authorization);
  if (localRole !== undefined) return localRole;
  const user = await pbGet('users', userId) as { role?: unknown } | null;
  return organizationRoleOrNull(user?.role);
}
