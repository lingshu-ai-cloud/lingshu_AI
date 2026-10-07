import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeStudioVisualEvidence, extractStudioVisualEvidenceJson } from './studioVisualEvidence.js';

const input = {
  contactSheet: Buffer.from('jpeg'),
  shotWindows: [{ id: 'shot-1', startMs: 0, endMs: 2_000, confidence: .9, source: 'ffmpeg_scene' as const }],
  contactFrames: [{ shotId: 'shot-1', timeMs: 400, column: 0, row: 0 }],
  captionOccupancy: [], candidateEvents: [],
};

test('normalizes one injected contact-sheet analysis and rejects unknown shots', async () => {
  let calls = 0;
  const result = await analyzeStudioVisualEvidence(input, { analyzer: async received => {
    calls += 1; assert.equal(received.contactSheet, input.contactSheet);
    return [
      { shotId: 'shot-1', subjectType: 'product', subjectBox: { x: .2, y: .3, width: .5, height: .4 },
        subjectAnchor: { x: .45, y: .5 }, safeZones: [{ x: .02, y: .05, width: .3, height: .2, clarity: .9 }], captionBoxes: [], confidence: .91 },
      { shotId: 'invented-shot', subjectType: 'person', confidence: 1 },
    ];
  } });
  assert.equal(calls, 1);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.shotId, 'shot-1');
  assert.deepEqual(result[0]?.subjectBox, { x: .2, y: .3, width: .5, height: .4 });
});

test('accepts Gemini object envelopes and fenced JSON in addition to a bare array', async () => {
  const shot = { shotId: 'shot-1', subjectType: 'machine', confidence: .91 };
  assert.deepEqual(extractStudioVisualEvidenceJson(JSON.stringify([shot])), [shot]);
  assert.deepEqual(extractStudioVisualEvidenceJson(`\`\`\`json\n${JSON.stringify({ shots: [shot] })}\n\`\`\``), [shot]);
  assert.deepEqual(extractStudioVisualEvidenceJson(JSON.stringify({ visualEvidence: [shot] })), [shot]);
  assert.deepEqual(extractStudioVisualEvidenceJson(JSON.stringify({ data: [shot] })), []);
  const result = await analyzeStudioVisualEvidence(input, { analyzer: async () => ({ shots: [shot] }) });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.subjectType, 'machine');
});

test('localizes a broad machine box around a model focal point', async () => {
  const [result] = await analyzeStudioVisualEvidence(input, { analyzer: async () => ({ shots: [{
    shotId: 'shot-1', subjectType: 'machine', subjectBox: { x: .05, y: .1, width: .9, height: .75 },
    focalPoint: { x: .72, y: .38 }, confidence: .92,
  }] }) });
  assert.deepEqual(result?.subjectAnchor, { x: .72, y: .38 });
  assert.deepEqual(result?.subjectBox, { x: .62, y: .28, width: .2, height: .2 });
});

test('uses a local machine edge when a broad detection has no focal point', async () => {
  const [result] = await analyzeStudioVisualEvidence(input, { analyzer: async () => [{
    shotId: 'shot-1', subjectType: 'process', subjectBox: { x: .1, y: .1, width: .7, height: .7 }, confidence: .88,
  }] });
  assert.ok(result?.subjectBox && result.subjectBox.width <= .2 && result.subjectBox.height <= .2);
  assert.ok(result?.subjectAnchor && result.subjectAnchor.x > .6 && result.subjectAnchor.y < .5);
});

test('fails closed on analyzer errors and invalid or low-confidence coordinates', async () => {
  assert.deepEqual(await analyzeStudioVisualEvidence(input, { analyzer: async () => { throw new Error('offline'); } }), []);
  assert.deepEqual(await analyzeStudioVisualEvidence(input, { analyzer: async () => [
    { shotId: 'shot-1', subjectType: 'product', subjectBox: { x: -.2, y: 0, width: 2, height: 1 }, confidence: .4 },
  ] }), []);
});

test('missing contact sheet skips the analyzer', async () => {
  let called = false;
  const result = await analyzeStudioVisualEvidence({ ...input, contactSheet: Buffer.alloc(0) }, { analyzer: async () => { called = true; return []; } });
  assert.equal(called, false);
  assert.deepEqual(result, []);
});
