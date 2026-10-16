import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { assistantWeeklyNavigationHref, readAssistantWeeklyNavigation } from './assistantWeeklyNavigation';
test('weekly production deep link preserves exact package version and selected original content', () => {
  const scope = { programId: 'program', packageId: 'week', packageVersion: 2, publicationTaskId: 'publication', taskId: 'execution', repairCaseId: 'case' };
  assert.deepEqual(readAssistantWeeklyNavigation(assistantWeeklyNavigationHref(scope).slice(1)), scope);
  assert.equal(readAssistantWeeklyNavigation('?page=digitalEmployees'), null);
  assert.equal(readAssistantWeeklyNavigation('?page=digitalEmployees&weeklyView=production&weeklyProgramId=p&weeklyPackageId=w&weeklyPackageVersion=0'), null);
  assert.equal(readAssistantWeeklyNavigation('?page=smartAssets&weeklyView=production&weeklyProgramId=p&weeklyPackageId=w&weeklyPackageVersion=1'), null);
});
test('production view reuses canonical workbench, reads only and rejects changed version', () => {
  const source = fs.readFileSync(new URL('../components/assistant/AssistantWeeklyProductionView.tsx', import.meta.url), 'utf8');
  assert.match(source, /import WeeklyOperatingWorkbench/);
  assert.match(source, /item\.version !== target\.packageVersion/);
  assert.match(source, /selectedPublicationId=\{target\.publicationTaskId\}/);
  assert.doesNotMatch(source, /startCreativeRepair|activateOperatingPackage|preparePublish|assistantWeeklyActionsApi\.submit/);
  assert.match(source, /if \(activationLock\.current \|\| !pkg \|\| !activationOpen\) return/);
  assert.match(source, /useEffect\(\(\) => \{ void refresh\(\);/);
});
