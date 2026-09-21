import assert from 'node:assert/strict';
import {
  VISIBLE_DIGITAL_EMPLOYEE_AGENT_ROLES,
  visibleDigitalEmployeeAgentRole,
} from './agentRoles.js';

assert.deepEqual(VISIBLE_DIGITAL_EMPLOYEE_AGENT_ROLES, ['orchestrator', 'business', 'director', 'content', 'customer']);
assert.equal(visibleDigitalEmployeeAgentRole('industry'), 'director', 'legacy industry is read-compatible only as director');
assert.equal(visibleDigitalEmployeeAgentRole('industry', 'scheduled_source_collection'), 'director');
assert.equal(visibleDigitalEmployeeAgentRole('content', 'platform_publish'), 'business', 'task ownership wins over stale role data');
assert.equal(visibleDigitalEmployeeAgentRole('channel', 'publishing_calendar'), 'business');
assert.equal(visibleDigitalEmployeeAgentRole('industry', 'content_production'), 'content');
assert.equal(visibleDigitalEmployeeAgentRole('planner', 'goal_decomposition'), 'orchestrator');
assert.equal(visibleDigitalEmployeeAgentRole('review', 'weekly_review'), 'business');
assert.equal(visibleDigitalEmployeeAgentRole('risk', 'followup_batch_approval'), 'customer');

console.log('digital employee public role compatibility tests passed');
