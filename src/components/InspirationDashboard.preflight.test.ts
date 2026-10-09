import assert from 'node:assert/strict';
import test from 'node:test';
import { benchmarkVideoFixture } from '../../tests/fixtures/benchmarkVideo.js';
import type { TrendVideo, VideoAnalysisPayload } from '../lib/inspirationTypes.js';
import { inspirationCreationShotPreflight } from './InspirationDashboard.js';

function video(): TrendVideo {
  return {
    id: 'material-reference', platform: 'tiktok', title: '测试视频', thumbnail: '', duration: 9,
    tags: [], views: '100', trend: 'stable', contentFormat: 'video', status: 'analyzed',
    aiAnalysis: benchmarkVideoFixture() as unknown as VideoAnalysisPayload,
  };
}

test('creation accepts a complete exact shot timeline, including stored materials', () => {
  assert.equal(inspirationCreationShotPreflight(video()).ready, true);
  const completedWithStaleRequest = video();
  completedWithStaleRequest.aiAnalysis = { ...completedWithStaleRequest.aiAnalysis, requestedAnalysisMode: 'exact', geminiStatus: 'analyzed' };
  assert.equal(inspirationCreationShotPreflight(completedWithStaleRequest).ready, true);
});

test('creation blocks strategy, pending and observation-window analyses', () => {
  const strategy = video();
  strategy.aiAnalysis = { ...strategy.aiAnalysis, analysisMode: 'strategy' };
  assert.equal(inspirationCreationShotPreflight(strategy).ready, false);
  const pending = video();
  pending.aiAnalysis = { ...pending.aiAnalysis, requestedAnalysisMode: 'exact', geminiStatus: 'queued' };
  assert.equal(inspirationCreationShotPreflight(pending).ready, false);
  const observation = video();
  observation.aiAnalysis = { ...observation.aiAnalysis, gemini: { ...observation.aiAnalysis!.gemini,
    scriptDetails15s: observation.aiAnalysis!.gemini!.scriptDetails15s!.map((shot, index) => index === 0 ? { ...shot, analysisGranularity: 'observation_window' } : shot) } } as VideoAnalysisPayload;
  assert.match(inspirationCreationShotPreflight(observation).reason, /逐镜切点/);
  const oldMaterial = video();
  oldMaterial.aiAnalysis = undefined;
  assert.equal(inspirationCreationShotPreflight(oldMaterial).ready, false);
});

test('creation blocks a missing cutpoint even when other shots look usable', () => {
  const incomplete = video();
  incomplete.aiAnalysis = { ...incomplete.aiAnalysis, gemini: { ...incomplete.aiAnalysis!.gemini,
    scriptDetails15s: incomplete.aiAnalysis!.gemini!.scriptDetails15s!.map((shot, index) => index === 4 ? { ...shot, time: '' } : shot) } };
  assert.match(inspirationCreationShotPreflight(incomplete).reason, /时间线/);
  const image = { ...video(), contentFormat: 'image' as const, aiAnalysis: undefined };
  assert.equal(inspirationCreationShotPreflight(image).ready, true);
});

test('creation and detailed completion use the same strict full-timeline threshold', () => {
  const slightGap = video();
  slightGap.aiAnalysis = { ...slightGap.aiAnalysis, gemini: { ...slightGap.aiAnalysis!.gemini,
    scriptDetails15s: slightGap.aiAnalysis!.gemini!.scriptDetails15s!.map((shot, index) => index === 4 ? { ...shot, time: '4.5-5.5s' } : shot) } };
  assert.match(inspirationCreationShotPreflight(slightGap).reason, /时间线/);
});
