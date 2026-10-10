import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dashscopeCredentialConfigured, evaluateVoicePcm, transcriptAccuracy } from './voiceQuality.js';

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
  assert.ok(transcriptAccuracy('check the voltage', 'check voltage', 'en') < 1);
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
