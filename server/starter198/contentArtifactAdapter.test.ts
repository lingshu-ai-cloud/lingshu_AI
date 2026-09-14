import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { contentProjectLineageFields } from '../digitalEmployees/contentProjectLineage.js';
import {
  prepareStarterContentProductionAdapter,
  prepareStarterContentProductionHandler,
  prepareStarterContentQualityAdapter,
  StarterContentArtifactAdapterError,
  type StarterContentFrozenBinding,
} from './contentArtifactAdapter.js';
import { stableHash } from './orchestratorWorkerValues.js';

type Row = { id: string } & Record<string, unknown>;

const tenantId = 'starter-content-adapter-tenant';
const runId = 'starter-content-adapter-run';
const productionTask: Row = {
  id: 'starter-content-production-task', tenant_id: tenantId, run_id: runId,
  task_key: 'starter_content_production', status: 'pending', task_version: 1, correction_version: 0,
};
const qualityTask: Row = {
  id: 'starter-content-quality-task', tenant_id: tenantId, run_id: runId,
  task_key: 'starter_content_quality_gate', status: 'pending', task_version: 1, correction_version: 0,
};
const frozen: StarterContentFrozenBinding = {
  initializationId: 'initialization-content-v1',
  inputVersion: '1'.repeat(64),
  factsVersion: 'facts-content-v1',
  policyVersion: 'policy-content-v1',
  entitlementSnapshotId: 'entitlement-content-v1',
  snapshotHash: '2'.repeat(64),
};

interface MemoryStore extends DataStore {
  rows: Map<string, Row[]>;
  writes: number;
  queries: Array<{ collection: string; query: ListQuery }>;
}

function memoryStore(seed: Record<string, Row[]>): MemoryStore {
  const rows = new Map(Object.entries(seed).map(([key, value]) => [key, structuredClone(value)]));
  const result: MemoryStore = {
    rows,
    writes: 0,
    queries: [],
    async getById(collection, id) {
      return structuredClone(rows.get(collection)?.find(row => row.id === id) ?? null) as never;
    },
    async list(collection: string, query: ListQuery = {}) {
      result.queries.push({ collection, query: structuredClone(query) });
      let selected = (rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {})
        .every(([key, value]) => String(row[key] ?? '') === String(value)));
      if (query.sort) {
        const descending = query.sort.startsWith('-');
        const key = descending ? query.sort.slice(1) : query.sort;
        selected = [...selected].sort((left, right) => {
          const compared = String(left[key] ?? '').localeCompare(String(right[key] ?? ''));
          return descending ? -compared : compared;
        });
      }
      const page = query.page ?? 1;
      const perPage = query.perPage ?? 20;
      return {
        items: structuredClone(selected.slice((page - 1) * perPage, page * perPage)) as never[],
        totalItems: selected.length,
        totalPages: Math.ceil(selected.length / perPage),
        page,
        perPage,
      };
    },
    async create() { result.writes += 1; return null; },
    async update() { result.writes += 1; return false; },
    async delete() { result.writes += 1; return false; },
  };
  return result;
}

function qualityChecks(): Record<string, true> {
  return Object.fromEntries([
    'renderedFile', 'visualContent', 'groundedScript', 'materialBound', 'voiceAndSubtitles',
    'semanticAlignment', 'routeDifferentiation', 'internalMarkerFree', 'subtitleSafe',
    'platformBriefApplied', 'sceneDiversity',
  ].map(key => [key, true] as const));
}

function canonicalProject(input: { id?: string; file: string; bytes: number; taskId?: string }): Row {
  const script = '[0-5s]\n画面：真实产品\n口播：See the verified product.';
  const snapshotBusinessValue = {
    productId: 'product-verified',
    assets: [{ id: 'owned-asset', authorization: { status: 'owned', evidence: 'tenant upload' } }],
    reference: undefined,
  };
  const evidenceHash = stableHash(snapshotBusinessValue);
  const spec = {
    workflowRunId: runId,
    workflowTaskId: input.taskId ?? productionTask.id,
    workflowTaskKey: 'content_production',
    source: 'tenant_production',
    script,
    caption: 'Verified product content',
    platform: 'tiktok',
    evidenceSnapshot: {
      schemaVersion: 3,
      capturedAt: '2026-09-12T03:50:00.000Z',
      product: { id: snapshotBusinessValue.productId, facts: 'frozen enterprise facts' },
      assets: snapshotBusinessValue.assets,
      reference: snapshotBusinessValue.reference,
      hash: evidenceHash,
    },
    automation: {
      schemaVersion: 3,
      managedBy: 'digital_employee',
      stage: 'completed',
      status: 'ready_for_approval',
      contentVersion: 2,
      contentHash: stableHash(script),
      evidenceSnapshotHash: evidenceHash,
      renderOutputPath: input.file,
      renderedAt: '2026-09-12T03:58:00.000Z',
      completedAt: '2026-09-12T03:59:00.000Z',
      quality: {
        passed: true,
        ruleVersion: 9,
        outputBytes: input.bytes,
        checks: qualityChecks(),
      },
    },
  };
  return {
    id: input.id ?? 'content-project-current',
    tenant_id: tenantId,
    title: 'Verified content',
    status: 'ready_for_approval',
    spec,
    ...contentProjectLineageFields({ tenantId, spec }),
  };
}

const root = await mkdtemp(path.join(tmpdir(), 'starter-content-adapter-'));
try {
  const tenantRoot = path.join(root, tenantId);
  await mkdir(tenantRoot);
  const assetPath = path.join(tenantRoot, 'verified-current.mp4');
  const bytes = Buffer.from('real persisted video bytes for adapter verification');
  await writeFile(assetPath, bytes);
  const project = canonicalProject({ file: assetPath, bytes: bytes.length });
  const dataStore = memoryStore({ studio_projects: [project] });

  const production = await prepareStarterContentProductionAdapter({
    dataStore, publishingRoot: root, tenantId, runId, task: productionTask,
    maximumArtifacts: 2, frozen,
  });
  assert.equal(production.status, 'succeeded');
  assert.equal(production.output.schemaVersion, 'starter-198.content-production-adapter-output.v1');
  assert.equal(production.output.providerCalls, 0);
  assert.equal(production.output.externalEffectsPerformed, false);
  assert.equal(production.output.observedArtifactCount, 1);
  assert.equal(dataStore.writes, 0, 'the adapter is strictly read-only');
  assert.deepEqual(dataStore.queries[0], {
    collection: 'studio_projects',
    query: {
      where: {
        tenant_id: tenantId,
        workflow_run_id: runId,
        workflow_task_id: productionTask.id,
      },
      sort: 'id', page: 1, perPage: 21,
    },
  }, 'the adapter must use the composite workflow index instead of scanning a tenant');

  const settledProduction = { ...productionTask, status: 'succeeded', output: production.output };
  const quality = await prepareStarterContentQualityAdapter({
    dataStore, publishingRoot: root, tenantId, runId, qualityTask,
    productionTask: settledProduction, maximumArtifacts: 2, frozen,
  });
  assert.equal(quality.status, 'succeeded');
  assert.equal(quality.output.schemaVersion, 'starter-198.content-quality-output.v1');
  assert.equal(quality.output.qualityPassed, true);
  assert.equal(quality.output.tenantId, tenantId);
  assert.equal(quality.output.qualityTaskId, qualityTask.id);
  assert.equal((quality.output.canonicalContent as Record<string, unknown>).id, project.id);
  assert.equal((quality.output.canonicalContent as Record<string, unknown>).version, '2');
  assert.equal((quality.output.canonicalContent as Record<string, unknown>).fileName, path.basename(assetPath));
  assert.equal((quality.output.canonicalContent as Record<string, unknown>).fileHash,
    createHash('sha256').update(bytes).digest('hex'));
  assert.match(String(quality.output.bindingHash), /^[a-f0-9]{64}$/);
  assert.equal(quality.output.providerCalls, 0);
  assert.equal(dataStore.writes, 0);

  await writeFile(assetPath, Buffer.from('changed after production checkpoint'));
  const changed = await prepareStarterContentQualityAdapter({
    dataStore, publishingRoot: root, tenantId, runId, qualityTask,
    productionTask: settledProduction, maximumArtifacts: 2, frozen,
  });
  assert.equal(changed.status, 'waiting_external');
  assert.equal(changed.output.reasonCode, 'tenant_content_artifact_changed_after_production');
  await writeFile(assetPath, bytes);

  const wrongTask = memoryStore({
    studio_projects: [canonicalProject({ file: assetPath, bytes: bytes.length, taskId: 'another-task' })],
  });
  const unbound = await prepareStarterContentProductionAdapter({
    dataStore: wrongTask, publishingRoot: root, tenantId, runId, task: productionTask,
    maximumArtifacts: 2, frozen,
  });
  assert.equal(unbound.status, 'waiting_external');
  assert.equal(unbound.output.reasonCode, 'tenant_content_pipeline_not_connected');

  const historicalUnindexed = canonicalProject({ file: assetPath, bytes: bytes.length });
  delete historicalUnindexed.workflow_run_id;
  delete historicalUnindexed.workflow_task_id;
  delete historicalUnindexed.workflow_task_key;
  delete historicalUnindexed.workflow_lineage_hash;
  const manyUnrelated = Array.from({ length: 5_100 }, (_, index) => ({
    ...historicalUnindexed,
    id: `historical-unindexed-${index}`,
  }));
  const unindexedStore = memoryStore({ studio_projects: manyUnrelated });
  const unindexed = await prepareStarterContentProductionAdapter({
    dataStore: unindexedStore, publishingRoot: root, tenantId, runId,
    task: productionTask, maximumArtifacts: 2, frozen,
  });
  assert.equal(unindexed.status, 'waiting_external');
  assert.equal(unindexed.output.reasonCode, 'tenant_content_pipeline_not_connected');
  assert.equal(unindexedStore.queries.length, 1, 'historical rows must not trigger a fallback wide scan');

  const noArtifact = await prepareStarterContentProductionAdapter({
    dataStore: memoryStore({ studio_projects: [] }), publishingRoot: root,
    tenantId, runId, task: productionTask, maximumArtifacts: 2, frozen,
  });
  assert.equal(noArtifact.status, 'waiting_external');
  assert.equal(noArtifact.output.reasonCode, 'tenant_content_pipeline_not_connected');

  const handlerWait = await prepareStarterContentProductionHandler({
    dataStore: memoryStore({ studio_projects: [] }),
    repository: {} as never,
    tenantId,
    run: { id: runId },
    task: productionTask,
    frozen: { ...frozen, maximumContentArtifacts: 2 },
  });
  assert.deepEqual({
    runId: handlerWait.output.runId,
    taskId: handlerWait.output.taskId,
    taskKey: handlerWait.output.taskKey,
  }, {
    runId,
    taskId: productionTask.id,
    taskKey: productionTask.task_key,
  }, 'recoverable waits carry exact task identity for the event wakeup allowlist');

  const obsolete = canonicalProject({ file: assetPath, bytes: bytes.length });
  ((obsolete.spec as Record<string, unknown>).automation as Record<string, unknown>).quality = {
    passed: true, ruleVersion: 8, outputBytes: bytes.length, checks: qualityChecks(),
  };
  const oldQuality = await prepareStarterContentProductionAdapter({
    dataStore: memoryStore({ studio_projects: [obsolete] }), publishingRoot: root,
    tenantId, runId, task: productionTask, maximumArtifacts: 2, frozen,
  });
  assert.equal(oldQuality.status, 'waiting_external');
  assert.equal(oldQuality.output.reasonCode, 'tenant_content_artifact_not_ready');

  const forgedHash = canonicalProject({ file: assetPath, bytes: bytes.length });
  ((forgedHash.spec as Record<string, unknown>).automation as Record<string, unknown>).contentHash = 'f'.repeat(64);
  const invalidEvidence = await prepareStarterContentProductionAdapter({
    dataStore: memoryStore({ studio_projects: [forgedHash] }), publishingRoot: root,
    tenantId, runId, task: productionTask, maximumArtifacts: 2, frozen,
  });
  assert.equal(invalidEvidence.status, 'waiting_external');
  assert.equal(invalidEvidence.output.reasonCode, 'tenant_content_artifact_not_verifiable');

  const ambiguous = await prepareStarterContentProductionAdapter({
    dataStore: memoryStore({ studio_projects: [
      project,
      canonicalProject({ id: 'content-project-other', file: assetPath, bytes: bytes.length }),
    ] }),
    publishingRoot: root, tenantId, runId, task: productionTask,
    maximumArtifacts: 2, frozen,
  });
  assert.equal(ambiguous.status, 'waiting_external');
  assert.equal(ambiguous.output.reasonCode, 'tenant_content_canonical_subject_ambiguous');

  const tenantViolationStore = memoryStore({ studio_projects: [project] });
  const foreignProject: Row = { ...project, tenant_id: 'other-tenant' };
  Object.assign(foreignProject, contentProjectLineageFields({
    tenantId: 'other-tenant', spec: foreignProject.spec,
  }));
  tenantViolationStore.list = async (_collection, query = {}) => ({
    items: [foreignProject] as never[],
    totalItems: 1, totalPages: 1, page: query.page ?? 1, perPage: query.perPage ?? 20,
  });
  await assert.rejects(
    () => prepareStarterContentProductionAdapter({
      dataStore: tenantViolationStore, publishingRoot: root, tenantId, runId,
      task: productionTask, maximumArtifacts: 2, frozen,
    }),
    (error: unknown) => error instanceof StarterContentArtifactAdapterError
      && error.code === 'starter_content_source_tenant_or_identity_violation',
    'a datastore that violates the tenant filter fails closed',
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

const adapterSource = await readFile(fileURLToPath(new URL('./contentArtifactAdapter.ts', import.meta.url)), 'utf8');
assert.doesNotMatch(adapterSource, /from ['"]\.\.\/integrations\//,
  'the read adapter cannot import an external provider');
assert.doesNotMatch(adapterSource, /from ['"]\.\.\/digitalEmployees\/contentProduction/,
  'the starter worker cannot accidentally execute the legacy producer');
assert.doesNotMatch(adapterSource, /\b(?:fetch|sendMessage|publishPost)\s*\(/,
  'the adapter has no network, messaging, or publication call site');
assert.doesNotMatch(adapterSource, /where:\s*\{\s*tenant_id:\s*tenantId\s*\}/,
  'the adapter must not retain a tenant-wide fallback query');
const productionSource = await readFile(fileURLToPath(new URL('../digitalEmployees/contentProduction.ts', import.meta.url)), 'utf8');
assert.match(productionSource, /contentProjectLineageFields\(\{ tenantId: input\.tenantId, spec \}\)/,
  'trusted project creation must persist indexed lineage beside the spec');
assert.match(productionSource, /notifyStarterReviewableContentProjects/,
  'the trusted production loop must invoke the internal starter wakeup hook');
const studioSource = await readFile(fileURLToPath(new URL('../routes/studio.ts', import.meta.url)), 'utf8');
assert.match(studioSource, /if \(automation\.managedBy === 'digital_employee'\)/,
  'customer create and update requests must reject an attempted managed project identity');
assert.doesNotMatch(studioSource, /if \(!id && spec\?\.automation\?\.managedBy === 'digital_employee'\)/,
  'an update cannot turn a normal project into a client-forged managed project');
const migrationSource = await readFile(fileURLToPath(new URL('../../pb_migrations/1789862401_bind_starter_content_workflow_lineage.js', import.meta.url)), 'utf8');
for (const field of ['workflow_run_id', 'workflow_task_id', 'workflow_task_key', 'workflow_lineage_hash']) {
  assert.match(migrationSource, new RegExp(`"${field}"`), `migration must add ${field}`);
}
assert.match(migrationSource, /tenant_id, workflow_run_id, workflow_task_id, status/,
  'migration must add the composite adapter lookup index');

console.log('starter content artifact adapter passed: exact lineage, current hashes, quality receipts, read-only waits and tenant fail-closed');
