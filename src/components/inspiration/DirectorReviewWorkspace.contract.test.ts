import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../InspirationDashboard.tsx', import.meta.url), 'utf8');
const review = fs.readFileSync(new URL('./DirectorReviewWorkspace.tsx', import.meta.url), 'utf8');

assert.match(page, /<DirectorReviewWorkspace[^>]*recordId=\{exactReview\.recordId\}[^>]*handoff=\{exactReview\.handoff\}/,
  'the selected exact review must mount the extracted workspace with its original record and handoff');
assert.match(page, /renderVideo=\{url => <AuthenticatedVideo[^>]*apiUrl=\{url\}/,
  'review clips must still use the authenticated media viewer');
assert.match(page, /renderImage=\{\(url, alt\) => <AuthenticatedImage[^>]*src=\{url\}/,
  'review first frames must still use authenticated images');
assert.match(review, /session\.active=false[\s\S]*AUTH_TOKEN_CHANGED_EVENT/,
  'a changed login must invalidate the prior review request and state');
assert.match(review, /getToken\(\)===identity\.current\.token/,
  'each review response must still match the mounted login identity');
assert.match(review, /confirmed && !canExplicitlySubmitReferenceAsr\(asrJob,asrConsent,asrBusy\)/,
  'paid phrase ASR submission must still require explicit consent and server admission');
assert.match(review, /No automatic ASR or polling[\s\S]*return \(\) => \{ active = false; \}/,
  'mounting the review must not submit a paid ASR operation');
assert.match(review, /供应商状态不确定，请人工核对原回执；不会重新提交/,
  'uncertain provider outcomes must stay visible without automatic resubmission');

console.log('director review workspace wiring and paid ASR boundaries passed');
