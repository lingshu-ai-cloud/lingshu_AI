import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SOCIAL_TASK_CONTEXT_PAGES,
  isSocialTaskContextPage,
  parseSocialTaskNavigationContext,
  resolveSocialTaskPresentation,
  type SocialTaskWorkspaceSnapshot,
} from './socialTaskContext.js';

assert.deepEqual([...SOCIAL_TASK_CONTEXT_PAGES].sort(), [
  'accountManagement',
  'enterprise',
  'scriptLibrary',
  'smartAssets',
  'socialInspiration',
  'traffic',
]);
assert.equal(isSocialTaskContextPage('socialInspiration'), true);
assert.equal(isSocialTaskContextPage('conversion'), false);

const navigation = parseSocialTaskNavigationContext('smartAssets', {
  productionDetail: {
    page: 'smartAssets',
    workflowRunId: 'run-social-1',
    workflowTaskId: 'task-content-1',
    businessRef: { taskKey: 'content_production' },
  },
}, null);
assert.deepEqual(navigation, {
  runId: 'run-social-1',
  taskId: 'task-content-1',
  taskKey: 'content_production',
});
assert.equal(parseSocialTaskNavigationContext('smartAssets', {
  productionDetail: { page: 'smartAssets', workflowRunId: 'run-only' },
}, null), null, 'a partial task handoff must not create a task context');
assert.equal(parseSocialTaskNavigationContext('enterprise', {
  productionDetail: {
    page: 'smartAssets',
    workflowRunId: 'run-social-1',
    workflowTaskId: 'task-content-1',
  },
}, null), null, 'a handoff for another page must not leak into this page');

const workspace: SocialTaskWorkspaceSnapshot = {
  run: { id: 'run-social-1', status: 'running', cycleLabel: '九月新品内容' },
  today: {
    completed: [],
    inProgress: [{ what: '九月新品短视频', ownerAgent: 'content' }],
    nextSteps: [],
  },
  agents: [{ role: 'content', stage: '内容制作', status: 'running' }],
};
assert.deepEqual(resolveSocialTaskPresentation({
  page: 'smartAssets',
  view: 'create',
  workspace,
  navigation,
}), {
  taskName: '九月新品内容',
  pageStage: '内容创作',
  ownerName: '灵小图',
  statusLabel: '进行中',
});
assert.deepEqual(resolveSocialTaskPresentation({
  page: 'traffic',
  socialTask: {
    brief: {
      title: '秋季新品社媒内容', objective: '新品介绍', productRef: null, audience: null,
      markets: ['英国'], languages: ['英语'], platforms: ['tiktok'], formats: ['short_video'],
      aspectRatio: '9:16', cadence: null, requestedOutputCount: 1, dueAt: null, brandNotes: null,
      restrictions: [], callToAction: null,
    },
    status: 'awaiting_publish',
  },
  workspace,
  navigation,
}), {
  taskName: '秋季新品社媒内容',
  pageStage: '投流与发布',
  ownerName: '灵小量',
  statusLabel: '等待登记发布结果',
});
assert.equal(resolveSocialTaskPresentation({
  page: 'enterprise',
  workspace: { ...workspace, run: { id: null, status: 'idle', cycleLabel: null } },
  navigation: null,
}), null, 'the task bar stays hidden when there is no current social task');

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const barSource = readFileSync(new URL('../components/starter/SocialTaskContextBar.tsx', import.meta.url), 'utf8');
assert.match(appSource, /isSocialTaskContextPage\(page\)[\s\S]*?<SocialTaskContextBar/,
  'the selected social workflow pages must use the task-aware bar');
assert.match(appSource, /!isSocialTaskContextPage\(page\)[\s\S]*?<StarterWorkflowContextBar/,
  'non-social starter pages must keep the existing context bar');
for (const phrase of ['服务端', '底层', '写入托管', '不会绕过', '工作图', '模型 Key', '接口']) {
  assert.doesNotMatch(barSource, new RegExp(phrase), `customer task bar must not expose: ${phrase}`);
}
assert.match(barSource, /返回灵小枢/);

console.log('Social task context contract tests passed');
