import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./studio.ts', import.meta.url), 'utf8');
const renderContract = source.slice(source.indexOf('interface RenderSpec'), source.indexOf('// POST /studio/render/local'));

test('render authorization always builds one canonical emphasis plan into the signed manifest', () => {
  assert.match(renderContract, /const emphasisPlan = buildStudioEmphasisPlan\(\{/);
  assert.match(renderContract, /subtitles: spec\.subtitles/);
  assert.match(renderContract, /timeline: rawTimeline/);
  assert.match(renderContract, /emphasisPlan: spec\.emphasisPlan/);
  assert.match(renderContract, /effectPlan: normalizedEffectPlan,\s*emphasisPlan,/);
  assert.doesNotMatch(renderContract, /emphasisTimeline\s*:/, 'the manifest must not duplicate caption/event state');
});
