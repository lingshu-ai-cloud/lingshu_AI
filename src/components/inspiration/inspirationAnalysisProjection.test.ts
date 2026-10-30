import assert from 'node:assert/strict';
import test from 'node:test';
import type { TrendVideo } from '../../lib/inspirationTypes';
import { exactAnalysisQuality, getAnalysis, isDisplayableForFormat, inspirationDetailStatusLabel, videoAnalysisFailed } from './inspirationAnalysisProjection';

const video: TrendVideo = {
  id: 'crawl-a', platform: 'youtube', title: '真实视频', thumbnail: 'https://cdn.example/poster.jpg',
  duration: 18, tags: [], views: '100', trend: 'stable', contentFormat: 'video',
  sourceUrl: 'https://www.youtube.com/watch?v=abc',
};

test('failed analysis overrides stale review and strategy evidence, but a new running attempt overrides old errors', () => {
  const failed: TrendVideo = { ...video, status: 'analyzed', aiAnalysis: { geminiStatus: 'needs_review', analysisError: 'provider failed' } };
  const state = { pending: false, imageAnalysisReady: false, exactAnalysisReady: false, hasStrategyAnalysis: true };
  assert.equal(videoAnalysisFailed(failed), true);
  assert.match(inspirationDetailStatusLabel(failed, state), /分析失败/);
  assert.equal(exactAnalysisQuality({ ...video, status: 'failed' }).ready, false);
  const running = { ...failed, aiAnalysis: { ...failed.aiAnalysis, analysisProgress: { stage: 'analyzing', stageLabel: '正在分析' } } } as TrendVideo;
  assert.equal(videoAnalysisFailed(running), false);
  assert.equal(inspirationDetailStatusLabel(running, { ...state, pending: true }), '正在分析');
});

test('analysis projection keeps uncertain speech out of structured subtitle evidence', () => {
  const gemini = {
    theme: '产品展示',
    scriptDetails15s: [{ time: '0-3', visual: '产品包装正面', subtitle: '可能有口播', audio: '疑似台词', note: '可能是字幕' }],
  };
  const analysis = getAnalysis({ ...video, aiAnalysis: { gemini } });
  assert.ok(analysis);
  assert.equal(analysis.scriptDetails15s[0]?.visual, '产品包装正面');
  assert.equal(analysis.scriptDetails15s[0]?.subtitle, '');
  assert.equal(analysis.scriptDetails15s[0]?.audio, '');
  assert.equal(analysis.scriptDetails15s[0]?.note, undefined);
  assert.equal(exactAnalysisQuality({ ...video, aiAnalysis: { gemini, analysisMode: 'exact', geminiStatus: 'analyzed' } }).ready, false, 'a title and one shot do not prove complete video analysis');
});

test('image gallery requires a concrete source', () => {
  assert.equal(isDisplayableForFormat({ ...video, contentFormat: 'image', sourceUrl: 'https://www.instagram.com/search' }, 'image'), false);
  assert.equal(isDisplayableForFormat({ ...video, contentFormat: 'image', platform: 'instagram', sourceUrl: 'https://www.instagram.com/p/abc' }, 'image'), true);
});
