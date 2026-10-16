import assert from 'node:assert/strict';
import test from 'node:test';
import { studioApi, type StudioProject } from './studioApi.js';

const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });

const project = (id: string, updatedAt: string, spec: Record<string, unknown> = {}): StudioProject => ({
  id,
  title: 'draft',
  status: 'draft',
  spec,
  updatedAt,
  createdAt: 'created',
});

test.after(() => {
  globalThis.fetch = originalFetch;
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('passive list refresh does not advance an open editor baseline', async () => {
  const initial = project('save-passive-list', 'v1', { script: 'base' });
  studioApi.adoptProjectRevision(initial);
  globalThis.fetch = async () => new Response(JSON.stringify([initial]));
  await studioApi.listProjects();
  globalThis.fetch = async () => new Response(JSON.stringify([{ ...initial, updatedAt: 'v2' }]));
  await studioApi.listProjects();
  globalThis.fetch = async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).baseUpdatedAt, 'v1');
    return new Response(JSON.stringify({ ok: true, project: { ...initial, updatedAt: 'v3' } }));
  };
  assert.equal((await studioApi.saveProject({ id: initial.id, title: initial.title, status: initial.status, spec: initial.spec })).ok, true);
});

test('read-only project polling does not advance an adopted editor baseline', async () => {
  const initial = project('save-passive-get', 'g1', { script: 'base' });
  studioApi.adoptProjectRevision(initial);
  globalThis.fetch = async (_url, init) => {
    if (!init?.method) return new Response(JSON.stringify({ ...initial, updatedAt: 'g2', spec: { script: 'server' } }));
    assert.equal(JSON.parse(String(init.body)).baseUpdatedAt, 'g1');
    return new Response(JSON.stringify({ ok: false, code: 'studio_project_version_conflict', project: { ...initial, updatedAt: 'g2', spec: { script: 'server' } } }), { status: 409 });
  };
  const polled = await studioApi.getProject(initial.id);
  assert.equal(polled.updatedAt, 'g2');
  const saved = await studioApi.saveProject({ id: initial.id, title: initial.title, status: initial.status, spec: initial.spec });
  assert.equal(saved.ok, true, 'the unchanged local snapshot can safely adopt the remote read after a 409 merge');
  assert.equal(saved.recoveredFromConflict, true);
});

test('409 disjoint changes are merged and retried against the server revision', async () => {
  const initial = project('save-safe-merge', 'm1', { script: 'base', production: { state: 'pending' } });
  studioApi.adoptProjectRevision(initial);
  const requests: Array<Record<string, any>> = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    if (requests.length === 1) {
      return new Response(JSON.stringify({
        ok: false,
        code: 'studio_project_version_conflict',
        project: project(initial.id, 'm2', { script: 'base', production: { state: 'completed', jobId: 'job-1' } }),
      }), { status: 409 });
    }
    return new Response(JSON.stringify({ ok: true, project: project(initial.id, 'm3', body.spec) }));
  };
  const saved = await studioApi.saveProject({
    id: initial.id,
    title: initial.title,
    status: initial.status,
    spec: { script: 'local edit', production: { state: 'pending' } },
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.recoveredFromConflict, true);
  assert.equal(requests[1]?.baseUpdatedAt, 'm2');
  assert.deepEqual(requests[1]?.spec, { script: 'local edit', production: { state: 'completed', jobId: 'job-1' } });
});

test('same-leaf conflicts stop and require the caller to reload', async () => {
  const initial = project('save-hard-conflict', 'c1', { script: 'base' });
  studioApi.adoptProjectRevision(initial);
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      ok: false,
      code: 'studio_project_version_conflict',
      project: project(initial.id, 'c2', { script: 'server edit' }),
    }), { status: 409 });
  };
  const saved = await studioApi.saveProject({
    id: initial.id,
    title: initial.title,
    status: initial.status,
    spec: { script: 'local edit' },
  });
  assert.equal(saved.ok, false);
  assert.equal(saved.recovery, 'reload_required');
  assert.deepEqual(saved.conflicts, ['spec.script']);
  assert.equal(calls, 1, 'an unsafe merge must never be retried');
});

test('a preserved revision without an in-memory baseline reloads instead of blind retrying', async () => {
  const latest = project('save-after-hot-reload', 'h2', { serverReceipt: 'paid-job' });
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    assert.equal(JSON.parse(String(init?.body)).baseUpdatedAt, 'h1');
    return new Response(JSON.stringify({ ok: false, code: 'studio_project_version_conflict', project: latest }), { status: 409 });
  };
  const saved = await studioApi.saveProject({
    id: latest.id,
    title: latest.title,
    status: latest.status,
    spec: { localDraft: true },
    baseUpdatedAt: 'h1',
  });
  assert.equal(saved.ok, false);
  assert.equal(saved.recovery, 'reload_required');
  assert.deepEqual(saved.project.spec, latest.spec);
  assert.equal(calls, 1);
});

test('an editor with neither revision nor baseline reads and reloads without posting a full snapshot', async () => {
  const latest = project('save-without-any-baseline', 'n2', { serverReceipt: 'latest-paid-job' });
  let reads = 0;
  let writes = 0;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === 'POST') {
      writes += 1;
      throw new Error('an unversioned full snapshot must not be posted');
    }
    reads += 1;
    return new Response(JSON.stringify(latest));
  };
  const saved = await studioApi.saveProject({
    id: latest.id,
    title: latest.title,
    status: latest.status,
    spec: { localDraft: true },
  });
  assert.equal(saved.ok, false);
  assert.equal(saved.recovery, 'reload_required');
  assert.equal(saved.code, 'studio_project_editor_baseline_missing');
  assert.deepEqual(saved.project.spec, latest.spec);
  assert.equal(reads, 1);
  assert.equal(writes, 0);
});

test('queued full snapshots preserve the preceding successful save', async () => {
  const initial = project('save-queued', 'q1', { script: 'base', settings: { ratio: '9:16' } });
  studioApi.adoptProjectRevision(initial);
  const requests: Array<Record<string, any>> = [];
  let releaseFirst!: (response: Response) => void;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    if (requests.length === 1) return await new Promise<Response>(resolve => { releaseFirst = resolve; });
    return new Response(JSON.stringify({ ok: true, project: project(initial.id, 'q3', body.spec) }));
  };
  const first = studioApi.saveProject({
    id: initial.id,
    title: initial.title,
    status: initial.status,
    spec: { script: 'first save', settings: { ratio: '9:16' } },
  });
  const second = studioApi.saveProject({
    id: initial.id,
    title: 'renamed while queued',
    status: initial.status,
    spec: initial.spec,
  });
  assert.equal(requests.length, 1);
  releaseFirst(new Response(JSON.stringify({
    ok: true,
    project: project(initial.id, 'q2', { script: 'first save', settings: { ratio: '9:16' } }),
  })));
  assert.equal((await first).ok, true);
  const queued = await second;
  assert.equal(queued.ok, true);
  assert.equal(queued.recoveredFromConflict, true);
  assert.equal(requests[1]?.baseUpdatedAt, 'q2');
  assert.equal(requests[1]?.title, 'renamed while queued');
  assert.equal(requests[1]?.spec.script, 'first save');
});
