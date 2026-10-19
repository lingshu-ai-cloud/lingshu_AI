import assert from 'node:assert/strict';
import {
  PRODUCTION_ALLOWED_COMMANDS,
  PRODUCTION_READ_MODEL_SCHEMA,
} from './productionReadModel.js';
import {
  PRODUCTION_ALLOWED_COMMANDS as WORKFLOW_ALLOWED_COMMANDS,
  PRODUCTION_READ_MODEL_SCHEMA as WORKFLOW_READ_MODEL_SCHEMA,
} from './socialContentWorkflow.js';

assert.equal(PRODUCTION_READ_MODEL_SCHEMA, 'production-read-model.v1');
assert.strictEqual(WORKFLOW_READ_MODEL_SCHEMA, PRODUCTION_READ_MODEL_SCHEMA,
  'the social workflow entry point must expose the canonical read-model schema');
assert.strictEqual(WORKFLOW_ALLOWED_COMMANDS, PRODUCTION_ALLOWED_COMMANDS,
  'the social workflow entry point must re-export the same command authority list');
assert.equal(new Set(PRODUCTION_ALLOWED_COMMANDS).size, PRODUCTION_ALLOWED_COMMANDS.length);
for (const command of [
  'open_shot',
  'select_material',
  'upload_product_asset',
  'connect_account',
  'confirm_production_choice',
  'generate',
  'request_shoot',
  'review_output',
  'approve_output',
] as const) {
  assert.ok(PRODUCTION_ALLOWED_COMMANDS.includes(command), `missing canonical command: ${command}`);
}

console.log('production read model contract tests passed');
