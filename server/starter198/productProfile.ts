import {
  Starter198RepositoryError,
  starter198Repository,
  type Starter198Repository,
} from './repository.js';

export type ServerProductProfile = 'starter_198' | 'advanced_customer';

/**
 * Resolve the account's product boundary without using a forbidden workspace
 * request as feature detection. Absence is a valid legacy result; storage and
 * integrity failures remain errors so callers cannot silently broaden access.
 */
export async function resolveServerProductProfile(
  tenantId: string,
  repository: Pick<Starter198Repository, 'access'> = starter198Repository,
): Promise<ServerProductProfile> {
  try {
    await repository.access(tenantId);
    return 'starter_198';
  } catch (error) {
    if (error instanceof Starter198RepositoryError && error.code === 'starter_198_not_provisioned') {
      return 'advanced_customer';
    }
    throw error;
  }
}
