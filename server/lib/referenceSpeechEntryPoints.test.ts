import { readVideoApplicationSources, videoApplicationFunction } from '../../tests/fixtures/videoApplicationSources.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = (file: string) => fs.readFileSync(new URL(file, import.meta.url), 'utf8');

test('every downloaded-video model success locks measured source speech; coarse ASR is no longer a production analysis entry', () => {
  const videos = readVideoApplicationSources();
  const body = videoApplicationFunction(videos, 'analyzeDownloadedVideoWithFallback');
  const narration = videoApplicationFunction(videos, 'referenceNarrationForVideoAnalysis');
  assert.ok(body.includes('referenceNarrationForVideoAnalysis('));
  assert.ok(narration.includes('if (!exactQwenScope()) return prepare(filePath, duration, { tenantId })'));
  assert.ok(narration.includes('scoped_visual_revision_has_no_asr_authorization'));
  assert.equal(body.includes('transcribeAudioWithQwen('), false);
  assert.equal(body.includes('coarseAsrSentences('), false);
  assert.ok((body.match(/return \{ analysis: await finishSourceAnalysis\(/g) || []).length >= 3,
    'Qwen, Gemini and normalized Gemini must all apply the source-speech lock');
  assert.ok(body.includes('const locked = lockReferenceSpeechTimeline('));
  for (const name of ['triggerVideoAnalysis', 'analyzeSourceVideoJobInner', 'analyzeDownloadedMaterial', 'analyzeOpsVideo']) {
    const entry = videoApplicationFunction(videos, name);
    if (name === 'analyzeSourceVideoJobInner') {
      assert.ok(entry.includes('adapters.analyze || analyzeDownloadedVideoWithFallback'));
    } else assert.ok(entry.includes('analyzeDownloadedVideoWithFallback('));
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
