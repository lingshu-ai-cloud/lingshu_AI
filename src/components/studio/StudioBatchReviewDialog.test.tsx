import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import StudioBatchReviewDialog from './StudioBatchReviewDialog';

const html = renderToStaticMarkup(<StudioBatchReviewDialog
  totalShots={17}
  readyShots={13}
  pendingShots={3}
  issues={[{ id: 'product-2', shotNumber: 2, title: '产品展示', question: '这一镜对应哪款产品？', options: [{ id: 'a', label: '产品 A' }, { id: 'b', label: '产品 B' }] }]}
  frames={[{ id: 'frame-3', shotNumber: 3, title: '工厂画面', imageUrl: '/frame.jpg' }]}
  estimatedCostCny={12.5}
  canSubmit={false}
  onSelectIssueOption={() => {}}
  onSubmit={() => {}}
  onClose={() => {}}
/>);
assert.match(html, /role="dialog"/);
assert.match(html, /已就绪 13\/17 镜/);
assert.match(html, /待完成 1 项/);
assert.match(html, /待制作 3 镜/);
assert.match(html, /这一镜对应哪款产品？/);
assert.match(html, /分镜 3 目标首帧/);
assert.match(html, /本批预计费用 ¥12\.50/);
assert.match(html, /确认首帧并生成视频<\/button>/);
assert.match(html, /disabled="" class="ml-auto/);
console.log('Studio batch review dialog presentation passed');

const selectedOnly = renderToStaticMarkup(<StudioBatchReviewDialog totalShots={1} readyShots={0}
  issues={[{ id: 's1', shotNumber: 1, title: '数字人', question: '待生成', selectedOptionId: 'person-1' }]}
  frames={[]} canSubmit={true} onSelectIssueOption={() => {}} onSubmit={() => {}} onClose={() => {}}
  submitLabel="全部完成，进入成片渲染和导出" />);
assert.match(selectedOnly, /待完成 1 项/);
assert.match(selectedOnly, /disabled=""[^>]*>全部完成，进入成片渲染和导出/);
const completed = renderToStaticMarkup(<StudioBatchReviewDialog totalShots={1} readyShots={1}
  issues={[]} frames={[]} canSubmit onSelectIssueOption={() => {}} onSubmit={() => {}} onClose={() => {}}
  submitLabel="全部完成，进入成片渲染和导出" />);
assert.doesNotMatch(completed, /disabled=""[^>]*>全部完成，进入成片渲染和导出/);
