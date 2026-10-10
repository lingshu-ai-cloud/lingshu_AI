import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import ShotRoutingRecommendation from './ShotRoutingRecommendation.js';

test('shows route reason, missing inputs and alternatives without exposing providers', () => {
  const html = renderToStaticMarkup(<ShotRoutingRecommendation decision={{
    route: 'first_frame_video', confidence: 0.88, requiresUserConfirmation: true,
    reasons: ['需要保留工厂背景。'], missing: ['缺少可信人物图片资产'],
    alternatives: [{ route: 'material_edit', label: '已有企业人物视频', source: 'material', description: '优先剪辑已拍摄素材。' }],
  }} onSelect={() => {}} />);
  for (const label of ['系统推荐', '目标人物首帧驱动', '置信度 88% · 待确认', '需要保留工厂背景', '还需补齐', '缺少可信人物图片资产', '查看备选制作方式', '已有企业人物视频']) assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, /Seedance|HeyGen|Runway/);
});
