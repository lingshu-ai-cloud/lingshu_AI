import { readDemoAccountRegistry, upsertDemoAccountRegistry } from './demoAccounts.js';
import { clearLocalTenantRegisteredCredential } from './localTenants.js';

type PasswordChangeCredentialBranch = 'local' | 'provider';

type PasswordChangeCredentialStateDependencies = {
  clearLocalTenantCredential: typeof clearLocalTenantRegisteredCredential;
  readRegistry: typeof readDemoAccountRegistry;
  writeRegistry: typeof upsertDemoAccountRegistry;
  warn: (message: string, details: Record<string, string>) => void;
};

const defaultDependencies: PasswordChangeCredentialStateDependencies = {
  clearLocalTenantCredential: clearLocalTenantRegisteredCredential,
  readRegistry: readDemoAccountRegistry,
  writeRegistry: upsertDemoAccountRegistry,
  warn: console.warn,
};

let testDependencyOverrides: Partial<PasswordChangeCredentialStateDependencies> | null = null;

/** Route-level tests can fail derived stores without changing the auth store. */
export function setPasswordChangeCredentialStateDependenciesForTests(
  overrides: Partial<PasswordChangeCredentialStateDependencies> | null,
): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('password change dependency overrides are test-only');
  }
  testDependencyOverrides = overrides;
}

function recordBestEffortFailure(
  operation: 'local_tenant_credential_cleanup' | 'demo_registry_state_sync',
  context: { branch: PasswordChangeCredentialBranch; tenantId: string; userId: string },
  error: unknown,
  warn: PasswordChangeCredentialStateDependencies['warn'],
): void {
  warn('[auth] password change derived credential state sync failed', {
    event: 'password_change_derived_credential_state_sync_failed',
    operation,
    branch: context.branch,
    tenantId: context.tenantId,
    userId: context.userId,
    errorType: error instanceof Error ? error.name : 'UnknownError',
  });
}

/**
 * Credential state is derived operational metadata, not part of the password
 * transaction. Once the authentication store accepted a new password, a JSON
 * registry failure must not turn that successful change into an ambiguous 500.
 */
export function syncPasswordChangeCredentialStateBestEffort(
  email: string,
  context: { branch: PasswordChangeCredentialBranch; tenantId: string; userId: string },
  dependencyOverrides: Partial<PasswordChangeCredentialStateDependencies> = {},
): boolean {
  const dependencies = {
    ...defaultDependencies,
    ...(testDependencyOverrides ?? {}),
    ...dependencyOverrides,
  };
  let synchronized = true;

  if (context.branch === 'local') {
    try {
      dependencies.clearLocalTenantCredential(context.tenantId, email);
    } catch (error) {
      synchronized = false;
      recordBestEffortFailure('local_tenant_credential_cleanup', context, error, dependencies.warn);
    }
  }

  try {
    const registryEntry = Object.values(dependencies.readRegistry()).find(entry => (
      entry.userId === context.userId || entry.email === email.trim().toLowerCase()
    ));
    if (registryEntry) {
      dependencies.writeRegistry(registryEntry.email, { credentialState: 'active_hash_only' });
    }
  } catch (error) {
    synchronized = false;
    recordBestEffortFailure('demo_registry_state_sync', context, error, dependencies.warn);
  }

  return synchronized;
}
