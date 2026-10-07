import assert from 'node:assert/strict';
import { studioApi } from './studioApi.js';

const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
const project = { id: 'save-regression', title: 'draft', status: 'draft', spec: {}, updatedAt: 'v1', createdAt: 'v1' };
try {
  globalThis.fetch = async () => new Response(JSON.stringify([project]));
  await studioApi.listProjects();
  // Merely refreshing the list cannot advance an open editor's baseline.
  globalThis.fetch = async () => new Response(JSON.stringify([{ ...project, updatedAt: 'v2' }]));
  await studioApi.listProjects();
  globalThis.fetch = async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).baseUpdatedAt, 'v1');
    return new Response(JSON.stringify({ ok: false, code: 'studio_project_version_conflict', error: '请刷新后继续', project: { ...project, updatedAt: 'v2' } }), { status: 409 });
  };
  const rejected = await studioApi.saveProject({ id: project.id, title: 'draft', status: 'draft', spec: {} });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'studio_project_version_conflict');
  assert.equal(rejected.error, '请刷新后继续');
  assert.equal(rejected.project.updatedAt, 'v2');
  // A rejected response must not permit the stale draft to overwrite v2 on retry.
  await studioApi.saveProject({ id: project.id, title: 'draft', status: 'draft', spec: {} });
  studioApi.adoptProjectRevision({ ...project, status: 'draft', updatedAt: 'v2' });
  globalThis.fetch = async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).baseUpdatedAt, 'v2');
    return new Response(JSON.stringify({ ok: true, project: { ...project, updatedAt: 'v3' } }));
  };
  await studioApi.saveProject({ id: project.id, title: 'draft', status: 'draft', spec: {} });
  globalThis.fetch = async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).baseUpdatedAt, 'v3');
    return new Response(JSON.stringify({ ok: false, code: 'studio_project_storage_unavailable', error: '草稿未能写入存储' }), { status: 503 });
  };
  const unavailable = await studioApi.saveProject({ id: project.id, title: 'draft', status: 'draft', spec: {} });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.code, 'studio_project_storage_unavailable');
  assert.equal(unavailable.error, '草稿未能写入存储');
  const queuedProject = { ...project, id: 'save-queued', status: 'draft' as const, updatedAt: 'q1' };
  studioApi.adoptProjectRevision(queuedProject);
  const requests: Array<{ id: string; baseUpdatedAt?: string; spec: Record<string, unknown> }> = [];
  let releaseFirst!: (response: Response) => void;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    if (body.spec.sequence === 1) return await new Promise<Response>(resolve => { releaseFirst = resolve; });
    if (body.spec.sequence === 2) return new Response(JSON.stringify({ ok: false, code: 'studio_project_version_conflict', project: { ...queuedProject, updatedAt: 'external-q3' } }), { status: 409 });
    return new Response(JSON.stringify({ ok: true, project: { ...queuedProject, id: body.id, updatedAt: 'q3' } }));
  };
  const first = studioApi.saveProject({ id: queuedProject.id, title: 'draft', status: 'draft', spec: { sequence: 1 } });
  const second = studioApi.saveProject({ id: queuedProject.id, title: 'draft', status: 'draft', spec: { sequence: 2 } });
  const third = studioApi.saveProject({ id: queuedProject.id, title: 'draft', status: 'draft', spec: { sequence: 3 } });
  const independent = studioApi.saveProject({ id: 'independent-save', title: 'draft', status: 'draft', spec: {} });
  assert.equal((await independent).ok, true, 'another project must not wait for the blocked project');
  assert.deepEqual(requests.map(item => item.id), [queuedProject.id, 'independent-save']);
  releaseFirst(new Response(JSON.stringify({ ok: true, project: { ...queuedProject, updatedAt: 'q2' } })));
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, false);
  assert.equal((await third).ok, true);
  assert.deepEqual(requests.filter(item => item.id === queuedProject.id).map(item => item.baseUpdatedAt), ['q1', 'q2', 'q2'], 'queued writes use the preceding successful revision; a conflict cannot advance it');
} finally {
  globalThis.fetch = originalFetch;
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
}
