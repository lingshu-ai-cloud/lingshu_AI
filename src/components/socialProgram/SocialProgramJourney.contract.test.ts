import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const layout = readFileSync(new URL('../Layout.tsx', import.meta.url), 'utf8');
const frame = readFileSync(new URL('./SocialProgramPageFrame.tsx', import.meta.url), 'utf8');
const setup = readFileSync(new URL('./SocialSetupPage.tsx', import.meta.url), 'utf8');
const accounts = readFileSync(new URL('./SocialAccountsPage.tsx', import.meta.url), 'utf8');
const planning = readFileSync(new URL('./SocialPlanningPage.tsx', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('./SocialWorkspacePage.tsx', import.meta.url), 'utf8');
const registry = readFileSync(new URL('../../pageRegistry.ts', import.meta.url), 'utf8');

assert.match(layout, /label: '社媒矩阵经营',[\s\S]{0,100}items: \[navItem\('socialWorkspace'/,
  'the sidebar must expose one social-program entry');
assert.doesNotMatch(layout, /SOCIAL_PROGRAM_NAV_PAGES\.map/,
  'the four social-program steps must not be repeated as top-level navigation');
for (const page of ['socialSetup', 'socialAccounts', 'socialPlanning']) {
  assert.match(registry, new RegExp(`${page}: \\{[^}]+navParent: 'socialWorkspace'`), `${page} must keep the consolidated sidebar entry active`);
}
for (const step of ['项目方向', '账号矩阵', '月周计划', '执行复盘']) assert.match(frame, new RegExp(step));
assert.match(frame, /aria-current=\{active \? 'step'/);
assert.match(setup, /下一步：配置账号矩阵/);
assert.match(accounts, /下一步：制定月周计划/);
assert.match(planning, /下一步：执行与复盘/);
assert.match(planning, /<details className="rounded-xl border border-border bg-white/,
  'advanced operating constraints must stay collapsed outside the main journey');
assert.match(workspace, /系统只推荐一个主动作/);

console.log('social program journey contract tests passed');
