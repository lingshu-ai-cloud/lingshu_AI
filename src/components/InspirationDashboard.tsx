import InspirationVideoAnalysisTabs from './inspiration/InspirationVideoAnalysisTabs';
import VideoAnalysisProgressPanel, { analysisProgressIsActive } from './inspiration/VideoAnalysisProgressPanel';
import { Alert, Button, Drawer, Input, Modal, Pagination, Segmented, Select, Tabs, Upload as AntUpload } from 'antd';
import LsPageHeader from './ui/LsPageHeader';
import { LsLoadingState, LsMasonryGallery, LsProgressiveMedia } from './ui/LsExperiencePrimitives';
import ReferenceSpeechAlignmentPanel from './inspiration/ReferenceSpeechAlignmentPanel';
import { buildBenchmarkAnalysis } from '../../shared/benchmarkAnalysis';
import MaterialLibraryStatus from './studio/MaterialLibraryStatus';
import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { lsMotion } from '../lib/designTokens';
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion';
import {
  Search, Play, Sparkles, FileText, Layout as LayoutIcon,
  TrendingUp, Clock, Globe, ChevronDown, X, Loader2,
  Check, Copy, ArrowRight, Zap, LayoutGrid, List,
  Lightbulb, Flame, BarChart2, ChevronRight, Film,
  Bookmark, Maximize2, Minimize2, Lock, Upload, Users, Images, Pencil, Trash2, Music2,
  SlidersHorizontal, Package, ScanFace, Star, Eye,
} from 'lucide-react';
import { studioApi, type Material, type MaterialSegment, type VideoGenerationVersion } from '../lib/studioApi';
import type { MaterialLibraryFacets } from '../lib/studioDigitalHuman';
import { authHeader } from '../lib/auth';
import CompetitorAccountsModal from './CompetitorAccountsModal';
import type { Page } from '../App';
import { completeDemoStep, readDemoProgress } from '../lib/demoProgress';
import { SocialPlatformIcon } from './SocialPlatformIcon';
import { useDismissibleLayer } from '../hooks/useDismissibleLayer';
import { useModalFocus } from '../hooks/useModalFocus';
import { updateScriptGapTask, type ScriptGapTask } from '../lib/scriptGapQueue';
import { canProcessVideo, displayDuration, resultEmptyState, trendFromEvidence } from '../lib/inspirationDataQuality';
export { canProcessVideo, displayDuration, resultEmptyState, trendFromEvidence } from '../lib/inspirationDataQuality';
import { useScriptGapTasks } from '../hooks/useScriptGapTasks';
import InspirationEmptyState from './InspirationEmptyState';
import { scoreSocialInspirationCandidate } from '../../shared/socialInspirationStrategy';
import { resumeOrCreateInspirationTask, soleInspirationCreationAccount } from '../lib/socialInspirationTask';
import { useSocialProgram } from '../contexts/SocialProgramContext';
import { VideoCard, VideoListItem } from './InspirationVideoCards';
import { showActionFeedback, showActionSuccess } from '../lib/actionFeedback';
import { resolveInspirationPlaybackUrl } from '../lib/inspirationVideoPlayback';
import type { AccountSpecialRecommendation, ContentFormat, FirstTenSecondInsight, FrameMaterialMatch, GeminiVideoAnalysis, Platform, ScriptAnalysis, ScriptDetail15s, ScriptResultProvenance, ScriptSummary15s, ShootingNeed, StructureStep, TrendVideo, VideoAnalysisPayload } from '../lib/inspirationTypes';
import { socialDiscoveryApi } from '../lib/socialDiscoveryApi';
import { openScriptLibrary } from '../lib/contentActionNavigation';
import type { SocialBusinessModel, SocialDiscoveryScoreDecision, SocialDiscoverySupplyItem } from '../../shared/contracts/socialContentWorkflow';
import { MATERIAL_SOURCE_LABELS, MATERIAL_THEME_LABELS, materialPrimaryThemeOf, materialSourceCategoryOf, materialThemeTagsOf } from '../../shared/materialTaxonomy';
import MaterialTaxonomyFilters, { type MaterialSourceFilter, type MaterialThemeFilter } from './material-library/MaterialTaxonomyFilters';

// ── Types ─────────────────────────────────────────────────────────────────────
type ScriptType = 'voiceover' | 'storyboard';
type SortMode = 'heat' | 'crawlTime';
type InspirationInnerView = 'inspiration' | 'accounts' | 'library' | 'shooting';
type CrawlTimeRange = 'all' | 'today' | '7d' | '30d';
type MaterialIndustryFilter = 'all' | 'beauty_skincare' | 'universal_manufacturing' | 'apparel_textile' | 'metalworking';
type MaterialApplicabilityFilter = 'all' | 'universal' | 'cross_industry' | 'industry_specific';
type MaterialOrientationFilter = 'all' | 'vertical' | 'horizontal';
type MaterialTypeFilter = 'all' | 'video' | 'image' | 'audio';
type FavoriteFilter = 'all' | 'favorite';
export type MaterialAssetTab = 'enterprise' | 'ai' | 'cloud';
type DiscoveryDecisionFilter = 'all' | SocialDiscoveryScoreDecision;
type BusinessModelFilter = 'all' | SocialBusinessModel;

// The inspiration inventory is intentionally fetched in one tenant-scoped page.
// A smaller page made the tab count look like missing content after client-side
// quality checks removed non-video records from that page.
const INSPIRATION_PAGE_SIZE = 100;
const MATERIAL_LIBRARY_PAGE_SIZE = 20;

const MATERIAL_PRODUCT_ALL = '__all_products__';
const MATERIAL_PRODUCT_COMMON = '__enterprise_common__';
const MATERIAL_PRODUCT_LINKED_REF = '__linked_product_ref__';
const ENTERPRISE_COMMON_MATERIAL_TAG = 'enterprise_common';

export type MaterialLibraryEntryContext = {
  openLibrary: boolean;
  productId: string;
  productRef: string;
};

type InspirationReferenceTarget = {
  referenceId: string;
  sourceUrl: string;
  title: string;
  platform: string;
  thumbnailUrl: string;
  duration: number;
  benchmarkAnalysis?: VideoAnalysisPayload['benchmarkAnalysis'];
};

function normalizedReferenceText(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function normalizedReferenceUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, '')}${url.pathname}`.replace(/\/$/, '').toLowerCase();
  } catch {
    return value.trim().replace(/^https?:\/\/(?:www\.)?/i, '').replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
  }
}

function videoMatchesReference(video: TrendVideo, target: InspirationReferenceTarget) {
  const normalizedId = target.referenceId.replace(/^crawl-/, '');
  const targetUrl = normalizedReferenceUrl(target.sourceUrl);
  const videoUrl = normalizedReferenceUrl(video.sourceUrl || '');
  const targetTitle = normalizedReferenceText(target.title);
  const videoTitle = normalizedReferenceText(video.title);
  return video.id === target.referenceId
    || video.recordId === normalizedId
    || Boolean(targetUrl && videoUrl && targetUrl === videoUrl)
    || Boolean(targetTitle && videoTitle && (targetTitle === videoTitle || targetTitle.includes(videoTitle) || videoTitle.includes(targetTitle)));
}

function parseInspirationReferenceTarget(input: unknown): InspirationReferenceTarget | null {
  if (!input || typeof input !== 'object') return null;
  const detail = input as Record<string, unknown>;
  const reference = detail.inspirationReference && typeof detail.inspirationReference === 'object'
    ? detail.inspirationReference as Record<string, unknown>
    : {};
  const businessRef = detail.businessRef && typeof detail.businessRef === 'object'
    ? detail.businessRef as Record<string, unknown>
    : {};
  const referenceId = String(reference.referenceId || businessRef.referenceId || '').trim();
  const sourceUrl = String(reference.sourceUrl || '').trim();
  const title = String(reference.title || '').trim();
  const platform = String(reference.platform || '').trim().toLowerCase();
  const thumbnailUrl = String(reference.thumbnailUrl || '').trim();
  const duration = Math.max(0, Number(reference.duration || 0));
  const benchmarkAnalysis = reference.benchmarkAnalysis && typeof reference.benchmarkAnalysis === 'object'
    ? reference.benchmarkAnalysis as VideoAnalysisPayload['benchmarkAnalysis']
    : undefined;
  return referenceId || sourceUrl || title
    ? { referenceId, sourceUrl, title, platform, thumbnailUrl, duration, benchmarkAnalysis }
    : null;
}

function initialInspirationReferenceTarget(): InspirationReferenceTarget | null {
  if (typeof window === 'undefined') return null;
  return parseInspirationReferenceTarget(window.history.state?.productionDetail);
}

export function parseMaterialLibraryEntry(search: string): MaterialLibraryEntryContext {
  const params = new URLSearchParams(search);
  return {
    openLibrary: params.get('view') === 'library',
    productId: String(params.get('productId') || '').trim(),
    productRef: String(params.get('productRef') || '').trim(),
  };
}

function initialMaterialLibraryEntry(): MaterialLibraryEntryContext {
  return typeof window === 'undefined'
    ? { openLibrary: false, productId: '', productRef: '' }
    : parseMaterialLibraryEntry(window.location.search);
}

function initialMaterialTaxonomyFilters(): { source: MaterialSourceFilter; theme: MaterialThemeFilter } {
  if (typeof window === 'undefined') return { source: 'all', theme: 'all' };
  const params = new URLSearchParams(window.location.search);
  const source = params.get('source') || 'all';
  const theme = params.get('theme') || 'all';
  return {
    source: source === 'all' || Object.hasOwn(MATERIAL_SOURCE_LABELS, source) ? source as MaterialSourceFilter : 'all',
    theme: theme === 'all' || Object.hasOwn(MATERIAL_THEME_LABELS, theme) ? theme as MaterialThemeFilter : 'all',
  };
}

export function isEnterpriseCommonMaterial(material: Pick<Material, 'tags'>): boolean {
  return String(material.tags || '').split(/[,，]/).map(tag => tag.trim()).includes(ENTERPRISE_COMMON_MATERIAL_TAG);
}

export function materialOwnershipTags(tags: string | undefined, productId: string): string {
  const values = String(tags || '').split(/[,，]/).map(tag => tag.trim()).filter(Boolean)
    .filter(tag => tag !== ENTERPRISE_COMMON_MATERIAL_TAG);
  if (!productId) values.push(ENTERPRISE_COMMON_MATERIAL_TAG);
  return Array.from(new Set(values)).join(', ');
}

export function visibleMaterialTags(tags: string | undefined): string {
  return String(tags || '').split(/[,，]/).map(tag => tag.trim()).filter(Boolean)
    .filter(tag => tag !== ENTERPRISE_COMMON_MATERIAL_TAG).join(', ');
}

type MaterialSemanticSource = Pick<Material, 'productName' | 'tags' | 'visualObservations' | 'scriptAnalysis'>;

const HIDDEN_MATERIAL_KEYWORDS = new Set([
  'vertical', 'horizontal', '9:16', '16:9', 'image', 'video', 'audio',
  'hook', 'proof', 'support', 'transition', 'closing', 'explanation', 'demonstration',
  'local_upload', 'official_import', 'licensed_stock', 'seedance', 'gemini',
]);

function compactMaterialKeyword(value: unknown): string {
  const normalized = String(value || '').trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (!normalized || HIDDEN_MATERIAL_KEYWORDS.has(normalized.toLowerCase())) return '';
  return normalized.replace(/[。；;，,].*$/, '').slice(0, 24).trim();
}

/** One user-facing semantic line for a My Materials card; never exposes IDs or analysis state. */
export function materialSemanticLabel(material: MaterialSemanticSource): string {
  const productName = String(material.productName || '').trim();
  if (productName) return `产品：${productName}`;

  const manualKeywords = visibleMaterialTags(material.tags).split(/[,，]/)
    .map(compactMaterialKeyword).filter(Boolean);
  const analysis = material.scriptAnalysis;
  const analyzedKeywords = [
    ...(analysis?.directorIndex?.subjects || []),
    ...(analysis?.directorIndex?.actions || []),
    ...(analysis?.directorIndex?.environments || []),
    ...(material.visualObservations || []),
  ].map(compactMaterialKeyword).filter(Boolean);
  const keywords = [...new Set(manualKeywords.length ? manualKeywords : analyzedKeywords)].slice(0, 3);
  return keywords.length ? `内容：${keywords.join(' · ')}` : '内容：待补充说明';
}

export function materialMatchesProductFilter(
  material: Pick<Material, 'productId' | 'productName' | 'tags'>,
  filter: { enabled: boolean; productId: string; productRef: string },
): boolean {
  if (!filter.enabled) return true;
  if (filter.productId) {
    return material.productId === filter.productId
      || (!material.productId && Boolean(filter.productRef) && material.productName === filter.productRef);
  }
  if (filter.productRef) return material.productName === filter.productRef;
  return !material.productId && isEnterpriseCommonMaterial(material);
}

const MATERIAL_INDUSTRY_LABELS: Record<string, string> = {
  all: '全部行业', beauty_skincare: '美妆护肤', universal_manufacturing: '通用制造',
  apparel_textile: '服装纺织', metalworking: '金属加工',
};
const MATERIAL_FUNCTION_LABELS: Record<string, string> = {
  all: '全部镜头功能', application: '使用/涂抹', texture_demo: '质地展示', product_demo: '产品展示',
  device_demo: '设备演示', ingredient_visual: '成分视觉', factory_proof: '工厂背书', production: '生产过程',
  equipment_demo: '设备展示', factory_exterior: '工厂外景', worker_operation: '工人操作',
  quality_control: '质检/检修', packaging: '包装交付', warehouse: '仓储物流', manufacturing_process: '加工过程',
  equipment_inspection: '设备检修', logistics_fulfillment: '物流履约', treatment_experience: '护理体验', usage_setup: '使用准备',
};
const MATERIAL_APPLICABILITY_LABELS: Record<string, string> = {
  all: '全部适用范围', universal: '通用素材', cross_industry: '跨行业素材', industry_specific: '行业专属',
};
/** Product-facing ownership groups. Upload entry only affects traceability, never ownership. */
export function materialAssetTabOf(material: Pick<Material, 'sourceType' | 'folder' | 'scope'>): MaterialAssetTab {
  const source = String(material.sourceType || '').toLowerCase();
  if (material.scope === 'shared' || material.folder === 'hot' || /official|viral|licensed[-_ ]?stock|cloud/.test(source)) return 'cloud';
  if (/seedance|seedream|gemini|qwen|ai[-_ ]?generated|aigc/.test(source)) return 'ai';
  return 'enterprise';
}

export function materialAssetBadge(material: Pick<Material, 'sourceType' | 'folder' | 'scope'>): { label: string; className: string } {
  const category = materialSourceCategoryOf(material);
  if (category === 'official_import') return { label: '官方导入', className: 'bg-orange-50 text-orange-700' };
  if (category === 'user_generated') return { label: '用户生成', className: 'bg-violet-50 text-violet-700' };
  return { label: '本地上传', className: 'bg-sky-50 text-sky-700' };
}

function isFavoriteMaterial(material: Material): boolean {
  return material.pinned === true;
}

const isDemoTrafficStep = () => {
  const progress = readDemoProgress();
  return Boolean(progress.strategy && !progress.traffic);
};

const PLATFORM_META: Record<Exclude<Platform, 'all'>, { label: string; color: string; bg: string }> = {
  tiktok:    { label: 'TikTok',    color: '#fff', bg: '#010101' },
  instagram: { label: 'Instagram', color: '#fff', bg: '#c13584' },
  youtube:   { label: 'YouTube',   color: '#fff', bg: '#ff0000' },
  facebook:  { label: 'Facebook',  color: '#fff', bg: '#1877f2' },
};
const PLATFORM_FALLBACK = { label: 'Unknown', color: '#fff', bg: '#64748b' };
export const getPlatformMeta = (p: string) => PLATFORM_META[p as Exclude<Platform, 'all'>] ?? PLATFORM_FALLBACK;

const PLATFORM_FILTERS: { id: Platform; label: string }[] = [
  { id: 'all',       label: '全部平台' },
  { id: 'youtube',   label: 'YouTube' },
  { id: 'tiktok',    label: 'TikTok' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook',  label: 'Facebook' },
];
const ACTIVE_PLATFORMS: Array<Exclude<Platform, 'all'>> = ['youtube', 'tiktok', 'instagram', 'facebook'];

const LANGUAGES = [
  { code: 'en', label: 'English' }, { code: 'zh', label: '中文' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'es', label: 'Español' }, { code: 'ar', label: 'العربية' },
  { code: 'fr', label: 'Français' }, { code: 'de', label: 'Deutsch' },
  { code: 'pt', label: 'Português' }, { code: 'ru', label: 'Русский' },
  { code: 'ja', label: '日本語' },   { code: 'ko', label: '한국어' },
];

function cleanAnalysisText(value: unknown): string {
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

function hasCompleteGeminiAnalysis(gemini?: GeminiVideoAnalysis): boolean {
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

function exactAnalysisQuality(video: TrendVideo): AnalysisQualityGate {
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
  if (payload?.geminiStatus === 'needs_review' || payload?.analysisQuality === 'video_review_required' || payload?.analysisReviewReasons?.length) {
    const reviewCount = payload?.analysisReviewReasons?.length || 1;
    return { ready: false, reason: `编导交接待复核：${reviewCount} 项镜头证据尚未通过质量校验`, requiredFrames, actualFrames: valid.length };
  }
  if (payload?.videoLevelFailureStatus || payload?.analysisError || ['failed', 'video_failed', 'analysis_retryable', 'paused', 'cancelled'].includes(String(payload?.geminiStatus || ''))) return { ready: false, reason: '精确分析未完成或已失败，请重试', requiredFrames, actualFrames: valid.length };
  if (payload?.requestedAnalysisMode === 'exact' && payload?.geminiStatus !== 'analyzed') return { ready: false, reason: '全片精确分析正在排队或生成中', requiredFrames, actualFrames: valid.length };
  if (payload?.analysisMode !== 'exact') return { ready: false, reason: '当前仅有策略级分析，需先完成全片精确分析', requiredFrames, actualFrames: valid.length };
  if (valid.length < requiredFrames) return { ready: false, reason: '缺少可用的实际画面分镜', requiredFrames, actualFrames: valid.length };
  if (valid.some(({ item }) => isUnusableAnalysisText(item.visual))) return { ready: false, reason: '存在不可用分镜，请重试精确分析', requiredFrames, actualFrames: valid.length };
  if (!Number.isFinite(video.duration) || video.duration <= 0) return { ready: false, reason: '原片时长尚未确认，无法核对分镜是否覆盖整片', requiredFrames, actualFrames: valid.length };
  const benchmark = buildBenchmarkAnalysis({ analysis: payload, videoId: video.recordId || video.id, duration });
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
  if (status === 'failed') return false;
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

function contentFormatOfAnalysis(analysis?: VideoAnalysisPayload): ContentFormat {
  return analysis?.contentFormat === 'image' ? 'image' : 'video';
}

function isDisplayableForFormat(video: TrendVideo, contentFormat: ContentFormat): boolean {
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

function getAnalysis(video: TrendVideo): ScriptAnalysis | null {
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

function imageAnalysisShell(video: TrendVideo): ScriptAnalysis {
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

function summarizeProductInfo(input: string): string {
  const text = input.trim();
  if (!text) return '未选择主推品，请先从企业中心产品中选择或补充产品信息。';
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

function getPrimaryProductLabel(productInfo: string): string {
  const match = productInfo.match(/主推品[:：]\s*([^\n]+)/);
  if (match?.[1]) return match[1].trim();
  return productInfo.trim().split('\n')[0]?.replace(/^[-*\s]+/, '').trim() || '当前主推品';
}

function shortenText(text: string, max = 72): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function tokenizeForMatch(...values: string[]): string[] {
  const stop = new Set(['the', 'and', 'with', 'this', 'that', 'for', 'you', 'your', 'our', '字幕', '画面', '镜头', '固定', '中近景', '特写']);
  return Array.from(new Set(values.join(' ')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .split(/[^a-z0-9\u4e00-\u9fa5]+/)
    .map(item => item.trim())
    .filter(item => item.length > 1 && !stop.has(item))));
}

function shootingSuggestion(detail: ScriptDetail15s): string {
  const text = `${detail.visual} ${detail.subtitle}`.toLowerCase();
  if (/face|脸|skin|肤|acne|dry|保湿|护肤|洁面|妆|唇|lip/.test(text)) {
    return '建议补拍真人上脸/手部使用镜头：自然光，9:16，近景或中近景，动作包含涂抹、展示肤感或前后对比。';
  }
  if (/package|包装|logo|brand|瓶|罐|产品|product|texture|质地/.test(text)) {
    return '建议补拍产品特写：干净桌面，正面包装、Logo、质地挤出/涂抹各一条，保留 2 秒稳定画面方便剪辑。';
  }
  if (/factory|工厂|warehouse|生产|发货|ship|proof|证明/.test(text)) {
    return '建议补拍工厂/履约证明镜头：包装线、库存、打包、发货单或质检动作，横竖屏各留一版。';
  }
  return '建议补拍与该分镜描述一致的 3-5 秒短素材：主体明确、背景干净、动作从静态展示到轻微移动。';
}

function parseFrameTimeRange(time: string): { start: number; end: number; duration: number } {
  const values = Array.from(String(time).matchAll(/(\d+(?:\.\d+)?)/g)).map(match => Number(match[1]));
  const start = Math.max(0, values[0] ?? 0);
  const end = Math.max(start + 3, values[1] ?? start + 3);
  return { start, end, duration: Math.max(1, end - start) };
}

function formatClipTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const min = Math.floor(safe / 60);
  const sec = Math.floor(safe % 60);
  const decimal = Math.round((safe - Math.floor(safe)) * 10);
  return decimal > 0
    ? `${min}:${String(sec).padStart(2, '0')}.${decimal}`
    : `${min}:${String(sec).padStart(2, '0')}`;
}

function viralDnaForFrame(detail: ScriptDetail15s): FrameMaterialMatch['viralDna'] {
  const text = `${detail.visual} ${detail.subtitle} ${detail.onScreenText}`;
  const start = parseFrameTimeRange(detail.time).start;
  const inferredPurpose = /cta|购买|下单|咨询|选择|了解更多|关注/i.test(text) ? '行动号召'
    : /前后|对比|效果|证明|测试|数据|认证/i.test(text) ? '效果/信任证明'
    : /切换|下一款|另一款|系列|多款/i.test(text) ? '产品切换与信息递进'
    : /质地|挤出|涂抹|泡沫|吸收/i.test(text) ? '质地或使用证明'
    : /完整|正面|包装|标签|logo|产品特写/i.test(text) ? '产品揭晓与识别'
    : start <= 3 ? '开场注意力钩子' : '叙事推进';
  const explicitPurpose = detail.purpose?.trim() || '';
  const purpose = !explicitPurpose || /承接叙事信息|叙事推进|画面承接/.test(explicitPurpose) ? inferredPurpose : explicitPurpose;
  const action = detail.beats?.map(item => item.action).filter(Boolean).join(' → ') || detail.visual;
  const authenticityRequired = /真实|不得ai|真人|证明|认证|效果|对比/i.test(`${detail.authenticity} ${purpose}`);
  const mustPreserve = Array.from(new Set([
    action ? `动作/信息节拍：${shortenText(action, 64)}` : '',
    detail.shot ? `景别：${detail.shot}` : '',
    detail.camera ? `运镜：${detail.camera}` : '',
    detail.composition ? `构图：${shortenText(detail.composition, 36)}` : '',
  ].filter(Boolean)));
  const replaceable = [
    /人物|真人|脸|手|person|face|hand/i.test(text) ? '人物换成企业适配的真人/达人' : '',
    /产品|包装|瓶|罐|洁面|cream|cleanser|product/i.test(text) ? '产品与包装换成企业自有产品' : '',
    detail.subtitle || detail.onScreenText ? '原字幕/品牌词改为已核验的企业卖点' : '补充企业品牌视觉，但不改变原镜头节拍',
  ].filter(Boolean);
  return {
    purpose,
    mustPreserve,
    replaceable: Array.from(new Set(replaceable)),
    authenticityRequired,
  };
}

function viralPotentialForFrame(detail: ScriptDetail15s, dna: FrameMaterialMatch['viralDna']): FrameMaterialMatch['viralPotential'] {
  // 模型已按本镜头实际内容给出判断时直接采用。下方关键词计分只是历史记录的兜底——
  // 它基础分 38，命中任一关键词即落进 50-74 的“良”，几乎所有镜头同一档，分不出差别。
  const fromModel = detail.viralPotential;
  if (fromModel && typeof fromModel.score === 'number') {
    return {
      score: Math.max(0, Math.min(100, Math.round(fromModel.score))),
      whyEffective: fromModel.whyEffective || '模型未给出说明。',
      mechanisms: (fromModel.mechanisms || []).slice(0, 4),
    };
  }
  const text = `${dna.purpose} ${detail.visual} ${detail.subtitle} ${detail.onScreenText}`;
  const mechanisms: string[] = [];
  let score = 38;
  if (parseFrameTimeRange(detail.time).start <= 3) { mechanisms.push('前3秒注意力入口'); score += 16; }
  if (/钩子|悬念|遮挡|隐藏|反差|意外|问题/i.test(text)) { mechanisms.push('悬念/反差'); score += 16; }
  if (/揭晓|完整|正面|切换|系列|多款/i.test(text)) { mechanisms.push('渐进揭晓'); score += 12; }
  if (/证明|效果|对比|测试|认证|口碑/i.test(text)) { mechanisms.push('证据前置'); score += 14; }
  if (/cta|购买|咨询|选择|行动号召/i.test(text)) { mechanisms.push('转化承接'); score += 10; }
  if (detail.beats?.length) { mechanisms.push('镜头内节拍'); score += 6; }
  if (detail.onScreenText || detail.subtitle) { mechanisms.push('画面信息同步'); score += 4; }
  const unique = Array.from(new Set(mechanisms));
  const mechanismText = unique.length ? unique.slice(0, 2).join('＋') : '明确主体与信息推进';
  return {
    score: Math.max(0, Math.min(100, score)),
    whyEffective: `${mechanismText}，让观众在${formatClipTime(parseFrameTimeRange(detail.time).duration)}内理解“${dna.purpose}”，并推动继续观看或完成判断。`,
    mechanisms: unique,
  };
}

function replicabilityForFrame(detail: ScriptDetail15s, dna: FrameMaterialMatch['viralDna'], matched: ReturnType<typeof scoreSegmentForFrame> | undefined, status: FrameMaterialMatch['status']): FrameMaterialMatch['replicability'] {
  const text = `${detail.visual} ${detail.subtitle} ${detail.onScreenText} ${detail.authenticity}`;
  const exactProduct = /包装|标签|logo|型号|认证|效果证明|真实产品|不得ai/i.test(text);
  const humanAction = /真人|人物|脸|眼|手部|涂抹|佩戴|口播/i.test(text);
  const aiFeasibility: FrameMaterialMatch['replicability']['aiFeasibility'] = exactProduct ? 'low' : humanAction ? 'medium' : 'high';
  const localCoverage = matched ? Math.max(0, Math.min(100, matched.score)) : 0;
  const blockers = [...(matched?.risks || [])];
  if (!matched && exactProduct) blockers.push('缺少可验证的真实产品片段');
  if (!matched && humanAction) blockers.push('缺少符合动作与景别的真人素材');
  if (dna.authenticityRequired && !matched?.segment.manualConfirmed) blockers.push('真实性要求尚未人工确认');
  const uniqueBlockers = Array.from(new Set(blockers));
  const recommendedExecution: FrameMaterialMatch['replicability']['recommendedExecution'] = matched && status === 'high' ? 'local'
    : matched && aiFeasibility === 'low' ? 'local_plus_reshoot'
    : matched ? 'local_plus_ai'
    : aiFeasibility === 'high' ? 'ai'
    : aiFeasibility === 'medium' ? 'reshoot' : 'reshoot';
  let score = Math.round(localCoverage * .65 + (aiFeasibility === 'high' ? 28 : aiFeasibility === 'medium' ? 18 : 6) + (dna.replaceable.length ? 8 : 0));
  if (dna.authenticityRequired && !matched?.segment.manualConfirmed) score = Math.min(score, 59);
  return { score: Math.max(0, Math.min(100, score)), localCoverage, aiFeasibility, recommendedExecution, blockers: uniqueBlockers.slice(0, 4) };
}

function normalizedOverlap(left: unknown, right: unknown): number {
  const tokens = tokenizeForMatch(String(left ?? ''));
  if (!tokens.length) return 0;
  const haystack = String(right ?? '').toLowerCase();
  return Math.min(100, Math.round(tokens.filter(token => haystack.includes(token)).length / tokens.length * 100));
}

function scoreSegmentForFrame(material: Material, segment: MaterialSegment, detail: ScriptDetail15s, used: Set<string>) {
  const dna = viralDnaForFrame(detail);
  // Older saved segment analyses may predate these array fields. Treat missing
  // evidence as empty instead of crashing the entire inspiration dashboard.
  const functions = Array.isArray(segment.recommendedFunctions) ? segment.recommendedFunctions : [];
  const subjects = Array.isArray(segment.subject) ? segment.subject : [];
  const logoText = Array.isArray(segment.logoText) ? segment.logoText : [];
  const frameText = `${detail.purpose} ${detail.visual} ${detail.beats?.map(item => item.action).join(' ')} ${detail.shot} ${detail.angle} ${detail.composition} ${detail.camera}`;
  const needsProduct = /产品|包装|瓶|罐|质地|product|package|bottle|texture/i.test(frameText);
  const needsPerson = /人物|真人|男性|女性|脸|眼|皮肤|手|person|face|eye|skin|hand/i.test(frameText);
  const risks: string[] = [];
  if (needsProduct && !segment.productVisible) risks.push('硬条件不满足：分镜要求产品，但片段未识别到产品');
  if (needsProduct && /完整|正面|清晰|特写|reveal/i.test(frameText) && segment.productClarity !== 'high') risks.push('硬条件不满足：产品揭晓需要清晰完整产品');
  if (needsPerson && !segment.hasPerson) risks.push('硬条件不满足：分镜要求真人/手部动作');
  if (dna.authenticityRequired && segment.needsReview && !segment.manualConfirmed) risks.push('真实性镜头尚未人工确认');
  if (segment.hasLogo && logoText.length) risks.push(`检测到文字/品牌：${logoText.join('、')}`);

  const functionScore = normalizedOverlap(detail.purpose || '', functions.join(' '));
  const action = normalizedOverlap(`${detail.visual} ${detail.beats?.map(item => item.action).join(' ')}`, segment.action);
  const subject = normalizedOverlap(detail.visual, `${subjects.join(' ')} ${segment.action}`);
  const composition = normalizedOverlap(`${detail.shot} ${detail.angle} ${detail.composition}`, `${segment.shot} ${segment.angle} ${segment.composition}`);
  const camera = normalizedOverlap(detail.camera, segment.camera);
  const frameDuration = parseFrameTimeRange(detail.time).duration;
  const duration = segment.duration >= frameDuration ? 100 : Math.round(segment.duration / frameDuration * 100);
  const quality = Math.max(0, Math.min(100, segment.quality));
  const enterpriseFit = segment.hasLogo ? 30 : segment.productVisible || segment.hasPerson ? 85 : 60;
  let score = Math.round(functionScore * .25 + action * .2 + subject * .15 + composition * .15 + camera * .1 + duration * .05 + enterpriseFit * .05 + quality * .05);
  if (risks.some(item => item.startsWith('硬条件'))) score = Math.min(score, 39);
  if (dna.authenticityRequired && segment.needsReview && !segment.manualConfirmed) score = Math.min(score, 59);
  if (used.has(segment.id)) { score = Math.max(0, score - 10); risks.push('该片段已用于其他分镜'); }
  return {
    material, segment, score,
    scores: { function: functionScore, action, subject, composition, camera, duration, quality, enterpriseFit },
    trim: { start: segment.start, end: segment.end, label: `真实片段 ${formatClipTime(segment.start)}-${formatClipTime(segment.end)}` },
    risks,
  };
}

function matchMaterialsToFrames(details: ScriptDetail15s[], materials: Material[]): FrameMaterialMatch[] {
  const videos = materials.filter(item => item.type === 'video');
  const analyzed = videos.flatMap(material => (material.segments || []).map(segment => ({ material, segment })));
  const used = new Set<string>();
  return details.map(detail => {
    const dna = viralDnaForFrame(detail);
    const viralPotential = viralPotentialForFrame(detail, dna);
    const candidates = analyzed.map(({ material, segment }) => scoreSegmentForFrame(material, segment, detail, used)).sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const status: FrameMaterialMatch['status'] = !analyzed.length && videos.length ? 'pending_analysis'
      : !best || best.score < 40 ? 'missing' : best.score >= 80 ? 'high' : best.score >= 60 ? 'review' : 'adapt';
    const matched = best && best.score >= 40 ? best : undefined;
    if (matched) used.add(matched.segment.id);
    const replicability = replicabilityForFrame(detail, dna, matched, status);
    const decision: FrameMaterialMatch['decision'] = viralPotential.score >= 70 && replicability.score >= 70 ? 'copy_now'
      : viralPotential.score >= 70 && replicability.aiFeasibility === 'high' ? 'ai_generate'
      : viralPotential.score >= 70 ? 'prioritize_reshoot'
      : replicability.score >= 60 ? 'supporting_only' : 'drop';
    return {
      detail,
      material: matched?.material,
      segment: matched?.segment,
      score: matched?.score ?? 0,
      scores: matched?.scores,
      trim: matched?.trim,
      reason: status === 'pending_analysis' ? '现有视频尚未完成片段级分析，不能生成可信截取建议'
        : matched ? `按镜头功能、动作节拍、主体、构图与运镜匹配真实片段` : '没有片段通过硬条件，请补拍或人工选择',
      risks: matched?.risks ?? [],
      suggestion: shootingSuggestion(detail),
      status,
      viralDna: dna,
      viralPotential,
      replicability,
      decision,
    };
  });
}

function frameStartsEarly(time: string): boolean {
  const match = String(time).match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) <= 3 : false;
}

const AI_FEASIBILITY_LABELS: Record<FrameMaterialMatch['replicability']['aiFeasibility'], string> = {
  high: '高', medium: '中', low: '低',
};
function frameScoreGrade(score: number): '优' | '良' | '弱' {
  return score >= 75 ? '优' : score >= 50 ? '良' : '弱';
}

function shootingNeedTitle(detail: ScriptDetail15s): string {
  const text = `${detail.visual} ${detail.subtitle}`.toLowerCase();
  if (/face|脸|skin|肤|acne|dry|保湿|护肤|洁面|妆|唇|lip/.test(text)) return '真人上脸/使用场景';
  if (/package|包装|logo|brand|瓶|罐|产品|product|texture|质地/.test(text)) return '产品包装/质地特写';
  if (/factory|工厂|warehouse|生产|发货|ship|proof|证明/.test(text)) return '工厂履约/发货证明';
  return '通用转场/场景补充';
}

function buildShootingNeeds(videos: TrendVideo[], materials: Material[]): ShootingNeed[] {
  const grouped = new Map<string, ShootingNeed>();
  for (const video of videos) {
    const analysis = getAnalysis(video);
    if (!analysis) continue;
    const matches = matchMaterialsToFrames(analysis.scriptDetails15s, materials);
    for (const match of matches) {
      if (match.material) continue;
      const title = shootingNeedTitle(match.detail);
      const key = `${video.platform}-${title}-${match.suggestion}`;
      const existing = grouped.get(key);
      const sourceTitle = shortenText(video.title, 42);
      if (existing) {
        existing.count += 1;
        if (video.crawledAt && (!existing.createdAt || Date.parse(video.crawledAt) < Date.parse(existing.createdAt))) existing.createdAt = video.crawledAt;
        if (!existing.sourceVideos.includes(sourceTitle)) existing.sourceVideos.push(sourceTitle);
        if (frameStartsEarly(match.detail.time)) existing.priority = '高';
        continue;
      }
      grouped.set(key, {
        id: key,
        createdAt: video.crawledAt,
        priority: frameStartsEarly(match.detail.time) ? '高' : '中',
        title,
        suggestion: match.suggestion,
        count: 1,
        sourceVideos: [sourceTitle],
        platform: video.platform,
        ratio: video.platform === 'youtube' ? '16:9' : '9:16',
        example: match.detail,
      });
    }
  }
  return Array.from(grouped.values())
    .map((item): ShootingNeed => ({ ...item, priority: item.priority === '高' || item.count >= 3 ? '高' : item.count >= 2 ? '中' : '低' }))
    .sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0))
    .slice(0, 30);
}

function shootingCreationDate(value?: string): string {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '待补录';
}

function conciseLines(text: string, maxLines = 6, maxChars = 34): string[] {
  const clean = String(text || '').replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const parts = clean.split(/\s*(?:。|；|;|，(?=\S{8,})|\. (?=[A-Z0-9]))\s*/).map(s => s.trim()).filter(Boolean);
  const lines: string[] = [];
  for (const part of parts.length ? parts : [clean]) {
    let rest = part;
    while (rest.length > maxChars && lines.length < maxLines) {
      lines.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars).trim();
    }
    if (rest && lines.length < maxLines) lines.push(rest);
    if (lines.length >= maxLines) break;
  }
  return lines.slice(0, maxLines);
}

function referenceAnalysisText(video: TrendVideo, analysis: ScriptAnalysis | null): string {
  if (!analysis) {
    return [
      `参考视频标题仅用于判断开头钩子类型，不得在新脚本中复述：${shortenText(video.title, 80)}`,
      `平台：${video.platform}`,
      video.tags.length ? `标签：${video.tags.join('、')}` : '',
      video.views ? `热度：${video.views}` : '',
      '没有可用的视频级分析，只能按标题、平台和产品信息生成保守脚本。',
    ].filter(Boolean).join('\n');
  }
  const structure = analysis.structure.map(item => `${item.time} ${item.label}: ${item.desc}`).join('\n');
  const details = analysis.scriptDetails15s.map(item => `${item.time} ${item.shot}/${item.camera}: ${item.visual}；原字幕/口播：${item.subtitle}`).join('\n');
  const firstTen = analysis.firstTenSeconds.map(item => `${item.dimension}: ${item.detail}`).join('\n');
  return [
    `参考视频标题仅用于判断开头钩子类型，不得在新脚本中复述：${shortenText(video.title, 80)}`,
    `平台：${video.platform}`,
    `视频类型：${analysis.videoType}`,
    `信息节奏：${analysis.infoSpeed}`,
    `情绪：${analysis.emotion}`,
    `前 10 秒拆解：\n${firstTen}`,
    `粗略结构：\n${structure}`,
    `全片导演分镜：\n${details}`,
    `改编提示：${analysis.adaptTip}`,
  ].filter(Boolean).join('\n\n');
}

function referenceHighlights(video: TrendVideo, analysis: ScriptAnalysis | null): string[] {
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

function makeFallbackScript(_video: TrendVideo, _analysis: ScriptAnalysis | null, productInfo: string, languageLabel?: string, langCode = 'zh', type: ScriptType = 'voiceover'): string {
  const product = getPrimaryProductLabel(productInfo) || '【待从企业中心选择产品】';
  const label = languageLabel || (langCode === 'zh' ? '中文' : langCode);
  if (type === 'storyboard') {
    return `【本地草稿模板｜未调用 AI｜未经质量校验｜不可发布】
【分镜脚本｜${product}｜${label}】

Scene 1 (0-3s)
Shot: close-up | Camera: static
Visual: 待人工匹配企业自有素材；只描述素材中能直接观察到的画面。
Voiceover: 【待根据企业中心已确认事实填写】
Subtitle: 【待确认】

Scene 2 (3-8s)
Shot: medium | Camera: push
Visual: 待人工填写；不得补造产品功能、使用效果或商业能力。
Voiceover: 【待根据企业中心已确认事实填写】
Subtitle: 【待确认】

Scene 3 (8-12s)
Shot: close-up | Camera: pan
Visual: 待人工填写可验证证据；没有资料的字段保持空白。
Voiceover: 【待根据企业中心已确认事实填写】
Subtitle: 【待确认】

Scene 4 (12-15s)
Shot: wide | Camera: static
Visual: 待人工填写中性收束画面；行动提示须由用户确认。
Voiceover: 【待确认行动提示】
Subtitle: 【待确认】`;
  }
  return `【本地草稿模板｜未调用 AI｜未经质量校验｜不可发布】
【口播脚本｜${product}｜${label}】

[Hook · 0-3s]
【待根据企业中心已确认的产品事实填写开场】

[Body · 3-12s]
【待填写可由企业资料或自有素材证明的产品信息】
【不得填写未确认的认证、价格、起订量、交期、出口或履约承诺】

[CTA · 12-15s]
【待用户确认行动提示】`;
}

function scriptTypeLabel(type: ScriptType): string {
  return type === 'voiceover' ? '口播短视频脚本' : '分镜短视频脚本';
}

function splitProfileList(value?: string): string[] {
  return String(value || '')
    .split(/[\n,，;；、/]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

interface EnterpriseProfileForScript {
  company?: { name?: string; industry?: string; mainMarkets?: string; description?: string };
  products?: { categories?: string; priceRange?: string; moq?: string; certifications?: string; highlights?: string };
  brand?: { tone?: string; style?: string; usp?: string; preferredLanguages?: string };
  strategy?: { focusProducts?: string; focusMarkets?: string; currentGoal?: string; pricingStrategy?: string };
  knowledge?: string;
}

interface ProductOption { id: string; label: string; info: string }

function buildProductOptions(profile: EnterpriseProfileForScript): ProductOption[] {
  const focusProducts = splitProfileList(profile.strategy?.focusProducts);
  const categories = splitProfileList(profile.products?.categories);
  const names = Array.from(new Set([...focusProducts, ...categories]));
  const baseLines = [
    profile.products?.categories ? `产品类目：${profile.products.categories}` : '',
    profile.products?.priceRange ? `价格区间：${profile.products.priceRange}` : '',
    profile.products?.moq ? `起订量：${profile.products.moq}` : '',
    profile.products?.certifications ? `认证资质：${profile.products.certifications}` : '',
    profile.products?.highlights ? `核心优势：${profile.products.highlights}` : '',
    profile.brand?.usp ? `品牌 USP：${profile.brand.usp}` : '',
    profile.brand?.tone ? `品牌语气：${profile.brand.tone}` : '',
    profile.strategy?.focusMarkets || profile.company?.mainMarkets ? `目标市场：${profile.strategy?.focusMarkets || profile.company?.mainMarkets}` : '',
    profile.strategy?.currentGoal ? `当前目标：${profile.strategy.currentGoal}` : '',
    profile.company?.description ? `公司背景：${profile.company.description}` : '',
  ].filter(Boolean);

  const options = names.map((name, index) => ({
    id: `product-${index}`,
    label: name,
    info: [`主推品：${name}`, ...baseLines].join('\n'),
  }));

  if (baseLines.length) {
    options.unshift({
      id: 'enterprise-products',
      label: '企业产品组合',
      info: ['主推品：企业产品组合', ...baseLines].join('\n'),
    });
  }

  return options;
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

function pipelineState(video: TrendVideo): { title: string; desc: string; spinning: boolean; failed: boolean } {
  const analysis = video.aiAnalysis || {};
  const quotaError = /429|RESOURCE_EXHAUSTED|quota|prepayment credits|额度|余额/i.test(String(analysis.analysisError || analysis.downloadError || analysis.crawlerOpsLastError || ''));
  if (quotaError) {
    return { title: '待测试用户填入真实 Gemini API Key', desc: summarizePipelineError(analysis.analysisError || analysis.downloadError || analysis.crawlerOpsLastError), spinning: false, failed: true };
  }
  if (analysis.downloadStatus === 'ops_queued') {
    return { title: '后台增强分析中', desc: '已先生成基础分析；视频获取失败后已进入后台增强队列，成功后会升级为视频级分析。', spinning: true, failed: false };
  }
  if (analysis.gemini && analysis.analysisQuality === 'video') {
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

function needsVideoEnhancement(video: TrendVideo): boolean {
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

// ── Fallback thumbnail ────────────────────────────────────────────────────────
export function VideoThumbnail({ platform, title }: { platform: Exclude<Platform, 'all'>; title: string }) {
  const shortTitle = title.length > 86 ? `${title.slice(0, 83)}...` : title;
  return (
    <div className="relative flex h-full w-full flex-col justify-between overflow-hidden bg-text-primary p-4">
      <div className="absolute inset-x-0 bottom-0 h-px bg-white/20" />
      <div className="relative">
        <SocialPlatformIcon platform={platform} size={38} className="mb-3 drop-shadow-none" />
        <p className="line-clamp-3 text-sm font-semibold leading-snug text-white/90 drop-shadow-none">{shortTitle}</p>
      </div>
    </div>
  );
}

export function ThumbnailImage({
  src,
  platform,
  title,
  className,
}: {
  src: string;
  platform: Exclude<Platform, 'all'>;
  title: string;
  className: string;
}) {
  const isDirectUrl = /^https?:\/\//i.test(src) || src.startsWith('/media/') || src.startsWith('blob:') || src.startsWith('data:');
  const [blobUrl, setBlobUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    setBlobUrl('');
    if (!src || isDirectUrl) return;
    const controller = new AbortController();
    let createdUrl = '';
    void fetch(src, { headers: authHeader(), signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(String(response.status));
        return response.blob();
      })
      .then(blob => {
        if (controller.signal.aborted) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [src, isDirectUrl]);
  if (failed || !src) return null;
  if (isDirectUrl) return <LsProgressiveMedia src={src} alt={`${title} · ${platform} 缩略图`} className={className} draggable={false} loading="lazy" preview={false} onError={() => setFailed(true)} />;
  return blobUrl ? <LsProgressiveMedia src={blobUrl} alt={`${title} · ${platform} 缩略图`} className={className} draggable={false} preview={false} /> : null;
}

function AuthenticatedImage({ src, alt, className }: { src: string; alt: string; className: string }) {
  const isRemoteSignedUrl = /^https?:\/\//i.test(src);
  const [blobUrl, setBlobUrl] = useState('');
  useEffect(() => {
    // COS returns a time-limited signed HTTPS URL. Loading it directly avoids an
    // unnecessary Authorization header/CORS preflight that can leave cards blank.
    if (isRemoteSignedUrl) return;
    const controller = new AbortController();
    let createdUrl = '';
    setBlobUrl('');
    void fetch(src, { headers: authHeader(), signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(String(response.status));
        return response.blob();
      })
      .then(blob => {
        if (controller.signal.aborted) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [src, isRemoteSignedUrl]);
  if (isRemoteSignedUrl) return <img src={src} alt={alt} className={className} decoding="async" />;
  return blobUrl
    ? <img src={blobUrl} alt={alt} className={className} />
    : <div className={`${className} animate-pulse bg-slate-200`} aria-label={alt} />;
}

export function AuthenticatedVideo({ apiUrl, poster, className, controls = false, autoPlay = false, loadOnMount = autoPlay, hoverPlay = false, previewFrame = false, preload = previewFrame ? 'auto' : 'metadata', onReady, onError, onLoadingChange }: { apiUrl: string; poster?: string; className: string; controls?: boolean; autoPlay?: boolean; loadOnMount?: boolean; hoverPlay?: boolean; previewFrame?: boolean; preload?: 'none' | 'metadata' | 'auto'; onReady?: () => void; onError?: (message?: string) => void; onLoadingChange?: (loading: boolean) => void }) {
  const [playbackUrl, setPlaybackUrl] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const requestRef = useRef<Promise<string> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const mediaRetryRef = useRef(0);
  const mediaReadyTimerRef = useRef<number | null>(null);

  const clearMediaReadyTimer = () => {
    if (mediaReadyTimerRef.current === null) return;
    window.clearTimeout(mediaReadyTimerRef.current);
    mediaReadyTimerRef.current = null;
  };

  const load = async (force = false) => {
    if (playbackUrl && !force) return playbackUrl;
    if (requestRef.current && !force) return requestRef.current;
    if (force) controllerRef.current?.abort();
    const generation = ++generationRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    onLoadingChange?.(true);
    let resolverTimedOut = false;
    const resolverTimer = window.setTimeout(() => {
      resolverTimedOut = true;
      controller.abort();
    }, 15_000);
    const request = resolveInspirationPlaybackUrl(apiUrl, { signal: controller.signal, headers: authHeader() })
      .then(next => {
        if (generation === generationRef.current) {
          setPlaybackUrl(next);
          clearMediaReadyTimer();
          mediaReadyTimerRef.current = window.setTimeout(() => {
            if (generation !== generationRef.current || (videoRef.current?.readyState || 0) >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
            onLoadingChange?.(false);
            onError?.('视频加载超时，请重新获取播放地址');
          }, 20_000);
        }
        return next;
      })
      .catch(error => {
        if ((!resolverTimedOut && controller.signal.aborted) || generation !== generationRef.current) return '';
        const message = resolverTimedOut ? '视频地址获取超时' : error instanceof Error ? error.message : '视频地址获取失败';
        onLoadingChange?.(false);
        onError?.(message);
        return '';
      })
      .finally(() => {
        window.clearTimeout(resolverTimer);
        if (generation !== generationRef.current) return;
        requestRef.current = null;
      });
    requestRef.current = request;
    return request;
  };
  useEffect(() => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    requestRef.current = null;
    mediaRetryRef.current = 0;
    clearMediaReadyTimer();
    setPlaybackUrl('');
    onLoadingChange?.(false);
    if (loadOnMount) void load(true);
    return () => {
      generationRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
      requestRef.current = null;
      clearMediaReadyTimer();
    };
  }, [apiUrl, loadOnMount]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (autoPlay && playbackUrl) void videoRef.current?.play().catch(() => {}); }, [autoPlay, playbackUrl]);
  return <video ref={videoRef} src={playbackUrl || undefined} poster={poster} controls={controls} autoPlay={autoPlay} muted={!controls} playsInline loop={hoverPlay} preload={preload} className={className}
    onLoadedMetadata={() => {
      const video = videoRef.current;
      if (!previewFrame || !video || !Number.isFinite(video.duration) || video.duration <= 0) return;
      // A tiny seek paints a reliable first frame for uploaded MP4s whose frame
      // at 0s is transparent/black and which do not yet have a poster asset.
      video.currentTime = Math.min(0.12, Math.max(0.01, video.duration / 20));
    }}
    onLoadedData={() => { clearMediaReadyTimer(); mediaRetryRef.current = 0; if (previewFrame) videoRef.current?.pause(); onReady?.(); }}
    onCanPlay={() => { clearMediaReadyTimer(); onReady?.(); }}
    onError={() => {
      if (!playbackUrl) return;
      clearMediaReadyTimer();
      if (mediaRetryRef.current < 1) {
        mediaRetryRef.current += 1;
        setPlaybackUrl('');
        void load(true);
        return;
      }
      onError?.('视频文件加载或解码失败');
    }}
    onMouseEnter={async () => { if (!hoverPlay) return; await load(); setTimeout(() => void videoRef.current?.play().catch(() => {}), 0); }}
    onMouseLeave={() => { if (!hoverPlay || !videoRef.current) return; videoRef.current.pause(); videoRef.current.currentTime = 0; }} />;
}

type ImageInsightTab = 'overview' | 'visual' | 'copy' | 'iterate';

function ImageBreakdownContent({ video, activeTab }: { video: TrendVideo; analysis: ScriptAnalysis; activeTab: ImageInsightTab }) {
  const evidence = video.aiAnalysis?.imageEvidence;
  const metrics = video.aiAnalysis?.publicMetrics;
  const baseline = video.aiAnalysis?.publicBaseline;
  const adSignals = video.aiAnalysis?.publicAdSignals;
  const rawCaption = cleanAnalysisText(video.aiAnalysis?.caption || video.title);
  const isAnalyzed = Boolean(evidence?.status === 'analyzed' && evidence.observedFacts.length);
  const roleLabel: Record<string, string> = { attention: '首图停留', product: '产品展示', detail: '细节说明', proof: '信任证明', process: '流程解释', cta: '行动引导', unknown: '未确定' };

  const EmptyEvidence = ({ title, desc }: { title: string; desc: string }) => (
    <div className="rounded-lg border border-dashed border-border bg-surface-2 px-5 py-8 text-center">
      <Images size={22} className="mx-auto text-text-muted" />
      <p className="mt-3 text-xs font-semibold text-text-primary">{title}</p>
      <p className="mx-auto mt-1.5 max-w-[280px] text-[10px] leading-relaxed text-text-muted">{desc}</p>
    </div>
  );

  const EvidenceCard = ({ label, value }: { label: string; value: string }) => (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-2"><p className="text-[10px] font-semibold text-text-primary">{label}</p><span className="rounded-full bg-surface-2 px-2 py-0.5 text-[9px] text-text-muted">来自 AI 原始结果</span></div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-text-secondary">{value}</p>
    </div>
  );

  if (activeTab === 'overview') return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-surface p-3.5">
        <div className="flex items-center justify-between"><div><p className="text-xs font-semibold text-text-primary">公开表现</p><p className="mt-1 text-[9px] text-text-muted">无公开值就留空，不把播放当曝光、不估算收藏与点击</p></div>{baseline?.status === 'usable' && baseline.relativeMultiple != null && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">账号基线 {baseline.relativeMultiple}×</span>}</div>
        <div className="mt-3 grid grid-cols-4 gap-1.5">{[['点赞', metrics?.likes || '—'], ['评论', metrics?.comments || '—'], ['分享', metrics?.shares || '—'], ['播放', metrics?.plays || '—']].map(([label, value]) => <div key={label} className="rounded-lg bg-surface-2 px-1.5 py-2 text-center"><p className="text-sm font-semibold text-text-primary">{value}</p><p className="text-[9px] text-text-muted">{label}</p></div>)}</div>
        <div className="mt-2 rounded-lg bg-surface-2 p-2 text-[9px] leading-relaxed text-text-secondary">
          <p>账号：{video.aiAnalysis?.author || video.aiAnalysis?.sourceAccountName || '未抓取'} · 粉丝：{metrics?.followers ? metrics.followers.toLocaleString() : '未公开/未抓取'}</p>
          <p className="mt-1">投流信号：{adSignals?.isAd || adSignals?.isPaidPartnership ? '平台公开标记为广告/付费合作' : '未抓到公开标记（不代表未投流）'}</p>
        </div>
        <p className="mt-2 text-[9px] leading-relaxed text-text-muted">{baseline?.status === 'usable' ? `${baseline.sampleSize} 条同账号样本；${baseline.method}` : `同账号样本 ${baseline?.sampleSize || 0} 条，暂不足以确认相对爆款。`}</p>
      </section>
      {!isAnalyzed ? <EmptyEvidence title="图片证据尚未提取" desc={video.aiAnalysis?.imageAnalysisError || '重新分析后，系统会逐图提取可见事实、OCR、轮播角色和可复用模块。'}/> : <section><div className="mb-2 flex items-center justify-between"><p className="text-[11px] font-semibold text-text-primary">可复用模块</p><span className="text-[9px] text-text-muted">{evidence!.observedFacts.length} 张图片 · 仅基于可见证据</span></div><div className="space-y-2">{evidence!.reusableModules.map((item, index) => <div key={`${item.module}-${index}`} className="rounded-lg border border-border bg-white p-3"><div className="flex items-center justify-between"><p className="text-[11px] font-semibold text-text-primary">{item.module}</p><span className="text-[9px] text-text-muted">置信度 {Math.round(item.confidence * 100)}%</span></div><p className="mt-1 text-[10px] text-text-secondary">证据：{item.evidence}</p><div className="mt-2 grid grid-cols-2 gap-2 text-[9px]"><p className="rounded-lg bg-blue-50 p-2 text-blue-800">保留结构：{item.preserve}</p><p className="rounded-lg bg-amber-50 p-2 text-amber-800">替换内容：{item.replace}</p></div></div>)}</div></section>}
    </div>
  );

  if (activeTab === 'visual') return (
    <div className="space-y-3">
      <div><p className="text-[11px] font-semibold text-text-primary">逐图视觉事实</p><p className="mt-1 text-[10px] text-text-muted">主体、场景、构图、颜色和实际可读文字</p></div>
      {!isAnalyzed ? <EmptyEvidence title="尚未返回逐图拆解" desc="当前没有可验证的图片视觉结果。"/> : evidence!.observedFacts.map(fact => { const flow = evidence!.carouselFlow.find(item => item.imageIndex === fact.imageIndex); return <div key={fact.imageIndex} className="rounded-lg border border-border bg-white p-3"><div className="flex items-center justify-between"><p className="text-[11px] font-semibold text-text-primary">第 {fact.imageIndex} 张</p><span className="rounded-full bg-violet-50 px-2 py-0.5 text-[9px] font-bold text-violet-700">{roleLabel[flow?.role || 'unknown']}</span></div><p className="mt-2 text-[10px] text-text-secondary">主体：{fact.subjects.join('、') || '未确认'}</p><p className="mt-1 text-[10px] text-text-secondary">场景：{fact.scene || '未确认'}</p><p className="mt-1 text-[10px] text-text-secondary">构图：{fact.composition || '未确认'}</p><p className="mt-1 text-[10px] text-text-secondary">颜色：{fact.colors.join('、') || '未确认'}</p>{fact.visibleText.length > 0 && <p className="mt-1 rounded-lg bg-surface-2 p-2 text-[10px] text-text-secondary">OCR：{fact.visibleText.join(' / ')}</p>}{flow?.evidence && <p className="mt-2 text-[9px] text-text-muted">轮播作用依据：{flow.evidence}</p>}</div>; })}
    </div>
  );

  if (activeTab === 'copy') return (
    <div className="space-y-3">
      <section className="rounded-lg border border-border bg-white p-3"><div className="flex items-center justify-between"><p className="text-[10px] font-bold text-text-muted">原始帖文</p><span className="rounded-full bg-surface-2 px-2 py-0.5 text-[9px] text-text-muted">抓取原文</span></div><p className="mt-2 text-[11px] font-bold leading-relaxed text-text-primary">{rawCaption || '未抓取到原始帖文'}</p></section>
      {!evidence?.copyEvidence.hooks.length && !evidence?.copyEvidence.sellingPoints.length ? <EmptyEvidence title="没有可确认的文案模块" desc="仅展示原始帖文，不推断未出现的人群、痛点或承诺。"/> : <>{evidence?.copyEvidence.hooks.map((item, index) => <EvidenceCard key={`copy-hook-${index}`} label={`钩子 ${index + 1} · ${item.source}`} value={`${item.text}｜证据：${item.evidence}`}/>)}{evidence?.copyEvidence.sellingPoints.map((item, index) => <EvidenceCard key={`copy-point-${index}`} label={`卖点 ${index + 1} · ${item.source}`} value={`${item.text}｜证据：${item.evidence}`}/>)}</>}
    </div>
  );

  return (
    <div className="space-y-3">
      <div><p className="text-[11px] font-semibold text-text-primary">套用到企业获客内容</p><p className="mt-1 text-[10px] text-text-muted">生成“吸引—解释—信任”三条连续内容，而不是三张相似测试图。</p></div>
      {!isAnalyzed ? <EmptyEvidence title="暂不能生成内容包" desc="需要先完成逐图证据提取，才能安全复用布局和信息模块。"/> : <div className="space-y-2">{[['吸引目标买家', '复用首图停留结构，替换为企业产品和买家问题。'], ['解释合作能力', '复用产品、细节和流程模块，映射企业 MOQ、定制与交付资料。'], ['建立供应商信任', '复用证明模块，只使用企业真实工厂、认证和案例。']].map(([title, desc], index) => <div key={title} className="flex gap-3 rounded-lg border border-border bg-white p-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[10px] font-semibold text-blue-700">{index + 1}</span><div><p className="text-[11px] font-semibold text-text-primary">{title}</p><p className="mt-1 text-[10px] text-text-secondary">{desc}</p></div></div>)}{evidence!.uncertainties.length > 0 && <div className="rounded-lg bg-amber-50 p-3"><p className="text-[10px] font-semibold text-amber-800">生成前需确认</p>{evidence!.uncertainties.map(item => <p key={item} className="mt-1 text-[9px] text-amber-700">· {item}</p>)}</div>}</div>}
    </div>
  );
}

// ── Analysis Panel ────────────────────────────────────────────────────────────
function AnalysisPanel({ video, onGenerateScript, onPersonReplace, onRetry, onExactAnalysis, actionNotice, specialRecommendation }: { video: TrendVideo; onGenerateScript: (analysis?: ScriptAnalysis) => void; onPersonReplace: (analysis?: ScriptAnalysis) => void; onRetry?: () => void; onExactAnalysis?: () => void; actionNotice?: string; specialRecommendation?: AccountSpecialRecommendation | null }) {
  const [loaded, setLoaded] = useState(false);
  const [analysis, setAnalysis] = useState<ScriptAnalysis | null>(null);
  const [activeBookmark, setActiveBookmark] = useState<'reason' | 'frames' | 'script' | 'adapt' | ImageInsightTab>(video.contentFormat === 'image' ? 'overview' : 'reason');
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialLoading, setMaterialLoading] = useState(false);
  const [editingAnalysis, setEditingAnalysis] = useState(false);
  const [savingAnalysis, setSavingAnalysis] = useState(false);
  const [reanalyzingImage, setReanalyzingImage] = useState(false);
  const [analysisSaveNotice, setAnalysisSaveNotice] = useState('');
  const analysisKey = JSON.stringify(video.aiAnalysis || {});
  const updateDetail = (index: number, patch: Partial<ScriptDetail15s>) => setAnalysis(current => current ? ({ ...current, scriptDetails15s: current.scriptDetails15s.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }) : current);
  const saveAnalysisCorrections = async () => {
    if (!analysis) return;
    setSavingAnalysis(true); setAnalysisSaveNotice('');
    try {
      const response = await fetch(`/api/overseas/videos/${video.id}/analysis-corrections`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify({ scriptSummary15s: analysis.scriptSummary15s, scriptDetails15s: analysis.scriptDetails15s, confirmed: true }) });
      if (!response.ok) throw new Error(`保存失败（${response.status}）`);
      setEditingAnalysis(false); setAnalysisSaveNotice('修正已保存，后续裂变将使用确认稿');
    } catch (error) { setAnalysisSaveNotice(error instanceof Error ? error.message : '保存失败'); }
    finally { setSavingAnalysis(false); }
  };
  const reanalyzeImage = async () => {
    const id = video.recordId || video.id.replace(/^crawl-/, '');
    setReanalyzingImage(true);
    try {
      const response = await fetch(`/api/overseas/videos/${id}/reanalyze-image`, { method: 'POST', headers: authHeader() });
      if (!response.ok) throw new Error((await response.json().catch(() => ({})))?.error || '图片分析失败');
      window.location.reload();
    } catch (error) {
      setAnalysisSaveNotice(error instanceof Error ? error.message : '图片分析失败');
    } finally { setReanalyzingImage(false); }
  };

  useEffect(() => {
    setLoaded(false);
    setAnalysis(null);
    const t = setTimeout(() => {
      setAnalysis(video.contentFormat === 'image' ? imageAnalysisShell(video) : getAnalysis(video));
      setLoaded(true);
    }, video.aiAnalysis?.gemini ? 250 : 900);
    return () => clearTimeout(t);
  }, [video.id, analysisKey]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      setMaterialLoading(true);
      void studioApi.listMaterials()
        .then(list => {
          if (!cancelled) setMaterials(list.filter(item => item.type === 'video'));
        })
        .catch(() => {
          if (!cancelled) setMaterials([]);
        })
        .finally(() => {
          if (!cancelled) setMaterialLoading(false);
        });
    };
    refresh();
    window.addEventListener('lingshu:materials-updated', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('lingshu:materials-updated', refresh);
    };
  }, [video.id]);

  useEffect(() => {
    setActiveBookmark(video.contentFormat === 'image' ? 'overview' : 'reason');
  }, [video.id, video.contentFormat]);

  if (!loaded) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ background: 'rgba(22,163,74,0.1)' }}>
          <Loader2 size={18} className="text-accent animate-spin" />
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-semibold text-text-primary">{video.contentFormat === 'image' ? 'AI 正在提取图片爆点…' : 'AI 正在分析脚本结构…'}</p>
          <p className="text-xs text-text-muted">{video.contentFormat === 'image' ? '视觉焦点 · 文案钩子 · 迭代变量' : '前 10 秒五维拆解 · 粗略 3 秒结构 · 提取复用爆点'}</p>
        </div>
      </div>
    );
  }

  if (!analysis) {
    const state = pipelineState(video);
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-surface-2 border border-border">
          {state.spinning ? <Loader2 size={18} className="text-accent animate-spin" /> : <X size={18} className={state.failed ? 'text-accent' : 'text-text-muted'} />}
        </div>
        <div className="space-y-1 max-w-xs">
          <p className="text-sm font-semibold text-text-primary">{state.title}</p>
          <p className="text-xs text-text-muted leading-relaxed">
            {state.desc}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {state.failed && onRetry && (
            <button onClick={onRetry}
              className="px-3 py-2 rounded-lg text-xs font-semibold text-white transition-colors"
              style={{ background: 'var(--color-accent)' }}>
              重试
            </button>
          )}
          {video.sourceUrl && (
            <button onClick={() => window.open(video.sourceUrl, '_blank', 'noopener,noreferrer')}
              className="px-3 py-2 rounded-lg border border-border bg-surface-2 text-xs font-semibold text-text-secondary hover:text-text-primary transition-colors">
              打开原视频
            </button>
          )}
        </div>
      </div>
    );
  }

  const frameMatches = matchMaterialsToFrames(analysis.scriptDetails15s, materials);
  const matchedCount = frameMatches.filter(item => item.material).length;

  const confirmMatchedSegment = async (match: FrameMaterialMatch) => {
    if (!match.material || !match.segment) return;
    const result = await studioApi.updateMaterialSegment(match.material.id, match.segment.id, { manualConfirmed: true, needsReview: false });
    if (result.ok && result.material) setMaterials(current => current.map(item => item.id === result.material!.id ? result.material! : item));
  };

  const bookmarkTabs = video.contentFormat === 'image' ? [
    { id: 'overview' as const, icon: <Zap size={12} />, label: '表现与模块' },
    { id: 'visual' as const, icon: <Images size={12} />, label: '逐图拆解' },
    { id: 'copy' as const, icon: <FileText size={12} />, label: '文案证据' },
    { id: 'iterate' as const, icon: <Sparkles size={12} />, label: '获客套用' },
  ] : [
    { id: 'reason' as const, icon: <Lightbulb size={12} />, label: '核心原因' },
    { id: 'frames' as const, icon: <Film size={12} />, label: '分镜匹配' },
    { id: 'script' as const, icon: <FileText size={12} />, label: '脚本详析' },
    { id: 'adapt' as const, icon: <Sparkles size={12} />, label: '改编建议' },
  ];
  const imageEvidenceCount = video.aiAnalysis?.imageEvidence?.observedFacts.length || 0;
  const hasTrustedImageAnalysis = video.contentFormat === 'image' && video.aiAnalysis?.imageEvidence?.status === 'analyzed' && imageEvidenceCount > 0;
  const strategyPipelineState = pipelineState(video);
  const showStrategyProgress = video.contentFormat === 'video'
    && needsVideoEnhancement(video)
    && strategyPipelineState.spinning;
  const analysisQuality = exactAnalysisQuality(video);
  const videoGenerationBlocked = video.contentFormat === 'video' && !analysisQuality.ready;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-lingshu-guide="analysis-evidence">
      <div className="flex-shrink-0 border-b border-border bg-surface px-4 py-3">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px] text-text-muted">
          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 font-semibold text-text-secondary">{video.contentFormat === 'image' && <><SocialPlatformIcon platform={video.platform} size={12} /><span className="sr-only">{getPlatformMeta(video.platform).label}</span></>}{video.contentFormat === 'image' ? '图文' : analysis.videoType}</span>
          {video.contentFormat === 'image' ? <><span className="flex items-center gap-1"><BarChart2 size={9} className="text-accent" />{hasTrustedImageAnalysis ? `已提取 ${imageEvidenceCount} 条证据` : '图片分析待完成'}</span><span className="flex items-center gap-1"><Images size={9} />{video.aiAnalysis?.imageCount || video.aiAnalysis?.imageUrls?.length || 1} 张图片</span></> : <><span className="flex items-center gap-1"><BarChart2 size={9} className="text-accent" />信息速度 {analysis.infoSpeed}</span><span className="flex items-center gap-1"><TrendingUp size={9} />{video.views} 播放</span><span>{analysis.emotion}</span></>}
        </div>
        {showStrategyProgress && <div role="status" aria-live="polite" className="mb-3 flex items-start gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-[10px] leading-relaxed text-text-secondary">
          <Loader2 size={12} className="mt-0.5 shrink-0 animate-spin text-accent" />
          <span><strong className="text-text-primary">{strategyPipelineState.title}</strong>：{strategyPipelineState.desc}</span>
        </div>}
        <div className="grid grid-cols-4 border-b border-border">
          {bookmarkTabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveBookmark(tab.id)}
              className={`flex min-h-9 items-center justify-center gap-1 border-b-2 px-1.5 text-[11px] font-bold transition-colors ${
                activeBookmark === tab.id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-muted hover:text-text-secondary'
              }`}
            >
              {tab.icon}
              <span className="truncate">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <AnimatePresence mode="wait">
          {video.contentFormat === 'image' && ['overview', 'visual', 'copy', 'iterate'].includes(activeBookmark) && (
            <motion.div key={activeBookmark} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
              <ImageBreakdownContent video={video} analysis={analysis} activeTab={activeBookmark as ImageInsightTab} />
            </motion.div>
          )}
          {activeBookmark === 'reason' && (
            <motion.div key="reason" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="space-y-3">
              {specialRecommendation && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 shadow-none">
                  <div className="flex items-center gap-1.5"><Flame size={13} className="text-red-600" /><p className="text-[11px] font-semibold text-red-700">特别推荐 · 借鉴价值{specialRecommendation.level}</p></div>
                  <p className="mt-1 text-[10px] leading-relaxed text-red-700">{specialRecommendation.message}</p>
                </div>
              )}
              <div>
                <div className="mb-2 flex items-center gap-1.5">
                  <Lightbulb size={11} className="text-accent" />
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">爆款核心原因 · 前 10 秒五维拆解</p>
                </div>
                <div className="space-y-1.5">
                  {analysis.firstTenSeconds.map((item, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
                      <span className="mt-px flex-shrink-0 text-[11px] font-bold text-accent">{item.dimension}</span>
                      {item.dimension === '画面' ? (
                        <div className="space-y-0.5 text-[11px] leading-snug text-text-secondary">
                          {conciseLines(item.detail, 6, 32).map((line, idx) => <p key={idx}>{line}</p>)}
                        </div>
                      ) : (
                        <p className="text-[11px] leading-snug text-text-secondary">{shortenText(item.detail, 96)}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {activeBookmark === 'frames' && (
            <motion.div key="frames" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Film size={11} className="text-accent" />
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">自动分镜素材匹配</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-text-muted">
                    {materialLoading ? '读取本地素材中...' : `${matchedCount}/${frameMatches.length} 已匹配`}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                {frameMatches.map((match, i) => {
                  const key = `${match.detail.time}-${i}`;
                  const hasMaterial = Boolean(match.material);
                  return (
                    <div key={key} className={`rounded-md border p-3 ${match.decision === 'copy_now' ? 'border-accent/25 bg-accent-glow' : match.decision === 'drop' ? 'border-border bg-surface-2/60' : 'border-amber/25 bg-amber-dim'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[9px] font-bold text-white">{match.detail.time}</span>
                            <span className="text-[11px] font-semibold text-text-primary">{match.viralDna.purpose}</span>
                          </div>
                          <p className="mt-1 text-[10px] text-text-muted">{match.detail.shot} · {match.detail.camera}</p>
                        </div>
                      </div>

                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <div className="rounded-md border border-amber/20 bg-surface px-2.5 py-2">
                          <div className="flex items-center justify-between"><span className="text-[9px] font-bold text-amber">爆款潜力</span><span className="text-sm font-bold text-amber">{frameScoreGrade(match.viralPotential.score)}</span></div>
                          <div className="mt-1 h-1 overflow-hidden rounded-full bg-amber-dim"><div className="h-full rounded-full bg-amber" style={{ width: `${match.viralPotential.score}%` }} /></div>
                        </div>
                        <div className="rounded-md border border-accent/20 bg-surface px-2.5 py-2">
                          <div className="flex items-center justify-between"><span className="text-[9px] font-bold text-accent">可复制性</span><span className="text-sm font-bold text-accent">{frameScoreGrade(match.replicability.score)}</span></div>
                          <div className="mt-1 h-1 overflow-hidden rounded-full bg-accent-glow"><div className="h-full rounded-full bg-accent" style={{ width: `${match.replicability.score}%` }} /></div>
                        </div>
                      </div>

                      <div className="mt-2 rounded-lg border border-border bg-white/90 px-2.5 py-2">
                        <p className="text-[9px] font-semibold text-text-primary">为什么有效</p>
                        <p className="mt-1 text-[10px] leading-relaxed text-text-secondary">{match.viralPotential.whyEffective}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1">{match.viralPotential.mechanisms.map(item => <span key={item} className="rounded bg-amber-dim px-1.5 py-0.5 text-[9px] font-bold text-amber">{item}</span>)}</div>
                      </div>

                      <div className="mt-2 rounded-lg border border-border bg-white/90 px-2.5 py-2">
                        <p className="text-[9px] font-semibold text-text-primary">必须保留</p>
                        <div className="mt-1 space-y-0.5">{match.viralDna.mustPreserve.slice(0, 4).map(item => <p key={item} className="text-[10px] leading-relaxed text-text-secondary">✓ {item}</p>)}</div>
                      </div>

                      <div className="mt-2 rounded-md border border-accent/20 bg-accent-glow px-2.5 py-2">
                        <p className="text-[9px] font-bold text-accent">企业替换与执行</p>
                        <p className="mt-1 text-[10px] leading-relaxed text-text-secondary">{match.viralDna.replaceable.join('；')}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[9px] font-bold">
                          <span className="rounded bg-white px-1.5 py-0.5 text-text-secondary">真实素材覆盖 {match.replicability.localCoverage}%</span>
                          <span className="rounded bg-white px-1.5 py-0.5 text-text-secondary">执行可行性 {AI_FEASIBILITY_LABELS[match.replicability.aiFeasibility]}</span>
                          <span className={`rounded bg-white px-1.5 py-0.5 ${hasMaterial ? 'text-green-700' : 'text-amber-700'}`}>{hasMaterial ? '已有候选片段' : '缺少真实片段'}</span>
                        </div>
                        {match.replicability.blockers.length > 0 && <p className="mt-1.5 text-[10px] leading-relaxed text-amber-700">阻塞：{match.replicability.blockers.join('；')}</p>}
                      </div>

                      <details className="mt-2 rounded-lg border border-border bg-white/80 px-2.5 py-2">
                        <summary className="cursor-pointer text-[10px] font-bold text-text-secondary">查看原分镜与素材匹配详情</summary>
                        <div className="mt-2 space-y-2 border-t border-border pt-2">
                          <p className="text-[10px] leading-relaxed text-text-secondary"><span className="font-bold">原画面：</span>{match.detail.visual}</p>
                          {hasMaterial && match.material ? <>
                            <div className="flex gap-2">
                              <div className="relative h-20 w-14 shrink-0 overflow-hidden rounded-md border border-border bg-surface-2">
                                {match.material.url ? <video src={`${match.material.url}#t=${match.segment?.start ?? 0.1}`} poster={match.segment?.poster || match.material.poster} muted playsInline preload="metadata" className="h-full w-full object-cover" /> : match.material.poster ? <img src={match.material.poster} alt="" className="h-full w-full object-cover" /> : <Film size={14} className="m-auto mt-7 text-text-muted" />}
                              </div>
                              <div className="min-w-0 flex-1"><p className="truncate text-[10px] font-bold text-text-primary">{match.material.name}</p><p className="mt-1 text-[9px] text-text-muted">{match.reason}</p>{match.trim && <p className="mt-1 text-[10px] font-bold text-green-700">{match.trim.label}</p>}</div>
                            </div>
                            {match.scores && <div className="grid grid-cols-4 gap-1 text-center text-[9px] font-semibold text-text-muted">
                              <span className="rounded bg-surface-2 px-1 py-0.5">功能 {match.scores.function}</span><span className="rounded bg-surface-2 px-1 py-0.5">动作 {match.scores.action}</span><span className="rounded bg-surface-2 px-1 py-0.5">主体 {match.scores.subject}</span><span className="rounded bg-surface-2 px-1 py-0.5">构图 {match.scores.composition}</span><span className="rounded bg-surface-2 px-1 py-0.5">运镜 {match.scores.camera}</span><span className="rounded bg-surface-2 px-1 py-0.5">时长 {match.scores.duration}</span><span className="rounded bg-surface-2 px-1 py-0.5">质量 {match.scores.quality}</span><span className="rounded bg-surface-2 px-1 py-0.5">企业适配 {match.scores.enterpriseFit}</span>
                            </div>}
                            {match.segment && !match.segment.manualConfirmed && <button type="button" onClick={() => void confirmMatchedSegment(match)} className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700"><Check size={10} />人工确认片段</button>}
                          </> : <p className="text-[10px] leading-relaxed text-accent-800">{match.suggestion}</p>}
                        </div>
                      </details>

                      {!hasMaterial && match.replicability.recommendedExecution === 'reshoot' && <p className="mt-2 rounded-lg bg-white px-2.5 py-2 text-[10px] font-bold text-amber-700">待拍任务：{match.suggestion}</p>}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {activeBookmark === 'script' && (
            <motion.div key="script" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5"><FileText size={11} className="text-accent" /><p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">导演分镜脚本详析</p></div>
                <div className="flex items-center gap-2">
                  {analysisSaveNotice && <span className="text-[10px] text-text-muted">{analysisSaveNotice}</span>}
                  {editingAnalysis ? <><button onClick={() => setEditingAnalysis(false)} className="text-[10px] font-bold text-text-muted">取消</button><button onClick={() => void saveAnalysisCorrections()} disabled={savingAnalysis} className="rounded-lg bg-accent px-2.5 py-1 text-[10px] font-bold text-white disabled:opacity-50">{savingAnalysis ? '保存中…' : '保存修正'}</button></> : <button onClick={() => setEditingAnalysis(true)} className="rounded-lg border border-border bg-white px-2.5 py-1 text-[10px] font-bold text-text-secondary">编辑校对</button>}
                </div>
              </div>
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="space-y-1 border-b border-border bg-surface-2 px-3 py-2.5">
                  <p className="text-[11px] leading-relaxed text-text-secondary"><span className="font-semibold text-text-primary">基础要求：</span>{analysis.baseRequirements}</p>
                  <p className="text-[11px] text-text-secondary"><span className="font-semibold text-text-primary">指定画风：</span>{analysis.scriptSummary15s.visualStyle}</p>
                  <p className="text-[11px] text-text-secondary"><span className="font-semibold text-text-primary">核心情绪：</span>{analysis.scriptSummary15s.coreEmotion}</p>
                  <p className="text-[11px] text-text-secondary">
                    <span className="font-semibold text-text-primary">参考品牌/竞品：</span>
                    {analysis.scriptSummary15s.competitors.length
                      ? analysis.scriptSummary15s.competitors.map(item => `==${item}==`).join('；')
                      : '未提取到可确认品牌/竞品'}
                  </p>
                </div>
                <div className="divide-y divide-border">
                  {analysis.scriptDetails15s.map((item, i) => (
                    <div key={`${item.time}-${i}`} className="px-3 py-2.5">
                      {editingAnalysis ? <div className="grid grid-cols-2 gap-2">
                        <input value={item.time} onChange={event => updateDetail(i, { time: event.target.value })} className="rounded-lg border border-border px-2 py-1.5 text-[10px]" placeholder="时间区间" />
                        <input value={item.purpose || ''} onChange={event => updateDetail(i, { purpose: event.target.value })} className="rounded-lg border border-border px-2 py-1.5 text-[10px]" placeholder="镜头功能" />
                        <textarea value={item.visual} onChange={event => updateDetail(i, { visual: event.target.value })} className="col-span-2 rounded-lg border border-border px-2 py-1.5 text-[10px]" rows={2} placeholder="画面" />
                        <textarea value={item.dialogue || ''} onChange={event => updateDetail(i, { dialogue: event.target.value })} className="rounded-lg border border-border px-2 py-1.5 text-[10px]" rows={2} placeholder="口播" />
                        <textarea value={item.onScreenText || ''} onChange={event => updateDetail(i, { onScreenText: event.target.value })} className="rounded-lg border border-border px-2 py-1.5 text-[10px]" rows={2} placeholder="屏幕文字" />
                        <input value={item.note || ''} onChange={event => updateDetail(i, { note: event.target.value, needsReview: Boolean(event.target.value) })} className="col-span-2 rounded-lg border border-border px-2 py-1.5 text-[10px]" placeholder="人工复核备注；清空表示已确认" />
                      </div> : <p className="text-[11px] leading-relaxed text-text-secondary">
                        <span className="font-mono font-semibold text-accent">[{item.time}]</span>{' '}
                        环境：{item.environment}；景别：{item.shot}；运镜：{item.camera}；{item.purpose ? `镜头功能：${item.purpose}；` : ''}画面：{item.visual}；{(item.dialogue || item.subtitle) ? `口播：“${item.dialogue || item.subtitle}”；` : ''}{item.onScreenText ? `屏幕文字：“${item.onScreenText}”；` : ''}配乐：{item.bgm || item.audio || '按原片节奏卡点'}
                        {item.note ? `（注：${item.note}）` : ''}
                      </p>}
                      {item.beats?.length ? <div className="mt-1.5 space-y-1 border-l-2 border-accent/30 pl-2">{item.beats.map((beat, beatIndex) => <p key={beatIndex} className="text-[10px] text-text-muted">[{beat.time || '镜头内'}] {beat.action}{beat.dialogue ? `；口播：${beat.dialogue}` : ''}{beat.onScreenText ? `；字幕：${beat.onScreenText}` : ''}</p>)}</div> : null}
                      {item.needsReview && <p className="mt-1 text-[10px] font-semibold text-amber-500">需人工复核 · 识别置信度 {Math.round((item.confidence ?? 0) * 100)}%</p>}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {activeBookmark === 'adapt' && (
            <motion.div key="adapt" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="space-y-3">
              <div className="rounded-lg border border-dashed p-3"
                style={{ borderColor: 'rgba(22,163,74,0.3)', background: 'rgba(22,163,74,0.04)' }}>
                <p className="mb-1.5 text-[10px] font-semibold text-accent">改编建议</p>
                <p className="text-[11px] leading-relaxed text-text-secondary">{analysis.adaptTip}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface-2 p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">可复用爆点</p>
                <div className="flex flex-wrap gap-1.5">
                  {referenceHighlights(video, analysis).slice(0, 6).map((item, index) => (
                    <span key={`${item}-${index}`} className="rounded-full border border-border bg-white px-2 py-1 text-[10px] font-semibold text-text-secondary">
                      {shortenText(item, 28)}
                    </span>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex-shrink-0 border-t border-border bg-surface p-4 shadow-[0_-10px_24px_rgba(15,23,42,0.04)]">
        {video.contentFormat !== 'image' && <div className="mb-3 rounded-lg border border-accent/20 bg-accent/5 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold text-text-primary">{analysisQuality.ready ? '全片精确分析版 · 质量校验通过' : video.aiAnalysis?.requestedAnalysisMode === 'exact' ? '全片精确分析排队中' : video.aiAnalysis?.analysisMode === 'exact' ? '全片精确分析未通过校验' : showStrategyProgress ? '自动策略分析处理中' : '全片策略分析版'}</p>
            {!analysisQuality.ready && <button type="button" onClick={onExactAnalysis} disabled={video.aiAnalysis?.requestedAnalysisMode === 'exact'} className="shrink-0 rounded-lg border border-accent bg-white px-2.5 py-1.5 text-[10px] font-semibold text-accent hover:bg-accent/5 disabled:cursor-wait disabled:opacity-50">{video.aiAnalysis?.requestedAnalysisMode === 'exact' ? '精确分析生成中…' : video.aiAnalysis?.analysisMode === 'exact' ? '重试全片精确分析' : '生成全片精确分析'}</button>}
          </div>
          {actionNotice && <p role="status" aria-live="polite" className="mt-2 rounded-lg border border-accent/20 bg-white px-2.5 py-2 text-[10px] font-semibold leading-relaxed text-text-secondary">{actionNotice}</p>}
          {video.aiAnalysis?.videoLevelFailureStatus && !video.aiAnalysis?.requestedAnalysisMode && <p role="status" aria-live="polite" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] font-semibold leading-relaxed text-amber-700">全片精确分析未完成，已保留原分析。可稍后重试，或换用可直接下载的公开素材。</p>}
        </div>}
        {video.contentFormat === 'image' && !hasTrustedImageAnalysis && <button type="button" onClick={() => void reanalyzeImage()} disabled={reanalyzingImage} className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 py-2 text-xs font-semibold text-blue-700 disabled:opacity-50">{reanalyzingImage ? <Loader2 size={13} className="animate-spin"/> : <Images size={13}/>}重新分析完整轮播</button>}
        {analysisSaveNotice && video.contentFormat === 'image' && <p className="mb-2 text-center text-[10px] text-red-500">{analysisSaveNotice}</p>}
        <button onClick={() => onGenerateScript(analysis || undefined)} disabled={(video.contentFormat === 'image' && !hasTrustedImageAnalysis) || videoGenerationBlocked}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-accent py-3 text-sm font-bold text-white transition-colors enabled:hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-50">
          <Sparkles size={16} />
          {video.contentFormat === 'image' ? (hasTrustedImageAnalysis ? '套用企业资料生成获客内容包' : '先完成图片分析') : videoGenerationBlocked ? '先完成合格的全片精确分析' : 'AI一键爆款迭代'}
          <ChevronRight size={15} />
        </button>
        {video.contentFormat !== 'image' && <button type="button" onClick={() => onPersonReplace(analysis || undefined)} disabled={videoGenerationBlocked} className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-violet-300 bg-white py-3 text-sm font-bold text-violet-700 transition-colors enabled:hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50">
          <ScanFace size={16}/>爆款分镜人物替换<ChevronRight size={15}/>
        </button>}
      </div>
    </div>
  );
}

// ── Script Panel ──────────────────────────────────────────────────────────────
interface ScriptPanelProps {
  video: TrendVideo;
  activePanelTab: 'analysis' | 'generate';
  onClose: () => void;
  onRetry?: () => void;
  onExactAnalysis?: () => void;
  actionNotice?: string;
  onFavorite?: () => void;
  favoriting?: boolean;
  specialRecommendation?: AccountSpecialRecommendation | null;
  onNavigate?: (p: Page) => void;
  onEnterWorkflow?: (payload: {
    source?: string;
    script?: string;
    video: TrendVideo;
    scriptType?: ScriptType;
    language?: string;
    productInfo?: string;
    materialRole?: 'hook';
    generatedVideo?: GeneratedVideo;
    referenceAnalysis?: {
      title?: string;
      visualStyle?: string;
      coreEmotion?: string;
      details?: { time: string; shot: string; camera: string; visual: string; subtitle?: string; audio?: string; note?: string }[];
    };
  }) => void;
}

interface GeneratedVideo {
  id: string;
  title: string;
  url?: string;
  poster?: string;
  duration: number;
  createdAt: string;
  source?: string;
  material?: Material;
  error?: string;
}

function ScriptPanel({ video, activePanelTab, onClose, onRetry, onExactAnalysis, actionNotice, onFavorite, favoriting, specialRecommendation, onNavigate, onEnterWorkflow }: ScriptPanelProps) {
  const reducedMotion = usePrefersReducedMotion();
  const panelRef = useModalFocus<HTMLDivElement>({ open: true, onClose });
  const [activeTab, setActiveTab] = useState<'analysis' | 'generate'>(activePanelTab);
  const [scriptType, setScriptType] = useState<ScriptType>('voiceover');
  const [language, setLanguage] = useState('zh');
  const [productInfo, setProductInfo] = useState('');
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [resultProvenance, setResultProvenance] = useState<ScriptResultProvenance | null>(null);
  const [resultQualityStatus, setResultQualityStatus] = useState<string>('');
  const [resultNotice, setResultNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [showLangDropdown, setShowLangDropdown] = useState(false);
  const languageDropdownRef = useRef<HTMLDivElement>(null);
  const [voiceLanguageConfirmed, setVoiceLanguageConfirmed] = useState(false);
  const [videoGenerating, setVideoGenerating] = useState(false);
  const [videoResult, setVideoResult] = useState<GeneratedVideo | null>(null);
  const [videoVersions, setVideoVersions] = useState<VideoGenerationVersion[]>([]);
  const [videoError, setVideoError] = useState('');
  const [refinementSyncError, setRefinementSyncError] = useState('');
  useDismissibleLayer(showLangDropdown, languageDropdownRef, () => setShowLangDropdown(false));
  const [expanded, setExpanded] = useState(false);
  const [seedanceVideoLocked, setSeedanceVideoLocked] = useState(true);
  const [productInfoOpen, setProductInfoOpen] = useState(false);

  const loadEnterpriseProducts = () => {
    fetch('/api/overseas/enterprise/profile', { headers: authHeader() })
      .then(r => r.ok ? r.json() : null)
      .then((profile: EnterpriseProfileForScript | null) => {
        if (!profile) return;
        const options = buildProductOptions(profile);
        setProductOptions(options);
        if (options[0]) {
          setSelectedProductId(current => current || options[0]!.id);
          setProductInfo(current => current.trim() ? current : options[0]!.info);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadEnterpriseProducts();
    fetch('/api/overseas/health')
      .then(r => r.ok ? r.json() : null)
      .then((health: { featureLocks?: { seedanceVideo?: boolean } } | null) => {
        setSeedanceVideoLocked(health?.featureLocks?.seedanceVideo !== false);
      })
      .catch(() => setSeedanceVideoLocked(true));
  }, []);

  useEffect(() => {
    loadEnterpriseProducts();
  }, [video.id]);

  useEffect(() => {
    if (activePanelTab) setActiveTab('analysis');
  }, [activePanelTab, video.id]);

  useEffect(() => {
    setResult(null);
    setResultProvenance(null);
    setResultQualityStatus('');
    setResultNotice('');
    setCopied(false);
    setShowLangDropdown(false);
    setVideoResult(null);
    setVideoError('');
    setProductInfoOpen(false);
    void studioApi.listVideoVersions(`inspiration:${video.id}:full`).then(versions => {
      setVideoVersions(versions);
      const item = versions.find(version => version.isSelected) || versions[0];
      if (item) setVideoResult({ id: item.materialId || item.id, title: item.title, url: item.url, poster: item.poster, duration: item.duration, createdAt: item.createdAt, source: item.source });
    });
  }, [video.id]);

  useEffect(() => {
    setVoiceLanguageConfirmed(false);
  }, [language, scriptType, video.id]);

  useEffect(() => {
    if (!isDemoTrafficStep()) return;
    setVoiceLanguageConfirmed(true);
  }, [video.id]);

  const handleSelectProduct = (id: string) => {
    setSelectedProductId(id);
    const option = productOptions.find(item => item.id === id);
    if (option) setProductInfo(option.info);
  };

  const handleGenerate = async () => {
    const shouldAdvanceDemo = isDemoTrafficStep();
    setGenerating(true);
    setResult(null);
    setResultProvenance(null);
    setResultQualityStatus('');
    setResultNotice('');
    setVideoResult(null);
    setVideoError('');
    const realAnalysis = getAnalysis(video);
    const analyzedDuration = (realAnalysis?.scriptDetails15s || []).reduce((max, item) => {
      const values = String(item.time || '').match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
      return Math.max(max, values[1] ?? values[0] ?? 0);
    }, 0);
    const fullVideoDuration = Math.max(1, Math.ceil(video.duration || analyzedDuration || 15));
    const languageLabel = LANGUAGES.find(l => l.code === language)?.label;
    const fallbackScript = makeFallbackScript(video, realAnalysis, productInfo, languageLabel, language, scriptType);
    try {
      const response = await studioApi.script(
        {
          materials: [
            `参考视频标题仅用于提炼节奏，不得复述：${shortenText(video.title, 80)}`,
            `平台：${video.platform}`,
            video.views ? `热度：${video.views}` : '',
            video.tags.length ? `标签仅用于判断受众，不得原样输出：${video.tags.slice(0, 8).join('、')}` : '',
          ].filter(Boolean),
          productInfo,
          language,
          platform: video.platform,
          duration: fullVideoDuration,
          scriptType,
          referenceTitle: video.title,
          referenceAnalysis: referenceAnalysisText(video, realAnalysis),
          referenceHighlights: referenceHighlights(video, realAnalysis),
          tone: '真实、可拍、B2B询盘导向，避免空泛营销话术',
        },
        fallbackScript,
      );
      const responseScript = String(response.script || '').trim();
      const rejectedDraft = response.source === 'ai_rejected' && responseScript;
      if (rejectedDraft) {
        setResult(responseScript);
        setResultProvenance('ai_rejected');
        setResultQualityStatus('rejected');
        setResultNotice(response.error || response.validationIssues?.join('；') || 'AI 草稿未通过事实或质量校验，仅供修改，不可进入视频生成或交付。');
        return;
      }
      if (response.ok === false || response.source !== 'ai' || !responseScript) {
        setResult(fallbackScript);
        setResultProvenance('template');
        setResultQualityStatus('fallback');
        setResultNotice(response.error || 'AI 生成失败。以下仅为本地空白草稿模板，未调用模型、未经质检，不可进入视频生成或交付。');
        return;
      }
      setResult(responseScript);
      setResultProvenance('ai');
      setResultQualityStatus(response.qualityStatus || 'warning');
      setResultNotice(response.qualityStatus === 'passed'
        ? 'AI 脚本已通过当前质量校验。'
        : 'AI 脚本已生成，但尚未获得“质量通过”结论；请先人工复核。');
      if (shouldAdvanceDemo) {
        completeDemoStep('traffic');
        window.setTimeout(() => onNavigate?.('conversion'), 700);
      }
    } catch (error) {
      setResult(fallbackScript);
      setResultProvenance('template');
      setResultQualityStatus('fallback');
      setResultNotice(`${error instanceof Error ? error.message : 'AI 生成失败'}。以下仅为本地空白草稿模板，未调用模型、未经质检，不可进入视频生成或交付。`);
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = () => {
    if (result) { void navigator.clipboard.writeText(result); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  const generateSeedanceVideo = async () => {
    if (!result) return;
    if (resultProvenance !== 'ai' || ['rejected', 'failed', 'fallback'].includes(resultQualityStatus)) {
      setVideoError('当前内容是本地模板或未通过校验的草稿，不能进入视频生成。请先成功生成并通过 AI 质量检查。');
      return;
    }
    if (seedanceVideoLocked) return;
    setVideoGenerating(true);
    setVideoError('');
    try {
      const duration = Math.max(4, Math.min(15, Math.round(video.duration || 8)));
      const output = await studioApi.seedanceVideo({
        script: result,
        productInfo,
        language,
        ratio: '9:16',
        duration,
        resolution: '720p',
        title: `Seedance 视频 · ${video.title}`,
        generationGroupKey: `inspiration:${video.id}:full`,
        generationContext: { entry: 'inspiration-full', videoId: video.id, scriptType, language },
        parentVersionId: videoVersions.find(item => item.isSelected)?.id,
      });
      if (!output.ok || !output.url) {
        throw new Error(output.error || 'Seedance 未返回可预览的视频地址');
      }
      setVideoResult({
        id: output.material?.id || output.id || `seedance-video-${video.id}-${Date.now()}`,
        title: output.material?.name || output.title || `Seedance 视频 · ${video.title}`,
        url: output.material?.url || output.url,
        poster: output.material?.poster || output.poster || video.aiAnalysis?.materialPoster || video.thumbnail,
        duration: output.duration || duration,
        createdAt: output.createdAt || new Date().toISOString(),
        source: output.source,
        material: output.material,
        error: output.error,
      });
      if (output.version) setVideoVersions(current => [output.version!, ...current.map(item => ({ ...item, isSelected: false }))]);
    } catch (err: any) {
      setVideoError(String(err?.message || err || 'Seedance 视频生成失败'));
    } finally {
      setVideoGenerating(false);
    }
  };

  const enterWorkflow = () => {
    if (!result || !videoResult || resultProvenance !== 'ai' || ['rejected', 'failed', 'fallback'].includes(resultQualityStatus)) return;
    onEnterWorkflow?.({ source: 'seedance_video', script: result, video, scriptType, language, productInfo, generatedVideo: videoResult });
  };

  const enterQuickCutFromAnalysis = (confirmedAnalysis?: ScriptAnalysis) => {
    const realAnalysis = confirmedAnalysis || getAnalysis(video);
    setRefinementSyncError('');
    onEnterWorkflow?.({
      source: video.contentFormat === 'image' ? 'inspiration_image_post' : 'inspiration_analysis',
      video,
      scriptType: 'storyboard',
      language,
      productInfo,
      referenceAnalysis: realAnalysis ? {
        title: video.title,
        visualStyle: realAnalysis.scriptSummary15s.visualStyle,
        coreEmotion: realAnalysis.scriptSummary15s.coreEmotion,
        details: realAnalysis.scriptDetails15s,
      } : undefined,
    });
    onClose();

    // Navigation must not wait for the optional scheduler sync. A slow or failed
    // sync used to make the primary CTA appear broken even though the editor
    // payload was already ready.
    if (video.contentFormat !== 'image' && video.recordId) {
      void (async () => {
        try {
          const response = await fetch(`/api/overseas/videos/${video.recordId}/refinement-sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader() },
            body: JSON.stringify({ source: 'inspiration_analysis' }),
          });
          const payload = await response.json().catch(() => ({})) as { error?: string };
          if (!response.ok) throw new Error(payload.error || '精修视频同步失败');
        } catch (error) {
          console.warn('精修视频同步失败，已继续进入内容创作。', error);
        }
      })();
    }
  };

  const enterPersonReplacement = (confirmedAnalysis?: ScriptAnalysis) => {
    const realAnalysis = confirmedAnalysis || getAnalysis(video);
    onEnterWorkflow?.({
      source: 'inspiration_person_replace',
      video,
      scriptType: 'storyboard',
      language,
      productInfo,
      referenceAnalysis: realAnalysis ? {
        title: video.title,
        visualStyle: realAnalysis.scriptSummary15s.visualStyle,
        coreEmotion: realAnalysis.scriptSummary15s.coreEmotion,
        details: realAnalysis.scriptDetails15s,
      } : undefined,
    });
    onClose();
  };

  const selectedLang = LANGUAGES.find(l => l.code === language);

  return (
    <motion.div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={video.contentFormat === 'image' ? '竞品图文拆解' : '爆款视频拆解'}
      initial={{ opacity: 0, x: 32 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 32 }}
      transition={reducedMotion ? { duration: 0 } : {
        ...lsMotion.spring.standard,
        opacity: { duration: lsMotion.duration.enter / 1000, ease: lsMotion.ease.enter },
      }}
      className={`fixed top-0 z-50 flex h-full max-w-full flex-col border-l border-border bg-surface ${
        expanded ? 'left-0 right-0 w-auto shadow-xl' : 'right-0 w-[420px] shadow-lg'
      }`}>

      {/* Header */}
      <div className="flex items-start justify-between px-4 py-3.5 border-b border-border flex-shrink-0">
        <div className="flex-1 min-w-0 pr-3">
          <p className="text-[10px] font-mono text-text-muted uppercase tracking-widest mb-1">{video.contentFormat === 'image' ? '竞品图文参考' : 'AI 脚本助手'}</p>
          <h3 className="text-sm font-semibold text-text-primary leading-snug line-clamp-2">{video.title}</h3>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {video.sourceUrl && (
            <button onClick={onFavorite} disabled={favoriting}
              className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-primary transition-colors disabled:opacity-60"
              title="收藏到爆款素材">
              {favoriting ? <Loader2 size={15} className="animate-spin" /> : <Bookmark size={15} />}
            </button>
          )}
          <button onClick={() => setExpanded(v => !v)}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-primary transition-colors"
            title={expanded ? '还原侧栏' : '放大为主操作界面'}>
            {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button type="button" data-modal-initial-focus onClick={onClose} aria-label="关闭爆款详情" title="关闭" className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary">
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0.5 px-4 py-2 border-b border-border flex-shrink-0">
        {([
          { id: 'analysis' as const, icon: <BarChart2 size={12} />, label: video.contentFormat === 'image' ? '竞品图文拆解' : '脚本分析' },
        ]).map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition-colors ${
              activeTab === tab.id ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-secondary'
            }`}>
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'analysis' ? (
          <motion.div key="analysis" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <AnalysisPanel key={video.id} video={video} onGenerateScript={enterQuickCutFromAnalysis} onPersonReplace={enterPersonReplacement} onRetry={onRetry} onExactAnalysis={onExactAnalysis} actionNotice={refinementSyncError || actionNotice} specialRecommendation={specialRecommendation} />
          </motion.div>
        ) : (
          <motion.div key="generate" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex flex-col flex-1 min-h-0 overflow-hidden">

            {/* Language selection */}
            <div className="px-4 py-3 border-b border-border flex-shrink-0 space-y-2.5">
              <p className="text-[11px] font-semibold text-text-primary">语言选择</p>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border">
                  {([
                    { type: 'voiceover' as ScriptType, icon: <FileText size={12} />, label: '口播' },
                    { type: 'storyboard' as ScriptType, icon: <LayoutIcon size={12} />, label: '分镜' },
                  ] as const).map(({ type, icon, label }) => (
                    <button key={type} onClick={() => setScriptType(type)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                        scriptType === type ? 'bg-surface text-text-primary shadow-none' : 'text-text-muted hover:text-text-secondary'
                      }`}>
                      {icon}<span>{label}</span>
                    </button>
                  ))}
                </div>
                <div ref={languageDropdownRef} className="relative flex-1">
                  <button onClick={() => setShowLangDropdown(v => !v)}
                    className="w-full flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface text-xs text-text-secondary hover:border-border-bright transition-colors">
                    <Globe size={11} className="text-text-muted flex-shrink-0" />
                    <span className="flex-1 text-left">{selectedLang?.label}</span>
                    <ChevronDown size={11} className={`text-text-muted transition-transform ${showLangDropdown ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {showLangDropdown && (
                      <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
                        className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-border bg-surface z-10 overflow-hidden shadow-lg">
                        <div className="p-1 max-h-44 overflow-y-auto">
                          {LANGUAGES.map(lang => (
                            <button key={lang.code} onClick={() => { setLanguage(lang.code); setShowLangDropdown(false); }}
                              className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs hover:bg-surface-2 transition-colors">
                              <span className={language === lang.code ? 'text-accent font-semibold' : 'text-text-primary'}>{lang.label}</span>
                              {language === lang.code && <Check size={11} className="text-accent" />}
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
              <label className="flex items-start gap-2 text-xs text-text-secondary leading-relaxed cursor-pointer">
                <input type="checkbox" checked={voiceLanguageConfirmed} onChange={e => setVoiceLanguageConfirmed(e.target.checked)}
                  className="mt-0.5 accent-blue-600" />
                <span>
                  确认口播台词以<span className="font-semibold text-accent"> {selectedLang?.label || '所选语言'} </span>输出
                </span>
              </label>
            </div>

            {/* Product selection */}
            <div className="px-4 py-3 border-b border-border flex-shrink-0 bg-surface-2/40">
              <div className="overflow-hidden rounded-lg border border-border bg-surface transition-colors focus-within:border-accent">
                <div className="px-3 pt-3 pb-2 border-b border-border/70">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-text-primary truncate">产品选择：{getPrimaryProductLabel(productInfo)}</p>
                      <p className="text-[10px] text-text-muted">选择企业中心里的自己的产品信息</p>
                    </div>
                    <button onClick={() => setProductInfoOpen(v => !v)}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors flex-shrink-0">
                      {productInfoOpen ? '收起' : '展开'}
                      <ChevronDown size={11} className={`transition-transform ${productInfoOpen ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                  {productOptions.length > 0 && (
                    <select value={selectedProductId} onChange={e => handleSelectProduct(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-xs font-semibold text-text-primary outline-none focus:border-accent">
                      {productOptions.map(option => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                  )}
                </div>
                <AnimatePresence initial={false}>
                  {productInfoOpen && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden">
                      <textarea value={productInfo} readOnly
                        placeholder="请先在企业中心维护并确认产品资料"
                        rows={4}
                        className="w-full resize-none bg-transparent px-4 py-3 text-sm text-text-primary outline-none placeholder:text-text-muted" />
                      <p className="px-4 pb-3 text-[10px] leading-relaxed text-text-muted">此处只读，商业事实仅来自企业中心。需要修改时请先回企业中心更新资料。</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Script output */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold text-text-primary">脚本输出区</p>
                  <p className="text-[10px] text-text-muted mt-0.5">{scriptType === 'voiceover' ? '口播脚本' : '分镜脚本'} · {selectedLang?.label}</p>
                </div>
                <button
                  data-demo-target="traffic_script_generate"
                  onClick={() => void handleGenerate()}
                  disabled={generating || !voiceLanguageConfirmed || !selectedProductId || !productInfo.trim()}
                  title={!selectedProductId || !productInfo.trim() ? '请先在企业中心维护并选择产品' : voiceLanguageConfirmed ? '生成脚本' : '请先确认口播输出语言'}
                  className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-white transition-colors hover:bg-accent-dim disabled:opacity-50">
                  {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  生成脚本
                </button>
              </div>
              {!result && !generating && (
                <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-surface-2/50 text-center">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center bg-surface-2 border border-border">
                    <Sparkles size={18} className="text-text-muted" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-text-primary">基于 "{video.title}" 的脚本结构</p>
                    <p className="text-xs text-text-muted mt-0.5">选择企业中心主推品，生成口播或分镜脚本</p>
                  </div>
                </div>
              )}
              {generating && (
                <div className="flex gap-3">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 bg-accent">
                    <Loader2 size={12} className="text-white animate-spin" />
                  </div>
                  <div className="rounded-lg rounded-tl-sm border border-border bg-surface-2 px-4 py-3">
                    <span role="status" className="ls-type-body-small text-text-secondary">正在生成脚本…</span>
                  </div>
                </div>
              )}
              {result && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3">
                  <div className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${resultProvenance === 'ai' ? 'bg-accent' : 'bg-amber-500'}`}>
                    <Sparkles size={12} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`mb-2 rounded-lg border px-3 py-2 text-[10px] font-semibold leading-relaxed ${resultProvenance === 'ai' && resultQualityStatus === 'passed' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : resultProvenance === 'ai' ? 'border-sky-200 bg-sky-50 text-sky-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                      <p className="font-semibold">{resultProvenance === 'ai'
                        ? resultQualityStatus === 'passed' ? 'AI 生成 · 质量校验通过' : 'AI 草稿 · 待人工复核'
                        : resultProvenance === 'ai_rejected' ? 'AI 草稿 · 质量校验未通过' : '本地草稿模板 · 未调用 AI'}</p>
                      {resultNotice && <p className="mt-1">{resultNotice}</p>}
                    </div>
                    <div className="rounded-lg rounded-tl-sm border border-border bg-surface-2 px-4 py-3">
                      <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-line font-mono">{result}</p>
                    </div>
                    <div className="flex items-center gap-4 mt-1.5 px-1">
                      <button onClick={handleCopy} className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors">
                        {copied ? <><Check size={11} className="text-green" /><span className="text-green">已复制</span></> : <><Copy size={11} /><span>复制</span></>}
                      </button>
                      <button type="button" onClick={() => openScriptLibrary({ tab: 'inspiration', contentId: video.id, query: video.title || '', openDetail: true })} className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors">
                        <ArrowRight size={11} /><span>保存到脚本库</span>
                      </button>
                    </div>

                    {getAnalysis(video) && (
                      <div className="mt-3 space-y-3">
                        {!videoResult ? (
                          <>
                            {seedanceVideoLocked ? (
                              <div className="overflow-hidden rounded-lg border border-border bg-surface">
                                <div className="flex gap-3 p-3">
                                  <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-surface-2 border border-border">
                                    <Lock size={15} className="text-text-muted" />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs font-semibold text-text-primary">Seedance 视频生成 · 接口待启用</p>
                                    <p className="mt-1 text-[11px] text-text-muted leading-relaxed">
                                      当前环境未启用 Seedance 真实生成。启用后会先生成并展示输出视频，确认效果后再进入剪辑流程。
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <button onClick={() => void generateSeedanceVideo()} disabled={videoGenerating || resultProvenance !== 'ai' || ['rejected', 'failed', 'fallback'].includes(resultQualityStatus)}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white transition-all active:scale-95 disabled:opacity-70"
                                style={{ background: 'var(--color-accent)' }}>
                                {videoGenerating ? <Loader2 size={13} className="animate-spin" /> : <Film size={13} />}
                                {videoGenerating ? 'Seedance 生成视频中…' : '基于脚本用 Seedance 生成视频'}
                              </button>
                            )}
                            {videoError && (
                              <p className="text-[11px] text-red-500 leading-relaxed">{videoError}</p>
                            )}
                          </>
                        ) : (
                          <div className="overflow-hidden rounded-lg border border-border bg-surface">
                            <div className="flex gap-3 p-3">
                              <div className="relative w-24 aspect-[9/16] flex-shrink-0 overflow-hidden rounded-lg bg-black">
                                {videoResult.url ? (
                                  <video src={videoResult.url} poster={videoResult.poster} controls playsInline className="absolute inset-0 h-full w-full object-cover" />
                                ) : (
                                  <img src={videoResult.poster} alt="" className="absolute inset-0 h-full w-full object-cover" />
                                )}
                                <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[9px] font-bold text-white">Seedance</span>
                              </div>
                              <div className="min-w-0 flex-1 py-0.5">
                                <p className="text-xs font-semibold text-text-primary line-clamp-2">Seedance 输出视频</p>
                                {videoVersions.length > 0 && <div className="mt-2 flex flex-wrap gap-1">
                                  {videoVersions.map(item => <button key={item.id} type="button" onClick={async () => {
                                    await studioApi.selectVideoVersion(item.id);
                                    setVideoVersions(current => current.map(v => ({ ...v, isSelected: v.id === item.id })));
                                    setVideoResult({ id: item.materialId || item.id, title: item.title, url: item.url, poster: item.poster, duration: item.duration, createdAt: item.createdAt, source: item.source });
                                  }} className={`rounded-md border px-2 py-1 text-[10px] font-bold ${item.isSelected ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-muted'}`}>V{item.versionNumber}</button>)}
                                </div>}
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <button onClick={() => void generateSeedanceVideo()} disabled={videoGenerating || resultProvenance !== 'ai' || ['rejected', 'failed', 'fallback'].includes(resultQualityStatus)}
                                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border text-[11px] font-semibold text-text-secondary hover:text-text-primary disabled:opacity-60">
                                    {videoGenerating ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} 重新生成
                                  </button>
                                  <button onClick={enterWorkflow} disabled={resultProvenance !== 'ai' || ['rejected', 'failed', 'fallback'].includes(resultQualityStatus)}
                                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-white"
                                    style={{ background: 'var(--color-accent)' }}>
                                    <ArrowRight size={11} /> 进入剪辑流程
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Video Card (grid) ─────────────────────────────────────────────────────────

interface CrawlerRecord {
  id: string;
  platform?: Exclude<Platform, 'all'>;
  title?: string;
  thumbnailUrl?: string;
  duration?: number;
  sourceUrl?: string;
  tags?: string;
  aiAnalysis?: string;
  status?: 'pending' | 'analyzed' | 'failed';
  videoFileId?: string;
  crawledAt?: string;
  canManage?: boolean;
}

export function parseExactAnalysisResponse(raw: string, status: number): { error?: string; status?: string; reused?: boolean; id?: string } {
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; status?: unknown; reused?: unknown; id?: unknown };
    return {
      error: typeof parsed.error === 'string' ? parsed.error : undefined,
      status: typeof parsed.status === 'string' ? parsed.status : undefined,
      reused: typeof parsed.reused === 'boolean' ? parsed.reused : undefined,
      id: typeof parsed.id === 'string' ? parsed.id : undefined,
    };
  } catch {
    return { error: `全片精确分析接口返回异常（HTTP ${status}）` };
  }
}

function parseRecordTags(tags?: string): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags) as unknown;
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function recordsToVideos(records: CrawlerRecord[]): TrendVideo[] {
  return records
    .filter((r): r is CrawlerRecord & { id: string; platform: Exclude<Platform, 'all'> } => Boolean(r.id && r.platform))
    .map(record => {
      let views = '—';
      let analysis: VideoAnalysisPayload = {};
      try {
        analysis = JSON.parse(record.aiAnalysis || '{}') as VideoAnalysisPayload;
        if (analysis.views) views = analysis.views;
      } catch {}
      const trend = trendFromEvidence(analysis);
      const title = record.title || 'Untitled crawled video';
      const tags = parseRecordTags(record.tags);
      const recordThumbnail = record.thumbnailUrl || (record.videoFileId ? `/api/overseas/videos/${record.id}/thumbnail` : '');
      if (!analysis.gemini && analysis.contentFormat !== 'image') {
        analysis = {
          ...analysis,
          gemini: metadataFallbackAnalysis(title, record.platform, tags, views, Number(record.duration || 0)),
          analysisSource: 'metadata-fallback',
          analysisQuality: 'metadata',
        };
      }
      return {
        id: `crawl-${record.id}`,
        recordId: record.id,
        platform: record.platform,
        title,
        thumbnail: recordThumbnail,
        duration: Number(record.duration || 0),
        tags,
        views,
        trend,
        // videoFileId 本身就是 PocketBase 文件存在的权威凭据；不要再依赖可缺失的迁移标记。
        videoUrl: record.videoFileId ? `/api/overseas/videos/${record.id}/media-url` : undefined,
        sourceUrl: record.sourceUrl,
        status: record.status,
        aiAnalysis: analysis,
        crawledAt: record.crawledAt,
        contentFormat: contentFormatOfAnalysis(analysis),
      canManage: Boolean(record.canManage),
      };
    })
    // 历史记录在后台回填 PocketBase 时仍展示封面，避免管理员视频池因存储迁移暂时变成空列表。
    // 同一 sourceUrl 只保留一条（demo 数据/多次采集可能带来 id 不同的重复视频）
    .filter((video, index, all) => !video.sourceUrl || all.findIndex(v => v.sourceUrl === video.sourceUrl) === index)
    .sort((a, b) => heatValue(b.views) - heatValue(a.views));
}

function supplyItemsToVideos(items: SocialDiscoverySupplyItem[]): TrendVideo[] {
  const records = items.flatMap(item => {
    if (!ACTIVE_PLATFORMS.includes(item.platform as Exclude<Platform, 'all'>)) return [];
    const raw = item.raw || {};
    let analysis: Record<string, unknown> = {};
    if (typeof raw.aiAnalysis === 'string') {
      try { analysis = JSON.parse(raw.aiAnalysis) as Record<string, unknown>; } catch { analysis = {}; }
    } else if (raw.aiAnalysis && typeof raw.aiAnalysis === 'object' && !Array.isArray(raw.aiAnalysis)) {
      analysis = raw.aiAnalysis as Record<string, unknown>;
    }
    return [{
      ...raw,
      id: item.candidateId,
      platform: item.platform as Exclude<Platform, 'all'>,
      title: item.title,
      sourceUrl: item.sourceUrl,
      thumbnailUrl: item.thumbnailUrl || String(raw.thumbnailUrl || ''),
      aiAnalysis: JSON.stringify({ ...analysis, author: item.author || analysis.author, discoveryScore: item.score, discoveryBusinessModel: item.businessModel }),
      crawledAt: String(raw.crawledAt || item.publishedAt || item.score.scoredAt),
    } satisfies CrawlerRecord];
  });
  return recordsToVideos(records);
}

function metadataFallbackAnalysis(
  title: string,
  platform: Exclude<Platform, 'all'>,
  tags: string[],
  views: string,
  duration: number,
): GeminiVideoAnalysis {
  const topic = tags.length ? tags.slice(0, 3).join(' / ') : title;
  return {
    theme: `${PLATFORM_META[platform]?.label ?? platform} 基础分析：${title}`,
    hooks: [
      `用标题承诺切入：${title}`,
      views && views !== 'New' ? `用热度做社会证明：${views}` : '先展示结果或冲突，再解释产品',
      tags[0] ? `前三秒围绕 ${tags[0]} 放大场景痛点` : '前三秒突出产品效果或反差',
    ],
    sellingPoints: tags.length ? tags.map(tag => `可围绕 ${tag} 做卖点展开`) : ['产品演示', '痛点解决', '结果证明', '行动引导'],
    mood: platform === 'youtube' ? '信息型 / 评测型' : '快节奏 / 社媒感',
    structure: `标题/封面钩子 → 场景痛点 → ${topic} → 证明细节 → CTA`,
    recommendedScriptType: duration > 60 ? 'storyboard' : 'voiceover',
  };
}

function metadataPanelFallback(video: TrendVideo): TrendVideo {
  if (video.aiAnalysis?.analysisSource === 'metadata-fallback' && video.aiAnalysis?.analysisQuality === 'metadata') {
    return video;
  }
  return {
    ...video,
    aiAnalysis: {
      ...(video.aiAnalysis || {}),
      gemini: metadataFallbackAnalysis(video.title, video.platform, video.tags, video.views, video.duration),
      analysisSource: 'metadata-fallback',
      analysisQuality: 'metadata',
      geminiStatus: 'metadata_fallback',
      downloadStatus: 'metadata_only',
    },
  };
}

function heatValue(views: string): number {
  const raw = String(views || '').toLowerCase().replace(/,/g, '');
  const n = Number(raw.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n)) return 0;
  if (raw.includes('亿') || raw.includes('b')) return n * 100000000;
  if (raw.includes('万')) return n * 10000;
  if (raw.includes('m') || raw.includes('百万')) return n * 1000000;
  if (raw.includes('k') || raw.includes('千')) return n * 1000;
  return n;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function reliablePublicViews(value: string): number {
  if (!/\d/.test(value) || /shares?|likes?|facebook|instagram|tiktok|youtube|本地素材/i.test(value)) return 0;
  return heatValue(value);
}

export function inspirationScoresForVideo(video: TrendVideo) {
  const analysis = video.aiAnalysis;
  if (analysis?.discoveryScore) return {
    sourcePriority: analysis.discoveryScore.dimensions.platformPriority,
    contentOpportunityScore: analysis.discoveryScore.overall,
    relativePerformance: null,
    reasons: analysis.discoveryScore.reasons,
  };
  const relative = analysis?.publicBaseline?.relativeMultiple ?? analysis?.relativeViewMultiple ?? null;
  const ageDays = Math.max(0, (Date.now() - timeValue(video.crawledAt)) / 86_400_000);
  const freshness = ageDays <= 3 ? 1 : ageDays <= 7 ? 0.8 : ageDays <= 30 ? 0.5 : 0.2;
  const baselineTypeWeight = analysis?.accountBaselineLevel === 'low' ? 1
    : analysis?.accountBaselineLevel === 'medium' ? 0.8
      : analysis?.accountBaselineLevel === 'high' ? 0.65 : 0.5;
  const exactAnalysis = analysis?.analysisQuality === 'video' || analysis?.imageEvidence?.status === 'analyzed';
  return scoreSocialInspirationCandidate({
    platformWeight: 0.8,
    accountWeight: analysis?.sourceAccount ? 0.8 : 0.4,
    accountTypeWeight: baselineTypeWeight,
    industryRelevance: video.tags.length > 0 ? 0.7 : 0.4,
    strategyMatch: analysis?.keyword || analysis?.crawlRule ? 0.8 : 0.5,
    currentPerformance: relative,
    accountPlatformBaseline: relative === null ? null : 1,
    engagementQuality: analysis?.publicBaseline?.status === 'usable' ? 0.75 : 0.45,
    freshness,
    weeklyGoalRelevance: 0.5,
    structuralTransferability: exactAnalysis ? 0.9 : 0.4,
    evidenceQuality: exactAnalysis ? 0.85 : 0.3,
  });
}

export function candidateDimensionLabels(video: TrendVideo): { relevance: string; momentum: string; transferability: string } {
  const evidence = video.aiAnalysis?.candidateEvidence;
  const relevance = evidence?.relevance?.level === 'high' ? '强相关'
    : evidence?.relevance?.level === 'medium' ? '需核对' : evidence?.relevance?.level === 'low' ? '弱相关' : '相关性待确认';
  const momentum = evidence?.momentum?.level === 'rising' ? '正在起量'
    : evidence?.momentum?.level === 'high_performance' ? '高表现' : '趋势未知';
  const transferability = evidence?.transferability?.level === 'high' ? '易迁移'
    : evidence?.transferability?.level === 'medium' ? '可迁移' : evidence?.transferability?.level === 'low' ? '难迁移' : '迁移性待确认';
  return { relevance, momentum, transferability };
}

export function latestDiscoveryOrigin(video: TrendVideo) {
  return video.aiAnalysis?.discoveryOrigins?.at(-1);
}

export function discoverySupplyLabel(video: TrendVideo): string {
  const mode = latestDiscoveryOrigin(video)?.mode;
  return mode === 'momentum' ? '行业起量' : mode === 'account' ? '确认对标' : mode === 'innovation' ? '创新参考' : '来源待归类';
}

export function discoveryOriginTitle(video: TrendVideo): string {
  const origin = latestDiscoveryOrigin(video);
  return origin ? `范围 v${origin.scopeVersion} · 运行 ${origin.runId} · 依据 ${origin.queryRef}` : '历史素材尚无发现运行溯源';
}

function specialRecommendationForVideo(video: TrendVideo, accountVideos: TrendVideo[], accountMedians: number[]): AccountSpecialRecommendation | null {
  const analysis = video.aiAnalysis;
  if (!analysis?.sourceAccount) return null;
  const currentViews = reliablePublicViews(video.views);
  const history = accountVideos.map(item => reliablePublicViews(item.views)).filter(value => value > 0);
  if (!currentViews || history.length < 8) return null;
  const baselineValue = median(history);
  if (!baselineValue) return null;
  const multiple = currentViews / baselineValue;
  let baselineLevel = analysis.accountBaselineLevel;
  if (!baselineLevel && accountMedians.length >= 3) {
    const sorted = [...accountMedians].sort((a, b) => a - b);
    const percentile = sorted.filter(value => value <= baselineValue).length / sorted.length;
    baselineLevel = percentile <= .3 ? 'low' : percentile <= .7 ? 'medium' : 'high';
  }
  if (!baselineLevel) return null;
  const baseline = baselineLevel === 'low' ? '低基线账号' : baselineLevel === 'medium' ? '中基线账号' : '高基线账号';
  const level = baselineLevel === 'low' && multiple >= 10 ? '极高'
    : baselineLevel === 'low' && multiple >= 5 ? '高'
    : baselineLevel === 'medium' && multiple >= 5 ? '高'
    : baselineLevel === 'high' && multiple >= 3 ? '较高' : null;
  if (!level) return null;
  return { level, baseline, multiple, message: `${baseline}跑出日常 ${multiple.toFixed(1)} 倍播放，内容结构具有${level}借鉴价值，建议优先拆解复用。` };
}

function timeValue(value?: string): number {
  const t = value ? new Date(value).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

function sourceEmbedUrl(video: TrendVideo): string {
  const source = String(video.sourceUrl || '').trim();
  if (!source) return '';
  try {
    const url = new URL(source);
    if (video.platform === 'youtube') {
      const id = url.hostname.includes('youtu.be')
        ? url.pathname.split('/').filter(Boolean)[0]
        : url.searchParams.get('v') || url.pathname.match(/\/(?:shorts|embed)\/([^/?#]+)/)?.[1];
      return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0` : '';
    }
    if (video.platform === 'tiktok') {
      const id = url.pathname.match(/\/video\/(\d+)/)?.[1];
      return id ? `https://www.tiktok.com/player/v1/${id}?autoplay=1` : '';
    }
    if (video.platform === 'instagram' && /\/(?:reel|p|tv)\//i.test(url.pathname)) {
      return `${source.replace(/[?#].*$/, '').replace(/\/$/, '')}/embed/`;
    }
  } catch { /* malformed URLs fall back to the original-site action */ }
  return '';
}

function WatchModal({ video, onClose }: { video: TrendVideo; onClose: () => void }) {
  const embedUrl = sourceEmbedUrl(video);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(Boolean(video.videoUrl));
  const [previewError, setPreviewError] = useState('');
  const [useEmbedPlayer, setUseEmbedPlayer] = useState(false);
  const retryPreview = () => {
    setPreviewError('');
    setPreviewLoading(Boolean(video.videoUrl));
    setUseEmbedPlayer(false);
    setPreviewAttempt(value => value + 1);
  };
  return (
    <Modal open title={video.title} width={840} zIndex={2200} onCancel={onClose}
      footer={<div className="flex justify-end gap-2">{video.sourceUrl && <Button onClick={() => window.open(video.sourceUrl, '_blank', 'noopener,noreferrer')}>原站打开</Button>}<Button onClick={onClose}>关闭</Button></div>}>
      <p className="mb-3 flex items-center gap-2 text-xs text-text-secondary"><SocialPlatformIcon platform={video.platform} size={14}/>{PLATFORM_META[video.platform]?.label ?? video.platform} · 视频预览</p>
        <div className="bg-black">
          {video.videoUrl && !useEmbedPlayer ? (
            <div className="relative flex min-h-64 items-center justify-center bg-black">
              <AuthenticatedVideo
                key={`${video.id}:${previewAttempt}`}
                apiUrl={video.videoUrl}
                poster={video.thumbnail}
                controls
                autoPlay
                className="max-h-[72vh] w-full bg-black"
                onReady={() => { setPreviewLoading(false); setPreviewError(''); }}
                onLoadingChange={setPreviewLoading}
                onError={message => { setPreviewLoading(false); setPreviewError(message || '视频预览失败'); }}
              />
              {previewLoading && !previewError && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45 text-white">
                  <span className="inline-flex items-center gap-2 rounded-lg bg-black/65 px-3 py-2 text-xs font-semibold"><Loader2 size={14} className="animate-spin" />正在准备视频…</span>
                </div>
              )}
              {previewError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 px-6 text-center text-white">
                  <Play size={28} className="opacity-70" />
                  <p className="mt-3 text-sm font-semibold">视频预览暂时失败</p>
                  <p className="mt-1 max-w-md text-xs leading-relaxed text-white/65">{previewError}</p>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                    <button type="button" onClick={retryPreview} className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-neutral-900">重新获取播放地址</button>
                    {embedUrl && <button type="button" onClick={() => { setPreviewError(''); setUseEmbedPlayer(true); }} className="rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-xs font-bold text-white">使用原站播放器</button>}
                  </div>
                </div>
              )}
            </div>
          ) : embedUrl ? (
            <iframe
              src={embedUrl}
              title={`${video.title} 站内播放器`}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              className="aspect-video w-full border-0 bg-black"
            />
          ) : (
            <div className="aspect-video flex flex-col items-center justify-center gap-3 text-white/70">
              <Play size={28} />
              <p className="text-sm">当前仅支持跳转原视频；分析用临时视频不会进入素材库</p>
            </div>
          )}
        </div>
    </Modal>
  );
}

interface DirectorReviewHandoff {
  status: 'review_only' | 'production_ready';
  directorHandoffReady?: boolean;
  selectedHookShotId?: string | null;
  shots: Array<{ shotId: string; startSeconds: number; endSeconds: number; content: string; purpose: string; issues: string[]; evidence: { clipRef?: string | null; firstFrameRef?: string | null; extractionStatus?: string } }>;
  issues: Array<{ code: string; shotId?: string | null; evidenceRefs?: string[]; action: string }>;
  productionExecutionAllowed: boolean;
}

const hookScriptLabels = { camera: '运镜', visual: '画面', subject: '出镜主体', music: '配乐', voiceover: '配音', soundEffects: '音效', spokenWords: '主体话术', subjectAction: '主体动作' } as const;
type HookScriptKey = keyof typeof hookScriptLabels;
const hookScriptKeys = Object.keys(hookScriptLabels) as HookScriptKey[];

interface DirectorShotReview {
  referenceRecordId: string;
  sourceAnalysisRunId: string | null;
  version: string;
  sections: Array<{ sectionId: string; title: string; start: number; end: number; purpose: string; confirmed: boolean }>;
  shots: Array<{ shotId: string; start: number; end: number; content: string; purpose: string; sourceShotIds: string[]; reviewStatus: 'candidate' | 'confirmed' | 'discarded'; mixedScene: boolean; labels: string[]; evidenceRefs: string[]; hookAction: string; hookMotionConfirmed: boolean; hookScript?: Record<HookScriptKey, string>; hookScriptConfirmed?: boolean }>;
  selectedHookShotId: string | null;
  reviewComplete: boolean;
  productionExecutionAllowed: false;
}

interface DirectorVerifiedSpeech {
  analysisRunId: string | null;
  sourceSha256: string | null;
  duration: number;
  status: string;
  coverageConfirmed: boolean;
  lines: Array<{ text: string; start: number; end: number; visibility: 'on_camera' | 'voiceover' | 'unknown'; speakerId?: string | null }>;
}

interface DirectorPhraseAsrJob {
  ok: boolean;
  status: 'needs_confirmation' | 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'uncertain' | 'submitting';
  taskId?: string;
  enabled: boolean;
  candidateLines: Array<{ text: string; start: number; end: number; precision: 'phrase'; provenance: string; visibility: 'unknown' }>;
}

interface DirectorSpeechTimeline {
  lines: Array<{ speechId: string; text: string; start: number; end: number; sectionIds: string[]; shotIds: string[]; visibility: string; timingPrecision: 'coarse' | 'phrase'; needsReview: boolean }>;
  coarseWindows: Array<{ speechId: string; text: string; start: number; end: number; sectionIds: string[] }>;
  sections: Array<{ sectionId: string; speechIds: string[]; coarseEvidenceIds: string[] }>;
  reviewQuestions: string[];
  productionReady: boolean;
}

const reviewSeconds = (value: number) => `${Number.isFinite(value) ? value.toFixed(2) : '—'}s`;

export function splitDirectorReviewedShot(review: DirectorShotReview, shotId: string, cut: number): DirectorShotReview {
  const current = review.shots.find(item => item.shotId === shotId);
  if (!current || !Number.isFinite(cut) || cut - current.start < 0.15 || current.end - cut < 0.15) throw new Error('invalid_review_cut');
  const left = { ...current, end: cut, reviewStatus: 'candidate' as const, mixedScene: false, evidenceRefs: [], hookMotionConfirmed: false, hookScriptConfirmed: false };
  const right = { ...current, shotId: `review-${Date.now()}`, start: cut, reviewStatus: 'candidate' as const, mixedScene: false, evidenceRefs: [], hookAction: '', hookMotionConfirmed: false, hookScript: undefined, hookScriptConfirmed: false };
  return { ...review, shots: review.shots.flatMap(item => item.shotId === shotId ? [left, right] : [item]), selectedHookShotId: review.selectedHookShotId === shotId ? null : review.selectedHookShotId };
}

export function reviseDirectorHookAction(review: DirectorShotReview, shotId: string, hookAction: string): DirectorShotReview {
  return { ...review, shots: review.shots.map(item => item.shotId === shotId ? { ...item, hookAction, hookMotionConfirmed: false } : item) };
}

export function asrCandidatesToReviewDraft(speech: DirectorVerifiedSpeech, candidates: DirectorPhraseAsrJob['candidateLines']): DirectorVerifiedSpeech {
  return { ...speech, coverageConfirmed: false, status: 'partial_review', lines: candidates.map(line => ({ text: line.text, start: line.start, end: line.end, visibility: 'unknown' })) };
}

function DirectorReviewWorkspace({ recordId, onPreview, handoff }: { recordId: string; onPreview: () => void; handoff: DirectorReviewHandoff | null }) {
  const [review, setReview] = useState<DirectorShotReview | null>(null);
  const [speech, setSpeech] = useState<DirectorVerifiedSpeech | null>(null);
  const [timeline, setTimeline] = useState<DirectorSpeechTimeline | null>(null);
  const [savedReview, setSavedReview] = useState('');
  const [previewShotId, setPreviewShotId] = useState<string | null>(null);
  const [asrJob, setAsrJob] = useState<DirectorPhraseAsrJob | null>(null);
  const [asrConsent, setAsrConsent] = useState(false);
  const [asrBusy, setAsrBusy] = useState(false);
  const [asrPolling, setAsrPolling] = useState(false);
  const [activeSection, setActiveSection] = useState(0);
  const [showCandidates, setShowCandidates] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = async () => {
    const [reviewResponse, speechResponse] = await Promise.all([
      fetch(`/api/overseas/videos/${encodeURIComponent(recordId)}/shot-review`, { headers: authHeader() }),
      fetch(`/api/overseas/videos/${encodeURIComponent(recordId)}/verified-speech`, { headers: authHeader() }),
    ]);
    if (!reviewResponse.ok) throw new Error('镜头审核记录读取失败');
    if (!speechResponse.ok) throw new Error('逐句口播记录读取失败');
    const nextReview = await reviewResponse.json() as DirectorShotReview;
    const nextSpeech = await speechResponse.json() as DirectorVerifiedSpeech;
    setReview(nextReview);
    setSavedReview(JSON.stringify([nextReview.sections, nextReview.shots, nextReview.selectedHookShotId]));
    setSpeech(nextSpeech);
    return { nextReview, nextSpeech };
  };
  const loadTimeline = async (nextReview: DirectorShotReview) => {
    const response = await fetch(`/api/overseas/videos/${encodeURIComponent(recordId)}/speech-timeline`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ sections: nextReview.sections.map(section => ({ sectionId: section.sectionId, title: section.title, start: section.start, end: section.end, purpose: section.purpose })) }),
    });
    if (!response.ok) throw new Error('口播与六段结构映射失败');
    setTimeline(await response.json() as DirectorSpeechTimeline);
  };
  const readPhraseAsr = async (confirmed: boolean) => {
    setAsrBusy(true);
    try {
      const response = await fetch(`/api/overseas/videos/${encodeURIComponent(recordId)}/phrase-asr`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ confirmed }),
      });
      const result = await response.json() as DirectorPhraseAsrJob & { error?: string };
      if (!response.ok) throw new Error(result.error || `句级 ASR 请求失败（HTTP ${response.status}）`);
      setAsrJob(result);
      setAsrPolling(result.status === 'PENDING' || result.status === 'RUNNING' || result.status === 'submitting');
      if (result.status === 'SUCCEEDED') setMessage('句级 ASR 候选已返回；请听原片逐句校对，并确认画内或画外音。');
      else if (result.status === 'FAILED' || result.status === 'uncertain') setMessage('句级 ASR 任务需要人工排查，不会自动重复付费提交。');
    } catch (error) { setAsrPolling(false); setMessage(error instanceof Error ? error.message : '句级 ASR 请求失败'); }
    finally { setAsrBusy(false); }
  };
  useEffect(() => {
    if (!asrPolling) return;
    const timer = window.setTimeout(() => void readPhraseAsr(false), 5000);
    return () => window.clearTimeout(timer);
  }, [asrPolling, asrJob, recordId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let active = true;
    void refresh().then(({ nextReview }) => { if (active) void loadTimeline(nextReview).catch(error => setMessage(String(error))); })
      .catch(error => { if (active) setMessage(error instanceof Error ? error.message : '复核记录读取失败'); });
    void readPhraseAsr(false);
    return () => { active = false; };
  }, [recordId]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveReview = async () => {
    if (!review) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/overseas/videos/${encodeURIComponent(recordId)}/shot-review`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ expectedVersion: review.version, sections: review.sections, shots: review.shots, selectedHookShotId: review.selectedHookShotId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '保存镜头审核失败');
      setReview(result as DirectorShotReview);
      setSavedReview(JSON.stringify([(result as DirectorShotReview).sections, (result as DirectorShotReview).shots, (result as DirectorShotReview).selectedHookShotId]));
      await loadTimeline(result as DirectorShotReview);
      setMessage('六段结构与镜头审核已保存；仍需完成所有质量门槛才可交接制作。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { setBusy(false); }
  };
  const saveSpeech = async () => {
    if (!speech || !review) return;
    if (speech.lines.some(line => line.visibility === 'unknown')) { setMessage('请逐句确认画内口播或画外音，再保存人工校时。'); return; }
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/overseas/videos/${encodeURIComponent(recordId)}/verified-speech`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ analysisRunId: speech.analysisRunId, sourceSha256: speech.sourceSha256, lines: speech.lines, coverageConfirmed: speech.coverageConfirmed }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '保存逐句口播失败');
      setSpeech(result as DirectorVerifiedSpeech);
      await loadTimeline(review);
      setMessage('逐句口播已保存，请核对六段归属与画内／画外音。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { setBusy(false); }
  };
  if (!review || !speech) return <section className="mb-4 rounded-lg border border-border bg-white p-4 text-xs text-text-muted" aria-label="六段结构编导复核">{message || '正在读取六段结构、镜头和口播证据…'}</section>;
  const changeSectionBoundary = (index: number, edge: 'start' | 'end', value: number) => {
    setReview({ ...review, sections: review.sections.map((item, position) => {
      if (position === index) return { ...item, [edge]: value, confirmed: false };
      if (edge === 'start' && position === index - 1) return { ...item, end: value, confirmed: false };
      if (edge === 'end' && position === index + 1) return { ...item, start: value, confirmed: false };
      return item;
    }) });
  };
  const splitShot = (shotId: string) => {
    const current = review.shots.find(item => item.shotId === shotId);
    if (!current || current.end - current.start < 0.30) { setMessage('镜头短于 0.30 秒，无法拆成两个至少 0.15 秒的镜头。'); return; }
    const proposed = window.prompt(`在 ${reviewSeconds(current.start)}–${reviewSeconds(current.end)} 之间输入切点秒数`, String(Number(((current.start + current.end) / 2).toFixed(2))));
    if (proposed === null) return;
    const cut = Number(proposed);
    if (!Number.isFinite(cut) || cut - current.start < 0.15 || current.end - cut < 0.15) { setMessage('切点无效；切分后每段至少 0.15 秒。'); return; }
    setReview(splitDirectorReviewedShot(review, shotId, cut));
    setMessage('已拆成两个候选镜头；请重新核对内容、目的、首帧和钩子。');
  };
  const materializeShot = async (shotId: string) => {
    if (JSON.stringify([review.sections, review.shots, review.selectedHookShotId]) !== savedReview) { setMessage('请先保存镜头范围，再重新抽取切片和首帧。'); return; }
    setBusy(true); setMessage('正在从原片重新抽取分镜切片和首帧…');
    try {
      const response = await fetch(`/api/overseas/videos/${encodeURIComponent(recordId)}/shot-review/${encodeURIComponent(shotId)}/materialize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ expectedVersion: review.version }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '重新抽取镜头素材失败');
      const next = result as DirectorShotReview;
      setReview(next);
      setSavedReview(JSON.stringify([next.sections, next.shots, next.selectedHookShotId]));
      setMessage(`${shotId} 的切片与真实首帧已按复核后的时间范围重新抽取。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '重新抽取失败'); }
    finally { setBusy(false); }
  };
  const section = review.sections[activeSection] || review.sections[0];
  const sectionShots = section ? review.shots.filter(shot => shot.reviewStatus !== 'discarded' && shot.start < section.end && shot.end > section.start) : [];
  const sectionLines = section ? (timeline?.lines || []).filter(line => line.sectionIds.includes(section.sectionId)) : [];
  const sectionCoarse = section ? (timeline?.coarseWindows || []).filter(line => line.sectionIds.includes(section.sectionId)) : [];
  return <section aria-label="六段结构编导复核" className="mb-4 rounded-lg border border-border bg-white p-4 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold text-text-primary">六段内容结构与逐句口播</h3><p className="mt-1 text-text-muted">先确认叙事段，再复核分镜和原声逐句时间码。粗 ASR 可提供逐句大致时间码，界面会明确标记为估计；可按需人工修正。</p></div><span className={`rounded px-2 py-1 font-bold ${review.reviewComplete && timeline?.productionReady ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{review.reviewComplete && timeline?.productionReady ? '待最终交接门槛' : '编导复核中'}</span></div>
    <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 leading-5 text-amber-900"><strong>内容 Agent 制作门槛</strong><p>年限、功效、交期等经营事实暂不作为交接门槛；原片宣称保留待核验标记。逐镜、口播、开场动作和企业“销售”人物资产仍须满足制作证据要求。</p><ul className="mt-1 list-inside list-disc">{['hook_action_unverified', 'presenter_asset_unlocked'].filter(code => handoff?.issues.some(issue => issue.code === code)).map(code => <li key={code}>{directorReviewAction(code).gap}：{directorReviewAction(code).next}</li>)}</ul><p className="mt-1 font-semibold">当前制作状态：{handoff?.productionExecutionAllowed ? '已通过后端交接门槛' : '待补齐制作证据'}</p></div>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{review.sections.map((item, index) => <button key={item.sectionId} type="button" onClick={() => setActiveSection(index)} className={`rounded-lg border px-2 py-2 text-left ${activeSection === index ? 'border-accent bg-accent-glow text-accent' : 'border-border text-text-secondary'}`}><strong className="block">{index + 1}. {item.title}</strong><span className="mt-1 block text-[10px]">{reviewSeconds(item.start)}–{reviewSeconds(item.end)} · {item.confirmed ? '已确认' : '待确认'}</span></button>)}</div>
    {section && <div className="mt-4 rounded-lg border border-border p-3"><div className="grid gap-2 sm:grid-cols-[1fr_80px_80px]"><label className="font-semibold">结构段名称<input aria-label="结构段名称" className="mt-1 w-full rounded border border-border px-2 py-1" value={section.title} onChange={event => setReview({ ...review, sections: review.sections.map((item, index) => index === activeSection ? { ...item, title: event.target.value, confirmed: false } : item) })} /></label><label>开始秒<input aria-label="结构段开始秒" disabled={activeSection === 0} type="number" step="0.01" className="mt-1 w-full rounded border border-border px-2 py-1" value={section.start} onChange={event => changeSectionBoundary(activeSection, 'start', Number(event.target.value))} /></label><label>结束秒<input aria-label="结构段结束秒" disabled={activeSection === review.sections.length - 1} type="number" step="0.01" className="mt-1 w-full rounded border border-border px-2 py-1" value={section.end} onChange={event => changeSectionBoundary(activeSection, 'end', Number(event.target.value))} /></label></div><label className="mt-2 block">表达目的<input aria-label="结构段表达目的" className="mt-1 w-full rounded border border-border px-2 py-1" value={section.purpose} onChange={event => setReview({ ...review, sections: review.sections.map((item, index) => index === activeSection ? { ...item, purpose: event.target.value, confirmed: false } : item) })} /></label><label className="mt-2 inline-flex items-center gap-2 font-semibold"><input type="checkbox" checked={section.confirmed} onChange={event => setReview({ ...review, sections: review.sections.map((item, index) => index === activeSection ? { ...item, confirmed: event.target.checked } : item) })} />已对照原片确认本段边界与内容</label></div>}
    <div className="mt-4"><div className="flex items-center justify-between"><h4 className="font-semibold">本段分镜</h4><button type="button" onClick={() => setShowCandidates(!showCandidates)} className="text-accent underline">{showCandidates ? '收起候选切点' : `展开 ${sectionShots.length} 个候选切点`}</button></div>{showCandidates && <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">{sectionShots.map(shot => <div key={shot.shotId} className="rounded-lg border border-border p-2"><div className="flex flex-wrap items-center gap-2"><strong>{shot.shotId} · {reviewSeconds(shot.start)}–{reviewSeconds(shot.end)}</strong><select aria-label={`${shot.shotId} 复核状态`} value={shot.reviewStatus} onChange={event => setReview({ ...review, shots: review.shots.map(item => item.shotId === shot.shotId ? { ...item, reviewStatus: event.target.value as typeof item.reviewStatus } : item) })} className="ml-auto rounded border border-border px-1 py-0.5"><option value="candidate">待复核</option><option value="confirmed">已确认</option><option value="discarded">废弃</option></select></div><div className="mt-2 grid gap-2 sm:grid-cols-[72px_72px_1fr]"><input aria-label={`${shot.shotId} 开始秒`} type="number" step="0.01" value={shot.start} onChange={event => setReview({ ...review, shots: review.shots.map(item => item.shotId === shot.shotId ? { ...item, start: Number(event.target.value), hookMotionConfirmed: false, evidenceRefs: [] } : item) })} className="w-full rounded border border-border px-1 py-1" /><input aria-label={`${shot.shotId} 结束秒`} type="number" step="0.01" value={shot.end} onChange={event => setReview({ ...review, shots: review.shots.map(item => item.shotId === shot.shotId ? { ...item, end: Number(event.target.value), hookMotionConfirmed: false, evidenceRefs: [] } : item) })} className="w-full rounded border border-border px-1 py-1" /><input aria-label={`${shot.shotId} 内容`} value={shot.content} onChange={event => setReview({ ...review, shots: review.shots.map(item => item.shotId === shot.shotId ? { ...item, content: event.target.value } : item) })} className="w-full rounded border border-border px-2 py-1" /></div><input aria-label={`${shot.shotId} 表达目的`} value={shot.purpose} onChange={event => setReview({ ...review, shots: review.shots.map(item => item.shotId === shot.shotId ? { ...item, purpose: event.target.value } : item) })} className="mt-2 w-full rounded border border-border px-2 py-1" /><input aria-label={`${shot.shotId} 素材类型标签`} placeholder="素材类型标签，逗号分隔，如真人口播、工厂实拍" value={shot.labels.join(",")} onChange={event => setReview({ ...review, shots: review.shots.map(item => item.shotId === shot.shotId ? { ...item, labels: event.target.value.split(/[,，]/).map(label => label.trim()).filter(Boolean) } : item) })} className="mt-2 w-full rounded border border-border px-2 py-1" /><div className="mt-2 flex flex-wrap gap-2 text-[10px]"><label><input type="checkbox" checked={shot.mixedScene} onChange={event => setReview({ ...review, shots: review.shots.map(item => item.shotId === shot.shotId ? { ...item, mixedScene: event.target.checked } : item) })} /> 混镜待拆</label><button type="button" onClick={() => splitShot(shot.shotId)} className="text-accent underline">按秒数拆分</button><label><input type="radio" name="selectedHookShotId" disabled={shot.start >= 1 || shot.end <= 0 || shot.end - shot.start < 0.2} checked={review.selectedHookShotId === shot.shotId} onChange={() => setReview({ ...review, selectedHookShotId: shot.shotId, shots: review.shots.map(item => ({ ...item, hookMotionConfirmed: false })) })} /> 开场钩子</label><button type="button" disabled={busy || JSON.stringify([review.sections, review.shots, review.selectedHookShotId]) !== savedReview} onClick={() => void materializeShot(shot.shotId)} className="text-accent underline disabled:opacity-40">重新抽取切片和首帧</button>{shot.evidenceRefs.length > 0 && <button type="button" onClick={() => setPreviewShotId(previewShotId === shot.shotId ? null : shot.shotId)} className="text-accent underline">{previewShotId === shot.shotId ? '收起证据' : '查看证据'}</button>}</div>{review.selectedHookShotId === shot.shotId && <div className="mt-2 rounded bg-sky-50 p-2"><label className="block font-semibold">开场钩子动作脚本（至少 20 字）<textarea aria-label="开场钩子动作脚本" className="mt-1 w-full rounded border border-border px-2 py-1" rows={3} value={shot.hookAction} onChange={event => setReview(reviseDirectorHookAction(review, shot.shotId, event.target.value))} placeholder="按首帧、第一秒、动作峰值、手势轨迹、声音进入点、转场描述" /></label><label className="mt-1 inline-flex items-center gap-1"><input type="checkbox" checked={shot.hookMotionConfirmed} disabled={shot.hookAction.trim().length < 20} onChange={event => setReview({ ...review, shots: review.shots.map(item => item.shotId === shot.shotId ? { ...item, hookMotionConfirmed: event.target.checked } : item) })} />已逐帧核对钩子动作与原片一致</label><div className="mt-2 grid gap-2 sm:grid-cols-2">{hookScriptKeys.map(key => <label key={key} className="text-xs">{hookScriptLabels[key]}<input aria-label={`开场钩子${hookScriptLabels[key]}`} value={shot.hookScript?.[key] || ''} placeholder="请按原片填写；确实没有填“无”" onChange={event => setReview({ ...review, shots: review.shots.map(item => item.shotId === shot.shotId ? { ...item, hookScript: { camera: '', visual: '', subject: '', music: '', voiceover: '', soundEffects: '', spokenWords: '', subjectAction: '', ...item.hookScript, [key]: event.target.value }, hookScriptConfirmed: false } : item) })} className="mt-1 w-full rounded border border-border px-2 py-1" /></label>)}</div><label className="mt-2 inline-flex items-center gap-1 text-xs"><input type="checkbox" checked={shot.hookScriptConfirmed === true} disabled={hookScriptKeys.some(key => !shot.hookScript?.[key]?.trim())} onChange={event => setReview({ ...review, shots: review.shots.map(item => item.shotId === shot.shotId ? { ...item, hookScriptConfirmed: event.target.checked } : item) })} />已逐项对照原片确认八项钩子脚本</label></div>}{previewShotId === shot.shotId && <div className="mt-2 grid gap-2 sm:grid-cols-2">{shot.evidenceRefs.filter(ref => ref.includes('/clip')).map(ref => <AuthenticatedVideo key={ref} apiUrl={ref} controls className="max-h-48 w-full rounded bg-black" />)}{shot.evidenceRefs.filter(ref => ref.includes('first-frame')).map(ref => <AuthenticatedImage key={ref} src={ref} alt={`${shot.shotId} 原片首帧`} className="max-h-48 w-full rounded object-contain" />)}</div>}</div>)}</div>}</div>
    <div className="mt-4 border-t border-border pt-3"><h4 className="font-semibold">本段口播 · {sectionLines.length} 句已定位</h4>{sectionLines.length ? <ul className="mt-2 space-y-1">{sectionLines.map(line => <li key={line.speechId} className="rounded bg-zinc-50 px-2 py-1">{reviewSeconds(line.start)}–{reviewSeconds(line.end)} · {line.text} <span className="text-text-muted">{line.timingPrecision === 'coarse' ? '估计时间码' : '人工校时'} · {line.visibility === 'voiceover' ? '画外音' : line.visibility === 'on_camera' ? '画内口播' : '声音来源待判'} · {line.shotIds.join('、')}</span></li>)}</ul> : <p className="mt-1 text-amber-800">尚无可用的逐句口播。</p>}{sectionCoarse.length > 0 && <details className="mt-2 rounded bg-amber-50 p-2"><summary className="cursor-pointer font-semibold">{sectionCoarse.length} 条粗 ASR 估计口播时间窗</summary><ul className="mt-2 space-y-1">{sectionCoarse.map(item => <li key={item.speechId}>{reviewSeconds(item.start)}–{reviewSeconds(item.end)} · {item.text}</li>)}</ul></details>}</div>
    <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 p-3"><h4 className="font-semibold">获取句级时间码候选</h4><p className="mt-1 leading-5 text-text-secondary">该操作调用千问句级 ASR，可能产生供应商费用。候选仍须逐句听原片、核对起止秒数及画内／画外音；不会自动确认为编导交接物。</p><p className="mt-1 text-text-muted">服务状态：{asrJob ? (asrJob.enabled ? '已启用' : '未启用付费转写') : '查询中'} · 任务：{asrJob?.status || '读取中'}</p><label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={asrConsent} onChange={event => setAsrConsent(event.target.checked)} disabled={!asrJob?.enabled || asrBusy} />我确认启动可能计费的句级 ASR 分析</label><div className="mt-2 flex gap-2"><button type="button" disabled={!asrConsent || !asrJob?.enabled || asrBusy || asrJob.status === 'PENDING' || asrJob.status === 'RUNNING' || asrJob.status === 'SUCCEEDED' || asrJob.status === 'uncertain'} onClick={() => void readPhraseAsr(true)} className="rounded bg-accent px-2 py-1 font-bold text-white disabled:opacity-40">{asrBusy ? '处理中…' : '获取句级时间码'}</button><button type="button" disabled={asrBusy} onClick={() => void readPhraseAsr(false)} className="rounded border border-border px-2 py-1">刷新任务状态</button></div>{asrJob?.candidateLines?.length ? <div className="mt-3"><p className="font-semibold">{asrJob.candidateLines.length} 条机器候选（未核对）</p><div className="mt-2 max-h-48 space-y-1 overflow-y-auto">{asrJob.candidateLines.map((line, index) => <p key={`${line.start}-${index}`} className="rounded bg-white px-2 py-1">{reviewSeconds(line.start)}–{reviewSeconds(line.end)} · {line.text}</p>)}</div><button type="button" onClick={() => setSpeech(asrCandidatesToReviewDraft(speech, asrJob.candidateLines))} className="mt-2 text-accent underline">载入人工校对草稿（不会保存或确认）</button></div> : null}</div>
    <div className="mt-4 border-t border-border pt-3"><h4 className="font-semibold">可选：逐句口播人工修正</h4><p className="mt-1 text-text-muted">粗 ASR 的大致时间码已可用于交接；如发现错字、漏句或错位，可听原片修正并保存。</p><button type="button" onClick={onPreview} className="mt-1 text-accent underline">播放原片核对</button><div className="mt-2 max-h-64 space-y-2 overflow-y-auto">{speech.lines.map((line, index) => <div key={index} className="grid gap-1 sm:grid-cols-[70px_70px_1fr_90px_24px]"><input aria-label={`第 ${index + 1} 句开始秒`} type="number" step="0.01" value={line.start} onChange={event => setSpeech({ ...speech, coverageConfirmed: false, lines: speech.lines.map((item, i) => i === index ? { ...item, start: Number(event.target.value) } : item) })} className="rounded border border-border px-1" /><input aria-label={`第 ${index + 1} 句结束秒`} type="number" step="0.01" value={line.end} onChange={event => setSpeech({ ...speech, coverageConfirmed: false, lines: speech.lines.map((item, i) => i === index ? { ...item, end: Number(event.target.value) } : item) })} className="rounded border border-border px-1" /><input aria-label={`第 ${index + 1} 句原文`} value={line.text} onChange={event => setSpeech({ ...speech, coverageConfirmed: false, lines: speech.lines.map((item, i) => i === index ? { ...item, text: event.target.value } : item) })} className="rounded border border-border px-2" /><select aria-label={`第 ${index + 1} 句画内或画外`} value={line.visibility} onChange={event => setSpeech({ ...speech, coverageConfirmed: false, lines: speech.lines.map((item, i) => i === index ? { ...item, visibility: event.target.value as typeof item.visibility } : item) })} className="rounded border border-border px-1"><option value="unknown">待判断</option><option value="on_camera">画内</option><option value="voiceover">画外</option></select><button type="button" aria-label={`删除第 ${index + 1} 句`} onClick={() => setSpeech({ ...speech, coverageConfirmed: false, lines: speech.lines.filter((_, i) => i !== index) })}>×</button></div>)}</div><div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => setSpeech({ ...speech, coverageConfirmed: false, lines: [...speech.lines, { text: '', start: 0, end: 0, visibility: 'unknown' }] })} className="rounded border border-border px-2 py-1">添加一句</button><label className="inline-flex items-center gap-1"><input type="checkbox" checked={speech.coverageConfirmed} onChange={event => setSpeech({ ...speech, coverageConfirmed: event.target.checked })} />已听完整片并确认无漏句</label><button type="button" disabled={busy} onClick={() => void saveSpeech()} className="rounded bg-accent px-2 py-1 font-bold text-white disabled:opacity-50">保存逐句校时</button></div></div>
    <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" disabled={busy} onClick={() => void saveReview()} className="rounded bg-accent px-3 py-2 font-bold text-white disabled:opacity-50">保存六段与镜头复核</button><span className="text-text-muted">{review.shots.filter(shot => shot.reviewStatus === 'candidate').length} 个候选镜头待复核 · {timeline?.coarseWindows.length || 0} 个粗 ASR 窗口</span></div>{message && <p role="status" className="mt-2 text-amber-800">{message}</p>}{timeline?.reviewQuestions.length ? <details className="mt-3"><summary className="cursor-pointer font-semibold">交接前还需处理 {timeline.reviewQuestions.length} 项</summary><ul className="mt-1 list-inside list-disc space-y-1 text-amber-800">{timeline.reviewQuestions.map((item, index) => <li key={index}>{item}</li>)}</ul></details> : null}
  </section>;
}

export function DirectorVideoDetailPanel({
  video,
  onClose,
  onPreview,
  onCreate,
  onRetry,
  onReanalyzeImage,
  onExactAnalysis,
  onReanalyze,
  onCancelAnalysis,
  analyzing,
  notice,
  onFavorite,
  favoriting,
  isFavorite,
}: {
  video: TrendVideo;
  onClose: () => void;
  onPreview: () => void;
  onCreate: () => void;
  onRetry: () => void;
  onReanalyzeImage: () => void;
  onExactAnalysis: () => void;
  onReanalyze?: () => void;
  onCancelAnalysis: () => void;
  analyzing: boolean;
  notice?: string;
  onFavorite: () => void;
  favoriting?: boolean;
  isFavorite?: boolean;
}) {
  const analysis = getAnalysis(video);
  const exactQuality = exactAnalysisQuality(video);
  const payload = video.aiAnalysis;
  const imageEvidence = payload?.imageEvidence;
  const isImagePost = video.contentFormat === 'image';
  const imageAnalysisReady = imageEvidence?.status === 'analyzed' && Boolean(imageEvidence.observedFacts?.length);
  const progressStage = payload?.analysisProgress?.stage;
  const hasServerProgress = Boolean(payload?.analysisProgress);
  const terminalAnalysisState = Boolean(payload?.analysisError)
    || ['completed', 'failed', 'paused', 'cancelled'].includes(String(progressStage || ''))
    || ['paused', 'cancelled', 'video_failed', 'failed', 'needs_review', 'analysis_retryable', 'analyzed'].includes(String(payload?.geminiStatus || ''));
  const activeServerAnalysis = analysisProgressIsActive(payload?.analysisProgress);
  const pending = analyzing
    || (hasServerProgress
      ? activeServerAnalysis
      : (payload?.requestedAnalysisMode === 'exact' && !terminalAnalysisState)
        || (video.status === 'pending' && !terminalAnalysisState));
  const reviewHandoffRequestKey = [video.recordId || '', payload?.analyzedAt || '', payload?.geminiStatus || '', payload?.requestedAnalysisMode || '', payload?.analysisProgress?.runId || '', payload?.analysisProgress?.stage || ''].join(':');
  const [reviewHandoffState, setReviewHandoffState] = useState<{ key: string; value: DirectorReviewHandoff } | null>(null);
  const reviewHandoff = reviewHandoffState?.key === reviewHandoffRequestKey ? reviewHandoffState.value : null;
  useEffect(() => {
    const recordId = video.recordId;
    if (activeServerAnalysis || !recordId || !['analyzed', 'needs_review'].includes(String(payload?.geminiStatus || ''))) { setReviewHandoffState(null); return; }
    let active = true;
    void fetch(`/api/overseas/videos/${encodeURIComponent(recordId)}/review-handoff`, { headers: authHeader() })
      .then(async response => response.ok ? await response.json() as DirectorReviewHandoff : null)
      .then(result => { if (active) setReviewHandoffState(result ? { key: reviewHandoffRequestKey, value: result } : null); })
      .catch(() => { if (active) setReviewHandoffState(null); });
    return () => { active = false; };
  }, [video.recordId, payload?.geminiStatus, activeServerAnalysis, reviewHandoffRequestKey]);
  const benchmark = payload?.benchmarkAnalysis || buildBenchmarkAnalysis({ analysis: payload, videoId: video.recordId || video.id, duration: video.duration });
  const handoffReady = !pending && reviewHandoff?.status === 'production_ready' && reviewHandoff.productionExecutionAllowed === true;
  const draftReady = !pending && reviewHandoff?.directorHandoffReady === true;
  // A missing review-handoff response must not hide an otherwise valid
  // replication action. The task-creation endpoint owns handoff recovery; the
  // UI only needs verified exact evidence and a non-running analysis.
  const detailCreationReady = video.id.startsWith('material-') ? true : isImagePost ? imageAnalysisReady : exactQuality.ready && !pending;
  const isReadOnlySnapshot = payload?.analysisSource === 'weekly-plan-snapshot' || video.id.startsWith('weekly-reference-');
  const canRunExactAnalysis = !isReadOnlySnapshot && Boolean(video.recordId || video.id.startsWith('material-'));
  const canRunDetailAnalysis = isImagePost ? Boolean(video.recordId) : canRunExactAnalysis;
  const detailedAnalysisReason = isReadOnlySnapshot
    ? '原爆款已删除，仅可查看周计划保存的历史分析快照。'
    : exactQuality.ready
      ? '精确分析已通过实际画面时间线校验'
      : exactQuality.reason;
  const showAnalysisProgress = !isImagePost && progressStage !== 'completed'
    && (pending || ['failed', 'paused', 'cancelled'].includes(String(progressStage || '')));
  const analysisInterrupted = ['paused', 'cancelled'].includes(String(progressStage || '')) || payload?.geminiStatus === 'paused';
  const statusLabel = payload?.analysisProgress && (analysisProgressIsActive(payload.analysisProgress)
    || ['failed', 'paused', 'cancelled'].includes(payload.analysisProgress.stage))
    ? payload.analysisProgress.stageLabel
    : pending
      ? '编导 Agent 分析中'
    : isImagePost && imageAnalysisReady
      ? '图文证据分析已完成'
      : exactQuality.ready
      ? '全片精确分析已完成'
      : payload?.geminiStatus === 'needs_review'
        ? '逐镜分析待复核'
      : analysis
        ? '策略分析已完成'
        : payload?.analysisError || video.status === 'failed'
          ? '分析需要重试'
          : '等待编导 Agent 分析';

  return (
    <Drawer open title={video.title} size={800} onClose={onClose}
      extra={<Button onClick={onFavorite} loading={favoriting} aria-label={isFavorite ? `取消收藏 ${video.title}` : `收藏 ${video.title}`} icon={<Star size={16} fill={isFavorite ? 'currentColor' : 'none'} />}>{isFavorite ? '已收藏' : '收藏'}</Button>}
      footer={<div className="flex flex-wrap items-center gap-2">
        {!isImagePost && canRunExactAnalysis && (pending
          ? <Button onClick={onCancelAnalysis} icon={<X size={13} />}>停止分析</Button>
          : <Button onClick={analysisInterrupted ? (onReanalyze || onExactAnalysis) : exactQuality.ready ? (onReanalyze || onExactAnalysis) : onExactAnalysis} icon={<BarChart2 size={13} />}>{analysisInterrupted ? '继续详细分析' : exactQuality.ready ? '重新详细分析' : '详细分析'}</Button>)}
        {!isImagePost && !analysisInterrupted && (payload?.analysisError || video.status === 'failed') && <Button onClick={onRetry} loading={analyzing}>重新分析</Button>}
        {isImagePost && !imageAnalysisReady && <Button onClick={onReanalyzeImage} loading={analyzing} icon={<Images size={13} />}>重新分析图文</Button>}
        <Button onClick={onPreview}>预览原内容</Button>
        <Button type="primary" onClick={detailCreationReady ? onCreate : isImagePost ? onReanalyzeImage : onExactAnalysis} disabled={!detailCreationReady && !canRunDetailAnalysis} className="ml-auto">{isImagePost || video.id.startsWith('material-') ? '开始创作' : '爆款复刻'}</Button>
        {!detailCreationReady && <p className="w-full text-xs text-text-secondary">{isImagePost ? '点击“开始创作”会先完成图文证据分析。' : pending ? '详细分析完成后会开放复刻，当前任务不会重复提交。' : canRunExactAnalysis ? '点击“爆款复刻”会先完成详细分析，再进入制作。' : detailedAnalysisReason}</p>}
      </div>}
      styles={{ body: { padding: 0 } }}>
      <div className="border-b border-border px-5 py-3">
        <p className="text-sm font-medium text-text-primary">编导 Agent · {statusLabel}</p>
        <p className="mt-1 flex items-center gap-2 text-xs text-text-secondary"><SocialPlatformIcon platform={video.platform} size={14}/>{PLATFORM_META[video.platform]?.label || video.platform} · {displayDuration(video.duration)} · {payload?.analysisSource || '待确认分析来源'}</p>
        {video.tags.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="内容标签">
          <span className="mr-1 text-xs font-semibold text-text-secondary">内容标签</span>
          {video.tags.map(tag => <span key={tag} className="rounded-md border border-border bg-accent-glow px-2 py-1 text-xs font-semibold text-accent">#{tag}</span>)}
        </div>}
      </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {isImagePost && notice && <p role="status" className="mb-4 border-l-2 border-accent bg-accent-glow px-3 py-2 text-xs font-semibold text-accent">{notice}</p>}
          {isImagePost && imageAnalysisReady && imageEvidence ? (
            <div className="mt-4 space-y-4">
              <section className="rounded-lg border border-border bg-white p-4">
                <h3 className="text-sm font-semibold text-text-primary">图文证据与轮播节奏</h3>
                <div className="mt-3 space-y-2">
                  {imageEvidence.carouselFlow.map(item => <div key={`${item.imageIndex}-${item.role}`} className="rounded-lg bg-surface-2 px-3 py-2 text-xs leading-5"><strong className="text-text-primary">第 {item.imageIndex + 1} 张 · {item.role}</strong><p className="text-text-secondary">{item.evidence}</p></div>)}
                </div>
              </section>
              <section className="rounded-lg border border-border bg-white p-4">
                <h3 className="text-sm font-semibold text-text-primary">可复用模块</h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">{imageEvidence.reusableModules.map(item => <div key={item.module} className="rounded-lg border border-border p-3 text-xs"><strong>{item.module}</strong><p className="mt-1 leading-5 text-text-secondary">保留：{item.preserve}</p><p className="leading-5 text-text-muted">替换：{item.replace}</p></div>)}</div>
              </section>
            </div>
          ) : isImagePost ? (
            <section className="mt-4 rounded-lg border border-dashed border-border bg-white px-6 py-12 text-center">
              {pending ? <Loader2 size={24} className="mx-auto animate-spin text-accent" /> : <BarChart2 size={24} className="mx-auto text-text-muted" />}
              <p className="mt-3 text-sm font-semibold text-text-primary">{statusLabel}</p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-text-muted">{pending ? '可以先关闭此页；完成时间与失败状态以后台返回为准。' : '完成后会展示图文证据与轮播节奏。'}</p>
            </section>
          ) : (
            <InspirationVideoAnalysisTabs
              benchmark={benchmark}
              gemini={payload?.gemini}
              duration={video.duration}
              pending={pending}
              detailedReady={exactQuality.ready}
              detailedReason={detailedAnalysisReason}
              onAnalyze={onExactAnalysis}
              onReanalyze={onReanalyze || onExactAnalysis}
              analysisActionAvailable={canRunExactAnalysis}
              renderClip={url => <AuthenticatedVideo apiUrl={url} controls className="max-h-64 w-full rounded-lg bg-black" />}
              adaptTip={analysis?.adaptTip}
              baseRequirements={analysis?.baseRequirements}
              storyboardStatus={<>
                {showAnalysisProgress && <VideoAnalysisProgressPanel
                  progress={payload?.analysisProgress}
                  pending={pending}
                  onRetry={onReanalyze || onExactAnalysis}
                  retryDisabled={analyzing}
                />}
                {notice && <p role="status" className="border-l-2 border-accent bg-accent-glow px-3 py-2 text-xs font-semibold text-accent">{notice}</p>}
                <section aria-label="编导到内容 Agent 交接状态" className="rounded-lg border border-border bg-white p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold"><span className="rounded bg-surface-2 px-2 py-1 text-green">原片入库</span><ChevronRight size={13} className="text-text-muted" /><span className={`rounded px-2 py-1 ${pending || !draftReady ? 'bg-amber-dim text-amber' : 'bg-surface-2 text-green'}`}>{pending ? '编导分析中' : draftReady ? '可交接内容起稿' : '编导证据不足'}</span><ChevronRight size={13} className="text-text-muted" /><span className={`rounded px-2 py-1 ${draftReady ? 'bg-surface-2 text-green' : 'bg-surface-2 text-text-muted'}`}>{handoffReady ? '可制作成片' : draftReady ? '可生成口播草稿' : '内容起稿未开放'}</span></div>
                  {!handoffReady && !pending && <p className="mt-2 text-[11px] leading-5 text-amber">系统将使用带估计时间码的原片口播，并继续检查镜头切片、钩子动作和企业“销售”人物资产。如需继续，编导 Agent 会按清单补证，无需人工逐句校时或逐镜勾选。</p>}
                </section>
              </>}
              speechAlignment={<ReferenceSpeechAlignmentPanel details={payload?.gemini?.scriptDetails15s} transcript={payload?.gemini?.audioTranscript} />}
            />
          )}
        </div>

    </Drawer>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
interface InspirationDashboardProps {
  onScriptPanelOpen?: () => void;
  onScriptPanelClose?: () => void;
  onNavigate?: (p: Page) => void;
  onEnterWorkflow?: (payload: {
    source?: string;
    script?: string;
    video: TrendVideo;
    scriptType?: ScriptType;
    language?: string;
    productInfo?: string;
    materialRole?: 'hook';
    generatedVideo?: GeneratedVideo;
    referenceAnalysis?: {
      title?: string;
      visualStyle?: string;
      coreEmotion?: string;
      details?: { time: string; shot: string; camera: string; visual: string; subtitle?: string; audio?: string; note?: string }[];
    };
  }) => void;
}

export default function InspirationDashboard({ onScriptPanelOpen, onScriptPanelClose, onNavigate, onEnterWorkflow }: InspirationDashboardProps) {
  const { activeProgram, accounts } = useSocialProgram();
  const [creationAccountId, setCreationAccountId] = useState('');
  useEffect(() => {
    setCreationAccountId(soleInspirationCreationAccount(accounts, activeProgram?.programId));
  }, [activeProgram?.programId, accounts]);
  const inspirationLaunches = useRef(new Set<string>());
  const [replicationTasks, setReplicationTasks] = useState<Record<string, string>>({});
  const [launchingReferences, setLaunchingReferences] = useState<string[]>([]);
  const [materialEntry] = useState(initialMaterialLibraryEntry);
  const [innerView, setInnerView] = useState<InspirationInnerView>(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('view') === 'shooting' ? 'shooting' : materialEntry.openLibrary ? 'library' : 'inspiration');
  const [shootingFilter, setShootingFilter] = useState<'all' | 'storyboard' | 'common'>('all');
  const [platform, setPlatform] = useState<Platform>('all');
  const [search, setSearch] = useState(() => typeof window === 'undefined'
    ? ''
    : String(new URLSearchParams(window.location.search).get('search') || '').trim());
  // 搜索改为服务端执行：此前只在已加载的那一页做前端过滤，翻页之外的记录搜不到。
  const searchRef = useRef('');
  searchRef.current = search;
  const [selectedVideo, setSelectedVideo] = useState<TrendVideo | null>(null);
  const [requestedReference, setRequestedReference] = useState<InspirationReferenceTarget | null>(initialInspirationReferenceTarget);
  const openedReferenceTargetRef = useRef('');
  const [watchVideo, setWatchVideo] = useState<TrendVideo | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortMode, setSortMode] = useState<SortMode>('crawlTime');
  const [contentFormat, setContentFormat] = useState<ContentFormat>('video');
  const [inspirationFavoriteFilter, setInspirationFavoriteFilter] = useState<FavoriteFilter>('all');
  const [crawlTimeRange, setCrawlTimeRange] = useState<CrawlTimeRange>('all');
  const [discoveryDecision, setDiscoveryDecision] = useState<DiscoveryDecisionFilter>('all');
  const [businessModelFilter, setBusinessModelFilter] = useState<BusinessModelFilter>('all');
  const [minimumDiscoveryScore, setMinimumDiscoveryScore] = useState(0);
  const [discoverySupplyItems, setDiscoverySupplyItems] = useState<SocialDiscoverySupplyItem[]>([]);
  const [discoverySupplyLoading, setDiscoverySupplyLoading] = useState(false);
  const [discoverySupplyError, setDiscoverySupplyError] = useState('');
  const [inspirationFiltersOpen, setInspirationFiltersOpen] = useState(false);
  const [crawledVideos, setCrawledVideos] = useState<TrendVideo[]>([]);
  const [videoPage, setVideoPage] = useState(1);
  const [videoTotalPages, setVideoTotalPages] = useState(1);
  const [tenantVideoTotalItems, setTenantVideoTotalItems] = useState<number | null>(null);
  const [competitorAccountCount, setCompetitorAccountCount] = useState<number | null>(null);
  const [videosLoading, setVideosLoading] = useState(false);
  const [videosLoaded, setVideosLoaded] = useState(false);
  const [videosError, setVideosError] = useState('');
  const [lastCrawlVideoIds, setLastCrawlVideoIds] = useState<string[]>([]);
  const [analyzingVideoIds, setAnalyzingVideoIds] = useState<string[]>([]);
  const [favoritingMaterialIds, setFavoritingMaterialIds] = useState<string[]>([]);
  const [favoritedVideoIds, setFavoritedVideoIds] = useState<string[]>([]);
  const [materialMessage, setMaterialMessage] = useState('');
  const [localMaterials, setLocalMaterials] = useState<Material[]>([]);
  const [manageTarget, setManageTarget] = useState<(({ kind: 'video'; item: TrendVideo } | { kind: 'material'; item: Material }) & { action: 'edit' | 'delete' }) | null>(null);
  const [manageName, setManageName] = useState('');
  const [manageTags, setManageTags] = useState('');
  const [manageProductId, setManageProductId] = useState('');
  const [materialProducts, setMaterialProducts] = useState<Array<{id:string;name:string}>>([]);
  const [materialProductFilterEnabled, setMaterialProductFilterEnabled] = useState(() => Boolean(materialEntry.productId || materialEntry.productRef));
  const [materialProductId, setMaterialProductId] = useState(materialEntry.productId);
  const [materialProductRef, setMaterialProductRef] = useState(materialEntry.productRef);
  const [uploadProductId, setUploadProductId] = useState(() => materialEntry.productId || '');
  const [manageBusy, setManageBusy] = useState(false);
  const [previewMaterial, setPreviewMaterial] = useState<Material | null>(null);
  const [previewMaterialAttempt, setPreviewMaterialAttempt] = useState(0);
  const [previewMaterialLoading, setPreviewMaterialLoading] = useState(false);
  const [previewMaterialError, setPreviewMaterialError] = useState('');
  const previewMaterialAutoRetryRef = useRef(0);
  const [detailMaterial, setDetailMaterial] = useState<Material | null>(null);
  const [updatingMaterialTheme, setUpdatingMaterialTheme] = useState(false);
  const detailMaterialDialogRef = useModalFocus<HTMLDivElement>({
    open: Boolean(detailMaterial),
    onClose: () => setDetailMaterial(null),
  });
  const updateDetailMaterialTheme = async (theme: keyof typeof MATERIAL_THEME_LABELS) => {
    if (!detailMaterial || updatingMaterialTheme) return;
    setUpdatingMaterialTheme(true);
    try {
      const result = await studioApi.updateMaterial(detailMaterial.id, { name: detailMaterial.name, primaryTheme: theme });
      if (!result.ok || !result.material) throw new Error(result.error || '主题标签保存失败');
      setDetailMaterial(result.material);
      setLocalMaterials(items => items.map(item => item.id === result.material!.id ? result.material! : item));
    } catch (error) { setMaterialMessage(error instanceof Error ? error.message : '主题标签保存失败'); }
    finally { setUpdatingMaterialTheme(false); }
  };
  const manageDialogRef = useModalFocus<HTMLDivElement>({
    open: Boolean(manageTarget),
    onClose: () => { if (!manageBusy) setManageTarget(null); },
    closeOnEscape: () => !manageBusy,
  });
  const [materialSearch, setMaterialSearch] = useState('');
  const [materialIndustry, setMaterialIndustry] = useState<MaterialIndustryFilter>('all');
  const [materialFunction, setMaterialFunction] = useState('all');
  const [materialApplicability, setMaterialApplicability] = useState<MaterialApplicabilityFilter>('all');
  const [materialOrientation, setMaterialOrientation] = useState<MaterialOrientationFilter>('all');
  const [initialTaxonomyFilters] = useState(initialMaterialTaxonomyFilters);
  const [materialSource, setMaterialSource] = useState<MaterialSourceFilter>(initialTaxonomyFilters.source);
  const [materialTheme, setMaterialTheme] = useState<MaterialThemeFilter>(initialTaxonomyFilters.theme);
  const [materialType, setMaterialType] = useState<MaterialTypeFilter>('all');
  const [materialFavoriteFilter, setMaterialFavoriteFilter] = useState<FavoriteFilter>('all');
  const [materialFiltersOpen, setMaterialFiltersOpen] = useState(false);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [materialTotal, setMaterialTotal] = useState(0);
  const [materialPage, setMaterialPage] = useState(1);
  const [materialFacets, setMaterialFacets] = useState<MaterialLibraryFacets | null>(null);
  const [uploadingMaterial, setUploadingMaterial] = useState(false);
  const [materialUploadDialogOpen, setMaterialUploadDialogOpen] = useState(false);
  const [importingReference, setImportingReference] = useState(false);
  const referenceUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [generatingNeedId, setGeneratingNeedId] = useState('');
  const { scriptGapTasks, shootingTaskError: _shootingTaskError } = useScriptGapTasks();
  const [uploadingScriptGapId, setUploadingScriptGapId] = useState('');
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const taskId = new URLSearchParams(window.location.search).get('task');
    if (taskId) document.getElementById(`shooting-task-${taskId}`)?.scrollIntoView({ block: 'center' });
  }, [scriptGapTasks]);
  useEffect(() => {
    if (innerView !== 'library') return;
    const url = new URL(window.location.href);
    materialSource === 'all' ? url.searchParams.delete('source') : url.searchParams.set('source', materialSource);
    materialTheme === 'all' ? url.searchParams.delete('theme') : url.searchParams.set('theme', materialTheme);
    window.history.replaceState(window.history.state, '', url);
  }, [innerView, materialSource, materialTheme]);
  const shootingCameraInputRef = useRef<HTMLInputElement | null>(null);
  const videoRequestRef = useRef(0);
  const inventoryRequestRef = useRef(0);
  const platformLabel = PLATFORM_FILTERS.find(f => f.id === platform)?.label ?? '全部平台';
  const sortLabel = sortMode === 'crawlTime' ? '按爬取时间' : '按内容机会';
  const contentFormatLabel = contentFormat === 'video' ? '视频' : '图文';
  useEffect(() => {
    const receiveReference = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      if (detail?.page !== 'socialInspiration') return;
      const next = parseInspirationReferenceTarget(detail);
      if (!next) return;
      openedReferenceTargetRef.current = '';
      setRequestedReference(next);
    };
    window.addEventListener('lingshu:navigate', receiveReference);
    return () => window.removeEventListener('lingshu:navigate', receiveReference);
  }, []);
  useEffect(() => {
    if (!requestedReference || !videosLoaded) return;
    const requestKey = [requestedReference.referenceId, requestedReference.sourceUrl, requestedReference.title].join('|');
    if (!requestKey || openedReferenceTargetRef.current === requestKey) return;
    openedReferenceTargetRef.current = requestKey;
    let cancelled = false;
    const openRequestedReference = async () => {
      setInnerView('inspiration');
      const normalizedId = requestedReference.referenceId.replace(/^crawl-/, '');
      let match = crawledVideos.find(video => videoMatchesReference(video, requestedReference));
      if (!match && normalizedId) {
        try {
          const response = await fetch(`/api/overseas/videos/${encodeURIComponent(normalizedId)}`, { headers: authHeader() });
          if (response.ok) {
            const record = await response.json() as CrawlerRecord;
            match = recordsToVideos([record])[0];
          }
        } catch {
          // The loaded inventory is still searched by source URL and title below.
        }
      }
      if (!match && requestedReference.title) {
        try {
          const searchTitle = normalizedReferenceText(requestedReference.title).split(' ').slice(0, 10).join(' ');
          const response = await fetch(`/api/overseas/videos?page=1&perPage=100&contentFormat=video&crawlRange=all&search=${encodeURIComponent(searchTitle)}`, { headers: authHeader() });
          if (response.ok) {
            const payload = await response.json() as { items?: CrawlerRecord[] };
            const candidates = recordsToVideos(payload.items || []);
            match = candidates.find(video => videoMatchesReference(video, requestedReference));
          }
        } catch {
          // The reference may have been removed after the weekly plan was created.
        }
      }
      if (cancelled) return;
      if (!match) {
        const platform = ACTIVE_PLATFORMS.includes(requestedReference.platform as Exclude<Platform, 'all'>)
          ? requestedReference.platform as Exclude<Platform, 'all'>
          : 'tiktok';
        const snapshot: TrendVideo = {
          id: `weekly-reference-${requestedReference.referenceId || normalizedReferenceText(requestedReference.title)}`,
          platform,
          title: requestedReference.title || '周计划爆款参考',
          thumbnail: requestedReference.thumbnailUrl,
          duration: requestedReference.duration,
          tags: [],
          views: '—',
          trend: 'stable',
          sourceUrl: requestedReference.sourceUrl || undefined,
          status: 'analyzed',
          contentFormat: 'video',
          aiAnalysis: {
            benchmarkAnalysis: requestedReference.benchmarkAnalysis,
            analysisSource: 'weekly-plan-snapshot',
            analysisQuality: 'snapshot',
            geminiStatus: 'analyzed',
            gemini: { theme: requestedReference.title || '周计划爆款参考' },
          },
        };
        setMaterialMessage('原爆款已从灵感库删除，当前打开的是周计划保存的分析快照。');
        setSelectedVideo(snapshot);
        return;
      }
      setCrawledVideos(items => [match!, ...items.filter(item => item.id !== match!.id)]);
      setMaterialMessage('');
      setSelectedVideo(match);
    };
    void openRequestedReference();
    return () => { cancelled = true; };
  }, [requestedReference, videosLoaded]); // crawledVideos is intentionally read from the request-triggered render
  useEffect(() => {
    if (selectedVideo) { onScriptPanelOpen?.(); }
    else { onScriptPanelClose?.(); }
  }, [selectedVideo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up on unmount
  useEffect(() => () => { onScriptPanelClose?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshMaterials = async (page = materialPage): Promise<Material[]> => {
    if (!localMaterials.length) setMaterialsLoading(true);
    try {
      const inventory = await studioApi.listMaterialLibrary('all', {
        ...(materialSource !== 'all' ? { sourceCategory: materialSource } : {}),
        ...(materialTheme !== 'all' ? { theme: materialTheme } : {}),
        ...(materialSearch.trim() ? { query: materialSearch.trim() } : {}),
        page, pageSize: MATERIAL_LIBRARY_PAGE_SIZE,
      });
      setLocalMaterials(inventory.items);
      setMaterialTotal(inventory.total ?? inventory.items.length);
      setMaterialFacets(inventory.facets || null);
      setMaterialPage(page);
      return inventory.items;
    } catch {
      // Keep last successful items; callers can still decide whether the stale
      // signed media URL is usable.
      return localMaterials;
    } finally {
      setMaterialsLoading(false);
    }
  };

  useEffect(() => { void refreshMaterials(1); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (innerView !== 'library') return;
    const timer = window.setTimeout(() => void refreshMaterials(1), 250);
    return () => window.clearTimeout(timer);
  }, [innerView, materialSource, materialTheme, materialSearch]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    previewMaterialAutoRetryRef.current = 0;
    setPreviewMaterialAttempt(0);
    setPreviewMaterialError('');
    setPreviewMaterialLoading(Boolean(previewMaterial));
  }, [previewMaterial?.id]);

  const refreshMaterialPreviewUrl = async () => {
    const current = previewMaterial;
    if (!current) return;
    setPreviewMaterialLoading(true);
    setPreviewMaterialError('');
    const items = await refreshMaterials();
    const fresh = items.find(item => item.id === current.id);
    if (!fresh?.url) {
      setPreviewMaterialLoading(false);
      setPreviewMaterialError('素材文件暂时不可用，请稍后重试。');
      return;
    }
    setPreviewMaterial(fresh);
    setPreviewMaterialAttempt(value => value + 1);
  };

  const handleMaterialPreviewError = (message?: string) => {
    if (previewMaterialAutoRetryRef.current < 1) {
      previewMaterialAutoRetryRef.current += 1;
      void refreshMaterialPreviewUrl();
      return;
    }
    setPreviewMaterialLoading(false);
    setPreviewMaterialError(message || '视频文件加载或解码失败，请重新获取播放地址。');
  };

  useEffect(() => {
    let active = true;
    void studioApi.materialProducts().then(result => {
      if (!active) return;
      setMaterialProducts(result.items);
      if (!materialEntry.productRef) return;
      const matched = materialEntry.productId
        ? result.items.find(item => item.id === materialEntry.productId)
        : result.items.find(item => item.name === materialEntry.productRef);
      if (!matched) return;
      setMaterialProductFilterEnabled(true);
      setMaterialProductId(matched.id);
      setMaterialProductRef(matched.name);
      setUploadProductId(current => current ?? matched.id);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [materialEntry.productId, materialEntry.productRef]);

  const refreshInventory = async () => {
    const requestId = ++inventoryRequestRef.current;
    try {
      const response = await fetch(`/api/overseas/videos/inventory-summary?contentFormat=${contentFormat}`, { headers: authHeader() });
      const data = await response.json().catch(() => ({})) as { totalItems?: number };
      if (!response.ok) throw new Error('库存统计加载失败');
      if (requestId === inventoryRequestRef.current) setTenantVideoTotalItems(Math.max(0, Number(data.totalItems || 0)));
    } catch {
      // Keep the last successful inventory value. The list response carries
      // the same authoritative total and can repair this value later.
    }
  };

  const refreshVideos = async (nextPage = 1, quiet = false) => {
    const requestId = ++videoRequestRef.current;
    if (!quiet) {
      setVideosLoading(true);
      setVideosError('');
    }
    try {
      const keyword = searchRef.current.trim();
      const query = `page=${nextPage}&perPage=${INSPIRATION_PAGE_SIZE}&contentFormat=${contentFormat}`
        + `&crawlRange=${crawlTimeRange}`
        + (platform !== 'all' ? `&platform=${platform}` : '')
        + (keyword ? `&search=${encodeURIComponent(keyword)}` : '');
      const r = await fetch(`/api/overseas/videos?${query}`, { headers: authHeader() });
      let data = await r.json().catch(() => ({})) as {
        items?: CrawlerRecord[];
        page?: number;
        totalPages?: number;
        totalItems?: number;
        inventoryTotalItems?: number;
      };
      if (!r.ok) data = {};
      const applyResult = (result: typeof data) => {
        if (requestId !== videoRequestRef.current) return;
        setVideosError('');
        const videos = recordsToVideos(result.items || []);
        if (!keyword && platform === 'all' && crawlTimeRange === 'all') {
          setTenantVideoTotalItems(videos.filter(video => ACTIVE_PLATFORMS.includes(video.platform) && isDisplayableForFormat(video, contentFormat)).length);
        }
        setVideoPage(Number(result.page || nextPage));
        setVideoTotalPages(Math.max(1, Number(result.totalPages || nextPage)));
        setCrawledVideos(prev => {
          const next = videos;
          const unchanged = prev.length === next.length && prev.every((item, index) => {
            const candidate = next[index];
            return candidate
              && item.id === candidate.id
              && item.status === candidate.status
              && item.thumbnail === candidate.thumbnail
              && item.crawledAt === candidate.crawledAt
              && JSON.stringify(item.aiAnalysis || {}) === JSON.stringify(candidate.aiAnalysis || {});
          });
          return unchanged ? prev : next;
        });
      };

      // “我的社媒” is tenant-scoped even for an administrator. A successful
      // cross-tenant admin response used to overwrite these records (including
      // with an empty array), producing an impossible "179 total / 0 cards" UI.
      if (data.items) {
        applyResult(data);
        setVideosLoaded(true);
      } else {
        throw new Error('视频列表加载失败');
      }
    } catch {
      if (requestId === videoRequestRef.current && !quiet) {
        setVideosError(crawledVideos.length > 0 ? '刷新失败，已保留上次成功加载的内容。' : '灵感库存暂时无法读取，请重试。');
        setVideosLoaded(true);
      }
    } finally {
      if (requestId === videoRequestRef.current && !quiet) setVideosLoading(false);
    }
  };

  const importReferenceVideo = async (file: File | undefined) => {
    if (!file) return;
    if (file.type !== 'video/mp4' && !/\.mp4$/i.test(file.name)) {
      setMaterialMessage('对标视频请使用 MP4 文件');
      return;
    }
    if (file.size > 32 * 1024 * 1024) {
      setMaterialMessage('对标视频不能超过 32 MB');
      return;
    }
    setImportingReference(true);
    setMaterialMessage(`正在导入对标视频：${file.name}`);
    try {
      const params = new URLSearchParams({ title: file.name.replace(/\.mp4$/i, ''), platform: 'tiktok' });
      const response = await fetch(`/api/overseas/videos/import-reference-file?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'video/mp4', ...authHeader() },
        body: file,
      });
      const result = await response.json().catch(() => ({})) as { id?: string; error?: string; deduplicated?: boolean; analysisQueued?: boolean };
      if (!response.ok || !result.id) throw new Error(result.error || `导入失败（HTTP ${response.status}）`);
      const recordId = result.id;
      const readRecord = async (open = false) => {
        const latestResponse = await fetch(`/api/overseas/videos/${encodeURIComponent(recordId)}`, { headers: authHeader() });
        if (!latestResponse.ok) throw new Error('对标视频记录读取失败');
        const record = await latestResponse.json() as CrawlerRecord;
        const video = recordsToVideos([record])[0];
        if (!video) throw new Error('对标视频记录格式异常');
        setCrawledVideos(items => [video, ...items.filter(item => item.id !== video.id)]);
        setSelectedVideo(current => open || current?.id === video.id ? video : current);
        return video;
      };
      await readRecord(true);
      setMaterialMessage(result.deduplicated
        ? result.analysisQueued
          ? '已找到相同对标视频，并已重新提交全片逐镜分析。'
          : '已找到相同对标视频，正在打开分析记录。'
        : '对标视频已入库，正在进行全片逐镜分析。');
      void refreshInventory();
      void (async () => {
        for (let attempt = 0; attempt < 120; attempt += 1) {
          await new Promise(resolve => window.setTimeout(resolve, 3000));
          try {
            const latest = await readRecord();
            const status = latest.aiAnalysis?.geminiStatus;
            if (status === 'analyzed' || status === 'needs_review' || status === 'analysis_retryable' || status === 'video_failed' || latest.status === 'failed') {
              setMaterialMessage(status === 'analyzed' ? '逐镜分析完成，请检查编导交接结果。' : '逐镜分析需要复核，请查看记录中的具体原因。');
              void refreshVideos(1, true);
              return;
            }
          } catch {
            // A brief backend reload must not discard a queued import.
          }
        }
        setMaterialMessage('分析仍在后台运行，请稍后刷新灵感大屏查看结果。');
      })();
    } catch (error) {
      setMaterialMessage(error instanceof Error ? error.message : '对标视频导入失败');
    } finally {
      setImportingReference(false);
      if (referenceUploadInputRef.current) referenceUploadInputRef.current.value = '';
    }
  };

  useEffect(() => {
    setVideosLoaded(false);
    setVideoPage(1);
    setTenantVideoTotalItems(null);
    void refreshInventory();
    void refreshVideos(1);
  }, [contentFormat, crawlTimeRange, platform]); // eslint-disable-line react-hooks/exhaustive-deps

  // 输入过程中不逐字请求，停顿 400ms 后再查。
  const searchDebounceRef = useRef(false);
  useEffect(() => {
    if (!searchDebounceRef.current) { searchDebounceRef.current = true; return; }
    const timer = window.setTimeout(() => {
      setVideosLoaded(false);
      setVideoPage(1);
      void refreshVideos(1);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (innerView !== 'inspiration') return;
    let active = true;
    const timer = window.setTimeout(() => {
      setDiscoverySupplyLoading(true);
      setDiscoverySupplyError('');
      void socialDiscoveryApi.listSupply({
        candidateType: 'video',
        platform: platform === 'all' ? undefined : platform,
        businessModel: businessModelFilter === 'all' ? undefined : businessModelFilter,
        decision: discoveryDecision === 'all' ? undefined : discoveryDecision,
        minScore: minimumDiscoveryScore || undefined,
        search: search.trim() || undefined,
        sort: sortMode === 'heat' ? 'score' : 'latest',
        page: 1,
        perPage: 100,
      }).then(result => {
        if (active) setDiscoverySupplyItems(result.items);
      }).catch(error => {
        if (active) setDiscoverySupplyError(error instanceof Error ? error.message : '服务端评分暂时无法读取');
      }).finally(() => {
        if (active) setDiscoverySupplyLoading(false);
      });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [innerView, platform, businessModelFilter, discoveryDecision, minimumDiscoveryScore, search, sortMode]);

  const hasPendingVideos = crawledVideos.some(v =>
    v.aiAnalysis?.analysisProgress
      ? analysisProgressIsActive(v.aiAnalysis.analysisProgress)
      : v.status === 'pending' ||
        v.aiAnalysis?.downloadStatus === 'queued' ||
        v.aiAnalysis?.downloadStatus === 'downloading' ||
        v.aiAnalysis?.downloadStatus === 'analyzing' ||
        v.aiAnalysis?.downloadStatus === 'ops_queued'
  );

  useEffect(() => {
    if (!hasPendingVideos) return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      if (document.visibilityState === 'visible') await refreshVideos(videoPage, true);
      if (!cancelled) timer = window.setTimeout(() => void poll(), 8000);
    };
    timer = window.setTimeout(() => void poll(), 8000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hasPendingVideos, contentFormat, videoPage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedVideo) return;
    const latest = crawledVideos.find(v => v.id === selectedVideo.id);
    if (selectedVideo.id.startsWith('crawl-')) {
      const next = latest || selectedVideo;
      if (!isDisplayableForFormat(next, contentFormat)) {
        setSelectedVideo(null);
        return;
      }
    }
    if (latest && latest !== selectedVideo) setSelectedVideo(latest);
  }, [crawledVideos, selectedVideo]);

  const enterMaterialSmartGeneration = (material: Material) => {
    const usableUrl = String(material.url || material.poster || '').trim();
    const invalidVideo = material.type === 'video' && !canProcessVideo({ contentFormat: 'video', duration: material.duration });
    if (material.type === 'audio' || invalidVideo || !usableUrl) {
      showActionFeedback({
        title: '当前素材无法直接创作',
        description: material.type === 'audio'
          ? '请选择视频或图片素材。'
          : invalidVideo
            ? '视频时长尚未识别完成，请等待素材分析后重试。'
            : '素材文件尚未准备好，请稍后重试。',
        tone: 'warning',
      });
      return;
    }
    const platform: TrendVideo['platform'] = /facebook/i.test(material.name) ? 'facebook'
      : /youtube/i.test(material.name) ? 'youtube' : /instagram/i.test(material.name) ? 'instagram' : 'tiktok';
    const title = material.name.replace(/\.[a-z0-9]+$/i, '');
    const isImageMaterial = material.type === 'image';
    const video: TrendVideo = {
      id: `material-${material.id}`,
      platform,
      title,
      thumbnail: material.poster || material.segments?.[0]?.poster || '',
      duration: isImageMaterial ? 1 : Math.max(1, Number(material.duration) || 0),
      tags: Array.from(new Set(['本地素材', ...visibleMaterialTags(material.tags).split(/[,，]/).map(tag => tag.trim()).filter(Boolean)])),
      views: '本地素材',
      trend: 'stable',
      videoUrl: material.type === 'video' ? usableUrl : undefined,
      sourceUrl: material.sourceUrl || usableUrl,
      status: 'analyzed',
      crawledAt: material.createdAt,
      contentFormat: isImageMaterial ? 'image' : 'video',
    };
    onEnterWorkflow?.({
      source: 'material_library',
      materialRole: 'hook',
      video,
      generatedVideo: {
        id: material.id,
        title: material.name,
        url: usableUrl,
        poster: material.poster,
        duration: isImageMaterial ? 1 : Math.max(1, Number(material.duration) || 0),
        createdAt: material.createdAt,
        source: 'material_library',
        material,
      },
    });
    showActionSuccess('已带入自由创作', `正在打开“${material.name}”的制作页面。`);
  };
  // 爆款页只展示灵感采集结果；已入库素材统一留在“我的素材”，
  // 避免把本地片段伪装成爆款视频并混用两套交互。
  const serverDiscoveryFilterActive = discoveryDecision !== 'all'
    || businessModelFilter !== 'all'
    || minimumDiscoveryScore > 0
    || sortMode === 'heat';
  const scoredSupplyVideos = useMemo(() => supplyItemsToVideos(discoverySupplyItems), [discoverySupplyItems]);
  const scoredSupplyByRecordId = useMemo(() => new Map(scoredSupplyVideos.map(video => [video.recordId, video])), [scoredSupplyVideos]);
  const allVideos = useMemo(() => serverDiscoveryFilterActive
    ? scoredSupplyVideos
    : crawledVideos.map(video => {
      const scored = scoredSupplyByRecordId.get(video.recordId);
      return scored ? { ...video, aiAnalysis: { ...video.aiAnalysis, discoveryScore: scored.aiAnalysis?.discoveryScore, discoveryBusinessModel: scored.aiAnalysis?.discoveryBusinessModel } } : video;
    }), [serverDiscoveryFilterActive, scoredSupplyVideos, crawledVideos, scoredSupplyByRecordId]);
  const accountRecommendationByVideoId = useMemo(() => {
    const groups = new Map<string, TrendVideo[]>();
    for (const item of crawledVideos) {
      const accountKey = item.aiAnalysis?.sourceAccount;
      if (!accountKey) continue;
      groups.set(accountKey, [...(groups.get(accountKey) || []), item]);
    }
    const accountMedians = Array.from(groups.values())
      .map(items => median(items.map(item => reliablePublicViews(item.views)).filter(value => value > 0)))
      .filter(value => value > 0);
    const recommendations = new Map<string, AccountSpecialRecommendation>();
    for (const items of groups.values()) {
      for (const item of items) {
        const recommendation = specialRecommendationForVideo(item, items, accountMedians);
        if (recommendation) recommendations.set(item.id, recommendation);
      }
    }
    return recommendations;
  }, [crawledVideos]);
  const visibleVideos = allVideos.filter(v =>
    ACTIVE_PLATFORMS.includes(v.platform)
    && isDisplayableForFormat(v, contentFormat)
  );
  const favoriteSourceUrls = useMemo(() => new Set(localMaterials
    .filter(isFavoriteMaterial)
    .map(material => String(material.sourceUrl || '').trim())
    .filter(Boolean)), [localMaterials]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleVideos
      .filter(v =>
        (platform === 'all' || v.platform === platform) &&
        (inspirationFavoriteFilter === 'all' || favoritedVideoIds.includes(v.id) || favoriteSourceUrls.has(String(v.sourceUrl || '').trim())) &&
        (!q || v.title.toLowerCase().includes(q) || v.tags.some(t => t.toLowerCase().includes(q)))
      )
      .sort((a, b) => {
        if (contentFormat === 'image') {
          const analyzedRank = Number(b.aiAnalysis?.imageEvidence?.status === 'analyzed') - Number(a.aiAnalysis?.imageEvidence?.status === 'analyzed');
          if (analyzedRank) return analyzedRank;
        }
        if (sortMode === 'crawlTime') {
          return timeValue(b.crawledAt) - timeValue(a.crawledAt) || heatValue(b.views) - heatValue(a.views);
        }
        const scoreA = inspirationScoresForVideo(a);
        const scoreB = inspirationScoresForVideo(b);
        return scoreB.contentOpportunityScore - scoreA.contentOpportunityScore
          || scoreB.sourcePriority - scoreA.sourcePriority
          || timeValue(b.crawledAt) - timeValue(a.crawledAt);
      });
  }, [visibleVideos, platform, inspirationFavoriteFilter, favoritedVideoIds, favoriteSourceUrls, search, sortMode, contentFormat]);

  const shootingNeeds = useMemo(() => buildShootingNeeds(visibleVideos, localMaterials), [visibleVideos, localMaterials]);
  const shootingCards = useMemo(() => [
    ...scriptGapTasks.map(task => ({ id: task.id, kind: 'storyboard' as const, createdAt: task.createdAt, task })),
    ...shootingNeeds.map(need => ({ id: need.id, kind: 'common' as const, createdAt: need.createdAt, need })),
  ].sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0) || a.id.localeCompare(b.id)), [scriptGapTasks, shootingNeeds]);
  const latestShootingCardIds = useMemo(() => new Set(shootingCards.slice(0, 3).map(card => card.id)), [shootingCards]);
  const visibleShootingCards = shootingCards.filter(card => shootingFilter === 'all'
    || (shootingFilter === 'storyboard' && card.kind === 'storyboard')
    || (shootingFilter === 'common' && card.kind === 'common'));
  const materialFunctionOptions = useMemo(() => {
    const values = new Set<string>();
    localMaterials.forEach(material => String(material.shotFunction || '').split(',').map(item => item.trim()).filter(Boolean).forEach(item => values.add(item)));
    return [...values].sort((a, b) => (MATERIAL_FUNCTION_LABELS[a] || a).localeCompare(MATERIAL_FUNCTION_LABELS[b] || b, 'zh-CN'));
  }, [localMaterials]);
  const filteredMaterials = useMemo(() => {
    const q = materialSearch.trim().toLowerCase();
    return localMaterials.filter(material => {
      const functions = String(material.shotFunction || '').split(',').map(item => item.trim());
      const searchable = [material.name, material.folder, material.industry, material.shotFunction, material.applicability, material.tags, material.productName, material.scriptAnalysis?.searchableText, materialSemanticLabel(material)].filter(Boolean).join(' ').toLowerCase();
      const orientationMatches = materialOrientation === 'all'
        || (materialOrientation === 'vertical' && /竖屏|vertical/i.test(String(material.tags || '')))
        || (materialOrientation === 'horizontal' && /横屏|horizontal/i.test(String(material.tags || '')));
      const productMatches = materialMatchesProductFilter(material, {
        enabled: materialProductFilterEnabled,
        productId: materialProductId,
        productRef: materialProductRef,
      });
      return (!q || searchable.includes(q))
        && (materialTheme === 'all' || materialThemeTagsOf(material).includes(materialTheme))
        && (materialType === 'all' || material.type === materialType)
        && (materialIndustry === 'all' || material.industry === materialIndustry)
        && (materialFunction === 'all' || functions.includes(materialFunction))
        && (materialApplicability === 'all' || material.applicability === materialApplicability)
        && (materialSource === 'all' || materialSource === materialSourceCategoryOf(material))
        && (materialFavoriteFilter === 'all' || isFavoriteMaterial(material))
        && productMatches
        && orientationMatches;
    }).sort((a, b) => {
      // User uploads are the primary working set. Seed/demo library records may
      // have a later migration timestamp, which must not push fresh uploads down.
      const sourcePriority = Number(materialSourceCategoryOf(b) === 'local_upload') - Number(materialSourceCategoryOf(a) === 'local_upload');
      return sourcePriority || (Date.parse(String(b.createdAt || '')) || 0) - (Date.parse(String(a.createdAt || '')) || 0);
    });
  }, [localMaterials, materialSearch, materialType, materialIndustry, materialFunction, materialApplicability, materialOrientation, materialSource, materialTheme, materialFavoriteFilter, materialProductFilterEnabled, materialProductId, materialProductRef]);

  const handleUploadMaterials = async (files: FileList | null) => {
    if (!files?.length) return;
    if (!uploadProductId) {
      setMaterialMessage('请先选择素材对应的产品；产品素材必须与产品表中的产品一一绑定。');
      if (uploadInputRef.current) uploadInputRef.current.value = '';
      return;
    }
    setUploadingMaterial(true);
    setMaterialMessage('');
    try {
      const uploadedVideos: Material[] = [];
      const uploadedIds: string[] = [];
      for (const file of Array.from(files)) {
        const type = file.type.startsWith('video') ? 'video' : file.type.startsWith('audio') ? 'audio' : 'image';
        const result = await studioApi.uploadMaterialFile(file, {
          folder: 'social',
          type,
          duration: 0,
          sourceType: 'local-upload',
        });
        if (!result.ok || !result.material?.id) throw new Error(result.error || `「${file.name}」上传失败，请检查素材服务后重试`);
        const linked = await studioApi.updateMaterial(result.material.id, {
          name: result.material.name || file.name,
          tags: materialOwnershipTags(result.material.tags, uploadProductId),
          productId: uploadProductId,
        });
        if (!linked.ok) throw new Error(`「${file.name}」已上传，但产品归属保存失败，请在素材卡片中编辑后重试`);
        uploadedIds.push(result.material.id);
        if (type === 'video' && result.material?.id) uploadedVideos.push(result.material);
      }
      setMaterialMessage(uploadedVideos.length ? `已上传，正在分析 ${uploadedVideos.length} 个视频的可用片段…` : `已上传 ${files.length} 个素材到社媒素材库`);
      await refreshMaterials();
      window.dispatchEvent(new Event('lingshu:materials-updated'));
      if (uploadingScriptGapId && uploadedIds.length) await updateScriptGapTask(uploadingScriptGapId, { uploadedMaterialIds: uploadedIds });
      setMaterialMessage(uploadedVideos.length
        ? `已上传 ${files.length} 个素材，视频已进入分析队列，可在素材卡片查看进度`
        : `已上传 ${files.length} 个素材到社媒素材库`);
      setTimeout(() => setMaterialMessage(''), 2800);
    } catch (e) {
      setMaterialMessage(e instanceof Error ? e.message : '素材上传失败');
    } finally {
      setUploadingMaterial(false);
      setUploadingScriptGapId('');
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  };

  const requestMaterialUpload = (scriptGapId = '') => {
    setInnerView('library');
    setUploadingScriptGapId(scriptGapId);
    setMaterialUploadDialogOpen(true);
  };

  const generateNeedMaterial = async (item: ShootingNeed | ScriptGapTask) => {
    const title = item.title;
    const ratio = item.ratio || '9:16';
    setGeneratingNeedId(item.id);
    setMaterialMessage(`正在生成“${title}”，通常需要几分钟；可以留在本页等待结果。`);
    try {
      const output = await studioApi.seedanceVideo({
        script: 'origin' in item
          ? `${item.title}\n拍摄要求：${item.shotBrief}\n产品：${item.productLabel}\n主题：${item.themeTitle}\n输出 ${ratio} 视频素材。`
          : `${item.title}\n${item.suggestion}\n参考分镜：${item.example?.visual || ''}\n输出 ${ratio} 社媒短视频素材。`,
        productInfo: 'origin' in item ? item.productLabel : item.suggestion,
        language: 'zh',
        ratio,
        duration: 5,
        resolution: '720p',
        title: `Seedance 2.0 待拍素材 · ${title}`,
      });
      if (!output.ok) throw new Error(output.error || 'Seedance 2.0 生成失败');
      await refreshMaterials();
      setMaterialMessage(`Seedance 2.0 已生成素材：${title}`);
      setTimeout(() => setMaterialMessage(''), 2800);
    } catch (e) {
      setMaterialMessage(e instanceof Error ? e.message : 'Seedance 2.0 生成失败');
    } finally {
      setGeneratingNeedId('');
    }
  };

  const handlePlatformFilter = (nextPlatform: Platform) => {
    setLastCrawlVideoIds([]);
    setPlatform(nextPlatform);
  };

  const handleContentFormatFilter = (nextFormat: ContentFormat) => {
    setLastCrawlVideoIds([]);
    setSelectedVideo(null);
    setContentFormat(nextFormat);
  };

  const resetInspirationFilters = () => {
    setLastCrawlVideoIds([]);
    setSearch('');
    setPlatform('all');
    setInspirationFavoriteFilter('all');
    setCrawlTimeRange('all');
    setDiscoveryDecision('all');
    setBusinessModelFilter('all');
    setMinimumDiscoveryScore(0);
  };

  const handleWatch = (video: TrendVideo) => {
    if (video.videoUrl || sourceEmbedUrl(video)) {
      setWatchVideo(video);
      return;
    }
    if (video.sourceUrl) {
      window.open(video.sourceUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    setWatchVideo(video);
  };

  const openDirectorAnalysis = (video: TrendVideo) => {
    setMaterialMessage('');
    setSelectedVideo(current => current?.id === video.id ? null : video);
  };

  const analyzeVideoOnly = async (video: TrendVideo, quiet = false) => {
    if (!video.sourceUrl || analyzingVideoIds.includes(video.id)) return;
    setAnalyzingVideoIds(ids => [...ids, video.id]);
    if (!quiet) setMaterialMessage('');
    try {
      const r = await fetch('/api/overseas/videos/analyze-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          id: video.recordId,
          sourceUrl: video.sourceUrl,
          title: video.title,
          platform: video.platform,
          async: true,
        }),
      });
      const data = await r.json().catch(() => ({})) as {
        error?: string;
        analysis?: GeminiVideoAnalysis;
      };
      if (!r.ok) throw new Error(data.error || '视频分析失败');
      if (r.status === 202) {
        setMaterialMessage(`已加入视频获取队列，获取成功后自动进入 Gemini 分析：${video.title}`);
        setTimeout(() => setMaterialMessage(''), 3500);
        void refreshVideos();
        return;
      }
      const updated: TrendVideo = {
        ...video,
        status: 'analyzed',
        aiAnalysis: {
          ...(video.aiAnalysis || {}),
          gemini: data.analysis,
          analysisSource: 'gemini-temp-video',
          downloadStatus: 'analyzed',
          analyzedAt: new Date().toISOString(),
        },
      };
      setCrawledVideos(prev => prev.map(v => v.id === video.id ? updated : v));
      setSelectedVideo(v => v?.id === video.id ? updated : v);
      setWatchVideo(v => v?.id === video.id ? updated : v);
      setMaterialMessage(`Gemini 分析完成：${video.title}`);
      setTimeout(() => setMaterialMessage(''), 3500);
    } catch (e) {
      if (!quiet) setMaterialMessage(e instanceof Error ? e.message : '视频分析失败');
    } finally {
      setAnalyzingVideoIds(ids => ids.filter(id => id !== video.id));
    }
  };

  const enterInspirationWorkflow = async (video: TrendVideo) => {
    const availability = inspirationCreationAvailability(video);
    if (!availability.ready) {
      setMaterialMessage(availability.reason);
      showActionFeedback({ title: '当前内容还不能开始创作', description: availability.reason, tone: 'warning' });
      return;
    }
    if (video.contentFormat === 'image' || video.id.startsWith('material-')) {
      const analysis = getAnalysis(video);
      onEnterWorkflow?.({
        source: video.contentFormat === 'image' ? 'inspiration_image_post' : 'inspiration_analysis',
        video, scriptType: 'storyboard',
        referenceAnalysis: analysis ? { title: video.title, visualStyle: analysis.scriptSummary15s.visualStyle,
          coreEmotion: analysis.scriptSummary15s.coreEmotion, details: analysis.scriptDetails15s } : undefined,
      });
      return;
    }
    if (inspirationLaunches.current.has(video.id)) return;
    const openTask = (taskId: string) => {
      window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: {
        page: 'smartAssets', view: 'create',
        directStudio: false,
        socialContentTaskId: taskId,
        socialContentPage: 'smartAssets',
        contentCreationRequest: {
          requestId: Date.now(),
          themeId: 'product_value',
          mode: 'instant',
          creationPath: 'viral_replication',
          materialInput: video.videoUrl ? 'ready' : 'limited',
          managedMode: 'one_click_managed',
          continueTaskId: taskId,
          prefill: {
            title: `${video.title || '灵感视频'} · 爆款裂变`,
            topic: video.title || '',
            referenceLinks: [video.sourceUrl || video.videoUrl || ''].filter(Boolean),
            platforms: video.platform ? [video.platform] : undefined,
          },
          sourceContext: {
            originLabel: '来自灵感中心',
            referenceTitle: video.title || '已选参考视频',
            referenceThumbnail: video.thumbnail,
            referenceMediaUrl: video.videoUrl || undefined,
            referenceContentType: 'video',
            referenceShots: getAnalysis(video)?.scriptDetails15s.map(detail => ({ time: detail.time, dialogue: detail.dialogue, subtitle: detail.subtitle, visual: detail.visual, firstFrameRef: detail.materialEvidence?.firstFrameRef || undefined, firstFrameSeconds: detail.materialEvidence?.firstFrameSeconds })) || [],
          },
        },
      } }));
    };
    const candidateKey = `${video.id}:${creationAccountId}`;
    const existing = replicationTasks[candidateKey];
    if (existing) { openTask(existing); return; }
    inspirationLaunches.current.add(video.id);
    setLaunchingReferences(ids => [...ids, video.id]);
    setMaterialMessage('正在关联参考与经营背景，交给编导 Agent 和内容 Agent 执行…');
    try {
      const program = activeProgram?.status === 'active' ? activeProgram : undefined;
      const creationAccount = accounts.find(account => account.accountId === creationAccountId && account.status === 'active');
      const result = await resumeOrCreateInspirationTask({
        id: video.recordId || video.id, title: video.title,
        sourceUrl: video.sourceUrl || (video.recordId ? `local://${video.recordId}` : undefined), crawledAt: video.crawledAt,
        ...(creationAccount ? { context: {
          targetAccountRef: { objectType: 'social_owned_account', id: creationAccount.accountId, version: String(creationAccount.version) },
          platforms: [creationAccount.platform],
        } } : {}),
      }, program);
      setReplicationTasks(tasks => ({ ...tasks, [candidateKey]: result.task.taskId }));
      if (result.warning) {
        setMaterialMessage(`${result.warning} 已保留原任务，点击“继续制作”查看和恢复。`);
      }
      openTask(result.task.taskId);
    } catch (error) {
      setMaterialMessage(error instanceof Error ? error.message : '复刻任务暂时无法创建，请重试。');
    } finally {
      inspirationLaunches.current.delete(video.id);
      setLaunchingReferences(ids => ids.filter(id => id !== video.id));
    }
  };

  const favoriteMaterial = async (video: TrendVideo, quiet = false) => {
    if (favoritingMaterialIds.includes(video.id)) return;
    const linkedMaterial = localMaterials.find(material =>
      material.id === video.aiAnalysis?.materialId
      || (Boolean(material.sourceUrl) && material.sourceUrl === video.sourceUrl));
    const linkedMaterialId = linkedMaterial?.id || String(video.aiAnalysis?.materialId || '').trim();
    const currentlyFavorite = favoritedVideoIds.includes(video.id) || Boolean(linkedMaterial?.pinned);
    setFavoritingMaterialIds(ids => [...ids, video.id]);
    if (!quiet) setMaterialMessage('');
    try {
      if (currentlyFavorite) {
        if (!linkedMaterial) {
          setMaterialMessage('收藏正在保存，请稍后再取消。');
          return;
        }
        const result = await studioApi.setMaterialPinned(linkedMaterial.id, false);
        if (!result.ok) throw new Error(result.error || '取消收藏失败');
        setLocalMaterials(items => items.map(item => item.id === linkedMaterial.id ? { ...item, pinned: false } : item));
        setFavoritedVideoIds(ids => ids.filter(id => id !== video.id));
        setMaterialMessage(`已取消收藏：${video.title}`);
        showActionSuccess('已取消收藏', video.title);
        setTimeout(() => setMaterialMessage(''), 3500);
        return;
      }
      if (linkedMaterialId) {
        const result = await studioApi.setMaterialPinned(linkedMaterialId, true);
        if (!result.ok) throw new Error(result.error || '收藏失败');
        setLocalMaterials(items => items.map(item => item.id === linkedMaterialId ? { ...item, pinned: true } : item));
        setFavoritedVideoIds(ids => ids.includes(video.id) ? ids : [...ids, video.id]);
        setMaterialMessage(`已收藏到我的素材：${video.title}`);
        showActionSuccess('收藏成功', '已加入“我的素材”，可以通过收藏筛选快速找到。');
        setTimeout(() => setMaterialMessage(''), 3500);
        return;
      }
      const sourceUrl = String(video.sourceUrl || video.videoUrl || '').trim();
      if (!sourceUrl && !video.recordId) throw new Error('当前视频尚未准备好可收藏的文件');
      const r = await fetch('/api/overseas/videos/download-material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          id: video.recordId,
          sourceUrl,
          title: video.title,
          platform: video.platform,
          async: true,
        }),
      });
      const data = await r.json().catch(() => ({})) as {
        error?: string;
        material?: { name?: string; url?: string; poster?: string; duration?: number };
      };
      if (!r.ok) throw new Error(data.error || '收藏失败');
      if (r.status === 202) {
        setFavoritedVideoIds(ids => ids.includes(video.id) ? ids : [...ids, video.id]);
        setMaterialMessage(`已加入爆款素材收藏队列：${video.title}`);
        showActionFeedback({ title: '正在收藏', description: '视频获取完成后会自动出现在“我的素材”。', tone: 'info' });
        setTimeout(() => setMaterialMessage(''), 3500);
        void refreshVideos();
        window.setTimeout(() => void refreshMaterials(), 5000);
        return;
      }
      const updated: TrendVideo = {
        ...video,
        videoUrl: data.material?.url || video.videoUrl,
        thumbnail: data.material?.poster || video.thumbnail,
        duration: data.material?.duration || video.duration,
      };
      setCrawledVideos(prev => prev.map(v => v.id === video.id ? updated : v));
      setSelectedVideo(v => v?.id === video.id ? updated : v);
      setWatchVideo(v => v?.id === video.id ? updated : v);
      setFavoritedVideoIds(ids => ids.includes(video.id) ? ids : [...ids, video.id]);
      void refreshMaterials();
      setMaterialMessage(`已收藏到爆款素材：${data.material?.name || video.title}`);
      showActionSuccess('收藏成功', '已加入“我的素材”，可以通过收藏筛选快速找到。');
      setTimeout(() => setMaterialMessage(''), 3500);
    } catch (e) {
      const message = e instanceof Error ? e.message : '收藏失败';
      if (!quiet) setMaterialMessage(message);
      showActionFeedback({ title: '收藏失败', description: message, tone: 'error' });
    } finally {
      setFavoritingMaterialIds(ids => ids.filter(id => id !== video.id));
    }
  };

  const toggleMaterialFavorite = async (material: Material) => {
    if (favoritingMaterialIds.includes(material.id)) return;
    if (!material.canManage) {
      showActionFeedback({ title: '共享素材暂不能收藏', description: '请先复制到企业素材库后再收藏。', tone: 'warning' });
      return;
    }
    const nextPinned = !isFavoriteMaterial(material);
    setFavoritingMaterialIds(ids => [...ids, material.id]);
    setMaterialMessage('');
    try {
      const result = await studioApi.setMaterialPinned(material.id, nextPinned);
      if (!result.ok) throw new Error(result.error || '收藏状态保存失败');
      setLocalMaterials(items => items.map(item => item.id === material.id ? { ...item, pinned: nextPinned } : item));
      setMaterialMessage(nextPinned ? `已收藏素材：${material.name}` : `已取消收藏：${material.name}`);
      showActionSuccess(nextPinned ? '收藏成功' : '已取消收藏', nextPinned ? '可通过“仅看收藏”快速筛选。' : material.name);
      setTimeout(() => setMaterialMessage(''), 3500);
      window.dispatchEvent(new Event('lingshu:materials-updated'));
    } catch (error) {
      const message = error instanceof Error ? error.message : '收藏状态保存失败';
      setMaterialMessage(message);
      showActionFeedback({ title: '操作失败', description: message, tone: 'error' });
    } finally {
      setFavoritingMaterialIds(ids => ids.filter(id => id !== material.id));
    }
  };

  const retryVideoPipeline = async (video: TrendVideo) => {
    if (video.recordId) {
      setMaterialMessage(`已重新提交 Gemini 分析：${video.title}`);
      try {
        const r = await fetch(`/api/overseas/videos/${video.recordId}/reanalyze`, {
          method: 'PATCH',
          headers: authHeader(),
        });
        const data = await r.json().catch(() => ({})) as { error?: string };
        if (!r.ok) throw new Error(data.error || '重新分析失败');
        void refreshVideos();
      } catch (e) {
        setMaterialMessage(e instanceof Error ? e.message : '重新分析失败');
      }
      setTimeout(() => setMaterialMessage(''), 3500);
      return;
    }
    await analyzeVideoOnly(video);
  };

  const reanalyzeImagePost = async (video: TrendVideo) => {
    const recordId = video.recordId || video.id.replace(/^crawl-/, '');
    if (!recordId || analyzingVideoIds.includes(video.id)) return;
    setAnalyzingVideoIds(ids => [...ids, video.id]);
    setMaterialMessage(`正在重新分析图文证据：${video.title}`);
    try {
      const response = await fetch(`/api/overseas/videos/${encodeURIComponent(recordId)}/reanalyze-image`, {
        method: 'POST',
        headers: authHeader(),
      });
      const data = await response.json().catch(() => ({})) as {
        error?: string;
        analysis?: NonNullable<VideoAnalysisPayload['imageEvidence']>;
      };
      if (!response.ok || !data.analysis) throw new Error(data.error || '图文证据分析失败');
      const markAnalyzed = (item: TrendVideo): TrendVideo => item.id !== video.id ? item : {
        ...item,
        status: 'analyzed',
        aiAnalysis: {
          ...(item.aiAnalysis || {}),
          imageEvidence: data.analysis,
          imageAnalysisStatus: 'analyzed',
          imageAnalysisError: undefined,
          analysisError: undefined,
          analyzedAt: new Date().toISOString(),
        },
      };
      setCrawledVideos(items => items.map(markAnalyzed));
      setSelectedVideo(item => item ? markAnalyzed(item) : item);
      setWatchVideo(item => item ? markAnalyzed(item) : item);
      setMaterialMessage('图文证据分析已完成，可以开始创作。');
      await refreshVideos(videoPage, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : '图文证据分析失败';
      setMaterialMessage(message);
      showActionFeedback({ title: '图文分析失败', description: message, tone: 'error' });
      await refreshVideos(videoPage, true);
    } finally {
      setAnalyzingVideoIds(ids => ids.filter(id => id !== video.id));
      window.setTimeout(() => setMaterialMessage(''), 3500);
    }
  };

  const requestExactFullAnalysis = async (video: TrendVideo, force = false) => {
    if (analyzingVideoIds.includes(video.id)) return;
    const materialId = video.id.startsWith('material-') ? video.id.slice('material-'.length) : '';
    if (!video.recordId && !materialId) {
      setMaterialMessage('当前视频缺少可分析的入库记录或素材文件');
      return;
    }
    setAnalyzingVideoIds(ids => [...ids, video.id]);
    setMaterialMessage(`正在提交全片精确分析：${video.title}`);
    try {
      const response = await fetch(video.recordId
        ? `/api/overseas/videos/${video.recordId}/reanalyze`
        : '/api/overseas/videos/material-exact-analysis', {
        method: video.recordId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(video.recordId
          ? { analysisMode: 'exact', ...(force ? { force: true } : {}) }
          : { materialId, title: video.title, platform: video.platform, duration: video.duration }),
      });
      const data = parseExactAnalysisResponse(await response.text(), response.status);
      if (!response.ok) throw new Error(data.error || '全片精确分析提交失败');
      if (data.status === 'analyzed') {
        const markCompleted = (item: TrendVideo): TrendVideo => ({
          ...item,
          status: 'analyzed',
          aiAnalysis: { ...(item.aiAnalysis || {}), analysisMode: 'exact', requestedAnalysisMode: undefined },
        });
        setCrawledVideos(items => items.map(item => item.id === video.id ? markCompleted(item) : item));
        setSelectedVideo(item => item?.id === video.id ? markCompleted(item) : item);
        setMaterialMessage(data.reused ? '现有全片拆解已达到精确密度，已升级为全片精确分析版。' : '全片精确分析已完成。');
        return;
      }
      const markQueued = (item: TrendVideo): TrendVideo => ({
        ...item,
        recordId: data.id || item.recordId,
        status: 'pending',
        aiAnalysis: {
          ...(item.aiAnalysis || {}),
          analysisProgress: undefined,
          requestedAnalysisMode: 'exact',
          geminiStatus: 'queued',
          analysisError: undefined,
          videoLevelFailureStatus: undefined,
        },
      });
      setCrawledVideos(items => items.map(item => item.id === video.id ? markQueued(item) : item));
      setSelectedVideo(item => item?.id === video.id ? markQueued(item) : item);
      const recordId = data.id || video.recordId;
      if (recordId) {
        void (async () => {
          let completed = false;
          for (let attempt = 0; attempt < 90; attempt += 1) {
            await new Promise(resolve => window.setTimeout(resolve, 2000));
            try {
              const latestResponse = await fetch(`/api/overseas/videos/${recordId}`, { headers: authHeader() });
              if (!latestResponse.ok) continue;
              const latest = await latestResponse.json() as CrawlerRecord;
              let latestAnalysis: VideoAnalysisPayload = {};
              try { latestAnalysis = JSON.parse(latest.aiAnalysis || '{}') as VideoAnalysisPayload; } catch {}
              const applyLatest = (item: TrendVideo): TrendVideo => item.id !== video.id ? item : {
                ...item,
                recordId,
                status: latest.status || item.status,
                aiAnalysis: { ...(item.aiAnalysis || {}), ...latestAnalysis },
              };
              setCrawledVideos(items => items.map(applyLatest));
              setSelectedVideo(item => item ? applyLatest(item) : item);
              const progressFinished = Boolean(latestAnalysis.analysisProgress)
                && !analysisProgressIsActive(latestAnalysis.analysisProgress);
              if (!latestAnalysis.requestedAnalysisMode || progressFinished) {
                completed = true;
                setMaterialMessage(latestAnalysis.analysisError || latestAnalysis.analysisProgress?.stage === 'failed'
                  ? `全片精确分析未完成，可重新尝试。`
                  : '全片精确分析已完成。');
                window.setTimeout(() => setMaterialMessage(''), 3500);
                break;
              }
            } catch {
              // A transient backend reload should not lose the visible queued state.
            }
          }
          if (!completed) {
            setMaterialMessage('暂未收到分析终态；请以详情中的后台进度凭证、当前步骤和预计完成时间为准。');
          }
        })();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '全片精确分析提交失败';
      const markFailed = (item: TrendVideo): TrendVideo => ({
        ...item,
        status: item.aiAnalysis?.gemini ? 'analyzed' : 'failed',
        aiAnalysis: { ...(item.aiAnalysis || {}), requestedAnalysisMode: undefined, analysisError: message },
      });
      setCrawledVideos(items => items.map(item => item.id === video.id ? markFailed(item) : item));
      setSelectedVideo(item => item?.id === video.id ? markFailed(item) : item);
      setMaterialMessage(message);
    } finally {
      setAnalyzingVideoIds(ids => ids.filter(id => id !== video.id));
      setTimeout(() => setMaterialMessage(''), 3500);
    }
  };

  const cancelExactFullAnalysis = async (video: TrendVideo) => {
    if (!video.recordId) return;
    setMaterialMessage('正在停止本次精确分析…');
    try {
      const response = await fetch(`/api/overseas/videos/${video.recordId}/analysis-pause`, {
        method: 'POST',
        headers: authHeader(),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || '停止分析失败');
      const markPaused = (item: TrendVideo): TrendVideo => item.id !== video.id ? item : {
        ...item,
        status: item.aiAnalysis?.gemini || item.aiAnalysis?.analysisQuality ? 'analyzed' : 'failed',
        aiAnalysis: { ...(item.aiAnalysis || {}), analysisProgress: undefined, requestedAnalysisMode: undefined, geminiStatus: 'paused' },
      };
      setCrawledVideos(items => items.map(markPaused));
      setSelectedVideo(item => item ? markPaused(item) : item);
      setMaterialMessage('已停止。本次未产生的结果不会进入后续制作，可以重新分析。');
      window.setTimeout(() => setMaterialMessage(''), 3500);
    } catch (error) {
      setMaterialMessage(error instanceof Error ? error.message : '停止分析失败');
    }
  };

  const startInspirationCreation = (video: TrendVideo) => {
    const availability = inspirationCreationAvailability(video);
    if (!availability.ready && video.contentFormat === 'video') {
      setSelectedVideo(video);
      setMaterialMessage('正在先补齐详细分析；分析完成后即可继续爆款复刻。');
      void requestExactFullAnalysis(video, ['paused', 'cancelled'].includes(String(video.aiAnalysis?.analysisProgress?.stage || '')) || video.aiAnalysis?.geminiStatus === 'paused');
      return;
    }
    void enterInspirationWorkflow(video);
  };


  const openManageDialog = (target: ({ kind: 'video'; item: TrendVideo } | { kind: 'material'; item: Material }) & { action?: 'edit' | 'delete' }) => {
    if (!target.item.canManage) return;
    setManageTarget({ ...target, action: target.action || 'edit' });
    setManageProductId(target.kind === 'material'
      ? target.item.productId || ''
      : '');
    if (target.kind === 'material') void studioApi.materialProducts().then(result => setMaterialProducts(result.items));
    setManageName(target.kind === 'video' ? target.item.title : target.item.name);
    setManageTags(target.kind === 'video' ? target.item.tags.join(', ') : visibleMaterialTags(target.item.tags));
  };

  const saveManagedItem = async () => {
    if (!manageTarget || !manageName.trim() || manageBusy) return;
    setManageBusy(true);
    try {
      if (manageTarget.kind === 'video') {
        const recordId = manageTarget.item.recordId;
        if (!recordId) throw new Error('视频记录不存在');
        const response = await fetch(`/api/overseas/videos/${encodeURIComponent(recordId)}`, {
          method: 'PATCH',
          headers: { ...authHeader(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: manageName.trim(), tags: manageTags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean) }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || '编辑失败');
        setCrawledVideos(items => items.map(item => item.id === manageTarget.item.id
          ? { ...item, title: manageName.trim(), tags: manageTags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean) }
          : item));
      } else {
        const result = await studioApi.updateMaterial(manageTarget.item.id, {
          name: manageName.trim(),
          tags: materialOwnershipTags(manageTags.trim(), manageProductId),
          productId: manageProductId,
        });
        if (!result.ok) throw new Error(result.error || '编辑失败');
        await refreshMaterials();
      }
      setMaterialMessage('已保存修改');
      setManageTarget(null);
    } catch (error) {
      setMaterialMessage(error instanceof Error ? error.message : '编辑失败');
    } finally {
      setManageBusy(false);
    }
  };

  const deleteManagedItem = async () => {
    if (!manageTarget || manageBusy) return;
    setManageBusy(true);
    try {
      if (manageTarget.kind === 'video') {
        const recordId = manageTarget.item.recordId;
        if (!recordId) throw new Error('视频记录不存在');
        const response = await fetch(`/api/overseas/videos/${encodeURIComponent(recordId)}`, {
          method: 'DELETE',
          headers: authHeader(),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || '删除失败');
        setCrawledVideos(items => items.filter(item => item.id !== manageTarget.item.id));
        setTenantVideoTotalItems(value => value === null ? null : Math.max(0, value - 1));
        // Re-read the authoritative tenant list so a deleted record cannot
        // linger in another page/count cache.
        await refreshVideos(1, true);
      } else {
        const result = await studioApi.deleteMaterial(manageTarget.item.id);
        if (!result.ok) throw new Error(result.error || '删除失败');
        setLocalMaterials(items => items.filter(item => item.id !== manageTarget.item.id));
      }
      setMaterialMessage('已删除');
      setManageTarget(null);
    } catch (error) {
      setMaterialMessage(error instanceof Error ? error.message : '删除失败');
    } finally {
      setManageBusy(false);
    }
  };

  const clearInspirationFilters = () => {
    setLastCrawlVideoIds([]);
    setSearch('');
    setPlatform('all');
    setContentFormat('video');
    setInspirationFavoriteFilter('all');
    setCrawlTimeRange('all');
    setDiscoveryDecision('all');
    setBusinessModelFilter('all');
    setMinimumDiscoveryScore(0);
    setSortMode('crawlTime');
    setViewMode('grid');
  };

  const setMaterialProductSelection = (value: string) => {
    const url = new URL(window.location.href);
    if (value === MATERIAL_PRODUCT_ALL) {
      setMaterialProductFilterEnabled(false);
      setMaterialProductId('');
      setMaterialProductRef('');
      url.searchParams.delete('productId');
      url.searchParams.delete('productRef');
    } else if (value === MATERIAL_PRODUCT_COMMON) {
      setMaterialProductFilterEnabled(true);
      setMaterialProductId('');
      setMaterialProductRef('');
      url.searchParams.set('productId', '');
      url.searchParams.set('productRef', '');
    } else if (value === MATERIAL_PRODUCT_LINKED_REF) {
      setMaterialProductFilterEnabled(true);
      setMaterialProductId('');
      url.searchParams.set('productId', '');
      url.searchParams.set('productRef', materialProductRef);
    } else {
      const product = materialProducts.find(item => item.id === value);
      setMaterialProductFilterEnabled(true);
      setMaterialProductId(value);
      setMaterialProductRef(product?.name || materialProductRef);
      url.searchParams.set('productId', value);
      url.searchParams.set('productRef', product?.name || materialProductRef);
    }
    const productId = String(url.searchParams.get('productId') || '');
    const productRef = String(url.searchParams.get('productRef') || '');
    window.history.replaceState({
      ...window.history.state,
      productionDetail: {
        ...(window.history.state?.productionDetail || {}),
        page: 'socialInspiration',
        view: 'library',
        productId,
        productRef,
      },
    }, '', url);
  };

  const materialProductFilterValue = !materialProductFilterEnabled
    ? MATERIAL_PRODUCT_ALL
    : materialProductId || (materialProductRef ? MATERIAL_PRODUCT_LINKED_REF : MATERIAL_PRODUCT_COMMON);

  const clearMaterialFilters = () => {
    setMaterialSearch('');
    setMaterialSource('all');
    setMaterialTheme('all');
    setMaterialType('all');
    setMaterialFavoriteFilter('all');
    setMaterialIndustry('all');
    setMaterialFunction('all');
    setMaterialApplicability('all');
    setMaterialOrientation('all');
    setMaterialProductSelection(MATERIAL_PRODUCT_ALL);
  };

  const inspirationFilterCount = Number(search.trim().length > 0)
    + Number(platform !== 'all')
    + Number(contentFormat !== 'video')
    + Number(inspirationFavoriteFilter !== 'all')
    + Number(crawlTimeRange !== 'all')
    + Number(discoveryDecision !== 'all')
    + Number(businessModelFilter !== 'all')
    + Number(minimumDiscoveryScore > 0)
    + Number(sortMode !== 'crawlTime')
    + Number(viewMode !== 'grid');
  const inspirationAdvancedFilterCount = Number(crawlTimeRange !== 'all')
    + Number(discoveryDecision !== 'all')
    + Number(businessModelFilter !== 'all')
    + Number(minimumDiscoveryScore > 0)
    + Number(sortMode !== 'crawlTime')
    + Number(viewMode !== 'grid');
  const materialFilterCount = Number(materialSearch.trim().length > 0)
    + Number(materialTheme !== 'all')
    + Number(materialSource !== 'all')
    + Number(materialType !== 'all')
    + Number(materialFavoriteFilter !== 'all')
    + Number(materialIndustry !== 'all')
    + Number(materialFunction !== 'all')
    + Number(materialApplicability !== 'all')
    + Number(materialOrientation !== 'all')
    + Number(materialProductFilterEnabled);
  const materialAdvancedFilterCount = Number(materialIndustry !== 'all')
    + Number(materialFavoriteFilter !== 'all')
    + Number(materialFunction !== 'all')
    + Number(materialApplicability !== 'all')
    + Number(materialOrientation !== 'all')
    + Number(materialProductFilterEnabled);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/overseas/competitor-accounts', { headers: authHeader() })
      .then(async response => {
        if (!response.ok) return;
        const data = await response.json().catch(() => ({})) as { items?: unknown[] };
        if (!cancelled) setCompetitorAccountCount(Array.isArray(data.items) ? data.items.length : 0);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="relative min-h-full bg-ink text-text-primary">
      <div className="transition-all duration-300">
        <div className="px-4 py-5 sm:px-6 lg:py-6">
          <LsPageHeader title="灵感中心" description="查看外部参考、管理产品素材，并将内容证据交接到制作流程。" />
          <div className="mb-4 flex min-w-0 items-start gap-3 border-b border-border">
            <Tabs className="min-w-0 flex-1" activeKey={innerView} onChange={key => setInnerView(key as InspirationInnerView)} aria-label="灵感中心分类"
              items={[
                { key: 'inspiration', label: `灵感发现 · ${tenantVideoTotalItems ?? '…'}`, icon: <Flame size={16} /> },
                { key: 'library', label: `我的素材 · ${localMaterials.length}`, icon: <Film size={16} /> },
                { key: 'accounts', label: `对标账号 · ${competitorAccountCount ?? '…'}`, icon: <Users size={16} /> },
                { key: 'shooting', label: `拍摄任务 · ${shootingNeeds.length + scriptGapTasks.length}`, icon: <Lightbulb size={16} /> },
              ]} />
            {innerView === 'inspiration' && <AntUpload className="shrink-0 pt-1" accept="video/mp4,.mp4" showUploadList={false} disabled={importingReference} beforeUpload={file => { void importReferenceVideo(file); return false; }}>
              <Button type="primary" loading={importingReference} icon={<Upload size={15} />}>导入 MP4 并分析</Button>
            </AntUpload>}
            {innerView === 'library' && <Button className="shrink-0" type="primary" loading={uploadingMaterial} icon={<Upload size={15} />} onClick={() => setMaterialUploadDialogOpen(true)}>上传素材</Button>}
          </div>


            {materialMessage && (
              <div role="status" aria-live="polite" className="mb-3 border-l-2 border-accent bg-accent-glow px-4 py-2.5 text-sm font-semibold text-accent">
                {materialMessage}
              </div>
            )}
            {innerView === 'accounts' && <CompetitorAccountsModal
              embedded
              open
              onClose={() => setInnerView('inspiration')}
              onCountChange={setCompetitorAccountCount}
              onCrawled={() => {
                setSortMode('crawlTime');
                setPlatform('all');
                setSearch('');
                void refreshVideos(1, false);
              }}
            />}
            {innerView === 'inspiration' && <div className="mb-4 space-y-4 rounded-lg border border-border bg-surface p-4">
              <div className="overflow-x-auto pb-1">
              <div className="grid min-w-[940px] grid-cols-[160px_minmax(240px,2fr)_minmax(130px,1fr)_minmax(170px,1fr)_160px] gap-3">
                <Select value={platform} onChange={value => handlePlatformFilter(value as Platform)} aria-label="社媒平台" options={PLATFORM_FILTERS.map(item => ({ value: item.id, label: item.label }))} />
                <Input allowClear prefix={<Search size={15} />} value={search}
                  onChange={event => { setLastCrawlVideoIds([]); setSearch(event.target.value); }}
                  aria-label="搜索爆款灵感" placeholder="搜索标题或标签" />
                <Select value={contentFormat} onChange={value => handleContentFormatFilter(value as ContentFormat)} aria-label="内容形式"
                  options={[{ value: 'video', label: '视频' }, { value: 'image', label: '图文' }]} />
                <Select value={inspirationFavoriteFilter} onChange={value => setInspirationFavoriteFilter(value as FavoriteFilter)} aria-label="爆款收藏状态"
                  options={[{ value: 'all', label: '全部收藏状态' }, { value: 'favorite', label: '仅看收藏' }]} />
                <Button loading={discoverySupplyLoading || videosLoading} onClick={() => setInspirationFiltersOpen(value => !value)} icon={<SlidersHorizontal size={15} />} aria-expanded={inspirationFiltersOpen} aria-controls="inspiration-more-filters">
                  更多筛选{inspirationAdvancedFilterCount > 0 ? ` · ${inspirationAdvancedFilterCount}` : ''}
                </Button>
              </div>
              </div>
              {inspirationFiltersOpen && <div id="inspiration-more-filters" className="space-y-3 border-t border-border pt-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <label className="space-y-1 text-xs text-text-secondary"><span>入库时间</span><Select className="w-full" value={crawlTimeRange} onChange={value => { setLastCrawlVideoIds([]); setCrawlTimeRange(value as CrawlTimeRange); }} aria-label="视频抓取入库时间" options={[{ value: 'all', label: '全部时间' }, { value: 'today', label: '今天入库' }, { value: '7d', label: '近 7 天' }, { value: '30d', label: '近 30 天' }]} /></label>
                  <label className="space-y-1 text-xs text-text-secondary"><span>排序方法</span><Select className="w-full" value={sortMode} onChange={value => { setLastCrawlVideoIds([]); setSortMode(value as SortMode); }} aria-label="排序方法" options={[{ value: 'crawlTime', label: '按爬取时间' }, { value: 'heat', label: '按内容机会' }]} /></label>
                  <label className="space-y-1 text-xs text-text-secondary"><span>筛选结论</span><Select className="w-full" value={discoveryDecision} onChange={value => setDiscoveryDecision(value as DiscoveryDecisionFilter)} aria-label="服务端筛选结论" options={[{ value: 'all', label: '全部评分结果' }, { value: 'accepted', label: '已入选' }, { value: 'review', label: '待复核' }, { value: 'rejected', label: '已淘汰' }]} /></label>
                  <label className="space-y-1 text-xs text-text-secondary"><span>业务类型</span><Select className="w-full" value={businessModelFilter} onChange={value => setBusinessModelFilter(value as BusinessModelFilter)} aria-label="业务类型" options={[{ value: 'all', label: '全部业务类型' }, { value: 'b2b', label: 'B2B 对标' }, { value: 'mixed', label: '混合业务' }, { value: 'd2c', label: 'DTC 卖货' }, { value: 'unknown', label: '待识别' }]} /></label>
                  <label className="space-y-1 text-xs text-text-secondary"><span>最低综合评分</span><Select className="w-full" value={minimumDiscoveryScore} onChange={setMinimumDiscoveryScore} aria-label="最低综合评分" options={[{ value: 0, label: '不限分数' }, { value: 50, label: '50 分以上' }, { value: 70, label: '70 分以上' }, { value: 85, label: '85 分以上' }]} /></label>
                  <div className="space-y-1 text-xs text-text-secondary"><span>展示方式</span><Segmented block value={viewMode} onChange={value => setViewMode(value as 'grid' | 'list')} aria-label="大屏视图" options={[{ value: 'grid', label: '卡片', icon: <LayoutGrid size={14}/> }, { value: 'list', label: '列表', icon: <List size={14}/> }]} /></div>
                </div>
                <div className="flex justify-end"><Button type="text" onClick={clearInspirationFilters} disabled={inspirationFilterCount === 0} icon={<X size={13} />}>清除全部筛选</Button></div>
              </div>}
            </div>}


        {innerView === 'inspiration' && videosError && <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-900"><span>{videosError}</span><button type="button" onClick={() => void refreshVideos(videoPage)} className="rounded-md bg-white px-2.5 py-1 font-semibold text-amber-950">重试</button></div>}
        {innerView === 'inspiration' && discoverySupplyError && <Alert className="mb-3" type="warning" showIcon title={discoverySupplyError} />}

        <div>
          {innerView === 'inspiration' && (
            <>
              {!videosLoaded && videosLoading ? (
                <LsLoadingState loading mode="spin" label="正在读取真实视频库存" description="正在同步全部可展示灵感" className="min-h-[360px] rounded-lg border border-border bg-surface">
                  <span />
                </LsLoadingState>
              ) : filtered.length === 0 ? (
                <InspirationEmptyState state={resultEmptyState(visibleVideos.length, search, platform !== 'all' || crawlTimeRange !== 'all')} contentFormat={contentFormat} search={search} localMaterialCount={localMaterials.length} onReset={resetInspirationFilters} onOpenLibrary={() => setInnerView('library')} />
              ) : viewMode === 'grid' ? (
                <LsMasonryGallery layout="grid" items={filtered.map((video, i) => ({ id: video.id, content:
                    <div className="relative h-full">
                      <VideoCard video={video} index={i} isSelected={false}
                        onSelect={() => openDirectorAnalysis(video)}
                        onCreate={() => startInspirationCreation(video)}
                        createLabel={launchingReferences.includes(video.id) ? '正在启动…' : replicationTasks[`${video.id}:${creationAccountId}`] ? '继续制作' : video.contentFormat === 'image' || video.id.startsWith('material-') ? '开始创作' : '爆款复刻'}
                        creating={launchingReferences.includes(video.id)}
                        createDisabled={video.contentFormat === 'image' && !inspirationCreationAvailability(video).ready}
                        createDisabledReason={inspirationCreationAvailability(video).reason}
                        onWatch={() => handleWatch(video)}
                        onFavoriteMaterial={() => void favoriteMaterial(video)}
                        favoritingMaterial={favoritingMaterialIds.includes(video.id)}
                        isFavoriteMaterial={favoritedVideoIds.includes(video.id) || favoriteSourceUrls.has(String(video.sourceUrl || '').trim())} />
              {video.canManage && (
                <div className="absolute right-12 top-2 z-30 flex gap-1">
                  <button type="button" title="编辑素材" aria-label="编辑素材" onClick={() => openManageDialog({ kind: 'video', item: video, action: 'edit' })} className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/95 text-text-secondary shadow transition hover:text-accent"><Pencil size={14} /></button>
                  <button type="button" title="删除素材" aria-label="删除素材" onClick={() => openManageDialog({ kind: 'video', item: video, action: 'delete' })} className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/95 text-text-secondary shadow transition hover:text-red-600"><Trash2 size={14} /></button>
                </div>
              )}

                    </div>
                }))} />
              ) : (
                <div className="card overflow-hidden divide-y divide-border">
                  {filtered.map(video => (
                    <VideoListItem key={video.id} video={video} isSelected={false}
                      onSelect={() => openDirectorAnalysis(video)}
                      onCreate={() => startInspirationCreation(video)}
                        createLabel={launchingReferences.includes(video.id) ? '正在启动…' : replicationTasks[`${video.id}:${creationAccountId}`] ? '继续制作' : video.contentFormat === 'image' || video.id.startsWith('material-') ? '开始创作' : '爆款复刻'}
                        creating={launchingReferences.includes(video.id)}
                      createDisabled={video.contentFormat === 'image' && !inspirationCreationAvailability(video).ready}
                      createDisabledReason={inspirationCreationAvailability(video).reason}
                      onWatch={() => handleWatch(video)}
                      onFavoriteMaterial={() => void favoriteMaterial(video)}
                      favoritingMaterial={favoritingMaterialIds.includes(video.id)}
                      isFavoriteMaterial={favoritedVideoIds.includes(video.id) || favoriteSourceUrls.has(String(video.sourceUrl || '').trim())} />
                  ))}
                </div>
              )}
              {videosLoaded && !serverDiscoveryFilterActive && videoTotalPages > 1 && (
                <nav className="flex justify-center py-4" aria-label="灵感发现分页">
                  <Pagination current={videoPage} total={videoTotalPages * INSPIRATION_PAGE_SIZE} pageSize={INSPIRATION_PAGE_SIZE}
                    showSizeChanger={false} disabled={videosLoading} onChange={page => void refreshVideos(page)}
                    showTotal={() => `第 ${videoPage} / ${videoTotalPages} 页`} />
                </nav>
              )}
            </>
          )}

          {innerView === 'library' && (
            <div className="space-y-4">
              <input
                ref={uploadInputRef}
                type="file"
                multiple
                accept="video/*,image/*,audio/*"
                className="hidden"
                onChange={e => void handleUploadMaterials(e.currentTarget.files)}
              />

              {materialProductFilterEnabled && (
                <div className="flex flex-col gap-2 rounded-lg border border-blue-100 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">正在查看：{materialProductRef || (materialProductId ? '指定产品' : '企业通用素材')}</p>
                    <p className="mt-1 text-xs text-zinc-500">从企业知识库进入时，系统会自动带上产品筛选；上传前仍需确认本次素材归属。</p>
                  </div>
                  <button type="button" onClick={() => setMaterialProductSelection(MATERIAL_PRODUCT_ALL)} className="shrink-0 text-xs font-semibold text-blue-600 hover:text-blue-700">查看全部素材</button>
                </div>
              )}

              <div className="space-y-3 rounded-lg border border-border bg-surface p-3 sm:p-4">
                <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-1" aria-label="我的素材筛选">
                  <Input allowClear prefix={<Search size={15} />} value={materialSearch} onChange={event => setMaterialSearch(event.target.value)}
                    aria-label="搜索我的素材" placeholder="搜索素材名称、产品或主要内容" className="min-w-60 flex-1" />
                  <MaterialTaxonomyFilters source={materialSource} theme={materialTheme} total={materialSource === 'all' && materialTheme === 'all' ? materialTotal : Object.values(materialFacets?.sources || {}).reduce((sum, count) => sum + count, 0)}
                    sourceCounts={materialFacets?.sources || { local_upload: 0, official_import: 0, user_generated: 0 }}
                    onSourceChange={setMaterialSource} onThemeChange={setMaterialTheme} />
                  <Select className="w-32 shrink-0" value={materialType} onChange={value => setMaterialType(value as MaterialTypeFilter)} aria-label="内容形式"
                    options={[{ value: 'all', label: '全部类型' }, { value: 'video', label: '视频' }, { value: 'image', label: '图片' }, { value: 'audio', label: '音频' }]} />
                  <Button className="shrink-0" onClick={() => setMaterialFiltersOpen(value => !value)} aria-expanded={materialFiltersOpen} aria-controls="material-more-filters" icon={<SlidersHorizontal size={15} />}>
                    更多筛选{materialAdvancedFilterCount > 0 ? ` · ${materialAdvancedFilterCount}` : ''}
                  </Button>
                </div>
                <AnimatePresence initial={false}>
                  {materialFiltersOpen && <motion.div id="material-more-filters" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="grid grid-cols-1 gap-3 border-t border-border pt-3 md:grid-cols-2 xl:grid-cols-3">
                      <label className="space-y-1 text-xs text-text-secondary"><span>收藏状态</span><Select className="w-full" value={materialFavoriteFilter} onChange={value => setMaterialFavoriteFilter(value as FavoriteFilter)} aria-label="素材收藏状态"
                        options={[{ value: 'all', label: '全部收藏状态' }, { value: 'favorite', label: '仅看收藏' }]} /></label>
                      <label className="relative block h-14 rounded-lg border border-border bg-surface-2 transition-colors focus-within:border-accent">
                        <Package size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                        <span className="pointer-events-none absolute left-10 top-1.5 text-[10px] font-semibold text-text-muted">关联产品</span>
                        <select value={materialProductFilterValue} onChange={event => setMaterialProductSelection(event.target.value)} aria-label="按产品筛选素材"
                          className="h-full w-full cursor-pointer appearance-none rounded-lg bg-transparent pl-10 pr-9 pt-3 text-sm font-bold text-text-primary outline-none">
                          <option value={MATERIAL_PRODUCT_ALL}>全部产品素材</option>
                          <option value={MATERIAL_PRODUCT_COMMON}>企业通用素材</option>
                          {materialProductRef && !materialProductId && <option value={MATERIAL_PRODUCT_LINKED_REF}>{materialProductRef}</option>}
                          {materialProductId && materialProductRef && !materialProducts.some(item => item.id === materialProductId) && <option value={materialProductId}>{materialProductRef}</option>}
                          {materialProducts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                        <ChevronDown size={15} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                      </label>
                      {[
                        { label: '所属行业', value: materialIndustry, onChange: (value: string) => setMaterialIndustry(value as MaterialIndustryFilter), options: Object.entries(MATERIAL_INDUSTRY_LABELS) },
                        { label: '镜头功能', value: materialFunction, onChange: setMaterialFunction, options: [['all', MATERIAL_FUNCTION_LABELS.all], ...materialFunctionOptions.map(value => [value, MATERIAL_FUNCTION_LABELS[value] || value])] },
                        { label: '适用范围', value: materialApplicability, onChange: (value: string) => setMaterialApplicability(value as MaterialApplicabilityFilter), options: Object.entries(MATERIAL_APPLICABILITY_LABELS) },
                        { label: '画面方向', value: materialOrientation, onChange: (value: string) => setMaterialOrientation(value as MaterialOrientationFilter), options: [['all', '全部方向'], ['vertical', '竖屏 9:16'], ['horizontal', '横屏 16:9']] },
                      ].map(filter => (
                        <label key={filter.label} className="relative block h-14 rounded-lg border border-border bg-surface-2 transition-colors focus-within:border-accent">
                          <Film size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                          <span className="pointer-events-none absolute left-10 top-1.5 text-[10px] font-semibold text-text-muted">{filter.label}</span>
                          <select value={filter.value} onChange={e => filter.onChange(e.target.value)} aria-label={filter.label}
                            className="h-full w-full cursor-pointer appearance-none rounded-lg bg-transparent pl-10 pr-9 pt-3 text-sm font-bold text-text-primary outline-none">
                            {filter.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select>
                          <ChevronDown size={15} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                        </label>
                      ))}
                    </div>
                    <div className="mt-2 flex justify-end">
                      <button type="button" onClick={clearMaterialFilters} disabled={materialFilterCount === 0}
                        className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold text-text-muted transition hover:bg-surface-2 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40">
                        <X size={13} />清除全部筛选
                      </button>
                    </div>
                  </motion.div>}
                </AnimatePresence>
              </div>
              <MaterialLibraryStatus onRetry={refreshMaterials} />
              {materialsLoading ? (
                  <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-muted">
                    <Loader2 size={16} className="animate-spin" /> 正在读取素材库...
                  </div>
                ) : localMaterials.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center">
                    <Film size={30} className="mx-auto mb-3 text-text-muted opacity-50" />
                    <p className="text-sm font-bold text-text-primary">还没有本地社媒素材</p>
                    <p className="mt-1 text-xs text-text-muted">拍摄完成后上传，或从待拍摄素材池用 Seedance 2.0 生成。</p>
                  </div>
                ) : filteredMaterials.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center">
                    <Search size={30} className="mx-auto mb-3 text-text-muted opacity-50" />
                    <p className="text-sm font-bold text-text-primary">没有符合当前标签的素材</p>
                    <button type="button" onClick={clearMaterialFilters} className="mt-2 text-xs font-bold text-accent">清空筛选条件</button>
                  </div>
                ) : <LsMasonryGallery layout="grid" items={filteredMaterials.map(material => ({ id: material.id, content:
                  <article className="group flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-none transition hover:border-border-bright">
                    <div className="relative aspect-[9/16] bg-surface-2">
                      <div className="absolute right-2 top-2 z-30 flex gap-1">
                        {material.canManage && <button type="button" aria-label={`编辑 ${material.name}`} title="编辑" onClick={() => openManageDialog({ kind: 'material', item: material, action: 'edit' })} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/70 bg-white/95 text-text-secondary shadow transition hover:text-accent"><Pencil size={14} /></button>}
                        {material.canManage && <button type="button" aria-label={`删除 ${material.name}`} title="删除" onClick={() => openManageDialog({ kind: 'material', item: material, action: 'delete' })} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/70 bg-white/95 text-text-secondary shadow transition hover:text-red-600"><Trash2 size={14} /></button>}
                        <button type="button" aria-label={`${isFavoriteMaterial(material) ? '取消收藏' : '收藏'} ${material.name}`} title={isFavoriteMaterial(material) ? '取消收藏' : '收藏'} onClick={() => void toggleMaterialFavorite(material)} disabled={favoritingMaterialIds.includes(material.id)}
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border shadow transition disabled:cursor-wait disabled:opacity-60 ${isFavoriteMaterial(material) ? 'border-amber-300 bg-amber-50 text-amber-500' : 'border-white/70 bg-white/95 text-text-secondary hover:text-amber-500'}`}>
                          {favoritingMaterialIds.includes(material.id) ? <Loader2 size={14} className="animate-spin" /> : <Star size={14} fill={isFavoriteMaterial(material) ? 'currentColor' : 'none'} />}
                        </button>
                      </div>
                      {material.type === 'video' ? (
                        <>
                          {material.poster
                            ? <AuthenticatedImage src={material.poster} alt={material.name} className="h-full w-full object-cover" />
                            : material.url
                              ? <AuthenticatedVideo apiUrl={material.url} loadOnMount previewFrame preload="auto" className="pointer-events-none h-full w-full bg-slate-950 object-cover" />
                              : <div className="flex h-full flex-col items-center justify-center gap-2 bg-slate-950 text-white/65"><Film size={26} /><span className="text-[11px] font-semibold">预览待生成</span></div>}
                          <button
                            type="button"
                            aria-label={`播放 ${material.name}`}
                            onClick={event => { event.stopPropagation(); setPreviewMaterial(material); }}
                            className="absolute left-1/2 top-1/2 z-20 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/65 text-white shadow-lg transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-white"
                          >
                            <Play size={19} fill="currentColor" />
                          </button>
                        </>
                      ) : material.type === 'image' && (material.poster || material.url) ? (
                        <img src={material.poster || material.url} alt={material.name} className="h-full w-full object-cover" />
                      ) : material.type === 'audio' ? (
                        <div className="flex h-full flex-col items-center justify-center gap-2 bg-surface-2 text-text-muted"><Music2 size={28} /><span className="text-xs font-bold">音频素材</span></div>
                      ) : (
                        <div className="flex h-full items-center justify-center text-text-muted"><Film size={22} /></div>
                      )}
                    </div>
                    <div className="flex min-h-52 flex-1 flex-col p-3">
                      <p className="min-h-11 text-sm font-bold leading-snug text-text-primary line-clamp-2">{material.name}</p>
                      <p className="mt-1 line-clamp-1 min-h-5 text-xs font-semibold leading-5 text-text-muted" title={materialSemanticLabel(material)}>{materialSemanticLabel(material)}</p>
                      <div className="mt-auto grid grid-cols-2 gap-2 pt-3">
                        <button
                          type="button"
                          onClick={() => setDetailMaterial(material)}
                          className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-2 py-2 text-xs font-bold text-text-secondary transition hover:border-accent hover:text-accent"
                        >
                          <Eye size={14} />查看详情
                        </button>
                        <button
                          type="button"
                          onClick={() => enterMaterialSmartGeneration(material)}
                          disabled={material.type === 'audio' || (material.type === 'video' && !canProcessVideo({ contentFormat: 'video', duration: material.duration })) || !String(material.url || material.poster || '').trim()}
                          title={material.type === 'audio' ? '音频素材不能单独进入画面创作' : material.type === 'video' && !canProcessVideo({ contentFormat: 'video', duration: material.duration }) ? '视频时长尚未识别完成' : '带入内容制作的自由创作'}
                          className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-accent px-2 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          <Sparkles size={14} />自由创作
                        </button>
                      </div>
                    </div>
                  </article>
                }))} />}
              {materialTotal > MATERIAL_LIBRARY_PAGE_SIZE && (
                <nav className="flex justify-center border-t border-border pt-5" aria-label="我的素材分页">
                  <Pagination
                    current={materialPage}
                    total={materialTotal}
                    pageSize={MATERIAL_LIBRARY_PAGE_SIZE}
                    showSizeChanger={false}
                    responsive
                    disabled={materialsLoading}
                    onChange={page => void refreshMaterials(page)}
                    showTotal={(total, range) => `${range[0]}–${range[1]} / ${total} 条素材`}
                  />
                </nav>
              )}
            </div>
          )}

          {previewMaterial?.type === 'video' && previewMaterial.url && (
            <Modal open title={previewMaterial.name} width={840} footer={null} onCancel={() => setPreviewMaterial(null)}>
                <div className="relative flex min-h-64 items-center justify-center bg-black">
                  <AuthenticatedVideo
                    key={`${previewMaterial.id}:${previewMaterial.url}:${previewMaterialAttempt}`}
                    apiUrl={previewMaterial.url}
                    poster={previewMaterial.poster}
                    controls
                    loadOnMount
                    onReady={() => { setPreviewMaterialLoading(false); setPreviewMaterialError(''); }}
                    onLoadingChange={setPreviewMaterialLoading}
                    onError={handleMaterialPreviewError}
                    className="max-h-[75vh] w-full bg-black object-contain"
                  />
                  {previewMaterialLoading && !previewMaterialError && <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40"><span className="inline-flex items-center gap-2 rounded-lg bg-black/65 px-3 py-2 text-xs font-semibold text-white"><Loader2 size={14} className="animate-spin" />正在准备视频…</span></div>}
                  {previewMaterialError && <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 px-6 text-center text-white"><Play size={26} className="opacity-70" /><p className="mt-3 text-sm font-semibold">素材预览暂时失败</p><p className="mt-1 text-xs text-white/65">{previewMaterialError}</p><button type="button" onClick={() => { previewMaterialAutoRetryRef.current = 0; void refreshMaterialPreviewUrl(); }} className="mt-4 rounded-lg bg-white px-3 py-2 text-xs font-bold text-neutral-900">重新获取播放地址</button></div>}
                </div>
            </Modal>
          )}

          {detailMaterial && (
            <Drawer open title={detailMaterial.name} size={800} onClose={() => setDetailMaterial(null)} styles={{ body: { padding: 0 } }}>
                <section className="border-b border-border bg-surface-2 px-5 py-4" aria-label="素材标签">
                  <p className="text-xs font-semibold text-text-primary">素材标签</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(() => { const badge = materialAssetBadge(detailMaterial); return <span className="rounded-md border border-border bg-white px-2 py-1 text-xs font-semibold text-text-secondary">{badge.label}</span>; })()}
                    <span className={`rounded-md border border-border px-2 py-1 text-xs font-semibold ${materialPrimaryThemeOf(detailMaterial) ? 'bg-accent-glow text-accent' : 'bg-white text-text-secondary'}`}>{materialPrimaryThemeOf(detailMaterial) ? MATERIAL_THEME_LABELS[materialPrimaryThemeOf(detailMaterial)!] : '主题待识别'}</span>
                    {visibleMaterialTags(detailMaterial.tags).split(/[,，]/).map(tag => tag.trim()).filter(Boolean).map(tag => <span key={`detail-tag-${tag}`} className="rounded-md border border-border bg-white px-2 py-1 text-xs font-semibold text-text-secondary">{tag}</span>)}
                  </div>
                </section>
                <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1.2fr)_minmax(240px,0.8fr)]">
                  <div className="overflow-hidden rounded-lg border border-border bg-black">
                    {detailMaterial.type === 'video' ? <video src={detailMaterial.url} poster={detailMaterial.poster} controls playsInline preload="metadata" className="aspect-video h-full max-h-[54vh] w-full object-contain" />
                      : detailMaterial.type === 'image' ? <img src={detailMaterial.poster || detailMaterial.url} alt={detailMaterial.name} className="max-h-[54vh] w-full object-contain" />
                      : <div className="flex min-h-44 flex-col items-center justify-center gap-4 bg-surface-2 p-6"><Music2 size={28} className="text-text-muted" /><audio src={detailMaterial.url} controls className="w-full" /></div>}
                  </div>
                  <div className="space-y-3 text-xs">
                    <div className="rounded-xl border border-border bg-surface px-3 py-2.5"><p className="text-[10px] font-bold text-text-muted">主题标签</p><div className="mt-2 flex flex-wrap gap-1.5">{Object.entries(MATERIAL_THEME_LABELS).map(([id,label]) => <button type="button" key={id} disabled={updatingMaterialTheme} onClick={() => void updateDetailMaterialTheme(id as keyof typeof MATERIAL_THEME_LABELS)} className={`rounded-full px-2.5 py-1 text-[11px] font-bold disabled:opacity-50 ${materialPrimaryThemeOf(detailMaterial) === id ? 'bg-accent text-white' : 'bg-surface-2 text-text-secondary'}`}>{label}</button>)}</div></div>
                    {[
                      ['素材类型', detailMaterial.type === 'video' ? '视频' : detailMaterial.type === 'image' ? '图片' : '音频'],
                      ['关联产品', detailMaterial.productName || '企业通用素材'],
                      ['主要内容', materialSemanticLabel(detailMaterial)],
                      ['素材来源', detailMaterial.sourceName || detailMaterial.sourceProvider || (detailMaterial.scope === 'shared' ? '共享素材' : '我的素材')],
                      ['时长', detailMaterial.type === 'video' || detailMaterial.type === 'audio' ? displayDuration(detailMaterial.duration) : '—'],
                      ['入库时间', detailMaterial.createdAt ? new Date(detailMaterial.createdAt).toLocaleString('zh-CN') : '—'],
                    ].map(([label, value]) => <div key={label} className="rounded-lg border border-border bg-surface px-3 py-2.5"><p className="text-[10px] font-bold text-text-muted">{label}</p><p className="mt-1 break-words font-bold leading-5 text-text-primary">{value}</p></div>)}
                    <Button type="primary" block onClick={() => { const material = detailMaterial; setDetailMaterial(null); enterMaterialSmartGeneration(material); }} disabled={detailMaterial.type === 'audio' || (detailMaterial.type === 'video' && !canProcessVideo({ contentFormat: 'video', duration: detailMaterial.duration })) || !String(detailMaterial.url || detailMaterial.poster || '').trim()}>自由创作</Button>
                  </div>
                </div>
            </Drawer>
          )}

          {innerView === 'shooting' && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                {[
                  { label: '待拍摄缺口', value: shootingNeeds.length + scriptGapTasks.length, color: 'text-accent' },
                  { label: '高频需求', value: shootingNeeds.length, color: 'text-accent' },
                  { label: '已入库素材', value: localMaterials.length, color: 'text-accent' },
                ].map(item => (
                  <div key={item.label} className="card p-4">
                    <p className={`text-2xl font-bold ${item.color}`}>{item.value}</p>
                    <p className="mt-1 text-xs text-text-muted">{item.label}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2" role="group" aria-label="筛选待拍清单">
                {([
                  ['all', '全部', shootingNeeds.length + scriptGapTasks.length],
                  ['storyboard', '分镜补拍', scriptGapTasks.length],
                  ['common', '高频需求', shootingNeeds.length],
                ] as const).map(([key, label, count]) => (
                  <button key={key} type="button" aria-pressed={shootingFilter === key} onClick={() => setShootingFilter(key)}
                    className={`min-w-0 rounded-lg border px-2 py-2.5 text-xs font-bold transition-colors sm:text-sm ${shootingFilter === key ? 'border-accent bg-accent text-white' : 'border-border bg-surface text-text-secondary hover:border-accent hover:text-accent'}`}>
                    <span className="truncate">{label}</span><span className="ml-1 opacity-70">{count}</span>
                  </button>
                ))}
              </div>
              <input ref={shootingCameraInputRef} aria-label="拍摄待拍任务素材" type="file" accept="video/*" capture="environment" className="hidden" onChange={event => { void handleUploadMaterials(event.currentTarget.files); event.currentTarget.value = ''; }}/>
              {visibleShootingCards.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center">
                  <Check size={30} className="mx-auto mb-3 text-accent" />
                  <p className="text-sm font-bold text-text-primary">当前筛选下没有待拍摄缺口</p>
                  <p className="mt-1 text-xs text-text-muted">可以切换上方筛选查看其他需求。</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {visibleShootingCards.map(card => {
                    const task = card.kind === 'storyboard' ? card.task : null;
                    const need = card.kind === 'common' ? card.need : null;
                    const focused = task && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('task') === task.id;
                    return <article key={card.id} id={task ? `shooting-task-${task.id}` : undefined} className={`rounded-lg border border-border bg-white p-4 ${focused ? 'ring-2 ring-amber-400' : ''}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">{task ? '分镜补拍' : '高频需求'}</span>
                            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-text-secondary">{need?.ratio || task?.ratio || '9:16'}</span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-text-secondary">{need ? <><SocialPlatformIcon platform={need.platform} size={12} />{getPlatformMeta(need.platform).label}</> : '内容制作'}</span>
                          </div>
                          <h3 className="mt-2 text-sm font-bold text-text-primary">{task?.title || need?.title}</h3>
                          <p className="mt-1 text-xs leading-relaxed text-text-secondary">{task?.shotBrief || need?.suggestion}</p>
                          <p className="mt-2 text-[11px] text-text-muted">{task ? `${task.productLabel} · ${task.themeTitle} · 建议 ${task.suggestedDurationSec} 秒` : `出现 ${need?.count} 次 · 来源：${need?.sourceVideos.slice(0, 3).join(' / ')}`}</p>
                          <p className="mt-1 text-[11px] text-text-muted">创建日期：{shootingCreationDate(card.createdAt)}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          {latestShootingCardIds.has(card.id) && <span role="img" aria-label="最新待拍任务" title="最新待拍任务" className="text-sm leading-none">❗</span>}
                          <div className="flex flex-wrap justify-end gap-2">
                            <button type="button" disabled={uploadingMaterial} onClick={() => { setUploadingScriptGapId(task?.id || ''); shootingCameraInputRef.current?.click(); }} className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-50">去拍摄</button>
                            <button type="button" onClick={() => requestMaterialUpload(task?.id || '')} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary hover:text-text-primary">去上传</button>
                            <button type="button" onClick={() => void generateNeedMaterial(task || need!)} disabled={generatingNeedId === card.id} className="inline-flex items-center gap-1 rounded-lg border border-accent/30 bg-white px-3 py-2 text-xs font-bold text-accent disabled:opacity-50">{generatingNeedId === card.id ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}{generatingNeedId === card.id ? '生成中' : 'AI生成素材'}</button>
                            {task && task.uploadedMaterialIds.length > 0 && task.sourceProjectId && <a href={`?page=smartAssets&project=${encodeURIComponent(task.sourceProjectId)}`} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary">返回分镜</a>}
                          </div>
                        </div>
                      </div>
                    </article>;
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      </div>

      <AnimatePresence>
        {selectedVideo && (
          <DirectorVideoDetailPanel
            key={selectedVideo.id}
            video={selectedVideo}
            onClose={() => setSelectedVideo(null)}
            onPreview={() => handleWatch(selectedVideo)}
            onCreate={() => {
              enterInspirationWorkflow(selectedVideo);
              setSelectedVideo(null);
            }}
            onRetry={() => void retryVideoPipeline(selectedVideo)}
            onReanalyzeImage={() => void reanalyzeImagePost(selectedVideo)}
            onExactAnalysis={() => void requestExactFullAnalysis(selectedVideo)}
            onReanalyze={() => void requestExactFullAnalysis(selectedVideo, true)}
            onCancelAnalysis={() => void cancelExactFullAnalysis(selectedVideo)}
            analyzing={analyzingVideoIds.includes(selectedVideo.id)}
            notice={materialMessage}
            onFavorite={() => void favoriteMaterial(selectedVideo)}
            favoriting={favoritingMaterialIds.includes(selectedVideo.id)}
            isFavorite={favoritedVideoIds.includes(selectedVideo.id) || favoriteSourceUrls.has(String(selectedVideo.sourceUrl || '').trim())}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {watchVideo && <WatchModal key={watchVideo.id} video={watchVideo} onClose={() => setWatchVideo(null)} />}
      </AnimatePresence>
      <Modal
        open={materialUploadDialogOpen}
        title="上传素材"
        width={480}
        okText="选择文件"
        cancelText="取消"
        okButtonProps={{ disabled: !uploadProductId }}
        onCancel={() => setMaterialUploadDialogOpen(false)}
        onOk={() => {
          if (!uploadProductId) return;
          setMaterialUploadDialogOpen(false);
          uploadInputRef.current?.click();
        }}
      >
        <label className="block text-xs font-semibold text-text-secondary">
          关联产品<span className="sr-only">本次上传必须关联产品</span>
          <Select
            aria-label="本次上传素材归属"
            className="mt-2 w-full"
            value={uploadProductId || undefined}
            placeholder="选择关联产品（必选）"
            onChange={setUploadProductId}
            options={[
              ...(materialProductId && materialProductRef && !materialProducts.some(item => item.id === materialProductId)
                ? [{ value: materialProductId, label: materialProductRef }]
                : []),
              ...materialProducts.map(item => ({ value: item.id, label: item.name })),
            ]}
          />
        </label>
      </Modal>
      {manageTarget && (
        <Modal open title={`${manageTarget.action === 'delete' ? '删除' : '编辑'}${manageTarget.kind === 'video' ? '爆款视频' : '素材'}`}
          width={480} onCancel={() => setManageTarget(null)} mask={{ closable: false }} keyboard={!manageBusy} closable={!manageBusy}
          confirmLoading={manageBusy} okText={manageTarget.action === 'delete' ? '确认删除' : '保存'} cancelText="取消"
          okButtonProps={{ danger: manageTarget.action === 'delete', disabled: manageTarget.action === 'edit' && !manageName.trim() }}
          cancelButtonProps={{ disabled: manageBusy }} onOk={() => void (manageTarget.action === 'delete' ? deleteManagedItem() : saveManagedItem())}>
            {manageTarget.action === 'edit' ? <>
              <label className="mt-4 block text-xs font-bold text-text-secondary">名称</label>
              <Input value={manageName} onChange={event => setManageName(event.target.value)} maxLength={160} className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-accent" />
              <label className="mt-3 block text-xs font-bold text-text-secondary">标签</label>
              <Input value={manageTags} onChange={event => setManageTags(event.target.value)} placeholder="用逗号分隔" className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-accent" />
              {manageTarget.kind === 'material' && <label className="mt-3 block text-xs font-bold text-text-secondary">关联产品
                <Select aria-label="素材关联产品" value={manageProductId || MATERIAL_PRODUCT_COMMON} onChange={value => setManageProductId(value === MATERIAL_PRODUCT_COMMON ? '' : value)} className="mt-1 w-full" options={[{ value: MATERIAL_PRODUCT_COMMON, label: '不指定（系统自动匹配）' }, ...materialProducts.map(item => ({ value: item.id, label: item.name }))]} /><span className="mt-1 block font-normal text-text-muted">可选。未指定时系统会按口播与画面语义自动匹配，也可作为企业通用素材使用。</span>
              </label>}
              <p className="mt-3 text-xs text-text-muted">仅当前租户自己采集或本地上传的素材可修改；共享素材保持只读。</p>
            </> : <p className="mt-4 border-l-2 border-red bg-red/5 p-3 text-sm text-red">确认删除“{manageName}”？删除后无法恢复。</p>}
        </Modal>
      )}

    </main>
  );
}
