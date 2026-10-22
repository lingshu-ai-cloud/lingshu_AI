import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { TrendVideo } from '../../lib/inspirationTypes';
import { needsVideoEnhancement, pipelineState, referenceHighlights } from './inspirationAnalysisProjection';

const panelSource = readFileSync(new URL('./InspirationAnalysisPanel.tsx', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../InspirationDashboard.tsx', import.meta.url), 'utf8');
const video = {
  id: 'video-1', platform: 'youtube', title: '参考视频', tags: [], duration: 30,
  thumbnail: 'https://example.com/poster.jpg', views: '100', trend: 'stable',
  contentFormat: 'video', status: 'analyzed',
} as TrendVideo;

test('completed analysis requiring review is never presented as still generating', () => {
  const reviewed = { ...video, aiAnalysis: { gemini: { theme: '产品展示' }, geminiStatus: 'needs_review' } } as TrendVideo;
  assert.equal(pipelineState(reviewed).spinning, false);
  assert.match(pipelineState(reviewed).title, /待人工复核/);
  assert.equal(needsVideoEnhancement({ ...video, aiAnalysis: { analysisSource: 'metadata-fallback' } } as TrendVideo), true);
});

test('analysis panel retains evidence and creation gates after extraction', () => {
  assert.match(pageSource, /<AnalysisPanel key=\{video\.id\}/);
  assert.match(panelSource, /imageEvidence\?\.status === 'analyzed'/);
  assert.match(panelSource, /const analysisQuality = exactAnalysisQuality\(video\)/);
  assert.match(panelSource, /videoGenerationBlocked = video\.contentFormat === 'video' && !analysisQuality\.ready/);
  assert.match(panelSource, /onGenerateScript\(analysis \|\| undefined\)/);
  assert.match(panelSource, /matchMaterialsToFrames\(analysis\.scriptDetails15s, materials\)/);
  assert.equal(referenceHighlights(video, null).length, 3);
});
