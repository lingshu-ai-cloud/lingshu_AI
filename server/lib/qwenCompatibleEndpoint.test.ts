import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyQwenCompatibleEndpoint,QWEN_COMPATIBLE_BASE_URL,qwenCompatibleBaseUrl} from './qwenCompatibleEndpoint.js';

test('Qwen compatible default is the enabled Qianwen MaaS endpoint and explicit override wins',()=>{
  assert.equal(qwenCompatibleBaseUrl({} as NodeJS.ProcessEnv),QWEN_COMPATIBLE_BASE_URL);
  assert.equal(qwenCompatibleBaseUrl({DASHSCOPE_BASE_URL:'https://proxy.example/v1'} as NodeJS.ProcessEnv),'https://proxy.example/v1');
});

test('endpoint classification separates MaaS catalog admission, legacy permissions, and non-compatible native APIs',()=>{
  assert.equal(classifyQwenCompatibleEndpoint('https://maas.qianwenaiapi.com/compatible-mode/v1'),'qianwen-maas');
  assert.equal(classifyQwenCompatibleEndpoint('https://dashscope.aliyuncs.com/compatible-mode/v1/'),'dashscope-legacy');
  assert.equal(classifyQwenCompatibleEndpoint('https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription'),'other');
  assert.equal(classifyQwenCompatibleEndpoint('https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis'),'other');
});
