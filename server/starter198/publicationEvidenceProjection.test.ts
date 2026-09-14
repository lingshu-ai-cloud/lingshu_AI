import assert from 'node:assert/strict';
import {
  STARTER_198_PROFILE_VERSION,
  STARTER_198_CAPABILITIES,
} from '../../shared/contracts/starter198.js';
import {
  createStarterPublicationPackage,
  submitStarterPublicationEvidence,
  verifyStarterPublicationEvidence,
} from '../publishing/starterPublicationPackage.js';
import { DURABLE_OPERATION_LEASE_COLLECTION } from '../runtime/durableLease.js';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import {
  notifyStarterPublicationEvidenceChanged,
  StarterPublicationEvidenceProjectionError,
  verifiedStarterPublicationEvidenceOutput,
} from './publicationEvidenceProjection.js';
import { retryStarterPublicationEvidenceProjection } from './publicationEvidenceCommandProjection.js';
import {
  createStarter198Repository,
  STARTER_COLLECTIONS,
  type Starter198Repository,
} from './repository.js';
import { stableHash } from './orchestratorWorkerValues.js';
import { prepareStarterResultSummaryHandler } from './resultSummary.js';
import { starterContentSubjectHash } from './publicationPackageArtifact.js';
import { STARTER_198_STANDARD_TASK_KEYS } from './workflowScope.js';

type Row = { id: string } & Record<string, unknown>;
const NOW = new Date('2026-09-13T08:00:00.000Z');
const TENANT = 'publication-projection-tenant';
const RUN = 'publication-projection-run';

function memoryStore(): DataStore & { rows: Map<string, Row[]>; writes: Array<{ collection: string; id: string }> } {
  const rows = new Map<string, Row[]>();
  const writes: Array<{ collection: string; id: string }> = [];
  let serial = 0;
  const bucket = (collection: string) => {
    const current = rows.get(collection) ?? [];
    rows.set(collection, current);
    return current;
  };
  return {
    rows,
    writes,
    async getById(collection, id) {
      return structuredClone(bucket(collection).find(row => row.id === id) ?? null) as never;
    },
    async list(collection: string, query: ListQuery = {}) {
      let selected = bucket(collection).filter(row => Object.entries(query.where ?? {})
        .every(([key, value]) => String(row[key] ?? '') === String(value)));
      if (query.sort) {
        const keys = query.sort.split(',');
        selected = [...selected].sort((left, right) => {
          for (const raw of keys) {
            const descending = raw.startsWith('-');
            const key = descending ? raw.slice(1) : raw;
            const compared = String(left[key] ?? '').localeCompare(String(right[key] ?? ''), undefined, { numeric: true });
            if (compared) return descending ? -compared : compared;
          }
          return 0;
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
    async create(collection, data) {
      const target = bucket(collection);
      const duplicate = collection === DURABLE_OPERATION_LEASE_COLLECTION
        ? target.some(row => row.tenant_id === data.tenant_id
          && row.lease_scope === data.lease_scope && row.subject_id === data.subject_id)
        : collection === STARTER_COLLECTIONS.publicationPackages
          ? target.some(row => row.tenant_id === data.tenant_id
            && (row.package_id === data.package_id || row.idempotency_key === data.idempotency_key))
          : false;
      if (duplicate) return null;
      const row = { id: `row-${++serial}`, ...structuredClone(data) } as Row;
      target.push(row);
      writes.push({ collection, id: row.id });
      return structuredClone(row) as never;
    },
    async update(collection, id, patch) {
      const row = bucket(collection).find(candidate => candidate.id === id);
      if (!row) return false;
      Object.assign(row, structuredClone(patch));
      writes.push({ collection, id });
      return true;
    },
    async delete(collection, id) {
      const target = bucket(collection);
      const index = target.findIndex(row => row.id === id);
      if (index < 0) return false;
      target.splice(index, 1);
      writes.push({ collection, id });
      return true;
    },
  };
}

const taskContracts: Record<string, { role: string; domain: string; capability: string; mode: string; effect: string; depends: string[] }> = {
  starter_context_snapshot: { role: 'orchestrator', domain: 'foundation', capability: 'workflow.standard.run', mode: 'internal', effect: 'none', depends: [] },
  starter_content_research: { role: 'content', domain: 'content', capability: 'production_site.read', mode: 'observe', effect: 'none', depends: ['starter_context_snapshot'] },
  starter_content_production: { role: 'content', domain: 'content', capability: 'workflow.standard.run', mode: 'draft_executor', effect: 'draft', depends: ['starter_content_research'] },
  starter_content_quality_gate: { role: 'content', domain: 'content', capability: 'workflow.standard.run', mode: 'observe', effect: 'none', depends: ['starter_content_production'] },
  starter_content_release_approval: { role: 'content', domain: 'content', capability: 'orchestrator.decision.resolve', mode: 'approval', effect: 'none', depends: ['starter_content_quality_gate'] },
  starter_publication_package: { role: 'traffic', domain: 'publishing', capability: 'publishing.package.generate', mode: 'internal', effect: 'draft', depends: ['starter_content_release_approval'] },
  starter_publication_evidence: { role: 'traffic', domain: 'publishing', capability: 'publishing.evidence.submit', mode: 'observe', effect: 'none', depends: ['starter_publication_package'] },
  starter_inquiry_intake: { role: 'sales', domain: 'customer', capability: 'quotation.calculate', mode: 'observe', effect: 'none', depends: ['starter_context_snapshot'] },
  starter_quote_draft: { role: 'sales', domain: 'customer', capability: 'quotation.calculate', mode: 'internal', effect: 'draft', depends: ['starter_inquiry_intake'] },
  starter_result_summary: { role: 'orchestrator', domain: 'foundation', capability: 'workflow.standard.run', mode: 'internal', effect: 'none', depends: ['starter_publication_evidence', 'starter_quote_draft'] },
};

async function fixture(runStatus = 'waiting_human', bindingRunId: string | null = RUN) {
  const dataStore = memoryStore();
  dataStore.rows.set(STARTER_COLLECTIONS.runs, [{
    id: RUN, tenant_id: TENANT, product_profile: 'starter_198', status: runStatus,
    current_controller: 'human', pause_reason: '灵小量已生成发布包；等待用户自行发布并回填公开 URL 或平台帖子 ID。',
  }]);
  dataStore.rows.set(STARTER_COLLECTIONS.tasks, STARTER_198_STANDARD_TASK_KEYS.map((key, index) => {
    const contract = taskContracts[key];
    return {
      id: `task-${index + 1}`, tenant_id: TENANT, run_id: RUN, task_key: key,
      sequence: index + 1, status: index < 6 ? 'succeeded' : key === 'starter_publication_evidence' ? 'pending' : 'pending',
      policy_source: STARTER_198_PROFILE_VERSION, agent_role: contract.role,
      business_domain: contract.domain, capability_key: contract.capability,
      execution_mode: contract.mode, external_effect: contract.effect,
      automatic_execution_allowed: key !== 'starter_content_release_approval',
      depends_on: contract.depends, output: {},
    };
  }));
  dataStore.rows.set(STARTER_COLLECTIONS.approvals, []);
  dataStore.rows.set(DURABLE_OPERATION_LEASE_COLLECTION, []);
  dataStore.rows.set(STARTER_COLLECTIONS.access, [{
    id: 'access', tenant_id: TENANT, product_profile: 'starter_198', profile_version: STARTER_198_PROFILE_VERSION,
    entitlement_snapshot_id: 'snapshot', feature_entitlements: STARTER_198_CAPABILITIES.map(capability => ({ capability, enabled: true })),
    resource_limits: {}, status: 'active', cycle_started_at: '2026-09-01T00:00:00.000Z',
    cycle_ends_at: '2026-10-01T00:00:00.000Z', updated_at: NOW.toISOString(),
  }]);
  const copy = { title: 'Verified title', body: 'Verified body', hashtags: ['B2B'] };
  const subjectCore = {
    type: 'starter_content_subject' as const,
    schemaVersion: 'starter-198.content-subject.v1' as const,
    tenantId: TENANT, runId: RUN, contentId: 'content-one', contentVersion: '3',
    sourceContentHash: 'a'.repeat(64), platform: 'tiktok' as const, copy,
    assets: [{ kind: 'video' as const, fileName: 'verified.mp4', contentHash: 'b'.repeat(64) }],
  };
  const subject = { ...subjectCore, contentHash: starterContentSubjectHash(subjectCore) };
  const created = await createStarterPublicationPackage({
    tenantId: TENANT, contentId: subject.contentId, contentVersion: subject.contentVersion,
    contentHash: subject.contentHash, platform: subject.platform, copy,
    assets: [{ ...subject.assets[0], downloadUrl: '/api/overseas/verified.mp4' }],
    ...(bindingRunId ? { workflowBinding: {
      schemaVersion: 'starter-198.publication-workflow-binding.v1', runId: bindingRunId,
      approvalId: 'approved-content', approvalTaskId: 'task-5', agentTaskId: 'agent-package-task',
    } } : {}),
    idempotencyKey: 'publication-projection-package', now: NOW,
  }, dataStore);
  const packageTask = dataStore.rows.get(STARTER_COLLECTIONS.tasks)!.find(row => row.task_key === 'starter_publication_package')!;
  packageTask.output = {
    schemaVersion: 'starter-198.publication-package-output.v1',
    packageId: created.package.packageId, packageHash: created.package.packageHash,
    contentId: created.package.contentId, contentVersion: created.package.contentVersion,
    status: created.package.status, externalPublishPerformed: false,
  };
  const evidenceTask = dataStore.rows.get(STARTER_COLLECTIONS.tasks)!
    .find(row => row.task_key === 'starter_publication_evidence')!;
  evidenceTask.status = 'waiting_external';
  evidenceTask.output = {
    schemaVersion: 'starter-198.publication-evidence-wait.v1',
    packageId: created.package.packageId, contentHash: created.package.contentHash,
    evidenceVerified: false, externalPublishPerformed: false,
  };
  const approvalTask = dataStore.rows.get(STARTER_COLLECTIONS.tasks)!
    .find(row => row.task_key === 'starter_content_release_approval')!;
  approvalTask.output = {
    decision: 'approved', note: '', approvedAt: NOW.toISOString(), publicationPackageTaskId: 'agent-package-task',
    publicationState: 'package_generation_queued', externalPublishPerformed: false,
  };
  dataStore.rows.set(STARTER_COLLECTIONS.approvals, [{
    id: 'approved-content', tenant_id: TENANT, run_id: RUN, task_id: approvalTask.id,
    status: 'approved', content_hash: subject.contentHash, evidence: [subject], subject_version: 1,
    decided_at: NOW.toISOString(), decided_by: 'approver-user',
  }]);
  const repository = createStarter198Repository(dataStore);
  return { dataStore, repository, publication: created.package };
}

const pending = await fixture();
const notSubmitted = await notifyStarterPublicationEvidenceChanged({
  dataStore: pending.dataStore, repository: pending.repository,
  tenantId: TENANT, runId: RUN, packageId: pending.publication.packageId, now: () => NOW,
});
assert.equal(notSubmitted.state, 'waiting', notSubmitted.reason);
let evidenceTask = pending.dataStore.rows.get(STARTER_COLLECTIONS.tasks)!.find(row => row.task_key === 'starter_publication_evidence')!;
assert.equal(evidenceTask.status, 'waiting_external');
assert.equal((evidenceTask.output as Row).verificationStatus, 'not_submitted');

await submitStarterPublicationEvidence({
  tenantId: TENANT, packageId: pending.publication.packageId, contentHash: pending.publication.contentHash,
  publicUrl: 'https://www.tiktok.com/@factory/video/123456', platformPostId: '123456',
  submittedBy: 'user-private-id', now: new Date('2026-09-13T08:05:00.000Z'),
}, pending.dataStore);
const submitted = await notifyStarterPublicationEvidenceChanged({
  dataStore: pending.dataStore, repository: pending.repository,
  tenantId: TENANT, runId: RUN, packageId: pending.publication.packageId, now: () => NOW,
});
assert.equal(submitted.state, 'waiting');
assert.equal((evidenceTask.output as Row).verificationStatus, 'pending');
assert.equal(pending.dataStore.rows.get(STARTER_COLLECTIONS.runs)![0].status, 'waiting_external');
assert.doesNotMatch(JSON.stringify(evidenceTask.output), /user-private-id|@factory|123456/,
  'workflow projection excludes submitter, URL and platform post id');

await verifyStarterPublicationEvidence({
  tenantId: TENANT, packageId: pending.publication.packageId, verifier: 'platform_receipt',
  publiclyObservable: false, observedContentHash: pending.publication.contentHash,
  rejectionReason: 'publication_not_observable', sourceReceiptHash: '5'.repeat(64),
  verifierIdentity: 'trusted-platform-verifier-v1', now: new Date('2026-09-13T08:10:00.000Z'),
}, pending.dataStore);
const rejected = await notifyStarterPublicationEvidenceChanged({
  dataStore: pending.dataStore, repository: pending.repository,
  tenantId: TENANT, runId: RUN, packageId: pending.publication.packageId, now: () => NOW,
});
assert.equal(rejected.state, 'waiting');
assert.equal(evidenceTask.status, 'waiting_external');
assert.equal((evidenceTask.output as Row).verificationStatus, 'rejected');
assert.equal(pending.dataStore.rows.get(STARTER_COLLECTIONS.runs)![0].status, 'waiting_human');
assert.match(String(pending.dataStore.rows.get(STARTER_COLLECTIONS.runs)![0].pause_reason), /publication_not_observable/);

await submitStarterPublicationEvidence({
  tenantId: TENANT, packageId: pending.publication.packageId, contentHash: pending.publication.contentHash,
  platformPostId: 'resubmitted-post-123', submittedBy: 'user-private-id',
  now: new Date('2026-09-13T08:11:00.000Z'),
}, pending.dataStore);
const resubmitted = await notifyStarterPublicationEvidenceChanged({
  dataStore: pending.dataStore, repository: pending.repository,
  tenantId: TENANT, runId: RUN, packageId: pending.publication.packageId, now: () => NOW,
});
assert.equal(resubmitted.state, 'waiting', 'rejected evidence can be corrected and re-enter verifier wait');
assert.equal((evidenceTask.output as Row).verificationStatus, 'pending');
assert.equal(pending.dataStore.rows.get(STARTER_COLLECTIONS.runs)![0].status, 'waiting_external');
await verifyStarterPublicationEvidence({
  tenantId: TENANT, packageId: pending.publication.packageId, verifier: 'platform_receipt',
  publiclyObservable: true, observedContentHash: pending.publication.contentHash,
  sourceReceiptHash: '8'.repeat(64), verifierIdentity: 'trusted-platform-verifier-v1',
  now: new Date('2026-09-13T08:12:00.000Z'),
}, pending.dataStore);
const corrected = await notifyStarterPublicationEvidenceChanged({
  dataStore: pending.dataStore, repository: pending.repository,
  tenantId: TENANT, runId: RUN, packageId: pending.publication.packageId, now: () => NOW,
});
assert.equal(corrected.state, 'ready');
assert.equal(evidenceTask.status, 'succeeded');
assert.equal(pending.dataStore.rows.get(STARTER_COLLECTIONS.runs)![0].status, 'running');

const verifiedFixture = await fixture();
await submitStarterPublicationEvidence({
  tenantId: TENANT, packageId: verifiedFixture.publication.packageId,
  contentHash: verifiedFixture.publication.contentHash,
  platformPostId: 'verified-post-123', submittedBy: 'another-private-user', now: NOW,
}, verifiedFixture.dataStore);
await verifyStarterPublicationEvidence({
  tenantId: TENANT, packageId: verifiedFixture.publication.packageId, verifier: 'platform_receipt',
  publiclyObservable: true, observedContentHash: verifiedFixture.publication.contentHash,
  sourceReceiptHash: '6'.repeat(64), verifierIdentity: 'trusted-platform-verifier-v1',
  now: new Date('2026-09-13T08:20:00.000Z'),
}, verifiedFixture.dataStore);
const verifiedResult = await notifyStarterPublicationEvidenceChanged({
  dataStore: verifiedFixture.dataStore, repository: verifiedFixture.repository,
  tenantId: TENANT, runId: RUN, packageId: verifiedFixture.publication.packageId, now: () => NOW,
});
assert.equal(verifiedResult.state, 'ready');
evidenceTask = verifiedFixture.dataStore.rows.get(STARTER_COLLECTIONS.tasks)!.find(row => row.task_key === 'starter_publication_evidence')!;
assert.equal(evidenceTask.status, 'succeeded');
assert.ok(verifiedStarterPublicationEvidenceOutput(evidenceTask.output));
assert.equal(verifiedFixture.dataStore.rows.get(STARTER_COLLECTIONS.runs)![0].status, 'running');
const businessWrites = () => verifiedFixture.dataStore.writes.filter(write => ([
  STARTER_COLLECTIONS.runs, STARTER_COLLECTIONS.tasks,
] as string[]).includes(write.collection)).length;
const writesBeforeReplay = businessWrites();
const replay = await notifyStarterPublicationEvidenceChanged({
  dataStore: verifiedFixture.dataStore, repository: verifiedFixture.repository,
  tenantId: TENANT, runId: RUN, packageId: verifiedFixture.publication.packageId, now: () => NOW,
});
assert.equal(replay.state, 'ready');
assert.equal(businessWrites(), writesBeforeReplay, 'verified projection replay makes no business-state write');

const partialWrite = await fixture();
await submitStarterPublicationEvidence({
  tenantId: TENANT, packageId: partialWrite.publication.packageId,
  contentHash: partialWrite.publication.contentHash, platformPostId: 'partial-write-post',
  submittedBy: 'partial-write-user', now: NOW,
}, partialWrite.dataStore);
await verifyStarterPublicationEvidence({
  tenantId: TENANT, packageId: partialWrite.publication.packageId, verifier: 'platform_receipt',
  publiclyObservable: true, observedContentHash: partialWrite.publication.contentHash,
  sourceReceiptHash: '9'.repeat(64), verifierIdentity: 'trusted-platform-verifier-v1', now: NOW,
}, partialWrite.dataStore);
let failEvidenceTaskWrite = true;
const interruptedRepository: Starter198Repository = {
  ...partialWrite.repository,
  async update(collection, tenantId, id, patch) {
    if (failEvidenceTaskWrite && collection === STARTER_COLLECTIONS.tasks
      && id === 'task-7') {
      failEvidenceTaskWrite = false;
      throw new Error('simulated task write interruption');
    }
    return partialWrite.repository.update(collection, tenantId, id, patch);
  },
};
await assert.rejects(() => notifyStarterPublicationEvidenceChanged({
  dataStore: partialWrite.dataStore, repository: interruptedRepository,
  tenantId: TENANT, runId: RUN, packageId: partialWrite.publication.packageId, now: () => NOW,
}));
assert.equal(partialWrite.dataStore.rows.get(STARTER_COLLECTIONS.runs)![0].status, 'running',
  'leaving a human pause transitions the run before the non-transactional task write');
assert.equal(partialWrite.dataStore.rows.get(STARTER_COLLECTIONS.tasks)!
  .find(row => row.id === 'task-7')!.status, 'waiting_external');
assert.equal((await notifyStarterPublicationEvidenceChanged({
  dataStore: partialWrite.dataStore, repository: partialWrite.repository,
  tenantId: TENANT, runId: RUN, packageId: partialWrite.publication.packageId, now: () => NOW,
})).state, 'ready', 'idempotent replay repairs a crash between run and task writes');
assert.equal(partialWrite.dataStore.rows.get(STARTER_COLLECTIONS.tasks)!
  .find(row => row.id === 'task-7')!.status, 'succeeded');

const quoteCore = {
  schemaVersion: 'starter-198.quote-draft-adapter-output.v1', executionStatus: 'completed',
  canonicalQuote: {
    draftRef: `quote_${'c'.repeat(24)}`, inquiryId: `inq_${'d'.repeat(24)}`,
    inquiryVersion: `v_${'e'.repeat(16)}`, status: 'approved', approvalState: 'approved',
    requiresHumanApproval: false, total: { currency: 'USD', decimal: '1250.00' },
    validUntil: '2026-09-30T00:00:00.000Z', inputHash: '1'.repeat(64),
    ruleHash: '2'.repeat(64), calculationHash: '3'.repeat(64), lineageHash: '4'.repeat(64),
    exceptionCount: 0,
  },
  sourceReadOnly: true, providerCalls: 0, externalEffectsPerformed: false,
  externalMessageSent: false,
  usageObservation: { inputTokens: 0, outputTokens: 0, cacheTokens: 0, costCny: 0 },
};
const quoteTask = verifiedFixture.dataStore.rows.get(STARTER_COLLECTIONS.tasks)!
  .find(row => row.task_key === 'starter_quote_draft')!;
quoteTask.status = 'succeeded';
quoteTask.output = { ...quoteCore, outputHash: stableHash(quoteCore) };
const inquiryTask = verifiedFixture.dataStore.rows.get(STARTER_COLLECTIONS.tasks)!
  .find(row => row.task_key === 'starter_inquiry_intake')!;
inquiryTask.status = 'succeeded';
const summaryTask = verifiedFixture.dataStore.rows.get(STARTER_COLLECTIONS.tasks)!
  .find(row => row.task_key === 'starter_result_summary')!;
const summary = await prepareStarterResultSummaryHandler({
  dataStore: verifiedFixture.dataStore, repository: verifiedFixture.repository,
  tenantId: TENANT, run: verifiedFixture.dataStore.rows.get(STARTER_COLLECTIONS.runs)![0],
  task: summaryTask, now: NOW,
});
assert.equal(summary.status, 'waiting_external', 'self-hashed quote output without canonical rows never completes a run');
assert.equal(summary.blockedReason, 'result_summary_quote_canonical_changed');
const savedQuoteOutput = structuredClone(quoteTask.output) as Row;
(quoteTask.output as Row).outputHash = '0'.repeat(64);
assert.equal((await prepareStarterResultSummaryHandler({
  dataStore: verifiedFixture.dataStore, repository: verifiedFixture.repository,
  tenantId: TENANT, run: verifiedFixture.dataStore.rows.get(STARTER_COLLECTIONS.runs)![0],
  task: summaryTask, now: NOW,
})).status, 'waiting_external', 'a tampered successful dependency cannot become a successful summary');
quoteTask.output = savedQuoteOutput;
assert.equal((await prepareStarterResultSummaryHandler({
  dataStore: verifiedFixture.dataStore, repository: verifiedFixture.repository,
  tenantId: TENANT, run: verifiedFixture.dataStore.rows.get(STARTER_COLLECTIONS.runs)![0],
  task: { ...summaryTask, id: 'foreign-summary-task' }, now: NOW,
})).status, 'waiting_external', 'the summary task must belong to the exact fixed graph');

const foreign = await notifyStarterPublicationEvidenceChanged({
  dataStore: verifiedFixture.dataStore, repository: verifiedFixture.repository,
  tenantId: 'foreign-tenant', runId: RUN, packageId: verifiedFixture.publication.packageId,
});
assert.equal(foreign.state, 'ignored');
const wrongRun = await notifyStarterPublicationEvidenceChanged({
  dataStore: verifiedFixture.dataStore, repository: verifiedFixture.repository,
  tenantId: TENANT, runId: 'foreign-run', packageId: verifiedFixture.publication.packageId,
});
assert.equal(wrongRun.state, 'ignored');

for (const boundRun of [null, 'another-run'] as const) {
  const invalidBinding = await fixture('waiting_human', boundRun);
  const outcome = await notifyStarterPublicationEvidenceChanged({
    dataStore: invalidBinding.dataStore, repository: invalidBinding.repository,
    tenantId: TENANT, runId: RUN, packageId: invalidBinding.publication.packageId,
  });
  assert.equal(outcome.reason, 'content_approval_binding_not_exact',
    'an unbound or cross-run package can never project publication success');
  if (boundRun === null) {
    let projectionCalls = 0;
    await retryStarterPublicationEvidenceProjection({
      dataStore: invalidBinding.dataStore, repository: invalidBinding.repository,
      tenantId: TENANT, packageId: invalidBinding.publication.packageId,
      readPublicationPackage: async () => invalidBinding.publication,
      projector: async () => {
        projectionCalls += 1;
        return { state: 'ready', reason: '', taskUpdated: true, runTransitioned: true };
      },
    });
    assert.equal(projectionCalls, 0, 'the command hook ignores an ordinary unbound package');
  }
}

const tamperedTask = await fixture();
const packageTask = tamperedTask.dataStore.rows.get(STARTER_COLLECTIONS.tasks)!.find(row => row.task_key === 'starter_publication_package')!;
(packageTask.output as Row).packageHash = '0'.repeat(64);
assert.equal((await notifyStarterPublicationEvidenceChanged({
  dataStore: tamperedTask.dataStore, repository: tamperedTask.repository,
  tenantId: TENANT, runId: RUN, packageId: tamperedTask.publication.packageId,
})).reason, 'publication_binding_not_exact');

const foreignHumanWait = await fixture();
foreignHumanWait.dataStore.rows.get(STARTER_COLLECTIONS.runs)![0].pause_reason = '另一个人工完整性阻断';
assert.equal((await notifyStarterPublicationEvidenceChanged({
  dataStore: foreignHumanWait.dataStore, repository: foreignHumanWait.repository,
  tenantId: TENANT, runId: RUN, packageId: foreignHumanWait.publication.packageId,
})).reason, 'waiting_human_not_owned_by_publication_evidence');
assert.equal(foreignHumanWait.dataStore.rows.get(STARTER_COLLECTIONS.runs)![0].status, 'waiting_human');

const failedSibling = await fixture('waiting_external');
failedSibling.dataStore.rows.get(STARTER_COLLECTIONS.tasks)!
  .find(row => row.task_key === 'starter_content_research')!.status = 'failed';
assert.equal((await notifyStarterPublicationEvidenceChanged({
  dataStore: failedSibling.dataStore, repository: failedSibling.repository,
  tenantId: TENANT, runId: RUN, packageId: failedSibling.publication.packageId,
})).reason, 'workflow_contains_failed_or_cancelled_task');

const approvalTampered = await fixture('waiting_external');
const approvalOutput = approvalTampered.dataStore.rows.get(STARTER_COLLECTIONS.tasks)!
  .find(row => row.task_key === 'starter_content_release_approval')!.output as Row;
approvalOutput.externalPublishPerformed = true;
assert.equal((await notifyStarterPublicationEvidenceChanged({
  dataStore: approvalTampered.dataStore, repository: approvalTampered.repository,
  tenantId: TENANT, runId: RUN, packageId: approvalTampered.publication.packageId,
})).reason, 'content_approval_binding_not_exact');

const tamperedEvidence = await fixture();
await submitStarterPublicationEvidence({
  tenantId: TENANT, packageId: tamperedEvidence.publication.packageId,
  contentHash: tamperedEvidence.publication.contentHash, platformPostId: 'verified-post-456',
  submittedBy: 'user', now: NOW,
}, tamperedEvidence.dataStore);
await verifyStarterPublicationEvidence({
  tenantId: TENANT, packageId: tamperedEvidence.publication.packageId, verifier: 'human_review',
  publiclyObservable: true, observedContentHash: tamperedEvidence.publication.contentHash, now: NOW,
  sourceReceiptHash: '7'.repeat(64), verifierIdentity: 'trusted-human-review-v1',
}, tamperedEvidence.dataStore);
const stored = tamperedEvidence.dataStore.rows.get(STARTER_COLLECTIONS.publicationPackages)![0];
(stored.evidence as Row).verificationReceiptHash = '0'.repeat(64);
await assert.rejects(() => notifyStarterPublicationEvidenceChanged({
  dataStore: tamperedEvidence.dataStore, repository: tamperedEvidence.repository,
  tenantId: TENANT, runId: RUN, packageId: tamperedEvidence.publication.packageId,
}), (error: unknown) => error instanceof StarterPublicationEvidenceProjectionError
  && error.code === 'publication_evidence_integrity_violation');

for (const status of ['paused', 'cancelling', 'cancelled', 'waiting_approval'] as const) {
  const closed = await fixture(status);
  const outcome = await notifyStarterPublicationEvidenceChanged({
    dataStore: closed.dataStore, repository: closed.repository,
    tenantId: TENANT, runId: RUN, packageId: closed.publication.packageId,
  });
  assert.equal(outcome.reason, `run_${status}`);
  assert.equal(closed.dataStore.rows.get(STARTER_COLLECTIONS.tasks)!.find(row => row.task_key === 'starter_publication_evidence')!.status, 'waiting_external');
}

const leaseBusy = await fixture();
leaseBusy.dataStore.rows.get(DURABLE_OPERATION_LEASE_COLLECTION)!.push({
  id: 'foreign-lease', tenant_id: TENANT, lease_scope: 'starter-run-mutation', subject_id: RUN,
  lease_token: 'foreign-token', owner_id: 'foreign-owner', acquired_at: NOW.toISOString(),
  expires_at: '2099-01-01T00:00:00.000Z',
});
const busy = await notifyStarterPublicationEvidenceChanged({
  dataStore: leaseBusy.dataStore, repository: leaseBusy.repository,
  tenantId: TENANT, runId: RUN, packageId: leaseBusy.publication.packageId,
});
assert.equal(busy.reason, 'run_mutation_busy');
assert.equal(leaseBusy.dataStore.rows.get(STARTER_COLLECTIONS.tasks)!.some(row => row.status === 'failed'), false);

console.log('starter publication evidence projection passed: persisted verifier receipt, scope, waits, replay and lease fencing');
