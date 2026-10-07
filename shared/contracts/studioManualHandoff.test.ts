import assert from 'node:assert/strict';
import { isManualStudioProject, studioProjectRenderPaths } from './studioManualHandoff';

assert.equal(isManualStudioProject({ creationPath: 'free_creation', manualWorkflow: true }), true);
assert.equal(isManualStudioProject({ creationPath: 'free_creation', manualWorkflow: true, automation: { managedBy: 'digital_employee' } }), false);
assert.equal(isManualStudioProject({ creationPath: 'viral_replication', manualWorkflow: true }), false);
assert.deepEqual(studioProjectRenderPaths({ languageRenderOutputs: {
  done: { status: 'done', path: '/tmp/a.mp4' }, pending: { status: 'rendering', path: '/tmp/b.mp4' },
}, languageRenderVersions: { en: [{ status: 'done', path: '/tmp/c.mp4' }] } }), ['/tmp/a.mp4', '/tmp/c.mp4']);

console.log('studio manual handoff contract tests passed');
