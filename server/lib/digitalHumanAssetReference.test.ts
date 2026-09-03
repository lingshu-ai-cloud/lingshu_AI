import assert from 'node:assert/strict';
import { canonicalDigitalHumanVoiceoverPath } from './digitalHumanAssetReference.js';

const tenant = 'tenant-a';
assert.equal(
  canonicalDigitalHumanVoiceoverPath('/tts/tenants/tenant-a/voice.wav?assetToken=expired', tenant),
  '/tts/tenants/tenant-a/voice.wav',
);
assert.equal(
  canonicalDigitalHumanVoiceoverPath('/api/overseas/studio/private-assets/tts/voice.wav?assetToken=expired', tenant),
  '/api/overseas/studio/private-assets/tts/voice.wav',
);
assert.equal(canonicalDigitalHumanVoiceoverPath('/tts/tenants/tenant-b/voice.wav', tenant), '', 'a job cannot retain another tenant audio path');
assert.equal(canonicalDigitalHumanVoiceoverPath('//evil.example/tts/tenants/tenant-a/voice.wav', tenant), '');
assert.equal(canonicalDigitalHumanVoiceoverPath('https://evil.example/tts/tenants/tenant-a/voice.wav', tenant), '');
assert.equal(canonicalDigitalHumanVoiceoverPath('/tts/tenants/tenant-a/%2fetc.wav', tenant), '');
assert.equal(canonicalDigitalHumanVoiceoverPath('/tts/legacy-shared.wav', tenant), '');

console.log('digital human asset reference tests passed');
