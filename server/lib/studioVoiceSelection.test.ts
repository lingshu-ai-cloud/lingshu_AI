import assert from 'node:assert/strict';
import { MINIMAX_ENGLISH_PRESETS, ttsPostProcessingSpeed } from './studioVoiceSelection.js';
assert.equal(MINIMAX_ENGLISH_PRESETS.v1.gender,'female');
assert.equal(MINIMAX_ENGLISH_PRESETS.v1.voiceId,'English_Graceful_Lady');
assert.equal(MINIMAX_ENGLISH_PRESETS.v2.gender,'male');
assert.equal(MINIMAX_ENGLISH_PRESETS.v3.gender,'female');
assert.equal(ttsPostProcessingSpeed('minimax',1.15),1,'Provider applies speed once; timestamps need no second scaling.');
assert.equal(ttsPostProcessingSpeed('qwen_tts',1.15),1.15);
console.log('female voice selection and single speed application regression passed');
