import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantFileIntent, assistantFileMarker, extractAssistantFiles } from './assistantFileIntent';
test('explicit files dispatch by real output type; questions and negative requests do not', () => {
  assert.equal(assistantFileIntent('生成《Support Scope & Timeline》PDF摘要（含双语）')?.format, 'pdf');
  assert.equal(assistantFileIntent('帮我生成市场进入路线图')?.format, 'jpg');
  assert.equal(assistantFileIntent('想要地图')?.needsMapScope, true);
  assert.equal(assistantFileIntent('如何生成PDF？'), null);
  assert.equal(assistantFileIntent('不要PDF，只要文字'), null);
  const id = 'a'.repeat(64); const parsed = extractAssistantFiles(`已生成。\n${assistantFileMarker(id)}`);
  assert.deepEqual(parsed.ids, [id]); assert.equal(parsed.text.trim(), '已生成。');
});
