import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSocialImageRevisionPrompt, socialImageRequestedRatio, socialImageRevisionTarget } from './socialImageRevision.js';

test('revision target is inferred without adding another user step', () => {
  assert.equal(socialImageRevisionTarget('产品缩小一点并下移'), 'product');
  assert.equal(socialImageRevisionTarget('背景换成蓝色，遮罩淡一点'), 'background');
  assert.equal(socialImageRevisionTarget('标题字号小一点'), 'typography');
  assert.equal(socialImageRevisionTarget('把底下的底栏改成三栏式'), 'typography');
  assert.equal(socialImageRevisionTarget('要1:1比例'), 'typography');
  assert.equal(socialImageRequestedRatio('要1:1比例'), '1:1');
  assert.equal(socialImageRequestedRatio('保持原图'), null);
});
test('revision prompt locks untouched regions and exact canvas', () => {
  const prompt = buildSocialImageRevisionPrompt({ instruction: '产品下移', target: 'product', unitIndex: 0, unitCount: 4, exactCanvas: '1080x1350' });
  assert.match(prompt, /Change only the requested target layer/);
  assert.match(prompt, /1080x1350/);
  assert.match(prompt, /current output/i);
});
