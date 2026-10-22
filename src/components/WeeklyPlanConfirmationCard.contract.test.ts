import assert from 'node:assert/strict';
import fs from 'node:fs';

const cardSource = fs.readFileSync('src/components/WeeklyPlanConfirmationCard.tsx', 'utf8');
const pageSource = fs.readFileSync('src/components/DigitalEmployeePage.tsx', 'utf8');
const goalPanelSource = fs.readFileSync('src/components/smartBusiness/WeeklyGoalPanel.tsx', 'utf8');

assert.match(cardSource, /本周任务确认/, 'the extracted card must retain the weekly confirmation purpose');
assert.match(cardSource, /本周实际视频任务/, 'the card must show the exact weekly output count');
assert.match(cardSource, /预计成本/, 'the card must keep estimated cost visible before confirmation');
assert.match(cardSource, /missingItems/, 'blocking validation must remain visible at the confirmation surface');
assert.match(cardSource, /onConfirm/, 'the card must delegate confirmation to its parent');
assert.doesNotMatch(cardSource, /digitalEmployeeApi|approveGoal|fetch\(/, 'the presentation component must not create a second execution path');

assert.match(goalPanelSource, /<WeeklyPlanConfirmationCard[\s\S]{0,1200}onConfirm=\{confirmPlanDraft\}/, 'the validated draft confirmation remains authoritative in the goal panel');
assert.match(pageSource, /<GoalPanel[\s\S]{0,1000}onSave=/, 'the goal panel remains mounted in the digital employee page');
assert.match(pageSource, /digitalEmployeeApi\.approveGoal\(goal\.id, data\.plan\.businessPackage\.revision\)/, 'runtime launch must still use the canonical version-bound API');

console.log('weekly plan confirmation card contract tests passed');
