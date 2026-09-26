/**
 * One-shot worker used by the release harness. It deliberately crosses the
 * same PocketBase HTTP boundary as production and uses the production durable
 * lease plus production-gap worker. The only fake is the external provider,
 * which is supplied as an HTTP URL by the harness.
 */
import { randomUUID } from 'node:crypto';
import { runProductionGapWorker } from '../server/socialDiscovery/productionGapWorker.js';
import {
  DISCOVERY_GAP_TASK_COLLECTION,
  type InventoryCandidate,
  type ProductionGapTask,
} from '../server/socialDiscovery/orchestration.js';
import { acquireDurableOperationLease, releaseDurableOperationLease } from '../server/runtime/durableLease.js';
import { markBackgroundJobsReady, markBackgroundJobsStarting, writeWorkerHeartbeat } from '../server/runtime/workerHeartbeat.js';
import { store } from '../server/storage/index.js';

const tenantId = String(process.env.RELEASE_TENANT_ID || '').trim();
const gapTaskId = String(process.env.RELEASE_GAP_TASK_ID || '').trim();
const providerUrl = String(process.env.RELEASE_PROVIDER_URL || '').replace(/\/$/, '');
const ownerId = String(process.env.RELEASE_WORKER_ID || `release-worker-${process.pid}-${randomUUID()}`);
if (!tenantId || !gapTaskId || !providerUrl) throw new Error('release_worker_configuration_missing');

async function providerRequest(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(`${providerUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`mock_provider_${response.status}`);
  return await response.json() as Record<string, unknown>;
}

markBackgroundJobsStarting();
markBackgroundJobsReady();
await writeWorkerHeartbeat('worker');

const result = await store.list<ProductionGapTask & { id: string }>(DISCOVERY_GAP_TASK_COLLECTION, {
  where: { tenant_id: tenantId, gapTaskId }, page: 1, perPage: 1,
});
const row = result.items[0];
if (!row) throw new Error('release_gap_task_not_found');
const task: ProductionGapTask = {
  gapTaskId: row.gapTaskId,
  tenantId: row.tenantId || tenantId,
  upstreamTaskRef: row.upstreamTaskRef,
  productionGap: row.productionGap,
  status: row.status,
  budgetLimitCny: Number(row.budgetLimitCny),
  spentCny: Number(row.spentCny),
  runRefs: Array.isArray(row.runRefs) ? row.runRefs : [],
  selectedEvidenceRefs: Array.isArray(row.selectedEvidenceRefs) ? row.selectedEvidenceRefs : [],
  stopReason: row.stopReason || null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
};

const lease = await acquireDurableOperationLease({
  dataStore: store,
  tenantId,
  scope: 'social-operating-gap',
  subjectId: gapTaskId,
  ownerId,
  leaseDurationMs: 60_000,
  reclaimGraceMs: 5_000,
});
if (!lease) {
  console.log(JSON.stringify({ status: 'busy', gapTaskId, ownerId }));
  process.exit(0);
}

try {
  const updated = await runProductionGapWorker(task, {
    async loadInventory(): Promise<InventoryCandidate[]> {
      const payload = await providerRequest(`/inventory?tenantId=${encodeURIComponent(tenantId)}&gapTaskId=${encodeURIComponent(gapTaskId)}`);
      return Array.isArray(payload.items) ? payload.items as InventoryCandidate[] : [];
    },
    async resumeUpstreamTask() {
      // The release harness asserts the persisted task state. No separate
      // upstream domain implementation is introduced by this R7 worker.
    },
    executeRun: async () => {
      const payload = await providerRequest('/discover', {
        method: 'POST',
        body: JSON.stringify({ tenantId, gapTaskId, idempotencyKey: `${tenantId}:${gapTaskId}` }),
      });
      const costCny = payload.costCny === null ? null : Number(payload.costCny || 0);
      return {
        run: {
          runId: String(payload.receiptId || ''),
          modeStats: {
            momentum: { costCny },
            account: { costCny: 0 },
            innovation: { costCny: 0 },
          },
        },
      } as Awaited<ReturnType<NonNullable<Parameters<typeof runProductionGapWorker>[1]['executeRun']>>>;
    },
  });
  console.log(JSON.stringify({ status: updated.status, gapTaskId, spentCny: updated.spentCny }));
} finally {
  await releaseDurableOperationLease({ dataStore: store, lease });
}
