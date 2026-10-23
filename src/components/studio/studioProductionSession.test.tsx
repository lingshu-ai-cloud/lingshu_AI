import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { productionApi } from '../../lib/productionApi';
import { newShotProduction, type AvatarJob } from '../../lib/shotProduction';
import type { DigitalHumanPlanRecord, DigitalHumanExecutionRecord } from '../../lib/digitalHumanPlan';
import type { StudioProject } from '../../lib/studioApi';
import { createStudioProductionSession, createStudioProductionProjectRead, useStudioProductionRecords,
  useStudioProductionRefreshState, useStudioProductionRequestIdentity, type StudioAvatarSubmission,
} from './studioProductionSession';

const stamp = '2026-10-23T00:00:00Z';
const job = (extra: Partial<AvatarJob> = {}): AvatarJob => ({ id: 'job', projectId: 'project', assemblyId: 'assembly', shotId: 'shot',
  fingerprint: 'fingerprint', status: 'pending', createdAt: stamp, updatedAt: stamp, ...extra });
const plan = (extra: Partial<DigitalHumanPlanRecord> = {}): DigitalHumanPlanRecord => ({ id: 'plan', projectId: 'project', assemblyId: 'assembly',
  shotId: 'shot', fingerprint: 'fingerprint', state: 'ready', executable: true, reasons: [], steps: [], provider: 'heygen', pipeline: 'pipeline_1',
  workflow: 'material_processing', method: 'talking', presenterId: 'presenter', presenterAssetVersion: 1, candidateTools: [], estimatedCostCny: null,
  createdAt: stamp, updatedAt: stamp, ...extra });
const execution = (extra: Partial<DigitalHumanExecutionRecord> = {}): DigitalHumanExecutionRecord => ({ id: 'execution', planId: 'plan', jobId: 'job',
  projectId: 'project', assemblyId: 'assembly', shotId: 'shot', fingerprint: 'fingerprint', tool: 'heygen', provider: 'heygen', model: null,
  presenterAssetVersion: 1, state: 'pending', externalTaskId: null, materialId: null, estimatedCostCny: null, actualCostCny: null,
  costStatus: 'estimated', costSourceRef: null, error: '', quality: { state: 'pending', checks: [], updatedAt: stamp },
  createdAt: stamp, updatedAt: stamp, ...extra });
const project: StudioProject = { id: 'project', title: 'Project', status: 'draft', spec: {}, createdAt: stamp, updatedAt: stamp };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function fixture() {
  let records!: ReturnType<typeof useStudioProductionRecords>;
  let refresh!: ReturnType<typeof useStudioProductionRefreshState>;
  let requestIds!: ReturnType<typeof useStudioProductionRequestIdentity>;
  function Probe() { records = useStudioProductionRecords(); refresh = useStudioProductionRefreshState(); requestIds = useStudioProductionRequestIdentity(); return null; }
  renderToStaticMarkup(createElement(Probe));
  for (const state of [records, refresh]) for (const key of Object.keys(state).filter(key => key.startsWith('set'))) {
    const field = key.slice(3, 4).toLowerCase() + key.slice(4);
    Object.assign(state, { [key]: (update: unknown) => {
      const target = state as unknown as Record<string, unknown>;
      target[field] = typeof update === 'function' ? update(target[field]) : update;
    } });
  }
  const events: string[] = [];
  const feedback = { busy: false, error: '', notice: '' };
  const input = { records, refresh, requestIds, feedback: {
    setProductionBusy: (value: boolean) => { feedback.busy = value; events.push('busy:' + value); },
    setProductionError: (value: string) => { feedback.error = value; events.push('error:' + value); },
    setDigitalHumanNotice: (value: string) => { feedback.notice = value; events.push('notice:' + value); },
  } };
  const submission: StudioAvatarSubmission = {
    draft: { autosaveInFlightRef: { current: false }, isCurrent: () => true, save: async () => { events.push('save:' + submission.draft.autosaveInFlightRef.current); return { ok: true, project }; },
      onSaved: saved => { events.push('saved:' + saved.id); } },
    prepareIdentity: () => { events.push('prepare'); return { fingerprint: 'fingerprint', persistedShot: { id: 'shot' }, activeAssemblyId: 'assembly', shotKey: 'assembly:slot' }; },
    shot: newShotProduction('Hello'), presenter: { id: 'presenter', name: 'Presenter', avatarId: 'avatar', voiceId: 'voice', authorized: true, supportsAlpha: false }, ratio: '9:16',
  };
  const context = { currentProjectRef: { current: 'project' as string | null },
    refreshMaterials: async () => { events.push('materials'); return []; },
    onCompleted: (completed: AvatarJob) => { events.push('completed:' + completed.id); } };
  return { records, refresh, requestIds, feedback, events, submission, context,
    input, session: () => createStudioProductionSession(input) };
}

test.beforeEach(t => {
  if (!('mock' in t)) throw Error('Requires per-test context');
  const network = t.mock.method(globalThis, 'fetch', async () => { throw Error('unexpected real network'); });
  t.after(() => assert.equal(network.mock.callCount(), 0));
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const timers = new Map<number, { callback: () => void; delay: number }>(); let nextId = 0;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    setTimeout: (callback: () => void, delay: number) => { timers.set(++nextId, { callback, delay }); return nextId; },
    clearTimeout: (id: number) => timers.delete(id),
  } });
  Object.assign(t, { timers });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'window', descriptor); else Reflect.deleteProperty(globalThis, 'window'); });
});
const timersFor = (t: unknown) => (t as { timers: Map<number, { callback: () => void; delay: number }> }).timers;

function submissionMocks(t: import('node:test').TestContext, f: ReturnType<typeof fixture>, savedPlan = plan()) {
  t.mock.method(productionApi, 'savePlan', async () => { f.events.push('plan'); return savedPlan; });
  t.mock.method(productionApi, 'jobs', async () => { f.events.push('jobs'); return []; });
  t.mock.method(productionApi, 'executions', async () => { f.events.push('executions'); return []; });
}

test('state and session construction are idle, canonical and make no request', () => {
  const f = fixture(); f.session();
  assert.deepEqual(f.records.productionJobs, []); assert.equal(f.requestIds.current.size, 0);
  assert.equal(f.refresh.productionRefreshInFlight.current.size, 0); assert.equal(f.events.length, 0);
});

test('avatar submission saves under the shared lock, publishes the saved revision, validates the plan and submits exactly once', async t => {
  const f = fixture(); submissionMocks(t, f);
  const submit = t.mock.method(productionApi, 'submit', async () => { f.events.push('submit'); assert.equal(f.submission.draft.autosaveInFlightRef.current, true); return job(); });
  await f.session().generateProductionAvatar(f.submission);
  assert.deepEqual(f.events.slice(0, 9), ['busy:true', 'error:', 'prepare', 'save:true', 'saved:project', 'plan', 'jobs', 'executions', 'submit']);
  assert.equal(submit.mock.callCount(), 1);
  assert.deepEqual({ ...submit.mock.calls[0]?.arguments[0], requestId: 'fixture' }, {
    projectId: 'project', assemblyId: 'assembly', shotId: 'shot', shot: f.submission.shot, presenter: f.submission.presenter,
    ratio: '9:16', fingerprint: 'fingerprint', requestId: 'fixture', confirmed: true,
  });
  assert.equal(f.records.productionJobs[0]?.id, 'job'); assert.equal(f.requestIds.current.size, 0);
  assert.equal(f.feedback.busy, false); assert.equal(f.submission.draft.autosaveInFlightRef.current, false);
});

test('failed draft save or blocked plan prevents supplier submission and releases both busy states', async t => {
  const f = fixture(); submissionMocks(t, f, plan({ executable: false, reasons: ['fixture approval required'] }));
  const submit = t.mock.method(productionApi, 'submit', async () => { throw Error('unexpected submission'); });
  await f.session().generateProductionAvatar(f.submission);
  assert.match(f.feedback.error, /fixture approval required/); assert.equal(submit.mock.callCount(), 0);
  f.submission.draft.save = async () => ({ ok: false, error: 'fixture save failed' });
  await f.session().generateProductionAvatar(f.submission);
  assert.match(f.feedback.error, /草稿保存失败/); assert.equal(f.feedback.busy, false);
  assert.equal(f.submission.draft.autosaveInFlightRef.current, false);
});

test('all unresolved job and execution states restore original records and block duplicate billing', async t => {
  const f = fixture(); submissionMocks(t, f);
  const submit = t.mock.method(productionApi, 'submit', async () => { throw Error('unexpected submission'); });
  for (const state of ['submitting', 'pending', 'uncertain'] as const) {
    t.mock.method(productionApi, 'jobs', async () => [job({ status: state })]);
    await f.session().generateProductionAvatar(f.submission);
    assert.match(f.feedback.error, /已有未结束任务/); assert.equal(f.records.productionJobs[0]?.status, state);
    t.mock.method(productionApi, 'jobs', async () => []);
    t.mock.method(productionApi, 'executions', async () => [execution({ state })]);
    await f.session().generateProductionAvatar(f.submission);
    assert.match(f.feedback.error, /已有未结束任务/); assert.equal(f.records.productionExecutions[0]?.state, state);
    t.mock.method(productionApi, 'executions', async () => []);
  }
  assert.equal(submit.mock.callCount(), 0); assert.equal(f.requestIds.current.size, 0);
});

test('reference submission uses the existing reference route and keeps its execution receipt', async t => {
  const f = fixture(); submissionMocks(t, f, plan({ provider: 'local_head_pipeline' }));
  const submit = t.mock.method(productionApi, 'submitReference', async () => execution());
  await f.session().generateProductionAvatar(f.submission);
  const sent = submit.mock.calls[0]?.arguments[0];
  assert.equal(sent?.projectId, 'project'); assert.equal(sent?.shotId, 'shot'); assert.equal(sent?.confirmed, true);
  assert.equal(f.records.productionExecutions[0]?.id, 'execution'); assert.equal(f.requestIds.current.size, 0);
});

test('an unknown submission retains its request ID for an explicit retry and never retries automatically', async t => {
  const f = fixture(); submissionMocks(t, f);
  const submit = t.mock.method(productionApi, 'submit', async () => { throw Error('fixture response unknown'); });
  await f.session().generateProductionAvatar(f.submission);
  assert.equal(submit.mock.callCount(), 1); assert.equal(f.requestIds.current.size, 1);
  const firstId = submit.mock.calls[0]?.arguments[0]?.requestId;
  await f.session().generateProductionAvatar(f.submission);
  assert.equal(submit.mock.callCount(), 2); assert.equal(submit.mock.calls[1]?.arguments[0]?.requestId, firstId);
  assert.equal(f.feedback.busy, false); assert.match(f.feedback.error, /fixture response unknown/);
});

test('plan save replaces the same shot fingerprint and reads identity after successful draft save', async t => {
  const f = fixture();
  f.records.setProductionPlans([plan({ id: 'older' }), plan({ id: 'other', shotId: 'other' })]);
  t.mock.method(productionApi, 'savePlan', async () => plan());
  await f.session().saveProductionPlan(f.submission);
  assert.deepEqual(f.events.slice(0, 5), ['busy:true', 'error:', 'save:true', 'saved:project', 'prepare']);
  assert.deepEqual(f.records.productionPlans.map(item => item.id), ['plan', 'other']);
  assert.match(f.feedback.notice, /可以生成候选/); assert.equal(f.submission.draft.autosaveInFlightRef.current, false);
});

test('adoption requires a saved draft and successful server receipt before reporting permission to write shared shot state', async t => {
  const f = fixture(); const adopted = execution({ state: 'completed', materialId: 'material' });
  const adopt = t.mock.method(productionApi, 'adoptExecution', async () => adopted);
  const input = { draft: f.submission.draft, executionId: 'execution', candidateId: 'candidate', materialId: 'material' };
  assert.equal(await f.session().adoptExecution(input), true);
  assert.deepEqual(adopt.mock.calls[0]?.arguments, ['execution', { candidateId: 'candidate', materialId: 'material' }]);
  assert.equal(f.records.productionExecutions[0], adopted);
  t.mock.method(productionApi, 'adoptExecution', async () => { throw Error('fixture adoption rejected'); });
  assert.equal(await f.session().adoptExecution(input), false); assert.match(f.feedback.error, /fixture adoption rejected/);
  assert.equal(f.feedback.busy, false); assert.equal(f.submission.draft.autosaveInFlightRef.current, false);
});

test('concurrent refresh coalesces by task ID and completes material recovery before the shared shot callback', async t => {
  const f = fixture(), pending = deferred<AvatarJob>();
  const refresh = t.mock.method(productionApi, 'refresh', () => pending.promise);
  t.mock.method(productionApi, 'executions', async () => []);
  const session = f.session(), first = session.refreshProductionJob('job', f.context);
  await session.refreshProductionJob('job', f.context); assert.equal(refresh.mock.callCount(), 1);
  pending.resolve(job({ status: 'completed', materialId: 'material' })); await first;
  assert.deepEqual(f.events.filter(item => item === 'materials' || item.startsWith('completed:')), ['materials', 'completed:job']);
  assert.equal(f.refresh.productionRefreshInFlight.current.size, 0); assert.deepEqual(f.refresh.productionRefreshingIds, []);
  assert.match(f.feedback.notice, /自动回填/);
});

test('refresh responses and errors from the previous project cannot overwrite the current task list or error', async t => {
  const f = fixture(), pending = deferred<AvatarJob>();
  t.mock.method(productionApi, 'refresh', () => pending.promise);
  const executions = t.mock.method(productionApi, 'executions', async () => []);
  const request = f.session().refreshProductionJob('job', f.context); f.context.currentProjectRef.current = 'new-project';
  pending.resolve(job({ status: 'completed', materialId: 'material' })); await request;
  assert.deepEqual(f.records.productionJobs, []); assert.equal(executions.mock.callCount(), 0);
  assert.equal(f.feedback.notice, ''); assert.equal(f.feedback.error, '');
  f.context.currentProjectRef.current = 'project';
  t.mock.method(productionApi, 'refresh', async () => { f.context.currentProjectRef.current = 'new-project'; throw Error('old project failure'); });
  await f.session().refreshProductionJob('job', f.context);
  assert.equal(f.feedback.error, ''); assert.equal(f.refresh.productionRefreshInFlight.current.size, 0);
});

test('switching projects during material recovery suppresses the completed-shot callback', async t => {
  const f = fixture(), materials = deferred<[]>();
  t.mock.method(productionApi, 'refresh', async () => job({ status: 'completed', materialId: 'material' }));
  t.mock.method(productionApi, 'executions', async () => []);
  f.context.refreshMaterials = () => materials.promise;
  const request = f.session().refreshProductionJob('job', f.context); await flush();
  f.context.currentProjectRef.current = 'new-project'; materials.resolve([]); await request;
  assert.equal(f.events.some(item => item.startsWith('completed:')), false); assert.equal(f.feedback.notice, '');
});

test('reference refresh, cancellation and cost reconciliation use original task receipts and preserve server errors', async t => {
  const f = fixture();
  t.mock.method(productionApi, 'refreshReference', async () => execution({ state: 'completed', materialId: 'material' }));
  await f.session().refreshReferenceProduction('execution', f.context); assert.ok(f.events.includes('materials'));
  t.mock.method(productionApi, 'cancelReference', async () => execution({ state: 'cancelled' }));
  await f.session().cancelReferenceProduction('execution', f.context);
  assert.equal(f.records.productionExecutions[0]?.state, 'cancelled'); assert.match(f.feedback.notice, /已确认取消/);
  t.mock.method(productionApi, 'reconcileSupplierCost', async () => execution({ actualCostCny: 2.35, costSourceRef: 'original-receipt' }));
  await f.session().reconcileProductionCost('execution', f.context); assert.match(f.feedback.notice, /2\.35.*original-receipt/);
  t.mock.method(productionApi, 'cancelReference', async () => { throw Error('fixture cancellation uncertain'); });
  await f.session().cancelReferenceProduction('execution', f.context);
  assert.match(f.feedback.error, /fixture cancellation uncertain/); assert.equal(f.refresh.productionRefreshInFlight.current.size, 0);
});

test('disposed project reads cannot publish late jobs, plans, executions or errors', async t => {
  const f = fixture(), jobs = deferred<AvatarJob[]>();
  t.mock.method(productionApi, 'jobs', () => jobs.promise);
  t.mock.method(productionApi, 'plans', async () => [plan()]); t.mock.method(productionApi, 'executions', async () => [execution()]);
  const read = createStudioProductionProjectRead(f.records, 'project', message => { f.feedback.error = message; });
  const pending = read.refresh(); read.dispose(); jobs.resolve([job()]); await pending;
  assert.equal(f.records.productionJobs.length, 0); assert.equal(f.records.productionPlans.length, 0); assert.equal(f.records.productionExecutions.length, 0);
  const active = createStudioProductionProjectRead(f.records, 'project', message => { f.feedback.error = message; });
  await active.refresh(); assert.equal(f.records.productionJobs[0]?.id, 'job');
  t.mock.method(productionApi, 'jobs', async () => { throw Error('fixture old read'); });
  active.dispose(); await active.refresh(); assert.equal(f.feedback.error, '');
});

test('automatic recovery synchronizes once, limits eligible tasks and owns timer cleanup', async t => {
  const f = fixture();
  f.records.setProductionJobs([job(), job({ id: 'uncertain', status: 'uncertain' }), job({ id: 'failed', status: 'failed' }),
    job({ id: 'other-project', projectId: 'other' }), job({ id: 'retry-required', error: 'technical check failed' })]);
  const refresh = t.mock.method(productionApi, 'refresh', async () => job()); t.mock.method(productionApi, 'executions', async () => []);
  let synchronized = 0;
  const dispose = f.session().recoverJobs({ projectId: 'project', refreshContext: f.context, onSynchronize: () => { synchronized++; } });
  const timer = [...timersFor(t).values()][0]!; assert.equal(timer.delay, 10000); assert.equal(synchronized, 1);
  timer.callback(); await flush(); assert.deepEqual(refresh.mock.calls.map(call => call.arguments), [['job']]);
  dispose?.(); assert.equal(timersFor(t).size, 0);
});


const source = readFileSync(new URL('../AiCreateStudio.tsx', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('AiCreateStudio.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function initializer(name: string) {
    let found: ts.Expression | undefined;
    function walk(node: ts.Node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === name) found = node.initializer;
      ts.forEachChild(node, walk);
    }
    walk(parsed);
    assert.ok(found, name + ' must be present in the live page');
    return found;
  }
  function compile(expression: ts.Expression, env: Record<string, unknown>) {
    const js = ts.transpileModule('const subject = ' + expression.getText(parsed), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    return new Function(...Object.keys(env), js + '\nreturn subject;')(...Object.values(env));
  }
test('the actual page completion callback adopts the job and synchronizes the full media duration at normal speed', async t => {
  const context = initializer('productionRefreshContext'); assert.ok(ts.isObjectLiteralExpression(context));
  const property = context.properties.find(item => item.name?.getText(parsed) === 'onCompleted');
  assert.ok(property && ts.isPropertyAssignment(property));
  const fullEdit = compile(initializer('digitalHumanFullLengthEdit'), { defaultEditForSlot: () => ({
    trimStart: 3, trimEnd: 4, targetDuration: 1, speed: 2, transition: '硬切', note: 'retained',
  }) });
  let shots = { 'assembly:shot': newShotProduction('Hello') };
  let assignments: Record<string, string> = {}, edits: Record<string, Record<string, unknown>> = {};
  const onCompleted = compile(property.initializer, {
    setShotProductions: (update: (current: typeof shots) => typeof shots) => { shots = update(shots); },
    setStoryboardAssignments: (update: (current: typeof assignments) => typeof assignments) => { assignments = update(assignments); },
    setClipEdits: (update: (current: typeof edits) => typeof edits) => { edits = update(edits); },
    shootingSlots: [{ id: 'shot', slotId: 'slot' }], storyboardSlots: [{ id: 'slot', start: 0, end: 2, detail: 'Hello' }],
    materialById: new Map(), slotClipEditKey: compile(initializer('slotClipEditKey'), {}), digitalHumanFullLengthEdit: fullEdit,
  });
  const f = fixture(); t.mock.method(productionApi, 'refresh', async () => job({ status: 'completed', materialId: 'material' }));
  t.mock.method(productionApi, 'executions', async () => []);
  await f.session().refreshProductionJob('job', { ...f.context, onCompleted,
    refreshMaterials: async () => [{ id: 'material', name: 'Video', type: 'video', folder: 'product', duration: 7.2, size: '' }],
  });
  assert.equal(shots['assembly:shot'].adoptedId, 'job-job'); assert.equal(assignments.slot, 'material');
  assert.deepEqual(edits['slot:material'], { trimStart: 0, trimEnd: 7.2, targetDuration: 7.2, speed: 1,
    transition: '硬切', note: 'retained', targetDurationEdited: true, trimRangeEdited: true });
});

test('switching projects during draft save prevents old submission from adopting the project or starting a supplier task', async t => {
  const f = fixture(); submissionMocks(t, f);
  const save = deferred<{ ok: boolean; project: StudioProject }>(); let current = true;
  Object.assign(f.submission.draft, { isCurrent: () => current, save: () => save.promise });
  const submit = t.mock.method(productionApi, 'submit', async () => job());
  const pending = f.session().generateProductionAvatar(f.submission);
  current = false; save.resolve({ ok: true, project }); await pending;
  assert.equal(submit.mock.callCount(), 0); assert.equal(f.events.some(item => item.startsWith('saved:')), false);
  assert.equal(f.records.productionPlans.length, 0); assert.equal(f.records.productionJobs.length, 0);
});

test('an adoption receipt arriving after a project switch cannot authorize writing the new project shot', async t => {
  const f = fixture(), adopted = deferred<DigitalHumanExecutionRecord>(); let current = true;
  Object.assign(f.submission.draft, { isCurrent: () => current });
  t.mock.method(productionApi, 'adoptExecution', () => adopted.promise);
  const pending = f.session().adoptExecution({ draft: f.submission.draft, executionId: 'execution', candidateId: 'candidate', materialId: 'material' });
  await flush(); current = false; adopted.resolve(execution({ state: 'completed', materialId: 'material' }));
  assert.equal(await pending, false); assert.equal(f.records.productionExecutions.length, 0);
});

test('a project switch while execution details load cannot write old execution records to the new project', async t => {
  const f = fixture(), details = deferred<DigitalHumanExecutionRecord[]>();
  t.mock.method(productionApi, 'refresh', async () => job({ status: 'completed', materialId: 'material' }));
  t.mock.method(productionApi, 'executions', () => details.promise);
  const pending = f.session().refreshProductionJob('job', f.context); await flush();
  f.context.currentProjectRef.current = 'new-project'; details.resolve([execution()]); await pending;
  assert.equal(f.records.productionExecutions.length, 0);
  assert.equal(f.events.some(item => item.startsWith('completed:')), false);
});


test('the actual draft bridge collects only when saving, accepts its own new project ID and rejects later foreign project results', async () => {
  const currentProjectRef = { current: null as string | null }, projectRevisionRef = { current: '' };
  const ids: string[] = [], writes: unknown[] = []; let snapshot = { version: 1 }, collected = 0;
  const bridge = compile(initializer('createProductionDraft'), {
    projectId: null, projectTitle: 'New', currentProjectRef, projectRevisionRef, autosaveInFlightRef: { current: false },
    collectSpec: () => { collected++; return snapshot; },
    saveStudioProjectVersioned: async (input: unknown) => { writes.push(input); return { ok: true, project }; },
    setProjectId: (id: string) => ids.push(id),
  })();
  assert.equal(collected, 0); snapshot = { version: 2 }; await bridge.save();
  assert.deepEqual(writes, [{ id: undefined, title: 'New', status: 'draft', spec: { version: 2 } }]);
  assert.equal(bridge.isCurrent(), true); bridge.onSaved(project);
  assert.equal(currentProjectRef.current, 'project'); assert.equal(bridge.isCurrent(), true);
  assert.equal(projectRevisionRef.current, stamp); assert.deepEqual(ids, ['project']);
  currentProjectRef.current = 'another-project'; assert.equal(bridge.isCurrent(), false);
  bridge.onSaved({ ...project, updatedAt: 'late' });
  assert.equal(currentProjectRef.current, 'another-project'); assert.equal(projectRevisionRef.current, stamp);
  assert.deepEqual(ids, ['project']);
});
