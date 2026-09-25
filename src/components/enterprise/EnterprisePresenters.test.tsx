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
  assert.match(html,/控制台已显示 Active/);
  assert.match(html,/没有 Assets API 权限的 Entry 流程/);
});
