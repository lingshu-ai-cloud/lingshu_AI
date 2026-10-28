import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./InspirationDashboard.tsx', import.meta.url), 'utf8')
  + readFileSync(new URL('./inspiration/useInspirationDiscoveryInventory.ts', import.meta.url), 'utf8');
const actionSource = readFileSync(new URL('./inspiration/inspirationImageCrawlAction.ts', import.meta.url), 'utf8');
const dialogSource = readFileSync(new URL('./inspiration/InspirationImageCrawlDialog.tsx', import.meta.url), 'utf8');
const resultsSource = readFileSync(new URL('./inspiration/InspirationVideoResults.tsx', import.meta.url), 'utf8');

test('viral library prioritizes benchmark accounts and keeps keyword image posts as a supplement', () => {
  assert.match(source, /type="primary" icon=\{<Users size=\{15\} \/>\} onClick=\{\(\) => setInnerView\('accounts'\)\}>采集对标账号爆款<\/Button>/);
  assert.match(source, /<Button icon=\{<Images size=\{15\} \/>\} onClick=\{openImageCrawl\}>关键词补充<\/Button>/);
  assert.match(source, /<InspirationImageCrawlDialog[\s\S]*?onSubmit=\{\(\) => void runImageCrawl\(\)\}/);
  assert.match(dialogSource, /title="关键词补充采集"/);
  assert.match(dialogSource, /只保留一张静态图片及原帖配文，不采图组、轮播或 GIF/);
  assert.match(dialogSource, /closable=\{!busy\}/);
  assert.match(dialogSource, /onCancel=\{\(\) => \{ if \(!busy\) onClose\(\); \}\}/);
  assert.match(source, /runInspirationImageCrawl\(\{/);
  assert.match(actionSource, /crawlInspirationImages/);
  assert.match(actionSource, /context\.setContentFormat\('image'\)/);
  assert.match(actionSource, /context\.refreshVideos\(1, false, \{/);
  assert.match(source, /<InspirationVideoResults[\s\S]*?videos=\{filtered\}/);
  assert.match(resultsSource, /<LsMasonryGallery layout="masonry" items=\{videos\.map/);
});

test('pending production gaps are presented as shooting tasks without the assistant routing shortcut', () => {
  assert.match(source, /待拍 · \$\{shootingNeeds\.length \+ pendingShootingTaskCount\(scriptGapTasks\)\}/);
  assert.doesNotMatch(source, /让灵小枢选路|生产缺口/);
});
