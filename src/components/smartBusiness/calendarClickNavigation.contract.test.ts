import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('src/components/SmartBusinessDashboard.tsx', 'utf8');
const workspace = fs.readFileSync('src/components/smartBusiness/DigitalEmployeeWorkspace.tsx', 'utf8');
const matrix = fs.readFileSync('src/components/smartBusiness/MatrixPublicationSchedule.tsx', 'utf8');
const connected = fs.readFileSync('src/components/smartBusiness/ConnectedAgentCalendar.tsx', 'utf8');

assert.match(dashboard, /function MatrixView\(\{[^}]*onNavigate[^}]*\}[\s\S]{0,900}<DigitalEmployeeWorkspace[^>]*onNavigate=\{onNavigate\}/,
  'Smart Business must forward product navigation into the three-column current-work surface');
assert.match(workspace, /<DigitalEmployeeHomeWork data=\{data\} onNavigate=\{onNavigate\} publishingCalendar=\{publishingCalendar\}/,
  'the business overview must provide the weekly calendar alongside the current-work projection');
assert.doesNotMatch(workspace, /<RestoredAgentWorkCalendar|<ConnectedAgentCalendar/,
  'the former Agent work calendar must not remain duplicated in the business overview');
assert.match(matrix, /<AgentWeeklyCalendar[^>]*onOpenProduction=\{onOpenContent\?task=>onOpenContent\(task\.id,task\.productionTaskId\)/,
  'the matrix Agent board must keep clicks enabled for real tasks, not only demo tasks');
assert.doesNotMatch(matrix, /onOpenProduction=\{calendarDemo&&onOpenContent/,
  'real calendar cards must never be disabled by the demo flag');
assert.match(connected, /agentTaskDemo:true,socialContentTaskId:card\.productionTaskId/,
  'a real standalone calendar card must enter the task-specific demo workbench');

console.log('calendar click navigation contract tests passed');
