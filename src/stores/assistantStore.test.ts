import assert from 'node:assert/strict';
import {
  assistantActionTarget,
  assistantRunControl,
  normalizeAssistantTaskCard,
  shouldNotifyAssistant,
  upsertAssistantTaskCard,
  useAssistantStore,
} from './assistantStore.js';

assert.equal(shouldNotifyAssistant('routine'), false, '常规进度必须保持静默');
assert.equal(shouldNotifyAssistant('missing_input'), true, '缺少必填信息时必须提醒');
assert.equal(shouldNotifyAssistant('approval_required'), true, '需要用户审批时必须提醒');
assert.equal(shouldNotifyAssistant('failed'), true, '执行失败时必须提醒');

const normalized = normalizeAssistantTaskCard({
  taskId: ' weekly-plan ',
  title: ' 确认本周计划 ',
  conclusion: ' 建议按推荐节奏开始 ',
  details: [' 共 5 条 ', '', ' 预算 ¥50 ', ' 4 个账号 ', ' 这条不应出现 '],
  status: 'approval',
  notificationReason: 'approval_required',
  primaryAction: { id: ' confirm ', label: ' 确认并开始 ', prompt: ' 开始 ' },
  secondaryActions: [
    { id: 'adjust', label: '调整计划' },
    { id: 'detail', label: '查看详情' },
    { id: 'overflow', label: '不应出现' },
  ],
});

assert.equal(normalized.taskId, 'weekly-plan');
assert.equal(normalized.title, '确认本周计划');
assert.deepEqual(normalized.details, ['共 5 条', '预算 ¥50', '4 个账号'], '决策卡最多显示三条必要细节');
assert.equal(normalized.primaryAction?.id, 'confirm', '决策卡只允许一个主操作');
assert.equal(normalized.secondaryActions.length, 2, '决策卡最多允许两个次操作');

const first = upsertAssistantTaskCard({}, normalized);
const updated = upsertAssistantTaskCard(first, {
  ...normalized,
  conclusion: '计划已开始执行',
  status: 'running',
  notificationReason: 'routine',
  updatedAt: normalized.updatedAt + 1,
});
assert.deepEqual(Object.keys(updated), ['weekly-plan'], '同一任务的进度必须更新原卡片而不是新建卡片');
assert.equal(updated['weekly-plan'].status, 'running');
assert.equal(updated['weekly-plan'].notificationReason, 'routine');

const authoritativeRunTarget = {
  objectType: 'run' as const,
  objectId: 'run-7',
  expectedVersion: 'running:v7',
};
const runningCard = normalizeAssistantTaskCard({
  taskId: 'display-card-not-a-run-id',
  title: '内容任务正在执行',
  conclusion: '已完成 2/5 个步骤',
  status: 'running',
  notificationReason: 'routine',
  primaryAction: {
    id: 'pause',
    label: '暂停任务',
    actionId: 'pause_task',
    target: authoritativeRunTarget,
  },
});

assert.deepEqual(
  assistantActionTarget(runningCard, 'pause_task'),
  authoritativeRunTarget,
  '自然语言或按钮变更只能复用卡片中后端签发的对象与版本',
);
assert.deepEqual(
  assistantRunControl(runningCard),
  { actionId: 'pause_task', target: authoritativeRunTarget },
  '运行中的真实任务才允许显示暂停操作',
);
assert.equal(
  assistantActionTarget(runningCard, 'confirm_choice'),
  undefined,
  '运行任务目标不得误用于类型不兼容的确认操作',
);

const approvalTarget = {
  objectType: 'approval' as const,
  objectId: 'approval-7',
  expectedVersion: 'approval:v7',
};
const approvalParameters = { option: 'accept_result', value: 'accepted', parameters: { note: '符合验收标准' } };
const approvalCard = normalizeAssistantTaskCard({
  taskId: 'approval-card',
  title: '确认成果',
  conclusion: '请验收本轮成果',
  status: 'approval',
  notificationReason: 'approval_required',
  primaryAction: {
    id: 'accept-result',
    label: '验收通过',
    actionId: 'accept_result',
    target: approvalTarget,
    parameters: approvalParameters,
  },
});
assert.deepEqual(
  assistantActionTarget(approvalCard, 'accept_result'),
  approvalTarget,
  '成果验收必须作用于后端签发的待确认对象，而不是展示结果编号',
);
assert.deepEqual(
  approvalCard.primaryAction?.parameters,
  approvalParameters,
  '后端签发的选择参数必须原样保留给按钮和自然语言操作',
);

const pausedTarget = { ...authoritativeRunTarget, expectedVersion: 'paused:v8' };
const pausedCard = normalizeAssistantTaskCard({
  ...runningCard,
  status: 'paused',
  primaryAction: {
    id: 'resume',
    label: '继续任务',
    actionId: 'resume_task',
    target: pausedTarget,
  },
});
assert.deepEqual(
  assistantRunControl(pausedCard),
  { actionId: 'resume_task', target: pausedTarget },
  '已暂停的真实任务才允许携带原对象与新版本继续执行',
);

for (const unsafeCard of [
  normalizeAssistantTaskCard({
    ...runningCard,
    primaryAction: {
      id: 'pause-without-version',
      label: '暂停任务',
      actionId: 'pause_task',
      target: { objectType: 'run', objectId: 'run-7' },
    },
  }),
  normalizeAssistantTaskCard({
    ...runningCard,
    status: 'approval',
  }),
  normalizeAssistantTaskCard({
    ...runningCard,
    primaryAction: {
      id: 'pause-a',
      label: '暂停 A',
      actionId: 'pause_task',
      target: authoritativeRunTarget,
    },
    secondaryActions: [{
      id: 'pause-b',
      label: '暂停 B',
      actionId: 'pause_task',
      target: { ...authoritativeRunTarget, objectId: 'run-8' },
    }],
  }),
]) {
  assert.equal(
    assistantRunControl(unsafeCard),
    null,
    '缺版本、非运行状态或目标不唯一时不得猜测可执行任务',
  );
}

const routineCard = normalizeAssistantTaskCard({
  taskId: 'routine-progress',
  title: '后台进度',
  conclusion: '又完成了一个步骤',
  status: 'running',
  notificationReason: 'routine',
});
useAssistantStore.getState().hydrateThread('business', {
  taskCards: first,
  focusedTaskId: 'weekly-plan',
});
useAssistantStore.getState().upsertTaskCard('business', routineCard);
assert.equal(
  useAssistantStore.getState().threads.business.focusedTaskId,
  'weekly-plan',
  '常规进度入库不得抢走用户当前聚焦的决策卡',
);

console.log('assistant store contract tests passed');
