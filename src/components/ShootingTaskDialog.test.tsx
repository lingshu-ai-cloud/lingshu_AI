import { readAiStudioApplicationSources } from '../../tests/fixtures/aiStudioApplicationSources.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import ShootingTaskDialog from './ShootingTaskDialog.js';

test('shooting dialog explains voiceover and safe refill, and exposes save failures', () => {
  const html = renderToStaticMarkup(<ShootingTaskDialog title="分镜 2" brief="进料细节" duration={3} ratio="9:16" busy={false} error="草稿保存失败" onClose={() => {}} onSubmit={() => {}} />);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /进料细节/);
  assert.match(html, /无声画面/);
  assert.match(html, /已有画面不覆盖/);
  assert.match(html, /role="alert"[^]*草稿保存失败/);
  assert.match(html, /保存草稿并创建任务/);
});

test('the live workbench mounts the storyboard list and reviewed digital candidates', () => {
  const source = readAiStudioApplicationSources();
  const productionPanel = readFileSync(new URL('./ShotProductionPanel.tsx', import.meta.url), 'utf8');
  assert.match(source, /<StudioStoryboardList items=\{items\} selectedId=\{activeWorkbenchSlot\?\.id\}/);
  assert.match(source, /const ShotProductionPanel = lazy\(\(\) => import\('\.\/ShotProductionPanel'\)\)/);
  assert.match(productionPanel, /aria-label="数字人候选片段"/);
  assert.match(productionPanel, /提交结果未知时只核对原任务，不自动再次生成/);
});
