import assert from 'node:assert/strict';
import test from 'node:test';
import { DigitalEmployeeApiError } from './digitalEmployeeApi';
import { displayWeeklyReadinessText, weeklyReadinessGuidance } from './weeklyReadinessGuidance';

test('older fact-version replies show sync instead of a missing-enterprise modal', () => {
  const old = '本周计划还没有开始。当前不是缺少某个企业资料输入框，而是计划引用的资料版本与已确认的企业资料版本不一致。\n\n先核对企业与品牌资料。';
  const shown = displayWeeklyReadinessText(old);
  assert.match(shown, /点击“同步周计划”/);
  assert.doesNotMatch(shown, /核对企业与品牌资料|资料版本不一致/);
});

test('weekly preflight explains the first missing action without exposing internal archetypes', () => {
  const error = new DigitalEmployeeApiError(409, 'production_onboarding_preflight_blocked',
    '制作详情尚未生成：P5A_EXHIBITION 缺少片段', { blockers: [
      { code: 'presenter_missing', message: '默认数字人物未授权' },
      { code: 'local_material_missing', archetypeId: 'P5A_EXHIBITION', message: 'P5A_EXHIBITION 缺少片段' },
    ] });
  const reply = weeklyReadinessGuidance(error);
  assert.match(reply || '', /^本周计划还没有开始。\n\n当前需要处理：可用的数字人物与声音。\n\n先录入数字人物与声音。$/);
  assert.doesNotMatch(reply || '', /11 项|调整为不需要人物口播|完成后告诉我/);
  assert.doesNotMatch(reply || '', /P5A_EXHIBITION/);
});

test('unstructured failures are not misrepresented as missing inputs', () => {
  assert.equal(weeklyReadinessGuidance(new Error('network unavailable')), null);
});

test('mixed weekly image gap is explained without pretending production started', () => {
  const reply = weeklyReadinessGuidance(new DigitalEmployeeApiError(409, 'weekly_image_production_not_connected',
    'image dispatch unavailable', { imageSlotIds: ['image-1', 'image-2', 'image-3', 'image-4'] }));
  assert.match(reply || '', /4 张图片安排/);
  assert.match(reply || '', /没有启动生产/);
  assert.doesNotMatch(reply || '', /weekly_image_production_not_connected/);
});

test('persisted preparation blockers also become a friendly next step', () => {
  const reply = weeklyReadinessGuidance(new Error('任务包准备未通过：P5A_EXHIBITION 缺少已授权素材片段。本周任务尚未启动。'));
  assert.match(reply || '', /先补充视频素材/);
  assert.doesNotMatch(reply || '', /P5A_EXHIBITION/);
});

test('older verbose weekly footage replies are shortened without a duplicate details section', () => {
  const old = '本周计划还没有开始。\n\n以下视频镜头还缺可用实拍：\n1. 「视频 1：新品展会」，镜头 2：需要展会实拍。\n\n先补充视频素材。';
  const shown = displayWeeklyReadinessText(old);
  assert.match(shown, /预览如下/);
  assert.doesNotMatch(shown, /镜头 2|展会实拍/);
});
