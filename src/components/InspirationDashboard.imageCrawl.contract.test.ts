import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./InspirationDashboard.tsx', import.meta.url), 'utf8');
const dialogSource = readFileSync(new URL('./inspiration/InspirationImageCrawlDialog.tsx', import.meta.url), 'utf8');

test('viral library prioritizes benchmark accounts and keeps keyword image posts as a supplement', () => {
  assert.match(source, /type="primary" icon=\{<Users size=\{15\} \/>\} onClick=\{\(\) => setInnerView\('accounts'\)\}>采集对标账号爆款<\/Button>/);
  assert.match(source, /<Button icon=\{<Images size=\{15\} \/>\} onClick=\{openImageCrawl\}>关键词补充<\/Button>/);
  assert.match(source, /<InspirationImageCrawlDialog[\s\S]*?onSubmit=\{\(\) => void runImageCrawl\(\)\}/);
  assert.match(dialogSource, /title="关键词补充采集"/);
  assert.match(dialogSource, /图文会同时保留图片、轮播顺序和原帖配文/);
  assert.match(dialogSource, /closable=\{!busy\}/);
  assert.match(dialogSource, /onCancel=\{\(\) => \{ if \(!busy\) onClose\(\); \}\}/);
  assert.match(source, /crawlInspirationImages\(\{/);
  assert.match(source, /setContentFormat\('image'\)/);
  assert.match(source, /refreshVideos\(1, false, \{\s*contentFormat: 'image'/);
  assert.match(source, /<LsMasonryGallery layout="masonry" items=\{filtered\.map/);
});

test('pending production gaps are presented as shooting tasks without the assistant routing shortcut', () => {
  assert.match(source, /待拍任务 · \$\{shootingNeeds\.length \+ scriptGapTasks\.length\}/);
  assert.doesNotMatch(source, /让灵小枢选路|生产缺口/);
});
