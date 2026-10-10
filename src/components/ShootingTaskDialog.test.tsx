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

test('compact shot cards keep detailed controls behind More and digital generation does not copy video', () => {
  const source = readFileSync(new URL('./AiCreateStudio.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('aria-label={`分镜 ${index + 1}`}');
  const more = source.indexOf('<summary', start);
  const card = source.slice(start, more);
  assert.ok(start > 0 && more > start);
  assert.match(card, /换画面/); assert.match(card, /改台词/);
  assert.match(card, /slotScript.voice/);
  assert.doesNotMatch(card, /slotScript.visual|slotScript.subtitle|clip\.name|shotBrief|产品：|状态：/);
  const generator = source.slice(source.indexOf('const generateDigitalHumanPresenter ='), source.indexOf('/* ── BGM 曲库'));
  assert.match(generator, /尚未接入/);
  assert.doesNotMatch(generator, /uploadMaterial|fetch\(|blobToDataUrl|已生成数字人口播/);
});
