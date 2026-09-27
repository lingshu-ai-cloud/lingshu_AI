import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSocialDeliveryCopyAndDuration, requestedVideoDurationSeconds } from './socialContentDeliveryGate.js';

test('requested duration is parsed only from explicit bounded seconds', () => {
  assert.equal(requestedVideoDurationSeconds('制作约14.65秒竖屏短视频'), 14.65);
  assert.equal(requestedVideoDurationSeconds('use the video three times'), null);
  assert.equal(requestedVideoDurationSeconds('时长 200 秒'), null);
});

test('internal provenance copy and short output cannot pass delivery', () => {
  const base = { requirements: '制作约14.65秒竖屏短视频', plannedMaximumSeconds: 15 };
  assert.throws(() => assertSocialDeliveryCopyAndDuration({ ...base, narration: '只呈现已确认内容。' }), /内部来源或质检占位语/);
  assert.throws(() => assertSocialDeliveryCopyAndDuration({ ...base, narration: '展示打磨笔与控制机身。', renderedSeconds: 9.01 }), /实际成片/);
  assert.throws(() => assertSocialDeliveryCopyAndDuration({ ...base, narration: '展示打磨笔与控制机身。', plannedMaximumSeconds: 9.01 }), /已锁定画面最多支持/);
  assert.doesNotThrow(() => assertSocialDeliveryCopyAndDuration({ ...base, narration: '展示打磨笔与控制机身。', renderedSeconds: 14.64 }));
});
