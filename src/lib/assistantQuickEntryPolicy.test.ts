import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASSISTANT_ANSWER_SOURCE_PRIORITY,
  ASSISTANT_QUICK_ENTRY_PAGES,
  buildAssistantAnswerContext,
  validateAssistantQuickEntryConfig,
  visibleAssistantDecision,
  type AssistantPageQuickEntryConfig,
} from './assistantQuickEntryPolicy';

const destinations = {
  digitalEmployees: 'digitalEmployees',
  socialInspiration: 'socialInspiration',
  smartAssets: 'smartAssets',
  traffic: 'traffic',
  conversion: 'conversion',
  enterprise: 'enterprise',
  agentMemory: 'agentMemory',
  plugins: 'plugins',
} as const;

const fixture = (page: keyof typeof destinations): AssistantPageQuickEntryConfig => ({
  pageId: page,
  entries: [
    { id: `${page}:q1`, pageId: page, label: `${page} 当前重点`, kind: 'question', prompt: '结合当前页面和企业知识解释重点', confirmationTier: 'none', createsWeeklyTask: false },
    { id: `${page}:q2`, pageId: page, label: `${page} 风险`, kind: 'question', prompt: '结合当前页面和企业知识分析风险', confirmationTier: 'none', createsWeeklyTask: false },
    { id: `${page}:run1`, pageId: page, label: `${page} 创建任务`, kind: 'execution', prompt: '创建本周任务', actionId: 'start_task', confirmationTier: 'summary', createsWeeklyTask: true, productionPage: destinations[page] },
    { id: `${page}:run2`, pageId: page, label: `${page} 执行任务`, kind: 'execution', prompt: '执行本周任务', actionId: 'start_task', confirmationTier: 'double', createsWeeklyTask: true, productionPage: destinations[page] },
  ],
});

test('first rollout has the exact eight agreed pages, each with 4-5 distinct entries and 2-3 executions', () => {
  assert.deepEqual(ASSISTANT_QUICK_ENTRY_PAGES, [
    'digitalEmployees', 'socialInspiration', 'smartAssets', 'traffic',
    'conversion', 'enterprise', 'agentMemory', 'plugins',
  ]);
  const configs = ASSISTANT_QUICK_ENTRY_PAGES.map(fixture);
  for (const config of configs) assert.deepEqual(validateAssistantQuickEntryConfig(config), []);
  assert.equal(new Set(configs.flatMap(config => config.entries.map(entry => entry.id))).size, 32);
  assert.equal(new Set(configs.map(config => config.entries[0]?.label)).size, configs.length,
    'page quick entries must not be one shared generic list');
});

test('execution entries require a signed start action, confirmation, weekly task card and real production page', () => {
  const valid = fixture('smartAssets');
  const broken: AssistantPageQuickEntryConfig = {
    ...valid,
    entries: [
      ...valid.entries.slice(0, 2),
      { id: 'bad-run-1', pageId: 'smartAssets', label: '假执行', kind: 'execution', prompt: '执行', actionId: 'search', confirmationTier: 'none', createsWeeklyTask: false },
      { id: 'bad-run-2', pageId: 'smartAssets', label: '无入口', kind: 'execution', prompt: '执行', actionId: 'start_task', confirmationTier: 'summary', createsWeeklyTask: true },
    ],
  };
  assert.deepEqual(validateAssistantQuickEntryConfig(broken), [
    'execution_action:bad-run-1',
    'execution_confirmation:bad-run-1',
    'execution_pipeline:bad-run-1',
    'execution_pipeline:bad-run-2',
  ]);
});

test('decision card is absent without a real actionable item', () => {
  assert.equal(visibleAssistantDecision([]), null);
  assert.equal(visibleAssistantDecision([{ id: 'd1', title: '待确认', status: 'approval_required' }])?.id, 'd1');
});

test('answer context always carries page data and internal knowledge before optional external retrieval', () => {
  const context = buildAssistantAnswerContext({
    page: 'socialInspiration',
    pageContext: { selectedTrendId: 'trend-1' },
    internalKnowledge: [{ id: 'product-1', title: '产品事实', excerpt: '已确认事实' }],
    externalSearch: { enabled: true, reason: 'trend', query: 'TikTok current trend' },
  });
  assert.deepEqual(context.sourcePriority, ASSISTANT_ANSWER_SOURCE_PRIORITY);
  assert.equal(context.pageContext.selectedTrendId, 'trend-1');
  assert.equal(context.internalKnowledge[0]?.id, 'product-1');
  assert.equal(context.externalSearch.reason, 'trend');
});
