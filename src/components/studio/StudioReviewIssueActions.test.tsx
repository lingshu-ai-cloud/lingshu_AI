import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import StudioReviewIssueActions from './StudioReviewIssueActions';
import { newDigitalHumanRequirements } from '../../lib/digitalHumanPlan';
const props = { presenters: [], presenterId: '', products: [{ id: 'p1', label: '产品一', imageUrls: [] }], productIds: ['p1'], busy: false,
  onSaveDigital: async () => {}, onSaveProducts: async () => {}, onUpload: async () => {}, onChangeType: async () => {}, onAction: () => {} };
const product = renderToStaticMarkup(<StudioReviewIssueActions {...props} digital={false} />);
assert.match(product, /上传产品一图片/);
assert.match(product, /disabled=""[^>]*>重新生成首帧/);
assert.doesNotMatch(product, /企业人物|照片人物复刻/);
const digital = renderToStaticMarkup(<StudioReviewIssueActions {...props} digital requirements={newDigitalHumanRequirements()} />);
assert.match(digital, /disabled=""[^>]*>确认并保存制作方案/);
assert.match(digital, /修正素材类型/);
assert.doesNotMatch(digital, /上传产品一图片/);
console.log('Review issue route separation and prerequisite guards passed');

const submitted = renderToStaticMarkup(<StudioReviewIssueActions {...props} digital submitted requirements={newDigitalHumanRequirements()} />);
assert.match(submitted, /disabled=""[^>]*>任务已提交，等待生成/);
