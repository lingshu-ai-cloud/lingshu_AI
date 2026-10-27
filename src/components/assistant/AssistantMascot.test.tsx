import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import AssistantMascot from './AssistantMascot';

test('renders the original hub-seed identity with accessible labeling', () => {
  const html = renderToStaticMarkup(<AssistantMascot size="lg" interactive label="灵小枢吉祥物" />);
  assert.match(html, /data-assistant-mascot="hub-seed"/);
  assert.match(html, /aria-label="灵小枢吉祥物"/);
  assert.match(html, /data-interactive="true"/);
  assert.equal((html.match(/data-assistant-mascot-eye=/g) || []).length, 2);
  assert.match(html, /lingshu-mascot-gradient-/);
});

test('reduced motion keeps the mascot static', () => {
  const html = renderToStaticMarkup(<AssistantMascot interactive reduceMotion />);
  assert.doesNotMatch(html, /data-interactive="true"/);
});

test('pointer tracking is frame-coalesced and removes its listeners', () => {
  const source = readFileSync(new URL('./AssistantMascot.tsx', import.meta.url), 'utf8');
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /addEventListener\('pointermove'/);
  assert.match(source, /removeEventListener\('pointermove'/);
  assert.doesNotMatch(source, /setInterval|setTimeout/);
});
