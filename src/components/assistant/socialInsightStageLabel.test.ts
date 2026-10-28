import { test } from 'node:test';
import assert from 'node:assert/strict';
import { socialInsightStageLabel } from './socialInsightStageLabel.js';
test('failed jobs never appear as completed reports', () => {
 assert.equal(socialInsightStageLabel({status:'failed',stage:'completed'}),'采集未完成');
 assert.equal(socialInsightStageLabel({status:'succeeded',stage:'completed'}),'整理完成');
 assert.equal(socialInsightStageLabel({status:'running',stage:'collecting'}),'采集并核验公开内容');
});
