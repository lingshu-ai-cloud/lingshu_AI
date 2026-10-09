import {readWeeklyCustomerRelationshipScope,evaluateWeeklyCustomerRelationship} from '../socialPrograms/weeklyCustomerRelationshipScope.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { bindWeeklyCustomerRun, readWeeklyCustomerStep, readWeeklyCustomerCalendar, listWeeklyCustomerRunCandidates, WEEKLY_CUSTOMER_BINDINGS, type WeeklyCustomerStep } from './socialWeeklyCustomerBridge.js';
const authority = { tenantId: 'tenant', programId: 'program', packageId: 'week', packageVersion: 1 };
function fixture() {
  const scope = { tenant_id: 'tenant', goal_id: 'goal', plan_id: 'plan', run_id: 'run' };
  const taskKeys = ['customer_segmentation', 'followup_batch_draft', 'followup_batch_approval', 'followup_dispatch'];
  const data: Record<string, Record_[]> = {
    social_weekly_operating_packages: [{ id: 'pkg', tenant_id: 'tenant', program_id: 'program', package_id: 'week', version: 1, payload: { programId: 'program', packageId: 'week', version: 1, weekStart: '2026-10-05', weekEnd: '2026-10-11' } }],
    workflow_runs: [{ id: 'run', ...scope, status: 'running' }],
    weekly_goals: [{ id: 'goal', tenant_id: 'tenant', business_line: 'customer_conversion', starts_at: '2026-10-05T00:00:00Z', ends_at: '2026-10-11T23:59:59Z' }],
    weekly_plans: [{ id: 'plan', tenant_id: 'tenant', goal_id: 'goal' }],
    workflow_tasks: taskKeys.map(key => ({ id: key, ...scope, task_key: key, agent_role: 'customer', status: 'succeeded' })),
    customer_segments: [{ id: 'segment', ...scope, task_id: 'customer_segmentation', status: 'generated', version: 1, criteria: {}, criteria_hash: createHash('sha256').update('{}').digest('hex'), snapshot_at: '2026-10-06T10:00:00Z', member_count: 1 }],
    customer_segment_members: [{ id: 'member', tenant_id: 'tenant', segment_id: 'segment', customer_id: 'buyer', customer_snapshot: { id: 'buyer', name: 'Real persisted buyer' }, membership: 'included' }],
    followup_batches: [{ id: 'batch', ...scope, task_id: 'followup_batch_draft', segment_id: 'segment', version: 2, content_hash: 'batch-hash', approval_id: 'approval', approved_version: 2, approved_by: 'owner' }],
    followup_batch_items: [{ id: 'item', tenant_id: 'tenant', batch_id: 'batch', segment_member_id: 'member', customer_id: 'buyer', draft_body: 'Approved buyer-specific draft', content_hash: createHash('sha256').update(JSON.stringify('Approved buyer-specific draft')).digest('hex'), send_mode: 'session_message', status: 'sent', exclusion_reason: '', provider_message_id: 'wamid.real-provider-receipt', provider_receipt: { id: 'wamid.real-provider-receipt' }, sent_at: '2026-10-06T12:00:00Z' }],
    approval_requests: [{ id: 'approval', ...scope, task_id: 'followup_batch_approval', subject_version: 2, content_hash: 'batch-hash', status: 'approved', decided_by: 'owner', decided_at: '2026-10-06T11:00:00Z' }],
  };
  data.social_programs=[{id:'program-row',tenant_id:'tenant',program_id:'program',payload:{route:'account_repair'}}];
  data.whatsapp_customers=[{id:'buyer-row',tenant_id:'tenant',customer_id:'buyer',payload:{id:'buyer',tenantId:'tenant'}}];
  data.whatsapp_interactions=[{id:'prior-row',tenant_id:'tenant',customer_id:'buyer',interaction_id:'prior',payload:{id:'prior',tenantId:'tenant',customerId:'buyer',type:'msg_in',body:'Real prior conversation',timestamp:Date.parse('2026-09-01T00:00:00Z'),metaMessageId:'wamid.prior'}}];
  const batchHash = createHash('sha256').update(JSON.stringify(data.followup_batch_items!.map(row => row.content_hash))).digest('hex');
  data.followup_batches![0]!.content_hash = batchHash; data.approval_requests![0]!.content_hash = batchHash;
  const store = {
    async getById<T>(collection: string, id: string) { return (data[collection]?.find(row => row.id === id) ?? null) as T | null; },
    async list<T>(collection: string, query: any = {}) { const found = (data[collection] ?? []).filter(row => Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value)); const per = query.perPage ?? 250; const page = query.page ?? 1; return { items: found.slice((page - 1) * per, page * per) as T[], totalItems: found.length, totalPages: Math.ceil(found.length / per), page, perPage: per }; },
    async create<T>(collection: string, values: Record<string, unknown>) { const row = { id: `${collection}-${data[collection]?.length ?? 0}`, ...values }; (data[collection] ??= []).push(row); if(collection===WEEKLY_CUSTOMER_BINDINGS){const rs=await readWeeklyCustomerRelationshipScope(store,'tenant',String(values.run_id));if(rs)for(const member of data.customer_segment_members??[]){const relation=await evaluateWeeklyCustomerRelationship(store,rs,String(member.customer_id));member.customer_snapshot={...(member.customer_snapshot as object),weeklyRelationship:relation.frozen};}} return row as T; },
    async update() { throw new Error('Bridge must not mutate customer tasks or approve/send'); },
  } as unknown as DataStore;
  return { store, data };
}
const steps: WeeklyCustomerStep[] = ['customer_segmentation', 'customer_followup_draft', 'customer_followup_approval', 'customer_followup_dispatch'];
test('explicit binding is immutable/idempotent and real stages resolve without external side effects', async () => {
  const { store, data } = fixture();
  await assert.rejects(readWeeklyCustomerStep(store, authority, 'run', steps[0]), { code: 'weekly_customer_binding_missing' });
  const first = await bindWeeklyCustomerRun(store, authority, 'run', 'owner');
  const retry = await bindWeeklyCustomerRun(store, authority, 'run', 'owner');
  assert.equal(first.id, retry.id); assert.equal(data[WEEKLY_CUSTOMER_BINDINGS]!.length, 1);
  for (const step of steps) assert.equal((await readWeeklyCustomerStep(store, authority, 'run', step)).status, 'succeeded');
  data.social_weekly_operating_packages!.push({ ...data.social_weekly_operating_packages![0]!, id: 'pkg2', version: 2, payload: { ...(data.social_weekly_operating_packages![0]!.payload as object), version: 2 } });
  await assert.rejects(bindWeeklyCustomerRun(store, { ...authority, packageVersion: 2 }, 'run', 'owner'), { code: 'weekly_customer_binding_conflict' });
});
test('metadata task success never substitutes missing customer proof and no_data is genuine', async () => {
  const { store, data } = fixture();
  await bindWeeklyCustomerRun(store, authority, 'run', 'owner');
  data.customer_segments = [];
  assert.equal((await readWeeklyCustomerStep(store, authority, 'run', steps[0])).reason, 'weekly_customer_segment_missing');
  data.customer_segments = [{ id: 'empty', tenant_id: 'tenant', goal_id: 'goal', run_id: 'run', task_id: 'customer_segmentation', version: 1, member_count: 0, status: 'generated', criteria: {}, criteria_hash: createHash('sha256').update('{}').digest('hex'), snapshot_at: '2026-10-06T10:00:00Z' }];
  assert.equal((await readWeeklyCustomerStep(store, authority, 'run', steps[0])).status, 'no_data');
});
test('tenant, project, week, run-plan and persisted member boundary failures reject', async () => {
  const corruptions: Array<(data: Record<string, Record_[]>) => void> = [
    data => { data.workflow_runs![0]!.tenant_id = 'other'; },
    data => { data.weekly_plans![0]!.goal_id = 'other'; },
    data => { data.weekly_goals![0]!.starts_at = '2027-01-01T00:00:00Z'; data.weekly_goals![0]!.ends_at = '2027-01-02T00:00:00Z'; },
    data => { data.social_weekly_operating_packages![0]!.payload = { ...(data.social_weekly_operating_packages![0]!.payload as object), programId: 'other' }; },
    data => { data.workflow_tasks![0]!.plan_id = 'other'; },
  ];
  for (const corrupt of corruptions) { const { store, data } = fixture(); corrupt(data); await assert.rejects(bindWeeklyCustomerRun(store, authority, 'run', 'owner')); }
  const { store, data } = fixture(); await bindWeeklyCustomerRun(store, authority, 'run', 'owner');
  data.followup_batch_items![0]!.customer_id = 'other';
  await assert.rejects(readWeeklyCustomerStep(store, authority, 'run', steps[1]));
});
test('approval covers exact batch version/hash and stale or missing approval stays blocked', async () => {
  for (const patch of [{ subject_version: 1 }, { content_hash: 'stale' }, { status: 'pending' }, { decided_by: '' }]) {
    const { store, data } = fixture(); await bindWeeklyCustomerRun(store, authority, 'run', 'owner'); Object.assign(data.approval_requests![0]!, patch);
    assert.equal((await readWeeklyCustomerStep(store, authority, 'run', steps[2])).reason, 'weekly_customer_approval_required');
  }
});
test('unknown/partial/simulated/unreceipted sends never count as completed', async () => {
  for (const patch of [{ status: 'partial_sent' }, { exclusion_reason: 'send_outcome_unknown' }, { provider_message_id: 'mock-receipt' }, { provider_receipt: {} }, { provider_receipt: { synthetic: true } }, { sent_at: '' }, { status: 'approved' }]) {
    const { store, data } = fixture(); await bindWeeklyCustomerRun(store, authority, 'run', 'owner'); Object.assign(data.followup_batch_items![0]!, patch);
    assert.equal((await readWeeklyCustomerStep(store, authority, 'run', steps[3])).status, 'blocked');
  }
});
test('paused run and edited draft cannot use previous completion', async () => {
  const { store, data } = fixture(); await bindWeeklyCustomerRun(store, authority, 'run', 'owner');
  data.workflow_runs![0]!.status = 'paused'; assert.equal((await readWeeklyCustomerStep(store, authority, 'run', steps[0])).status, 'blocked');
  data.workflow_runs![0]!.status = 'running'; data.followup_batch_items![0]!.draft_body = 'Changed after approval';
  await assert.rejects(readWeeklyCustomerStep(store, authority, 'run', steps[3]));
});
test('both legacy and template-configured batch hashes verify exact bodies, member order and schedule', async () => {
  const { store, data } = fixture(); await bindWeeklyCustomerRun(store, authority, 'run', 'owner');
  const item = data.followup_batch_items![0]!; item.scheduled_at = '2026-10-06T12:00:00Z';
  const legacy = createHash('sha256').update(JSON.stringify([{ body: item.draft_body, customerId: item.customer_id, scheduledAt: item.scheduled_at }])).digest('hex');
  data.followup_batches![0]!.content_hash = legacy; data.approval_requests![0]!.content_hash = legacy;
  assert.equal((await readWeeklyCustomerStep(store, authority, 'run', steps[3])).status, 'succeeded');
  item.scheduled_at = '2026-10-07T12:00:00Z';
  await assert.rejects(readWeeklyCustomerStep(store, authority, 'run', steps[3]), { code: 'weekly_customer_batch_hash_mismatch' });
});
test('empty segment not yet generated or customer task incomplete is blocked instead of no_data', async () => {
  const { store, data } = fixture(); await bindWeeklyCustomerRun(store, authority, 'run', 'owner');
  data.customer_segments![0]!.member_count = 0; data.customer_segment_members = [];
  data.workflow_tasks![0]!.status = 'pending';
  assert.equal((await readWeeklyCustomerStep(store, authority, 'run', steps[0])).status, 'blocked');
  data.workflow_tasks![0]!.status = 'succeeded'; data.customer_segments![0]!.status = 'draft';
  assert.equal((await readWeeklyCustomerStep(store, authority, 'run', steps[0])).status, 'blocked');
});
test('customer binding HTTP routes demand explicit version/run and isolate tenants and programs', async t => {
  const express = (await import('express')).default;
  const { createSocialProgramsRouter } = await import('../routes/socialPrograms.js');
  const { store } = fixture();
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { res.locals.tenantId = req.header('x-isolated-test-tenant') || 'tenant'; res.locals.userId = 'owner'; next(); });
  app.use('/api/social-programs', createSocialProgramsRouter(store, false));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = (server.address() as import('node:net').AddressInfo).port;
  const base = `http://127.0.0.1:${port}/api/social-programs/program/operating-packages/week/customer-run-binding`;
  const post = (body: unknown, tenant = 'tenant') => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', 'x-isolated-test-tenant': tenant }, body: JSON.stringify(body) });
  for (const body of [{ runId: 'run' }, { packageVersion: 1 }, { packageVersion: 1.5, runId: 'run' }]) assert.equal((await post(body)).status, 400);
  assert.equal((await post({ packageVersion: 1, runId: 'run' }, 'other-tenant')).status, 409);
  const candidates = await fetch(`${base.replace('customer-run-binding','customer-run-candidates')}?version=1`);
  assert.equal(candidates.status,200);const choices=await candidates.json();assert.equal(choices.items.length,1);assert.equal(choices.items[0].runId,'run');assert.equal(choices.boundRunId,null);
  assert.equal((await fetch(`${base.replace('customer-run-binding','customer-run-candidates')}?version=1`,{headers:{'x-isolated-test-tenant':'other-tenant'}})).status,409);
  assert.equal((await fetch(base.replace('customer-run-binding','customer-run-candidates'))).status,400);
  const bound = await post({ packageVersion: 1, runId: 'run' }); assert.equal(bound.status, 200);
  assert.equal((await bound.json()).item.bound_by, 'owner');
  const summary = await fetch(`${base}?version=1`);
  assert.equal(summary.status,200); const calendar = (await summary.json()).item;
  assert.equal(calendar.binding.runId,'run'); assert.equal(calendar.tasks.length,4); assert.equal(calendar.scheduleGaps.length,4);
  assert.equal((await fetch(base)).status,400);
  const read = await fetch(`${base}/run/steps/customer_followup_dispatch?version=1`);
  assert.equal(read.status, 200); assert.equal((await read.json()).item.status, 'succeeded');
  assert.equal((await fetch(`${base}/run/steps/customer_segmentation`)).status, 400);
  assert.equal((await fetch(`${base}/run/steps/performance_monitoring?version=1`)).status, 400);
  assert.equal((await fetch(`${base.replace('/program/', '/other-program/')}/run/steps/customer_segmentation?version=1`)).status, 409);
  assert.equal((await fetch(`${base}/run/steps/customer_segmentation?version=1`, { headers: { 'x-isolated-test-tenant': 'other-tenant' } })).status, 409);
});
test('concurrent different-run binding of same week is serialized and cannot overwrite first authority', async () => {
  const { store, data } = fixture();
  data.workflow_runs!.push({ ...data.workflow_runs![0]!, id: 'run2', run_id: 'run2' });
  data.workflow_tasks!.push(...data.workflow_tasks!.map(row => ({ ...row, id: `${row.id}2`, run_id: 'run2' })));
  const outcomes = await Promise.allSettled([bindWeeklyCustomerRun(store, authority, 'run', 'owner'), bindWeeklyCustomerRun(store, authority, 'run2', 'owner')]);
  assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(data[WEEKLY_CUSTOMER_BINDINGS]!.length, 1);
});
test('synthetic segments and drafts cannot produce real customer completion', async () => {
  for (const collection of ['customer_segments', 'customer_segment_members', 'followup_batches', 'followup_batch_items']) {
    const { store, data } = fixture(); await bindWeeklyCustomerRun(store, authority, 'run', 'owner');
    data[collection]![0]!.synthetic = true;
    await assert.rejects(readWeeklyCustomerStep(store, authority, 'run', steps[3]), { code: 'weekly_customer_synthetic_evidence' });
  }
});
test('calendar never substitutes creation or goal deadlines for task appointment and keeps missing schedule explicit', async () => {
  const { store, data } = fixture();
  assert.deepEqual(await readWeeklyCustomerCalendar(store,authority),{binding:null,tasks:[],scheduleGaps:[]});
  await bindWeeklyCustomerRun(store,authority,'run','owner');
  data.weekly_plans![0]!.plan = { tasks:[{key:'customer_segmentation',expectedMinutes:15}] };
  data.followup_batch_items![0]!.scheduled_at = '2026-10-06T12:00:00Z';
  const result = await readWeeklyCustomerCalendar(store,authority);
  assert.equal(result.binding?.runId,'run'); assert.equal(result.tasks.length,4);
  assert.equal(result.tasks[0]!.scheduledAt,null); assert.equal(result.tasks[0]!.latestFinishAt,null); assert.equal(result.tasks[0]!.estimateDurationMinutes,15);
  assert.equal(result.tasks[3]!.scheduledAt,'2026-10-06T12:00:00Z'); assert.equal(result.tasks[3]!.scheduledAtSource,'followup_batch_item');
  assert.equal(result.scheduleGaps.length,3);
  data.workflow_tasks![0]!.scheduled_at = '2026-10-06T09:00:00+08:00';
  const updated = await readWeeklyCustomerCalendar(store,authority);
  assert.equal(updated.tasks[0]!.scheduledAtSource,'workflow_task'); assert.equal(updated.scheduleGaps.length,2);
});
test('candidate selection lists explicit owned customer runs and rejects unrelated windows or already bound scope',async()=>{
 const {store,data}=fixture();
 data.workflow_runs!.push({...data.workflow_runs![0]!,id:'cancelled-run',status:'cancelled'});
 const initial=await listWeeklyCustomerRunCandidates(store,authority);assert.equal(initial.items.length,1);assert.equal(initial.items[0]!.runId,'run');assert.equal(initial.boundRunId,null);assert.equal(initial.items[0]!.customerSourceCoverage,'unverified');
 await bindWeeklyCustomerRun(store,authority,'run','owner');
 const bound=await listWeeklyCustomerRunCandidates(store,authority);assert.equal(bound.boundRunId,'run');assert.equal(bound.items[0]!.alreadyBound,true);
 data.social_weekly_operating_packages!.push({...data.social_weekly_operating_packages![0]!,id:'pkg2',version:2,payload:{...(data.social_weekly_operating_packages![0]!.payload as object),version:2}});
 const next=await listWeeklyCustomerRunCandidates(store,{...authority,packageVersion:2});assert.equal(next.items[0]!.bindingConflict,true);assert.equal(next.boundRunId,null);
 data.weekly_goals![0]!.starts_at='2027-01-01T00:00:00Z';data.weekly_goals![0]!.ends_at='2027-01-02T00:00:00Z';
 assert.equal((await listWeeklyCustomerRunCandidates(store,authority)).items.length,0);
});
test('candidate enumeration performs no implicit binding and filters content-only/foreign/orphaned runs',async()=>{
 const {store,data}=fixture();
 data.workflow_runs!.push({id:'foreign-run',tenant_id:'other',goal_id:'goal',plan_id:'plan',status:'running'});
 data.workflow_runs!.push({...data.workflow_runs![0]!,id:'orphan-run',goal_id:'missing'});
 data.weekly_goals!.push({...data.weekly_goals![0]!,id:'content-goal',business_line:'content_growth'});
 data.weekly_plans!.push({id:'content-plan',tenant_id:'tenant',goal_id:'content-goal'});
 data.workflow_runs!.push({id:'content-run',tenant_id:'tenant',goal_id:'content-goal',plan_id:'content-plan',status:'running'});
 const result=await listWeeklyCustomerRunCandidates(store,authority);
 assert.deepEqual(result.items.map(item=>item.runId),['run']);assert.equal(data[WEEKLY_CUSTOMER_BINDINGS],undefined);
 assert.deepEqual((await readWeeklyCustomerCalendar(store,authority)).tasks,[]);
});

test('weekly relationship legacy missing proof and excluded unknown never count as completed segmentation',async()=>{const{store,data}=fixture();await bindWeeklyCustomerRun(store,authority,'run','owner');data.customer_segment_members![0]!.customer_snapshot={id:'buyer'};assert.equal((await readWeeklyCustomerStep(store,authority,'run','customer_segmentation')).reason,'weekly_customer_relationship_snapshot_missing');data.customer_segment_members![0]!.membership='excluded';data.customer_segment_members![0]!.exclusion_reasons=['weekly_customer_relationship_unknown'];data.customer_segments![0]!.member_count=0;assert.equal((await readWeeklyCustomerStep(store,authority,'run','customer_segmentation')).reason,'weekly_customer_relationship_unknown_requires_new_snapshot');});
