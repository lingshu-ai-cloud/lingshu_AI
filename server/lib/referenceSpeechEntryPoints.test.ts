import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = (file: string) => fs.readFileSync(new URL(file, import.meta.url), 'utf8');

test('every downloaded-video model success locks measured source speech; coarse ASR is no longer a production analysis entry', () => {
  const videos = source('../routes/videos.ts');
  const body = videos.slice(videos.indexOf('export async function analyzeDownloadedVideoWithFallback'), videos.indexOf('function shouldRetryGeminiWithNormalizedVideo'));
  assert.ok(body.includes('prepareReferenceNarration('));
  assert.equal(body.includes('transcribeAudioWithQwen('), false);
  assert.equal(body.includes('coarseAsrSentences('), false);
  assert.ok((body.match(/return \{ analysis: await finishSourceAnalysis\(/g) || []).length >= 3,
    'Qwen, Gemini and normalized Gemini must all apply the source-speech lock');
  assert.ok(body.includes('const locked = lockReferenceSpeechTimeline('));
  for (const entry of ['async function triggerVideoAnalysis', 'export async function analyzeSourceVideoJob', 'async function analyzeDownloadedMaterial', 'async function analyzeOpsVideo']) {
    const start = videos.indexOf(entry);
    assert.ok(start >= 0, `${entry} must remain in the shared source-analysis chain`);
    const end = videos.indexOf('\nasync function ', start + entry.length);
    const wrapper = videos.slice(start, end < 0 ? undefined : end);
    if (entry.includes('analyzeSourceVideoJob')) {
      assert.ok(videos.includes('adapters.analyze || analyzeDownloadedVideoWithFallback'));
    } else assert.ok(wrapper.includes('analyzeDownloadedVideoWithFallback('));
  }
});

test('reference narration measures words directly and does not gate local credentials on object storage', () => {
  const reference = source('./referenceNarration.ts');
  const body = reference.slice(reference.indexOf('export async function prepareReferenceNarration'));
  assert.ok(body.includes('transcribeWordAudioWithQwen('));
  assert.equal(body.includes('transcribeAudioWithQwen('), false);
  assert.equal(body.includes('alignQwenFile('), false);
  assert.equal(body.includes('duration *'), false, 'equal-duration sentence estimates must not re-enter production');
  assert.equal(body.includes('objectStorageEnabled('), false);
  assert.equal(body.includes('process.env.DASHSCOPE_API_KEY'), false, 'the filetrans service supports the local key file');
  assert.ok(body.includes('saved?.version === 2'), 'legacy proofread caches must not become measured-word caches');
});

test('regeneration writes all shot and beat speech fields through the same production lock', () => {
  const regeneration = source('../../scripts/regenerate-current-narration.ts');
  assert.ok(regeneration.includes('lockReferenceSpeechTimeline('));
  assert.ok(regeneration.includes('prepareReferenceNarration(media, duration, { tenantId })'));
  assert.ok(regeneration.includes('Number(match[3])'), 'use source duration decimals, not rounded record metadata');
  assert.equal(regeneration.includes('35.58'), false, 'no historical invented default duration');
  assert.ok(regeneration.includes('reference-after.json'));
  assert.ok(regeneration.includes('shot.speechAlignment'), 'verify the persisted per-shot evidence');
});

test('regeneration has no customer defaults and gates paid ASR behind explicit authorization', () => {
  const regeneration = source('../../scripts/regenerate-current-narration.ts');
  assert.ok(regeneration.includes("requiredArgument('--id')"));
  assert.ok(regeneration.includes("requiredArgument('--tenant-id')"));
  assert.ok(regeneration.includes("process.argv.includes('--execute-paid')"));
  assert.ok(regeneration.includes("argument('--authorization-evidence')"));
  assert.ok(regeneration.includes('os.tmpdir()'), 'default evidence output must stay outside the repository');
  assert.equal(regeneration.includes('local_tenant_customer_'), false);
  assert.equal(regeneration.includes("'data/acceptance/"), false);
  const preflightGate = regeneration.indexOf('if (!executePaid)');
  const authorizationGate = regeneration.indexOf('if (!authorizationEvidence)');
  const paidCall = regeneration.indexOf('await prepareReferenceNarration(media, duration, { tenantId })');
  assert.ok(preflightGate >= 0 && preflightGate < authorizationGate && authorizationGate < paidCall,
    'preflight and explicit authorization must both precede the paid provider call');
});
