import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const source=readFileSync(new URL('./TrafficPage.tsx',import.meta.url),'utf8');
test('weekly publishing mounts the exact production workspace instead of a manual result queue',()=>{assert.match(source,/weeklyTargetState\.present \? weeklyTarget \? <WeeklyPublishingWorkspace[^\n]+target=\{weeklyTarget\}/);const publishing=readFileSync(new URL('./socialContent/WeeklyPublishingWorkspace.tsx',import.meta.url),'utf8');assert.match(publishing,/socialProgramApi\.approveExecutionTask/);assert.match(publishing,/socialProgramApi\.authorizeWeeklyPublishing/);assert.match(publishing,/SocialWeeklyG6ReviewPanel/);assert.doesNotMatch(publishing,/registerPublication|completeOnboarding/);});
test('actual smartAssets create branch mounts the original production view for a bound weekly target',()=>{
  assert.match(source,/const WeeklyContentProductionView = lazy\(\(\) => import\('\.\/socialContent\/WeeklyContentProductionView'\)\)/);
  assert.match(source,/weeklyTargetState\.target\?\.contentTaskId===socialContentTaskId\?weeklyTargetState\.target:null/);
  assert.match(source,/weeklyTargetState\.present \?[^\n]+weeklyTarget \? (?:<>)?<WeeklyContentProductionView[^\n]+target=\{weeklyTarget\}/);
  assert.match(source,/weeklyTarget \? (?:<>)?<WeeklyContentProductionView[^\n]+: <p role="alert">周任务生产目标与当前内容任务不一致[^\n]+: <AiCreateStudio/);
});
test('bound weekly production state refreshes after the App handoff and history Back',()=>{
  assert.match(source,/hasWeeklyContentNavigationTarget\(window\.history\.state\)/);
  assert.match(source,/readWeeklyContentNavigationTarget\(window\.history\.state\)/);
  for(const event of ['SOCIAL_CONTENT_NAVIGATION_EVENT',"'popstate'","'lingshu:navigate'"]){
    assert(source.includes(`window.addEventListener(${event},`));
    assert(source.includes(`window.removeEventListener(${event},`));
  }
  assert.match(source,/const navigated=\(\)=>queueMicrotask\(read\)/);
  assert.match(source,/\},\[socialContentTaskId,studioCreateRequest\]\)/);
});
