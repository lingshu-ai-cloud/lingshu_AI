import assert from 'node:assert/strict';
import test from 'node:test';
import { minimaxLanguageBoost, minimaxPronunciationDict, minimaxSpeechText, minimaxVoiceFor, minimaxVoiceModify, normalizeTtsLanguage, normalizeTtsStyle, QWEN_TTS_VOICE_MAP, SAY_LANGUAGE_VOICE_MAP } from './studioTtsStyle.js';

test('TTS style normalization bounds controls and keeps valid pronunciations', () => {
  const style = normalizeTtsStyle({ preset: 'unknown', emotion: 'x'.repeat(60), emotionIntensity: 200,
    speed: 4, targetDuration: 500, pauseStyle: 'dramatic', pronunciations: [
      { word: ' MOQ ', pronunciation: 'em oh cue' }, { word: '', pronunciation: 'empty' },
    ] });
  assert.equal(style.preset, 'authentic_review');
  assert.equal(style.emotion?.length, 40);
  assert.equal(style.emotionIntensity, 100);
  assert.equal(style.speed, 1.35);
  assert.equal(style.targetDuration, 180);
  assert.equal(style.pauseStyle, 'dramatic');
  assert.deepEqual(style.pronunciations, [{ word: 'MOQ', pronunciation: 'em oh cue' }]);
});

test('MiniMax speech styling is deterministic and does not duplicate pause tokens', () => {
  const style = normalizeTtsStyle({ pauseStyle: 'dramatic' });
  assert.equal(minimaxSpeechText('你好，世界。 再见！', style), '你好，<#0.16#>世界。<#0.34#> 再见！');
  assert.equal(minimaxSpeechText('你好，世界。 再见！', style), minimaxSpeechText('你好，世界。 再见！', style));
  assert.equal(minimaxSpeechText('你好<#0.50#>，世界', { pauseStyle: 'few' }), '你好，世界');
});

test('MiniMax voice shape and pronunciation dictionary stay bounded', () => {
  assert.deepEqual(minimaxVoiceModify(normalizeTtsStyle({ preset: 'professional_b2b', emotionIntensity: 100 })),
    { pitch: -1, timbre: -2, intensity: 14 });
  assert.deepEqual(minimaxPronunciationDict(normalizeTtsStyle({ pronunciations: [
    { word: 'MOQ', pronunciation: 'em oh cue' }, { word: 'bad', pronunciation: 'line\nbreak' },
  ] })), { tone: ['MOQ/em oh cue'] });
});

test('voice selection keeps language defaults and per-voice environment overrides', () => {
  assert.equal(normalizeTtsLanguage('en-US'), 'en');
  assert.equal(minimaxLanguageBoost('es'), 'Spanish');
  assert.equal(QWEN_TTS_VOICE_MAP.v2, 'Ethan');
  assert.deepEqual(SAY_LANGUAGE_VOICE_MAP.zh?.v1?.slice(0, 2), ['Tingting', 'Sandy (中文（中国大陆）)']);
  assert.equal(minimaxVoiceFor('v2', 'zh', {}), 'Chinese (Mandarin)_Reliable_Executive');
  assert.equal(minimaxVoiceFor('v2', 'zh', { MINIMAX_VOICE_ZH_V2: 'tenant-voice' }), 'tenant-voice');
});
