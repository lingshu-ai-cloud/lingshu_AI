import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { benchmarkVideoFixture } from '../../tests/fixtures/benchmarkVideo.js';
import type { TrendVideo, VideoAnalysisPayload } from '../lib/inspirationTypes.js';
import { inspirationCreationAvailability, inspirationCreationShotPreflight } from './InspirationDashboard.js';

const source = readFileSync(new URL('./InspirationDashboard.tsx', import.meta.url), 'utf8');
const analysisTabsSource = readFileSync(new URL('./inspiration/InspirationVideoAnalysisTabs.tsx', import.meta.url), 'utf8');

test('director detail keeps analysis evidence inside the three analysis tabs', () => {
  assert.match(source, /import InspirationVideoAnalysisTabs from '.\/inspiration\/InspirationVideoAnalysisTabs';/);
  assert.match(source, /<Drawer open title=\{video\.title\}/);
  assert.match(source, /<InspirationVideoAnalysisTabs/);
  assert.match(source, /analysisActionAvailable=\{canRunExactAnalysis\}/);
  assert.match(source, /storyboardStatus=\{<>[^]*?<VideoAnalysisProgressPanel[^]*?编导到内容 Agent 交接状态[^]*?<\/>\}/, '进度与交接状态必须进入“分镜与脚本”页');
  assert.match(source, /speechAlignment=\{<ReferenceSpeechAlignmentPanel/, '口播对齐证据必须进入“分镜与脚本”页');
  assert.match(analysisTabsSource, /tab\.id === 'storyboard'[^]*?\{storyboardStatus\}[^]*?<DirectorShotAnalysisStatus[^]*?<BenchmarkAnalysisSections[^]*?\{speechAlignment\}/, '分镜页应依次承载状态、逐镜证据与口播对齐');
});

test('completed precision analysis hides transient progress and redundant review summaries', () => {
  const detailStart = source.indexOf('function DirectorVideoDetailPanel');
  const detailEnd = source.indexOf('// ── Main page', detailStart);
  const detailSource = source.slice(detailStart, detailEnd);
  assert.match(detailSource, /const showAnalysisProgress = !isImagePost && progressStage !== 'completed'/);
  assert.match(detailSource, /\{showAnalysisProgress && <VideoAnalysisProgressPanel/);
  assert.doesNotMatch(detailSource, /<BenchmarkAnalysisSections/, 'Drawer 不得在三个 Tab 外重复渲染全片拆解');
  assert.doesNotMatch(detailSource, /编导 Agent 待补证据/);
  assert.doesNotMatch(detailSource, />分析结论</);
  assert.doesNotMatch(detailSource, /analysisReviewReasons\.map/);
  assert.match(detailSource, /reviewHandoff\?\.directorHandoffReady/);
  assert.match(detailSource, /detailCreationReady =[^;]*exactQuality\.ready && !pending/);
});

test('image posts and deleted weekly snapshots keep safe detail states', () => {
  assert.match(source, /\) : isImagePost \? \(/);
  assert.match(source, /完成后会展示图文证据与轮播节奏/);
  assert.match(source, /analysisSource === 'weekly-plan-snapshot'/);
  assert.match(source, /video\.id\.startsWith\('weekly-reference-'\)/);
});

test('active server progress wins over an older completed analysis result', () => {
  const progressGate = source.indexOf('if (analysisProgressIsActive(progress))');
  const exactModeGate = source.indexOf("if (payload?.analysisMode !== 'exact')");
  assert.ok(progressGate >= 0 && progressGate < exactModeGate);
  assert.match(source, /benchmark\.shots\.some\(shot => shot\.granularity !== 'shot'\)/);
  assert.match(source, /!benchmark\.timelineComplete/);
  assert.match(source, /activeServerAnalysis \|\| !recordId/);
  assert.match(source, /const draftReady = !pending && reviewHandoff\?\.directorHandoffReady/);
  assert.match(source, /const availability = inspirationCreationAvailability\(video\)/);
  assert.match(source, /createDisabled=\{video\.contentFormat === 'image' && !inspirationCreationAvailability\(video\)\.ready\}/);
});

test('image creation waits for trusted image evidence and uses the image-only reanalysis endpoint', () => {
  const image: TrendVideo = {
    id: 'crawl-image-preflight', recordId: 'image-preflight', platform: 'instagram', title: '图文证据门槛',
    thumbnail: '', duration: 0, tags: [], views: '100', trend: 'stable', contentFormat: 'image', status: 'pending',
    aiAnalysis: { contentFormat: 'image' },
  };
  assert.match(inspirationCreationAvailability(image).reason, /图文证据尚未完成/);

  image.status = 'failed';
  image.aiAnalysis = { ...image.aiAnalysis, imageAnalysisStatus: 'failed' };
  assert.match(inspirationCreationAvailability(image).reason, /图文分析失败/);

  image.status = 'analyzed';
  image.aiAnalysis = { ...image.aiAnalysis, imageAnalysisStatus: 'analyzed', imageEvidence: {
    version: 2, status: 'analyzed',
    observedFacts: [{ imageIndex: 0, subjects: ['产品'], scene: '桌面', composition: '居中', colors: ['白色'], visibleText: ['新品'], confidence: 0.9 }],
    carouselFlow: [{ imageIndex: 0, role: 'product', evidence: '产品居中展示', confidence: 0.9 }],
    copyEvidence: { hooks: [{ text: '新品', source: 'ocr', evidence: '首图可见' }], sellingPoints: [], cta: [] },
    reusableModules: [], uncertainties: [],
  } };
  assert.deepEqual(inspirationCreationAvailability(image), { ready: true, reason: '' });

  assert.match(source, /\/reanalyze-image`, \{\s*method: 'POST'/);
  assert.match(source, /onReanalyzeImage=\{\(\) => void reanalyzeImagePost\(selectedVideo\)\}/);
  assert.match(source, /!isImagePost && !analysisInterrupted && \(payload\?\.analysisError \|\| video\.status === 'failed'\)/);
});

function benchmarkVideo(): TrendVideo {
  return {
    id: 'analysis-preflight', recordId: 'analysis-preflight', platform: 'tiktok', title: '分析质量门槛',
    thumbnail: '', duration: 9, tags: [], views: '100', trend: 'stable', contentFormat: 'video', status: 'analyzed',
    aiAnalysis: benchmarkVideoFixture() as VideoAnalysisPayload,
  };
}

test('production preflight requires a complete director timeline and rejects an active rerun', () => {
  const complete = benchmarkVideo();
  assert.deepEqual(inspirationCreationShotPreflight(complete), { ready: true, reason: '' });

  const gap = benchmarkVideo();
  gap.aiAnalysis = { ...gap.aiAnalysis, gemini: { ...gap.aiAnalysis!.gemini,
    scriptDetails15s: gap.aiAnalysis!.gemini!.scriptDetails15s!.map((shot, index) => index === 4 ? { ...shot, time: '4.5-5.5s' } : shot) } };
  assert.match(inspirationCreationShotPreflight(gap).reason, /时间线未完整覆盖/);

  const rerun = benchmarkVideo();
  rerun.aiAnalysis = { ...rerun.aiAnalysis, requestedAnalysisMode: 'exact', analysisProgress: {
    stage: 'analyzing', stageLabel: '正在分析', currentStep: '正在重新分析导演级分镜', percent: null,
    queuePosition: null, queuedAt: null, startedAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:01:00.000Z',
    estimatedCompletedAt: null, etaSeconds: null, retryable: false, backendAccepted: true, workerStarted: true, runId: 'rerun-1',
  } };
  assert.match(inspirationCreationShotPreflight(rerun).reason, /正在重新分析导演级分镜/);

  const failedRerun = benchmarkVideo();
  failedRerun.aiAnalysis = { ...failedRerun.aiAnalysis, analysisReviewReasons: ['old-review-gap'], analysisProgress: {
    stage: 'failed', stageLabel: '分析失败', currentStep: '供应商任务已失败', percent: null,
    queuePosition: null, queuedAt: null, startedAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:01:00.000Z',
    estimatedCompletedAt: null, etaSeconds: null, retryable: true, backendAccepted: true, workerStarted: true, runId: 'rerun-2',
  } };
  assert.match(inspirationCreationShotPreflight(failedRerun).reason, /精确分析失败：供应商任务已失败/);

  const needsReview = benchmarkVideo();
  needsReview.aiAnalysis = { ...needsReview.aiAnalysis, geminiStatus: 'needs_review', analysisReviewReasons: ['opening_hook_observation_uncertainty'] };
  const publicReason = inspirationCreationShotPreflight(needsReview).reason;
  assert.match(publicReason, /1 项镜头证据尚未通过质量校验/);
  assert.doesNotMatch(publicReason, /opening_hook_observation_uncertainty/);
});
