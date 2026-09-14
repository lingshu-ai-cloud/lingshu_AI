import { pbGet } from '../storage/pb.js';

export type OrganizationRole = 'super_admin' | 'admin' | 'social_operator' | 'customer_service';

const ORGANIZATION_ROLES = new Set<OrganizationRole>([
  'super_admin',
  'admin',
  'social_operator',
  'customer_service',
]);
const LOCAL_AUTH_PREFIX = 'local-demo.';

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
  if (process.env.NODE_ENV === 'production' || process.env.DISABLE_LOCAL_AUTH_FALLBACK === 'true') return undefined;
  const token = authorization?.replace(/^Bearer\s+/i, '').trim();
  if (!token?.startsWith(LOCAL_AUTH_PREFIX)) return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(token.slice(LOCAL_AUTH_PREFIX.length), 'base64url').toString('utf8'),
    ) as { role?: unknown };
    return organizationRoleOrNull(payload.role);
  } catch {
    return null;
  }
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
