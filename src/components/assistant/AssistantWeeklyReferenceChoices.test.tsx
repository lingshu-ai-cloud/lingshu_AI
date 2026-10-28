import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AssistantWeeklyReferenceChoices } from './AssistantWeeklyPlanExperience.js';
import type { AssistantWeeklyPlanExperience } from './useAssistantWeeklyPlanExperience.js';

test('missing weekly references appear as a conversation choice, not an established task', () => {
  const html = renderToStaticMarkup(<AssistantWeeklyReferenceChoices experience={{
    referenceGap: { requiredCount: 5, missingCount: 3 }, referenceMessage: '', busy: false,
    openReferenceLibrary: () => undefined, collectReferencesNow: async () => undefined,
    retryReferenceCheck: async () => undefined,
  } as unknown as AssistantWeeklyPlanExperience}/>);
  assert.match(html, /还缺 3 条爆款视频/);
  assert.match(html, /周任务尚未确立/);
  assert.match(html, /手动录入爆款视频/);
  assert.match(html, /立即采集一批/);
  assert.match(html, /重新核验周计划/);
});
