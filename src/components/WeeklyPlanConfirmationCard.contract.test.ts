import assert from 'node:assert/strict';
import fs from 'node:fs';

const cardSource = fs.readFileSync('src/components/WeeklyPlanConfirmationCard.tsx', 'utf8');
const pageSource = fs.readFileSync('src/components/DigitalEmployeePage.tsx', 'utf8');
const workspaceSource = fs.readFileSync('src/components/ConfiguredDigitalEmployeeWorkspace.tsx', 'utf8');
const goalPanelSource = fs.readFileSync('src/components/smartBusiness/WeeklyGoalPanel.tsx', 'utf8');

assert.match(cardSource, /预算二次确认/, 'the extracted card must own the second confirmation only');
assert.match(cardSource, /视频制作/, 'the card must show the production budget range');
assert.match(cardSource, /投流计划/, 'the card must keep the confirmed promotion budget visible');
assert.match(cardSource, /确认预算并开始生成/, 'the second confirmation must state that paid generation starts');
assert.match(cardSource, /onConfirm/, 'the card must delegate confirmation to its parent');
assert.doesNotMatch(cardSource, /digitalEmployeeApi|approveGoal|fetch\(/, 'the presentation component must not create a second execution path');

assert.match(goalPanelSource, /确认执行方案/, 'the first step must be the editable process plan');
assert.match(goalPanelSource, /视频条数与发布分配/, 'platform allocation must be editable without opening a detailed production form');
assert.match(goalPanelSource, /投流计划/, 'the first step must choose promoted videos and per-video spend');
assert.match(goalPanelSource, /<WeeklyPlanConfirmationCard[\s\S]{0,1200}onConfirm=\{confirmBudget\}/, 'the budget confirmation remains authoritative in the goal panel');
assert.doesNotMatch(goalPanelSource, /VideoPlanEditor|系统生成的目标设置|本周最想解决什么/, 'production preparation and advanced goal fields must not clutter the plan confirmation');
assert.match(workspaceSource, /<GoalPanel[\s\S]{0,1000}onSave=/, 'the goal panel remains mounted in the configured workspace');
assert.match(pageSource, /digitalEmployeeApi\.createGoal\(goalInput\)[\s\S]{0,500}launchWeeklyPlan\(created\)/, 'the second confirmation must persist once and then use the canonical launch path');

console.log('weekly plan confirmation card contract tests passed');
