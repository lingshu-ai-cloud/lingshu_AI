import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCoverSvg } from './studioCoverSvg.js';

const frame = 'data:image/png;base64,aGVsbG8=';

test('cover SVG preserves ratio, embedded frame and escaped title', () => {
  const square = buildCoverSvg({ title: '研发 <新品> & 上市', ratio: '1:1', accent: '#d97706', bgImageUrl: frame });
  assert.match(square, /viewBox="0 0 1080 1080"/);
  assert.match(square, /<image href="data:image\/png;base64,aGVsbG8="/);
  assert.match(square, /研发 &lt;新品&gt; &amp; 上市/);
  assert.doesNotMatch(square, /<新品>/);
  const wide = buildCoverSvg({ title: 'Wide', ratio: '16:9', accent: '#d97706', bgImageUrl: frame });
  assert.match(wide, /viewBox="0 0 1920 1080"/);
  const tall = buildCoverSvg({ title: 'Tall', ratio: '9:16', accent: '#d97706', bgImageUrl: frame });
  assert.match(tall, /viewBox="0 0 1080 1920"/);
});

test('cover SVG keeps all existing layout presets without mutating the source frame', () => {
  for (const artPreset of ['clean', 'outline', 'highlight', 'magazine', 'neon', 'sticker'] as const) {
    const svg = buildCoverSvg({ title: 'Cover title', ratio: '9:16', accent: '#d97706', bgImageUrl: frame, artPreset });
    assert.match(svg, /<image href="data:image\/png;base64,aGVsbG8="/);
    assert.match(svg, /<text /);
    assert.match(svg, /<\/svg>$/);
  }
});

test('cover SVG rejects attribute injection through the requested text color', () => {
  const svg = buildCoverSvg({ title: 'Safe', ratio: '9:16', accent: '#d97706', bgImageUrl: frame,
    color: '#fff" onload="alert(1)' });
  assert.match(svg, /fill="#ffffff"/);
  assert.doesNotMatch(svg, /onload=/);
  const branded = buildCoverSvg({ title: 'Safe', ratio: '9:16', accent: '#d97706', bgImageUrl: frame,
    color: '#A1b2C3' });
  assert.match(branded, /fill="#A1b2C3"/);
});
