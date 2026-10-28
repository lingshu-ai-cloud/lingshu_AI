import assert from 'node:assert/strict';
import test from 'node:test';
import { DigitalEmployeeApiError } from './digitalEmployeeApi';
import { weeklyReadinessGuidance } from './weeklyReadinessGuidance';

test('weekly preflight explains the first missing action without exposing internal archetypes', () => {
  const error = new DigitalEmployeeApiError(409, 'production_onboarding_preflight_blocked',
    '制作详情尚未生成：P5A_EXHIBITION 缺少片段', { blockers: [
      { code: 'presenter_missing', message: '默认数字人物未授权' },
      { code: 'local_material_missing', archetypeId: 'P5A_EXHIBITION', message: 'P5A_EXHIBITION 缺少片段' },
    ] });
  const reply = weeklyReadinessGuidance(error);
  assert.match(reply || '', /本周计划已保存，但还没有进入生产/);
  assert.match(reply || '', /数字人物/);
  assert.match(reply || '', /完成后告诉我/);
  assert.doesNotMatch(reply || '', /P5A_EXHIBITION/);
});

test('unstructured failures are not misrepresented as missing inputs', () => {
  assert.equal(weeklyReadinessGuidance(new Error('network unavailable')), null);
});

test('persisted preparation blockers also become a friendly next step', () => {
  const reply = weeklyReadinessGuidance(new Error('任务包准备未通过：P5A_EXHIBITION 缺少已授权素材片段。本周任务尚未启动。'));
  assert.match(reply || '', /补充已授权的同类视频片段/);
  assert.doesNotMatch(reply || '', /P5A_EXHIBITION/);
});
