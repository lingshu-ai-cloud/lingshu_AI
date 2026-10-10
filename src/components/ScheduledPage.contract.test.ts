import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseScheduledWorkflowHandoff } from './ScheduledPage.js';

const now = Date.parse('2026-09-04T08:00:00.000Z');
const validHandoff = JSON.stringify({
  page: 'scheduled',
  runId: 'run-collection-1',
  taskId: 'task-collection-1',
  issuedAt: now,
  businessRef: { taskKey: 'scheduled_source_collection' },
});

assert.deepEqual(parseScheduledWorkflowHandoff(validHandoff, now + 1000), {
  runId: 'run-collection-1',
  taskId: 'task-collection-1',
  taskKey: 'scheduled_source_collection',
}, 'a fresh source-collection handoff must preserve its exact workflow attribution');
assert.equal(
  parseScheduledWorkflowHandoff(validHandoff, now + 15 * 60 * 1000 + 1),
  null,
  'a source-collection handoff must expire after 15 minutes',
);
assert.equal(
  parseScheduledWorkflowHandoff(JSON.stringify({
    page: 'scheduled', runId: 'run-1', taskId: 'task-1', issuedAt: now,
    businessRef: { taskKey: 'content_production' },
  }), now),
  null,
  'a scheduled page link for another workflow task must not relabel the collection workspace',
);
assert.equal(
  parseScheduledWorkflowHandoff(JSON.stringify({
    page: 'smartAssets', runId: 'run-1', taskId: 'task-1', issuedAt: now,
    businessRef: { taskKey: 'scheduled_source_collection' },
  }), now),
  null,
  'a handoff for another page must remain isolated',
);
assert.equal(
  parseScheduledWorkflowHandoff(JSON.stringify({
    page: 'scheduled', runId: 'run-1', issuedAt: now,
    businessRef: { taskKey: 'scheduled_source_collection' },
  }), now),
  null,
  'partial workflow attribution must never bind',
);
assert.deepEqual(
  parseScheduledWorkflowHandoff(JSON.stringify({
    page: 'scheduled', runId: '', taskId: '', issuedAt: now,
    businessRef: { taskKey: 'scheduled_source_collection', preview: true },
  }), now),
  { runId: '', taskId: '', taskKey: 'scheduled_source_collection', preview: true },
  'a draft plan preview must open the correct scheduler group without pretending that a run exists',
);

const source = readFileSync(new URL('./ScheduledPage.tsx', import.meta.url), 'utf8');
assert.match(source, /SCHEDULED_WORKFLOW_HANDOFF_TTL\s*=\s*15\s*\*\s*60\s*\*\s*1000/);
assert.match(source, /sessionStorage\.removeItem\('digitalEmployee\.businessDeepLink'\)/, 'the persisted handoff must be consumed once');
assert.match(source, /setActiveGroup\('social'\)[\s\S]{0,120}setSocialTaskTab\('crawler'\)/, 'the handoff must land on the social crawler workspace');
assert.match(source, /addEventListener\('lingshu:navigate'/, 'an already-mounted scheduler must also accept a workflow handoff');
assert.match(source, /const CRAWLER_LIMIT_MAX\s*=\s*50;/, 'the UI crawler limit must match the server limit');
assert.doesNotMatch(source, /最多爬取\s*10\s*条/, 'the obsolete 10-item limit must not remain visible');
assert.match(
  source,
  /const tasksController = tasksRequestRef\.current;\s*tasksRequestRef\.current = null;\s*tasksController\?\.abort\(\);/,
  'StrictMode cleanup must release the task request lock before aborting the old request',
);
assert.match(
  source,
  /const videoStatsController = videoStatsRequestRef\.current;\s*videoStatsRequestRef\.current = null;\s*videoStatsController\?\.abort\(\);/,
  'StrictMode cleanup must release the stats request lock before aborting the old request',
);
assert.match(
  source,
  /if \(tasksRequestRef\.current === controller\) \{\s*tasksRequestRef\.current = null;\s*if \(showLoading\) setLoading\(false\);/,
  'an aborted stale request must not finish the replacement request loading state',
);
assert.match(source, /error instanceof Error && error\.name === 'AbortError'\) return;/, 'intentional StrictMode aborts must not be presented as production failures');
assert.match(source, /crawlTasks\.map\(task => `\$\{task\.name\} · \$\{task\.cronLabel\}`\)/, 'the social summary must use each persisted task schedule instead of a hard-coded preset');
assert.match(source, /action: 'pause' \| 'cancel' \| 'resume' \| 'reanalyze'/, 'video analysis controls must support pause, cancel, resume and retry');
assert.match(source, /analysis-\$\{action\}/, 'pause, cancel and resume must use the durable task-control API');
assert.match(source, /item\.status === 'analyzing'[\s\S]{0,1400}updateVideoAnalysis\(item, 'cancel'\)/, 'a running analysis must be cancellable');
assert.match(source, /item\.status === 'paused'[\s\S]{0,1400}updateVideoAnalysis\(item, 'resume'\)/, 'a paused analysis must be resumable');

console.log('scheduled workspace contract tests passed');
