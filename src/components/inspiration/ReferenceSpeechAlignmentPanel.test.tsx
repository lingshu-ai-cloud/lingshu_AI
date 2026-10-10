import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import ReferenceSpeechAlignmentPanel from './ReferenceSpeechAlignmentPanel.js';
import { alignReferenceWordsToShots } from '../../../server/lib/referenceWordAlignment.js';

test('detail panel exposes measured word timing and Qwen decision without claiming frame accuracy', () => {
  const result = alignReferenceWordsToShots({ provenance: 'qwen_filetrans:measured_words', timestampResolutionMs: 1,
    words: [{ start: .2, end: .6, text: 'Hi' }, { start: .7, end: 1.2, text: 'Boss' }],
    shots: [{ shotId: 'S1', start: 0, end: 2, beats: [{ beatId: 'B1', start: 0, end: 1 }] }],
  });
  const shot = { ...result.shots[0], time: '0.00s–2.00s', criticalShot: {
    classification: 'critical', explicitAudioVisualSync: true, reason: '接近镜头同时说Hi',
    evidence: ['0.200s Hi与动作开始同时发生'], model: 'qwen-plus',
    actionEvents: [{ start: .2, end: .8, action: '接近镜头', evidenceFrameSeconds: [.2, .8], timingPrecision: 'sampled_frames' }],
    syncPoints: [{ wordIds: ['word-0001'], eventIndex: 0, syncTime: .3, reason: '问候同时迎向观众' }],
  }, beats: result.shots[0].beats.map(beat => ({ ...beat, action: '接近镜头' })) };
  const html = renderToStaticMarkup(<ReferenceSpeechAlignmentPanel details={[shot]} />);
  for (const item of ['1/1 镜有词级证据', '真实口播：Hi Boss', '逐词时间戳', 'qwen_filetrans:measured_words',
    '置信度：来源未提供', '时钟误差未验证', '关键镜头', '已识别明确同步点', 'qwen-plus',
    '0.200s', '0.600s', '动作：', '接近镜头', '对应词语：', '卡点 1', '0.300s', '千问同步依据', '问候同时迎向观众', '依据原片抽帧']) assert.ok(html.includes(item), item);
  assert.ok(!html.includes('逐帧准确'));
  assert.ok(!html.includes('人工确认'));
});

test('invalid word references cannot display a confirmed audiovisual sync point', () => {
  const result = alignReferenceWordsToShots({ provenance: 'test', timestampResolutionMs: 1,
    words: [{ start: .2, end: .8, text: 'hi' }], shots: [{ shotId: 'A', start: 0, end: 1 }] });
  const html = renderToStaticMarkup(<ReferenceSpeechAlignmentPanel details={[{ ...result.shots[0], criticalShot: {
    classification: 'critical', explicitAudioVisualSync: true,
    actionEvents: [{ start: .2, end: .8, action: 'wave', evidenceFrameSeconds: [.2, .8] }],
    syncPoints: [{ wordIds: ['nonexistent'], eventIndex: 0, syncTime: .3 }],
  } }]} />);
  assert.ok(html.includes('未知（暂无合法同步点证据）'));
  assert.ok(!html.includes('已识别明确同步点'));
  assert.ok(!html.includes('卡点 1'));
  const wrongClock = renderToStaticMarkup(<ReferenceSpeechAlignmentPanel details={[{ ...result.shots[0], criticalShot: {
    classification: 'critical', explicitAudioVisualSync: true,
    actionEvents: [{ start: .2, end: .8, action: 'wave', evidenceFrameSeconds: [.2, .8] }],
    syncPoints: [{ wordIds: ['word-0001'], eventIndex: 0, syncTime: 4 }],
  } }]} />);
  assert.ok(wrongClock.includes('未知（暂无合法同步点证据）'));
  assert.ok(!wrongClock.includes('已识别明确同步点'));
});

test('legacy and coarse data render as unknown, without using old dialogue as measured words', () => {
  const html = renderToStaticMarkup(<ReferenceSpeechAlignmentPanel details={[{ time: '0–5s', dialogue: 'invented full paragraph',
    speechAlignment: { timingPrecision: 'coarse', coarseEvidence: [{ start: 0, end: 30, text: 'coarse paragraph' }] },
    beats: [{ time: '0–1s', action: '伸手', dialogue: 'invented beat dialogue' }],
  }]} transcript={{ text: 'coarse paragraph' }} />);
  assert.ok(html.includes('0/1 镜有词级证据'));
  assert.ok(html.includes('未知（暂无模型判断证据）'));
  assert.ok(html.includes('粗时间窗口'));
  assert.ok(html.includes('coarse paragraph'));
  assert.ok(!html.includes('invented full paragraph'));
  assert.ok(!html.includes('invented beat dialogue'));
  assert.ok(html.includes('暂无词级证据'));
});

test('empty data has no panel and low-confidence words cannot be presented as confirmed sync', () => {
  assert.equal(renderToStaticMarkup(<ReferenceSpeechAlignmentPanel details={[]} />), '');
  const result = alignReferenceWordsToShots({ provenance: 'test', timestampResolutionMs: 1,
    words: [{ start: 0, end: .5, text: 'hi', confidence: .1 }], shots: [{ shotId: 'A', start: 0, end: 1 }] });
  const html = renderToStaticMarkup(<ReferenceSpeechAlignmentPanel details={result.shots} />);
  assert.ok(html.includes('不用于同步判断'));
  assert.ok(html.includes('未知（暂无模型判断证据）'));
});

test('alignment panel is scoped to existing Inspiration detail dialog only', () => {
  const componentRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const consumers: string[] = [];
  function walk(directory: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(filename);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('ReferenceSpeechAlignmentPanel')) {
        if (/import.*ReferenceSpeechAlignmentPanel/.test(fs.readFileSync(filename, 'utf8'))) consumers.push(path.relative(componentRoot, filename));
      }
    }
  }
  walk(componentRoot);
  assert.deepEqual(consumers, ['InspirationDashboard.tsx']);
  const source = fs.readFileSync(path.join(componentRoot, 'InspirationDashboard.tsx'), 'utf8');
  assert.ok(source.includes('<ReferenceSpeechAlignmentPanel details={payload?.gemini?.scriptDetails15s}'));
  assert.ok(source.indexOf('<ReferenceSpeechAlignmentPanel') > source.indexOf('aria-labelledby="director-video-analysis-title"'));
});

const productionRoute = (overrides: Record<string, unknown> = {}) => ({
  state: 'ready', route: 'reference_frame_presenter', tier: 'standard',
  observedPresenterRole: 'sales_presenter', personPresence: 'person',
  personContinuityId: 'P1', criticality: 'non_critical',
  reason: '同一主讲人物需要保持身份连续性', evidence: ['第 1、12、17 镜为同一可见人物'],
  source: { model: 'qwen3-vl-flash', provenance: 'qwen:presenter_continuity_frames', sourceSha256: 'source-hash' },
  identityLock: { required: true, sourcePersonId: 'P1', groupKey: 'source-hash:P1',
    samePersonShotIds: ['shot-1', 'shot-12', 'shot-17'], targetPresenterAssetId: null },
  constraints: { forbidGenericPersonMatch: true, mustUseReferenceFrames: true, nonPresenterBrollOnly: false },
  automaticAnalysisRequired: false, ...overrides,
});

test('non-critical presenter still shows identity-constrained generation independently from criticality', () => {
  const html = renderToStaticMarkup(<ReferenceSpeechAlignmentPanel details={[{
    time: '17.30s–20.77s', criticalShot: { classification: 'non_critical', reason: '普通介绍节奏' },
    referenceProductionRouting: productionRoute(),
  }]} />);
  for (const item of ['关键性：非关键镜头', '千问关键性判断：普通介绍节奏', '人物可见性：人物可见',
    '主讲口播', '人物连续性：P1', '身份锁定：需要锁定同一人物', 'shot-1、shot-12、shot-17',
    '目标人物：待自动绑定', '生产路由：按对标镜头生成人物视频', '生产档位：标准生成',
    '路由依据：同一主讲人物需要保持身份连续性', 'qwen3-vl-flash', '使用对标原片参考帧重建人物动作与镜头']) {
    assert.ok(html.includes(item), item);
  }
  assert.ok(!html.includes('匹配素材库'));
  assert.ok(!html.includes('人工确认'));
});

test('no-person library matching and critical AIGC use explicit production decisions and separate labels', () => {
  const library = productionRoute({ route: 'library_match', tier: null, observedPresenterRole: 'none',
    personPresence: 'none', personContinuityId: null, identityLock: null,
    reason: '无人普通说明镜头可复用库内素材', evidence: ['原片工厂设备空镜'],
    constraints: { forbidGenericPersonMatch: false, mustUseReferenceFrames: false, nonPresenterBrollOnly: false } });
  const html = renderToStaticMarkup(<ReferenceSpeechAlignmentPanel details={[
    { time: '1–2s', criticalShot: { classification: 'non_critical' }, referenceProductionRouting: library },
    { time: '2–3s', criticalShot: { classification: 'critical' }, referenceProductionRouting: { ...library,
      route: 'aigc_video', tier: 'high', reason: '无人关键机制需要重建' } },
  ]} />);
  for (const item of ['关键性：非关键镜头', '关键性：关键镜头', '人物可见性：未见人物',
    '身份锁定：不要求主讲身份锁定', '生产路由：匹配素材库', '生产档位：素材复用',
    '生产路由：AIGC 视频生成', '生产档位：高还原生成', '无人关键机制需要重建']) assert.ok(html.includes(item), item);
});

test('same-person action keeps identity while background B-roll route is shown explicitly', () => {
  const html = renderToStaticMarkup(<ReferenceSpeechAlignmentPanel details={[
    { time: '1–2s', criticalShot: { classification: 'non_critical' }, referenceProductionRouting:
      productionRoute({ observedPresenterRole: 'presenter_action', reason: '同一人物出镜动作延续' }) },
    { time: '2–3s', criticalShot: { classification: 'non_critical' }, referenceProductionRouting:
      productionRoute({ route: 'non_presenter_library_match', tier: null, observedPresenterRole: 'background',
        personContinuityId: null, identityLock: null, reason: '非主讲工人作业画面',
        constraints: { forbidGenericPersonMatch: false, mustUseReferenceFrames: false, nonPresenterBrollOnly: true } }) },
  ]} />);
  assert.ok(html.includes('人物动作'));
  assert.ok(html.includes('生产路由：按对标镜头生成人物视频'));
  assert.ok(html.includes('生产路由：匹配素材库（仅非主讲画面）'));
  assert.ok(html.includes('当前素材需求仅包含非主讲画面。'));
  assert.ok(html.includes('背景人物无需绑定主讲身份'));
  assert.ok(html.includes('生产档位：素材复用'));
});

test('legacy role and non-critical labels cannot invent a production route; pending and invalid enums stay automatic unknown', () => {
  for (const shot of [
    { criticalShot: { classification: 'non_critical' }, observedPresenterRole: 'sales_presenter', personContinuityId: 'legacy-P1' },
    { criticalShot: { classification: 'non_critical' }, productionRouting: { presenterVisible: true } },
    { referenceProductionRouting: productionRoute({ state: 'awaiting_automatic_analysis', route: 'undetermined', reason: '缺少新的抽帧人物证据' }) },
    { referenceProductionRouting: productionRoute({ route: 'unknown_provider_route' }) },
  ]) {
    const html = renderToStaticMarkup(<ReferenceSpeechAlignmentPanel details={[{ time: '1–2s', ...shot }]} />);
    for (const field of ['人物可见性', '人物连续性', '身份锁定', '生产路由', '生产档位']) assert.ok(html.includes(`${field}：待自动识别`), field);
    assert.ok(!html.includes('生产路由：匹配素材库'));
    assert.ok(!html.includes('生产路由：按对标镜头生成人物视频'));
    assert.ok(!html.includes('legacy-P1'));
  }
});
