import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import EnterprisePresenters from './EnterprisePresenters.js';

test('presenter settings request a separate DashScope quality-inspection consent', () => {
  const html=renderToStaticMarkup(<EnterprisePresenters />);
  assert.match(html,/允许阿里云百炼接收人物图和候选采样帧/);
  assert.match(html,/未勾选时不会向百炼外发人物图/);
  assert.match(html,/身份、产品／品牌／文字项目保留为人工验收/);
  assert.match(html,/允许阿里云百炼使用授权人物图生成构图草稿/);
  assert.match(html,/产生生图费用/);
  assert.match(html,/控制台显示状态为 Active/);
  assert.match(html,/该资产与上方选中的本地照片属于同一位授权人物/);
  assert.match(html,/保存人工核验结果/);
  assert.match(html,/没有 Assets API 权限的 Entry 流程/);
});

test('content production manages people without asking users to copy a HeyGen look ID', () => {
  const html = renderToStaticMarkup(<EnterprisePresenters contentProduction />);
  assert.match(html, /选择或创建人物/);
  assert.doesNotMatch(html, /HeyGen人物\/Look ID|添加授权人物/);
});

test('initial configuration only exposes the person and voice entry point', () => {
  const html = renderToStaticMarkup(<EnterprisePresenters initialConfiguration />);
  assert.match(html, /企业默认人物/);
  assert.match(html, /选择或创建人物/);
  assert.doesNotMatch(html, /默认出镜偏好|新分镜默认布局|添加授权人物/);
});
