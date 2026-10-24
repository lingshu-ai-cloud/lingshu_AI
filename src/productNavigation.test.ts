import assert from 'node:assert/strict';
import { accountProductNavigation, primaryProductNavigation, modeSwitchDestination } from './productNavigation.js';
import { isAdminSession, ROLE_PAGE_ACCESS } from './appSession.js';
import type { AuthSession } from './lib/auth.js';
import { readCreationMode, writeCreationMode } from './lib/creationMode.js';
import type { Page } from './pageRegistry.js';

const all = new Set<Page>(['strategy', 'socialInspiration', 'digitalEmployees', 'adsOverview', 'conversion']);
assert.deepEqual(primaryProductNavigation('free', all, false).map(item => item.label),
  ['hi，灵小枢', '内容创作', '智能投流', '智能客服', '经营总览']);
assert.deepEqual(primaryProductNavigation('employee', all, false).map(item => item.label),
  ['hi，灵小枢', '内容创作', '智能投流', '智能客服', '经营总览']);
assert.equal(primaryProductNavigation('free', all, false)[2]?.disabled, true);
assert.equal(primaryProductNavigation('free', all, true)[2]?.disabled, false);
assert.deepEqual(primaryProductNavigation('free', new Set<Page>(['strategy', 'conversion']), false).map(item => item.label),
  ['hi，灵小枢', '智能客服']);
assert.equal(modeSwitchDestination('socialInspiration', 'employee'), 'socialInspiration');
assert.equal(modeSwitchDestination('socialInspiration', 'free'), 'socialInspiration');

const adminSession = { platformAdmin: true, user: { role: 'super_admin' } } as AuthSession;
assert.deepEqual(accountProductNavigation(ROLE_PAGE_ACCESS.customer_service, false), []);
assert.deepEqual(accountProductNavigation(ROLE_PAGE_ACCESS.admin, false), ['enterprise', 'plugins']);
assert.doesNotMatch(accountProductNavigation(ROLE_PAGE_ACCESS.admin, false).join(','), /agentMemory|organizationPermissions/);
assert.equal(accountProductNavigation(ROLE_PAGE_ACCESS.super_admin, false).includes('admin'), false,
  '租户超级管理员身份不能替代平台管理员授权');
assert.equal(accountProductNavigation(ROLE_PAGE_ACCESS.super_admin, isAdminSession(adminSession)).includes('adminDelivery'), true);
assert.equal(accountProductNavigation(ROLE_PAGE_ACCESS.super_admin, isAdminSession({ ...adminSession, supportAccess: {} } as AuthSession)).includes('admin'), false,
  '代管会话不能显示平台管理入口');

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
};
assert.equal(readCreationMode('tenant-a:user-a', storage), 'free');
writeCreationMode('tenant-a:user-a', 'employee', storage);
assert.equal(readCreationMode('tenant-a:user-a', storage), 'employee');
assert.equal(readCreationMode('tenant-b:user-a', storage), 'free');
assert.equal(readCreationMode('tenant-a:user-b', storage), 'free');
console.log('Product navigation tests passed');
