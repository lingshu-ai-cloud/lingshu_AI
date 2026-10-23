import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { studioApi, type StudioProject, type StudioManualHandoff } from '../../lib/studioApi';
import type { ProjectQualityRecord } from './studioWorkspaceContracts';
import { createStudioDeliveryActions, studioDeliveryStatus, useStudioDeliveryWorkspace, type StudioDeliveryContext } from './studioDeliveryWorkspace';

const stamp = '2026-10-23T00:00:00Z';
const quality = (path = '/final.mp4'): ProjectQualityRecord => ({ id: 'quality', inputFingerprint: 'input', generationProvenance: 'ai',
  qualityStatus: 'passed', publishable: true, createdAt: stamp, renderPath: path, report: { gateVersion: 'v1', checks: [] } });
const project: StudioProject = { id: 'project', title: 'Project', status: 'draft', spec: {}, createdAt: stamp, updatedAt: stamp };
const handoff = (action: StudioManualHandoff['action'] = 'team_review', id = 'handoff'): StudioManualHandoff => ({
  id, action, status: action === 'team_review' ? 'pending_review' : 'planned', renderPath: '/final.mp4', createdAt: stamp, createdBy: 'user',
});
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(reviewed = true) {
  let state!: ReturnType<typeof useStudioDeliveryWorkspace>;
  function Probe() { state = useStudioDeliveryWorkspace(); return null; }
  renderToStaticMarkup(createElement(Probe));
  for (const key of Object.keys(state).filter(key => key.startsWith('set'))) {
    const field = key.slice(3, 4).toLowerCase() + key.slice(4);
    Object.assign(state, { [key]: (update: unknown) => {
      const target = state as unknown as Record<string, unknown>;
      target[field] = typeof update === 'function' ? update(target[field]) : update;
    } });
  }
  if (reviewed) { state.setReviewedRenderPath('/final.mp4'); state.setProjectQualityRecord(quality()); }
  const notices: string[] = [], events: string[] = [], saves: Array<Record<string, unknown> | undefined> = [], projects: StudioProject[] = [];
  let current = true;
  const input: StudioDeliveryContext = { projectId: 'project', currentReviewedOutputPath: '/final.mp4', creationMode: 'free_creation', isCurrent: () => current,
    saveDraft: async overrides => { events.push('save'); saves.push(overrides); return true; }, onNotice: notice => notices.push(notice),
    onProject: value => { events.push('project'); projects.push(value); } };
  return { state, input, notices, events, saves, projects, switchProject: () => { current = false; },
    actions: () => createStudioDeliveryActions(state) };
}

test.beforeEach(t => {
  if (!('mock' in t)) throw Error('Requires per-test context');
  const network = t.mock.method(globalThis, 'fetch', async () => { throw Error('unexpected real network'); });
  t.after(() => assert.equal(network.mock.callCount(), 0));
});

test('initial delivery state is idle and an unreviewed or different output cannot reuse a quality record', () => {
  const f = fixture(false);
  assert.equal(f.state.projectQualityBusy, false); assert.equal(f.state.manualHandoffBusy, '');
  assert.deepEqual(studioDeliveryStatus(f.state, '/final.mp4'), { currentRenderReviewed: false, currentProjectQualityRecord: null });
  f.state.setReviewedRenderPath('/final.mp4'); f.state.setProjectQualityRecord(quality('/old.mp4'));
  assert.equal(studioDeliveryStatus(f.state, '/final.mp4').currentProjectQualityRecord, null);
  f.state.setProjectQualityRecord(quality()); assert.equal(studioDeliveryStatus(f.state, '/final.mp4').currentProjectQualityRecord?.id, 'quality');
  assert.equal(studioDeliveryStatus(f.state, '/new.mp4').currentRenderReviewed, false);
});

test('acceptance persists the exact output and creation mode while invalidating the previous signed quality', async () => {
  const f = fixture(); f.state.setProjectQualityRecord(quality('/old.mp4'));
  f.input.creationMode = 'viral_replication'; await f.actions().updateRenderAcceptance(true, f.input);
  const saved = f.saves[0]!;
  assert.deepEqual({ ...(saved.renderAcceptance as object), acceptedAt: 'time' }, {
    accepted: true, renderPath: '/final.mp4', creationMode: 'viral_replication', acceptedAt: 'time',
  });
  assert.match(String((saved.renderAcceptance as Record<string, unknown>).acceptedAt), /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(saved.projectQualityRecords, []); assert.equal(saved.activeProjectQualityRecordId, '');
  assert.equal(f.state.reviewedRenderPath, '/final.mp4'); assert.equal(f.state.projectQualityRecord, null);
  assert.match(f.notices[0]!, /验收结果已保存/);
});

test('acceptance without an output makes no write; revocation saves a null acceptance and clears local eligibility', async () => {
  const f = fixture(); f.input.currentReviewedOutputPath = '';
  await f.actions().updateRenderAcceptance(true, f.input); assert.equal(f.saves.length, 0);
  f.state.setReviewedRenderPath('/final.mp4'); f.state.setProjectQualityRecord(quality());
  await f.actions().updateRenderAcceptance(false, f.input);
  assert.equal(f.saves[0]?.renderAcceptance, null); assert.equal(f.state.reviewedRenderPath, '');
  assert.equal(f.state.projectQualityRecord, null); assert.match(f.notices[0]!, /已撤销/);
});

test('failed acceptance restores the previous path without reusing invalidated quality', async () => {
  const f = fixture(); f.state.setReviewedRenderPath('/previous.mp4'); f.state.setProjectQualityRecord(quality('/previous.mp4'));
  f.input.saveDraft = async () => false;
  await f.actions().updateRenderAcceptance(true, f.input);
  assert.equal(f.state.reviewedRenderPath, '/previous.mp4'); assert.equal(f.state.projectQualityRecord, null);
  assert.match(f.notices[0]!, /验收结果保存失败/);
});

test('a late acceptance failure from the previous project cannot roll back the new project review state', async () => {
  const f = fixture(), save = deferred<boolean>(); f.input.saveDraft = () => save.promise;
  const pending = f.actions().updateRenderAcceptance(true, f.input);
  f.switchProject(); f.state.setReviewedRenderPath('/new-project.mp4'); f.state.setProjectQualityRecord(quality('/new-project.mp4'));
  save.resolve(false); await pending;
  assert.equal(f.state.reviewedRenderPath, '/new-project.mp4'); assert.equal(f.state.projectQualityRecord?.renderPath, '/new-project.mp4');
  assert.deepEqual(f.notices, []);
});

test('requality saves first, adopts the signed record and only then updates the project revision', async t => {
  const f = fixture();
  t.mock.method(studioApi, 'requalityProject', async (id: string) => { f.events.push('quality:' + id); return { ok: true, record: quality(), project }; });
  await f.actions().requalityCurrentProject(f.input);
  assert.deepEqual(f.events, ['save', 'quality:project', 'project']); assert.equal(f.state.projectQualityRecord?.id, 'quality');
  assert.equal(f.projects[0], project); assert.equal(f.state.projectQualityBusy, false); assert.match(f.state.projectQualityNotice, /签发新的生成记录/);
});

test('unsaved or unreviewed projects cannot start quality signing', async t => {
  const f = fixture(); const api = t.mock.method(studioApi, 'requalityProject', async () => { throw Error('unexpected quality'); });
  f.state.setReviewedRenderPath(''); await f.actions().requalityCurrentProject(f.input); assert.equal(f.saves.length, 0);
  f.state.setReviewedRenderPath('/final.mp4'); f.input.saveDraft = async () => false;
  await f.actions().requalityCurrentProject(f.input); assert.equal(api.mock.callCount(), 0);
  assert.equal(f.state.projectQualityRecord, null); assert.equal(f.state.projectQualityBusy, false);
  assert.match(f.state.projectQualityNotice, /尚未保存/);
});

test('a rejected quality check keeps all issues and does not create a publishable record', async t => {
  const f = fixture(); f.state.setProjectQualityRecord(quality());
  t.mock.method(studioApi, 'requalityProject', async () => ({ ok: false, issues: ['missing material', 'stale render'] }));
  await f.actions().requalityCurrentProject(f.input);
  assert.equal(f.state.projectQualityRecord, null); assert.equal(f.projects.length, 0);
  assert.equal(f.state.projectQualityNotice, 'missing material；stale render'); assert.equal(f.state.projectQualityBusy, false);
});

test('old quality receipts and project revisions are ignored after switching projects', async t => {
  const f = fixture(), result = deferred<Awaited<ReturnType<typeof studioApi.requalityProject>>>();
  t.mock.method(studioApi, 'requalityProject', () => result.promise);
  const pending = f.actions().requalityCurrentProject(f.input); await flush();
  f.switchProject(); f.state.setProjectQualityRecord(quality('/new-project.mp4'));
  result.resolve({ ok: true, record: quality(), project }); await pending;
  assert.equal(f.state.projectQualityRecord?.renderPath, '/new-project.mp4'); assert.equal(f.projects.length, 0);
  assert.equal(f.state.projectQualityNotice, ''); assert.equal(f.state.projectQualityBusy, false);
});

test('manual handoff admission requires a saved project, reviewed output and matching quality record', async t => {
  const f = fixture(); const api = t.mock.method(studioApi, 'createManualHandoff', async () => { throw Error('unexpected handoff'); });
  const cases = [
    { input: { projectId: null } }, { reviewed: '' }, { input: { currentReviewedOutputPath: '' } },
    { record: null }, { record: quality('/other.mp4') },
  ];
  for (const change of cases) {
    f.state.setReviewedRenderPath(change.reviewed ?? '/final.mp4');
    f.state.setProjectQualityRecord('record' in change ? change.record ?? null : quality());
    await f.actions().submitManualHandoff('team_review', { ...f.input, ...change.input });
  }
  f.state.setReviewedRenderPath('/final.mp4'); f.state.setProjectQualityRecord(quality());
  f.state.setManualHandoffBusy('team_review'); await f.actions().submitManualHandoff('team_review', f.input);
  assert.equal(api.mock.callCount(), 0); assert.equal(f.saves.length, 0);
});

test('team review and publishing tasks preserve the reviewed path, deduplicate receipts and never auto-publish', async t => {
  const f = fixture();
  const api = t.mock.method(studioApi, 'createManualHandoff', async (_id: string, body: Parameters<typeof studioApi.createManualHandoff>[1]) => {
    f.events.push('handoff:' + body.action); return { ok: true, handoff: handoff(body.action) };
  });
  for (const action of ['team_review', 'publishing_plan'] as const) await f.actions().submitManualHandoff(action, f.input);
  assert.deepEqual(f.events, ['save', 'handoff:team_review', 'save', 'handoff:publishing_plan']);
  assert.deepEqual(api.mock.calls.map(call => call.arguments), [
    ['project', { action: 'team_review', renderPath: '/final.mp4', reviewed: true }],
    ['project', { action: 'publishing_plan', renderPath: '/final.mp4', reviewed: true }],
  ]);
  assert.equal(f.state.manualHandoffs.length, 1); assert.equal(f.state.manualHandoffs[0]?.action, 'publishing_plan');
  assert.match(f.state.manualHandoffNotice, /待办.*团队继续确认日期、账号和发布授权/); assert.equal(f.state.manualHandoffBusy, '');
});

test('failed handoff preserves the existing list and clears the busy flag', async t => {
  const f = fixture(); f.state.setManualHandoffs([handoff('team_review', 'existing')]);
  t.mock.method(studioApi, 'createManualHandoff', async () => ({ ok: false, error: 'fixture receipt rejected' }));
  await f.actions().submitManualHandoff('team_review', f.input);
  assert.deepEqual(f.state.manualHandoffs.map(item => item.id), ['existing']); assert.equal(f.state.manualHandoffBusy, '');
  assert.equal(f.state.manualHandoffNotice, 'fixture receipt rejected');
});

test('a project switch during save prevents a handoff request', async t => {
  const f = fixture(); f.input.saveDraft = async () => { f.switchProject(); return true; };
  const api = t.mock.method(studioApi, 'createManualHandoff', async () => { throw Error('unexpected handoff'); });
  await f.actions().submitManualHandoff('team_review', f.input);
  assert.equal(api.mock.callCount(), 0); assert.equal(f.state.manualHandoffBusy, ''); assert.equal(f.state.manualHandoffNotice, '');
});

test('a late handoff receipt cannot replace the new project list or notice', async t => {
  const f = fixture(), result = deferred<Awaited<ReturnType<typeof studioApi.createManualHandoff>>>();
  t.mock.method(studioApi, 'createManualHandoff', () => result.promise);
  const pending = f.actions().submitManualHandoff('team_review', f.input); await flush();
  f.switchProject(); f.state.setManualHandoffs([handoff('team_review', 'new-project')]);
  result.resolve({ ok: true, handoff: handoff() }); await pending;
  assert.deepEqual(f.state.manualHandoffs.map(item => item.id), ['new-project']); assert.equal(f.state.manualHandoffNotice, '');
});

test('manual list recovery replaces the list only while its project remains active and the reader is alive', async t => {
  const f = fixture(), result = deferred<Awaited<ReturnType<typeof studioApi.listManualHandoffs>>>();
  t.mock.method(studioApi, 'listManualHandoffs', () => result.promise);
  const reader = f.actions().readManualHandoffs({ projectId: 'project', isCurrent: f.input.isCurrent });
  const pending = reader.refresh(); reader.dispose(); result.resolve({ ok: true, handoffs: [handoff()] }); await pending;
  assert.equal(f.state.manualHandoffs.length, 0);
  const active = f.actions().readManualHandoffs({ projectId: 'project', isCurrent: f.input.isCurrent });
  await active.refresh(); assert.equal(f.state.manualHandoffs[0]?.id, 'handoff');
  f.switchProject(); f.state.setManualHandoffs([handoff('team_review', 'new-project')]); await active.refresh();
  assert.equal(f.state.manualHandoffs[0]?.id, 'new-project');
});

test('manual list failure preserves readable receipts and reports the failure without swallowing a project switch', async t => {
  const f = fixture(); f.state.setManualHandoffs([handoff()]);
  t.mock.method(studioApi, 'listManualHandoffs', async () => { throw Error('fixture list failed'); });
  const reader = f.actions().readManualHandoffs({ projectId: 'project', isCurrent: f.input.isCurrent });
  await reader.refresh(); assert.equal(f.state.manualHandoffs[0]?.id, 'handoff'); assert.equal(f.state.manualHandoffNotice, 'fixture list failed');
  f.state.setManualHandoffNotice('new-project notice'); f.switchProject(); await reader.refresh();
  assert.equal(f.state.manualHandoffNotice, 'new-project notice');
});

test('the actual page draft bridge follows its own committed project ID and keeps later project switches invalid', async () => {
  const source = readFileSync(new URL('../AiCreateStudio.tsx', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('AiCreateStudio.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  function walk(node: ts.Node) { if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'createDeliveryContext') expression = node.initializer; ts.forEachChild(node, walk); }
  walk(parsed); assert.ok(expression);
  const adopted: string[] = []; let listed: StudioProject[] = [];
  const writes: unknown[][] = [], currentProjectRef = { current: null as string | null };
  const env = { projectId: null, currentProjectRef, currentReviewedOutputPath: '/final.mp4', currentRenderReviewed: true,
    currentProjectQualityRecord: quality(), mode: 'material', setModeNotice: () => {}, adoptEditorProjectRevision: (value: StudioProject) => { adopted.push(value.updatedAt); },
    setProjects: (update: (current: StudioProject[]) => StudioProject[]) => { listed = update(listed); },
    saveProject: async (...args: [string, { specOverrides?: Record<string, unknown>; onSavedProject?(id: string): void }]) => {
      writes.push(args); currentProjectRef.current = 'created-project'; args[1].onSavedProject?.('created-project'); return true;
    } };
  const js = ts.transpileModule('const subject = ' + expression.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const context: StudioDeliveryContext = new Function(...Object.keys(env), js + '\nreturn subject;')(...Object.values(env))();
  const overrides = { renderAcceptance: { accepted: true, renderPath: '/final.mp4' } };
  assert.equal(await context.saveDraft(overrides), true); assert.equal(writes[0]?.[0], 'draft');
  assert.equal((writes[0]?.[1] as { specOverrides?: unknown }).specOverrides, overrides); assert.equal(context.isCurrent(), true);
  context.onProject(project); assert.deepEqual(adopted, [stamp]); assert.deepEqual(listed, [project]);
  currentProjectRef.current = 'another-project'; assert.equal(context.isCurrent(), false);
});
