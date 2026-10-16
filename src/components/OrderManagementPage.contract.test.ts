import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./OrderManagementPage.tsx', import.meta.url), 'utf8');

assert.doesNotMatch(source, /本地参考订单|当前展示真实订单与外贸工厂参考订单/, '订单页不得显示本地参考订单提示条');

console.log('OrderManagementPage contract tests passed');
