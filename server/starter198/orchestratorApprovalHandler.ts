import { createHash } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import {
  bridgeStarterContentReleaseApproval,
  StarterContentApprovalBridgeError,
} from './contentApprovalBridge.js';
import { Starter198OrchestratorWorkerError } from './orchestratorLease.js';
import type { Starter198Repository } from './repository.js';

/** Keep the canonical approval adapter outside the already-dense scheduler. */
export async function executeStarterContentApprovalBridge(input: {
  dataStore: DataStore;
  repository: Starter198Repository;
  tenantId: string;
  runId: string;
  approvalTaskId: string;
  leaseToken: string;
  assertLease: () => Promise<void>;
  now: () => Date;
  publishingRoot?: string;
}): Promise<void> {
  try {
    await bridgeStarterContentReleaseApproval({
      tenantId: input.tenantId,
      runId: input.runId,
      approvalTaskId: input.approvalTaskId,
      dependencies: {
        dataStore: input.dataStore,
        repository: input.repository,
        now: input.now,
        executionFence: createHash('sha256').update(input.leaseToken).digest('hex').slice(0, 24),
        assertExecutionFence: input.assertLease,
        ...(input.publishingRoot ? { publishingRoot: input.publishingRoot } : {}),
      },
    });
  } catch (error) {
    if (error instanceof StarterContentApprovalBridgeError) {
      throw new Starter198OrchestratorWorkerError(error.code, error.retryable);
    }
    throw error;
  }
}
