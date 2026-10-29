import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const conversationSource = readFileSync(new URL('./ImageReplicationConversation.tsx', import.meta.url), 'utf8');
const pickerSource = readFileSync(new URL('./ImageReplicationReferencePicker.tsx', import.meta.url), 'utf8');
const sceneSource = readFileSync(new URL('../assistant/AssistantImageReplicationScene.tsx', import.meta.url), 'utf8');
const executionSource = readFileSync(new URL('./ImageCreationTaskExecution.tsx', import.meta.url), 'utf8');
const designSystemSource = readFileSync(new URL('../../styles/design-system.css', import.meta.url), 'utf8');

test('embedded image replication stays a compact assistant reply', () => {
  assert.match(conversationSource, /!embedded && QUESTIONS\.slice/, '嵌入首页时不应重复渲染内部问句');
  assert.match(conversationSource, /compact=\{embedded\}/, '首页参考图选择器必须使用精简展示');
  assert.match(pickerSource, /!compact && <div><strong[^]*?先选一张已采集对标图文/, '说明标题仅保留在独立工作区');
  assert.match(pickerSource, /compact \? 'line-clamp-1' : 'line-clamp-2'/, '首页只显示一行原帖摘要');
  assert.match(sceneSource, /已带入原帖，请选择参考图。/);
  assert.match(sceneSource, /参考图已选，请确认产品、平台和语言。/);
  assert.match(sceneSource, /信息已收齐，请确认后生成首版。/);
  assert.match(sceneSource, /已创建图文任务，制作进度如下。/);
  assert.match(conversationSource, /<ImageCreationTaskExecution contentTaskId=\{contentTaskId\}\/>/, '确认后必须在灵小枢会话内显示真实制作进度');
  assert.doesNotMatch(conversationSource, /openImageCreationTask|进入创作任务/, '确认后不得跳转或退化为任务跳转按钮');
});

test('image choices remain visible and production shows only the current automatic stage', () => {
  assert.match(designSystemSource, /\.ant-select \.ant-select-input\s*\{[^}]*background:\s*transparent/, 'Ant Select 内部搜索输入不得遮住已选平台、产品或语言');
  assert.match(designSystemSource, /\.ant-select \.ant-select-content\s*\{[^}]*color:\s*var\(--ls-text\)/, 'Ant 6 已选值必须使用当前主题可读文字色');
  assert.match(conversationSource, /预计费用（图片模型环节）/, '确认生成前展示模型成本估算范围');
  assert.doesNotMatch(conversationSource, /请先填写本次制作费用上限|保存并等待费用核验/, '不能用费用核验阻止新任务');
  assert.doesNotMatch(executionSource, /<Timeline|stages\.map/, '会话进度不得展开全部内部节点');
  assert.match(executionSource, /data-image-current-stage=\{activeStage\[0\]\}/, '会话进度只显示当前真实节点');
  assert.doesNotMatch(executionSource, /<strong>图文制作进度<\/strong>|<p className="mt-2 text-sm">\{task\?\.status/, '会话进度卡上方不得重复显示进度标题和总状态');
  assert.match(executionSource, /原参考记录缺少可核验的风格标签，系统已按广告式产品图制作/, '旧记录降级时说明缺少标签，不误称图片风格无法判断');
  assert.match(executionSource, /working\?<Spin size="small"\/>/, '自动生产时必须显示持续工作状态');
  assert.doesNotMatch(executionSource, /这条任务未记录制作费用上限/, '缺少预算不阻塞生产');
});

test('product presence stays system-owned and uncertain references retain the same task for replacement', () => {
  assert.doesNotMatch(conversationSource, /<fieldset|<Radio\.Group|参考图中是否有产品|请人工核对/);
  assert.match(conversationSource, /confirmReferenceProduct\(current, 'auto'\)/);
  assert.match(conversationSource, /reanalyzeCollectedImageReference/);
  assert.match(conversationSource, /let task = awaitingReference \|\| await createImageReplicationDraft/);
  assert.match(conversationSource, /socialImageApi\.updateTask\(task, \{ referenceUrls/);
  assert.match(conversationSource, /setAwaitingReference\(pendingTask\)/);
});

test('confirmation form omits redundant language guidance and optional creative requirements', () => {
  assert.doesNotMatch(conversationSource, /图片创作文案与帖子配文使用同一语言/);
  assert.doesNotMatch(conversationSource, /补充创作要求（可选）|这次重点表达什么|希望客户采取的行动/);
  assert.match(conversationSource, /product && !product\.highlights\?\.trim\(\).*补充产品卖点（必填）/);
});
