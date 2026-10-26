import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCreateSocialTask } from '../starter198/socialContentValidation.js';
import { defaultBrief } from '../starter198/socialContentTaskSupport.js';
import { requireSocialImageBudgetLimit } from './socialImageBudgetGate.js';

const input = { title: '面霜图文', objective: '展示轻盈质地', formats: ['social_image'], mode: 'instant' };

test('image orders may be saved without a cap but cannot start a paid stage', () => {
  const brief = defaultBrief(parseCreateSocialTask(input));
  assert.equal(brief.perItemBudgetCny, null);
  assert.throws(() => requireSocialImageBudgetLimit(brief), /social_image_budget_required/);
});

test('explicit image cap survives parsing and is required at paid admission', () => {
  const brief = defaultBrief(parseCreateSocialTask({ ...input, perItemBudgetCny: 5 }));
  assert.equal(brief.perItemBudgetCny, 5);
  assert.equal(requireSocialImageBudgetLimit(JSON.stringify(brief)), 5);
});
