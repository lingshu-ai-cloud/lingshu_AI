/** Evidence contract shared by Inspiration and the future business schedule consumer. */
export const MATERIAL_TYPE_LABELS = {
  talking_head: '真人口播', factory: '工厂生产', product: '产品展示',
  consumer_demo: '消费者使用与效果演示', other: '其他', unknown: '待判断',
} as const;
export const SHOT_ROLE_LABELS = {
  hook: '钩子', pain_point: '痛点', capability_proof: '能力证明', product_intro: '产品介绍',
  effect_proof: '效果证明', cta: '行动引导', transition: '过渡', unknown: '待判断',
} as const;
export type BenchmarkMaterialType = keyof typeof MATERIAL_TYPE_LABELS;
export type BenchmarkShotRole = keyof typeof SHOT_ROLE_LABELS;
export interface BenchmarkShot {
  shotId: string; index: number; time: string; start: number | null; end: number | null;
  materialType: BenchmarkMaterialType; narrativeRole: BenchmarkShotRole;
  classificationSource: 'model' | 'legacy_evidence' | 'missing'; classificationEvidence: string; visual: string; dialogue: string; onScreenText: string;
  purpose: string; firstFrameRef: string | null; clipRef: string | null; needsReview: boolean;
  granularity: 'shot' | 'observation_window';
  environment: string; framing: string; camera: string; audio: string; authenticity: string;
  effectivenessHypothesis: string; detailedAnalysis: Record<string, string>;
}
export interface BenchmarkSpeechGroup {
  groupId: string; start: number; end: number; text: string;
  timingPrecision: 'phrase' | 'coarse'; needsReview: boolean; shotIds: string[];
}
export interface BenchmarkAnalysis {
  schemaVersion: 1;
  source: { videoId: string; analysisRunId: string | null; evidenceRevision: string | null;
    correctionVersion: number; analyzedAt: string | null; analysisMode: string };
  status: 'pending' | 'failed' | 'needs_review' | 'partial' | 'ready';
  gaps: string[]; hookShotId: string | null;
  shots: BenchmarkShot[]; totalShots: number | null; timelineComplete: boolean;
  materialCounts: Record<BenchmarkMaterialType, number>;
  structure: Array<{ materialType: BenchmarkMaterialType; narrativeRole: BenchmarkShotRole; shotIds: string[] }>;
  speechGroups: BenchmarkSpeechGroup[];
}
export const recordOf = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
export function benchmarkMaterialType(value: unknown): BenchmarkMaterialType {
  return typeof value === 'string' && Object.hasOwn(MATERIAL_TYPE_LABELS, value) ? value as BenchmarkMaterialType : 'unknown';
}
export function benchmarkShotRole(value: unknown): BenchmarkShotRole {
  return typeof value === 'string' && Object.hasOwn(SHOT_ROLE_LABELS, value) ? value as BenchmarkShotRole : 'unknown';
}
/** No guessed boundaries and no mm:ss-to-seconds ambiguity. */
export function benchmarkTimeRange(value: unknown): { start: number; end: number } | null {
  const match = text(value).match(/^(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–—~至]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?$/i);
  if (!match) return null;
  const start = Number(match[1]); const end = Number(match[2]);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
}
/** Conservative compatibility mapping: use visible actions, never factory background alone. */
function legacyMaterial(row: Record<string, unknown>): BenchmarkMaterialType {
  const visual = text(row.visual);
  if (/(消费者|顾客|用户|模特).{0,20}(使用|涂抹|试用|上脸)|使用前后|效果对比/.test(visual)) return 'consumer_demo';
  if (/(主播|主持人|讲解员|销售人员|人物).{0,40}(麦克风|口播|面向镜头|对镜头|讲解)|真人口播/.test(visual)) return 'talking_head';
  if (/(生产线|流水线|灌装|包装工序|机器运转|工人.{0,10}(操作|生产|组装))/.test(visual)) return 'factory';
  if (/(产品|商品|瓶身|包装盒|灯具|吊灯).{0,20}(特写|展示|近景)|特写.{0,20}(产品|商品|瓶身)/.test(visual)) return 'product';
  return 'unknown';
}
function legacyRole(row: Record<string, unknown>): BenchmarkShotRole {
  const purpose = text(row.purpose);
  if (/引导.{0,12}(联系|咨询|下单|购买|行动)|行动号召|联系方式/.test(purpose)) return 'cta';
  if (/效果.{0,8}(证明|展示)|前后对比/.test(purpose)) return 'effect_proof';
  if (/(生产|工厂|制造).{0,12}(能力|实力|证明)|能力证明/.test(purpose)) return 'capability_proof';
  if (/介绍产品|产品介绍|展示产品|产品展示/.test(purpose)) return 'product_intro';
  if (/痛点/.test(purpose)) return 'pain_point';
  if (/过渡|衔接/.test(purpose)) return 'transition';
  return 'unknown';
}
/** Media stays on the existing tenant-scoped API; never publish local paths or object keys. */
export function benchmarkMediaRef(value: unknown, videoId: string, index: number, kind: 'first-frame' | 'clip'): string | null {
  const expected = `/api/overseas/videos/${encodeURIComponent(videoId)}/shot/${index}/${kind}`;
  return videoId && text(value) === expected ? expected : null;
}
export function buildBenchmarkAnalysis(input: {
  analysis: unknown; videoId?: string; duration?: number; evidenceRevision?: string | null;
}): BenchmarkAnalysis {
  const payload = recordOf(input.analysis); const gemini = recordOf(payload.gemini);
  const videoId = input.videoId || ''; const correction = recordOf(payload.correction);
  const gaps: string[] = [];
  const details = Array.isArray(gemini.scriptDetails15s) ? gemini.scriptDetails15s : [];
  const shots: BenchmarkShot[] = details.map((raw, index) => {
    const row = recordOf(raw); const range = benchmarkTimeRange(row.time || row.timestamp);
    const media = recordOf(row.materialEvidence);
    const explicitType = benchmarkMaterialType(row.materialType);
    const materialType = explicitType === 'unknown' ? legacyMaterial(row) : explicitType;
    const explicitRole = benchmarkShotRole(row.narrativeRole);
    const narrativeRole = index === 0 ? 'hook' : explicitRole === 'unknown' ? legacyRole(row) : explicitRole;
    const derived = (explicitType === 'unknown' && materialType !== 'unknown') || (index > 0 && explicitRole === 'unknown' && narrativeRole !== 'unknown');
    const classificationEvidence = text(row.classificationEvidence) || (derived ? `依据已有描述整理：${text(row.visual)}${text(row.purpose) ? `；原镜头作用：${text(row.purpose)}` : ''}` : '');
    return { shotId: `shot_${index + 1}`, index: index + 1, time: text(row.time || row.timestamp),
      start: range?.start ?? null, end: range?.end ?? null,
      materialType, narrativeRole,
      classificationSource: derived ? 'legacy_evidence' : classificationEvidence ? 'model' : 'missing', classificationEvidence, visual: text(row.visual),
      dialogue: text(row.dialogue), onScreenText: text(row.onScreenText || row.subtitle), purpose: text(row.purpose),
      firstFrameRef: benchmarkMediaRef(media.firstFrameRef, videoId, index + 1, 'first-frame'),
      clipRef: benchmarkMediaRef(media.clipRef, videoId, index + 1, 'clip'),
      granularity: row.analysisGranularity === 'observation_window' ? 'observation_window' as const : 'shot' as const,
      environment: text(row.environment), framing: text(row.shot), camera: text(row.camera),
      audio: text(row.audio), authenticity: text(row.authenticity),
      effectivenessHypothesis: text(recordOf(row.viralPotential).whyEffective),
      detailedAnalysis: Object.fromEntries(['angle', 'composition', 'ambientSound', 'bgm', 'soundEffects',
        'observedFacts', 'inferredIntent', 'causalGap', 'startState', 'endState', 'transitionToNext'].flatMap(key => {
          const value = row[key]; const content = Array.isArray(value) ? value.filter(item => typeof item === 'string').join('；') : text(value);
          return content ? [[key, content]] : [];
        })),
      needsReview: row.needsReview === true || !range || !text(row.visual)
        || derived || materialType === 'unknown' || narrativeRole === 'unknown' || !classificationEvidence,
    };
  });
  const ranges = shots.filter(shot => shot.start !== null && shot.end !== null);
  const duration = Number(input.duration);
  const timelineComplete = shots.length > 0 && ranges.length === shots.length
    && ranges[0]!.start! <= 0.35
    && ranges.every((shot, index) => !index || Math.abs(shot.start! - ranges[index - 1]!.end!) <= 0.35)
    && Number.isFinite(duration) && duration > 0 && Math.abs(ranges.at(-1)!.end! - duration) <= 0.75;
  if (!shots.length) gaps.push('尚无逐镜分析');
  else if (!timelineComplete) gaps.push('全片时间线尚未确认完整');
  if (shots.some(shot => shot.materialType === 'unknown' || shot.narrativeRole === 'unknown' || !shot.classificationEvidence)) gaps.push('镜头素材类型、作用或分类依据待补齐');
  if (shots.some(shot => shot.needsReview)) gaps.push('存在待复核镜头');
  if (shots.some(shot => shot.granularity === 'observation_window')) gaps.push('当前为观察窗口，真实切镜数尚未确认');
  if (payload.analysisMode !== 'exact') gaps.push('尚未完成全片精确分析');
  const hookShotId = shots[0]?.shotId || null;
  const materialCounts = Object.fromEntries(Object.keys(MATERIAL_TYPE_LABELS).map(key => [key, 0])) as Record<BenchmarkMaterialType, number>;
  const structure: BenchmarkAnalysis['structure'] = [];
  for (const shot of shots) {
    materialCounts[shot.materialType] += 1;
    const last = structure.at(-1);
    if (last?.materialType === shot.materialType && last.narrativeRole === shot.narrativeRole) last.shotIds.push(shot.shotId);
    else structure.push({ materialType: shot.materialType, narrativeRole: shot.narrativeRole, shotIds: [shot.shotId] });
  }
  const transcript = recordOf(gemini.audioTranscript);
  const speechGroups: BenchmarkSpeechGroup[] = (Array.isArray(transcript.segments) ? transcript.segments : []).flatMap((raw, index) => {
    const row = recordOf(raw); const start = row.start; const end = row.end;
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)
      || start < 0 || end <= start || !text(row.text)) return [];
    const shotIds = shots.filter(shot => shot.start !== null && shot.end !== null && shot.start < end && shot.end > start).map(shot => shot.shotId);
    return [{ groupId: `speech_${index + 1}`, start, end, text: text(row.text),
      timingPrecision: row.timingPrecision === 'phrase' ? 'phrase' as const : 'coarse' as const,
      needsReview: row.needsReview === true || row.timingPrecision !== 'phrase', shotIds }];
  });
  const review = payload.geminiStatus === 'needs_review' || payload.analysisQuality === 'video_review_required'
    || (Array.isArray(payload.analysisReviewReasons) && payload.analysisReviewReasons.length > 0);
  if (review) gaps.push('源分析仍待复核');
  const failed = Boolean(payload.analysisError) || ['failed', 'video_failed', 'analysis_retryable'].includes(text(payload.geminiStatus));
  const pending = !failed && (Boolean(payload.requestedAnalysisMode) || ['queued', 'running', 'analyzing', 'paused', 'waiting_for_video'].includes(text(payload.geminiStatus)));
  if (pending) gaps.push('分析尚未完成或已暂停');
  if (failed) gaps.push('源分析失败，需要重试');
  if (payload.analysisQuality !== 'video' || payload.geminiStatus !== 'analyzed') gaps.push('缺少已完成的原片分析状态');
  if (!videoId || !input.evidenceRevision) gaps.push('服务端分析来源或修订信息待补齐');
  return { schemaVersion: 1, source: { videoId, analysisRunId: text(payload.analysisRunId) || null,
    evidenceRevision: input.evidenceRevision || null, correctionVersion: Number(correction.version) || 0,
    analyzedAt: text(correction.correctedAt || payload.analyzedAt) || null, analysisMode: text(payload.analysisMode) },
    status: failed ? 'failed' : pending || !shots.length ? 'pending' : review ? 'needs_review' : gaps.length ? 'partial' : 'ready',
    gaps: [...new Set(gaps)], hookShotId, shots,
    totalShots: payload.analysisMode === 'exact' && shots.length > 0 && shots.every(shot => shot.granularity === 'shot') ? shots.length : null,
    timelineComplete, materialCounts, structure, speechGroups };
}
