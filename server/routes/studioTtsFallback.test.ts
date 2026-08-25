import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { espeakVoiceForLanguage, resolveDashscopeTtsEndpoint } from './studio.js';

assert.equal(espeakVoiceForLanguage('en'), 'en-us');
assert.equal(espeakVoiceForLanguage('ru'), 'ru');
assert.equal(espeakVoiceForLanguage('ar'), 'ar');
assert.equal(espeakVoiceForLanguage('zh-CN'), 'cmn');
assert.equal(espeakVoiceForLanguage('unsupported'), null);

assert.equal(
  resolveDashscopeTtsEndpoint({ DASHSCOPE_BASE_URL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' }),
  'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
  '新加坡 Key 的 TTS 请求必须跟随国际地域端点',
);
assert.equal(
  resolveDashscopeTtsEndpoint({ DASHSCOPE_BASE_URL: 'https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1' }),
  'https://workspace.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
  '业务空间专属域名必须被 TTS 原生接口沿用',
);
assert.equal(
  resolveDashscopeTtsEndpoint({ DASHSCOPE_TTS_ENDPOINT: 'https://custom.example/api/tts' }),
  'https://custom.example/api/tts',
  '显式 TTS 端点优先级最高',
);

const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');
assert.match(dockerfile, /apt-get install[^\n]*espeak-ng/, '生产镜像必须安装本地多语种 TTS 兜底');

const studioSource = readFileSync(new URL('./studio.ts', import.meta.url), 'utf8');
assert.match(studioSource, /generateEspeakTts\(spoken, language, style\)/, '云端 TTS 失败后必须尝试本地配音');
assert.match(studioSource, /qwenTtsCooldownUntil/, '欠费后必须熔断 Qwen TTS，避免同批语种重复请求失败接口');

console.log('studio TTS fallback tests passed');
