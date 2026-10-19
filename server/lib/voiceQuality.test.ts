import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dashscopeCredentialConfigured, evaluateVoicePcm, optionalPaidAsrOutage, speechSafeStructuredIdentifiers, transcriptAccuracy, transcriptQualityAccuracy } from './voiceQuality.js';
import {StudioVoicePaidBoundaryError} from './studioVoicePaidOperation.js';

function tone(seconds: number, amplitude: number, sampleRate = 16_000): Buffer {
  const buffer = Buffer.alloc(Math.floor(seconds * sampleRate) * 2);
  for (let index = 0; index < buffer.length / 2; index += 1) {
    buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * index / sampleRate) * amplitude), index * 2);
  }
  return buffer;
}

test('voice quality accepts normalized speech-like PCM and rejects silence/clipping', () => {
  assert.equal(evaluateVoicePcm(tone(1, 7_000)).passed, true);
  assert.equal(evaluateVoicePcm(Buffer.alloc(32_000)).passed, false);
  assert.equal(evaluateVoicePcm(tone(1, 32_767)).passed, false);
});

test('ASR accuracy normalizes punctuation and measures substitutions', () => {
  assert.equal(transcriptAccuracy('你好，世界！', '你好世界', 'zh'), 1);
  assert.equal(transcriptAccuracy('Net content: 100ml.', 'Net content: 100 ml.', 'en'), 1);
  assert.ok(transcriptAccuracy('check the voltage', 'check voltage', 'en') < 1);
});

test('ASR quality accepts phonetic SKU output without weakening surrounding copy', () => {
  const expected = 'Next, check SKU. The confirmed record says GUIANFA-RS-001.';
  assert.deepEqual(
    transcriptQualityAccuracy(expected, 'Next check SKU. Confirmed record says Guyana R S zero zero one.', 'en'),
    { accuracy: 1, structuredIdentifierAdjusted: true },
  );
  const missingIdentifier = transcriptQualityAccuracy(expected, 'Next check SKU. The confirmed record says.', 'en');
  assert.ok(missingIdentifier.accuracy < .9);
  const changedClaim = transcriptQualityAccuracy(expected, 'Next check SKU. Buy it because this is the best product one.', 'en');
  assert.ok(changedClaim.accuracy < .9);
  const missingClaimWord = transcriptQualityAccuracy(expected, 'Next check SKU. Confirmed says Guyana R S zero zero one.', 'en');
  assert.ok(missingClaimWord.accuracy < .9);
  const wrongDigits = transcriptQualityAccuracy(expected, 'Next check skew. The confirm record says Guianfa R S negative one.', 'en');
  assert.ok(wrongDigits.accuracy < .9);
});

test('speech-safe SKU rendering preserves display copy and speaks leading zeroes', () => {
  assert.equal(
    speechSafeStructuredIdentifiers('The SKU is GUIANFA-RS-001.', 'en'),
    'The SKU is Guianfa, R S, zero zero one.',
  );
  assert.equal(speechSafeStructuredIdentifiers('编号 GUIANFA-RS-001', 'zh'), '编号 GUIANFA-RS-001');
});

test('identifier-only narration accepts omitted label only with alphabetic and exact digit evidence', () => {
  assert.equal(transcriptQualityAccuracy('SKU: GUIANFA-RS-001.', 'Gaianfa R S zero zero one.', 'en').accuracy, 1);
  assert.equal(transcriptQualityAccuracy('SKU: GUIANFA-RS-001.', 'SKU Gaianfa US001.', 'en').accuracy, 1);
  assert.ok(transcriptQualityAccuracy('SKU: GUIANFA-RS-001.', 'zero zero one.', 'en').accuracy < .9);
  assert.ok(transcriptQualityAccuracy('SKU: GUIANFA-RS-001.', 'Random brand 001.', 'en').accuracy < .9);
  assert.ok(transcriptQualityAccuracy('SKU: GUIANFA-RS-001.', 'Gaianfa R S negative one.', 'en').accuracy < .9);
});

test('ASR structured identifier handling does not ignore ordinary quantities', () => {
  assert.equal(
    transcriptQualityAccuracy('Do not miss Net content: 100ml.', 'Do not miss Net content: ten milliliters.', 'en').structuredIdentifierAdjusted,
    false,
  );
});

test('ASR readiness accepts the supported key-file configuration', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-quality-'));
  const keyFile = path.join(directory, 'dashscope.key');
  fs.writeFileSync(keyFile, 'configured-for-test\n', { mode: 0o600 });
  try {
    assert.equal(dashscopeCredentialConfigured({ DASHSCOPE_API_KEY_FILE: keyFile }), true);
    assert.equal(dashscopeCredentialConfigured({ DASHSCOPE_API_KEY_FILE: path.join(directory, 'missing') }), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('only an already-claimed ASR outage can use acoustic-only degradation', () => {
  assert.equal(optionalPaidAsrOutage(new StudioVoicePaidBoundaryError('Request was aborted.')), true);
  assert.equal(optionalPaidAsrOutage(new StudioVoicePaidBoundaryError('social_paid_permit_receipt_recovery_required')), true);
  assert.equal(optionalPaidAsrOutage(new StudioVoicePaidBoundaryError('social_paid_permit_request_binding_changed')), false);
  assert.equal(optionalPaidAsrOutage(new Error('Request was aborted.')), false);
});
