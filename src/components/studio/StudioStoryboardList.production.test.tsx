import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { StudioStoryboardList } from './StudioWorkbenchFrame';

test('storyboard cards expose the server production route, cost envelope and blockers', () => {
  const html = renderToStaticMarkup(<StudioStoryboardList items={[{
    id: 'shot-1',
    index: 1,
    title: '产品展示',
    status: 'warning',
    statusLabel: '等待资料',
    production: {
      routeLabel: '智能生成首帧',
      identityLabel: '需质检确认',
      expectedCostCny: 2.4,
      upperBoundCostCny: 4.8,
      missingInputs: ['产品正面图'],
      blockers: ['预算尚未批准'],
    },
  }]} />);

  for (const expected of [
    '路线', '智能生成首帧', '成本', '预计 ¥2.40 · 上限 ¥4.80',
    '产品精度', '需质检确认', '缺少：', '产品正面图', '阻塞：', '预算尚未批准',
  ]) assert.match(html, new RegExp(expected));
});

test('product identity stays optional for non-product production routes', () => {
  const html = renderToStaticMarkup(<StudioStoryboardList items={[{
    id: 'shot-2',
    index: 2,
    title: '字幕转场',
    production: { routeLabel: '素材剪辑', expectedCostCny: 0 },
  }]} />);

  assert.match(html, /素材剪辑/);
  assert.match(html, /预计 ¥0\.00/);
  assert.doesNotMatch(html, /产品精度/);
});
