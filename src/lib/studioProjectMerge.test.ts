import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeStudioProjectWrite, type StudioProjectMergeSnapshot } from './studioProjectMerge.js';

const baseProject = (): StudioProjectMergeSnapshot => ({
  id: 'project-1',
  title: '草稿',
  status: 'draft',
  updatedAt: 'v1',
  spec: {
    script: '原口播',
    shotProductions: {
      shot1: { settings: { avatarId: 'avatar-1' }, provider: { state: 'pending' } },
    },
    storyboardAssignments: ['material-1'],
  },
});

test('disjoint local and server leaves merge without dropping either update', () => {
  const base = baseProject();
  const result = mergeStudioProjectWrite(
    base,
    {
      id: base.id,
      title: base.title,
      status: base.status,
      spec: {
        ...base.spec,
        script: '本页新口播',
      },
    },
    {
      ...base,
      updatedAt: 'v2',
      spec: {
        ...base.spec,
        shotProductions: {
          shot1: { settings: { avatarId: 'avatar-1' }, provider: { state: 'completed', jobId: 'job-1' } },
        },
      },
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.write.spec.script, '本页新口播');
  assert.deepEqual((result.write.spec.shotProductions as any).shot1.provider, { state: 'completed', jobId: 'job-1' });
});

test('two different edits to the same leaf require a reload', () => {
  const base = baseProject();
  const result = mergeStudioProjectWrite(
    base,
    { id: base.id, title: base.title, status: base.status, spec: { ...base.spec, script: '本页新口播' } },
    { ...base, updatedAt: 'v2', spec: { ...base.spec, script: '服务端新口播' } },
  );
  assert.deepEqual(result, { ok: false, conflictPaths: ['spec.script'] });
});

test('timeline arrays are atomic and never silently interleaved', () => {
  const base = baseProject();
  const result = mergeStudioProjectWrite(
    base,
    {
      id: base.id,
      title: base.title,
      status: base.status,
      spec: { ...base.spec, storyboardAssignments: ['material-1', 'material-local'] },
    },
    {
      ...base,
      updatedAt: 'v2',
      spec: { ...base.spec, storyboardAssignments: ['material-1', 'material-server'] },
    },
  );
  assert.deepEqual(result, { ok: false, conflictPaths: ['spec.storyboardAssignments'] });
});

test('a queued snapshot absorbs the preceding save before it is sent', () => {
  const base = baseProject();
  const firstSaved = { ...base, updatedAt: 'v2', spec: { ...base.spec, script: '第一处本页修改' } };
  const result = mergeStudioProjectWrite(
    base,
    {
      id: base.id,
      title: '第二处标题修改',
      status: base.status,
      spec: base.spec,
    },
    firstSaved,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.write.title, '第二处标题修改');
  assert.equal(result.write.spec.script, '第一处本页修改');
});
