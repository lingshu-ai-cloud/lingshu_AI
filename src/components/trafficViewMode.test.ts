import assert from 'node:assert/strict';
import {
  resolveInitialTrafficViewMode,
  resolveNavigationEventViewMode,
  resolveSignalViewMode,
  resolveWorkflowNavigationPage,
} from './trafficViewMode';

assert.equal(
  resolveInitialTrafficViewMode(null, 'create'),
  'create',
  'a remount must restore the persisted creation workflow',
);

assert.equal(resolveInitialTrafficViewMode('publish', 'create'), 'publish');
assert.equal(resolveInitialTrafficViewMode(null, 'unsupported-view'), 'materials');
assert.equal(resolveInitialTrafficViewMode('unsupported-view', null), 'materials');

assert.equal(
  resolveSignalViewMode('create', true),
  'create',
  'restore/kickoff signals must not interrupt an active creation workflow',
);

assert.equal(resolveSignalViewMode('publish', true), 'materials');
assert.equal(resolveSignalViewMode('accounts', false), 'accounts');

assert.equal(
  resolveNavigationEventViewMode('create', 'materials'),
  'create',
  'a programmatic materials event must not interrupt creation',
);
assert.equal(resolveNavigationEventViewMode('materials', 'create'), 'create');

assert.equal(resolveWorkflowNavigationPage('materials', false), 'smartAssets');
assert.equal(resolveWorkflowNavigationPage('materials', true), null);
assert.equal(resolveWorkflowNavigationPage('create', false), null);

console.log('traffic view mode tests passed');
