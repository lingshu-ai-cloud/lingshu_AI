/* eslint-disable */
const assert = require('node:assert/strict');
const { advancedEvents } = require('./remotion-overlay.cjs');

const selected = advancedEvents({ events: [
  { id: 'hook', type: 'hook', startMs: 0, endMs: 800, text: '开场' },
  { id: 'fact', type: 'key_fact', startMs: 1200, endMs: 2200, text: '1件起订' },
  { id: 'section', type: 'section_label', startMs: 2500, endMs: 3200, text: '工厂实力' },
  { id: 'cta', type: 'cta', startMs: 3500, endMs: 4500, text: '立即咨询' },
] });

assert.deepEqual(selected.map(event => event.id), ['fact', 'cta']);
assert.deepEqual(selected[0], { id: 'fact', type: 'key_fact', startMs: 1200, endMs: 2200, text: '1件起订' });
console.log('remotion overlay selection regression passed');
