import type { StarterPublicationPackage } from '../publishing/starterPublicationPackage.js';
import type { DataStore } from '../storage/datastore.js';
import {
  notifyStarterPublicationEvidenceChanged,
  type StarterPublicationEvidenceProjectionResult,
} from './publicationEvidenceProjection.js';
import type { Starter198Repository } from './repository.js';

export type StarterPublicationEvidenceProjector = (input: {
  dataStore: DataStore;
  repository?: Starter198Repository;
  tenantId: string;
  runId: string;
  packageId: string;
  now?: () => Date;
}) => Promise<StarterPublicationEvidenceProjectionResult>;

/**
 * Best-effort wake after the evidence mutation is already durable. Projection
 * failure must never be reported as a failed user submission; replaying the
 * command safely retries this hook. The projection performs the authoritative
 * run/approval/task/package binding checks under the shared run lease.
 */
export async function retryStarterPublicationEvidenceProjection(input: {
  dataStore: DataStore;
  repository: Starter198Repository;
  tenantId: string;
  packageId: string;
  readPublicationPackage: (tenantId: string, packageId: string) => Promise<StarterPublicationPackage | null>;
  projector?: StarterPublicationEvidenceProjector;
  now?: Date;
}): Promise<void> {
  try {
    const publication = await input.readPublicationPackage(input.tenantId, input.packageId);
    const binding = publication?.workflowBinding;
    if (!publication || publication.tenantId !== input.tenantId
      || publication.packageId !== input.packageId
      || binding?.schemaVersion !== 'starter-198.publication-workflow-binding.v1'
      || !binding.runId) return;
    await (input.projector ?? notifyStarterPublicationEvidenceChanged)({
      dataStore: input.dataStore,
      repository: input.repository,
      tenantId: input.tenantId,
      runId: binding.runId,
      packageId: input.packageId,
      ...(input.now ? { now: () => input.now! } : {}),
    });
  } catch {
    // Submission is already persisted. A later idempotent command replay or
    // trusted verifier event retries projection without rewriting evidence.
  }
}
