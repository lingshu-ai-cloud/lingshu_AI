import test from 'node:test';
import assert from 'node:assert/strict';
import { readFreeCreationDraft } from './readFreeCreationDraft';
import { platformRewriteDraft } from '../../shared/contracts/platformRewriteDraft';
import { freeCreationCompletionIssues } from '../../shared/contracts/freeCreationProject';
import { continuePlatformRewrite } from './platformRewriteNavigation';
import type { StudioProject } from './studioApi';

test('explicit rewrite continuation reads its own draft and never falls back to remembered content', async () => {
  const spec = { script: '人工修改后的口播', caption: '保留配文', freeCreation: platformRewriteDraft('人工修改后的口播', 'YouTube', 'zh') };
  const project: StudioProject = { id: 'new-version', title: '新稿', status: 'draft', spec, createdAt: '', updatedAt: '' };
  let listCalls = 0;
  const reader = { getProject: async (id: string) => { assert.equal(id, project.id); return project; }, listProjects: async () => { listCalls++; return []; } };
  assert.equal(await readFreeCreationDraft('new-version', 'unrelated-old-draft', reader), project);
  assert.equal(listCalls, 0);
  await assert.rejects(readFreeCreationDraft('new-version', 'old', { ...reader, getProject: async () => { throw Error('forbidden'); } }), /forbidden/);
  await assert.rejects(readFreeCreationDraft('new-version', 'old', { ...reader, getProject: async () => ({ ...project, status: 'published' }) }), /无法继续/);
  assert.equal(listCalls, 0);
  assert.ok(freeCreationCompletionIssues(spec.freeCreation).includes('至少选择一个主推产品'));
});

test('long platform narration survives the current structured draft reader', () => {
  const script = '产品口播。'.repeat(1800);
  const state = platformRewriteDraft(script, 'Instagram', 'en');
  assert.equal(state.script.lines.map(line => line.narration).join(''), script);
  assert.equal(state.script.lines.filter(line => line.primaryHook).length, 1);
  assert.equal(state.script.status, 'draft');
});

test('each saved version targets current content creation without legacy script-library or auto execution', () => {
  const originalWindow = globalThis.window;
  const originalEvent = globalThis.CustomEvent;
  const details: any[] = [];
  Object.assign(globalThis, { CustomEvent: class { constructor(public type: string, public init: any) {} },
    window: { localStorage: { getItem: () => null }, dispatchEvent: (event: any) => details.push(event.init.detail) } });
  try {
    continuePlatformRewrite('version-a'); continuePlatformRewrite('version-b');
    assert.deepEqual(details.map(d => d.contentCreationRequest.continueProjectId), ['version-a', 'version-b']);
    for (const detail of details) { assert.equal(detail.page, 'smartAssets'); assert.equal(detail.directStudio, false); assert.equal(detail.contentCreationRequest.resumeEditableDraft, true); assert.equal(detail.contentCreationRequest.continueTaskId, undefined); }
  } finally { Object.assign(globalThis, { window: originalWindow, CustomEvent: originalEvent }); }
});
