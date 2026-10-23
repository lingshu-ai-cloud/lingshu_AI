import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { restoreStudioProjectComposition } from '../../../tests/fixtures/studioProjectComposition';

const source = readFileSync(new URL('../AiCreateStudio.tsx', import.meta.url), 'utf8');

test('source contracts compose the current project implementations with their real bindings', () => {
  const composed = restoreStudioProjectComposition(source);
  assert.match(composed, /const applySpec = \(savedSpec:/);
  assert.match(composed, /const saveProject = async/);
  assert.match(composed, /const currentProjectRef = useRef\(projectId\)/);
  assert.doesNotMatch(composed, /const projectPorts:/);
});

test('composition refuses a crossed project port rather than hiding it behind source restoration', () => {
  const crossed = source.replace('get projectTitle() { return projectTitle; }', 'get projectTitle() { return projectId; }');
  assert.notEqual(crossed, source);
  assert.throws(() => restoreStudioProjectComposition(crossed), /port binding mismatch/);
});

test('composition refuses crossed action and Hook argument bindings', () => {
  const crossedAction = source.replace('const applySpec = projectRestoration.applySpec;', 'const applySpec = projectRestoration.loadProject;');
  assert.notEqual(crossedAction, source);
  assert.throws(() => restoreStudioProjectComposition(crossedAction), /action binding mismatch/);
  const crossedHook = source.replace('useStudioProjectIdentityState(projectPorts)', 'useStudioProjectIdentityState(otherPorts)');
  assert.notEqual(crossedHook, source);
  assert.throws(() => restoreStudioProjectComposition(crossedHook), /hook port mismatch/);
});
