import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentCalendarTask } from './AgentWeeklyCalendar';
import VideoProgressTable, { buildVideoProgressRows, videoProgressPosition } from './VideoProgressTable';

function task(id: string, executionStep: string, status: AgentCalendarTask['status'], group = 'video-a'): AgentCalendarTask {
  return { id, deliverableGroup: group, executionStep, date: '2026-10-20', time: '09:00', agent: 'content', title: executionStep, output: '视频 A 成片', context: '敏感肌洁面产品视频', minutes: 30, status, platform: 'Facebook' };
}

test('groups production tasks into one row per video and maps the five user-facing stages', () => {
  const rows = buildVideoProgressRows([
    task('a', 'benchmark_collection', 'completed'),
    task('b', 'script', 'completed'),
    task('c', 'video_generation', 'active'),
    task('d', 'quality_check', 'planned'),
    task('e', 'user_approval', 'planned'),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.completedStages, 2);
  assert.deepEqual(rows[0]?.stages.map(stage => stage.state), ['completed', 'completed', 'active', 'planned', 'planned']);
  assert.deepEqual(videoProgressPosition(rows[0]!.stages), { percent: 40, currentIndex: 2, state: 'active' });
});

test('keeps blocking decisions inside their corresponding stage', () => {
  const rows = buildVideoProgressRows([task('a', 'video_generation', 'active'), task('b', 'rework', 'blocked')]);
  assert.equal(rows[0]?.stages[2]?.state, 'attention');
});

test('fans shared benchmark work into every affected video row', () => {
  const first = { ...task('a', 'script', 'planned'), deliverableGroup: JSON.stringify(['t', 'p', 'k', 1, 'pub-1']), productionTaskId: 'content-1' };
  const second = { ...task('b', 'script', 'planned'), deliverableGroup: JSON.stringify(['t', 'p', 'k', 1, 'pub-2']), productionTaskId: 'content-2' };
  const benchmark = { ...task('c', 'benchmark_collection', 'completed'), deliverableGroup: undefined, productionTaskId: undefined, affectedPublicationIds: ['pub-1', 'pub-2'] };
  const rows = buildVideoProgressRows([first, second, benchmark]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.stages[0]?.state === 'completed'));
});

test('does not present a duplicated package objective as every video title', () => {
  const rows = buildVideoProgressRows([task('a', 'script', 'planned', 'video-a'), task('b', 'script', 'planned', 'video-b')]);
  assert.deepEqual(rows.map(row => row.title), ['视频 01 · 主题待编导明确', '视频 02 · 主题待编导明确']);
});

test('renders a compact video table and excludes unrelated global tasks', () => {
  const unrelated = { ...task('x', 'weekly_review', 'planned'), deliverableGroup: undefined, productionTaskId: undefined };
  const html = renderToStaticMarkup(<VideoProgressTable tasks={[unrelated, task('a', 'benchmark_collection', 'completed'), task('b', 'script', 'active')]} onOpenTask={() => undefined}/>);
  assert.match(html, /视频生产进度表/);
  assert.match(html, /脚本与分镜/);
  assert.match(html, /style="width:20%"/);
  assert.doesNotMatch(html, />待执行</);
  assert.doesNotMatch(html, /weekly_review/);
});
