import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { growthTourBubblePosition } from './HomeGrowthTour';

const bubble = { width: 320, height: 180 };
const viewport = { width: 900, height: 650 };

test('tour bubble stays outside a central input spotlight', () => {
  const target = { left: 290, top: 360, right: 850, bottom: 450, width: 560, height: 90 };
  const position = growthTourBubblePosition(target, bubble, viewport);
  assert.ok(position.top + bubble.height < target.top || position.top > target.bottom);
  assert.ok(position.left >= 12 && position.left + bubble.width <= viewport.width - 12);
});

test('tour bubble uses the open side of a sidebar spotlight', () => {
  const target = { left: 6, top: 160, right: 240, bottom: 235, width: 234, height: 75 };
  const position = growthTourBubblePosition(target, bubble, viewport);
  assert.ok(position.top >= target.bottom || position.left >= target.right);
});

test('calendar tour step opens the unified queue and can leave it', () => {
  const source = readFileSync(new URL('./HomeGrowthTour.tsx', import.meta.url), 'utf8');
  assert.match(source, /openContentGenerationQueue\(\{ view: 'calendar' \}\)/);
  assert.match(source, /if \(index === 2\) closeContentGenerationQueue\(\)/);
  assert.match(source, /data-growth-tour=\"queue-modal\"/);
});
