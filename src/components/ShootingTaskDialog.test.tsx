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

test('the live workbench mounts the storyboard list and digital generation does not copy video', () => {
  const source = readFileSync(new URL('./AiCreateStudio.tsx', import.meta.url), 'utf8');
  assert.match(source, /<StudioStoryboardList items=\{items\} selectedId=\{activeWorkbenchSlot\?\.id\}/);
  const generator = source.slice(source.indexOf('const generateDigitalHumanPresenter ='), source.indexOf('/* ── BGM 曲库'));
  assert.match(generator, /尚未接入/);
  assert.doesNotMatch(generator, /uploadMaterial|fetch\(|blobToDataUrl|已生成数字人口播/);
});
