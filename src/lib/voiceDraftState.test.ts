import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mergeGeneratedVoiceDraft,
  orderedVoiceLanguages,
  primaryVoiceDraft,
  requestedVoiceDraftsReady,
  validProjectVoiceoverLanguages,
  voiceDraftLanguagesNeedingTranslation,
} from './voiceDraftState.js';

const studio = readFileSync(new URL('../components/AiCreateStudio.tsx', import.meta.url), 'utf8');

const drafts = {
  zh: '[0-3s] 原文',
  en: '[0-3s] Manually reviewed copy',
  es: '',
};

assert.deepEqual(
  voiceDraftLanguagesNeedingTranslation(['zh', 'en', 'es'], 'zh', drafts, [], []),
  ['es'],
  'a complete manual language must not be overwritten by a batch retry',
);
assert.deepEqual(
  voiceDraftLanguagesNeedingTranslation(['zh', 'en', 'es'], 'zh', drafts, ['en'], ['es']),
  ['en', 'es'],
  'only missing, failed or source-stale languages should be retried',
);

const requestSnapshot = { en: '' };
assert.deepEqual(
  mergeGeneratedVoiceDraft({ en: 'Operator edit' }, requestSnapshot, 'en', 'Late model result'),
  { en: 'Operator edit' },
  'a late model response must not replace a newer manual edit',
);
assert.deepEqual(
  mergeGeneratedVoiceDraft({ en: '' }, requestSnapshot, 'en', 'Translated result'),
  { en: 'Translated result' },
);

assert.equal(requestedVoiceDraftsReady(['zh', 'en', 'es'], { zh: 'a', en: 'b', es: 'c' }, [], []), true);
assert.equal(requestedVoiceDraftsReady(['zh', 'en', 'es'], { zh: 'a', en: 'b', es: 'c' }, ['en'], []), false);
assert.equal(requestedVoiceDraftsReady(['zh', 'en', 'es'], { zh: 'a', en: 'b' }, [], []), false);

assert.deepEqual(
  orderedVoiceLanguages('zh', ['en', 'zh', 'es'], 'es'),
  ['zh', 'en', 'es'],
  'switching the active/output language must not move it ahead of the script source',
);
assert.equal(
  primaryVoiceDraft('zh', '中文原稿', { zh: '审核后的中文原稿', en: 'Active English tab' }),
  '审核后的中文原稿',
  'batch TTS must use the script-source draft instead of the active language tab',
);

const projectAudios = {
  zh: { url: '/assets/zh.wav' },
  en: { url: '/assets/en.wav' },
  es: { url: '/assets/es.wav' },
  fr: { url: '/assets/fr.wav' },
};
assert.deepEqual(
  validProjectVoiceoverLanguages(['zh', 'en', 'es'], projectAudios, ['es']),
  ['zh', 'en'],
  'the project-wide success count must include every selected non-stale audio, not only the requested language',
);
assert.deepEqual(
  validProjectVoiceoverLanguages(['zh', 'en', 'es'], projectAudios, [], ['en'], ['en']),
  ['zh', 'en', 'es'],
  'a successfully regenerated language must become valid again in the same request',
);
assert.deepEqual(
  validProjectVoiceoverLanguages(['zh', 'en', 'es'], projectAudios, [], ['en'], []),
  ['zh', 'es'],
  'a failed single-language regeneration must not count its invalidated old audio as valid',
);
assert.match(
  studio,
  /validProjectVoiceoverLanguages\([\s\S]{0,400}existingRequestedAudioCodes,[\s\S]{0,120}\[\.\.\.generatedCodes\]/,
  'single-language TTS success must derive its notice from project-wide effective audio state',
);
assert.match(
  studio,
  /ttsFailuresByLang\[activeVoiceLang\][\s\S]{0,500}genTts\(activeVoiceLang\)[\s\S]{0,300}只重试当前语言/,
  'a failed language must retain its visible per-language retry action',
);

console.log('voice draft state tests passed');
