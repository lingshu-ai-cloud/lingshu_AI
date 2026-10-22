import { buildBenchmarkAnalysis } from '../../../shared/benchmarkAnalysis';
import { productionReferenceAdmission } from '../../../shared/productionReferenceAdmission';
import { analysisProgressIsActive } from './VideoAnalysisProgressPanel';
import { parseFrameTimeRange, shortenText } from './inspirationFrameMatching';
import type { ContentFormat, FirstTenSecondInsight, GeminiVideoAnalysis, ScriptAnalysis, ScriptDetail15s, ScriptSummary15s, StructureStep, TrendVideo, VideoAnalysisPayload } from '../../lib/inspirationTypes';

export function referenceHighlights(video: TrendVideo, analysis: ScriptAnalysis | null): string[] {
  if (!analysis) return [
    `参考标题只提炼钩子类型，不复述原文：${shortenText(video.title, 60)}`,
    video.tags.length ? `标签只用于判断受众，不输出原 hashtag：${video.tags.slice(0, 4).join('、')}` : '按平台短视频节奏生成',
    '必须用产品真实细节替换空泛卖点',
  ].filter(Boolean);
  return [
    ...analysis.referenceHighlights,
    ...analysis.structure.slice(0, 4).map(item => `${item.time} ${item.label}: ${item.desc}`),
    ...analysis.scriptDetails15s.slice(0, 3).map(item => `${item.time}: ${item.visual}`),
  ].filter(Boolean).slice(0, 8);
}

function summarizePipelineError(raw?: string): string {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (/could not find .*cookies database|cookies database/i.test(text)) {
    return '下载需要平台登录态，但服务端没有读到浏览器 cookies。请配置可用的 YT_DLP_COOKIES_BROWSER，或换一个无需登录即可下载的公开视频链接。';
  }
  if (/fetch failed/i.test(text)) {
    return '真实视频已拿到，但 Gemini 分析请求失败。通常是服务端无法访问 Gemini 或代理/API Key 配置异常；恢复网络后可重新分析。';
  }
  if (/GEMINI_API_KEY/i.test(text)) {
    return 'Gemini API Key 未配置或不可用，暂时无法完成视频理解分析。';
  }
  if (/429|RESOURCE_EXHAUSTED|quota|prepayment credits|额度|余额/i.test(text)) {
    return '待测试用户填入真实 Gemini API Key。当前只展示基础资料分析；配置可用 Key 后，队列会继续升级为视频级分析。';
  }
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

export function pipelineState(video: TrendVideo): { title: string; desc: string; spinning: boolean; failed: boolean } {
  const analysis = video.aiAnalysis || {};
  const quotaError = /429|RESOURCE_EXHAUSTED|quota|prepayment credits|额度|余额/i.test(String(analysis.analysisError || analysis.downloadError || analysis.crawlerOpsLastError || ''));
  if (quotaError) {
    return { title: '待测试用户填入真实 Gemini API Key', desc: summarizePipelineError(analysis.analysisError || analysis.downloadError || analysis.crawlerOpsLastError), spinning: false, failed: true };
  }
  if (analysis.downloadStatus === 'ops_queued') {
    return { title: '后台增强分析中', desc: '已先生成基础分析；视频获取失败后已进入后台增强队列，成功后会升级为视频级分析。', spinning: true, failed: false };
  }
  if (analysis.gemini && (analysis.geminiStatus === 'needs_review' || analysis.analysisQuality === 'video_review_required')) {
    const reviewCount = analysis.analysisReviewReasons?.length || 1;
    return { title: '全片分析已完成，待人工复核', desc: `真实视频的全片结构和逐镜证据已经生成；还有 ${reviewCount} 项质量校验需要编导确认，不会继续显示为“生成中”。`, spinning: false, failed: false };
  }
  if (analysis.gemini && (analysis.geminiStatus === 'analyzed' || analysis.analysisQuality === 'video')) {
    return { title: 'AI 策略分析完成', desc: '已基于真实视频提取全片结构、前 10 秒五维拆解和可复用爆点。', spinning: false, failed: false };
  }
  if (analysis.analysisError) {
    return { title: 'AI 策略分析失败', desc: summarizePipelineError(analysis.analysisError), spinning: false, failed: true };
  }
  if (analysis.downloadStatus === 'failed' || video.status === 'failed') {
    return { title: '视频下载失败', desc: summarizePipelineError(analysis.downloadError || analysis.analysisError) || '真实视频没有下载成功，因此无法提交 Gemini 分析。', spinning: false, failed: true };
  }
  if (analysis.downloadStatus === 'needs_cookies') {
    return { title: '下载需要平台登录态', desc: summarizePipelineError(analysis.downloadError), spinning: false, failed: true };
  }
  if (analysis.downloadStatus === 'queued') {
    return { title: '已加入自动策略分析队列', desc: '后台会临时获取真实视频用于全片分析，不写入素材库。长视频通常需要数分钟。', spinning: true, failed: false };
  }
  if (analysis.downloadStatus === 'downloading') {
    return { title: '正在获取真实视频', desc: '正在拉取分析版视频，完成后会立即启动 AI 全片策略分析。', spinning: true, failed: false };
  }
  if (analysis.downloadStatus === 'analyzing') {
    return { title: 'AI 正在进行全片策略分析', desc: '真实视频已拿到，正在分析全片画面、语音、结构和可复用爆点；长视频需要数分钟，完成后会自动替换基础分析。', spinning: true, failed: false };
  }
  if (analysis.downloadStatus === 'downloaded' || video.videoUrl) {
    return { title: 'AI 正在进行全片策略分析', desc: '真实视频已下载，正在提取全片结构和脚本细节。短视频通常几十秒，长视频需要数分钟。', spinning: true, failed: false };
  }
  return { title: '等待自动策略分析', desc: '后台会先获取真实视频，再自动完成全片策略分析；等待期间先展示基础资料，不存入素材库。', spinning: true, failed: false };
}

export function needsVideoEnhancement(video: TrendVideo): boolean {
  const analysis = video.aiAnalysis;
  if (!analysis?.gemini) return true;
  if (analysis.analysisMode === 'exact' && hasCompleteGeminiAnalysis(analysis.gemini)) return false;
  const analyzedUntil = (analysis.gemini.scriptDetails15s || []).reduce((max, item) => {
    const numbers = String(item.time || '').match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
    return Math.max(max, numbers[1] ?? numbers[0] ?? 0);
  }, 0);
  if (video.duration > 0 && analyzedUntil > 0 && analyzedUntil + 1 < video.duration) return true;
  return analysis.analysisSource === 'metadata-fallback' ||
    analysis.analysisQuality === 'metadata' ||
    analysis.downloadStatus === 'ops_queued';
}

export function cleanAnalysisText(value: unknown): string {
  return String(value || '')
    .replace(/基础(?:资料|信息)推断[:：]\s*/g, '')
    .replace(/基于标题、标签、平台、热度和时长推断[:：]?\s*/g, '')
    .replace(/真实视频分析完成后会回填/g, '视频级分析会补充')
    .trim();
}

function cleanAnalysisTimestamp(value: unknown): string {
  const text = String(value || '').trim();
  const numbers = Array.from(text.matchAll(/(\d+(?:\.\d+)?)/g)).map(match => Number(match[1]));
  const clean = (number: number) => number.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  if (numbers.length >= 2) return `${clean(numbers[0]!)}-${clean(numbers[1]!)}s`;
  if (numbers.length === 1) return `${clean(numbers[0]!)}s`;
  return text;
}

function isUnusableAnalysisText(value: unknown): boolean {
  const text = cleanAnalysisText(value);
  return !text
    || /字幕待|待 Gemini|待真实视频|视频下载并分析完成后|视频级分析会补充|无法确认|分析超时|待人工复核|降级结果/i.test(text);
}

function cleanScriptDetailField(value: unknown, field: 'visual' | 'subtitle' | 'audio' | 'note'): string {
  const text = cleanAnalysisText(value);
  if (!text || isUnusableAnalysisText(text)) return '';
  if (field === 'subtitle' && /按画面\/字幕推断|可能有|可能是|疑似|口播|台词|@|#|‘|’|"|"/i.test(text)) return '';
  if (field === 'audio' && /按画面\/字幕推断|可能有|可能是|疑似|台词|@|#|‘|’|"|"/i.test(text)) return '';
  if (field === 'note' && /可能有|可能是|疑似.*(?:台词|提示)|@|#|‘|’|"|"/i.test(text)) return '';
  return text;
}

export function hasCompleteGeminiAnalysis(gemini?: GeminiVideoAnalysis): boolean {
  if (!gemini) return false;
  const firstTen = gemini.firstTenSeconds || {};
  const firstTenCount = [firstTen.atmosphere, firstTen.audioVisual, firstTen.camera, firstTen.visuals, firstTen.voiceMusic]
    .filter(value => cleanAnalysisText(value).length > 0)
    .length;
  const coarseCount = Array.isArray(gemini.coarseStructure)
    ? gemini.coarseStructure.filter(item => cleanAnalysisText(item.description || item.desc || item.frame).length > 0).length
    : 0;
  const detailCount = Array.isArray(gemini.scriptDetails15s)
    ? gemini.scriptDetails15s.filter(item => cleanAnalysisText(item.visual || item.subtitle).length > 0).length
    : 0;

  return cleanAnalysisText(gemini.theme).length > 0
    && firstTenCount >= 3
    && coarseCount >= 2
    && detailCount >= 2;
}

interface AnalysisQualityGate {
  ready: boolean;
  reason: string;
  requiredFrames: number;
  actualFrames: number;
}

export function directorReviewAction(reason: string): { gap: string; next: string } {
  if (/^repeated_full_dialogue_/.test(reason)) return { gap: '多段分镜重复了整段口播', next: '按原片逐句校时；只将有时间码证据的句子放入对应分镜。' };
  if (/^repeated_visual_description_/.test(reason)) return { gap: '多段分镜的画面描述重复', next: '对照每段切片与首帧，重写该镜头实际人物、动作、场景和目的。' };
  if (/^sub_200ms_shots_/.test(reason)) return { gap: '存在不足 0.2 秒的闪帧', next: '保留闪帧作证据；按 0–1 秒连续动作核对快速靠近与敲门手势，动作允许跨视觉切点。' };
  if (/^opening_hook_no_substantive_shot$/.test(reason)) return { gap: '开场截流动作尚未定位', next: '复核 0–1 秒连续动作，排除不足 0.2 秒的闪帧后标记快速靠近与敲门手势。' };
  if (/^opening_hook_(insufficient_temporal_observations|motion_incomplete|observation_uncertainty)$/.test(reason)) return { gap: '钩子的连续动作证据不足', next: '逐帧复核首帧、手势、人物距离与动作先后，再写复刻脚本。' };
  if (reason === 'hook_action_unverified') return { gap: '钩子动作尚未逐帧确认', next: '核对 0–1 秒快速靠近、敲门手势和转入口播的时间点。' };
  if (reason === 'hook_script_incomplete') return { gap: '钩子八项脚本未完成', next: '逐项核对运镜、画面、出镜主体、配乐、配音、音效、主体话术和主体动作；确实没有的填写“无”。' };
  if (/^opening_frame_/.test(reason)) return { gap: '首帧场景与分镜描述冲突', next: '对照原片首帧和切片，确认场景与人物后更正镜头说明。' };
  if (/^uncovered_scene_cuts_/.test(reason)) return { gap: '原片切点没有被分镜边界覆盖', next: '按真实画面切点调整分镜起止时间，并核对整片无缺口。' };
  if (/^unverified_shots_/.test(reason)) return { gap: '多段镜头仍未核实', next: '逐镜核对画面、口播、首帧及素材用途；有产品宣称的镜头还需核实企业事实。' };
  if (/^missing_exact_shots$/.test(reason)) return { gap: '没有可用的精确分镜', next: '重新提取分镜切片、首帧和全片时间线后再分析。' };
  if (/presenter|identity|authorization|rights/i.test(reason)) return { gap: '人物资产或使用权待核验', next: '核对当前企业已录入的销售人物资产、发布状态、授权范围和版本。' };
  return { gap: '存在尚未归类的分析缺口', next: `编导复核原始诊断 ${reason}，补齐对应视频证据后重新验收。` };
}

export function exactAnalysisQuality(video: TrendVideo): AnalysisQualityGate {
  const payload = video.aiAnalysis;
  const details = payload?.gemini?.scriptDetails15s || [];
  const duration = Math.max(0, Number(video.duration || 0));
  const requiredFrames = 1;
  const parsed = details.map(item => {
    const values = String(item.time || item.timestamp || '').match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
    return { item, start: values[0], end: values[1] };
  });
  const valid = parsed.filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end! > item.start!);
  const progress = payload?.analysisProgress;

  if (progress?.stage === 'failed') return { ready: false, reason: `精确分析失败：${progress.currentStep || '后台未提供失败原因'}`, requiredFrames, actualFrames: valid.length };
  if (progress?.stage === 'paused') return { ready: false, reason: `精确分析已暂停：${progress.currentStep || '进度已保留'}`, requiredFrames, actualFrames: valid.length };
  if (progress?.stage === 'cancelled') return { ready: false, reason: '精确分析已取消，可重新提交', requiredFrames, actualFrames: valid.length };
  if (analysisProgressIsActive(progress)) return { ready: false, reason: progress?.currentStep || '全片精确分析正在进行中', requiredFrames, actualFrames: valid.length };
  if (payload?.videoLevelFailureStatus || payload?.analysisError || ['failed', 'video_failed', 'analysis_retryable', 'paused', 'cancelled'].includes(String(payload?.geminiStatus || ''))) return { ready: false, reason: '精确分析未完成或已失败，请重试', requiredFrames, actualFrames: valid.length };
  if (payload?.requestedAnalysisMode === 'exact' && payload?.geminiStatus !== 'analyzed') return { ready: false, reason: '全片精确分析正在排队或生成中', requiredFrames, actualFrames: valid.length };
  if (payload?.analysisMode !== 'exact') return { ready: false, reason: '当前仅有策略级分析，需先完成全片精确分析', requiredFrames, actualFrames: valid.length };
  if (valid.length < requiredFrames) return { ready: false, reason: '缺少可用的实际画面分镜', requiredFrames, actualFrames: valid.length };
  if (valid.some(({ item }) => isUnusableAnalysisText(item.visual))) return { ready: false, reason: '存在不可用分镜，请重试精确分析', requiredFrames, actualFrames: valid.length };
  if (!Number.isFinite(video.duration) || video.duration <= 0) return { ready: false, reason: '原片时长尚未确认，无法核对分镜是否覆盖整片', requiredFrames, actualFrames: valid.length };
  const benchmark = buildBenchmarkAnalysis({ analysis: payload, videoId: video.recordId || video.id, duration });
  const admission = productionReferenceAdmission(benchmark);
  if (!admission.ready) {
    const visible = admission.blockers.slice(0, 3);
    const remaining = admission.blockers.length - visible.length;
    return { ready: false, reason: `编导交接待复核：${visible.join('；')}${remaining > 0 ? `；另有 ${remaining} 项待复核` : ''}`, requiredFrames, actualFrames: valid.length };
  }
  if (benchmark.totalShots === null || benchmark.shots.some(shot => shot.granularity !== 'shot')) return { ready: false, reason: '当前只有观察片段，尚无可用于创作的导演级逐镜切点', requiredFrames, actualFrames: valid.length };
  if (!benchmark.timelineComplete || benchmark.shots.some(shot => shot.start === null || shot.end === null)) return { ready: false, reason: '导演级分镜的时间线未完整覆盖原片，需重新分析切点', requiredFrames, actualFrames: valid.length };
  if (benchmark.shots.some(shot => isUnusableAnalysisText(shot.visual))) return { ready: false, reason: '导演级分镜仍有不可用画面描述，需重新分析', requiredFrames, actualFrames: valid.length };
  return { ready: true, reason: '精确分析已通过实际画面时间线校验', requiredFrames, actualFrames: valid.length };
}

export function inspirationCreationShotPreflight(video: TrendVideo): { ready: boolean; reason: string } {
  if (video.contentFormat === 'image') return { ready: true, reason: '' };
  const quality = exactAnalysisQuality(video);
  return { ready: quality.ready, reason: quality.ready ? '' : quality.reason };
}

export function inspirationCreationAvailability(video: TrendVideo): { ready: boolean; reason: string } {
  if (video.id.startsWith('material-')) return { ready: true, reason: '' };
  if (video.contentFormat === 'image') {
    const evidence = video.aiAnalysis?.imageEvidence;
    const ready = evidence?.status === 'analyzed' && Boolean(evidence.observedFacts?.length);
    return ready
      ? { ready: true, reason: '' }
      : { ready: false, reason: video.aiAnalysis?.imageAnalysisStatus === 'failed' || video.status === 'failed' ? '图文分析失败，请重新分析后再开始创作。' : '图文证据尚未完成，请等待或重新分析后再开始创作。' };
  }
  return inspirationCreationShotPreflight(video);
}

export function isDisplayableVideoAnalysis(analysis?: VideoAnalysisPayload, status?: TrendVideo['status']): boolean {
  // A manually uploaded benchmark remains part of the user's library even
  // when exact analysis fails. Hiding it made a deduplicated re-upload look
  // lost and also removed the only UI from which the Director run could be
  // inspected or retried.
  if (analysis?.usage === 'reference_only'
    && Boolean(analysis.contentSha256)
    && analysis.userVisible !== false) return true;
  if (status === 'failed') return analysis?.contentFormat === 'image';
  // Collection results are useful before full-video analysis completes. The
  // card can already show verified platform metadata and a processing state.
  // Only terminal media/analysis failures should be removed from the feed.
  if (!analysis) return true;
  const geminiStatus = String(analysis.geminiStatus || '');
  const downloadStatus = String(analysis.downloadStatus || '');
  return downloadStatus !== 'failed'
    && downloadStatus !== 'manual_required'
    && geminiStatus !== 'video_failed';
}


export function isDisplayableForFormat(video: TrendVideo, contentFormat: ContentFormat): boolean {
  const sourceUrl = video.sourceUrl || '';
  if (contentFormat === 'image') return video.contentFormat === 'image'
    && Boolean(video.thumbnail)
    && Boolean(sourceUrl)
    && !/\/(?:search|explore\/tags)\b/i.test(sourceUrl)
    && (video.platform !== 'instagram' || /\/p\//i.test(sourceUrl));
  const hasRealSource = /^https?:\/\//i.test(sourceUrl)
    || Boolean(video.videoUrl)
    || video.id.startsWith('material-');
  return video.contentFormat === 'video'
    && hasRealSource
    && isDisplayableVideoAnalysis(video.aiAnalysis, video.status);
}

export function getAnalysis(video: TrendVideo): ScriptAnalysis | null {
  const gemini = video.aiAnalysis?.gemini;
  if (!gemini) return null;
  const hooks = Array.isArray(gemini.hooks) ? gemini.hooks.map(cleanAnalysisText).filter(Boolean) : [];
  const sellingPoints = Array.isArray(gemini.sellingPoints) ? gemini.sellingPoints.map(cleanAnalysisText).filter(Boolean) : [];
  const isMetadataFallback = video.aiAnalysis?.analysisSource === 'metadata-fallback' || video.aiAnalysis?.analysisQuality === 'metadata';
  const strategyAnalysisRunning = ['queued', 'downloading', 'analyzing', 'download_retrying', 'ops_queued']
    .includes(String(video.aiAnalysis?.downloadStatus || ''));
  const structure = buildCoarseStructure(gemini, video);
  return {
    videoType: isMetadataFallback
      ? (strategyAnalysisRunning ? '基础分析 · 自动策略分析中' : '基础资料拆解')
      : gemini.recommendedScriptType === 'storyboard' ? '分镜评测型' : '口播转化型',
    structure,
    firstTenSeconds: buildFirstTenSecondInsights(gemini, video, hooks, sellingPoints),
    scriptSummary15s: buildScriptSummary15s(gemini, video, sellingPoints),
    scriptDetails15s: buildScriptDetails15s(gemini, video, structure),
    baseRequirements: buildBaseRequirements(gemini, video),
    referenceHighlights: [
      gemini.theme ? `主题：${cleanAnalysisText(gemini.theme)}` : '',
      gemini.mood ? `情绪：${cleanAnalysisText(gemini.mood)}` : '',
      ...hooks.slice(0, 2).map(point => `注意力入口：${point}`),
      ...sellingPoints.slice(0, 4).map(point => `可复用爆点：${point}`),
    ].filter(Boolean),
    adaptTip: structure.length
      ? `生成脚本时优先复用「${structure.slice(0, 3).map(step => step.desc).join(' → ')}」的节奏，并把产品卖点放进同一信息密度。`
      : 'Gemini 尚未返回可复用结构',
    emotion: cleanAnalysisText(gemini.mood) || (isMetadataFallback ? '基础分析' : '真实分析'),
    infoSpeed: video.duration > 90 ? '中密度' : '高密度',
  };
}

export function imageAnalysisShell(video: TrendVideo): ScriptAnalysis {
  return {
    videoType: '竞品公开图文', structure: [], firstTenSeconds: [],
    scriptSummary15s: { visualStyle: '', coreEmotion: '', competitors: [] },
    scriptDetails15s: [], baseRequirements: '', referenceHighlights: [], adaptTip: '', emotion: '', infoSpeed: '',
  };
}

function buildBaseRequirements(gemini: GeminiVideoAnalysis, video: TrendVideo): string {
  const explicit = cleanAnalysisText(gemini.baseRequirements);
  if (explicit) return explicit;
  const summary = gemini.scriptSummary15s || {};
  const mood = cleanAnalysisText(gemini.mood) || cleanAnalysisText(summary.coreEmotion) || '好奇、信任、种草';
  const style = cleanAnalysisText(summary.visualStyle) || (video.platform === 'youtube' ? '真人写实评测风格' : '真人社媒写实风格');
  const scene = cleanAnalysisText(gemini.theme) || video.title;
  return `情绪氛围：${mood}；光影：清晰明亮，突出人物、产品和使用效果；全片主要场景：围绕「${scene}」展开真人口播、产品实拍、使用演示和结果对比；质感：${style}，产品包装、材质、肤感/触感/功能细节要拍清楚；基础要求：强反转开头，真人口播，卡点剪辑，特效拉满，产品质感突出。`;
}

function buildScriptSummary15s(gemini: GeminiVideoAnalysis, video: TrendVideo, sellingPoints: string[]): ScriptSummary15s {
  const summary = gemini.scriptSummary15s || {};
  const competitors = Array.isArray(summary.competitors)
    ? summary.competitors.map(String).filter(Boolean)
    : sellingPoints.filter(point => /brand|品牌|竞品|vs|对比/i.test(point)).slice(0, 3);
  return {
    visualStyle: cleanAnalysisText(summary.visualStyle) || (video.platform === 'youtube' ? '真人写实评测风格' : '真人社媒写实风格'),
    coreEmotion: cleanAnalysisText(summary.coreEmotion) || cleanAnalysisText(gemini.mood) || '好奇、信任、种草',
    competitors: competitors.map(cleanAnalysisText).filter(Boolean),
  };
}

function buildScriptDetails15s(gemini: GeminiVideoAnalysis, video: TrendVideo, structure: StructureStep[]): ScriptDetail15s[] {
  const details = Array.isArray(gemini.scriptDetails15s) ? gemini.scriptDetails15s : [];
  const normalized = details.map((item, index) => {
    const visual = cleanScriptDetailField(item.visual, 'visual');
    const subtitle = cleanScriptDetailField(item.subtitle, 'subtitle');
    const audio = cleanScriptDetailField(item.audio, 'audio');
    const note = cleanScriptDetailField(item.note, 'note');
    if (!visual && !subtitle) return null;
    return {
      time: cleanAnalysisTimestamp(item.time || item.timestamp || `${Math.max(0.2, index * 1.5).toFixed(1)}s`),
      environment: cleanAnalysisText(item.environment) || '真实产品/人物口播场景',
      shot: String(item.shot || '中近景'),
      camera: String(item.camera || '固定镜头'),
      angle: cleanAnalysisText(item.angle),
      composition: cleanAnalysisText(item.composition),
      visual: visual || `画面承接「${video.title}」的核心信息。`,
      subtitle,
      audio,
      note: note || undefined,
      purpose: cleanAnalysisText(item.purpose), dialogue: cleanAnalysisText(item.dialogue), onScreenText: cleanAnalysisText(item.onScreenText),
      ambientSound: cleanAnalysisText(item.ambientSound), bgm: cleanAnalysisText(item.bgm), soundEffects: Array.isArray(item.soundEffects) ? item.soundEffects.map(cleanAnalysisText).filter(Boolean) : [],
      beats: Array.isArray(item.beats) ? item.beats : [], persistentState: cleanAnalysisText(item.persistentState),
      startState: cleanAnalysisText(item.startState), endState: cleanAnalysisText(item.endState), transitionToNext: cleanAnalysisText(item.transitionToNext),
      backgroundPriority: item.backgroundPriority, depthOfField: item.depthOfField, authenticity: cleanAnalysisText(item.authenticity),
      estimatedSpeechDuration: typeof item.estimatedSpeechDuration === 'number' ? item.estimatedSpeechDuration : undefined, dialogueFits: item.dialogueFits,
      confidence: typeof item.confidence === 'number' ? item.confidence : undefined, needsReview: Boolean(item.needsReview),
      materialType: item.materialType, narrativeRole: item.narrativeRole, classificationEvidence: item.classificationEvidence,
      materialEvidence: item.materialEvidence,
      viralPotential: item.viralPotential && typeof item.viralPotential === 'object' ? {
        score: typeof item.viralPotential.score === 'number' ? item.viralPotential.score : undefined,
        mechanisms: Array.isArray(item.viralPotential.mechanisms) ? item.viralPotential.mechanisms.map(String).filter(Boolean) : [],
        whyEffective: cleanAnalysisText(item.viralPotential.whyEffective),
      } : undefined,
    };
  }).filter(Boolean) as ScriptDetail15s[];
  if (normalized.length) {
    return normalized.map((detail, index) => {
      const currentValues = Array.from(detail.time.matchAll(/(\d+(?:\.\d+)?)/g)).map(match => Number(match[1]));
      if (currentValues.length >= 2) return detail;
      const start = Math.max(0, currentValues[0] ?? (index === 0 ? 0 : parseFrameTimeRange(normalized[index - 1]!.time).end));
      const nextValues = Array.from(String(normalized[index + 1]?.time || '').matchAll(/(\d+(?:\.\d+)?)/g)).map(match => Number(match[1]));
      const nextStart = nextValues[0];
      const videoEnd = Number(video.duration) || 0;
      const end = nextStart != null && nextStart > start
        ? nextStart
        : videoEnd > start ? Math.min(videoEnd, start + 3) : start + 0.5;
      return { ...detail, time: `${Number(start.toFixed(1))}-${Number(end.toFixed(1))}s` };
    });
  }

  const fullDuration = Math.max(1, Number(video.duration) || 15);
  const source = structure.length ? structure : splitStructure(video.title, fullDuration);
  return source.map((step, index) => ({
    time: cleanAnalysisTimestamp(`${index * 3}-${Math.min(index * 3 + 3, fullDuration)}s`),
    environment: '真实产品/人物口播场景',
    shot: index === 0 ? '特写' : '中近景',
    camera: index === 0 ? '固定镜头' : '轻微推近',
    visual: `画面围绕「${cleanAnalysisText(step.desc)}」展开，视频级分析会补充人物、产品、动作和场景细节。`,
    subtitle: `字幕/口播围绕「${video.title}」强化当前信息点。`,
    audio: video.platform === 'youtube' ? '配音解释为主，背景音乐轻量铺底。' : '社媒节奏 BGM，配合字幕快速推进。',
  }));
}

function buildCoarseStructure(gemini: GeminiVideoAnalysis, video: TrendVideo): StructureStep[] {
  const frames = Array.isArray(gemini.coarseStructure) ? gemini.coarseStructure : [];
  const normalized = frames.map((frame, index) => {
    const desc = cleanAnalysisText(frame.description || frame.desc || frame.frame);
    if (!desc) return null;
    return {
      time: String(frame.time || `${index * 3}-${(index + 1) * 3}s`),
      label: String(frame.label || (index === 0 ? '开场画面' : `粗略帧 ${index + 1}`)),
      desc,
    };
  }).filter(Boolean) as StructureStep[];
  if (normalized.length) return normalized.slice(0, 10);
  return splitStructure(gemini.structure, video.duration);
}

function splitStructure(structure?: string, duration = 30): StructureStep[] {
  const raw = (structure || '').trim();
  if (!raw) return [{ time: '待分析', label: 'Gemini', desc: '视频下载并分析完成后显示真实结构' }];
  const parts = raw.split(/\s*(?:→|->|,|，|;|；)\s*/).filter(Boolean);
  const frameCount = Math.min(10, Math.max(3, Math.ceil(Math.min(duration || 30, 30) / 3)));
  const source = parts.length ? parts : [raw];
  return Array.from({ length: Math.min(frameCount, Math.max(source.length, 3)) }, (_, index) => {
    const desc = source[index] || source[source.length - 1] || raw;
    return {
      time: `${index * 3}-${(index + 1) * 3}s`,
      label: index === 0 ? '开场画面' : `粗略帧 ${index + 1}`,
      desc,
    };
  });
}

function buildFirstTenSecondInsights(
  gemini: GeminiVideoAnalysis,
  video: TrendVideo,
  hooks: string[],
  sellingPoints: string[],
): FirstTenSecondInsight[] {
  const firstTen = gemini.firstTenSeconds || {};
  const fallbackTheme = cleanAnalysisText(gemini.theme) || video.title;
  const fallbackMood = cleanAnalysisText(gemini.mood) || '待 Gemini 识别';
  const firstHook = hooks[0] || fallbackTheme;
  const primaryPoint = sellingPoints[0] || video.tags[0] || fallbackTheme;
  const values: FirstTenSecondInsight[] = [
    {
      dimension: '氛围',
      detail: firstTen.atmosphere || `前 10 秒围绕「${fallbackTheme}」建立观看期待，整体情绪倾向为「${fallbackMood}」。`,
    },
    {
      dimension: '音画',
      detail: firstTen.audioVisual || `标题/字幕/画面信息需要快速同屏解释「${firstHook}」，让用户不用等待也能理解看点。`,
    },
    {
      dimension: '运镜',
      detail: firstTen.camera || '建议关注开场是否使用近景、快速切换或手持展示来制造即时感；视频级分析完成后会回填真实运镜细节。',
    },
    {
      dimension: '画面',
      detail: firstTen.visuals || `画面应优先呈现主产品、使用结果或强对比场景，核心视觉承接「${primaryPoint}」。`,
    },
    {
      dimension: '配音配乐',
      detail: firstTen.voiceMusic || `配音/配乐需要匹配「${fallbackMood}」的节奏，前 10 秒内用短句或节拍推动信息密度。`,
    },
  ];
  return values.map(item => ({ ...item, detail: cleanAnalysisText(item.detail) })).filter(item => item.detail);
}
