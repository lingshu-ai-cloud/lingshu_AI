import MaterialLibraryStatus from './studio/MaterialLibraryStatus';
import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search, Play, Sparkles, FileText, Layout as LayoutIcon,
  TrendingUp, Clock, Globe, ChevronDown, X, Loader2,
  Check, Copy, ArrowRight, Zap, LayoutGrid, List,
  Lightbulb, Flame, BarChart2, ChevronRight, Film, Download,
  Bookmark, Maximize2, Minimize2, Lock, Upload, Users, Images, Pencil, Trash2, Music2,
  SlidersHorizontal, Package, ScanFace,
} from 'lucide-react';
import { studioApi, type Material, type MaterialSegment, type VideoGenerationVersion } from '../lib/studioApi';
import { authHeader } from '../lib/auth';
import CompetitorAccountsModal from './CompetitorAccountsModal';
import type { Page } from '../App';
import { completeDemoStep, readDemoProgress } from '../lib/demoProgress';
import { SocialPlatformIcon } from './SocialPlatformIcon';
import { useDismissibleLayer } from '../hooks/useDismissibleLayer';
import { useModalFocus } from '../hooks/useModalFocus';
import { updateScriptGapTask, type ScriptGapTask } from '../lib/scriptGapQueue';
import { canProcessVideo, displayDuration, resultEmptyState, sourceScopeLabel, trendFromEvidence } from '../lib/inspirationDataQuality';
export { canProcessVideo, displayDuration, resultEmptyState, trendFromEvidence } from '../lib/inspirationDataQuality';
import { useScriptGapTasks } from '../hooks/useScriptGapTasks';
import InspirationEmptyState from './InspirationEmptyState';
import { scoreSocialInspirationCandidate } from '../../shared/socialInspirationStrategy';
import DiscoveryScopePanel from './inspiration/DiscoveryScopePanel';
import { VideoCard, VideoListItem } from './InspirationVideoCards';
import type { AccountSpecialRecommendation, ContentFormat, FirstTenSecondInsight, FrameMaterialMatch, GeminiVideoAnalysis, Platform, ScriptAnalysis, ScriptDetail15s, ScriptResultProvenance, ScriptSummary15s, ShootingNeed, StructureStep, TrendVideo, VideoAnalysisPayload } from '../lib/inspirationTypes';

// ── Types ─────────────────────────────────────────────────────────────────────
type ScriptType = 'voiceover' | 'storyboard';
type SortMode = 'heat' | 'crawlTime';
type InspirationInnerView = 'inspiration' | 'library' | 'shooting';
type CrawlTimeRange = 'all' | 'today' | '7d' | '30d';
type MaterialIndustryFilter = 'all' | 'beauty_skincare' | 'universal_manufacturing' | 'apparel_textile' | 'metalworking';
type MaterialApplicabilityFilter = 'all' | 'universal' | 'cross_industry' | 'industry_specific';
type MaterialOrientationFilter = 'all' | 'vertical' | 'horizontal';
type MaterialSourceFilter = 'all' | 'local_upload' | 'seedance' | 'gemini' | 'official_import' | 'licensed_stock';
type MaterialTypeFilter = 'all' | 'video' | 'image' | 'audio';

const INSPIRATION_PAGE_SIZE = 30;

const MATERIAL_PRODUCT_ALL = '__all_products__';
const MATERIAL_PRODUCT_COMMON = '__enterprise_common__';
const MATERIAL_PRODUCT_UNSELECTED = '__select_product__';
const MATERIAL_PRODUCT_LINKED_REF = '__linked_product_ref__';
const ENTERPRISE_COMMON_MATERIAL_TAG = 'enterprise_common';

export type MaterialLibraryEntryContext = {
  openLibrary: boolean;
  productId: string;
  productRef: string;
};

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
const MATERIAL_SOURCE_LABELS: Record<MaterialSourceFilter, string> = {
  all: '全部来源', local_upload: '本地上传', seedance: 'Seedance 生成',
  gemini: 'Gemini 生成', official_import: '官方爆款导入', licensed_stock: '授权图库',
};

function materialSourceOf(material: Material): Exclude<MaterialSourceFilter, 'all'> {
  const source = String(material.sourceType || '').toLowerCase();
  if (source.includes('licensed-stock') || source.includes('licensed_stock')) return 'licensed_stock';
  if (source.includes('seedance')) return 'seedance';
  if (source.includes('gemini')) return 'gemini';
  if (source.includes('official') || source.includes('viral') || material.folder === 'hot' || material.scope === 'shared') return 'official_import';
  return 'local_upload';
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

function exactAnalysisQuality(video: TrendVideo): AnalysisQualityGate {
  const payload = video.aiAnalysis;
  const details = payload?.gemini?.scriptDetails15s || [];
  const duration = Math.max(0, Number(video.duration || 0));
  const requiredFrames = duration > 0 ? Math.max(2, Math.ceil(duration / 5)) : 2;
  const parsed = details.map(item => {
    const values = String(item.time || item.timestamp || '').match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
    return { item, start: values[0], end: values[1] };
  });
  const valid = parsed.filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end! > item.start!);

  if (payload?.requestedAnalysisMode === 'exact') return { ready: false, reason: '全片精确分析正在排队或生成中', requiredFrames, actualFrames: valid.length };
  if (payload?.analysisMode !== 'exact') return { ready: false, reason: '当前仅有策略级分析，需先完成全片精确分析', requiredFrames, actualFrames: valid.length };
  if (payload.videoLevelFailureStatus || payload.analysisError) return { ready: false, reason: '精确分析未完成或已失败，请重试', requiredFrames, actualFrames: valid.length };
  if (valid.length < requiredFrames) return { ready: false, reason: `分镜密度不足：需至少 ${requiredFrames} 段，当前 ${valid.length} 段`, requiredFrames, actualFrames: valid.length };
  if (valid.some(({ item }) => isUnusableAnalysisText(item.visual))) return { ready: false, reason: '存在不可用分镜，请重试精确分析', requiredFrames, actualFrames: valid.length };
  const ordered = [...valid].sort((a, b) => a.start! - b.start!);
  if (ordered.some(item => item.end! - item.start! > 5.5)) return { ready: false, reason: '存在超过 5.5 秒的粗分镜，无法可靠按时间戳匹配', requiredFrames, actualFrames: valid.length };
  if (ordered[0]!.start! > 0.75 || ordered.some((item, index) => index > 0 && Math.abs(item.start! - ordered[index - 1]!.end!) > 0.75)) {
    return { ready: false, reason: '分镜时间线存在空档或重叠，请重试精确分析', requiredFrames, actualFrames: valid.length };
  }
  if (duration > 0 && ordered[ordered.length - 1]!.end! + 0.75 < duration) return { ready: false, reason: '分镜尚未覆盖视频结尾，请重试精确分析', requiredFrames, actualFrames: valid.length };
  return { ready: true, reason: '精确分析已通过分镜密度与时间线校验', requiredFrames, actualFrames: valid.length };
}

function isDisplayableVideoAnalysis(analysis?: VideoAnalysisPayload, status?: TrendVideo['status']): boolean {
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

function normalizedOverlap(left: string, right: string): number {
  const tokens = tokenizeForMatch(left);
  if (!tokens.length) return 0;
  const haystack = right.toLowerCase();
  return Math.min(100, Math.round(tokens.filter(token => haystack.includes(token)).length / tokens.length * 100));
}

function scoreSegmentForFrame(material: Material, segment: MaterialSegment, detail: ScriptDetail15s, used: Set<string>) {
  const dna = viralDnaForFrame(detail);
  const frameText = `${detail.purpose} ${detail.visual} ${detail.beats?.map(item => item.action).join(' ')} ${detail.shot} ${detail.angle} ${detail.composition} ${detail.camera}`;
  const segmentText = `${segment.recommendedFunctions.join(' ')} ${segment.subject.join(' ')} ${segment.action} ${segment.shot} ${segment.angle} ${segment.composition} ${segment.camera} ${segment.environment}`;
  const needsProduct = /产品|包装|瓶|罐|质地|product|package|bottle|texture/i.test(frameText);
  const needsPerson = /人物|真人|男性|女性|脸|眼|皮肤|手|person|face|eye|skin|hand/i.test(frameText);
  const risks: string[] = [];
  if (needsProduct && !segment.productVisible) risks.push('硬条件不满足：分镜要求产品，但片段未识别到产品');
  if (needsProduct && /完整|正面|清晰|特写|reveal/i.test(frameText) && segment.productClarity !== 'high') risks.push('硬条件不满足：产品揭晓需要清晰完整产品');
  if (needsPerson && !segment.hasPerson) risks.push('硬条件不满足：分镜要求真人/手部动作');
  if (dna.authenticityRequired && segment.needsReview && !segment.manualConfirmed) risks.push('真实性镜头尚未人工确认');
  if (segment.hasLogo && segment.logoText.length) risks.push(`检测到文字/品牌：${segment.logoText.join('、')}`);

  const functionScore = normalizedOverlap(detail.purpose || '', segment.recommendedFunctions.join(' '));
  const action = normalizedOverlap(`${detail.visual} ${detail.beats?.map(item => item.action).join(' ')}`, segment.action);
  const subject = normalizedOverlap(detail.visual, `${segment.subject.join(' ')} ${segment.action}`);
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
        if (!existing.sourceVideos.includes(sourceTitle)) existing.sourceVideos.push(sourceTitle);
        if (frameStartsEarly(match.detail.time)) existing.priority = '高';
        continue;
      }
      grouped.set(key, {
        id: key,
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
    .sort((a, b) => {
      const rank = { '高': 3, '中': 2, '低': 1 };
      return rank[b.priority] - rank[a.priority] || b.count - a.count;
    })
    .slice(0, 30);
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
        <SocialPlatformIcon platform={platform} size={38} className="mb-3 drop-shadow-sm" />
        <p className="line-clamp-3 text-sm font-semibold leading-snug text-white/90 drop-shadow-sm">{shortTitle}</p>
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
  if (isDirectUrl) return <img src={src} alt="" className={className} draggable={false} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
  return blobUrl ? <img src={blobUrl} alt="" className={className} draggable={false} /> : null;
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

export function AuthenticatedVideo({ apiUrl, poster, className, controls = false, autoPlay = false, hoverPlay = false, onReady, onError }: { apiUrl: string; poster?: string; className: string; controls?: boolean; autoPlay?: boolean; hoverPlay?: boolean; onReady?: () => void; onError?: () => void }) {
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const load = async () => {
    if (playbackUrl || loading) return playbackUrl;
    setLoading(true);
    try {
      const response = await fetch(apiUrl, { headers: authHeader() });
      if (!response.ok) throw new Error(String(response.status));
      const next = String(((await response.json()) as { url?: string }).url || '');
      setPlaybackUrl(next);
      return next;
    } catch { return ''; } finally { setLoading(false); }
  };
  useEffect(() => { setPlaybackUrl(''); if (autoPlay) void load(); }, [apiUrl, autoPlay]);
  useEffect(() => { if (autoPlay && playbackUrl) void videoRef.current?.play().catch(() => {}); }, [autoPlay, playbackUrl]);
  return <video ref={videoRef} src={playbackUrl || undefined} poster={poster} controls={controls} autoPlay={autoPlay} muted={!controls} playsInline loop={hoverPlay} preload="metadata" className={className}
    onLoadedData={onReady}
    onCanPlay={onReady}
    onError={onError}
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
      <p className="mt-3 text-xs font-black text-text-primary">{title}</p>
      <p className="mx-auto mt-1.5 max-w-[280px] text-[10px] leading-relaxed text-text-muted">{desc}</p>
    </div>
  );

  const EvidenceCard = ({ label, value }: { label: string; value: string }) => (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-2"><p className="text-[10px] font-black text-text-primary">{label}</p><span className="rounded-full bg-surface-2 px-2 py-0.5 text-[9px] text-text-muted">来自 AI 原始结果</span></div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-text-secondary">{value}</p>
    </div>
  );

  if (activeTab === 'overview') return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-surface p-3.5">
        <div className="flex items-center justify-between"><div><p className="text-xs font-black text-text-primary">公开表现</p><p className="mt-1 text-[9px] text-text-muted">无公开值就留空，不把播放当曝光、不估算收藏与点击</p></div>{baseline?.status === 'usable' && baseline.relativeMultiple != null && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-700">账号基线 {baseline.relativeMultiple}×</span>}</div>
        <div className="mt-3 grid grid-cols-4 gap-1.5">{[['点赞', metrics?.likes || '—'], ['评论', metrics?.comments || '—'], ['分享', metrics?.shares || '—'], ['播放', metrics?.plays || '—']].map(([label, value]) => <div key={label} className="rounded-lg bg-surface-2 px-1.5 py-2 text-center"><p className="text-sm font-black text-text-primary">{value}</p><p className="text-[9px] text-text-muted">{label}</p></div>)}</div>
        <div className="mt-2 rounded-lg bg-surface-2 p-2 text-[9px] leading-relaxed text-text-secondary">
          <p>账号：{video.aiAnalysis?.author || '未抓取'} · 粉丝：{metrics?.followers ? metrics.followers.toLocaleString() : '未公开/未抓取'}</p>
          <p className="mt-1">投流信号：{adSignals?.isAd || adSignals?.isPaidPartnership ? '平台公开标记为广告/付费合作' : '未抓到公开标记（不代表未投流）'}</p>
        </div>
        <p className="mt-2 text-[9px] leading-relaxed text-text-muted">{baseline?.status === 'usable' ? `${baseline.sampleSize} 条同账号样本；${baseline.method}` : `同账号样本 ${baseline?.sampleSize || 0} 条，暂不足以确认相对爆款。`}</p>
      </section>
      {!isAnalyzed ? <EmptyEvidence title="图片证据尚未提取" desc={video.aiAnalysis?.imageAnalysisError || '重新分析后，系统会逐图提取可见事实、OCR、轮播角色和可复用模块。'}/> : <section><div className="mb-2 flex items-center justify-between"><p className="text-[11px] font-black text-text-primary">可复用模块</p><span className="text-[9px] text-text-muted">{evidence!.observedFacts.length} 张图片 · 仅基于可见证据</span></div><div className="space-y-2">{evidence!.reusableModules.map((item, index) => <div key={`${item.module}-${index}`} className="rounded-xl border border-border bg-white p-3"><div className="flex items-center justify-between"><p className="text-[11px] font-black text-text-primary">{item.module}</p><span className="text-[9px] text-text-muted">置信度 {Math.round(item.confidence * 100)}%</span></div><p className="mt-1 text-[10px] text-text-secondary">证据：{item.evidence}</p><div className="mt-2 grid grid-cols-2 gap-2 text-[9px]"><p className="rounded-lg bg-emerald-50 p-2 text-emerald-800">保留结构：{item.preserve}</p><p className="rounded-lg bg-amber-50 p-2 text-amber-800">替换内容：{item.replace}</p></div></div>)}</div></section>}
    </div>
  );

  if (activeTab === 'visual') return (
    <div className="space-y-3">
      <div><p className="text-[11px] font-black text-text-primary">逐图视觉事实</p><p className="mt-1 text-[10px] text-text-muted">主体、场景、构图、颜色和实际可读文字</p></div>
      {!isAnalyzed ? <EmptyEvidence title="尚未返回逐图拆解" desc="当前没有可验证的图片视觉结果。"/> : evidence!.observedFacts.map(fact => { const flow = evidence!.carouselFlow.find(item => item.imageIndex === fact.imageIndex); return <div key={fact.imageIndex} className="rounded-xl border border-border bg-white p-3"><div className="flex items-center justify-between"><p className="text-[11px] font-black text-text-primary">第 {fact.imageIndex} 张</p><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-700">{roleLabel[flow?.role || 'unknown']}</span></div><p className="mt-2 text-[10px] text-text-secondary">主体：{fact.subjects.join('、') || '未确认'}</p><p className="mt-1 text-[10px] text-text-secondary">场景：{fact.scene || '未确认'}</p><p className="mt-1 text-[10px] text-text-secondary">构图：{fact.composition || '未确认'}</p><p className="mt-1 text-[10px] text-text-secondary">颜色：{fact.colors.join('、') || '未确认'}</p>{fact.visibleText.length > 0 && <p className="mt-1 rounded-lg bg-surface-2 p-2 text-[10px] text-text-secondary">OCR：{fact.visibleText.join(' / ')}</p>}{flow?.evidence && <p className="mt-2 text-[9px] text-text-muted">轮播作用依据：{flow.evidence}</p>}</div>; })}
    </div>
  );

  if (activeTab === 'copy') return (
    <div className="space-y-3">
      <section className="rounded-xl border border-border bg-white p-3"><div className="flex items-center justify-between"><p className="text-[10px] font-bold text-text-muted">原始帖文</p><span className="rounded-full bg-surface-2 px-2 py-0.5 text-[9px] text-text-muted">抓取原文</span></div><p className="mt-2 text-[11px] font-bold leading-relaxed text-text-primary">{rawCaption || '未抓取到原始帖文'}</p></section>
      {!evidence?.copyEvidence.hooks.length && !evidence?.copyEvidence.sellingPoints.length ? <EmptyEvidence title="没有可确认的文案模块" desc="仅展示原始帖文，不推断未出现的人群、痛点或承诺。"/> : <>{evidence?.copyEvidence.hooks.map((item, index) => <EvidenceCard key={`copy-hook-${index}`} label={`钩子 ${index + 1} · ${item.source}`} value={`${item.text}｜证据：${item.evidence}`}/>)}{evidence?.copyEvidence.sellingPoints.map((item, index) => <EvidenceCard key={`copy-point-${index}`} label={`卖点 ${index + 1} · ${item.source}`} value={`${item.text}｜证据：${item.evidence}`}/>)}</>}
    </div>
  );

  return (
    <div className="space-y-3">
      <div><p className="text-[11px] font-black text-text-primary">套用到企业获客内容</p><p className="mt-1 text-[10px] text-text-muted">生成“吸引—解释—信任”三条连续内容，而不是三张相似测试图。</p></div>
      {!isAnalyzed ? <EmptyEvidence title="暂不能生成内容包" desc="需要先完成逐图证据提取，才能安全复用布局和信息模块。"/> : <div className="space-y-2">{[['吸引目标买家', '复用首图停留结构，替换为企业产品和买家问题。'], ['解释合作能力', '复用产品、细节和流程模块，映射企业 MOQ、定制与交付资料。'], ['建立供应商信任', '复用证明模块，只使用企业真实工厂、认证和案例。']].map(([title, desc], index) => <div key={title} className="flex gap-3 rounded-xl border border-border bg-white p-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-[10px] font-black text-emerald-700">{index + 1}</span><div><p className="text-[11px] font-black text-text-primary">{title}</p><p className="mt-1 text-[10px] text-text-secondary">{desc}</p></div></div>)}{evidence!.uncertainties.length > 0 && <div className="rounded-xl bg-amber-50 p-3"><p className="text-[10px] font-black text-amber-800">生成前需确认</p>{evidence!.uncertainties.map(item => <p key={item} className="mt-1 text-[9px] text-amber-700">· {item}</p>)}</div>}</div>}
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
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: 'rgba(22,163,74,0.1)' }}>
          <Loader2 size={18} className="text-accent animate-spin" />
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-semibold text-text-primary">{video.contentFormat === 'image' ? 'AI 正在提取图片爆点…' : 'AI 正在分析脚本结构…'}</p>
          <p className="text-xs text-text-muted">{video.contentFormat === 'image' ? '视觉焦点 · 文案钩子 · 迭代变量' : '前 10 秒五维拆解 · 粗略 3 秒结构 · 提取复用爆点'}</p>
        </div>
        <div className="w-48 h-1.5 rounded-full bg-surface-2 overflow-hidden">
          <motion.div className="h-full rounded-full bg-accent"
            initial={{ width: '5%' }} animate={{ width: '90%' }}
            transition={{ duration: 1.4, ease: 'easeInOut' }} />
        </div>
      </div>
    );
  }

  if (!analysis) {
    const state = pipelineState(video);
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-surface-2 border border-border">
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
          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 font-semibold text-text-secondary">{video.contentFormat === 'image' && <SocialPlatformIcon platform={video.platform} size={12} />}{video.contentFormat === 'image' ? `${getPlatformMeta(video.platform).label} 图文` : analysis.videoType}</span>
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
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 shadow-sm">
                  <div className="flex items-center gap-1.5"><Flame size={13} className="text-red-600" /><p className="text-[11px] font-black text-red-700">特别推荐 · 借鉴价值{specialRecommendation.level}</p></div>
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
                            <span className="text-[11px] font-black text-text-primary">{match.viralDna.purpose}</span>
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
                        <p className="text-[9px] font-black text-text-primary">为什么有效</p>
                        <p className="mt-1 text-[10px] leading-relaxed text-text-secondary">{match.viralPotential.whyEffective}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1">{match.viralPotential.mechanisms.map(item => <span key={item} className="rounded bg-amber-dim px-1.5 py-0.5 text-[9px] font-bold text-amber">{item}</span>)}</div>
                      </div>

                      <div className="mt-2 rounded-lg border border-border bg-white/90 px-2.5 py-2">
                        <p className="text-[9px] font-black text-text-primary">必须保留</p>
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
                            {match.segment && !match.segment.manualConfirmed && <button type="button" onClick={() => void confirmMatchedSegment(match)} className="inline-flex items-center gap-1 rounded-md border border-green-200 bg-green-50 px-2 py-1 text-[10px] font-bold text-green-700"><Check size={10} />人工确认片段</button>}
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
              <div className="overflow-hidden rounded-xl border border-border">
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
              <div className="rounded-xl border border-dashed p-3"
                style={{ borderColor: 'rgba(22,163,74,0.3)', background: 'rgba(22,163,74,0.04)' }}>
                <p className="mb-1.5 text-[10px] font-semibold text-accent">改编建议</p>
                <p className="text-[11px] leading-relaxed text-text-secondary">{analysis.adaptTip}</p>
              </div>
              <div className="rounded-xl border border-border bg-surface-2 p-3">
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
        {video.contentFormat !== 'image' && <div className="mb-3 rounded-xl border border-accent/20 bg-accent/5 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-black text-text-primary">{analysisQuality.ready ? '全片精确分析版 · 质量校验通过' : video.aiAnalysis?.requestedAnalysisMode === 'exact' ? '全片精确分析排队中' : video.aiAnalysis?.analysisMode === 'exact' ? '全片精确分析未通过校验' : showStrategyProgress ? '自动策略分析处理中' : '全片策略分析版'}</p>
            {!analysisQuality.ready && <button type="button" onClick={onExactAnalysis} disabled={video.aiAnalysis?.requestedAnalysisMode === 'exact'} className="shrink-0 rounded-lg border border-accent bg-white px-2.5 py-1.5 text-[10px] font-black text-accent hover:bg-accent/5 disabled:cursor-wait disabled:opacity-50">{video.aiAnalysis?.requestedAnalysisMode === 'exact' ? '精确分析生成中…' : video.aiAnalysis?.analysisMode === 'exact' ? '重试全片精确分析' : '生成全片精确分析'}</button>}
          </div>
          {actionNotice && <p role="status" aria-live="polite" className="mt-2 rounded-lg border border-accent/20 bg-white px-2.5 py-2 text-[10px] font-semibold leading-relaxed text-text-secondary">{actionNotice}</p>}
          {video.aiAnalysis?.videoLevelFailureStatus && !video.aiAnalysis?.requestedAnalysisMode && <p role="status" aria-live="polite" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] font-semibold leading-relaxed text-amber-700">全片精确分析未完成，已保留原分析。可稍后重试，或换用可直接下载的公开素材。</p>}
        </div>}
        {video.contentFormat === 'image' && !hasTrustedImageAnalysis && <button type="button" onClick={() => void reanalyzeImage()} disabled={reanalyzingImage} className="mb-2 flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 py-2 text-xs font-black text-emerald-700 disabled:opacity-50">{reanalyzingImage ? <Loader2 size={13} className="animate-spin"/> : <Images size={13}/>}重新分析完整轮播</button>}
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
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
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
                        scriptType === type ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'
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
                        className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-border bg-surface z-10 overflow-hidden shadow-lg">
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
                  className="mt-0.5 accent-green-600" />
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
                      transition={{ duration: 0.18 }} className="overflow-hidden">
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
                    <div className="flex items-center gap-1.5">
                      {[0, 150, 300].map(d => <span key={d} className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
                    </div>
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
                      <p className="font-black">{resultProvenance === 'ai'
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
                      <button className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors">
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
                                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-surface-2 border border-border">
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
                              <div className="relative w-24 aspect-[9/16] flex-shrink-0 overflow-hidden rounded-xl bg-black">
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
  const dialogRef = useModalFocus<HTMLDivElement>({ open: true, onClose });
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="inspiration-watch-title"
      className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center px-5 py-6"
      onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 12 }}
        className="w-full max-w-4xl overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 px-4 py-3 border-b border-border">
          <div className="min-w-0">
            <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted">{PLATFORM_META[video.platform]?.label ?? video.platform} 预览</p>
            <h3 id="inspiration-watch-title" className="mt-0.5 truncate text-sm font-semibold text-text-primary">{video.title}</h3>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {video.sourceUrl && (
              <button onClick={() => window.open(video.sourceUrl, '_blank', 'noopener,noreferrer')}
                className="px-3 py-1.5 rounded-lg border border-border bg-surface-2 text-xs font-semibold text-text-secondary hover:text-text-primary transition-colors">
                原站打开
              </button>
            )}
            <button type="button" data-modal-initial-focus onClick={onClose} aria-label="关闭视频预览" className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary">
              <X size={15} />
            </button>
          </div>
        </div>
        <div className="bg-black">
          {video.videoUrl ? (
            <AuthenticatedVideo apiUrl={video.videoUrl} poster={video.thumbnail} controls autoPlay className="w-full max-h-[72vh] bg-black" />
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
      </motion.div>
    </motion.div>
  );
}

function DirectorVideoDetailPanel({
  video,
  onClose,
  onPreview,
  onCreate,
  onRetry,
  onExactAnalysis,
  onCancelAnalysis,
  analyzing,
  notice,
}: {
  video: TrendVideo;
  onClose: () => void;
  onPreview: () => void;
  onCreate: () => void;
  onRetry: () => void;
  onExactAnalysis: () => void;
  onCancelAnalysis: () => void;
  analyzing: boolean;
  notice?: string;
}) {
  const dialogRef = useModalFocus<HTMLDivElement>({ open: true, onClose });
  const analysis = getAnalysis(video);
  const exactQuality = exactAnalysisQuality(video);
  const payload = video.aiAnalysis;
  const imageEvidence = payload?.imageEvidence;
  const isImagePost = video.contentFormat === 'image';
  const imageEvidenceCount = imageEvidence?.observedFacts?.length || imageEvidence?.carouselFlow?.length || 0;
  const terminalAnalysisState = Boolean(payload?.analysisError)
    || ['paused', 'video_failed', 'failed'].includes(String(payload?.geminiStatus || ''));
  const pending = analyzing
    || payload?.requestedAnalysisMode === 'exact'
    || (video.status === 'pending' && !terminalAnalysisState);
  const statusLabel = pending
    ? '编导 Agent 分析中'
    : isImagePost && imageEvidence
      ? '图文证据分析已完成'
      : exactQuality.ready
      ? '全片精确分析已完成'
      : analysis
        ? '策略分析已完成'
        : payload?.analysisError || video.status === 'failed'
          ? '分析需要重试'
          : '等待编导 Agent 分析';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[85] flex justify-end bg-black/25 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <motion.aside
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="director-video-analysis-title"
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 40, opacity: 0 }}
        className="flex h-full w-full max-w-[720px] flex-col border-l border-border bg-[#f8faf7] shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border bg-white px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-accent px-2 py-1 text-[10px] font-black text-white">编导 Agent</span>
              <span className={`rounded-md px-2 py-1 text-[10px] font-bold ${pending ? 'bg-amber-50 text-amber-700' : exactQuality.ready ? 'bg-emerald-50 text-emerald-700' : 'bg-sky-50 text-sky-700'}`}>{statusLabel}</span>
            </div>
            <h2 id="director-video-analysis-title" className="mt-2 line-clamp-2 text-base font-bold leading-6 text-text-primary">{video.title}</h2>
            <p className="mt-1 text-[11px] text-text-muted">
              {PLATFORM_META[video.platform]?.label || video.platform} · {displayDuration(video.duration)} · {payload?.analysisSource || '待确认分析来源'}
            </p>
          </div>
          <button type="button" data-modal-initial-focus onClick={onClose} aria-label="关闭编导分析" className="rounded-lg p-2 text-text-muted hover:bg-surface-2 hover:text-text-primary">
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <section className="grid gap-4 rounded-xl border border-border bg-white p-4 sm:grid-cols-[150px_minmax(0,1fr)]">
            <button type="button" onClick={onPreview} className="group relative aspect-[9/16] overflow-hidden rounded-lg bg-surface-2 text-left">
              <VideoThumbnail platform={video.platform} title={video.title} />
              {video.thumbnail && <ThumbnailImage src={video.thumbnail} platform={video.platform} title={video.title} className="absolute inset-0 h-full w-full object-cover" />}
              <span className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition group-hover:opacity-100"><span className="rounded-full bg-white/95 p-3 text-text-primary shadow"><Play size={16} fill="currentColor" /></span></span>
            </button>
            <div className="min-w-0">
              <p className="text-xs font-black text-text-primary">分析结论</p>
              <p className="mt-2 text-sm leading-6 text-text-secondary">
                {analysis?.referenceHighlights[0] || imageEvidence?.copyEvidence.hooks[0]?.text || payload?.analysisError || '编导 Agent 正在读取原视频证据，完成后会在这里给出可追溯的内容判断。'}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-lg bg-surface-2 px-3 py-2"><span className="block text-text-muted">分析层级</span><strong className="mt-1 block text-text-primary">{isImagePost ? (imageEvidence ? '图文证据级' : '未完成') : exactQuality.ready ? '全片精确' : analysis ? '策略级' : '未完成'}</strong></div>
                <div className="rounded-lg bg-surface-2 px-3 py-2"><span className="block text-text-muted">{isImagePost ? '证据覆盖' : '分镜覆盖'}</span><strong className="mt-1 block text-text-primary">{isImagePost ? `${imageEvidenceCount} 条` : `${exactQuality.actualFrames} / ${exactQuality.requiredFrames} 段`}</strong></div>
              </div>
              <p className={`mt-3 rounded-lg px-3 py-2 text-[11px] font-semibold leading-5 ${(isImagePost && imageEvidence) || exactQuality.ready ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{isImagePost ? (imageEvidence ? '已按原图证据完成视觉、文案与轮播节奏拆解。' : '等待编导 Agent 提取图文证据。') : exactQuality.reason}</p>
            </div>
          </section>

          {notice && <p role="status" className="mt-4 border-l-2 border-accent bg-accent-glow px-3 py-2 text-xs font-semibold text-accent">{notice}</p>}

          {isImagePost && imageEvidence ? (
            <div className="mt-4 space-y-4">
              <section className="rounded-xl border border-border bg-white p-4">
                <h3 className="text-sm font-black text-text-primary">图文证据与轮播节奏</h3>
                <div className="mt-3 space-y-2">
                  {imageEvidence.carouselFlow.map(item => <div key={`${item.imageIndex}-${item.role}`} className="rounded-lg bg-surface-2 px-3 py-2 text-xs leading-5"><strong className="text-text-primary">第 {item.imageIndex + 1} 张 · {item.role}</strong><p className="text-text-secondary">{item.evidence}</p></div>)}
                </div>
              </section>
              <section className="rounded-xl border border-border bg-white p-4">
                <h3 className="text-sm font-black text-text-primary">可复用模块</h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">{imageEvidence.reusableModules.map(item => <div key={item.module} className="rounded-lg border border-border p-3 text-xs"><strong>{item.module}</strong><p className="mt-1 leading-5 text-text-secondary">保留：{item.preserve}</p><p className="leading-5 text-text-muted">替换：{item.replace}</p></div>)}</div>
              </section>
            </div>
          ) : analysis ? (
            <div className="mt-4 space-y-4">
              <section className="rounded-xl border border-border bg-white p-4">
                <h3 className="text-sm font-black text-text-primary">核心原因 · 前 10 秒</h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {analysis.firstTenSeconds.map(item => <div key={item.dimension} className="rounded-lg bg-surface-2 px-3 py-2"><p className="text-[10px] font-black text-accent">{item.dimension}</p><p className="mt-1 text-xs leading-5 text-text-secondary">{item.detail}</p></div>)}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">{analysis.referenceHighlights.slice(0, 7).map(item => <span key={item} className="rounded-md bg-accent-glow px-2 py-1 text-[10px] font-semibold text-accent">{item}</span>)}</div>
              </section>

              <section className="rounded-xl border border-border bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-black text-text-primary">全片分镜时间线</h3><span className="text-[10px] font-bold text-text-muted">编导 Agent · {analysis.scriptDetails15s.length} 段</span></div>
                <div className="mt-3 space-y-3">
                  {analysis.scriptDetails15s.map((detail, index) => <article key={`${detail.time}-${index}`} className="rounded-lg border border-border bg-[#fbfcfa] p-3">
                    <div className="flex flex-wrap items-center gap-2"><span className="rounded bg-text-primary px-2 py-1 text-[10px] font-black text-white">{detail.time}</span><span className="text-[10px] font-bold text-text-muted">{detail.shot} · {detail.camera}</span>{typeof detail.viralPotential?.score === 'number' && <span className="ml-auto rounded bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-700">爆点 {detail.viralPotential.score}</span>}</div>
                    <p className="mt-2 text-xs font-semibold leading-5 text-text-primary">{detail.purpose || '镜头作用待编导确认'}</p>
                    <p className="mt-1 text-xs leading-5 text-text-secondary">{detail.visual}</p>
                    {(detail.dialogue || detail.onScreenText || detail.subtitle) && <p className="mt-2 rounded bg-white px-2.5 py-2 text-[11px] leading-5 text-text-secondary">音画信息：{detail.dialogue || detail.onScreenText || detail.subtitle}</p>}
                    {detail.viralPotential?.whyEffective && <p className="mt-2 text-[11px] leading-5 text-amber-800">为什么有效：{detail.viralPotential.whyEffective}</p>}
                    {(detail.needsReview || detail.authenticity) && <p className="mt-2 text-[10px] font-semibold text-text-muted">{detail.needsReview ? '需人工复核 · ' : ''}{detail.authenticity}</p>}
                  </article>)}
                </div>
              </section>

              <section className="rounded-xl border border-border bg-white p-4">
                <h3 className="text-sm font-black text-text-primary">编导改编建议</h3>
                <p className="mt-2 text-xs leading-6 text-text-secondary">{analysis.adaptTip}</p>
                {analysis.baseRequirements && <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-[11px] leading-5 text-text-muted">制作约束：{analysis.baseRequirements}</p>}
              </section>
            </div>
          ) : (
            <section className="mt-4 rounded-xl border border-dashed border-border bg-white px-6 py-12 text-center">
              {pending ? <Loader2 size={24} className="mx-auto animate-spin text-accent" /> : <BarChart2 size={24} className="mx-auto text-text-muted" />}
              <p className="mt-3 text-sm font-black text-text-primary">{statusLabel}</p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-text-muted">{pending ? '通常需要 1–3 分钟，可以先关闭此页；超过 5 分钟未完成会自动变为可重试。' : '完成后会展示前 10 秒原因、全片分镜、爆点评分、真实性边界和改编建议。'}</p>
            </section>
          )}
        </div>

        <footer className="shrink-0 border-t border-border bg-white px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            {!isImagePost && !exactQuality.ready && (pending
              ? <button type="button" onClick={onCancelAnalysis} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-amber-300 px-3 text-xs font-bold text-amber-700"><X size={13} />停止分析</button>
              : <button type="button" onClick={onExactAnalysis} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-accent px-3 text-xs font-bold text-accent"><BarChart2 size={13} />全片精确分析</button>)}
            {(payload?.analysisError || video.status === 'failed') && <button type="button" onClick={onRetry} disabled={analyzing} className="min-h-10 rounded-lg border border-border px-3 text-xs font-bold text-text-secondary disabled:opacity-50">重新分析</button>}
            <button type="button" onClick={onPreview} className="min-h-10 rounded-lg border border-border px-3 text-xs font-bold text-text-secondary">预览原内容</button>
            <button type="button" onClick={onCreate} disabled={!analysis && !imageEvidence} className="ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-accent px-4 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-45"><Sparkles size={14} />带分析进入内容制作</button>
          </div>
        </footer>
      </motion.aside>
    </motion.div>
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
  const [materialEntry] = useState(initialMaterialLibraryEntry);
  const [innerView, setInnerView] = useState<InspirationInnerView>(() => materialEntry.openLibrary ? 'library' : 'inspiration');
  const [platform, setPlatform] = useState<Platform>('all');
  const [search, setSearch] = useState('');
  // 搜索改为服务端执行：此前只在已加载的那一页做前端过滤，翻页之外的记录搜不到。
  const searchRef = useRef('');
  searchRef.current = search;
  const [selectedVideo, setSelectedVideo] = useState<TrendVideo | null>(null);
  const [watchVideo, setWatchVideo] = useState<TrendVideo | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortMode, setSortMode] = useState<SortMode>('crawlTime');
  const [contentFormat, setContentFormat] = useState<ContentFormat>('video');
  const [crawlTimeRange, setCrawlTimeRange] = useState<CrawlTimeRange>('all');
  const [inspirationFiltersOpen, setInspirationFiltersOpen] = useState(false);
  const [crawledVideos, setCrawledVideos] = useState<TrendVideo[]>([]);
  const [videoPage, setVideoPage] = useState(1);
  const [videoTotalPages, setVideoTotalPages] = useState(1);
  const [tenantVideoTotalItems, setTenantVideoTotalItems] = useState<number | null>(null);
  const [videosLoading, setVideosLoading] = useState(false);
  const [videosLoaded, setVideosLoaded] = useState(false);
  const [videosError, setVideosError] = useState('');
  const [lastCrawlVideoIds, setLastCrawlVideoIds] = useState<string[]>([]);
  const [analyzingVideoIds, setAnalyzingVideoIds] = useState<string[]>([]);
  const [favoritingMaterialIds, setFavoritingMaterialIds] = useState<string[]>([]);
  const [materialMessage, setMaterialMessage] = useState('');
  const [localMaterials, setLocalMaterials] = useState<Material[]>([]);
  const [manageTarget, setManageTarget] = useState<(({ kind: 'video'; item: TrendVideo } | { kind: 'material'; item: Material }) & { action: 'edit' | 'delete' }) | null>(null);
  const [manageName, setManageName] = useState('');
  const [manageTags, setManageTags] = useState('');
  const [manageProductId, setManageProductId] = useState<string | null>(null);
  const [materialProducts, setMaterialProducts] = useState<Array<{id:string;name:string}>>([]);
  const [materialProductFilterEnabled, setMaterialProductFilterEnabled] = useState(() => Boolean(materialEntry.productId || materialEntry.productRef));
  const [materialProductId, setMaterialProductId] = useState(materialEntry.productId);
  const [materialProductRef, setMaterialProductRef] = useState(materialEntry.productRef);
  const [uploadProductId, setUploadProductId] = useState<string | null>(() => materialEntry.productId || null);
  const [manageBusy, setManageBusy] = useState(false);
  const [previewMaterial, setPreviewMaterial] = useState<Material | null>(null);
  const previewMaterialDialogRef = useModalFocus<HTMLDivElement>({
    open: Boolean(previewMaterial?.type === 'video' && previewMaterial.url),
    onClose: () => setPreviewMaterial(null),
  });
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
  const [materialSource, setMaterialSource] = useState<MaterialSourceFilter>('all');
  const [materialType, setMaterialType] = useState<MaterialTypeFilter>('all');
  const [materialFiltersOpen, setMaterialFiltersOpen] = useState(false);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [uploadingMaterial, setUploadingMaterial] = useState(false);
  const [generatingNeedId, setGeneratingNeedId] = useState('');
  const { scriptGapTasks, shootingTaskError: _shootingTaskError } = useScriptGapTasks();
  const [uploadingScriptGapId, setUploadingScriptGapId] = useState('');
  const [showAccountsModal, setShowAccountsModal] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const videoRequestRef = useRef(0);
  const inventoryRequestRef = useRef(0);
  const platformLabel = PLATFORM_FILTERS.find(f => f.id === platform)?.label ?? '全部平台';
  const sortLabel = sortMode === 'crawlTime' ? '按爬取时间' : '按内容机会';
  const contentFormatLabel = contentFormat === 'video' ? '视频' : '图文';
  useEffect(() => {
    if (selectedVideo) { onScriptPanelOpen?.(); }
    else { onScriptPanelClose?.(); }
  }, [selectedVideo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up on unmount
  useEffect(() => () => { onScriptPanelClose?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshMaterials = async () => {
    if (!localMaterials.length) setMaterialsLoading(true);
    try {
      // “我的素材”既是可编辑生产素材的入口，也是采集参考素材的可见库存。
      // 参考素材必须可预览，但仍由 usage=reference_only 阻止进入生成链路。
      setLocalMaterials(await studioApi.listMaterials('all'));
    } catch { /* keep last successful items; show connection status */ } finally {
      setMaterialsLoading(false);
    }
  };

  useEffect(() => { void refreshMaterials(); }, []);

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
      // This KPI is the tenant's complete crawled inventory, not the current
      // page (or a temporary search result). Only refresh it from an unfiltered
      // tenant list response; admin aggregation must not overwrite it.
      if (requestId === videoRequestRef.current && r.ok && !keyword) {
        setTenantVideoTotalItems(Math.max(0, Number(data.inventoryTotalItems || 0)));
      }

      const applyResult = (result: typeof data) => {
        if (requestId !== videoRequestRef.current) return;
        setVideosError('');
        const videos = recordsToVideos(result.items || []);
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

  const hasPendingVideos = crawledVideos.some(v =>
    v.status === 'pending' ||
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

  const pinnedMaterialVideos = useMemo<TrendVideo[]>(() => localMaterials
    .filter(material => material.pinned && material.type === 'video' && material.segmentAnalysisStatus === 'completed' && material.segments?.length)
    .map(material => {
      const persistedAnalysis = crawledVideos.find(video => video.aiAnalysis?.materialId === material.id);
      const platform: TrendVideo['platform'] = /facebook/i.test(material.name) ? 'facebook'
        : /youtube/i.test(material.name) ? 'youtube' : /instagram/i.test(material.name) ? 'instagram' : 'tiktok';
      const title = material.name.replace(/^爆款[·・][^·・]+[·・]/, '').replace(/\.[a-z0-9]+$/i, '');
      return {
        id: `material-${material.id}`,
        recordId: persistedAnalysis?.recordId,
        platform,
        title,
        thumbnail: material.poster || material.segments?.[0]?.poster || '',
        duration: material.duration,
        tags: ['片段已分析', '置顶素材'],
        views: '本地素材',
        trend: 'stable',
        videoUrl: material.url,
        status: persistedAnalysis?.status || 'analyzed',
        crawledAt: material.createdAt,
        contentFormat: 'video',
        aiAnalysis: persistedAnalysis?.aiAnalysis || {
          source: 'material_segment_analysis',
          materialUrl: material.url,
          materialPoster: material.poster,
          geminiStatus: 'completed',
          analysisQuality: 'segment_grounded',
          analyzedAt: material.createdAt,
          gemini: {
            theme: title,
            structure: material.segments!.map(segment => segment.recommendedFunctions.join('、')).filter(Boolean).join(' → '),
            hooks: material.segments!.slice(0, 2).flatMap(segment => segment.recommendedFunctions),
            mood: '素材片段级分析',
            scriptSummary15s: { visualStyle: '真实本地视频素材', coreEmotion: '待人工校验', competitors: [] },
            scriptDetails15s: material.segments!.map(segment => ({
              time: `${segment.start}-${segment.end}s`,
              environment: segment.environment,
              shot: segment.shot,
              camera: segment.camera,
              angle: segment.angle,
              composition: segment.composition,
              visual: segment.action,
              subtitle: segment.ocrText,
              onScreenText: segment.ocrText,
              purpose: segment.recommendedFunctions.join('、'),
              authenticity: segment.authenticity,
              confidence: segment.confidence,
              needsReview: segment.needsReview,
            })),
            recommendedScriptType: 'storyboard',
          },
        },
      };
    }), [localMaterials, crawledVideos]);
  const enterMaterialSmartGeneration = (material: Material) => {
    if (material.usage === 'reference_only') {
      setMaterialMessage('这条采集素材仅供分析与镜头参考，完成商业授权复核后才能用于生成成片。');
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
      duration: isImageMaterial ? 1 : material.duration,
      tags: Array.from(new Set(['本地素材', ...visibleMaterialTags(material.tags).split(/[,，]/).map(tag => tag.trim()).filter(Boolean)])),
      views: '本地素材',
      trend: 'stable',
      videoUrl: material.type === 'video' ? material.url : undefined,
      sourceUrl: material.sourceUrl || material.url,
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
        url: material.url,
        poster: material.poster,
        duration: material.duration,
        createdAt: material.createdAt,
        source: 'material_library',
        material,
      },
    });
  };
  const pinnedTitles = new Set(pinnedMaterialVideos.map(video => video.title.trim().toLowerCase()));
  const allVideos = [
    ...(videoPage === 1 ? pinnedMaterialVideos : []),
    ...crawledVideos.filter(video => !pinnedTitles.has(video.title.trim().toLowerCase())),
  ];
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
  const filtered = useMemo(() => {
    const lastCrawlIds = new Set(lastCrawlVideoIds);
    const limitToLastCrawl = lastCrawlIds.size >= 10;
    const q = search.trim().toLowerCase();
    return visibleVideos
      .filter(v =>
        (v.id.startsWith('material-') || !limitToLastCrawl || lastCrawlIds.has(v.id)) &&
        (platform === 'all' || v.platform === platform) &&
        (!q || v.title.toLowerCase().includes(q) || v.tags.some(t => t.toLowerCase().includes(q)))
      )
      .sort((a, b) => {
        const pinnedRank = Number(b.id.startsWith('material-')) - Number(a.id.startsWith('material-'));
        if (pinnedRank) return pinnedRank;
        if (a.id.startsWith('material-') && b.id.startsWith('material-')) {
          return pinnedMaterialVideos.findIndex(item => item.id === a.id) - pinnedMaterialVideos.findIndex(item => item.id === b.id);
        }
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
  }, [visibleVideos, lastCrawlVideoIds, platform, search, sortMode, pinnedMaterialVideos, contentFormat]);

  const recentThreeDayUploads = visibleVideos.filter(v => {
    const t = v.crawledAt ? new Date(v.crawledAt).getTime() : 0;
    return t > 0 && Date.now() - t <= 3 * 24 * 60 * 60 * 1000;
  }).length;

  const shootingNeeds = useMemo(() => buildShootingNeeds(visibleVideos, localMaterials), [visibleVideos, localMaterials]);
  const materialFunctionOptions = useMemo(() => {
    const values = new Set<string>();
    localMaterials.forEach(material => String(material.shotFunction || '').split(',').map(item => item.trim()).filter(Boolean).forEach(item => values.add(item)));
    return [...values].sort((a, b) => (MATERIAL_FUNCTION_LABELS[a] || a).localeCompare(MATERIAL_FUNCTION_LABELS[b] || b, 'zh-CN'));
  }, [localMaterials]);
  const filteredMaterials = useMemo(() => {
    const q = materialSearch.trim().toLowerCase();
    return localMaterials.filter(material => {
      const functions = String(material.shotFunction || '').split(',').map(item => item.trim());
      const searchable = [material.name, material.folder, material.industry, material.shotFunction, material.applicability, material.tags, material.productName, material.scriptAnalysis?.searchableText].filter(Boolean).join(' ').toLowerCase();
      const orientationMatches = materialOrientation === 'all'
        || (materialOrientation === 'vertical' && /竖屏|vertical/i.test(String(material.tags || '')))
        || (materialOrientation === 'horizontal' && /横屏|horizontal/i.test(String(material.tags || '')));
      const productMatches = materialMatchesProductFilter(material, {
        enabled: materialProductFilterEnabled,
        productId: materialProductId,
        productRef: materialProductRef,
      });
      return (!q || searchable.includes(q))
        && (materialType === 'all' || material.type === materialType)
        && (materialIndustry === 'all' || material.industry === materialIndustry)
        && (materialFunction === 'all' || functions.includes(materialFunction))
        && (materialApplicability === 'all' || material.applicability === materialApplicability)
        && (materialSource === 'all' || materialSource === materialSourceOf(material))
        && productMatches
        && orientationMatches;
    }).sort((a, b) => {
      // User uploads are the primary working set. Seed/demo library records may
      // have a later migration timestamp, which must not push fresh uploads down.
      const sourcePriority = Number(materialSourceOf(b) === 'local_upload') - Number(materialSourceOf(a) === 'local_upload');
      return sourcePriority || (Date.parse(String(b.createdAt || '')) || 0) - (Date.parse(String(a.createdAt || '')) || 0);
    });
  }, [localMaterials, materialSearch, materialType, materialIndustry, materialFunction, materialApplicability, materialOrientation, materialSource, materialProductFilterEnabled, materialProductId, materialProductRef]);

  const handleUploadMaterials = async (files: FileList | null) => {
    if (!files?.length) return;
    if (uploadProductId === null) {
      setMaterialMessage('请先选择本次素材属于哪个产品，或明确选择“企业通用素材”');
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
      if (uploadingScriptGapId && uploadedIds.length) updateScriptGapTask(uploadingScriptGapId, { uploadedMaterialIds: uploadedIds });
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
    if (uploadProductId === null) {
      setUploadingScriptGapId('');
      setMaterialMessage('请先在“我的素材”顶部选择产品或“企业通用素材”，再上传文件');
      return;
    }
    setUploadingScriptGapId(scriptGapId);
    window.setTimeout(() => uploadInputRef.current?.click(), 50);
  };

  const generateNeedMaterial = async (need: ShootingNeed) => {
    setGeneratingNeedId(need.id);
    setMaterialMessage(`正在生成“${need.title}”，通常需要几分钟；可以留在本页等待结果。`);
    try {
      const output = await studioApi.seedanceVideo({
        script: `${need.title}\n${need.suggestion}\n参考分镜：${need.example?.visual || ''}\n输出 ${need.ratio} 社媒短视频素材。`,
        productInfo: need.suggestion,
        language: 'zh',
        ratio: need.ratio,
        duration: 5,
        resolution: '720p',
        title: `Seedance 2.0 待拍素材 · ${need.title}`,
      });
      if (!output.ok) throw new Error(output.error || 'Seedance 2.0 生成失败');
      await refreshMaterials();
      setMaterialMessage(`Seedance 2.0 已生成素材：${need.title}`);
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
    setCrawlTimeRange('all');
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

  const enterInspirationWorkflow = (video: TrendVideo) => {
    setMaterialMessage('');
    if (!canProcessVideo(video)) {
      setMaterialMessage('该内容缺少可用的时长或媒体信息，请先完成素材分析。');
      return;
    }
    if (needsVideoEnhancement(video)) void analyzeVideoOnly(video, true);
    const analysis = getAnalysis(video);
    onEnterWorkflow?.({
      source: video.contentFormat === 'image' ? 'inspiration_image_post' : 'inspiration_analysis',
      video,
      scriptType: 'storyboard',
      language: 'zh',
      productInfo: '',
      referenceAnalysis: analysis ? {
        title: video.title,
        visualStyle: analysis.scriptSummary15s.visualStyle,
        coreEmotion: analysis.scriptSummary15s.coreEmotion,
        details: analysis.scriptDetails15s,
      } : undefined,
    });
  };

  const favoriteMaterial = async (video: TrendVideo, quiet = false) => {
    if (!video.sourceUrl || favoritingMaterialIds.includes(video.id)) return;
    setFavoritingMaterialIds(ids => [...ids, video.id]);
    if (!quiet) setMaterialMessage('');
    try {
      const r = await fetch('/api/overseas/videos/download-material', {
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
        material?: { name?: string; url?: string; poster?: string; duration?: number };
      };
      if (!r.ok) throw new Error(data.error || '收藏失败');
      if (r.status === 202) {
        setMaterialMessage(`已加入爆款素材收藏队列：${video.title}`);
        setTimeout(() => setMaterialMessage(''), 3500);
        void refreshVideos();
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
      setMaterialMessage(`已收藏到爆款素材：${data.material?.name || video.title}`);
      setTimeout(() => setMaterialMessage(''), 3500);
    } catch (e) {
      if (!quiet) setMaterialMessage(e instanceof Error ? e.message : '收藏失败');
    } finally {
      setFavoritingMaterialIds(ids => ids.filter(id => id !== video.id));
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

  const requestExactFullAnalysis = async (video: TrendVideo) => {
    if (analyzingVideoIds.includes(video.id)) return;
    const materialId = video.id.startsWith('material-') ? video.id.slice('material-'.length) : '';
    if (!video.recordId && !materialId) {
      setMaterialMessage('当前视频缺少可分析的入库记录或素材文件');
      return;
    }
    setAnalyzingVideoIds(ids => [...ids, video.id]);
    setMaterialMessage(`正在全片精确分析，通常需要 1–3 分钟：${video.title}`);
    try {
      const response = await fetch(video.recordId
        ? `/api/overseas/videos/${video.recordId}/reanalyze`
        : '/api/overseas/videos/material-exact-analysis', {
        method: video.recordId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(video.recordId
          ? { analysisMode: 'exact' }
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
              if (!latestAnalysis.requestedAnalysisMode) {
                completed = true;
                setMaterialMessage(latestAnalysis.analysisError
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
            setMaterialMessage('处理已超过 3 分钟，任务仍在后台。可以关闭此页；超过 5 分钟未完成会自动变为可重试。');
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
        aiAnalysis: { ...(item.aiAnalysis || {}), requestedAnalysisMode: undefined, geminiStatus: 'paused' },
      };
      setCrawledVideos(items => items.map(markPaused));
      setSelectedVideo(item => item ? markPaused(item) : item);
      setMaterialMessage('已停止。本次未产生的结果不会进入后续制作，可以重新分析。');
      window.setTimeout(() => setMaterialMessage(''), 3500);
    } catch (error) {
      setMaterialMessage(error instanceof Error ? error.message : '停止分析失败');
    }
  };


  const openManageDialog = (target: ({ kind: 'video'; item: TrendVideo } | { kind: 'material'; item: Material }) & { action?: 'edit' | 'delete' }) => {
    if (!target.item.canManage) return;
    setManageTarget({ ...target, action: target.action || 'edit' });
    // 旧素材无法区分“未分类”和“企业通用”，编辑时要求用户重新明确归属。
    setManageProductId(target.kind === 'material'
      ? target.item.productId || (isEnterpriseCommonMaterial(target.item) ? '' : null)
      : null);
    if (target.kind === 'material') void studioApi.materialProducts().then(result => setMaterialProducts(result.items));
    setManageName(target.kind === 'video' ? target.item.title : target.item.name);
    setManageTags(target.kind === 'video' ? target.item.tags.join(', ') : visibleMaterialTags(target.item.tags));
  };

  const saveManagedItem = async () => {
    if (!manageTarget || !manageName.trim() || manageBusy || (manageTarget.kind === 'material' && manageProductId === null)) return;
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
          tags: materialOwnershipTags(manageTags.trim(), manageProductId ?? ''),
          productId: manageProductId ?? '',
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
    setCrawlTimeRange('all');
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
    setMaterialType('all');
    setMaterialIndustry('all');
    setMaterialFunction('all');
    setMaterialApplicability('all');
    setMaterialOrientation('all');
    setMaterialProductSelection(MATERIAL_PRODUCT_ALL);
  };

  const inspirationFilterCount = Number(search.trim().length > 0)
    + Number(platform !== 'all')
    + Number(contentFormat !== 'video')
    + Number(crawlTimeRange !== 'all')
    + Number(sortMode !== 'crawlTime')
    + Number(viewMode !== 'grid');
  const materialFilterCount = Number(materialSearch.trim().length > 0)
    + Number(materialSource !== 'all')
    + Number(materialType !== 'all')
    + Number(materialIndustry !== 'all')
    + Number(materialFunction !== 'all')
    + Number(materialApplicability !== 'all')
    + Number(materialOrientation !== 'all')
    + Number(materialProductFilterEnabled);

  return (
    <main className="relative min-h-full bg-ink text-text-primary">
      <div className="transition-all duration-300">
        <div className="px-4 py-5 sm:px-6 lg:py-6">
          <div className="mb-4 border-b border-border">
            <nav className="-mb-px flex min-w-0 max-w-full gap-1 overflow-x-auto" role="tablist" aria-label="灵感中心分类">
              {([
                { id: 'inspiration' as const, label: '灵感发现', count: tenantVideoTotalItems ?? '…', icon: <Flame size={16} /> },
                { id: 'library' as const, label: '我的素材', count: localMaterials.length, icon: <Film size={16} /> },
                { id: 'shooting' as const, label: '拍摄任务', count: shootingNeeds.length + scriptGapTasks.length, icon: <Lightbulb size={16} /> },
              ]).map(item => {
                const active = innerView === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setInnerView(item.id)}
                    className={`inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30 ${
                      active ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:border-border-bright hover:text-text-primary'
                    }`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                    <span className={`border-l pl-2 text-[10px] font-bold ${active ? 'border-accent/35 text-accent' : 'border-border text-text-muted'}`}>{item.count}</span>
                  </button>
                );
              })}
            </nav>
          </div>

            {materialMessage && (
              <div role="status" aria-live="polite" className="mb-3 border-l-2 border-accent bg-accent-glow px-4 py-2.5 text-sm font-semibold text-accent">
                {materialMessage}
              </div>
            )}
            {innerView === 'inspiration' && <DiscoveryScopePanel />}
            {innerView === 'inspiration' && <div className="mb-4 space-y-3 rounded-lg border border-border bg-surface p-3 sm:p-4">
              <div className="space-y-2.5">
                <div className="relative w-full">
                  <Search size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input type="search" value={search} onChange={e => { setLastCrawlVideoIds([]); setSearch(e.target.value); }}
                    aria-label="搜索爆款灵感"
                    placeholder="搜索标题或标签..."
                    className="h-10 w-full rounded-md border border-border bg-surface pl-10 pr-4 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent" />
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                <div className="relative h-10 min-w-0 rounded-md border border-border bg-surface transition-colors hover:border-border-bright focus-within:border-accent">
                {platform === 'all'
                  ? <Globe size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                  : <SocialPlatformIcon platform={platform} size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2" />}
                <select
                  value={platform}
                  onChange={e => handlePlatformFilter(e.target.value as Platform)}
                  aria-label="社媒平台"
                  className="h-full w-full cursor-pointer appearance-none rounded-md bg-transparent pl-10 pr-9 text-sm font-bold text-text-primary outline-none"
                >
                  {PLATFORM_FILTERS.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <ChevronDown size={15} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                <span className="sr-only">{platformLabel}</span>
              </div>
              <div className="relative h-10 min-w-0 rounded-md border border-border bg-surface transition-colors hover:border-border-bright focus-within:border-accent">
                {contentFormat === 'video'
                  ? <Film size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                  : <Images size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />}
                <select
                  value={contentFormat}
                  onChange={e => handleContentFormatFilter(e.target.value as ContentFormat)}
                  aria-label="内容形式"
                  className="h-full w-full cursor-pointer appearance-none rounded-md bg-transparent pl-10 pr-9 text-sm font-bold text-text-primary outline-none"
                >
                  <option value="video">视频</option>
                  <option value="image">图文</option>
                </select>
                <ChevronDown size={15} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                <span className="sr-only">{contentFormatLabel}</span>
              </div>
              <button type="button" onClick={() => setInspirationFiltersOpen(value => !value)} aria-expanded={inspirationFiltersOpen} aria-controls="inspiration-more-filters"
                className={`inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-md border px-2 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${inspirationFiltersOpen ? 'border-accent bg-accent-glow text-accent' : 'border-border text-text-secondary hover:border-accent hover:text-accent'}`}>
                <SlidersHorizontal size={15} />更多筛选
                {inspirationFilterCount > 0 && <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-black text-white">{inspirationFilterCount}</span>}
                <ChevronDown size={14} className={`transition-transform ${inspirationFiltersOpen ? 'rotate-180' : ''}`} />
              </button>
              </div>
            </div>

            <AnimatePresence initial={false}>
              {inspirationFiltersOpen && <motion.div id="inspiration-more-filters" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="grid gap-3 border-t border-border pt-3 md:grid-cols-3">
                  <label className="relative block h-14 rounded-xl border border-border bg-surface-2 focus-within:border-accent">
                    <Clock size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                    <span className="pointer-events-none absolute left-10 top-1.5 text-[10px] font-semibold text-text-muted">入库时间</span>
                <select
                  value={crawlTimeRange}
                  onChange={event => { setLastCrawlVideoIds([]); setCrawlTimeRange(event.target.value as CrawlTimeRange); }}
                  aria-label="视频抓取入库时间"
                      className="h-full w-full cursor-pointer appearance-none rounded-xl bg-transparent pl-10 pr-9 pt-3 text-sm font-bold text-text-primary outline-none"
                >
                  <option value="all">全部时间</option>
                  <option value="today">今天入库</option>
                  <option value="7d">近 7 天</option>
                  <option value="30d">近 30 天</option>
                </select>
                    <ChevronDown size={15} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                  </label>
                  <label className="relative block h-14 rounded-xl border border-border bg-surface-2 focus-within:border-accent">
                {sortMode === 'heat'
                      ? <Flame size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                      : <Clock size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />}
                    <span className="pointer-events-none absolute left-10 top-1.5 text-[10px] font-semibold text-text-muted">排序方法</span>
                <select
                  value={sortMode}
                  onChange={e => { setLastCrawlVideoIds([]); setSortMode(e.target.value as SortMode); }}
                  aria-label="排序方法"
                      className="h-full w-full cursor-pointer appearance-none rounded-xl bg-transparent pl-10 pr-9 pt-3 text-sm font-bold text-text-primary outline-none"
                >
                  <option value="crawlTime">按爬取时间</option>
                  <option value="heat">按内容机会</option>
                </select>
                    <ChevronDown size={15} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                <span className="sr-only">{sortLabel}</span>
                  </label>
                  <label className="relative block h-14 rounded-xl border border-border bg-surface-2 focus-within:border-accent">
                {viewMode === 'grid'
                      ? <LayoutGrid size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                      : <List size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />}
                    <span className="pointer-events-none absolute left-10 top-1.5 text-[10px] font-semibold text-text-muted">展示方式</span>
                <select
                  value={viewMode}
                  onChange={e => setViewMode(e.target.value as 'grid' | 'list')}
                  aria-label="大屏视图"
                      className="h-full w-full cursor-pointer appearance-none rounded-xl bg-transparent pl-10 pr-9 pt-3 text-sm font-bold text-text-primary outline-none"
                >
                  <option value="grid">卡片视图</option>
                  <option value="list">列表视图</option>
                </select>
                    <ChevronDown size={15} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                  </label>
                </div>
                <div className="mt-2 flex justify-end">
                  <button type="button" onClick={clearInspirationFilters} disabled={inspirationFilterCount === 0}
                    className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold text-text-muted transition hover:bg-surface-2 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40">
                    <X size={13} />清除全部筛选
                  </button>
                </div>
              </motion.div>}
            </AnimatePresence>
          </div>}

        {innerView === 'inspiration' && videosError && <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-900"><span>{videosError}</span><button type="button" onClick={() => void refreshVideos(videoPage)} className="rounded-md bg-white px-2.5 py-1 font-black text-amber-950">重试</button></div>}
        {innerView === 'inspiration' && <div role="status" aria-live="polite" className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-y border-border bg-surface-2/60 px-3.5 py-2 text-xs text-text-muted">
          <span className="inline-flex items-center gap-1.5"><strong className="text-sm text-text-primary">{tenantVideoTotalItems ?? '—'}</strong> 条{contentFormat === 'image' ? '图文' : '视频'}灵感{tenantVideoTotalItems === null && <Loader2 size={12} className="animate-spin text-accent" />}</span>
          <span>当前显示 <strong className="text-text-primary">{filtered.length}</strong> 条</span>
          <span>本页近 3 日新入库 <strong className="text-text-primary">{recentThreeDayUploads}</strong> 条</span>
          <span>覆盖 <strong className="text-text-primary">{new Set(visibleVideos.map(v => v.platform)).size}</strong> 个平台</span>
          {videosLoading && <span className="ml-auto inline-flex items-center gap-1.5 font-semibold text-accent"><Loader2 size={12} className="animate-spin" />更新中…</span>}
        </div>}

        <div>
          {innerView === 'inspiration' && (
            <>
              {!videosLoaded && videosLoading ? (
                <div className="flex min-h-[360px] flex-col items-center justify-center rounded-lg border border-border bg-surface text-center" role="status" aria-live="polite">
                  <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-accent-glow">
                    <Loader2 size={28} className="animate-spin text-accent" />
                    <Flame size={15} className="absolute text-accent" />
                  </div>
                  <p className="mt-4 text-sm font-bold text-text-primary">正在读取真实视频库存</p>
                  <p className="mt-1 text-xs text-text-muted">加载最新 30 条灵感，不会先显示为 0</p>
                </div>
              ) : filtered.length === 0 ? (
                <InspirationEmptyState state={resultEmptyState(visibleVideos.length, search, platform !== 'all' || crawlTimeRange !== 'all')} contentFormat={contentFormat} search={search} localMaterialCount={localMaterials.length} onReset={resetInspirationFilters} onOpenLibrary={() => setInnerView('library')} />
              ) : viewMode === 'grid' ? (
                <div className="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 items-start">
                  {filtered.map((video, i) => (
                    <div key={video.id} className="relative">
                      <VideoCard video={video} index={i} isSelected={false}
                        onSelect={() => openDirectorAnalysis(video)}
                        onCreate={() => enterInspirationWorkflow(video)}
                        onWatch={() => handleWatch(video)}
                        onFavoriteMaterial={() => void favoriteMaterial(video)}
                        favoritingMaterial={favoritingMaterialIds.includes(video.id)} />
              {video.canManage && (
                <div className="absolute right-2 top-9 z-20 flex gap-1">
                  <button type="button" title="编辑素材" aria-label="编辑素材" onClick={() => openManageDialog({ kind: 'video', item: video, action: 'edit' })} className="rounded-md bg-white/95 p-1.5 text-text-secondary shadow backdrop-blur-sm hover:text-accent"><Pencil size={14} /></button>
                  <button type="button" title="删除素材" aria-label="删除素材" onClick={() => openManageDialog({ kind: 'video', item: video, action: 'delete' })} className="rounded-md bg-white/95 p-1.5 text-text-secondary shadow backdrop-blur-sm hover:text-red-600"><Trash2 size={14} /></button>
                </div>
              )}

                    </div>
                  ))}
                </div>
              ) : (
                <div className="card overflow-hidden divide-y divide-border">
                  {filtered.map(video => (
                    <VideoListItem key={video.id} video={video} isSelected={false}
                      onSelect={() => openDirectorAnalysis(video)}
                      onCreate={() => enterInspirationWorkflow(video)}
                      onWatch={() => handleWatch(video)}
                      onFavoriteMaterial={() => void favoriteMaterial(video)}
                      favoritingMaterial={favoritingMaterialIds.includes(video.id)} />
                  ))}
                </div>
              )}
              {videosLoaded && videoTotalPages > 1 && (
                <nav className="flex flex-wrap items-center justify-center gap-2 pb-4 pt-4" aria-label="灵感发现分页">
                  <button
                    type="button"
                    onClick={() => void refreshVideos(Math.max(1, videoPage - 1))}
                    disabled={videosLoading || videoPage <= 1}
                    className="btn-ghost !px-3 !py-2 disabled:opacity-40"
                  >
                    上一页
                  </button>
                  <span className="min-w-24 text-center text-xs font-bold text-text-secondary">
                    第 {videoPage} / {videoTotalPages} 页
                  </span>
                  <button
                    type="button"
                    onClick={() => void refreshVideos(Math.min(videoTotalPages, videoPage + 1))}
                    disabled={videosLoading || videoPage >= videoTotalPages}
                    className="btn-ghost !px-3 !py-2 disabled:opacity-40"
                  >
                    下一页
                  </button>
                  <span className="w-full text-center text-[11px] text-text-muted">每页按最新入库时间展示 {INSPIRATION_PAGE_SIZE} 条</span>
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
              <div className="flex flex-wrap items-center justify-end gap-2 rounded-lg border border-border bg-surface px-2.5 py-2">
                <label htmlFor="material-upload-product" className="sr-only">本次上传归属（必选）</label>
                <select
                  id="material-upload-product"
                  aria-label="本次上传素材归属"
                  value={uploadProductId === null ? MATERIAL_PRODUCT_UNSELECTED : uploadProductId || MATERIAL_PRODUCT_COMMON}
                  onChange={event => setUploadProductId(event.target.value === MATERIAL_PRODUCT_UNSELECTED ? null : event.target.value === MATERIAL_PRODUCT_COMMON ? '' : event.target.value)}
                  className="h-9 min-w-[190px] rounded-md border border-border bg-white px-3 text-xs font-bold text-text-primary outline-none focus:border-accent"
                >
                  <option value={MATERIAL_PRODUCT_UNSELECTED}>请选择产品或企业通用</option>
                  <option value={MATERIAL_PRODUCT_COMMON}>企业通用素材</option>
                  {materialProductId && materialProductRef && !materialProducts.some(item => item.id === materialProductId) && <option value={materialProductId}>{materialProductRef}</option>}
                  {materialProducts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={uploadingMaterial || uploadProductId === null}
                  title={uploadProductId === null ? '请先选择产品或企业通用素材' : '上传到我的素材'}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-bold text-white transition hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {uploadingMaterial ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  上传素材
                </button>
              </div>

              {materialProductFilterEnabled && (
                <div className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-black text-emerald-950">正在查看：{materialProductRef || (materialProductId ? '指定产品' : '企业通用素材')}</p>
                    <p className="mt-1 text-xs text-emerald-800">从企业知识库进入时，系统会自动带上产品筛选；上传前仍需确认本次素材归属。</p>
                  </div>
                  <button type="button" onClick={() => setMaterialProductSelection(MATERIAL_PRODUCT_ALL)} className="shrink-0 text-xs font-black text-emerald-700 hover:text-emerald-900">查看全部素材</button>
                </div>
              )}

              <div className="space-y-3 rounded-lg border border-border bg-surface p-3 sm:p-4">
                <div className="space-y-2.5">
                  <div className="relative w-full">
                    <Search size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                    <input
                      type="search"
                      value={materialSearch}
                      onChange={e => setMaterialSearch(e.target.value)}
                      aria-label="搜索我的素材"
                      placeholder="搜索素材名称、行业、场景或标签..."
                      className="h-10 w-full rounded-md border border-border bg-surface pl-10 pr-4 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent"
                    />
                  </div>
                  <div className="grid grid-cols-4 gap-2.5">
                  <label className="relative block h-10 min-w-0 rounded-md border border-border bg-surface focus-within:border-accent">
                    <Package size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                    <select value={materialProductFilterValue} onChange={event => setMaterialProductSelection(event.target.value)} aria-label="按产品筛选素材"
                      className="h-full w-full cursor-pointer appearance-none rounded-md bg-transparent pl-10 pr-9 text-sm font-bold text-text-primary outline-none">
                      <option value={MATERIAL_PRODUCT_ALL}>全部产品素材</option>
                      <option value={MATERIAL_PRODUCT_COMMON}>企业通用素材</option>
                      {materialProductRef && !materialProductId && <option value={MATERIAL_PRODUCT_LINKED_REF}>{materialProductRef}</option>}
                      {materialProductId && materialProductRef && !materialProducts.some(item => item.id === materialProductId) && <option value={materialProductId}>{materialProductRef}</option>}
                      {materialProducts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                    <ChevronDown size={15} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                  </label>
                  <label className="relative block h-10 min-w-0 rounded-md border border-border bg-surface focus-within:border-accent">
                    <Download size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                    <select value={materialSource} onChange={event => setMaterialSource(event.target.value as MaterialSourceFilter)} aria-label="素材来源"
                      className="h-full w-full cursor-pointer appearance-none rounded-md bg-transparent pl-10 pr-9 text-sm font-bold text-text-primary outline-none">
                      {Object.entries(MATERIAL_SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <ChevronDown size={15} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                  </label>
                  <label className="relative block h-10 min-w-0 rounded-md border border-border bg-surface focus-within:border-accent">
                    <Film size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                    <select value={materialType} onChange={event => setMaterialType(event.target.value as MaterialTypeFilter)} aria-label="素材类型"
                      className="h-full w-full cursor-pointer appearance-none rounded-md bg-transparent pl-10 pr-9 text-sm font-bold text-text-primary outline-none">
                      <option value="all">全部类型</option>
                      <option value="video">视频</option>
                      <option value="image">图片</option>
                      <option value="audio">音频</option>
                    </select>
                    <ChevronDown size={15} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                  </label>
                  <button type="button" onClick={() => setMaterialFiltersOpen(value => !value)} aria-expanded={materialFiltersOpen} aria-controls="material-more-filters"
                    className={`inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-md border px-2 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${materialFiltersOpen ? 'border-accent bg-accent-glow text-accent' : 'border-border text-text-secondary hover:border-accent hover:text-accent'}`}>
                    <SlidersHorizontal size={15} />更多筛选
                    {materialFilterCount > 0 && <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-black text-white">{materialFilterCount}</span>}
                    <ChevronDown size={14} className={`transition-transform ${materialFiltersOpen ? 'rotate-180' : ''}`} />
                  </button>
                  </div>
                </div>
                <AnimatePresence initial={false}>
                  {materialFiltersOpen && <motion.div id="material-more-filters" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="grid grid-cols-1 gap-3 border-t border-border pt-3 md:grid-cols-2 xl:grid-cols-4">
                      {[
                        { label: '所属行业', value: materialIndustry, onChange: (value: string) => setMaterialIndustry(value as MaterialIndustryFilter), options: Object.entries(MATERIAL_INDUSTRY_LABELS) },
                        { label: '镜头功能', value: materialFunction, onChange: setMaterialFunction, options: [['all', MATERIAL_FUNCTION_LABELS.all], ...materialFunctionOptions.map(value => [value, MATERIAL_FUNCTION_LABELS[value] || value])] },
                        { label: '适用范围', value: materialApplicability, onChange: (value: string) => setMaterialApplicability(value as MaterialApplicabilityFilter), options: Object.entries(MATERIAL_APPLICABILITY_LABELS) },
                        { label: '画面方向', value: materialOrientation, onChange: (value: string) => setMaterialOrientation(value as MaterialOrientationFilter), options: [['all', '全部方向'], ['vertical', '竖屏 9:16'], ['horizontal', '横屏 16:9']] },
                      ].map(filter => (
                        <label key={filter.label} className="relative block h-14 rounded-xl border border-border bg-surface-2 transition-colors focus-within:border-accent">
                          <Film size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                          <span className="pointer-events-none absolute left-10 top-1.5 text-[10px] font-semibold text-text-muted">{filter.label}</span>
                          <select value={filter.value} onChange={e => filter.onChange(e.target.value)} aria-label={filter.label}
                            className="h-full w-full cursor-pointer appearance-none rounded-xl bg-transparent pl-10 pr-9 pt-3 text-sm font-bold text-text-primary outline-none">
                            {filter.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select>
                          <ChevronDown size={15} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                        </label>
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-text-muted">当前显示 {filteredMaterials.length}/{localMaterials.length} 条素材</span>
                      <button type="button" onClick={clearMaterialFilters} disabled={materialFilterCount === 0}
                        className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold text-text-muted transition hover:bg-surface-2 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40">
                        <X size={13} />清除全部筛选
                      </button>
                    </div>
                  </motion.div>}
                </AnimatePresence>
                {!materialFiltersOpen && <p className="px-1 text-xs font-semibold text-text-muted">当前显示 {filteredMaterials.length}/{localMaterials.length} 条素材</p>}
              </div>

              <MaterialLibraryStatus onRetry={refreshMaterials} />
              <div className="grid grid-cols-3 gap-3 items-start lg:grid-cols-4 xl:grid-cols-5">
                {materialsLoading ? (
                  <div className="col-span-full flex items-center justify-center gap-2 py-16 text-sm text-text-muted">
                    <Loader2 size={16} className="animate-spin" /> 正在读取素材库...
                  </div>
                ) : localMaterials.length === 0 ? (
                  <div className="col-span-full rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center">
                    <Film size={30} className="mx-auto mb-3 text-text-muted opacity-50" />
                    <p className="text-sm font-bold text-text-primary">还没有本地社媒素材</p>
                    <p className="mt-1 text-xs text-text-muted">拍摄完成后上传，或从待拍摄素材池用 Seedance 2.0 生成。</p>
                  </div>
                ) : filteredMaterials.length === 0 ? (
                  <div className="col-span-full rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center">
                    <Search size={30} className="mx-auto mb-3 text-text-muted opacity-50" />
                    <p className="text-sm font-bold text-text-primary">没有符合当前标签的素材</p>
                    <button type="button" onClick={clearMaterialFilters} className="mt-2 text-xs font-bold text-accent">清空筛选条件</button>
                  </div>
                ) : filteredMaterials.map(material => (
                  <article key={material.id} className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm transition hover:border-border-bright hover:shadow-md">
                    <div className="relative aspect-[9/16] bg-surface-2">
                      {material.type === 'video' ? (
                        <>
                          {material.poster
                            // Fetch card posters immediately. These cards can stay mounted
                            // below the fold; lazy loading used to defer the request until
                            // after the short-lived signed URL had expired.
                            ? <AuthenticatedImage src={material.poster} alt={material.name} className="h-full w-full object-cover" />
                            : <video src={`${material.url}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />}
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
                    <div className="flex flex-1 flex-col p-3">
                      <p className="min-h-9 text-sm font-bold leading-snug text-text-primary line-clamp-2">{material.name}</p>
                      {(material.usage !== 'reference_only' || material.canManage) && <div className="mt-auto flex items-center gap-2 pt-3">
                        {material.usage !== 'reference_only' && <button
                          type="button"
                          onClick={() => enterMaterialSmartGeneration(material)}
                          disabled={material.type === 'audio' || (material.type === 'video' && (!Number.isFinite(material.duration) || material.duration <= 0))}
                          title={material.type === 'image' || material.duration > 0 ? '把这条素材带入内容制作' : '当前素材缺少可用时长'}
                          className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          <Sparkles size={14} />用于创作
                        </button>}
                        {material.canManage && <>
                          <button type="button" aria-label={`编辑 ${material.name}`} title="编辑" onClick={() => openManageDialog({ kind: 'material', item: material, action: 'edit' })} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-text-muted transition hover:border-accent hover:text-accent"><Pencil size={14} /></button>
                          <button type="button" aria-label={`删除 ${material.name}`} title="删除" onClick={() => openManageDialog({ kind: 'material', item: material, action: 'delete' })} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-text-muted transition hover:border-red-300 hover:text-red-600"><Trash2 size={14} /></button>
                        </>}
                      </div>}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}

          {previewMaterial?.type === 'video' && previewMaterial.url && (
            <div
              ref={previewMaterialDialogRef}
              tabIndex={-1}
              className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-6"
              role="dialog"
              aria-modal="true"
              aria-label="素材视频预览"
              onClick={() => setPreviewMaterial(null)}
            >
              <div className="w-full max-w-4xl overflow-hidden rounded-lg border border-border bg-black shadow-xl" onClick={event => event.stopPropagation()}>
                <div className="flex items-center justify-between gap-4 bg-surface px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-text-primary">{previewMaterial.name}</p>
                  </div>
                  <button type="button" data-modal-initial-focus aria-label="关闭视频预览" onClick={() => setPreviewMaterial(null)} className="rounded-md p-2 text-text-muted hover:bg-surface-2 hover:text-text-primary">
                    <X size={18} />
                  </button>
                </div>
                <video
                  key={previewMaterial.id}
                  src={previewMaterial.url}
                  poster={previewMaterial.poster}
                  controls
                  autoPlay
                  playsInline
                  preload="metadata"
                  className="max-h-[75vh] w-full bg-black object-contain"
                >
                  当前浏览器不支持视频播放。
                </video>
              </div>
            </div>
          )}

          {innerView === 'shooting' && (
            <div className="space-y-4">
              {scriptGapTasks.length > 0 && <div className="space-y-3">
                <p className="text-xs font-black text-text-secondary">脚本缺口</p>
                {scriptGapTasks.map(task => <article key={task.id} className="rounded-lg border border-amber/25 bg-amber-dim p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><span className="border-l-2 border-amber px-2 py-0.5 text-[10px] font-bold text-amber">脚本缺口</span><h3 className="mt-2 text-sm font-bold text-text-primary">{task.title}</h3><p className="mt-1 text-xs text-text-secondary">{task.shotBrief}</p><p className="mt-2 text-[11px] text-text-muted">{task.productLabel} · {task.themeTitle} · 建议 {task.suggestedDurationSec} 秒</p></div>
                    <div className="flex gap-2"><button type="button" onClick={() => requestMaterialUpload(task.id)} className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-800">上传补拍素材</button>{task.uploadedMaterialIds.length > 0 && <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('lingshu:script-gap-refill', { detail: task }))} className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white">一键回填</button>}</div>
                  </div>
                </article>)}
              </div>}
              <div className="grid gap-3 md:grid-cols-3">
                {[
                  { label: '待拍摄缺口', value: shootingNeeds.length, color: 'text-accent' },
                  { label: '高优先级', value: shootingNeeds.filter(item => item.priority === '高').length, color: 'text-red-500' },
                  { label: '已入库素材', value: localMaterials.length, color: 'text-accent' },
                ].map(item => (
                  <div key={item.label} className="card p-4">
                    <p className={`text-2xl font-bold ${item.color}`}>{item.value}</p>
                    <p className="mt-1 text-xs text-text-muted">{item.label}</p>
                  </div>
                ))}
              </div>

              {shootingNeeds.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center">
                  <Check size={30} className="mx-auto mb-3 text-accent" />
                  <p className="text-sm font-bold text-text-primary">当前没有明显待拍摄缺口</p>
                  <p className="mt-1 text-xs text-text-muted">素材库已能覆盖当前抓取视频的主要分镜。</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {shootingNeeds.map(need => (
                    <article key={need.id} className="rounded-lg border border-border bg-surface p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              need.priority === '高' ? 'bg-red/5 text-red' : need.priority === '中' ? 'bg-amber-dim text-amber' : 'bg-surface-2 text-text-muted'
                            }`}>{need.priority}优先级</span>
                            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-text-secondary">{need.ratio}</span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-text-secondary"><SocialPlatformIcon platform={need.platform} size={12} />{getPlatformMeta(need.platform).label}</span>
                          </div>
                          <h3 className="mt-2 text-sm font-bold text-text-primary">{need.title}</h3>
                          <p className="mt-1 text-xs leading-relaxed text-text-secondary">{need.suggestion}</p>
                          <p className="mt-2 text-[11px] text-text-muted">出现 {need.count} 次 · 来源：{need.sourceVideos.slice(0, 3).join(' / ')}</p>
                        </div>
                        <div className="flex flex-shrink-0 gap-2">
                          <button
                            type="button"
                            onClick={() => requestMaterialUpload()}
                            className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-text-secondary hover:text-text-primary"
                          >
                            上传已拍素材
                          </button>
                          <button
                            type="button"
                            onClick={() => void generateNeedMaterial(need)}
                            disabled={generatingNeedId === need.id}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                          >
                            {generatingNeedId === need.id ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                            {generatingNeedId === need.id ? '生成中，请勿关闭' : 'AI生成素材'}
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
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
            onExactAnalysis={() => void requestExactFullAnalysis(selectedVideo)}
            onCancelAnalysis={() => void cancelExactFullAnalysis(selectedVideo)}
            analyzing={analyzingVideoIds.includes(selectedVideo.id)}
            notice={materialMessage}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {watchVideo && <WatchModal key={watchVideo.id} video={watchVideo} onClose={() => setWatchVideo(null)} />}
      </AnimatePresence>
      <CompetitorAccountsModal
        open={showAccountsModal}
        onClose={() => setShowAccountsModal(false)}
        onCrawled={() => {
          setInnerView('inspiration');
          setSortMode('crawlTime');
          setPlatform('all');
          setSearch('');
          void refreshVideos(1, false);
        }}
      />
      {manageTarget && (
        <div ref={manageDialogRef} tabIndex={-1} className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 px-4" role="dialog" aria-modal="true" aria-labelledby="material-manage-title">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 id="material-manage-title" className="text-base font-bold text-text-primary">{manageTarget.action === 'delete' ? '删除' : '编辑'}{manageTarget.kind === 'video' ? '爆款视频' : '素材'}</h3>
              <button type="button" data-modal-initial-focus title="关闭" aria-label="关闭" onClick={() => setManageTarget(null)} disabled={manageBusy} className="rounded-md p-1.5 text-text-muted hover:bg-surface-2 hover:text-text-primary"><X size={18} /></button>
            </div>
            {manageTarget.action === 'edit' ? <>
              <label className="mt-4 block text-xs font-bold text-text-secondary">名称</label>
              <input value={manageName} onChange={event => setManageName(event.target.value)} maxLength={160} className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-accent" />
              <label className="mt-3 block text-xs font-bold text-text-secondary">标签</label>
              <input value={manageTags} onChange={event => setManageTags(event.target.value)} placeholder="用逗号分隔" className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-accent" />
              {manageTarget.kind === 'material' && <label className="mt-3 block text-xs font-bold text-text-secondary">关联产品
                <select aria-label="素材关联产品" value={manageProductId === null ? MATERIAL_PRODUCT_UNSELECTED : manageProductId || MATERIAL_PRODUCT_COMMON} onChange={event => setManageProductId(event.target.value === MATERIAL_PRODUCT_UNSELECTED ? null : event.target.value === MATERIAL_PRODUCT_COMMON ? '' : event.target.value)} className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm">
                  <option value={MATERIAL_PRODUCT_UNSELECTED}>请选择产品或企业通用</option>
                  <option value={MATERIAL_PRODUCT_COMMON}>企业通用素材</option>
                  {materialProducts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select><span className="mt-1 block font-normal text-text-muted">必须明确选择一个产品或“企业通用素材”；未确认归属的旧素材不能直接保存。</span>
              </label>}
              <p className="mt-3 text-xs text-text-muted">仅当前租户自己采集或本地上传的素材可修改；共享素材保持只读。</p>
            </> : <p className="mt-4 border-l-2 border-red bg-red/5 p-3 text-sm text-red">确认删除“{manageName}”？删除后无法恢复。</p>}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setManageTarget(null)} disabled={manageBusy} className="rounded-md border border-border px-3 py-2 text-sm font-bold text-text-secondary hover:bg-surface-2">取消</button>
              {manageTarget.action === 'delete'
                ? <button type="button" onClick={() => void deleteManagedItem()} disabled={manageBusy} className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"><Trash2 size={15} />{manageBusy ? '删除中...' : '确认删除'}</button>
                : <button type="button" onClick={() => void saveManagedItem()} disabled={manageBusy || !manageName.trim() || (manageTarget.kind === 'material' && manageProductId === null)} className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-white hover:brightness-110 disabled:opacity-50">{manageBusy ? '处理中...' : '保存'}</button>}
            </div>
          </div>
        </div>
      )}

    </main>
  );
}
