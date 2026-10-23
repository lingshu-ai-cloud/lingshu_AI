import assert from 'node:assert/strict';
import test from 'node:test';
import { hydratedFocusNeedsWorkspaceStatus } from './useAssistantThreadHydration.js';

test('refresh recovery keeps an authoritative ContentTask focused for its dedicated server reread', () => {
  assert.equal(hydratedFocusNeedsWorkspaceStatus('social-content:content-1'), false);
  assert.equal(hydratedFocusNeedsWorkspaceStatus('assistant-current-status'), true);
  assert.equal(hydratedFocusNeedsWorkspaceStatus('run:weekly-1'), true);
  assert.equal(hydratedFocusNeedsWorkspaceStatus(null), false);
});
