import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyReferenceCriticalShots, validateReferenceCriticalShots, ReferenceCriticalValidationError,
  REFERENCE_CRITICAL_EVIDENCE_VERSION, type ReferenceCriticalFrame } from './referenceCriticalShots.js';
import { lockReferenceSpeechTimeline } from './referenceSpeechAnalysis.js';
import type { VideoAiAnalysis } from '../types/index.js';

function fixture() {
  const analysis: VideoAiAnalysis = { theme: 'factory', hooks: [], sellingPoints: [], mood: '', structure: '',
    recommendedScriptType: 'storyboard', scriptDetails15s: [{ time: '0–2s', visual: '接近镜头', dialogue: 'old' },
      { time: '2–4s', visual: '产品展示', dialogue: 'old' }] };
  const measured = lockReferenceSpeechTimeline(analysis, { text: 'Hi Boss cream',
    provenance: 'measured_asr', timestampResolutionMs: 1, accuracyMs: null,
    words: [{ start: .4, end: .8, text: 'Hi' }, { start: .9, end: 1.2, text: 'Boss' },
      { start: 2.4, end: 2.8, text: 'cream' }], segments: [] });
  const frames: ReferenceCriticalFrame[] = [
    { shotId: 'shot-1', seconds: .2, base64: 'frame-one', mimeType: 'image/jpeg' },
    { shotId: 'shot-1', seconds: 1.5, base64: 'frame-two', mimeType: 'image/jpeg' },
    { shotId: 'shot-2', seconds: 2.2, base64: 'frame-three', mimeType: 'image/jpeg' },
    { shotId: 'shot-2', seconds: 3.5, base64: 'frame-four', mimeType: 'image/jpeg' },
  ];
  const row = { shotId: 'shot-1', classification: 'critical', primaryHook: true, uniqueVisualMechanism: true,
    explicitAudioVisualSync: true, confidence: .9, reason: '接近镜头在Hi上触发冲击开场',
    evidence: ['0.2和1.5秒帧中观察接近，Hi时间0.4到0.8，ASR时钟误差未验证'],
    actionEvents: [{ start: .2, end: 1.5, action: '接近镜头', evidenceFrameSeconds: [.2, 1.5] }],
    syncPoints: [{ wordIds: ['word-0001'], eventIndex: 0, syncTime: .6, reason: 'Hi词内接近动作触发冲击' }] };
  const second = { shotId: 'shot-2', classification: 'non_critical', primaryHook: false,
    uniqueVisualMechanism: false, explicitAudioVisualSync: false, confidence: .8,
    reason: '普通产品展示，台词仅同时出现而无独特动作卡点', evidence: ['2.2和3.5秒为普通产品展示'], actionEvents: [], syncPoints: [] };
  return { input: { analysis: measured, frames, videoId: 'video-real', sourceSha256: 'source-hash' }, output: { shots: [row, second] } };
}

test('Qwen multimodal decision retains actual frame and word evidence; product does no heuristic classification', async () => {
  const { input, output } = fixture();
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, 'https://test.qwen/v1/chat/completions');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'qwen3-vl-flash');
    assert.equal(body.temperature, 0);
    const content = body.messages[0].content;
    assert.equal(content.filter((item: any) => item.type === 'image_url').length, 4);
    assert.ok(content[0].text.includes('word-0001'));
    assert.ok(content[0].text.includes('source-hash'));
    assert.ok(content[0].text.includes('不能仅因同一镜头里出现口播'));
    assert.equal(content[2].image_url.url, 'data:image/jpeg;base64,frame-one');
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) }, finish_reason: 'stop' }],
      usage: { total_tokens: 1000 } }), { headers: { 'content-type': 'application/json' } });
  };
  const result = await classifyReferenceCriticalShots(input, { fetcher, apiKey: 'test-only', baseUrl: 'https://test.qwen/v1' });
  assert.equal(calls, 1);
  assert.deepEqual(result.scriptDetails15s?.map(shot => shot.criticalShot?.classification), ['critical', 'non_critical']);
  assert.equal(result.scriptDetails15s?.[0].criticalShot?.actionEvents[0].timingPrecision, 'sampled_frames');
  assert.ok(Math.abs(result.scriptDetails15s![0].criticalShot!.syncPoints[0].syncTime - .6) < 1e-9);
  assert.equal(result.scriptDetails15s?.[0].criticalShot?.syncPoints[0].timingPrecision, 'word_frame_interval_projection');
  assert.equal(result.scriptDetails15s?.[0].speechAlignment?.accuracyMs, null);
  assert.equal(result.criticalShotSummary?.usage?.total_tokens, 1000);
  assert.equal(result.criticalShotSummary?.provider, 'qwen');
  assert.equal(result.criticalShotSummary?.evidenceVersion, REFERENCE_CRITICAL_EVIDENCE_VERSION);
  assert.equal(result.criticalShotSummary?.providerResponse.raw, JSON.stringify(output));
});

test('simultaneous generic narration stays noncritical; unique visual mechanism alone does not satisfy formula', () => {
  const { input, output } = fixture();
  Object.assign(output.shots[0], { primaryHook: false, uniqueVisualMechanism: true, explicitAudioVisualSync: false,
    classification: 'non_critical', syncPoints: [], reason: '动作特别但未看到台词语义卡点' });
  const result = validateReferenceCriticalShots(input, output, 'qwen');
  assert.equal(result.details[0].criticalShot?.classification, 'non_critical');
  assert.equal(result.details[0].criticalShot?.explicitAudioVisualSync, false);
});

test('wrong formula, duplicate or missing shots are rejected rather than filled by Codex', () => {
  for (const mutate of [
    (output: ReturnType<typeof fixture>['output']) => { output.shots[0].classification = 'non_critical'; },
    (output: ReturnType<typeof fixture>['output']) => { output.shots[1].shotId = 'shot-1'; },
    (output: ReturnType<typeof fixture>['output']) => { output.shots.pop(); },
  ]) {
    const { input, output } = fixture(); mutate(output);
    assert.throws(() => validateReferenceCriticalShots(input, output, 'qwen'), /reference_critical_evidence_invalid/);
  }
});

test('fabricated frames and duplicated actual frames cannot support actions', () => {
  for (const mutate of [
    (output: ReturnType<typeof fixture>['output']) => { output.shots[0].actionEvents[0].evidenceFrameSeconds = [.2, .7]; },
    (output: ReturnType<typeof fixture>['output']) => { output.shots[0].actionEvents[0].evidenceFrameSeconds = [.2, .201]; },
    (output: ReturnType<typeof fixture>['output']) => { output.shots[0].actionEvents[0].evidenceFrameSeconds = [.2, 2.2]; },
  ]) {
    const { input, output } = fixture(); mutate(output);
    assert.throws(() => validateReferenceCriticalShots(input, output, 'qwen'), /reference_critical_evidence_invalid/);
  }
});

test('unknown words, another shots words, zero points, low confidence and no joint intersection cannot establish sync', () => {
  for (const kind of ['missing', 'other-shot', 'point', 'low-confidence', 'no-overlap', 'no-joint-overlap', 'no-reason', 'no-sync']) {
    const { input, output } = fixture();
    if (kind === 'missing') output.shots[0].syncPoints[0].wordIds = ['invented-word'];
    if (kind === 'other-shot') output.shots[0].syncPoints[0].wordIds = ['word-0003'];
    if (kind === 'point') input.analysis.scriptDetails15s![0].speechAlignment!.words[0].timingPrecision = 'point';
    if (kind === 'low-confidence') input.analysis.scriptDetails15s![0].speechAlignment!.words[0].syncEligible = false;
    if (kind === 'no-overlap') Object.assign(input.analysis.scriptDetails15s![0].speechAlignment!.words[0],
      { start: 1.6, end: 1.8, overlapStart: 1.6, overlapEnd: 1.8 });
    if (kind === 'no-joint-overlap') output.shots[0].syncPoints[0].wordIds = ['word-0001', 'word-0002'];
    if (kind === 'no-reason') output.shots[0].syncPoints[0].reason = '';
    if (kind === 'no-sync') output.shots[0].syncPoints = [];
    assert.throws(() => validateReferenceCriticalShots(input, output, 'qwen'), /reference_critical_evidence_invalid/, kind);
  }
});

test('server projects referenced factual clocks without replacing Qwen classification or action semantics', () => {
  const { input, output } = fixture();
  output.shots[0].actionEvents[0].start = -100;
  output.shots[0].actionEvents[0].end = 99;
  output.shots[0].syncPoints[0].syncTime = -123;
  const result = validateReferenceCriticalShots(input, output, 'qwen');
  const classification = result.details[0].criticalShot!;
  assert.equal(classification.classification, output.shots[0].classification);
  assert.equal(classification.reason, output.shots[0].reason);
  assert.equal(classification.actionEvents[0].action, output.shots[0].actionEvents[0].action);
  assert.equal(classification.actionEvents[0].start, .2);
  assert.equal(classification.actionEvents[0].end, 1.5);
  assert.deepEqual(classification.syncPoints[0].timeRange, { start: .4, end: .8 });
  assert.ok(Math.abs(classification.syncPoints[0].syncTime - .6) < 1e-9);
});

test('validation failures retain actual provider JSON and usage without request credentials', async () => {
  const { input, output } = fixture();
  output.shots[0].classification = 'non_critical';
  const raw = `  ${JSON.stringify(output)}\n`;
  await assert.rejects(() => classifyReferenceCriticalShots(input, { apiKey: 'secret-test-only', fetcher: async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: raw } }], usage: { total_tokens: 321 } })) }),
  (error: unknown) => {
    assert.ok(error instanceof ReferenceCriticalValidationError);
    assert.ok(error.message.includes('formula_mismatch'));
    assert.equal(error.providerResponse.raw, raw);
    assert.equal(error.providerResponse.usage.total_tokens, 321);
    assert.ok(!JSON.stringify(error.providerResponse).includes('secret-test-only'));
    return true;
  });
});

test('insufficient confidence cannot become positive; evidenced unknown noncritical remains a model answer', () => {
  const { input, output } = fixture();
  output.shots[0].confidence = .3;
  assert.throws(() => validateReferenceCriticalShots(input, output, 'qwen'), /positive_with_insufficient_evidence/);
  Object.assign(output.shots[0], { classification: 'non_critical', primaryHook: false, uniqueVisualMechanism: false,
    explicitAudioVisualSync: false, actionEvents: [], syncPoints: [], reason: '画面不足，机制未知' });
  const result = validateReferenceCriticalShots(input, output, 'qwen');
  assert.equal(result.details[0].criticalShot?.confidence, .3);
  assert.equal(result.details[0].criticalShot?.reason, '画面不足，机制未知');
});

test('external failure, malformed JSON or token truncation never manufacture fallback labels', async () => {
  const { input } = fixture();
  for (const response of [new Response('{}', { status: 503 }),
    new Response(JSON.stringify({ choices: [{ message: { content: 'not-json' } }] })),
    new Response(JSON.stringify({ choices: [{ message: { content: '{}' }, finish_reason: 'length' }] }))]) {
    await assert.rejects(() => classifyReferenceCriticalShots(input, { apiKey: 'test-only',
      fetcher: async () => response }), /reference_critical_qwen/);
  }
});

test('exact singleton object envelope preserves labels; multiple envelopes remain rejected', () => {
  const { input, output } = fixture();
  assert.deepEqual(validateReferenceCriticalShots(input, [output], 'qwen'), validateReferenceCriticalShots(input, output, 'qwen'));
  for (const invalid of [[output, output], [[output]], []])
    assert.throws(() => validateReferenceCriticalShots(input, invalid, 'qwen'), /missing_or_duplicate_shots/);
});
