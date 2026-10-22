import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const dashboard = readFileSync(new URL('../SmartBusinessDashboard.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../DigitalEmployeePage.tsx', import.meta.url), 'utf8');
const studio = readFileSync(new URL('../AiCreateStudio.tsx', import.meta.url), 'utf8');
const entry = readFileSync(new URL('./WeeklyProductionStudioEntry.tsx', import.meta.url), 'utf8');
const projectsOverlay = readFileSync(new URL('../studio/StudioProjectsOverlay.tsx', import.meta.url), 'utf8');

test('every Smart Business production entry preserves its exact project id', () => {
  assert.match(dashboard, /<WeeklyContentProgressPanel[^>]*contentId=\{item\.contentId\}[^>]*onOpenWorkbench=\{closeDetails\}/);
  assert.match(entry, /weeklyProductionStudioLinks\(snapshot\.data, contentId, snapshot\.projects\)/);
  assert.match(entry, /dispatchDigitalEmployeeDeepLink\(choice\.link\)/);
  assert.match(dashboard, /onOpenProductionProgress\(item\.taskId,item\.id,item\.projectIds\[0\]\)/);
  assert.match(dashboard, /onOpenContent\?\.\(item\.taskId\|\|undefined,item\.socialContentTaskId\|\|undefined,item\.projectIds\[0\]\)/);
  assert.match(page, /data\.tasks\.find\(item => item\.run_id === data\.run\?\.id && item\.task_key === "content_production"\)/);
  assert.match(page, /workflowRunId: contentProductionTask\?\.run_id \|\| data\.run\?\.id \|\| ""/);
  assert.match(page, /workflowTaskId: contentProductionTask\?\.id \|\| taskId \|\| ""/);
  assert.match(page, /businessRef: \{ taskKey: "content_production", entityId: projectId \}/);
});

test('opening an exact project replaces any notice left by the previous project', () => {
  assert.match(studio, /studioApi\.getProject\(workflowContext\.entityId,[\s\S]{0,160}runId: workflowContext\.runId,[\s\S]{0,100}taskId: workflowContext\.taskId/);
  assert.match(studio, /loadProject\(project\);\s*setShowProjects\(false\);/, 'exact task project must load and close the picker');
  assert.match(studio, /无法打开当前任务的内容项目：\$\{reason\}/);
  assert.match(studio, /emptyMessage=\{workflowContext\?\.entityId && modeNotice\.startsWith\('无法打开当前任务的内容项目：'\) \? modeNotice : undefined\}/);
  assert.match(projectsOverlay, /emptyMessage \|\| \(workflowContext \? '当前任务尚未创建内容项目'/);
});
