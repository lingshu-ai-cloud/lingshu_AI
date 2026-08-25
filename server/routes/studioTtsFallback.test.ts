import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { espeakVoiceForLanguage } from './studio.js';

assert.equal(espeakVoiceForLanguage('en'), 'en-us');
assert.equal(espeakVoiceForLanguage('ru'), 'ru');
assert.equal(espeakVoiceForLanguage('ar'), 'ar');
assert.equal(espeakVoiceForLanguage('zh-CN'), 'cmn');
assert.equal(espeakVoiceForLanguage('unsupported'), null);

const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');
assert.match(dockerfile, /apt-get install[^\n]*espeak-ng/, '生产镜像必须安装本地多语种 TTS 兜底');

const studioSource = readFileSync(new URL('./studio.ts', import.meta.url), 'utf8');
assert.match(studioSource, /generateEspeakTts\(spoken, language, style\)/, '云端 TTS 失败后必须尝试本地配音');

console.log('studio TTS fallback tests passed');
