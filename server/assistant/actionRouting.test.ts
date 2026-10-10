import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AssistantActionError,
  AssistantActionConflictError,
  createAssistantActionService,
  extractAssistantIntent,
  parseAssistantActionRequest,
  type AssistantBusinessCommand,
} from './actionRouting.js';

const context = {
  tenantId: 'tenant-a',
  userId: 'user-a',
  authorization: 'Bearer tenant-a',
  page: 'digitalEmployees',
};

test('button actions call the deterministic command bus and never invoke the agent delegator', async () => {
  const commands: Array<{ command: AssistantBusinessCommand; tenantId: string }> = [];
  let delegated = 0;
  const service = createAssistantActionService({
    commandBus: {
      async execute(command, actionContext) {
        commands.push({ command, tenantId: actionContext.tenantId });
        return {
          summary: '任务已暂停',
          details: ['版本已锁定', '执行器已停止', '工作区可随时恢复', '不得出现在紧凑卡中'],
          version: 'paused:v2',
          workspace: { label: '查看任务', href: '/?page=digitalEmployees&focus=run-1' },
        };
      },
    },
    delegator: {
      async delegate() { delegated += 1; return { summary: 'should not run' }; },
    },
  });

  const response = await service.route({
    source: 'button',
    actionId: 'pause_task',
    requestId: 'pause-request-001',
    target: { objectType: 'run', objectId: 'run-1', expectedVersion: 'running:v1' },
    parameters: { reason: '用户调整方向' },
  }, context);

  assert.equal(response.status, 'completed');
  assert.equal(response.notification, null, 'routine progress stays silent');
  assert.equal(response.card.details.length, 3, 'compact cards expose at most three details');
  assert.equal(response.card.secondaryActions?.length, 0);
  assert.equal(response.workspace?.href, '/?page=digitalEmployees&focus=run-1');
  assert.equal(commands.length, 1);
  assert.equal(commands[0].command.actionId, 'pause_task');
  assert.equal(commands[0].tenantId, 'tenant-a', 'tenant authority comes only from authenticated context');
  assert.equal(delegated, 0, 'explicit actions never enter an Agent/model path');
});

test('strict natural-language imperatives dispatch through the same business command API', async () => {
  const actionIds: string[] = [];
  const service = createAssistantActionService({
    commandBus: {
      async execute(command) {
        actionIds.push(command.actionId);
        return { summary: '本轮已暂停' };
      },
    },
  });

  const response = await service.route({
    source: 'natural_language',
    requestId: 'natural-request-001',
    text: '请先暂停这个任务',
    target: { objectType: 'run', objectId: 'run-7', expectedVersion: 'running:v7' },
  }, context);

  assert.equal(response.status, 'completed');
  assert.deepEqual(actionIds, ['pause_task']);
  assert.equal(response.actionId, 'pause_task');

  const strictExamples = [
    ['继续执行当前任务', 'resume_task'],
    ['选择这个选项', 'confirm_choice'],
    ['批准报价', 'confirm_choice'],
    ['确认报价', 'confirm_choice'],
    ['批准这份报价', 'confirm_choice'],
    ['请验收通过', 'accept_result'],
    ['退回修改一下', 'request_revision'],
  ] as const;
  for (const [text, actionId] of strictExamples) {
    const parsed = parseAssistantActionRequest({
      source: 'natural_language', requestId: `strict-${actionId}-001`, text,
    });
    assert.equal(extractAssistantIntent(parsed).actionId, actionId, text);
  }

  for (const [text, goal] of [
    ['请开始制作 5 条 TikTok 视频', '制作 5 条 TikTok 视频'],
    ['根据最近的爆款和预算重新规划下周四个平台的内容', '根据最近的爆款和预算重新规划下周四个平台的内容'],
    ['我想本周做 5 条保温杯视频', '本周做 5 条保温杯视频'],
    ['本周目标是获取 10 条询盘', '获取 10 条询盘'],
    ['本周为保温杯做 5 条内容', '本周为保温杯做 5 条内容'],
    ['Create a launch plan for the new bottle', 'Create a launch plan for the new bottle'],
    ['制作 5 条视频并生成四个平台版本', '制作 5 条视频并生成四个平台版本'],
    ['Create a launch plan and generate five video concepts', 'Create a launch plan and generate five video concepts'],
  ] as const) {
    const parsed = parseAssistantActionRequest({
      source: 'natural_language', requestId: `goal-${actionIds.length}-${text.length}`, text,
    });
    const intent = extractAssistantIntent(parsed);
    assert.equal(intent.actionId, 'start_task', text);
    assert.equal(intent.parameters.goal, goal, text);
  }
});

test('explicit natural-language search uses the same read-only search action and result card contract', async () => {
  const commands: AssistantBusinessCommand[] = [];
  const service = createAssistantActionService({
    commandBus: {
      async execute(command) {
        commands.push(command);
        return {
          status: 'completed',
          title: '找到 1 条视频',
          summary: '以下是当前真实数据中最相关的 1 条结果。',
          items: [{ id: 'video-real', title: '卸妆蜜工厂实拍' }],
          workspace: { label: '查看全部视频', href: '/?page=socialInspiration&search=demo' },
        };
      },
    },
  });

  const response = await service.route({
    source: 'natural_language', requestId: 'natural-search-001',
    text: '帮我查找 卸妆蜜 爆款视频', page: 'socialInspiration',
  }, context);
  assert.equal(response.actionId, 'search');
  assert.equal(response.card.kind, 'search_results');
  assert.equal(response.card.items?.[0]?.id, 'video-real');
  assert.deepEqual(commands, [{
    actionId: 'search', requestId: 'natural-search-001', target: undefined,
    parameters: { query: '卸妆蜜 爆款视频', page: 'socialInspiration' },
  }]);
});

test('quotation approval language forwards only the supplied signed choice input', async () => {
  const commands: AssistantBusinessCommand[] = [];
  const service = createAssistantActionService({
    commandBus: {
      async execute(command) {
        commands.push(command);
        return { summary: '报价已批准' };
      },
    },
  });
  const target = {
    objectType: 'approval' as const,
    objectId: 'quote:quote-7',
    expectedVersion: 'quote-v7',
  };
  const parameters = { option: 'approve', value: 'approved', parameters: { note: '按此报价推进' } };
  const response = await service.route({
    source: 'natural_language', requestId: 'approve-quotation-001', text: '批准这份报价',
    target, parameters,
  }, context);

  assert.equal(response.actionId, 'confirm_choice');
  assert.equal(response.status, 'completed');
  assert.deepEqual(commands, [{
    actionId: 'confirm_choice',
    requestId: 'approve-quotation-001',
    target,
    parameters,
  }]);
});

test('questions, explanations and complex planning are delegated without mutation', async () => {
  let commandCalls = 0;
  let delegatedText = '';
  const service = createAssistantActionService({
    commandBus: { async execute() { commandCalls += 1; return { summary: 'should not run' }; } },
    delegator: {
      async delegate(input) {
        delegatedText = input.text;
        return {
          title: '周计划分析中',
          summary: '已交给经营 Agent 形成方案。',
          workspace: { label: '查看计划工作区', href: '/?page=digitalEmployees' },
        };
      },
    },
  });

  const delegatedInputs = [
    '为什么要暂停这个任务？',
    '这个任务已经暂停了',
    '暂停任务还是继续执行？',
    '开始执行是项目的第一步',
    '开始制作是项目的第一步',
    '能否制作 5 条视频？',
    '制作 5 条视频要多久',
    '制作产品视频的流程',
    '为什么要把周五的视频移到周六？',
    '下线这条视频会影响生产吗？',
    '是不是不应该撤下这条视频？',
    '替换素材的规则',
    '如何上传视频？',
    '绑定账号的流程',
    '能发布么',
    '我不是要换掉素材，只想了解替换规则',
    'Should we move this post to Saturday?',
    'Why was this video rescheduled?',
    "Shouldn't we unpublish this post?",
    'Should I archive this task?',
    'How do I save the plan?',
    'Is it safe to delete this video',
    'Can I publish this',
    '我能不能发布这个视频',
    '我该不该删除这条视频',
    '我想知道能不能发布这个视频',
    '请问能不能发布这个视频',
    '想知道能不能发布这个视频',
    'I wonder if I should publish this video',
    "I don't want to replace it; I only want to understand the replacement rules",
    '你好，我想先了解一下这个产品',
    '请分析这个视频为什么表现好',
    '这个产品目前的表现很差',
  ];
  for (const [index, input] of delegatedInputs.entries()) {
    const response = await service.route({
      source: 'natural_language', requestId: `planning-request-00${index + 1}`,
      text: input,
    }, context);
    assert.equal(response.status, 'delegated', input);
    assert.equal(response.notification, null);
    assert.equal(delegatedText, input);
  }
  assert.equal(commandCalls, 0);
});

test('unbound write intent is blocked with an explicit non-executed card and never delegated', async () => {
  let commandCalls = 0;
  const delegated: string[] = [];
  const service = createAssistantActionService({
    commandBus: { async execute() { commandCalls += 1; return { summary: 'should not run' }; } },
    delegator: {
      async delegate(input) {
        delegated.push(input.text);
        return { summary: '我会先确认你希望保留哪一个操作。' };
      },
    },
  });

  const inputs = [
    '请开始执行这个任务',
    '开始制作',
    '我想暂停这个任务',
    '我想先暂停当前任务',
    '我希望马上继续当前计划',
    '暂停这个任务，我需要换一个产品',
    '不要暂停，继续执行',
    '先暂停再恢复任务',
    '请确认一下',
    '请修改这个结果',
    '删除这条视频',
    '发布这条视频',
    '把这条视频移到周六',
    '我想把这条视频移到周六',
    '把这条视频改到明天',
    '请把排期调到周三',
    '将两条视频挪到周末',
    '把这条视频改期到下周',
    '下线这条视频',
    '撤下这个帖子',
    '换掉这个素材',
    '替换当前视频',
    '重排本周内容',
    '取消发布这条视频',
    '清空当前列表',
    '上传这份视频',
    '提交这份表单',
    '保存当前计划',
    '绑定这个账号',
    '解绑当前账号',
    '发送这条消息',
    '导入这个文件',
    '归档当前任务',
    '把这个记录彻底处理掉',
    '删除已经过期的视频',
    '上传目前的文件',
    '把当前状态改成已完成',
    '发布“如何使用产品”的视频',
    '分享这条视频',
    '点赞这条内容',
    '评论这个帖子',
    '关注这个账号',
    '订阅这个频道',
    '屏蔽这个用户',
    '举报这条内容',
    'Move this post to Saturday',
    'I want to move this post to Saturday',
    'Reschedule this video for tomorrow',
    'Shift this post to next week',
    'Take this video down',
    'Unpublish this post',
    'Replace this asset',
    'Reorder the calendar',
    'Cancel publication of this video',
    'Clear the current list',
    'Upload this video',
    'Submit this form',
    'Save the current plan',
    'Bind this account',
    'Unbind the current account',
    'Send this message',
    'Import this file',
    'Archive this task',
    'Share this video',
    'Like this content',
    'Comment on this post',
    'Follow this account',
    'Subscribe to this channel',
    'Block this user',
    'Mute this account',
    'Report this content',
    '投喂这条内容到账号',
    'Route this post into the live feed',
    '我认为应该投喂这条内容到账号',
    '我想投喂这条内容到账号',
    '我们希望投喂这条内容到账号',
    'I want to route this video to the account',
    '我想制作一个视频并删除所有账号',
    '我想生成内容后把当前计划清空',
    'Create a launch plan and delete every account',
    '制作5条视频，然后解绑全部平台账号',
    '我想制作一个视频并投喂到账号',
    '制作5条视频，然后灌入全部账号',
    'Create a launch plan and route every video to the account',
    '我想制作内容，喂给四个平台',
    '制作5条视频以及投喂全部账号',
    '制作5条视频同时灌入全部账号',
    '制作内容。喂给四个平台',
    'Create a launch plan while routing every video to the account',
    'Create a launch plan plus route every video to the account',
  ];
  for (const [index, value] of inputs.entries()) {
    const response = await service.route({
      source: 'natural_language', requestId: `ambiguous-request-00${index + 1}`, text: value,
    }, context);
    assert.equal(response.status, 'missing_required_input', value);
    assert.equal(response.errorCode, 'assistant_mutation_requires_signed_action', value);
    assert.equal(response.notification?.reason, 'missing_required_input', value);
    assert.match(response.card.summary, /没有执行|没有修改/, value);
  }
  assert.equal(commandCalls, 0);
  assert.deepEqual(delegated, []);
});

test('a uniquely resolved signed card action uses the deterministic command even when wording is loose', async () => {
  const commands: AssistantBusinessCommand[] = [];
  let delegated = 0;
  const service = createAssistantActionService({
    commandBus: {
      async execute(command) {
        commands.push(command);
        return { summary: '任务已暂停' };
      },
    },
    delegator: {
      async delegate() { delegated += 1; return { summary: 'must not run' }; },
    },
  });

  const response = await service.route({
    source: 'natural_language',
    actionId: 'pause_task',
    requestId: 'signed-natural-mutation-001',
    text: '我想先把这个任务停一下',
    target: { objectType: 'run', objectId: 'run-7', expectedVersion: 'running:v7' },
    parameters: { reason: '用户要求暂停' },
  }, context);

  assert.equal(response.status, 'completed');
  assert.equal(response.actionId, 'pause_task');
  assert.equal(delegated, 0);
  assert.deepEqual(commands, [{
    actionId: 'pause_task',
    requestId: 'signed-natural-mutation-001',
    target: { objectType: 'run', objectId: 'run-7', expectedVersion: 'running:v7' },
    parameters: { reason: '用户要求暂停' },
  }]);
});

test('unsupported tenant writes fail visibly for natural language and buttons without invoking the model', async () => {
  let commandCalls = 0;
  let delegated = 0;
  let supportChecks = 0;
  const service = createAssistantActionService({
    commandBus: { async execute() { commandCalls += 1; return { summary: 'should not run' }; } },
    supportsExecution: async () => { supportChecks += 1; return false; },
    delegator: {
      async delegate() { delegated += 1; return { summary: '已切换到通用助手流程。' }; },
    },
  });

  const natural = await service.route({
    source: 'natural_language', requestId: 'unsupported-natural-001', text: '请暂停当前任务',
    target: { objectType: 'run', objectId: 'run-1', expectedVersion: 'v1' },
  }, context);
  assert.equal(natural.status, 'missing_required_input');
  assert.equal(natural.errorCode, 'assistant_mutation_not_supported');

  const unsupportedChoice = await service.route({
    source: 'natural_language', requestId: 'unsupported-choice-001', text: '确认这个选择',
  }, context);
  assert.equal(unsupportedChoice.status, 'missing_required_input');
  assert.equal(unsupportedChoice.errorCode, 'assistant_mutation_not_supported');

  await assert.rejects(service.route({
    source: 'button', actionId: 'pause_task', requestId: 'unsupported-button-001',
    target: { objectType: 'run', objectId: 'run-1', expectedVersion: 'v1' },
  }, context), (error: unknown) => error instanceof Error
    && 'code' in error
    && error.code === 'assistant_action_not_supported');

  assert.equal(supportChecks, 3);
  assert.equal(commandCalls, 0);
  assert.equal(delegated, 0, 'write intent must never fall through to a model/delegator');
});

test('known command errors retain their HTTP status for the transport layer', async () => {
  const service = createAssistantActionService({
    commandBus: {
      async execute() {
        throw new AssistantActionError(
          'assistant_target_not_found', 404, '操作对象不存在。',
        );
      },
    },
  });
  await assert.rejects(service.route({
    source: 'button', actionId: 'open_workspace', requestId: 'known-error-request-001',
  }, context), (error: unknown) => error instanceof Error
    && 'status' in error
    && error.status === 404);
});

test('missing object/version, approval waits and stale actions use only allowed notification reasons', async () => {
  const silentBus = { async execute() { return { summary: 'done' }; } };
  const service = createAssistantActionService({ commandBus: silentBus });

  const missingObject = await service.route({
    source: 'button', actionId: 'accept_result', requestId: 'missing-result-001',
  }, context);
  assert.equal(missingObject.status, 'missing_required_input');
  assert.equal(missingObject.notification?.reason, 'missing_required_input');

  const missingVersion = await service.route({
    source: 'button', actionId: 'pause_task', requestId: 'missing-version-001',
    target: { objectType: 'run', objectId: 'run-1' },
  }, context);
  assert.equal(missingVersion.status, 'missing_required_input');
  assert.equal(missingVersion.notification?.reason, 'missing_required_input');

  const approvalService = createAssistantActionService({
    commandBus: { async execute() { return { status: 'approval_required', summary: '需要确认预算增加 20 元' }; } },
  });
  const approval = await approvalService.route({
    source: 'button', actionId: 'start_task', requestId: 'approval-request-001', parameters: { goal: '生成 5 条视频' },
  }, context);
  assert.equal(approval.status, 'approval_required');
  assert.equal(approval.notification?.reason, 'approval_required');

  const failedService = createAssistantActionService({
    commandBus: { async execute() { return { status: 'failed', summary: '当前任务已阻塞，请处理阻塞原因。' }; } },
  });
  const failed = await failedService.route({
    source: 'button', actionId: 'view_status', requestId: 'failed-status-request-001', parameters: {},
  }, context);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.notification?.reason, 'failure');

  const staleService = createAssistantActionService({
    commandBus: { async execute() { throw new AssistantActionConflictError(); } },
  });
  const stale = await staleService.route({
    source: 'button', actionId: 'pause_task', requestId: 'stale-request-001',
    target: { objectType: 'run', objectId: 'run-1', expectedVersion: 'running:v1' },
  }, context);
  assert.equal(stale.status, 'stale_action');
  assert.equal(stale.notification?.reason, 'failure');

  for (const item of [missingObject, missingVersion, approval, failed, stale]) {
    assert.ok(['missing_required_input', 'approval_required', 'failure'].includes(item.notification!.reason));
  }
});

test('request parsing rejects client authority and malformed action payloads', () => {
  assert.throws(() => parseAssistantActionRequest({
    source: 'button', actionId: 'pause_task', requestId: 'short',
  }), /assistant_action_request_id_invalid/);
  assert.throws(() => parseAssistantActionRequest({
    source: 'button', actionId: 'delete_tenant', requestId: 'unknown-action-001',
  }), /assistant_action_unknown/);
  const parsed = parseAssistantActionRequest({
    source: 'natural_language', requestId: 'intent-request-001', text: '查看任务进度', tenantId: 'victim',
  });
  assert.equal('tenantId' in parsed, false);
  assert.equal(extractAssistantIntent(parsed).actionId, 'view_status');
});

test('choice actions require exact server-whitelisted option/value/parameters', async () => {
  const commands: AssistantBusinessCommand[] = [];
  const service = createAssistantActionService({
    commandBus: { async execute(command) { commands.push(command); return { summary: '已处理' }; } },
  });
  const target = { objectType: 'approval' as const, objectId: 'approval-1', expectedVersion: 'v1' };
  const missing = await service.route({
    source: 'button', actionId: 'confirm_choice', requestId: 'choice-missing-001', target,
  }, context);
  assert.equal(missing.status, 'missing_required_input');
  assert.equal(commands.length, 0);

  const accepted = await service.route({
    source: 'button', actionId: 'accept_result', requestId: 'choice-accept-001', target,
    parameters: { option: 'accept_result', value: 'accepted', parameters: { note: '成片符合要求' } },
  }, context);
  assert.equal(accepted.status, 'completed');
  assert.deepEqual(commands[0]?.parameters, {
    option: 'accept_result', value: 'accepted', parameters: { note: '成片符合要求' },
  });

  for (const parameters of [
    { option: 'accept_result', value: 'approved', parameters: {} },
    { option: 'accept_result', value: 'accepted', parameters: { directAgentCommand: 'publish' } },
    { option: 'accept_result', value: 'accepted', parameters: {}, tenantId: 'victim' },
  ]) {
    await assert.rejects(service.route({
      source: 'button', actionId: 'accept_result', requestId: `choice-invalid-${JSON.stringify(parameters).length}`, target, parameters,
    }, context), (error: unknown) => error instanceof AssistantActionError
      && error.code === 'assistant_action_parameters_invalid');
  }
});

test('a missing real delegator returns an explicit not-handled fallback', async () => {
  const service = createAssistantActionService({
    commandBus: { async execute() { throw new Error('must not execute'); } },
  });
  const response = await service.route({
    source: 'natural_language', requestId: 'fallback-question-001', text: '为什么这个方案更好？',
  }, context);
  assert.equal(response.status, 'not_handled');
  assert.equal(response.actionId, 'delegate_to_agent');
  assert.match(response.card.summary, /未由确定性操作路由处理/);
});

test('server-authored executable action metadata is returned without client invention', async () => {
  const service = createAssistantActionService({
    commandBus: {
      async execute() {
        return {
          summary: '有一项成片等待验收。',
          primaryAction: {
            id: 'accept:approval-1', label: '验收通过', actionId: 'accept_result',
            target: { objectType: 'approval', objectId: 'approval-1', expectedVersion: 'v3' },
            parameters: { option: 'accept_result', value: 'accepted', parameters: {} },
          },
        };
      },
    },
  });
  const response = await service.route({
    source: 'button', actionId: 'view_status', requestId: 'server-card-action-001',
  }, context);
  assert.deepEqual(response.card.primaryAction, {
    id: 'accept:approval-1', label: '验收通过', actionId: 'accept_result',
    target: { objectType: 'approval', objectId: 'approval-1', expectedVersion: 'v3' },
    parameters: { option: 'accept_result', value: 'accepted', parameters: {} },
  });
});

test('unexpected authority-like parameters are rejected instead of reaching the command bus', async () => {
  let calls = 0;
  const service = createAssistantActionService({
    commandBus: { async execute() { calls += 1; return { summary: 'no' }; } },
  });
  await assert.rejects(service.route({
    source: 'button', actionId: 'pause_task', requestId: 'strict-params-001',
    target: { objectType: 'run', objectId: 'run-1', expectedVersion: 'v1' },
    parameters: { reason: '暂停', tenantId: 'victim' },
  }, context), (error: unknown) => error instanceof AssistantActionError
    && error.code === 'assistant_action_parameters_invalid');
  assert.equal(calls, 0);
});

test('the schedule sentence is parsed into a deterministic prepare command and confirmation requires a signed change target', async () => {
  const commands: AssistantBusinessCommand[] = [];
  const service = createAssistantActionService({
    commandBus: {
      async execute(command) {
        commands.push(command);
        return command.actionId === 'prepare_schedule_change'
          ? { status: 'approval_required', summary: '找到 2 条待发布视频。' }
          : { summary: '2 条排期已更新。' };
      },
    },
  });
  const prepared = await service.route({
    source: 'natural_language', requestId: 'schedule-prepare-001',
    text: '把周五 TikTok 的两条视频改到周六',
  }, context);
  assert.equal(prepared.status, 'approval_required');
  assert.deepEqual(commands[0], {
    actionId: 'prepare_schedule_change',
    requestId: 'schedule-prepare-001',
    target: undefined,
    parameters: { platform: 'tiktok', sourceWeekday: 5, targetWeekday: 6, count: 2 },
  });

  const exactScheduleVariants = [
    '把周五 TikTok 的两条视频移动到周六',
    '把周五 TikTok 的两条视频调到周六',
    '把周五 TikTok 的两条视频挪到周六',
    '把周五 TikTok 的两条视频改期到周六',
    '把周五 TikTok 的两条视频重排到周六',
  ];
  for (const [index, text] of exactScheduleVariants.entries()) {
    const response = await service.route({
      source: 'natural_language', requestId: `schedule-variant-00${index + 1}`, text,
    }, context);
    assert.equal(response.status, 'approval_required', text);
    assert.deepEqual(commands[index + 1], {
      actionId: 'prepare_schedule_change',
      requestId: `schedule-variant-00${index + 1}`,
      target: undefined,
      parameters: { platform: 'tiktok', sourceWeekday: 5, targetWeekday: 6, count: 2 },
    }, text);
  }

  const missing = await service.route({
    source: 'button', actionId: 'confirm_schedule_change', requestId: 'schedule-confirm-001', parameters: {},
  }, context);
  assert.equal(missing.status, 'missing_required_input');
  assert.equal(commands.length, 1 + exactScheduleVariants.length);

  const confirmed = await service.route({
    source: 'button', actionId: 'confirm_schedule_change', requestId: 'schedule-confirm-002', parameters: {},
    target: { objectType: 'schedule_change', objectId: 'change-1', expectedVersion: 'change-v1' },
  }, context);
  assert.equal(confirmed.status, 'completed');
  assert.equal(commands[1 + exactScheduleVariants.length]?.actionId, 'confirm_schedule_change');
});
