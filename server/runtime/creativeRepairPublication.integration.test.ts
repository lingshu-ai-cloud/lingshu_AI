import test from 'node:test';
import assert from 'node:assert/strict';
import { creativeRepairApprovalFixture } from '../socialPrograms/creativeRepairApproval.fixture.js';
import { createWeeklyExecutionTaskService } from '../socialPrograms/executionTasks.js';
import { validateWeeklyPublicationAcceptance } from './socialWeeklyResultValidation.js';
import { createSocialWeeklyPublicationAdapter } from './socialWeeklyPublicationAdapter.js';
import { socialRequestHash } from '../starter198/socialContentValidation.js';
import type { WeeklyProductionRepairCase } from '../../shared/contracts/weeklyProductionRepairCase.js';
import type { ListQuery } from '../storage/datastore.js';
import { assertPublicationAtomicStore } from '../publishing/publicationAtomicStore.js';

async function approve(f: Awaited<ReturnType<typeof creativeRepairApprovalFixture>>) {
  await createWeeklyExecutionTaskService(f.store).approve('t', 'p', 'week1', f.approval.taskId, 'owner');
}

test('atomic publication store failure keeps its exact blocked reason instead of cancellation semantics', async t => {
  const f = await creativeRepairApprovalFixture(t);
  await approve(f);
  const pkg = f.tables.social_weekly_operating_packages![0]!.payload as any;
  const task = { ...f.approval, accountId: pkg.socialContentPackage.publicationTasks[0].accountId,
    schedule: { ...f.approval.schedule, stepKind: 'publishing' as const } };
  const list = f.store.list.bind(f.store);
  f.store.list = async <T>(collection: string, query: ListQuery = {}) => {
    // Exercise the real capability assertion at the guarded production boundary.
    if (collection === 'social_weekly_execution_tasks') {
      await assertPublicationAtomicStore({ ...f.store, supportsAtomicOperationLease: () => false });
    }
    return list<T>(collection, query);
  };
  let providerCalls = 0;
  const result = await createSocialWeeklyPublicationAdapter(f.store, { adapterFactory: async () => {
    providerCalls++; throw Error('provider must not be created');
  } }).execute(task);
  assert.equal(result.status, 'blocked');
  assert.equal('code' in result && result.code, 'publication_atomic_store_unavailable');
  assert.match('message' in result ? result.message : '', /数据库|publication_atomic_store_unavailable/);
  assert.equal(providerCalls, 0);
});

test('publication acceptance consumes approved resolved child and refuses parent production identity', async t => {
  const f = await creativeRepairApprovalFixture(t);
  await assert.rejects(validateWeeklyPublicationAcceptance(f.store, f.approval));
  await approve(f);
  const childProductionId = (f.childArtifact.content as any).productionResult.productionResultId;
  await validateWeeklyPublicationAcceptance(f.store, f.approval, childProductionId);
  await assert.rejects(validateWeeklyPublicationAcceptance(f.store, f.approval, 'parent-production-id'));
  const accepted = f.readApproval();
  accepted.resultRefs = accepted.resultRefs.map(ref => ref.type === 'starter_social_content_artifact'
    ? { ...ref, id: String(f.parentArtifact.artifact_id), version: Number(String(f.parentArtifact.version).replace(/^v/, '')) } : ref);
  f.parentArtifact.status = 'approved';
  await assert.rejects(validateWeeklyPublicationAcceptance(f.store, f.approval));
});

test('actual publication adapter scans approved child rather than original parent and never calls provider', async t => {
  const f = await creativeRepairApprovalFixture(t);
  await approve(f);
  const pkg = f.tables.social_weekly_operating_packages![0]!.payload as any;
  const publication = pkg.socialContentPackage.publicationTasks[0];
  const task = { ...f.approval, accountId: publication.accountId, schedule: { ...f.approval.schedule, stepKind: 'publishing' as const } };
  const scans: string[] = [];
  const list = f.store.list.bind(f.store);
  f.store.list = async <T>(collection: string, query: ListQuery = {}) => {
    if (collection === 'starter_social_content_artifacts' && query.where?.status === 'approved') scans.push(String(query.where.task_id));
    return list<T>(collection, query);
  };
  let providerCalls = 0;
  await createSocialWeeklyPublicationAdapter(f.store, { publishingEnabled: () => false,
    adapterFactory: async () => { providerCalls++; throw Error('provider must not be created'); } }).execute(task);
  assert.deepEqual(scans, ['content']);
  assert(!scans.includes('parent-task'));
  assert.equal(providerCalls, 0);
});

for (const mutation of ['artifact-drift', 'cross-case', 'approval-removed'] as const) {
  test(`publication gates fail closed on ${mutation}`, async t => {
    const f = await creativeRepairApprovalFixture(t);
    await approve(f);
    if (mutation === 'artifact-drift') f.childArtifact.content_hash = 'f'.repeat(64);
    if (mutation === 'approval-removed') f.readApproval().status = 'blocked';
    if (mutation === 'cross-case') {
      const item = f.caseRow.payload as WeeklyProductionRepairCase;
      const { recordHash, ...body } = item;
      const nextBody = { ...body, approvalTaskId: 'foreign-approval' };
      const next = { ...nextBody, recordHash: socialRequestHash(nextBody) };
      Object.assign(f.caseRow, { payload: next, content_hash: socialRequestHash(next) });
    }
    await assert.rejects(validateWeeklyPublicationAcceptance(f.store, f.approval));
    const pkg = f.tables.social_weekly_operating_packages![0]!.payload as any;
    const task = { ...f.approval, accountId: pkg.socialContentPackage.publicationTasks[0].accountId,
      schedule: { ...f.approval.schedule, stepKind: 'publishing' as const } };
    let providerCalls = 0;
    const result = await createSocialWeeklyPublicationAdapter(f.store, { publishingEnabled: () => true,
      adapterFactory: async () => { providerCalls++; throw Error('invalid evidence cannot reach provider'); } }).execute(task);
    assert.equal(result.status, 'blocked');
    assert.equal(providerCalls, 0);
  });
}

test('resolved but unapproved child cannot reach publication scan or provider', async t => {
  const f = await creativeRepairApprovalFixture(t);
  const pkg = f.tables.social_weekly_operating_packages![0]!.payload as any;
  const task = { ...f.approval, accountId: pkg.socialContentPackage.publicationTasks[0].accountId,
    schedule: { ...f.approval.schedule, stepKind: 'publishing' as const } };
  let providerCalls = 0;
  const result = await createSocialWeeklyPublicationAdapter(f.store, { publishingEnabled: () => true,
    adapterFactory: async () => { providerCalls++; throw Error('no approval'); } }).execute(task);
  assert.equal(result.status, 'blocked');
  assert.equal('code' in result ? result.code : '', 'weekly_content_approval_required');
  assert.equal(providerCalls, 0);
});
