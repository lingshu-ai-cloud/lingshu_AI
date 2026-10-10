import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StudioBatchReviewContent, StudioBatchReviewFooter, type StudioBatchReviewDialogProps } from './StudioBatchReviewDialog';

// Ant Modal owns the browser portal/focus trap; render its body and fixed footer here.
const props: StudioBatchReviewDialogProps = {
  totalShots: 17, readyShots: 13, pendingShots: 3,
  issues: [{ id: 'product-2', shotNumber: 2, title: '产品展示', question: '这一镜对应哪款产品？', options: [{ id: 'a', label: '产品 A' }, { id: 'b', label: '产品 B' }] }],
  frames: [{ id: 'frame-3', shotNumber: 3, title: '工厂画面', imageUrl: '/frame.jpg' }],
  estimatedCostCny: 12.5, canSubmit: false,
  onSelectIssueOption: () => {}, onSubmit: () => {}, onClose: () => {},
};
const html = renderToStaticMarkup(<StudioBatchReviewContent {...props} />);
assert.match(html, /已就绪 13\/17 镜/);
assert.match(html, /待完成 1 项/);
assert.match(html, /待制作 3 镜/);
assert.match(html, /这一镜对应哪款产品？/);
assert.match(html, /分镜 3 目标首帧/);
const footer = renderToStaticMarkup(<StudioBatchReviewFooter {...props} />);
assert.match(footer, /本批预计费用 ¥12\.50/);
assert.match(footer, /确认首帧并生成视频/);
assert.match(footer, /<button[^>]*disabled=""/);
const selectedOnly = renderToStaticMarkup(<StudioBatchReviewFooter {...props} canSubmit
  issues={[{ id: 's1', shotNumber: 1, title: '数字人', question: '待生成', selectedOptionId: 'person-1' }]} />);
assert.match(selectedOnly, /<button[^>]*disabled=""/, '选中处理方式不代表问题已解决');
const completed = renderToStaticMarkup(<StudioBatchReviewFooter {...props} issues={[]} canSubmit />);
assert.doesNotMatch(completed, /<button[^>]*disabled=""/, '全部问题解决后才能提交');
const busy = renderToStaticMarkup(<StudioBatchReviewFooter {...props} issues={[]} canSubmit busy />);
assert.match(busy, /<button[^>]*disabled=""/, '提交过程中禁止重复提交');
console.log('Studio batch review content and submit gating passed');
