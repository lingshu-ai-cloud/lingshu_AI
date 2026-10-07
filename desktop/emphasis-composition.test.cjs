/* eslint-disable */
const assert = require('node:assert/strict');
const { suggestedBudget, normalizeEmphasisPlan, emphasisToAssEvents, captionEmphasisTags } = require('./emphasis-composition.cjs');

assert.equal(suggestedBudget(15_000), 4);
assert.equal(suggestedBudget(30_000), 8);
assert.equal(suggestedBudget(60_000), 12);
assert.equal(suggestedBudget(80_000), 16);

const plan = normalizeEmphasisPlan({
  profile: 'product_showcase',
  maxEvents: 4,
  events: [
    { id: 'hook', type: 'hook', startMs: 0, endMs: 1600, text: '69.9 四支正装', importance: 3, confidence: .98, source: 'metadata', strength: 'strong' },
    { id: 'duplicate', type: 'hook', startMs: 1800, endMs: 2600, text: '69.9 四支正装', importance: 2, confidence: .8, source: 'transcript' },
    { id: 'reveal', type: 'reveal', startMs: 900, endMs: 2400, text: '开灯看效果', importance: 3, confidence: .9, source: 'vision', strength: 'strong' },
    { id: 'unsafe', type: 'key_fact', startMs: 3000, endMs: 4400, text: '岩板台面', importance: 2, confidence: .95, source: 'editor', strength: 'strong', safeArea: false, anchor: { x: .5, y: .9 } },
    { id: 'uncertain', type: 'key_fact', startMs: 5000, endMs: 6000, text: '未经证实价格', importance: 3, confidence: .3, source: 'transcript' },
  ],
}, 10);

assert.equal(plan.profile, 'product_showcase');
assert.equal(plan.events.length, 3, 'deduplicates semantics and rejects low-confidence facts');
assert.equal(plan.events.filter(event => event.strength === 'strong').length, 1, 'overlapping strong events cannot compete');
assert.equal(plan.events.find(event => event.id === 'unsafe').strength, 'weak', 'unsafe placement degrades to compact emphasis');
assert.ok(plan.events.find(event => event.id === 'unsafe').anchor.y <= .68, 'degraded emphasis stays above captions and bottom controls');
assert.equal(plan.events.find(event => event.id === 'hook').hasExplicitAnchor, false, 'generated default anchor is not mistaken for placement evidence');
const ass = emphasisToAssEvents(plan, 1080, 1920).join('\n');
assert.match(ass, /Dialogue: 2/);
assert.match(ass, /69\.9 四支正装/, 'a hook can fall back to a standalone badge when no caption exists');
assert.doesNotMatch(ass, /未经证实价格/);
assert.match(ass, /\\pos\(540,/);

for (const profile of ['d2c_dialogue', 'talking_head', 'factory_process', 'product_showcase']) {
  const normalized = normalizeEmphasisPlan({ profile, events: [{ type: 'cta', startMs: 100, endMs: 1200, text: '私信询价', importance: 2, confidence: 1, source: 'editor' }] }, 2);
  assert.equal(normalized.profile, profile);
  const [cta] = emphasisToAssEvents(normalized, 1080, 1920);
  assert.ok(cta);
  assert.match(cta, /▶ 私信询价/);
  assert.match(cta, /\\pos\(540,1306\)/, 'CTA uses the lower safe information area');
}

const eventVariants = emphasisToAssEvents(normalizeEmphasisPlan({ profile: 'talking_head', events: [
  { type: 'hook', startMs: 0, endMs: 800, text: '开场', importance: 3, confidence: 1, source: 'editor' },
  { type: 'section_label', startMs: 1200, endMs: 2000, text: '仓储实力', importance: 3, confidence: 1, source: 'editor' },
  { type: 'reveal', startMs: 2400, endMs: 3400, text: '成品效果', importance: 3, confidence: 1, source: 'editor' },
] }, 4), 1080, 1920).join('\n');
assert.doesNotMatch(eventVariants, /仓储实力/, 'generic section labels do not create a duplicate top caption');
assert.match(eventVariants, /\\pos\(540,1190\)/, 'reveal uses the lower information zone');
assert.match(captionEmphasisTags(normalizeEmphasisPlan({ profile: 'talking_head', events: [
  { type: 'hook', startMs: 0, endMs: 800, text: '开场', importance: 3, confidence: 1, source: 'transcript' },
] }, 2), 0, .8, 1080), /\\b1/, 'hook emphasizes the primary caption in place');
const sameSizeHook = captionEmphasisTags(normalizeEmphasisPlan({ profile: 'talking_head', events: [
  { type: 'hook', startMs: 0, endMs: 800, text: '开场', importance: 3, confidence: 1, source: 'transcript' },
] }, 2), 0, .8, 1080);
assert.doesNotMatch(sameSizeHook, /\\fs|\\fsc[xy]/, 'Hook keeps the ordinary subtitle size and scale');
const semanticPlan = normalizeEmphasisPlan({ profile: 'factory_process', events: [{
  id: 'warning', type: 'key_fact', text: '注意高温', startMs: 0, endMs: 900, importance: 3, confidence: 1, source: 'editor',
  semanticRole: 'warning', subjectAnchor: { x: .4, y: .5 }, placementEvidence: { safe: true },
}] }, 2);
assert.equal(semanticPlan.events[0].semanticRole, 'warning');
assert.deepEqual(semanticPlan.events[0].subjectAnchor, { x: .4, y: .5 });
const intentPlan = normalizeEmphasisPlan({ profile: 'talking_head', events: [{
  id: 'intent', type: 'key_fact', text: '警告', startMs: 0, endMs: 900, importance: 3, confidence: 1, source: 'editor',
  visualIntent: 'warning', assetIntent: 'warning_marker',
}, {
  id: 'bad-intent', type: 'key_fact', text: '普通事实', startMs: 1000, endMs: 1900, importance: 2, confidence: 1, source: 'editor',
  visualIntent: 'arbitrary_css', assetIntent: '../../../asset',
}] }, 2);
assert.equal(intentPlan.events[0].visualIntent, 'warning');
assert.equal(intentPlan.events[0].assetIntent, 'warning_marker');
assert.equal(intentPlan.events[1].visualIntent, undefined, 'unknown renderer intents are dropped');
assert.equal(intentPlan.events[1].assetIntent, undefined, 'asset paths cannot cross the renderer boundary');

console.log('caption emphasis composition regression passed');
