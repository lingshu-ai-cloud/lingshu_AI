import assert from 'node:assert/strict';
import test from 'node:test';
import { getQwenAsrProviderBinding, getQwenProviderBinding, QWEN_EXACT_VL_DEFAULT_MODEL } from './qwen.js';

test('implicit exact vision binding uses the available plus model, never the missing flash model', () => {
  const binding = getQwenProviderBinding({
    DASHSCOPE_API_KEY: 'test-only-key',
    DASHSCOPE_BASE_URL: 'https://dashscope.example.test/compatible-mode/v1',
  } as NodeJS.ProcessEnv);

  assert.equal(QWEN_EXACT_VL_DEFAULT_MODEL, 'qwen3-vl-plus');
  assert.equal(binding.materialModel, 'qwen3-vl-plus');
});

test('an explicit exact vision model remains authoritative', () => {
  const binding = getQwenProviderBinding({
    DASHSCOPE_API_KEY: 'test-only-key',
    QWEN_EXACT_VL_MODEL: 'human-approved-model',
  } as NodeJS.ProcessEnv);

  assert.equal(binding.materialModel, 'human-approved-model');
});

test('text and vision migrate to Qianwen MaaS while ASR keeps its separate legacy contract',()=>{
  const env={DASHSCOPE_API_KEY:'test-only-key'} as NodeJS.ProcessEnv;
  assert.equal(getQwenProviderBinding(env).baseUrl,'https://maas.qianwenaiapi.com/compatible-mode/v1');
  assert.equal(getQwenAsrProviderBinding(env).baseUrl,'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal(getQwenAsrProviderBinding({...env,QWEN_ASR_BASE_URL:'https://voice-proxy.example/v1'}).baseUrl,'https://voice-proxy.example/v1');
});
