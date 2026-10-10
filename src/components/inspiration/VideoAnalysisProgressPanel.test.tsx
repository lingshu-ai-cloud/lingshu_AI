import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { VideoAnalysisProgress } from '../../lib/inspirationTypes.js';
import VideoAnalysisProgressPanel from './VideoAnalysisProgressPanel.js';

function progress(overrides: Partial<VideoAnalysisProgress> = {}): VideoAnalysisProgress {
  return {
    stage: 'queued', stageLabel: '等待后台工作槽', percent: null, currentStep: '任务已进入分析队列',
    queuePosition: 3, queuedAt: '2026-10-09T06:00:00.000Z', startedAt: null,
    updatedAt: '2026-10-09T06:01:00.000Z', estimatedCompletedAt: '2026-10-09T06:05:00.000Z',
    etaSeconds: 240, retryable: false, backendAccepted: true, workerStarted: false,
    runId: 'analysis-run-12345678', ...overrides,
  };
}

function render(item?: VideoAnalysisProgress, pending = true) {
  return renderToStaticMarkup(<VideoAnalysisProgressPanel progress={item} pending={pending} onRetry={() => {}} />);
}

test('renders backend acceptance, queue position, worker state and run credential', () => {
  const html = render(progress());
  assert.match(html, /等待后台工作槽/);
  assert.match(html, /第 3 位/);
  assert.match(html, /等待 Worker/);
  assert.match(html, /任务凭证 · 12345678/);
  assert.doesNotMatch(html, /role="progressbar"/);
});

test('does not invent percentage or ETA when backend omits them', () => {
  const html = render(progress({ percent: null, estimatedCompletedAt: null, etaSeconds: null }));
  assert.doesNotMatch(html, /role="progressbar"/);
  assert.match(html, /后台尚未提供可信百分比/);
  assert.match(html, /后端暂未给出/);
});

test('retry is exposed only for a retryable failed run', () => {
  assert.match(render(progress({ stage: 'failed', percent: null, retryable: true })), />重试分析</);
  assert.doesNotMatch(render(progress({ stage: 'failed', percent: null, retryable: false })), />重试分析</);
});

test('paused or cancelled analysis offers an explicit resume action', () => {
  assert.match(render(progress({ stage: 'paused', stageLabel: '分析已暂停', percent: 42 })), />继续分析</);
  assert.match(render(progress({ stage: 'cancelled', stageLabel: '分析已取消', percent: null })), />继续分析</);
});

test('completed analysis no longer keeps a progress panel on screen', () => {
  assert.equal(render(progress({ stage: 'completed', stageLabel: '全片精准分析已完成', percent: 100 }), false), '');
});

test('active progress announces stage changes without re-announcing the ticking elapsed time', () => {
  const html = render(progress({ stage: 'analyzing', stageLabel: '正在分析', currentStep: '提取逐镜证据', workerStarted: true }));
  assert.equal(html.match(/aria-live=/g)?.length, 1);
  assert.doesNotMatch(html, /<section[^>]*role="status"/);
  assert.match(html, /aria-atomic="true"/);
});
