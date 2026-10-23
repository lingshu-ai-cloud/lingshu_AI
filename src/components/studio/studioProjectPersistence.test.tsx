import assert from 'node:assert/strict';
import test from 'node:test';
import { studioApi, type StudioProject } from '../../lib/studioApi';
import { productionApi } from '../../lib/productionApi';
import { createStudioProjectPersistence } from './studioProjectPersistence';
import { createStudioProjectWorkspaceActions } from './studioProjectWorkspaceActions';
import type { StudioProjectLifecyclePorts } from './studioProjectLifecyclePorts';

const ref = <T,>(current: T) => ({ current });
const project = (overrides: Partial<StudioProject> = {}): StudioProject => ({
  id: 'draft-1', title: 'Test draft', status: 'draft', spec: { script: 'saved script' },
  createdAt: '2026-10-21', updatedAt: 'revision-2', ...overrides,
});

function fixture(overrides: Partial<StudioProjectLifecyclePorts> = {}) {
  const notices: string[] = [];
  const warnings: unknown[] = [];
  const errors: string[] = [];
  // Each test exercises the real action with its relevant ports. Unused editor
  // fields remain absent so a new dependency cannot silently do work.
  const input = {
    projectRevisionRef: ref<string | undefined>('revision-1'),
    projectRevisionProjectIdRef: ref<string | undefined>('draft-1'),
    projectSaveConflictRef: ref(null), projectHydrationPendingRef: ref(false),
    projectDeleteInFlightRef: ref<string | null>(null), frozenStudioSpecRef: ref(null),
    managedProductionProjectRef: ref(false), currentProjectRef: ref<string | null>('draft-1'),
    autosaveInFlightRef: ref(false), autosavePendingRef: ref(false),
    lastSavedAutosaveFingerprintRef: ref(''), autosaveSnapshotRef: ref(async () => {}),
    projectId: 'draft-1', projectTitle: 'Test draft', modeScripts: [], script: '',
    contentMode: 'video', socialDigitalHumanPlans: [], agentProduction: { active: null },
    collectSpec: () => ({ script: 'changed script' }),
    setModeNotice: (value: string) => notices.push(value), setSavingProj: () => {},
    setAutosaveStatus: () => {}, setAutosaveError: (value: string) => errors.push(value),
    setProjectId: () => {}, setProjectTitle: () => {}, setProjects: () => {},
    setLastAutosavedAt: () => {}, setSavedTick: () => {},
    notification: { warning: (value: unknown) => warnings.push(value), destroy: () => {} },
    ...overrides,
  } as unknown as StudioProjectLifecyclePorts;
  return { input, actions: createStudioProjectPersistence(input), notices, warnings, errors };
}

test('versioned writes use only the matching editor revision and preserve an explicit CAS version', async t => {
  const writes: Parameters<typeof studioApi.saveProject>[0][] = [];
  t.mock.method(studioApi, 'saveProject', async (input: Parameters<typeof studioApi.saveProject>[0]) => {
    writes.push(input);
    return { ok: true, project: project({ id: input.id || 'new-draft' }) };
  });
  const { actions, input } = fixture();
  await actions.saveStudioProjectVersioned({ id: 'draft-1', title: 'a', status: 'draft', spec: {} });
  assert.equal(writes[0]!.baseUpdatedAt, 'revision-1');
  assert.equal(input.projectRevisionRef.current, 'revision-2');
  await actions.saveStudioProjectVersioned({ id: 'draft-1', title: 'a', status: 'draft', spec: {}, baseUpdatedAt: 'explicit' });
  assert.equal(writes[1]!.baseUpdatedAt, 'explicit');
  await actions.saveStudioProjectVersioned({ id: 'another-draft', title: 'a', status: 'draft', spec: {} });
  assert.equal(writes[2]!.baseUpdatedAt, undefined);
  await actions.saveStudioProjectVersioned({ title: 'new', status: 'draft', spec: {} });
  assert.equal(writes[3]!.baseUpdatedAt, undefined);
});

test('a save conflict retains detached local edits and the editor revision without an automatic retry', async t => {
  const remote = project({ spec: { production: { job: 'already-paid' } } });
  const save = t.mock.method(studioApi, 'saveProject', async () => ({ ok: false, project: remote, recovery: 'reload_required' as const }));
  const { actions, input, warnings } = fixture();
  const local = { script: { text: 'local edit' } };
  await actions.saveStudioProjectVersioned({ id: remote.id, title: 'a', status: 'draft', spec: local });
  local.script.text = 'later edit';
  assert.deepEqual(input.projectSaveConflictRef.current?.localSpec, { script: { text: 'local edit' } });
  assert.equal(input.projectRevisionRef.current, 'revision-1');
  assert.equal(warnings.length, 1);
  assert.equal(await actions.saveProject('draft', { silent: true }), false);
  assert.equal(save.mock.callCount(), 1);
});

test('frozen, managed, restoring, deleting and pending-entry drafts are blocked before snapshot collection or I/O', async t => {
  const save = t.mock.method(studioApi, 'saveProject', async () => { throw Error('unexpected write'); });
  const blocked: Partial<StudioProjectLifecyclePorts>[] = [
    { frozenStudioSpecRef: ref({ production: true }) },
    { managedProductionProjectRef: ref(true) }, { projectHydrationPendingRef: ref(true) },
    { projectDeleteInFlightRef: ref('draft-1') }, { sourceDraftCheckPending: true },
    { existingSourceDraftPrompt: {} as StudioProjectLifecyclePorts['existingSourceDraftPrompt'] },
    { workflowProjectSelectionPending: true },
  ];
  for (const state of blocked) {
    const { actions } = fixture({ ...state, collectSpec: () => { throw Error('unexpected snapshot'); } });
    assert.equal(await actions.saveProject('draft', { silent: true }), false);
  }
  assert.equal(save.mock.callCount(), 0);
});

test('an edit during an in-flight autosave schedules exactly one follow-up without a duplicate write', async t => {
  let finish!: (result: Awaited<ReturnType<typeof studioApi.saveProject>>) => void;
  const save = t.mock.method(studioApi, 'saveProject', () => new Promise<Awaited<ReturnType<typeof studioApi.saveProject>>>(resolve => { finish = resolve; }));
  let queued = 0;
  const { actions, input } = fixture({ autosaveSnapshotRef: ref(async () => { queued++; }) });
  const first = actions.saveProject('draft', { silent: true });
  assert.equal(input.autosaveInFlightRef.current, true);
  assert.equal(await actions.saveProject('draft', { silent: true }), false);
  assert.equal(input.autosavePendingRef.current, true);
  assert.equal(save.mock.callCount(), 1);
  finish({ ok: true, project: project() });
  const locationStub = t.mock.method(globalThis, 'fetch', async () => { throw Error('unexpected network'); });
  // A successful ordinary draft uses this existing location branch.
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { search: '' } });
  t.after(() => { if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation); else Reflect.deleteProperty(globalThis, 'location'); });
  assert.equal(await first, true);
  await Promise.resolve();
  assert.equal(queued, 1);
  assert.equal(input.autosaveInFlightRef.current, false);
  assert.equal(input.autosavePendingRef.current, false);
  assert.equal(locationStub.mock.callCount(), 0);
});

test('renaming a frozen project uses a fresh backend snapshot and preserves all production evidence', async t => {
  const frozen = { productionContract: { jobId: 'paid-1', provider: 'receipt' }, storyboardSlots: [{ id: 'slot-1' }] };
  const latest = project({ spec: frozen, status: 'ready_for_approval', thumbSeed: 'cover' });
  const get = t.mock.method(studioApi, 'getProject', async () => latest);
  const writes: Parameters<typeof studioApi.saveProject>[0][] = [];
  t.mock.method(studioApi, 'saveProject', async (input: Parameters<typeof studioApi.saveProject>[0]) => {
    writes.push(input); return { ok: true, project: { ...latest, title: input.title } };
  });
  const { actions } = fixture({ frozenStudioSpecRef: ref({ older: true }), projectTitle: '  Renamed  ', collectSpec: () => { throw Error('editor spec must not replace production'); } });
  await actions.commitProjectTitle();
  assert.equal(get.mock.callCount(), 1);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { id: 'draft-1', title: 'Renamed', status: latest.status, spec: frozen, thumbSeed: 'cover', baseUpdatedAt: latest.updatedAt });
  assert.equal(writes[0]!.spec, frozen);
});

test('deletion blocks a saving current project and only clears editor refs after successful current-project removal', async t => {
  const removed: string[] = [];
  t.mock.method(studioApi, 'deleteProject', async (id: string) => { removed.push(id); return { ok: true }; });
  let homes = 0;
  const { input } = fixture({ autosaveInFlightRef: ref(true),
    message: { warning: () => {}, success: () => {}, error: () => {} } as unknown as StudioProjectLifecyclePorts['message'],
    setBoundProductionSnapshot: () => {}, setProjectWorkflowContext: () => {}, setShowProjects: () => {},
    openCreationHome: () => { homes++; },
  });
  const actions = createStudioProjectWorkspaceActions(input);
  await assert.rejects(actions.removeProject('draft-1'), /正在保存/);
  assert.deepEqual(removed, []);
  await actions.removeProject('other');
  assert.equal(input.currentProjectRef.current, 'draft-1');
  assert.equal(homes, 0);
  input.autosaveInFlightRef.current = false;
  await actions.removeProject('draft-1');
  assert.deepEqual(removed, ['other', 'draft-1']);
  assert.equal(input.currentProjectRef.current, null);
  assert.equal(input.projectRevisionRef.current, undefined);
  assert.equal(input.projectDeleteInFlightRef.current, null);
  assert.equal(homes, 1);
});

test('action factories defer port reads until invocation, retaining the originating render bindings', async t => {
  const { input } = fixture();
  let reads = 0;
  const deferred = new Proxy(input, { get(target, property, receiver) { reads++; return Reflect.get(target, property, receiver); } });
  const actions = createStudioProjectPersistence(deferred);
  createStudioProjectWorkspaceActions(deferred);
  assert.equal(reads, 0);
  t.mock.method(studioApi, 'saveProject', async () => ({ ok: true, project: project() }));
  await actions.saveStudioProjectVersioned({ id: 'draft-1', title: 'a', status: 'draft', spec: {} });
  assert.ok(reads > 0);
});

test('a completed save from the old project cannot replace the new editor revision or raise an old conflict', async t => {
  for (const recovery of [false, true]) {
    const { input, actions, warnings } = fixture();
    let finish!: (value: Awaited<ReturnType<typeof studioApi.saveProject>>) => void;
    t.mock.method(studioApi, 'saveProject', () => new Promise(resolve => { finish = resolve; }));
    const pending = actions.saveStudioProjectVersioned({ id: 'draft-1', title: 'Old', status: 'draft', spec: {} });
    input.currentProjectRef.current = 'draft-2'; input.projectRevisionRef.current = 'revision-2'; input.projectRevisionProjectIdRef.current = 'draft-2';
    finish({ ok: !recovery, project: project({ id: 'draft-1', updatedAt: 'old-result' }), ...(recovery ? { recovery: 'reload_required' as const } : {}) });
    await pending;
    assert.equal(input.projectRevisionRef.current, 'revision-2'); assert.equal(input.projectRevisionProjectIdRef.current, 'draft-2');
    assert.equal(warnings.length, 0); assert.equal(input.projectSaveConflictRef.current, null);
  }
});

for (const outcome of ['success', 'conflict', 'failure'] as const) test(`full draft save ignores ${outcome} feedback from a project left while saving`, async t => {
  const updates: string[] = [];
  const { input, actions, warnings, errors } = fixture({
    workflowContext: { runId: 'run', taskId: 'task', taskKey: 'production' },
    setProjectId: id => { updates.push('project:' + id); }, setProjects: () => { updates.push('projects'); },
    setAutosaveStatus: status => { updates.push('status:' + status); },
  });
  let finish!: (result: Awaited<ReturnType<typeof studioApi.saveProject>>) => void;
  let fail!: (error: Error) => void;
  t.mock.method(studioApi, 'saveProject', () => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
  const queued: string[] = [];
  input.autosaveSnapshotRef.current = async () => { queued.push('old snapshot'); };
  const pending = actions.saveProject('draft', { silent: true });
  input.currentProjectRef.current = 'draft-2'; input.projectRevisionRef.current = 'revision-2'; input.projectRevisionProjectIdRef.current = 'draft-2';
  updates.length = 0; errors.length = 0;
  input.autosavePendingRef.current = true;
  input.autosaveSnapshotRef.current = async () => { queued.push('new snapshot'); };
  if (outcome === 'failure') fail(Error('old draft failed'));
  else finish({ ok: outcome === 'success', project: project({ updatedAt: 'old-result' }), ...(outcome === 'conflict' ? { recovery: 'reload_required' as const } : {}) });
  assert.equal(await pending, false);
  assert.equal(input.currentProjectRef.current, 'draft-2'); assert.equal(input.projectRevisionRef.current, 'revision-2');
  assert.deepEqual(updates, []); assert.deepEqual(errors, []); assert.deepEqual(warnings, []);
  await new Promise<void>(resolve => setImmediate(resolve)); assert.deepEqual(queued, ['new snapshot']);
});


test('a new project save reports its own committed identity without serializing the client callback', async t => {
  const { input, actions } = fixture({ projectId: null, currentProjectRef: ref<string | null>(null),
    workflowContext: { runId: 'run', taskId: 'task', taskKey: 'production' } });
  const writes: Parameters<typeof studioApi.saveProject>[0][] = [], committed: string[] = [];
  t.mock.method(studioApi, 'saveProject', async (write: Parameters<typeof studioApi.saveProject>[0]) => {
    writes.push(write); return { ok: true, project: project({ id: 'created', updatedAt: 'created-revision', spec: write.spec }) };
  });
  const overrides = { renderAcceptance: { accepted: true, renderPath: '/final.mp4' }, projectQualityRecords: [] };
  assert.equal(await actions.saveProject('draft', { silent: true, specOverrides: overrides,
    onSavedProject: id => { committed.push(id); assert.equal(input.currentProjectRef.current, id); } }), true);
  assert.deepEqual(committed, ['created']); assert.equal(input.currentProjectRef.current, 'created');
  assert.deepEqual(writes[0]?.spec.renderAcceptance, overrides.renderAcceptance);
  assert.equal('onSavedProject' in writes[0]!, false); assert.equal(input.projectRevisionRef.current, 'created-revision');
});

test('a delayed plan synchronization after save cannot publish old project plans or saved feedback', async t => {
  const updates: string[] = [];
  // Persistence only reads array presence here; plan construction is not under test.
  const marker = [{}] as unknown as StudioProjectLifecyclePorts['socialDigitalHumanPlans'];
  const { input, actions } = fixture({ socialDigitalHumanPlans: marker,
    workflowContext: { runId: 'run', taskId: 'task', taskKey: 'production' },
    setProductionPlans: () => { updates.push('plans'); }, setAutosaveStatus: status => { updates.push('status:' + status); } });
  t.mock.method(studioApi, 'saveProject', async () => ({ ok: true, project: project() }));
  let finish!: (plans: Awaited<ReturnType<typeof productionApi.syncAgentPlans>>) => void;
  t.mock.method(productionApi, 'syncAgentPlans', () => new Promise(resolve => { finish = resolve; }));
  const pending = actions.saveProject('draft', { silent: true });
  await new Promise<void>(resolve => setImmediate(resolve));
  input.currentProjectRef.current = 'draft-2'; updates.length = 0; finish([]);
  assert.equal(await pending, false); assert.deepEqual(updates, []);
});
