import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../DigitalEmployeePage.tsx', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('../ConfiguredDigitalEmployeeWorkspace.tsx', import.meta.url), 'utf8');
const panel = fs.readFileSync(new URL('./WeeklyGoalPanel.tsx', import.meta.url), 'utf8');

assert.match(page, /if \(data\?\.config\) return <ConfiguredDigitalEmployeeWorkspace/,
  'configured tenants must mount the workspace that owns the weekly goal editor');
assert.match(workspace, /import \{ GoalPanel, type GoalDraft, type BusinessLine, type ContentPlatform \} from '\.\/smartBusiness\/WeeklyGoalPanel'/,
  'the workspace must use the extracted weekly goal boundary');
assert.match(workspace, /<GoalPanel[\s\S]*?onSave=\{goalInput => void createWeeklyOutline\(goalInput\)\}/,
  'goal confirmation must still invoke the page-owned submission path');
assert.match(panel, /weeklyPublishingPlatforms\(config\.publishingTargets, config\.socialCadence\)/,
  'configured account platforms must take precedence over profile defaults');
assert.match(panel, /videoSchedulingErrors\(plan\)[\s\S]*!form\.contentPlatforms\.includes\(plan\.platform\)/,
  'invalid video plans and unselected platforms must block confirmation');
assert.match(panel, /onSave\(\{ \.\.\.form, videoPlans: scheduleWeeklyVideos\(form\.videoPlans \|\| \[\], form\.startsAt, form\.endsAt\) \}\)/,
  'confirmed plans must use the shared weekly scheduling rule');
assert.match(panel, /<WeeklyPlanConfirmationCard[\s\S]*?hasValidationErrors=\{hasErrors\}/,
  'the default proposal must surface validation before opening the editor');
assert.doesNotMatch(panel, /digitalEmployeeApi|productionApi|fetch\(/,
  'goal editing must not create a second service submission path');

console.log('weekly goal panel boundary passed');
