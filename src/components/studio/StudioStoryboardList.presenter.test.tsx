import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StudioStoryboardList } from './StudioWorkbenchFrame';
const html = renderToStaticMarkup(<StudioStoryboardList items={[
  { id: 'sales', index: 1, title: '销售出镜', livePresenter: true },
  { id: 'factory', index: 2, title: '工厂实拍' },
]} />);
assert.equal(html.split('销售人物已确认 · 数字人复刻').length - 1, 1);
assert.match(html, /text-red-600/);
console.log('Presenter red badge presentation passed');
