import assert from 'node:assert/strict';
import test from 'node:test';
import { readableAssistantReply } from './assistantReadableReply';
import { splitAssistantReply, assistantWantsDetailedReply, ASSISTANT_READABLE_POLICY, ASSISTANT_QUICK_TASK_POLICY } from './assistantReadableReply';

test('natural response policy does not impose three sentences or mandatory action templates', () => {
  assert.match(ASSISTANT_READABLE_POLICY, /不设三句话/);
  assert.match(ASSISTANT_READABLE_POLICY, /普通交流正常说话/);
  assert.equal(assistantWantsDetailedReply('请详细分析原因和不同方案'), true);
  assert.equal(assistantWantsDetailedReply('不要详细分析，直接给结果'), false);
  assert.match(ASSISTANT_QUICK_TASK_POLICY, /250～500/);
  assert.match(ASSISTANT_QUICK_TASK_POLICY, /产品20\/P20/);
});

test('optional details preserve full explanations and promote essential restrictions', () => {
  const result = splitAssistantReply('建议先处理参考素材。\n```details\n这是可选的进一步说明。\n费用200元，尚未批准发布。\n```');
  assert.match(result.summary, /费用200元，尚未批准发布/);
  assert.doesNotMatch(result.summary, /可选的进一步说明/);
  assert.match(result.details[0], /可选的进一步说明/);
  assert.equal(splitAssistantReply('自然回答。还有必要解释。并不限于三句话。这里是第四句。').details.length, 0);
  assert.equal(splitAssistantReply('摘要\n```details\n流式补充中').details[0], '流式补充中');
});

test('filtering an internal field must not delete the fee or approval condition around it', () => {
  const result = readableAssistantReply('费用 cost_limit=200元，requires_approval。尚未批准发布，internal_gate=blocked。');
  assert.match(result, /200元/); assert.match(result, /需要审批/); assert.match(result, /尚未批准发布/);
  assert.doesNotMatch(result, /cost_limit|requires_approval|internal_gate/);
});

test('historical long explanations fold at paragraph boundaries without discarding content', () => {
  const paragraphs = Array.from({ length: 7 }, (_, index) => `第${index}项说明：${'用于解释取舍的必要依据。'.repeat(30)}`);
  const result = splitAssistantReply(paragraphs.join('\n\n'));
  assert.ok(result.details.length); assert.ok(result.summary.length < 1000);
  for (const paragraph of paragraphs) assert.ok((result.summary + result.details.join('')).includes(paragraph));
  const copy = '```copy\n' + paragraphs.join('\n\n') + '\n```';
  assert.equal(splitAssistantReply(copy).summary, copy);
});

test('quick task replies keep a short actionable surface and preserve the remainder as details', () => {
  const paragraphs = Array.from({ length: 8 }, (_, index) => `第${index + 1}项：${'说明当前状态并给出下一步动作。'.repeat(4)}`);
  const result = splitAssistantReply(paragraphs.join('\n\n'), { compact: true });
  assert.ok(result.summary.length <= 500);
  assert.ok(result.details.length > 0);
  for (const paragraph of paragraphs) assert.ok((result.summary + result.details.join('')).includes(paragraph));
});

test('weekly footage supplement never duplicates its list in an automatic details disclosure', () => {
  const long = `本周计划还没有开始。\n\n${'镜头还缺可用实拍。'.repeat(80)}\n\n先补充视频素材。`;
  const result = splitAssistantReply(long, { presentation: 'operations', compact: true });
  assert.equal(result.details.length, 0);
  assert.equal(result.summary, long);
});

test('customer reply translates internal statuses and removes raw evidence without losing action or impact', () => {
  const result = readableAssistantReply('结论：先重试平台采集。\n依据：当前 workflow_tasks 中 `scheduled_source_collection` 任务状态为 `failed` [记录:workflow_tasks/workflow_tasks_5ef74d300c96453c8a0c6c8c25632ea6]，导致8条 TikTok 脚本卡在 `plan_review`。\n✅ 行动：重试采集，或提供2～3个竞品链接。');
  assert.doesNotMatch(result, /workflow_tasks|scheduled_source|plan_review|failed|记录:|5ef74d|`/);
  assert.match(result, /采集.*失败/); assert.match(result, /8条 TikTok.*等待方案确认/);
  assert.match(result, /行动：重试采集，或提供2～3个竞品链接/);
});

test('common query states and provider failures are translated for customer-facing replies', () => {
  const result = readableAssistantReply('账号状态 unavailable；任务 attention；执行 blocked。\n模型 doubao-seedance-2-0-fast-260128 not activated；no formal assets uploaded；image size must be ≥3686400 pixels。');
  assert.match(result, /账号状态\s*暂未核验/);
  assert.match(result, /任务\s*需要关注/);
  assert.match(result, /执行\s*已阻塞/);
  assert.match(result, /Seedance 视频能力尚未开通/);
  assert.match(result, /尚未上传可用于正式制作的素材/);
  assert.match(result, /图片清晰度不足，请上传高清原图/);
  assert.doesNotMatch(result, /unavailable|attention|blocked|doubao-seedance|not activated|no formal assets uploaded|image size must be/);
});

test('technical-only details are hidden, failures and budget/approval limits remain honest', () => {
  const result = readableAssistantReply('内部：taskId=abc，expectedVersion=v1。\n错误：presenter_stack_blocked，生产失败。\n需要先确认费用200元，尚未批准发布。\n```json\n{"runId":"abc"}\n```');
  assert.doesNotMatch(result, /taskId|expectedVersion|presenter_stack|runId|json/);
  assert.match(result, /未完成|失败/); assert.match(result, /200元.*尚未批准发布/);
});

test('product names, requested English copy, quick replies and verified source URLs survive', () => {
  const text = '产品：ACME Serum，平台：TikTok。\n来源：[平台说明](https://example.com/failed?taskId=12)\n```copy\n[EN] Apply ACME Serum to clean skin.\n```\n```next\n查看制作进度\n修改口播开头\n```';
  assert.equal(readableAssistantReply(text), text);
  assert.equal(readableAssistantReply('已完成3条，另有2条采集失败。'), '已完成3条，另有2条采集失败。');
});

test('streaming partial references and unclosed technical blocks cannot leak identifiers', () => {
  assert.equal(readableAssistantReply('采集失败。[记录:workflow_tasks/abc'), '采集失败。');
  assert.equal(readableAssistantReply('需要补齐产品资料。\n```json\n{"taskId":"private"'), '需要补齐产品资料。');
});

test('operations replies hide developer evidence and keep a compact business surface', () => {
  const raw = `当前状态：
本周目标是提升收藏和官网访问，重点产品聚焦于：
- 积雪草精华（对应产品20：安肤修护水光液）
- 唇釉（未在当前41款现货盘中查到，企业知识库无该SKU信息）
目标链路尚未实际发布，没有效果数据回执。
已完成：
- 目标设定（已核验，\`weekly_goals\` 集合中 state: complete）
待处理：
- \`starter_social_content_tasks\` 共14条，plan_review 5条，asset_review 1条。
阻塞项：
- 无可用产品实拍素材。
- 技术链路中断：404 model not activated、image size must be at least 3686400 pixels、fetch failed。
今天最优先动作：
- 上传P4/P33/P20的真实产品素材。
\`\`\`next
确认是否立即上传P4/P33/P20的实拍素材？
是否需要我协助起草唇釉SKU的信息补录模板？
\`\`\``;
  const readable = readableAssistantReply(raw);
  assert.doesNotMatch(readable, /产品20|P4|P33|P20|41款|weekly_goals|starter_social|state|plan_review|asset_review|404|model not activated|pixels|fetch failed/);
  assert.match(readable, /当前产品目录|企业资料中暂未找到该规格|等待方案确认|视频制作暂不可用/);
  const result = splitAssistantReply(readable, { presentation: 'operations' });
  assert.ok(result.summary.length < 700);
  assert.match(result.summary, /当前状态|已完成|待处理|阻塞项|今天最优先动作/);
  assert.ok(result.details.length > 0);
  assert.match(result.details.join('\n'), /积雪草精华/);
  assert.match(result.summary, /```next[\s\S]*补录模板/);
});
