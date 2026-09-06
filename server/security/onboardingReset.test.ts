import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { accountGuideStateFromEntry } from '../lib/demoAccounts.js';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

const oldScope = accountGuideStateFromEntry(undefined, 'user-1');
assert.equal(oldScope.pending, false);
assert.equal(oldScope.scope, 'user-1');

const resetAt = '2026-08-06T12:34:56.000Z';
const resetScope = accountGuideStateFromEntry({
  email: 'customer@example.com',
  password: '',
  guidePending: true,
  guideResetAt: resetAt,
}, 'user-1');
assert.equal(resetScope.pending, true);
assert.equal(resetScope.scope, `user-1:reset:${resetAt}`);

const consumedScope = accountGuideStateFromEntry({
  email: 'customer@example.com',
  password: '',
  guidePending: false,
  guideResetAt: resetAt,
}, 'user-1');
assert.equal(consumedScope.pending, false);
assert.equal(consumedScope.scope, resetScope.scope, 'consuming the trigger must not restore an old browser scope');

const authRoutes = read('server/routes/auth.ts');
assert.match(authRoutes, /authRouter\.post\('\/login'[\s\S]*?accountGuideState\([\s\S]*?guideTrigger: guide\.pending/, 'login must return the pending first-open guide');
assert.match(authRoutes, /authRouter\.get\('\/me'[\s\S]*?accountGuideState\([\s\S]*?guideTrigger: guide\.pending/, 'an existing signed-in session must receive the pending first-open guide');
assert.match(authRoutes, /authRouter\.post\('\/guide-seen'[\s\S]*?consumeDemoGuide\(email\)/, 'the guide trigger must be consumed only after the client reports it shown');

const app = read('src/App.tsx');
assert.doesNotMatch(app, /BusinessDiagnosisModal|setBusinessDiagnosisOpen|showBusinessDiagnosisFor/, 'login must not reopen a duplicate reception configuration');
const customerConfig = read('src/components/DigitalEmployeePage.tsx');
assert.match(customerConfig, /activeRuleAgent === "customer"[\s\S]*?<KnowledgeIntakePanel/, 'customer Agent configuration must retain reception knowledge intake');

const resetScript = read('scripts/reset-account-guide.ts');
assert.match(resetScript, /pbListStrict[\s\S]*?resetAccountGuide\(email/, 'the reset command must verify the real account before changing guide state');

console.log('onboarding reset tests passed');
