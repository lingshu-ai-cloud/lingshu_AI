import assert from 'node:assert/strict';
import fs from 'node:fs';

const standaloneApp = fs.readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const accountHubPage = fs.readFileSync(new URL('./AccountHubPage.tsx', import.meta.url), 'utf8');
const accountsPage = fs.readFileSync(new URL('./CodexAccountsPage.tsx', import.meta.url), 'utf8');
const standaloneConfig = fs.readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
const mainApp = fs.readFileSync(new URL('../../../src/App.tsx', import.meta.url), 'utf8');
const mainLayout = fs.readFileSync(new URL('../../../src/components/Layout.tsx', import.meta.url), 'utf8');
const mainRegistry = fs.readFileSync(new URL('../../../src/pageRegistry.ts', import.meta.url), 'utf8');

assert.match(standaloneApp, /AccountHubPage/, 'the standalone app must render the account hub');
assert.match(accountHubPage, /团队用量/, 'the standalone app must keep the team usage tab');
assert.match(accountHubPage, /AI 账号/, 'the standalone app must expose the account ownership tab');
assert.match(standaloneApp, /session\.platformAdmin === true/, 'access must require the server-verified platform-admin bit');
assert.match(standaloneApp, /!session\.supportAccess/, 'support sessions must not operate the host account hub');
assert.doesNotMatch(standaloneApp, /authApi\.register/, 'the operations app must not expose registration');
assert.match(standaloneApp, /这一步只验证管理台管理员身份，不是登录 Codex 或 Claude/, 'admin login must be clearly distinguished from provider login');
assert.match(accountsPage, /先看这里：账号怎么登录/, 'the accounts page must expose provider login onboarding');
assert.match(accountsPage, /codex login status/, 'the accounts page must explain how to verify local Codex login');
assert.doesNotMatch(accountsPage, /type="password"/, 'the accounts page must not collect provider passwords');
assert.match(standaloneConfig, /dist-account-hub/, 'the operations app must have an independent build output');
assert.match(standaloneConfig, /ACCOUNT_HUB_DEV_PORT \|\| 5178/, 'the operations app must use its own development port');
assert.match(standaloneConfig, /\.vite-account-hub/, 'the operations app must not share Vite dependency cache with the main app');
assert.doesNotMatch(accountsPage, /任务内容|提交任务|任务列表|取消任务/, 'account ownership must not include browser task dispatch');

for (const [name, source] of [
  ['main app', mainApp],
  ['main layout', mainLayout],
  ['main page registry', mainRegistry],
] as const) {
  assert.doesNotMatch(source, /accountHub|AccountHub/, `${name} must not register or render the standalone account hub`);
}

console.log('standalone account hub contract tests passed');
