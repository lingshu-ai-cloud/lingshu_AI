import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  readSocialContentNavigationTaskId,
  socialContentTaskRequestHeaders,
  readWeeklyContentNavigationTarget,hasWeeklyContentNavigationTarget,
} from './socialContentContext.js';

assert.equal(readSocialContentNavigationTaskId('smartAssets', {
  socialContentTaskId: 'social-task-1',
  socialContentPage: 'smartAssets',
}), 'social-task-1');
assert.equal(readSocialContentNavigationTaskId('enterprise', {
  productionDetail: {
    socialContentTaskId: 'social-task-2',
    socialContentPage: 'enterprise',
  },
}), 'social-task-2');
assert.equal(readSocialContentNavigationTaskId('traffic', {
  socialContentTaskId: 'social-task-1',
  socialContentPage: 'smartAssets',
}), null, 'a task handoff must not leak into another page');
assert.equal(readSocialContentNavigationTaskId('smartAssets', {
  socialContentTaskId: '../unsafe',
  socialContentPage: 'smartAssets',
}), null, 'task ids must stay inside the API identifier contract');

const originalWindow = globalThis.window;
try {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { search: '?page=smartAssets' },
      history: { state: { socialContentTaskId: 'social-task-3', socialContentPage: 'smartAssets' } },
    },
  });
  assert.deepEqual(socialContentTaskRequestHeaders(), {
    'X-Lingshu-Social-Task-Id': 'social-task-3',
    'X-Lingshu-Social-Page': 'smartAssets',
  });
  (window as unknown as { location: { search: string } }).location.search = '?page=traffic';
  assert.deepEqual(socialContentTaskRequestHeaders(), {}, 'a handoff for another page must not authorize requests');
} finally {
  if (originalWindow === undefined) delete (globalThis as { window?: Window }).window;
  else Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
}

const source = fs.readFileSync(new URL('./socialContentContext.ts', import.meta.url), 'utf8');
assert.match(source, /socialContentTaskId/);
assert.match(source, /socialContentPage/);
assert.match(source, /productionDetail/);
assert.doesNotMatch(source, /Bearer|Authorization|overseas_token/);
assert.doesNotMatch(socialContentTaskRequestHeaders.toString(), /localStorage|readActiveSocialContentTaskId/,
  'request authority must not fall back to a persisted previous task');

const authSource = fs.readFileSync(new URL('./auth.ts', import.meta.url), 'utf8');
assert.match(authSource, /socialContentTaskRequestHeaders\(\)/, 'authenticated professional-page requests must carry the exact task handoff');

console.log('social content client context contract tests passed');

const weekly={scope:{tenantId:'tenant',programId:'p',packageId:'w',packageVersion:2,executionTaskId:'e'},publicationTaskId:'pub',contentTaskId:'social-task-1',runId:'original-run',artifactRef:{type:'starter_social_content_artifact',id:'original',version:1},bindingKey:'binding',source:'completed_artifact',gaps:[]};
const handoff={socialContentTaskId:'social-task-1',socialContentPage:'smartAssets',weeklyContentTarget:weekly};
assert.equal(readWeeklyContentNavigationTarget(handoff)?.runId,'original-run');
assert.equal(hasWeeklyContentNavigationTarget(handoff),true);
assert.equal(hasWeeklyContentNavigationTarget({}),false);
for(const invalid of [null,{}, {...weekly,contentTaskId:'other'}, {...weekly,artifactRef:null}, {...weekly,scope:{...weekly.scope,packageVersion:0}}]){const state={...handoff,productionDetail:{socialContentTaskId:'social-task-1',socialContentPage:'smartAssets',weeklyContentTarget:invalid}};assert.equal(hasWeeklyContentNavigationTarget(state),true,'malformed history remains an explicit target and must block current fallback');assert.equal(readWeeklyContentNavigationTarget(state),null,'malformed nested target cannot fall back to valid outer target');}
