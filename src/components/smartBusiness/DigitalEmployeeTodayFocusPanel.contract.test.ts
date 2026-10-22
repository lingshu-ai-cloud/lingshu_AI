import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../DigitalEmployeePage.tsx', import.meta.url), 'utf8');
const focus = fs.readFileSync(new URL('./DigitalEmployeeTodayFocusPanel.tsx', import.meta.url), 'utf8');

assert.match(page, /workspaceView === ["']today["'][\s\S]{0,5000}<TodayFocusPanel[\s\S]{0,300}runStatusLabel=\{status => statusLabel\[status\] \|\| status\}/,
  'today view must mount the extracted panel with existing run status language');
assert.match(focus, /data\.tasks\.find\([\s\S]*taskNeedsAttention\(task\)/,
  'the first blocked task must still receive attention');
assert.match(focus, /data\.approvals\.filter\(\(item\) => item\.status === "pending"\)/,
  'pending approvals must remain visible');
assert.match(focus, /isDraft && data\.plan[\s\S]*onReviewPlan/,
  'an unconfirmed weekly plan must link back to review');
assert.match(focus, /attentionItems\.slice\(0, 3\)/,
  'today attention must remain bounded to three visible actions');

console.log('digital employee today focus boundary passed');
