import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const conversationSource = readFileSync(new URL('./ImageReplicationConversation.tsx', import.meta.url), 'utf8');
const pickerSource = readFileSync(new URL('./ImageReplicationReferencePicker.tsx', import.meta.url), 'utf8');
const sceneSource = readFileSync(new URL('../assistant/AssistantImageReplicationScene.tsx', import.meta.url), 'utf8');

test('embedded image replication stays a compact assistant reply', () => {
  assert.match(conversationSource, /!embedded && QUESTIONS\.slice/, '嵌入首页时不应重复渲染内部问句');
  assert.match(conversationSource, /compact=\{embedded\}/, '首页参考图选择器必须使用精简展示');
  assert.match(pickerSource, /!compact && <div><strong[^]*?先选一张已采集对标图文/, '说明标题仅保留在独立工作区');
  assert.match(pickerSource, /compact \? 'line-clamp-1' : 'line-clamp-2'/, '首页只显示一行原帖摘要');
  assert.match(sceneSource, /已带入原帖，请选择参考图。/);
  assert.match(sceneSource, /参考图已选，请确认产品、平台和语言。/);
  assert.match(sceneSource, /信息已收齐，请确认后生成首版。/);
});
