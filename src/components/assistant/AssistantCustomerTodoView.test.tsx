import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AssistantCustomerTodoView from './AssistantCustomerTodoView';

const parentSource = readFileSync(new URL('../GlobalAssistant.tsx', import.meta.url), 'utf8');

test('customer todo view keeps its ordered rows, completion mark and empty state', () => {
  const row = { id: 'customer-1', name: '客户 A', product: '产品', headline: '需要报价',
    reason: '待人工确认价格', tone: 'amber' as const, completed: false };
  const html = renderToStaticMarkup(createElement(AssistantCustomerTodoView, {
    items: [row, { ...row, id: 'customer-2', name: '客户 B', completed: true }],
    pendingCount: 1, onBack() {}, onSelect() {},
  }));
  assert.match(html, /今日待办（1）/);
  assert.ok(html.indexOf('客户 A') < html.indexOf('客户 B'));
  assert.match(html, /已完成/);
  assert.match(html, /客户助手/);
  assert.match(renderToStaticMarkup(createElement(AssistantCustomerTodoView, {
    items: [], pendingCount: 0, onBack() {}, onSelect() {},
  })), /暂无今日待办/);
});

test('global assistant retains the select-customer event and returns to conversation', () => {
  assert.match(parentSource, /<AssistantCustomerTodoView items=\{orderedTodoItems\} pendingCount=\{pendingCount\}/);
  assert.match(parentSource, /onBack=\{returnToConversation\} onSelect=\{id => \{[\s\S]*?lingshu:select-customer[\s\S]*?returnToConversation\(\)/);
});
