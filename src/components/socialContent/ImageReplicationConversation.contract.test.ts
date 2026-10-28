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
  assert.match(sceneSource, /已确认，正在生成图文首版。/);
  assert.match(conversationSource, /<ImageCreationTaskExecution contentTaskId=\{contentTaskId\}\/>/, '确认后必须在灵小枢会话内显示真实制作进度');
  assert.doesNotMatch(conversationSource, /openImageCreationTask|进入创作任务/, '确认后不得跳转或退化为任务跳转按钮');
});

test('image choices remain visible and production shows only the current automatic stage', () => {
  assert.match(designSystemSource, /\.ant-select \.ant-select-input\s*\{[^}]*background:\s*transparent/, 'Ant Select 内部搜索输入不得遮住已选平台、产品或语言');
  assert.match(designSystemSource, /\.ant-select \.ant-select-selection-item\s*\{[^}]*color:\s*var\(--ls-text\)/, '已选值必须使用当前主题可读文字色');
  assert.match(conversationSource, /单条费用上限（元，必填）/, '付费制作前必须先明确单条费用上限');
  assert.match(conversationSource, /step === 2 && budgetLimitCny == null/, '未确认费用上限时不得把任务送进自动生产');
  assert.doesNotMatch(executionSource, /<Timeline|stages\.map/, '会话进度不得展开全部内部节点');
  assert.match(executionSource, /data-image-current-stage=\{activeStage\[0\]\}/, '会话进度只显示当前真实节点');
  assert.match(executionSource, /working\?<Spin size="small"\/>/, '自动生产时必须显示持续工作状态');
});
