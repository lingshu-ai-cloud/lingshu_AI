import assert from 'node:assert/strict';
import test from 'node:test';
import { socialImageGenerationPresentation } from './socialImageGenerationPresentation.js';

test('a saved image with a blocked quality review never appears to be generating', () => {
  const view = socialImageGenerationPresentation({ busy: false, hasImage: true, hasPendingRepair: false, unresolvedJob: false });
  assert.equal(view.title, '首版已生成');
  assert.equal(view.action, 'review');
  assert.equal(view.button, '返回审阅图片与配文');
});

test('a saved repair waits for explicit paid submission and an unresolved job cannot be retried', () => {
  const repair = socialImageGenerationPresentation({ busy: false, hasImage: true, hasPendingRepair: true, unresolvedJob: false });
  assert.equal(repair.action, 'generate');
  assert.equal(repair.button, '确认生成修改版');
  const unresolved = socialImageGenerationPresentation({ busy: false, hasImage: true, hasPendingRepair: true, unresolvedJob: true });
  assert.equal(unresolved.action, 'none');
  assert.equal(unresolved.title, '生成回执待核对');
});
