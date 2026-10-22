import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitStudioNarrationSentences, splitVoiceoverLanguageLines,
  voiceoverLineNeedsLanguageRepair } from './studioVoiceoverLanguageRules.js';

test('target script families reject sentences from another writing system', () => {
  assert.equal(voiceoverLineNeedsLanguageRepair('发送 LX-Vision 工件样本。', 'zh'), false);
  assert.equal(voiceoverLineNeedsLanguageRepair('Send the sample and book a review.', 'zh'), true);
  assert.equal(voiceoverLineNeedsLanguageRepair('发送工件样本，预约方案诊断。', 'en'), true);
  assert.equal(voiceoverLineNeedsLanguageRepair('Review the sample with LX-Vision.', 'en'), false);
  assert.equal(voiceoverLineNeedsLanguageRepair('これは製品です。', 'ko'), true);
  assert.equal(voiceoverLineNeedsLanguageRepair('이것은 제품입니다.', 'ja'), true);
  assert.equal(voiceoverLineNeedsLanguageRepair('Book a review today.', 'ar'), true);
  assert.equal(voiceoverLineNeedsLanguageRepair('احجز مراجعة اليوم.', 'ar'), false);
  assert.equal(voiceoverLineNeedsLanguageRepair('  ', 'en'), false);
});

test('language repair segments preserve punctuation and remove blank lines', () => {
  assert.deepEqual(splitVoiceoverLanguageLines('First claim; book a review.\n发送样本；预约诊断。\n'),
    ['First claim;', 'book a review.', '发送样本；', '预约诊断。']);
});

test('narration sentence boundaries retain Spanish CTA and decimal measurement', () => {
  assert.deepEqual(splitStudioNarrationSentences('Observa la placa. ¡Mira las pistas!'),
    ['Observa la placa.', '¡Mira las pistas!']);
  assert.deepEqual(splitStudioNarrationSentences('Look at the 3.5 mm detail. What do you see?'),
    ['Look at the 3.5 mm detail.', 'What do you see?']);
});
