import { Starter198RepositoryError, starter198Repository, type Starter198Repository } from './repository.js';

export class Starter198MemberQuotaError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = 'Starter198MemberQuotaError';
  }
}

/**
 * Legacy tenants keep their existing member behavior. Once starter_198 is
 * provisioned, an unreadable access record or member count fails closed.
 * The count/create race is process-local debt until member creation moves to
 * a database transaction or tenant-scoped distributed lock.
 */
export async function assertStarter198MemberCapacity(input: {
  tenantId: string;
  countMembers: () => Promise<number>;
  repository?: Pick<Starter198Repository, 'access'>;
}): Promise<void> {
  const repository = input.repository ?? starter198Repository;
  let limit: number;
  try {
    limit = (await repository.access(input.tenantId)).resourceLimits.memberCount;
  } catch (error) {
    if (error instanceof Starter198RepositoryError && error.code === 'starter_198_not_provisioned') return;
    throw new Starter198MemberQuotaError('starter_198_member_quota_unavailable', 503);
  }
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new Starter198MemberQuotaError('starter_198_member_quota_unavailable', 503);
  }
  let count: number;
  try { count = await input.countMembers(); }
  catch { throw new Starter198MemberQuotaError('starter_198_member_quota_unavailable', 503); }
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Starter198MemberQuotaError('starter_198_member_quota_unavailable', 503);
  }
  if (count >= limit) throw new Starter198MemberQuotaError('starter_198_member_quota_exceeded', 409);
}
