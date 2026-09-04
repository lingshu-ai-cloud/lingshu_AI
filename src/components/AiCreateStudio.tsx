import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { personIsReady, selectPerson } from '../lib/personAssetPolicy';
import { motion, AnimatePresence } from 'motion/react';
import {
  LayoutGrid, Film, FileText, Music, Image as ImageIcon, Play, Send,
  Check, ChevronLeft, ChevronRight, Folder, Search, Volume2,
  Mic, Download, Loader2, Sparkles, Wand2, Copy, RefreshCw, Clock,
  Upload, X, Plus, List, Save, FolderOpen, Trash2, Pause, ChevronDown, Heart, ExternalLink, Languages,
} from 'lucide-react';
import { studioApi, getDesktopRender, type StudioProject, type VariationBatch, type Material, type MaterialSegment, type BgmTrack, type CoverStyle, type SubCue, type TtsStyleOptions, type StudioAudioCapabilities, type FbPosterResult, type LeadContentPackageResult, type StoryboardQualityResult, type VideoGenerationVersion, type StudioScriptResult, type StudioScriptQualityStatus, type StudioScriptQualityChecks, type DigitalHumanCapabilities, type DigitalHumanJob, type DigitalHumanShotBatchVariant } from '../lib/studioApi';
import {
  isShotDigitalHumanActive,
  isShotDigitalHumanSourceCurrent,
  legacyShotDigitalHumanSignature,
  resolveShotDigitalHumanResult,
  resolveShotDigitalHumanSpeechSegment,
  shotDigitalHumanSignature,
  shotDigitalHumanSourceFingerprint,
  type ShotDigitalHumanBinding,
} from '../lib/shotDigitalHuman';
import { performancePlanFingerprint, planDigitalHumanPerformance, selectMotionClips, type AvatarMotionClip } from '../lib/digitalHumanPerformance';
import { mergeGeneratedVoiceDraft, orderedVoiceLanguages, primaryVoiceDraft, requestedVoiceDraftsReady, validProjectVoiceoverLanguages, voiceDraftLanguagesNeedingTranslation } from '../lib/voiceDraftState';
import { RENDER_AI_DISCLOSURE_PIPELINE_VERSION } from '../lib/renderAiDisclosure';
import { DIGITAL_HUMAN_PIPELINE_VERSION } from '../lib/digitalHumanPipeline';
import type { Page } from '../App';
import { completeDemoStep } from '../lib/demoProgress';
import { authHeader } from '../lib/auth';
import { useDismissibleLayer } from '../hooks/useDismissibleLayer';
import { createScriptGapTask } from '../lib/scriptGapQueue';
import {
  StudioWorkbenchFrame,
  StudioInputSummary,
  StudioStoryboardList,
  type StudioWorkbenchStep,
} from './studio/StudioWorkbenchFrame';

/* ──────────────────────────────────────────────────────────────────────────
   AI 生成内容工作台 — 社媒（流量）页子模块
   流程：创作设置 → 脚本与声音 → 成片制作
   稳定工作台：① 内容对象  ② 内容画布  ③ 步骤与属性  ④ 固定操作栏
─────────────────────────────────────────────────────────────────────────── */

const TRAFFIC_GREEN = '#16a34a';
const CANVA_VIDEO_COVER_URL = 'https://www.canva.cn/create/video-covers/';
const CANVA_COVER_RETURN_KEY = 'ow_canva_cover_return';
const CANVA_COVER_RETURN_TTL = 6 * 60 * 60 * 1000;
const PUBLISH_RETURN_PREVIEW_KEY = 'ow_publish_return_to_preview';
const STUDIO_ACTIVE_PROJECT_KEY = 'ow_studio_active_project';
const STUDIO_OPEN_PROJECT_KEY = 'ow_studio_open_project';
const PUBLISH_RETURN_PREVIEW_TTL = 2 * 60 * 60 * 1000;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const VOICE_DRAFT_TIMEOUT_MS = 30_000;

export class StudioRequestTimeoutError extends Error {
  constructor(message = '请求超时') {
    super(message);
    this.name = 'StudioRequestTimeoutError';
  }
}

export async function withStudioTimeout<T>(promise: Promise<T>, timeoutMs = VOICE_DRAFT_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new StudioRequestTimeoutError(`请求超过 ${Math.ceil(timeoutMs / 1000)} 秒，已停止等待`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function enterpriseBuyerText(roles?: string[]): string {
  return (roles || []).map(item => item.trim()).filter(Boolean).join('、');
}

type TimelineValidationItem = { type: string; url?: string; trimStart: number; trimEnd: number; speed: number; targetDuration: number };
export function validateStudioTimeline(items: TimelineValidationItem[]): string[] {
  const issues: string[] = [];
  if (!items.length) return ['没有可用素材，无法继续生成。'];
  items.forEach((item, index) => {
    if (!item.url || item.type === 'audio') issues.push(`分镜 ${index + 1} 缺少可播放画面素材。`);
    const sourceDuration = Math.max(0, item.trimEnd - item.trimStart);
    const playableDuration = sourceDuration / Math.max(0.01, item.speed || 1);
    if (sourceDuration <= 0) issues.push(`分镜 ${index + 1} 的素材入点/出点无效。`);
    if (item.targetDuration > playableDuration + 0.05) issues.push(`分镜 ${index + 1} 需要 ${item.targetDuration.toFixed(1)}s，但实际素材仅可覆盖 ${playableDuration.toFixed(1)}s。`);
  });
  return issues;
}

export function pendingClaimLocations(script: string, productInfo: string): string[] {
  const source = String(productInfo || '');
  const sourceLower = source.toLowerCase();
  const sourceComparable = sourceLower.replace(/\s+/g, ' ');
  const spokenField = /^(?:台词|字幕|口播|人物说|旁白|voiceover|vo|subtitle|caption|dialogue)\s*[：:]\s*(.+)$/i;
  const supportedByCategory = [
    { claim: /\bCE\b/i, evidence: /\bCE\b/i },
    { claim: /\bFDA\b/i, evidence: /\bFDA\b/i },
    { claim: /\bSGS\b/i, evidence: /\bSGS\b/i },
    { claim: /(?:起订|\bMOQ\b)/i, evidence: /(?:起订|最小订单|\bMOQ\b)/i },
    { claim: /(?:交期|delivery\s*(?:time|lead)|lead\s*time)/i, evidence: /(?:交期|delivery\s*(?:time|lead)|lead\s*time)/i },
    { claim: /(?:认证|certif(?:y|ied|ication))/i, evidence: /(?:认证|certif(?:y|ied|ication))/i },
    { claim: /(?:客户案例|合作案例|case\s*study)/i, evidence: /(?:客户案例|合作案例|case\s*study)/i },
    { claim: /(?:销量|sales\s*volume)/i, evidence: /(?:销量|sales\s*volume)/i },
    { claim: /(?:保证|guarantee)/i, evidence: /(?:保证|guarantee)/i },
  ];

  return script.split('\n').map(line => line.trim()).filter(line => {
    const speech = line.match(spokenField)?.[1]?.trim();
    // 环境、构图、画面、运镜等是制作指令，不是对外商业声明，不参与企业事实硬校验。
    if (!speech) return false;
    if (supportedByCategory.some(({ claim, evidence }) => claim.test(speech) && !evidence.test(source))) return true;

    // 数字交期和明确价格必须在企业资料中出现同一个值，避免凭空承诺。
    const exactClaims = [
      ...(speech.match(/\b\d+\s*(?:天|days?)\b/gi) || []),
      ...(speech.match(/(?:[$€£¥￥]\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*(?:USD|EUR|GBP|CNY|RMB))/gi) || []),
    ];
    return exactClaims.some(claim => !sourceComparable.includes(claim.toLowerCase().replace(/\s+/g, ' ')));
  }).slice(0, 4);
}

const PLAYABLE_AUDIO_BLOB_CACHE = new Map<string, string>();
const PLAYABLE_VIDEO_BLOB_CACHE = new Map<string, string>();

function isSameOriginUrl(sourceUrl: string): boolean {
  try {
    return new URL(sourceUrl, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

async function authenticatedAudioBlobUrl(sourceUrl: string): Promise<string> {
  if (/^(?:blob:|data:)/i.test(sourceUrl)) return sourceUrl;
  const cached = PLAYABLE_AUDIO_BLOB_CACHE.get(sourceUrl);
  if (cached) return cached;
  const response = await fetch(sourceUrl, { headers: authHeader(), credentials: 'same-origin' });
  if (!response.ok) throw new Error(`音频请求失败（HTTP ${response.status}）`);
  const blob = await response.blob();
  if (!blob.size) throw new Error('服务器返回了空音频');
  const contentType = String(response.headers.get('content-type') || blob.type || '').toLowerCase();
  if (contentType && !contentType.startsWith('audio/') && contentType !== 'application/octet-stream') {
    throw new Error(`服务器返回的不是音频（${contentType}）`);
  }
  const playableBlob = blob.type.startsWith('audio/') ? blob : new Blob([blob], { type: 'audio/wav' });
  const blobUrl = URL.createObjectURL(playableBlob);
  PLAYABLE_AUDIO_BLOB_CACHE.set(sourceUrl, blobUrl);
  return blobUrl;
}

async function authenticatedVideoBlobUrl(sourceUrl: string): Promise<string> {
  if (/^(?:blob:|data:)/i.test(sourceUrl)) return sourceUrl;
  const cached = PLAYABLE_VIDEO_BLOB_CACHE.get(sourceUrl);
  if (cached) return cached;
  const sameOrigin = isSameOriginUrl(sourceUrl);
  const response = await fetch(sourceUrl, sameOrigin
    ? { headers: authHeader(), credentials: 'same-origin' }
    : { credentials: 'omit' });
  if (!response.ok) throw new Error(`视频请求失败（HTTP ${response.status}）`);
  const blob = await response.blob();
  if (!blob.size) throw new Error('服务器返回了空视频');
  const contentType = String(response.headers.get('content-type') || blob.type || '').toLowerCase();
  if (contentType && !contentType.startsWith('video/') && contentType !== 'application/octet-stream') {
    throw new Error(`服务器返回的不是视频（${contentType}）`);
  }
  const playableBlob = blob.type.startsWith('video/') ? blob : new Blob([blob], { type: 'video/mp4' });
  const blobUrl = URL.createObjectURL(playableBlob);
  PLAYABLE_VIDEO_BLOB_CACHE.set(sourceUrl, blobUrl);
  return blobUrl;
}

async function playAudioWithAuthenticatedFallback(
  element: HTMLAudioElement,
  sourceUrl: string,
  volume: number,
): Promise<void> {
  const absoluteSource = new URL(sourceUrl, window.location.href).href;
  element.pause();
  if (element.src !== absoluteSource && element.dataset.sourceUrl !== sourceUrl) {
    element.src = sourceUrl;
    element.dataset.sourceUrl = sourceUrl;
    element.load();
  }
  if (element.ended || !Number.isFinite(element.currentTime)) element.currentTime = 0;
  element.volume = Math.max(0, Math.min(1, volume));
  try {
    await element.play();
  } catch {
    const blobUrl = await authenticatedAudioBlobUrl(sourceUrl);
    element.src = blobUrl;
    element.dataset.sourceUrl = sourceUrl;
    element.load();
    element.currentTime = 0;
    await element.play();
  }
}

async function playVideoWithAuthenticatedFallback(
  element: HTMLVideoElement,
  sourceUrl: string,
): Promise<string> {
  const absoluteSource = new URL(sourceUrl, window.location.href).href;
  if (element.src !== absoluteSource && element.dataset.sourceUrl !== sourceUrl) {
    element.src = sourceUrl;
    element.dataset.sourceUrl = sourceUrl;
    element.load();
  }
  try {
    await element.play();
    return sourceUrl;
  } catch {
    const blobUrl = await authenticatedVideoBlobUrl(sourceUrl);
    element.src = blobUrl;
    element.dataset.sourceUrl = sourceUrl;
    element.load();
    await element.play();
    return blobUrl;
  }
}

const mediaType = (f: File): 'video' | 'image' | 'audio' =>
  f.type.startsWith('video') ? 'video' : f.type.startsWith('audio') ? 'audio' : 'image';

const fileToDataUrl = (f: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = rej;
  r.readAsDataURL(f);
});

const blobToDataUrl = (blob: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = rej;
  r.readAsDataURL(blob);
});

const localFileName = (filePath: string) => filePath.split(/[\\/]/).pop() || filePath;

// 客户端读取媒体时长和画幅，供自动选材阻止横竖素材混剪。
const probeMedia = (f: File) => new Promise<{ duration: number; width: number; height: number }>(res => {
  if (f.type.startsWith('image')) {
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(image.src); res({ duration: 0, width: image.naturalWidth, height: image.naturalHeight }); };
    image.onerror = () => res({ duration: 0, width: 0, height: 0 });
    image.src = URL.createObjectURL(f);
    return;
  }
  if (!f.type.startsWith('video')) { res({ duration: 0, width: 0, height: 0 }); return; }
  const v = document.createElement('video');
  v.preload = 'metadata';
  v.onloadedmetadata = () => {
    URL.revokeObjectURL(v.src);
    res({ duration: Math.round(v.duration) || 0, width: v.videoWidth || 0, height: v.videoHeight || 0 });
  };
  v.onerror = () => res({ duration: 0, width: 0, height: 0 });
  v.src = URL.createObjectURL(f);
});

const probeAudioDuration = (f: File) => new Promise<number>(res => {
  if (!f.type.startsWith('audio')) { res(0); return; }
  const a = document.createElement('audio');
  a.preload = 'metadata';
  // Keep sub-second precision. Rounding 13.44s down to 13s makes the renderer
  // stop before the final spoken word has finished.
  a.onloadedmetadata = () => {
    const measured = Number.isFinite(a.duration) ? Number(a.duration.toFixed(3)) : 0;
    URL.revokeObjectURL(a.src);
    res(measured);
  };
  a.onerror = () => res(0);
  a.src = URL.createObjectURL(f);
});

const probeClipAspect = (clip: Clip) => new Promise<{ width: number; height: number }>(res => {
  const src = clip.type === 'image' ? clip.url : (clip.poster || clip.url);
  if (!src || clip.type === 'audio') { res({ width: 0, height: 0 }); return; }
  if (clip.type === 'image' || clip.poster) {
    const image = new Image();
    image.onload = () => res({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => res({ width: 0, height: 0 });
    image.src = src;
    return;
  }
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.onloadedmetadata = () => res({ width: video.videoWidth, height: video.videoHeight });
  video.onerror = () => res({ width: 0, height: 0 });
  video.src = src;
});

const materialToClip = (m: Material): Clip => ({
  id: m.id, name: m.name, folder: m.folder, type: m.type, duration: m.duration, width: m.width, height: m.height, aspectRatio: m.aspectRatio, size: m.size, url: m.url, poster: m.poster, scope: m.scope ?? 'own',
  usage: m.usage, sourceType: m.sourceType, assetRole: m.assetRole, avatarId: m.avatarId, avatarVersion: m.avatarVersion, motionClip: m.motionClip, productionReady: m.productionReady, rightsStatus: m.rightsStatus,
  industry: m.industry, shotFunction: m.shotFunction, applicability: m.applicability, tags: m.tags,
  segmentAnalysisStatus: m.segmentAnalysisStatus, segments: m.segments,
});

type StepId = 'mode' | 'material' | 'script' | 'bgm' | 'cover' | 'preview' | 'poster';

const STEPS: { id: StepId; label: string; icon: typeof LayoutGrid; hint: string }[] = [
  { id: 'mode',     label: '选模式',  icon: LayoutGrid, hint: '选择生成起点与全局参数' },
  { id: 'script',   label: '分镜与声音', icon: FileText, hint: '先确认可执行分镜，再选择口播、字幕与配音' },
  { id: 'material', label: '选素材',  icon: Film,       hint: '按脚本挑选并排序片段' },
  { id: 'cover',    label: '封面',     icon: ImageIcon,  hint: '生成封面候选并选定标题' },
  { id: 'preview',  label: '素材成片预览', icon: Play,       hint: '确认成片并进入发布' },
];

type StudioStage = {
  id: 'setup' | 'storyboard' | 'deliver';
  label: string;
  icon: typeof LayoutGrid;
  hint: string;
  steps: StepId[];
};

const VIDEO_STAGES: StudioStage[] = [
  { id: 'setup', label: '设置', icon: LayoutGrid, hint: '模式与内容', steps: ['mode'] },
  { id: 'storyboard', label: '脚本与声音', icon: FileText, hint: '口播、翻译、配音、字幕与配乐', steps: ['script'] },
  { id: 'deliver', label: '成片制作', icon: Play, hint: '素材匹配、封面与合成', steps: ['material', 'cover', 'preview'] },
];

const POSTER_STAGES: StudioStage[] = [
  { id: 'setup', label: '设置', icon: LayoutGrid, hint: '模式与内容', steps: ['mode'] },
  { id: 'storyboard', label: '制作', icon: ImageIcon, hint: '选择图文素材', steps: ['material'] },
  { id: 'deliver', label: '完成', icon: Sparkles, hint: '预览与发布', steps: ['poster'] },
];

type VideoThemeId = 'buyer_pain' | 'product_proof' | 'use_case' | 'supplier_capability' | 'customization' | 'comparison' | 'customer_case' | 'trend';
type PresenterMode = 'real' | 'digital';
type VideoTheme = {
  id: VideoThemeId;
  title: string;
  description: string;
  /** Legacy metadata; no longer displayed or used to decide CTA. */
  painPoint: string;
  conversionGoal: string;
  requires: Array<'product' | 'material' | 'factory' | 'comparison' | 'case' | 'trend'>;
};

const DEFAULT_VIDEO_CONVERSION_GOAL = '引导跳转WhatsApp以触达';

const VIDEO_THEMES: VideoTheme[] = [
  { id: 'buyer_pain', title: '买家痛点', description: '从采购顾虑或使用难题切入，再用产品证据回答。', painPoint: '买家难以快速判断产品是否适合自己的市场与采购需求', conversionGoal: '私信说明目标市场与需求', requires: ['product'] },
  { id: 'product_proof', title: '产品实证', description: '用规格、包装、细节和真实素材建立判断依据。', painPoint: '仅凭产品主图无法确认实物、规格和包装细节', conversionGoal: '索取完整产品资料', requires: ['product', 'material'] },
  { id: 'use_case', title: '使用场景', description: '围绕一个具体场景展示产品如何被使用或呈现。', painPoint: '买家看不出产品在真实场景中的使用方式', conversionGoal: '咨询适用方案', requires: ['material'] },
  { id: 'supplier_capability', title: '供应能力', description: '用工厂、质检、产能或交付证据降低供应风险。', painPoint: '买家担心批量供货、质量稳定性和交付可靠性', conversionGoal: '提交数量并确认供应方案', requires: ['factory'] },
  { id: 'customization', title: '定制能力', description: '展示已确认的包装、品牌或规格定制能力。', painPoint: '买家不确定产品能否适配自己的品牌和渠道', conversionGoal: '发送定制需求', requires: ['product'] },
  { id: 'comparison', title: '选型对比', description: '按统一维度比较不同产品或方案，帮助买家选型。', painPoint: '相似产品看起来接近，买家难以判断适用差异', conversionGoal: '说明需求并获取选型建议', requires: ['comparison'] },
  { id: 'customer_case', title: '客户案例', description: '用已授权的客户问题、过程和结果建立信任。', painPoint: '买家缺少相似客户的合作与落地参考', conversionGoal: '索取相关案例资料', requires: ['case'] },
  { id: 'trend', title: '趋势热点', description: '用有来源的市场变化切入，再连接到企业产品证据。', painPoint: '买家需要判断当前趋势是否值得进入或备货', conversionGoal: '获取趋势对应的产品方案', requires: ['trend'] },
];

function inferVideoThemeFromMaterial(material: Pick<Material, 'name' | 'folder' | 'shotFunction' | 'tags' | 'segments'>): VideoThemeId {
  const segmentText = (material.segments || []).flatMap(segment => [
    segment.action, segment.environment, segment.shot, ...segment.subject, ...segment.recommendedFunctions,
  ]).join(' ');
  const text = [material.name, material.folder, material.shotFunction, material.tags, segmentText].filter(Boolean).join(' ').toLowerCase();
  if (/对比|比较|选型|差异|before.?after|comparison|versus|\bvs\b/.test(text)) return 'comparison';
  if (/客户案例|合作案例|案例结果|反馈|testimonial|customer.?case|case.?study/.test(text)) return 'customer_case';
  if (/趋势|热点|热销|爆款|trend|viral|hot.?selling/.test(text)) return 'trend';
  if (/工厂|产线|生产|质检|仓库|物流|交付|设备|factory|production|quality.?control|warehouse|logistics/.test(text)) return 'supplier_capability';
  if (/定制|包装|彩盒|贴牌|logo|品牌|custom|oem|odm|packaging|branding/.test(text)) return 'customization';
  if (/使用|涂抹|体验|操作|场景|护理|application|usage|lifestyle|treatment/.test(text)) return 'use_case';
  if (/产品|质地|细节|成分|特写|展示|product|texture|ingredient|detail|close.?up/.test(text)) return 'product_proof';
  return 'buyer_pain';
}
const POSTER_STEPS: { id: StepId; label: string; icon: typeof LayoutGrid; hint: string }[] = [
  { id: 'mode',     label: '选模式',   icon: LayoutGrid, hint: '确认图文生成渠道、平台和产品' },
  { id: 'material', label: '选产品/素材', icon: ImageIcon,  hint: '确认产品并选择产品图、工厂图、包装图和证书图' },
  { id: 'poster',   label: '图文生成', icon: Sparkles,   hint: '一次生成海报图、配文和承接话术' },
];
const COVER_STEP_INDEX = STEPS.findIndex(s => s.id === 'cover');

interface CanvaCoverReturnState {
  at: number;
  stepId: StepId;
  projectId: string | null;
  projectTitle: string;
  coverUrl: string | null;
  spec: Record<string, unknown>;
}

interface CoverVersionConfig {
  coverId: string;
  title: string;
  style: CoverStyle;
  coverUrl?: string | null;
}

interface MaterialFolder { id: string; name: string; count: number }
const FOLDERS: MaterialFolder[] = [
  { id: 'recommend', name: '当前选择', count: 0 },
  { id: 'all',     name: '全部素材',   count: 0 },
  { id: 'hot',     name: '爆款素材',   count: 0 },
  { id: 'upload',  name: '本地素材',   count: 0 },
  { id: 'presenter', name: '真人口播', count: 0 },
  { id: 'product', name: '产品主图',   count: 0 },
  { id: 'factory', name: '工厂实拍',   count: 0 },
  { id: 'scene',   name: '使用场景',   count: 0 },
  { id: 'model',   name: '模特出镜',   count: 0 },
  { id: 'detail',  name: '细节特写',   count: 0 },
];
const POSTER_FOLDERS: MaterialFolder[] = [
  { id: 'recommend', name: '素材推荐', count: 0 },
  { id: 'all', name: '全部图文素材', count: 0 },
  { id: 'hot', name: '爆款图文参考', count: 0 },
  { id: 'upload', name: '我的上传', count: 0 },
  { id: 'product', name: '产品主图', count: 0 },
  { id: 'factory', name: '工厂实拍', count: 0 },
  { id: 'packaging', name: '包装定制', count: 0 },
  { id: 'certificate', name: '证书资质', count: 0 },
  { id: 'scene', name: '使用场景', count: 0 },
  { id: 'brand', name: '品牌视觉', count: 0 },
];
const POSTER_MATERIAL_GROUPS = [
  { id: 'product', title: '产品主图', desc: '瓶身/包装/套装/产品矩阵，建议 1-4 张', folders: ['product'] },
  { id: 'factory', title: '工厂背书', desc: '产线、灌装、质检、仓储、团队实拍', folders: ['factory'] },
  { id: 'proof', title: '包装/证书', desc: '私标包装、认证证书、检测报告、资质墙', folders: ['packaging', 'certificate'] },
  { id: 'scene', title: '场景/品牌', desc: '使用场景、成分氛围、品牌色和 Logo 参考', folders: ['scene', 'brand'] },
  { id: 'hot', title: '爆款参考', desc: '仅用于拆解画风、结构、CTA，不直接复制承诺', folders: ['hot'] },
] as const;

interface Clip {
  id: string;
  name: string;
  folder: string;
  type: 'video' | 'image' | 'audio';
  duration: number; // seconds
  width?: number;
  height?: number;
  aspectRatio?: number;
  size: string;
  url?: string;     // 真实素材的可访问地址；缺少时只展示“预览不可用”状态。
  poster?: string;  // 封面帧画面（视频抽帧 / 图片自身）
  scope?: 'shared' | 'own'; // 公共库 / 我的（缺省按 own）
  usage?: 'editable' | 'reference_only';
  sourceType?: string;
  assetRole?: Material['assetRole'];
  avatarId?: string;
  avatarVersion?: number;
  motionClip?: Material['motionClip'];
  productionReady?: boolean;
  rightsStatus?: Material['rightsStatus'];
  providerBindings?: Material['providerBindings'];
  personSetup?: Material['personSetup'];
  cloudPersonReady?: boolean;
  industry?: string;
  shotFunction?: string;
  applicability?: string;
  tags?: string;
  segmentAnalysisStatus?: 'pending' | 'analyzing' | 'completed' | 'failed';
  segments?: MaterialSegment[];
}

interface ClipEdit {
  trimStart: number;
  trimEnd: number;
  trimRangeEdited?: boolean;
  speed: number;
  targetDuration?: number;
  targetDurationEdited?: boolean;
  transition: string;
  note: string;
}

function mergeClipLists(primary: Clip[], fallback: Clip[]): Clip[] {
  const byId = new Map<string, Clip>();
  for (const item of fallback) byId.set(item.id, item);
  for (const item of primary) {
    const existing = byId.get(item.id);
    byId.set(item.id, existing
      ? {
          ...existing,
          ...item,
          url: item.url || existing.url,
          poster: item.poster || existing.poster,
          segments: item.segments?.length ? item.segments : existing.segments,
        }
      : item);
  }
  return Array.from(byId.values());
}

interface StoryboardSlot {
  id: string;
  time: string;
  start: number;
  end: number;
  title: string;
  detail: string;
}
type StoryboardSourceMode = 'auto' | 'online' | 'local' | 'ai' | 'hybrid';
type VariationStrategy = 'remix' | 'recreate' | 'hybrid';
interface StoryboardSourcePlan {
  mode: StoryboardSourceMode;
  decided?: boolean;
  confirmed: boolean;
  critical: boolean;
  referenceClipId?: string;
  generatedClipId?: string;
  error?: string;
  quality?: StoryboardQualityResult;
  qualityError?: string;
  matchScore?: number;
  matchReason?: string;
  matchDifference?: string;
  matchLevel?: 'direct' | 'review' | 'missing';
}
interface StoryboardAssembly {
  id: string;
  name: string;
  assignments: Record<string, string>;
  sourcePlans: Record<string, StoryboardSourcePlan>;
  selected: string[];
}

type StudioPublishPlatform = 'youtube' | 'tiktok' | 'instagram' | 'facebook';
export type StudioWorkflowContext = { runId: string; taskId: string; taskKey?: string; preview?: boolean };

export function studioWorkflowContextFromSpec(spec: Record<string, unknown>): StudioWorkflowContext | null {
  const runId = typeof spec.workflowRunId === 'string' ? spec.workflowRunId.trim() : '';
  const taskId = typeof spec.workflowTaskId === 'string' ? spec.workflowTaskId.trim() : '';
  if (!runId || !taskId) return null;
  return {
    runId,
    taskId,
    taskKey: typeof spec.workflowTaskKey === 'string' ? spec.workflowTaskKey.trim() : '',
  };
}

export function resolveStudioWorkflowProjectEntry(
  projects: StudioProject[],
  context: StudioWorkflowContext,
): { projects: StudioProject[]; project: StudioProject | null; openList: boolean } {
  const matches = projects.filter(project => {
    const projectContext = studioWorkflowContextFromSpec(project.spec);
    return projectContext?.runId === context.runId && projectContext.taskId === context.taskId;
  });
  return {
    projects: matches,
    project: matches.length === 1 ? matches[0] : null,
    openList: matches.length !== 1,
  };
}

/**
 * Silent autosave may update a persisted project, but it must not manufacture
 * an empty project merely because Studio is mounted in the background.
 * Enterprise defaults (product, audience, tone, platform) are intentionally
 * not sufficient: they are loaded without a user or worker creating content.
 */
export function studioSpecHasMeaningfulContent(spec: Record<string, unknown>): boolean {
  const hasText = (key: string) => typeof spec[key] === 'string' && Boolean(String(spec[key]).trim());
  const hasArray = (key: string) => Array.isArray(spec[key]) && (spec[key] as unknown[]).length > 0;
  const hasObject = (key: string) => Boolean(
    spec[key] && typeof spec[key] === 'object' && Object.keys(spec[key] as Record<string, unknown>).length > 0,
  );
  return [
    'script', 'caption', 'posterJsonText', 'posterImageUrl', 'voiceoverUrl', 'coverTitle',
  ].some(hasText)
    || ['selected', 'materialSnapshots', 'modeScripts', 'productVideoVersions'].some(hasArray)
    || ['videoKickoff', 'posterDraft', 'languageRenderOutputs', 'storyboardVideoVersions'].some(hasObject);
}

function withoutStudioWorkflowContext(spec: Record<string, unknown>): Record<string, unknown> {
  const next = { ...spec };
  delete next.workflowRunId;
  delete next.workflowTaskId;
  delete next.workflowTaskKey;
  return next;
}

type StudioPublishItem = {
  videoPath?: string;
  previewUrl?: string;
  title: string;
  description: string;
  ratio: string;
  sourceProjectId?: string;
  platform?: StudioPublishPlatform;
  workflowRunId?: string;
  workflowTaskId?: string;
  workflowTaskKey?: string;
};
type StudioPublishPayload = StudioPublishItem & { items?: StudioPublishItem[] };

type LanguageRenderOutput = {
  status: 'pending' | 'rendering' | 'done' | 'failed';
  inputSignature?: string;
  path?: string;
  previewUrl?: string;
  error?: string;
};

type LanguageRenderGeneration = {
  id: string;
  versionNumber: number;
  status: 'done' | 'failed';
  inputSignature?: string;
  path?: string;
  previewUrl?: string;
  error?: string;
  createdAt: string;
};

const renderCombinationKey = (planId: string, language: string, bgmId: string) =>
  `${encodeURIComponent(planId)}::${encodeURIComponent(language)}::${encodeURIComponent(bgmId || 'none')}`;
const materialVersionKey = (planId: string, language: string) =>
  `${encodeURIComponent(planId)}::${encodeURIComponent(language)}`;

const clipSourceMode = (clip: Clip): Extract<StoryboardSourceMode, 'online' | 'local' | 'ai'> => {
  const marker = `${clip.sourceType || ''} ${clip.id} ${clip.name} ${clip.size} ${clip.url || ''}`.toLowerCase();
  if (/\b(ai|gemini|seedance|jimeng|即梦|生成)\b/.test(marker)) return 'ai';
  if (clip.scope === 'shared') return 'online';
  return 'local';
};
const CLIPS: Clip[] = [];

const ratioNumber = (value: string) => {
  const [w, h] = String(value || '9:16').split(':').map(Number);
  return w > 0 && h > 0 ? w / h : 9 / 16;
};
const clipAspectRatio = (clip: Clip) => clip.aspectRatio || (clip.width && clip.height ? clip.width / clip.height : 0);
const isClipCompatibleWithRatio = (clip: Clip, targetRatio: string) => {
  const actual = clipAspectRatio(clip);
  if (!actual) return true; // 旧素材无元数据时保留，最终渲染仍会裁切兜底。
  const orientation = (n: number) => n > 1.12 ? 'landscape' : n < 0.89 ? 'portrait' : 'square';
  return orientation(actual) === orientation(ratioNumber(targetRatio));
};
const clipRatioPreferenceScore = (clip: Clip, targetRatio?: string) => {
  if (!targetRatio || !clipAspectRatio(clip)) return 0;
  return isClipCompatibleWithRatio(clip, targetRatio) ? 14 : -4;
};

interface Bgm { id: string; name: string; mood: string; duration: number; url?: string; recommended?: boolean; scope?: 'shared' | 'tenant'; uploadedBy?: string }
// 已移除内置曲库（生成质量不达标）；仅展示用户自行上传的音乐
const BGMS: Bgm[] = [];
const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const fmtTime = (s: number) => `0:${String(Math.round(s)).padStart(2, '0')}`;

function pickMaterialClipsLocally(pool: Clip[], targetDuration: number, preferredIds: string[] = [], targetCount?: number) {
  const folderWeight: Record<string, number> = {
    presenter: 9,
    product: 8,
    detail: 7,
    scene: 6,
    factory: 5,
    model: 4,
    upload: 3,
  };
  const preferred = new Set(preferredIds);
  const ordered = [...pool].sort((a, b) => {
    const preferredDelta = Number(preferred.has(b.id)) - Number(preferred.has(a.id));
    if (preferredDelta) return preferredDelta;
    const typeDelta = Number(b.type === 'video') - Number(a.type === 'video');
    if (typeDelta) return typeDelta;
    const folderDelta = (folderWeight[b.folder] || 0) - (folderWeight[a.folder] || 0);
    if (folderDelta) return folderDelta;
    const aDur = effectiveClipDuration(a);
    const bDur = effectiveClipDuration(b);
    return Math.abs(aDur - targetDuration / 4) - Math.abs(bDur - targetDuration / 4);
  });
  const desiredCount = Math.max(1, Math.min(targetCount || 6, ordered.length || pool.length || 1));
  const picked: string[] = [];
  let total = 0;
  for (const clip of ordered) {
    if (picked.length >= desiredCount || (!targetCount && total >= targetDuration - 0.75)) break;
    picked.push(clip.id);
    total += effectiveClipDuration(clip);
  }
  return {
    selectedIds: picked.length ? picked : pool.slice(0, desiredCount).map(clip => clip.id),
    reason: targetCount
      ? `按 ${targetCount} 个分镜匹配素材候选`
      : preferredIds.length ? '沿用已选素材并补齐镜头顺序' : '按真人/产品/细节/场景和目标时长快速排序',
  };
}

export function matchMaterialsToStoryboardLocally(
  pool: Clip[],
  slots: StoryboardSlot[],
  preferredIds: string[] = [],
  options: { variantIndex?: number; previousAssignments?: Array<Record<string, string>>; targetRatio?: string } = {},
) {
  const preferred = new Set(preferredIds);
  const unused = new Set(pool.map(clip => clip.id));
  const variantIndex = Math.max(0, options.variantIndex || 0);
  const previousAssignments = options.previousAssignments || [];
  const globalUsage = new Map<string, number>();
  previousAssignments.forEach(plan => Object.values(plan).forEach(clipId => {
    globalUsage.set(clipId, (globalUsage.get(clipId) || 0) + 1);
  }));
  const previousMaterialIds = new Set(globalUsage.keys());
  const availableFreshCount = pool.filter(clip => !previousMaterialIds.has(clip.id)).length;
  // A/B 流量测试要求“组合本身”有差异，而不只是把同一组素材换个顺序。
  // 素材充足时，每个新版本至少 60% 使用此前方案未出现过的素材。
  const minimumFreshCount = previousAssignments.length
    ? Math.min(Math.ceil(slots.length * 0.6), availableFreshCount)
    : 0;
  let freshAssignedCount = 0;
  const variantTieBreak = (value: string) => {
    let hash = 2166136261 ^ (variantIndex + 1);
    for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    return ((hash >>> 0) % 1000) / 1000;
  };
  const folderKeywords: Record<string, RegExp> = {
    presenter: /人物|主播|口播|出镜|真人|presenter|host|talking/i,
    detail: /开场|钩子|细节|特写|质地|滴落|材质|纹理|hook|detail|close.?up|texture/i,
    product: /产品|外观|瓶身|结构|展示|样品|product|packshot|sample/i,
    scene: /使用|场景|体验|操作|应用|代入|use|scene|lifestyle|application/i,
    model: /模特|上脸|试用|穿戴|效果|model|try.?on|beauty/i,
    factory: /工厂|生产|产线|供应|交付|实力|仓库|factory|production|supply|warehouse/i,
    packaging: /包装|彩盒|logo|定制|品牌|packaging|custom|branding/i,
    certificate: /证书|认证|检测|资质|ce|rohs|certificate|test report/i,
  };
  const assignments: Record<string, string> = {};

  slots.forEach((slot, slotIndex) => {
    const slotText = `${slot.title} ${slot.detail}`.toLowerCase();
    const targetDuration = Math.max(0.5, slot.end - slot.start);
    const remainingSlots = slots.length - slotIndex;
    const freshStillNeeded = Math.max(0, minimumFreshCount - freshAssignedCount);
    const uniquePool = unused.size ? pool.filter(clip => unused.has(clip.id)) : pool;
    const freshUniquePool = uniquePool.filter(clip => !previousMaterialIds.has(clip.id));
    const mustChooseFresh = freshStillNeeded >= remainingSlots && freshUniquePool.length > 0;
    const eligiblePool = mustChooseFresh ? freshUniquePool : uniquePool;
    const openingRoleOrder = [
      ['detail', 'product', 'presenter'],
      ['presenter', 'model', 'scene'],
      ['product', 'detail', 'scene'],
    ][variantIndex % 3] || ['detail', 'product', 'presenter'];
    const candidates = eligiblePool.map(clip => {
      const clipText = `${clip.name} ${clip.folder} ${clip.industry || ''} ${clip.shotFunction || ''} ${clip.applicability || ''} ${clip.tags || ''}`.toLowerCase();
      let score = 0;
      if (unused.has(clip.id)) score += 18;
      if (preferred.has(clip.id)) score += 7;
      if (clip.type === 'video') score += 5;
      // 横竖方向只作为排序偏好，不作为硬拦截；渲染器会统一居中裁切。
      score += clipRatioPreferenceScore(clip, options.targetRatio);
      if (folderKeywords[clip.folder]?.test(slotText)) score += 28;
      const slotTerms = slotText.match(/[\u4e00-\u9fff]{2,4}|[a-z]{3,}/gi) || [];
      score += Math.min(24, slotTerms.filter(term => clipText.includes(term.toLowerCase())).length * 6);
      score += Math.max(0, 12 - Math.abs(effectiveClipDuration(clip) - targetDuration) * 2);
      if (slotIndex === 0 && (clip.folder === 'detail' || clip.folder === 'product' || clip.folder === 'presenter')) score += 8;
      if (slotIndex === 0 && openingRoleOrder.includes(clip.folder)) score += Math.max(4, 14 - openingRoleOrder.indexOf(clip.folder) * 4);
      if (slotIndex === slots.length - 1 && (clip.folder === 'product' || clip.folder === 'factory' || clip.folder === 'packaging')) score += 6;
      // 先保证分镜语义，再让新方案使用真正不同的素材集合。
      const sameSlotUsage = previousAssignments.filter(plan => plan[slot.id] === clip.id).length;
      const priorUsage = globalUsage.get(clip.id) || 0;
      score -= sameSlotUsage * 55;
      score -= priorUsage * 18;
      if (previousAssignments.length && priorUsage === 0) score += 34;
      if (slotIndex === 0 && previousAssignments.length && priorUsage === 0) score += 20;
      score += variantTieBreak(`${slot.id}:${clip.id}`) * 8;
      return { clip, score };
    }).sort((a, b) => b.score - a.score);
    const chosen = candidates[0]?.clip;
    if (!chosen) return;
    assignments[slot.id] = chosen.id;
    unused.delete(chosen.id);
    if (!previousMaterialIds.has(chosen.id)) freshAssignedCount += 1;
  });
  return assignments;
}

function effectiveClipDuration(clip: Clip): number {
  if (clip.type === 'image') return 3;
  const usefulSegments = (clip.segments || []).filter(segment =>
    segment.duration >= 0.5
    && segment.quality >= 55
    && segment.confidence >= 0.5
    && (!segment.needsReview || segment.manualConfirmed),
  );
  if (usefulSegments.length) {
    return +Math.max(1.5, Math.min(12, usefulSegments.reduce((sum, segment) => sum + segment.duration, 0))).toFixed(1);
  }
  const roleCap: Record<string, number> = {
    detail: 4.5,
    product: 5,
    model: 5,
    scene: 5,
    factory: 6,
    presenter: 8,
    packaging: 4,
    certificate: 3.5,
  };
  return +Math.max(1.5, Math.min(clip.duration || 3, roleCap[clip.folder] || 5)).toFixed(1);
}

export function automaticStoryboardTrim(sourceDuration: number, storyboardDuration: number, mediaType: 'video' | 'image' = 'video') {
  const targetDuration = Math.max(0.5, Number(storyboardDuration) || 0.5);
  const availableDuration = mediaType === 'image'
    ? targetDuration
    : Math.max(0.5, Number(sourceDuration) || targetDuration);
  return {
    trimStart: 0,
    trimEnd: Math.min(availableDuration, targetDuration),
    targetDuration,
  };
}

type MaterialMatchAssessment = {
  score: number;
  level: 'direct' | 'review' | 'missing';
  reason: string;
  difference: string;
};

function assessMaterialMatch(slot: StoryboardSlot, clip: Clip, targetRatio: string): MaterialMatchAssessment {
  const slotText = `${slot.title} ${slot.detail}`.toLowerCase();
  const segmentText = (clip.segments || []).flatMap(segment => [
    segment.action, segment.environment, segment.shot, ...segment.subject, ...segment.recommendedFunctions,
  ]).join(' ');
  const clipText = `${clip.name} ${clip.folder} ${clip.industry || ''} ${clip.shotFunction || ''} ${clip.applicability || ''} ${clip.tags || ''} ${segmentText}`.toLowerCase();
  const terms = [...new Set(slotText.match(/[\u4e00-\u9fff]{2,4}|[a-z]{3,}/gi) || [])]
    .filter(term => !/^(画面|镜头|字幕|台词|素材|全景|中景|近景|特写|scene|shot|visual|camera)$/i.test(term));
  const overlap = terms.filter(term => clipText.includes(term.toLowerCase())).length;
  const rolePatterns: Record<string, RegExp> = {
    presenter: /人物|主播|口播|出镜|presenter|host|talking/i,
    detail: /细节|特写|材质|纹理|detail|close.?up|texture/i,
    product: /产品|外观|展示|样品|product|packshot|sample/i,
    scene: /使用|场景|体验|操作|application|usage|scene/i,
    factory: /工厂|产线|生产|供应|交付|factory|production|supply/i,
    packaging: /包装|彩盒|logo|定制|packaging|branding/i,
    certificate: /证书|认证|检测|资质|certificate|test report/i,
  };
  const roleMatched = Boolean(rolePatterns[clip.folder]?.test(slotText));
  const semantic = Math.min(40, 8 + overlap * 7 + (roleMatched ? 18 : 0));
  const needsProof = /证书|认证|检测|参数|logo|工厂|产线|质检|certificate|factory|inspection|product close/i.test(slotText);
  const proofFolder = /^(certificate|factory|packaging|product|detail)$/.test(clip.folder);
  const factual = needsProof ? (proofFolder && (roleMatched || overlap > 0) ? 25 : 3) : 25;
  const hasActionEvidence = Boolean((clip.segments || []).some(segment => segment.duration >= 0.5 && segment.confidence >= 0.5))
    || Boolean(clip.shotFunction || clip.applicability);
  const action = Math.min(15, 5 + (hasActionEvidence ? 5 : 0) + (overlap > 0 ? 5 : 0));
  const targetDuration = Math.max(0.5, slot.end - slot.start);
  const durationDelta = Math.abs(effectiveClipDuration(clip) - targetDuration);
  const durationScore = Math.max(2, Math.round(10 - durationDelta * 2));
  const ratioCompatible = isClipCompatibleWithRatio(clip, targetRatio);
  const presentation = (clip.url || clip.poster ? 5 : 1) + (ratioCompatible ? 5 : 1);
  const score = Math.max(0, Math.min(100, semantic + factual + action + durationScore + presentation));
  const level = score >= 80 ? 'direct' : score >= 60 ? 'review' : 'missing';
  const reason = roleMatched
    ? '镜头功能与分镜需求一致'
    : overlap > 0 ? `匹配 ${overlap} 个分镜关键词` : '仅时长和画幅基本适配';
  const differences = [
    !roleMatched && overlap === 0 ? '主体/动作语义偏差' : '',
    needsProof && !proofFolder ? '不能作为事实证据' : '',
    !ratioCompatible ? '画幅不同，需留边或裁切' : '',
    durationDelta > 2 ? '可用时长与分镜差距较大' : '',
  ].filter(Boolean);
  return { score, level, reason, difference: differences.join('；') || '无明显差异' };
}

// 句子切分（中英日通用：按句末标点 / 换行）
const splitSentences = (text: string): string[] =>
  text.replace(/\s+/g, ' ').split(/(?<=[.!?。！？…])\s+/).map(s => s.trim()).filter(Boolean);

const parsePronunciationRules = (text: string) => String(text || '').split('\n').map(line => {
  const [word, ...rest] = line.split(/[=＝]/);
  return { word: String(word || '').trim(), pronunciation: rest.join('=').trim() };
}).filter(item => item.word && item.pronunciation).slice(0, 20);

const subtitleCharLimit = (text: string) => /[\u4e00-\u9fff]/.test(text) ? 18 : 42;

function splitLongSubtitle(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const limit = subtitleCharLimit(normalized);
  if (normalized.length <= limit) return [normalized];

  const clauses = normalized
    .split(/(?<=[,，;；、:：.!?。！？…])\s*/)
    .map(item => item.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  const pushCurrent = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const clause of clauses.length > 1 ? clauses : [normalized]) {
    if ((current + clause).length <= limit) {
      current = current ? `${current} ${clause}` : clause;
      continue;
    }
    pushCurrent();
    if (clause.length <= limit) {
      current = clause;
      continue;
    }
    const words = clause.includes(' ') ? clause.split(/\s+/) : clause.match(new RegExp(`.{1,${limit}}`, 'g')) || [];
    for (const word of words) {
      if ((current ? `${current} ${word}` : word).length <= limit) {
        current = current ? `${current} ${word}` : word;
      } else {
        pushCurrent();
        current = word;
      }
    }
  }
  pushCurrent();
  return chunks;
}

// 把一段文本在 [start,end] 区间内按字数比例分配成多条单行 cue
function distribute(text: string, start: number, end: number): SubCue[] {
  const safeStart = Math.max(0, Number(start) || 0);
  const safeEnd = Math.max(safeStart + 0.3, Number(end) || safeStart + 0.3);
  const sents = splitSentences(text).flatMap(splitLongSubtitle);
  const total = sents.reduce((n, s) => n + Math.max(1, s.length), 0) || 1;
  let t = safeStart;
  return sents.map(s => {
    const dur = (safeEnd - safeStart) * (Math.max(1, s.length) / total);
    const cue = { start: +t.toFixed(2), end: +(t + dur).toFixed(2), text: s.replace(/\n+/g, ' ') };
    t += dur;
    return cue;
  });
}

function parseCueRange(value: string): { start: number; end: number } | null {
  const match = String(value || '').match(/(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?/i);
  if (!match) return null;
  const start = Number(match[1]);
  const rawEnd = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(rawEnd)) return null;
  return { start: Math.max(0, start), end: Math.max(start + 0.3, rawEnd) };
}

function normalizeCueTimeline(cues: SubCue[], totalDur: number): SubCue[] {
  const clean = cues
    .map(cue => ({
      ...cue,
      start: Math.max(0, Number(cue.start) || 0),
      end: Math.max(Math.max(0, Number(cue.start) || 0) + 0.25, Number(cue.end) || 0),
      text: String(cue.text || '').replace(/\s+/g, ' ').trim(),
    }))
    .filter(cue => cue.text);
  if (!clean.length) return [];
  let cursor = 0;
  const monotonic = clean.map(cue => {
    const start = Math.max(cursor, cue.start);
    const end = Math.max(start + 0.25, cue.end, cursor + 0.25);
    cursor = end;
    return { ...cue, start, end };
  });
  const sourceEnd = Math.max(...monotonic.map(cue => cue.end));
  const targetEnd = Math.max(0, Number(totalDur) || 0);
  const scale = targetEnd > 0 && sourceEnd > 0 && Math.abs(targetEnd - sourceEnd) > 0.8
    ? targetEnd / sourceEnd
    : 1;
  return monotonic.map(cue => ({
    ...cue,
    start: +(cue.start * scale).toFixed(2),
    end: +Math.max(cue.start * scale + 0.25, cue.end * scale).toFixed(2),
  }));
}

/* 由口播脚本生成字幕 cue（A 层兜底对齐：优先脚本时间标记，否则按 TTS 时长字数比例；
   桌面端 ASR 回传逐词时间戳后会替换为精确对齐——共用同一 SubCue 结构）。 */
function buildCues(script: string, totalDur: number): SubCue[] {
  const timestamped = parseTimestampedVoiceover(script).filter(item => !isNonSpeechSfx(item.text));
  if (timestamped.length) {
    const cues = timestamped.flatMap(item => {
      const range = parseCueRange(item.time);
      return range ? distribute(item.text, range.start, range.end) : [];
    });
    if (cues.length) return normalizeCueTimeline(cues, totalDur);
  }

  const lines = script.split('\n');
  if (hasStoryboardFieldLabels(lines)) return [];
  // 形如 [Hook · 0-3s] / [Body · 3-15s] 的时间段标记
  const headerRe = /\[([^\]]*?\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:s|秒)?[^\]]*)\]/i;
  const sections: { start: number; end: number; text: string }[] = [];
  let cur: { start: number; end: number; text: string } | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(headerRe);
    if (m) {
      const range = parseCueRange(m[1] || '');
      if (range) {
        cur = { start: range.start, end: range.end, text: line.replace(m[0], '').trim() };
        sections.push(cur);
      }
    } else if (line && cur) {
      cur.text += (cur.text ? ' ' : '') + line.replace(/^\[.*?\]\s*/, '');
    }
  }
  if (sections.length && sections.some(s => s.text)) {
    return normalizeCueTimeline(sections.filter(s => s.text).flatMap(s => distribute(s.text, s.start, s.end)), totalDur);
  }
  // 无时间标记：清掉所有方括号标记后整体按时长分配
  const clean = script.replace(/\[[^\]]*\]/g, ' ').trim();
  return clean ? normalizeCueTimeline(distribute(clean, 0, totalDur || 20), totalDur || 20) : [];
}

function subtitleTimestamp(seconds: number, vtt = false): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hh = Math.floor(ms / 3_600_000);
  const mm = Math.floor((ms % 3_600_000) / 60_000);
  const ss = Math.floor((ms % 60_000) / 1000);
  const mmm = ms % 1000;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}${vtt ? '.' : ','}${String(mmm).padStart(3, '0')}`;
}

function subtitleFile(cues: SubCue[], format: 'srt' | 'vtt'): string {
  const body = cues.map((cue, index) => `${index + 1}\n${subtitleTimestamp(cue.start, format === 'vtt')} --> ${subtitleTimestamp(cue.end, format === 'vtt')}\n${cue.text}\n`).join('\n');
  return format === 'vtt' ? `WEBVTT\n\n${body}` : body;
}

function downloadSubtitleFile(cues: SubCue[], format: 'srt' | 'vtt', language: string): void {
  const blob = new Blob([subtitleFile(cues, format)], { type: format === 'vtt' ? 'text/vtt;charset=utf-8' : 'application/x-subrip;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `lingshu-${language || 'voiceover'}.${format}`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderSafeCues(cues: SubCue[], maxDuration: number): SubCue[] {
  const limit = Math.max(0, Number(maxDuration) || 0);
  let cursor = 0;
  return cues
    .map(cue => {
      const start = Math.max(cursor, Number(cue.start) || 0);
      const end = limit > 0
        ? Math.min(limit, Math.max(start + 0.25, Number(cue.end) || 0))
        : Math.max(start + 0.25, Number(cue.end) || 0);
      cursor = end;
      return { ...cue, start: +start.toFixed(3), end: +end.toFixed(3), text: String(cue.text || '').trim() };
    })
    .filter(cue => cue.text && cue.end > cue.start && (limit <= 0 || cue.start < limit));
}

function parseTimeRangeLabel(value: string): { label: string; start: number; end: number } | null {
  // Gemini occasionally emits the first range as `[start-4.5s]` instead of
  // `[0-4.5s]`. Treat `start`/`开始` as zero so the first storyboard is not
  // dropped and the following shot is not incorrectly promoted to slot 1.
  const normalized = value
    .replace(/秒/g, 's')
    .replace(/\bstart\b|开始/gi, '0');
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*s?\s*[-–]\s*(\d+(?:\.\d+)?)\s*s?/i);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const safeEnd = Math.max(start + 0.5, end);
  return { label: `${start.toFixed(1)}s-${safeEnd.toFixed(1)}s`, start, end: safeEnd };
}

function parseStoryboardSlots(value: string, totalDuration: number): StoryboardSlot[] {
  const lines = String(value || '').split('\n');
  const slots: StoryboardSlot[] = [];
  let current: { range: { label: string; start: number; end: number }; lines: string[] } | null = null;
  const push = () => {
    if (!current) return;
    const joined = current.lines.join(' ').replace(/\s+/g, ' ').trim();
    const title = joined.match(/(?:景别|Shot)\s*[：:]\s*([^；;。]+)/i)?.[1]
      || joined.match(/(?:画面|Visual)\s*[：:]\s*([^；;。]+)/i)?.[1]
      || joined.split(/[；;。]/)[0]
      || '分镜';
    slots.push({
      id: `slot-${slots.length + 1}`,
      time: current.range.label,
      start: current.range.start,
      end: current.range.end,
      title: title.trim().slice(0, 24),
      detail: joined || '按当前时间戳放入对应素材',
    });
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const bracket = line.match(/\[([^\]]*?(?:(?:start|开始)|\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:s|秒)?[^\]]*)\]/i);
    const scene = line.match(/Scene\s+\d+\s*\(([^)]*?\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:s|秒)?[^)]*)\)/i);
    const inline = !bracket && !scene ? parseTimeRangeLabel(line) : null;
    const range = bracket ? parseTimeRangeLabel(bracket[1]) : scene ? parseTimeRangeLabel(scene[1]) : inline;
    if (range) {
      push();
      current = { range, lines: [line.replace(bracket?.[0] || scene?.[0] || '', '').trim()].filter(Boolean) };
    } else if (current) {
      current.lines.push(line);
    }
  }
  push();

  if (slots.length) return slots.slice(0, 12);
  // 没有真实时间戳脚本时不伪造等分分镜，选材页明确显示“暂无分镜”。
  return [];
}

/** Keep every storyboard shot, but make each language version end with its real voiceover. */
export function fitTimelineToVoiceover<T extends {
  trimStart?: number;
  trimEnd?: number;
  speed?: number;
  targetStart?: number;
  targetEnd?: number;
  targetDuration: number;
}>(timeline: T[], voiceoverDuration: number): T[] {
  const sourceDuration = timeline.reduce((sum, item) => sum + Math.max(0, Number(item.targetDuration) || 0), 0);
  if (!timeline.length || !Number.isFinite(voiceoverDuration) || voiceoverDuration <= 0 || sourceDuration <= 0) return timeline;
  const minimumShotDuration = Math.min(0.5, voiceoverDuration / timeline.length);
  const scale = voiceoverDuration / sourceDuration;
  let cursor = 0;
  return timeline.map((item, index) => {
    const isLast = index === timeline.length - 1;
    const remainingShots = timeline.length - index - 1;
    const remainingRoom = Math.max(minimumShotDuration, voiceoverDuration - cursor - remainingShots * minimumShotDuration);
    const targetDuration = isLast
      ? Math.max(minimumShotDuration, voiceoverDuration - cursor)
      : Math.min(remainingRoom, Math.max(minimumShotDuration, item.targetDuration * scale));
    const targetStart = cursor;
    cursor += targetDuration;
    const sourceClipDuration = Math.max(0, (Number(item.trimEnd) || 0) - (Number(item.trimStart) || 0));
    return {
      ...item,
      targetStart: +targetStart.toFixed(3),
      targetEnd: +(isLast ? voiceoverDuration : cursor).toFixed(3),
      targetDuration: +targetDuration.toFixed(3),
      speed: sourceClipDuration > 0 ? Math.max(0.25, Math.min(4, sourceClipDuration / targetDuration)) : item.speed,
    };
  });
}

export function fitStoryboardSlotsToDuration(slots: StoryboardSlot[], duration: number): StoryboardSlot[] {
  const sourceDuration = slots.reduce((max, slot) => Math.max(max, slot.end), 0);
  if (!slots.length || !Number.isFinite(duration) || duration <= 0 || sourceDuration <= 0) return slots;
  const scale = duration / sourceDuration;
  return slots.map((slot, index) => {
    const start = index === 0 ? 0 : slot.start * scale;
    const end = index === slots.length - 1 ? duration : slot.end * scale;
    return { ...slot, start: +start.toFixed(3), end: +end.toFixed(3), time: `${start.toFixed(1)}s-${end.toFixed(1)}s` };
  });
}

function storyboardSlotScript(detail: string) {
  const text = String(detail || '').replace(/\s+/g, ' ').trim();
  const labels = '环境|景别|运镜|镜头功能|画面|Visual|人物说|台词|Voiceover|VO|口播|字幕|Caption|配乐|真实性要求|可见事实|表达意图|未展示因果|Omni提示词|Omni禁止项';
  const pick = (field: string) => text.match(new RegExp(`(?:${field})\\s*[：:]\\s*[“\"]?(.+?)[”\"]?(?=\\s+(?:${labels})\\s*[：:]|$)`, 'i'))?.[1]?.trim() || '';
  const visual = pick('画面|Visual');
  const voice = pick('人物说|台词|Voiceover|VO|口播').replace(/^“|”$/g, '');
  const subtitle = pick('字幕|Caption');
  return {
    visual,
    voice,
    subtitle,
    fallback: text.replace(/^\[[^\]]+\]\s*/, '').slice(0, 180),
  };
}

// 封面字体（系统字体栈，预览与 SVG 一致）
const COVER_FONTS: { id: CoverStyle['font']; label: string; css: string }[] = [
  { id: 'sans',    label: '黑体', css: `'PingFang SC','Microsoft YaHei',ui-sans-serif,sans-serif` },
  { id: 'impact',  label: '粗黑', css: `'Arial Black',Impact,'Heiti SC','Microsoft YaHei',sans-serif` },
  { id: 'serif',   label: '衬线', css: `Georgia,'Songti SC','SimSun',serif` },
  { id: 'rounded', label: '圆润', css: `'Arial Rounded MT Bold','PingFang SC','Microsoft YaHei',sans-serif` },
  { id: 'mono',    label: '等宽', css: `ui-monospace,Menlo,Consolas,monospace` },
];
const fontCss = (id: CoverStyle['font']) => COVER_FONTS.find(f => f.id === id)?.css ?? COVER_FONTS[0].css;

interface Voice { id: string; name: string; tag: string }
// 音色与语言解耦：名称只描述性别 + 音色，实际发音语言跟随所选目标语言
const VOICES: Voice[] = [
  { id: 'v1', name: 'Emma（女声 · 柔美）', tag: '亲和' },
  { id: 'v2', name: 'James（男声 · 沉稳）', tag: '浑厚' },
  { id: 'v3', name: 'Sara（女声 · 温暖）',  tag: '治愈' },
];

const TTS_PRESETS: Array<{ id: TtsStyleOptions['preset']; label: string; emotion: string; intensity: number; speed: number }> = [
  { id: 'tiktok_excited', label: 'TikTok 激动种草', emotion: '兴奋惊喜', intensity: 90, speed: 1.12 },
  { id: 'authentic_review', label: '真实体验分享', emotion: '自然可信', intensity: 68, speed: 1 },
  { id: 'professional_b2b', label: '外贸专业介绍', emotion: '专业笃定', intensity: 48, speed: 0.94 },
  { id: 'warm_story', label: '温柔故事感', emotion: '温暖治愈', intensity: 60, speed: 0.9 },
  { id: 'urgent_cta', label: '紧迫转化 CTA', emotion: '紧迫有力', intensity: 82, speed: 1.08 },
];

type LanguageTtsSettings = {
  voiceId?: string;
  volume?: number;
  preset: TtsStyleOptions['preset'];
  emotion: string;
  emotionIntensity: number;
  speed: number;
  pauseStyle: 'few' | 'natural' | 'dramatic';
  pronunciationText: string;
};

const DEFAULT_TTS_SETTINGS: LanguageTtsSettings = {
  volume: 1,
  preset: 'authentic_review',
  emotion: '自然可信',
  emotionIntensity: 68,
  speed: 1,
  pauseStyle: 'natural',
  pronunciationText: 'MOQ=M O Q\nOEM=O E M\nODM=O D M',
};

const COVERS = [
  { id: 'cv1', title: 'You NEED this in 2026', accent: '#16a34a' },
  { id: 'cv2', title: 'Factory price, 24h ship', accent: '#16a34a' },
  { id: 'cv3', title: 'Why everyone is obsessed', accent: '#c13584' },
];

interface SocialAccount { id: string; platform: string; handle: string; color: string }
const ACCOUNTS: SocialAccount[] = [
  { id: 'a1', platform: 'TikTok',    handle: '@yiwu_home',     color: '#010101' },
  { id: 'a2', platform: 'Instagram', handle: '@yiwu.official', color: '#c13584' },
  { id: 'a3', platform: 'YouTube',   handle: 'Yiwu Trading',   color: '#ff0000' },
];

type ModeCard = { id: 'material' | 'clone' | 'product'; icon: typeof Film; title: string; desc: string };
const MODES: ModeCard[] = [
  { id: 'material', icon: Film,    title: '使用素材', desc: '先选真实素材，脚本只写画面真正能承接的内容' },
  { id: 'clone',    icon: Wand2,   title: '参考爆款', desc: '拆解参考片的钩子与节奏，再换成企业真实内容' },
  { id: 'product',  icon: Sparkles,title: '使用产品生成', desc: '先用产品事实生成内容方案，再补齐画面素材' },
] as const;
const POSTER_MODES: ModeCard[] = [
  { id: 'material', icon: Film,    title: '使用素材', desc: '编辑素材库中的图片内容' },
  { id: 'clone',    icon: Wand2,   title: '参考爆款', desc: '参考版式，用企业内容重制' },
  { id: 'product',  icon: Sparkles,title: '使用产品生成', desc: '从产品资料自动开始创作' },
] as const;
const POSTER_STYLES = [
  { id: 'oem-factory', label: 'OEM 工厂风' },
  { id: 'promo', label: '促销招商风' },
  { id: 'holiday', label: '节日营销风' },
  { id: 'premium', label: '高端品牌风' },
] as const;

const VIDEO_MODE_DRAFT_TITLES: Record<ModeCard['id'], string> = {
  material: '素材库智能生成',
  clone: '爆款裂变',
  product: '产品信息生成',
};
const draftTitleForMode = (mode: ModeCard['id'], sourceTitle = '') =>
  `${VIDEO_MODE_DRAFT_TITLES[mode]}${sourceTitle.trim() ? ` · ${sourceTitle.trim()}` : ''}`;

export type StudioScriptGenerationValidation = {
  ok: boolean;
  code?: 'language_required' | 'product_required' | 'material_required' | 'reference_required' | 'duration_invalid';
  message?: string;
};

export function validateStudioScriptGenerationInput(input: {
  mode: ModeCard['id'];
  language: string;
  productInfo: string;
  productLabel: string;
  selectedMaterialCount: number;
  hasReferenceAnalysis: boolean;
  duration: number;
}): StudioScriptGenerationValidation {
  if (!input.language.trim()) return { ok: false, code: 'language_required', message: '企业中心尚未配置首选输出语言或主要业务语言，请先完成语言配置。' };
  if (!Number.isFinite(input.duration) || input.duration <= 0) return { ok: false, code: 'duration_invalid', message: '请先设置大于 0 秒的成片时长。' };
  if (!input.productInfo.trim() || !input.productLabel.trim()) return { ok: false, code: 'product_required', message: '请先在第一步选择企业中心产品，再生成脚本。' };
  if (input.mode === 'material' && input.selectedMaterialCount <= 0) return { ok: false, code: 'material_required', message: '请先明确选择本次要使用的真实视频或图片，脚本才会按画面生成。' };
  if (input.mode === 'clone' && !input.hasReferenceAnalysis) return { ok: false, code: 'reference_required', message: '当前草稿缺少真实对标逐镜分析，请返回灵感中心完成全片分析后再生成。' };
  return { ok: true };
}

export function studioAgentSourceLabel(source?: string): string {
  const normalized = String(source || '').trim();
  if (normalized === 'inspiration_analysis') return '社媒内容 Agent · 爆款视频分析';
  if (normalized === 'inspiration_image_post') return '社媒内容 Agent · 爆款图文分析';
  if (normalized === 'material_library' || normalized === 'material_segment_analysis') return '社媒内容 Agent · 素材库';
  if (normalized === 'seedance_video') return '社媒内容 Agent · AI 视频生成';
  if (normalized === 'agent_memory' || normalized === 'content_memory_recommendation') return '数字员工 · 内容策略任务';
  return normalized ? `Agent 任务 · ${normalized}` : '人工进入内容工作台';
}
const RATIOS = ['9:16', '1:1', '16:9'];
const POSTER_RATIOS = ['1:1', '4:5'];
const LANGS = [
  { code: 'en',    label: 'English - 英语' },
  { code: 'zh',    label: '简体中文 - 中文' },
  { code: 'es',    label: 'Español - 西班牙语' },
  { code: 'fr',    label: 'Français - 法语' },
  { code: 'de',    label: 'Deutsch - 德语' },
  { code: 'pt',    label: 'Português - 葡萄牙语' },
  { code: 'it',    label: 'Italiano - 意大利语' },
  { code: 'ru',    label: 'Русский - 俄语' },
  { code: 'ja',    label: '日本語 - 日语' },
  { code: 'ko',    label: '한국어 - 韩语' },
  { code: 'ar',    label: 'العربية - 阿拉伯语' },
  { code: 'hi',    label: 'हिन्दी - 印地语' },
  { code: 'id',    label: 'Bahasa Indonesia - 印尼语' },
  { code: 'th',    label: 'ภาษาไทย - 泰语' },
  { code: 'vi',    label: 'Tiếng Việt - 越南语' },
  { code: 'tr',    label: 'Türkçe - 土耳其语' },
  { code: 'nl',    label: 'Nederlands - 荷兰语' },
  { code: 'pl',    label: 'Polski - 波兰语' },
  { code: 'sv',    label: 'Svenska - 瑞典语' },
  { code: 'fil',   label: 'Filipino - 菲律宾语' },
  { code: 'ms',    label: 'Bahasa Melayu - 马来语' },
  { code: 'uk',    label: 'Українська - 乌克兰语' },
  { code: 'el',    label: 'Ελληνικά - 希腊语' },
  { code: 'cs',    label: 'Čeština - 捷克语' },
  { code: 'ro',    label: 'Română - 罗马尼亚语' },
  { code: 'hu',    label: 'Magyar - 匈牙利语' },
];
// 取语言的中文名（label 形如 "Deutsch - 德语" → "德语"）
const langZh = (code: string) => {
  const label = LANGS.find(l => l.code === code)?.label ?? '';
  return label.split(' - ')[1] ?? label;
};
const digitalHumanLanguageKey = (slotId: string, language: string) => `${language}::${slotId}`;
export function storyboardAssignmentIdForMode(
  slotId: string,
  language: string,
  assignments: Record<string, string>,
  mediaModes: Record<string, 'material' | 'digital'>,
): string | undefined {
  return mediaModes[slotId] === 'digital'
    ? assignments[digitalHumanLanguageKey(slotId, language)]
    : assignments[slotId];
}
const parseDigitalHumanLanguageKey = (key: string) => {
  const separator = key.indexOf('::');
  return separator > 0 ? { language: key.slice(0, separator), slotId: key.slice(separator + 2) } : { language: '', slotId: key };
};

function filterRecordByLanguage<T>(record: Record<string, T>, codes: string[]): Record<string, T> {
  if (!codes.length) return {};
  return Object.fromEntries(codes
    .filter(code => Object.prototype.hasOwnProperty.call(record, code))
    .map(code => [code, record[code]!]));
}

function detectScriptLanguageCode(value: string): string {
  const text = String(value || '').replace(/\[[^\]]+\]/g, '').trim();
  if (!text) return 'zh';
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';
  if (/[\u0600-\u06ff]/.test(text)) return 'ar';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  return 'en';
}

function cleanTimestampNumber(value: string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return number.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function normalizeScriptTimestamps(value: string): string {
  return String(value || '').replace(
    /\[\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–—]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*\]/gi,
    (_match, start, end) => `[${cleanTimestampNumber(start)}-${cleanTimestampNumber(end)}s]`,
  );
}

const LANG_ALIASES: Record<string, string> = {
  英语: 'en', english: 'en', en: 'en',
  中文: 'zh', 简体中文: 'zh', chinese: 'zh', zh: 'zh',
  西语: 'es', 西班牙语: 'es', spanish: 'es', es: 'es',
  法语: 'fr', french: 'fr', fr: 'fr',
  德语: 'de', german: 'de', de: 'de',
  葡语: 'pt', 葡萄牙语: 'pt', portuguese: 'pt', pt: 'pt',
  意大利语: 'it', italian: 'it', it: 'it',
  俄语: 'ru', russian: 'ru', ru: 'ru',
  日语: 'ja', japanese: 'ja', ja: 'ja',
  韩语: 'ko', korean: 'ko', ko: 'ko',
  阿语: 'ar', 阿拉伯语: 'ar', arabic: 'ar', ar: 'ar',
  印地语: 'hi', hindi: 'hi', hi: 'hi',
  印尼语: 'id', 印度尼西亚语: 'id', indonesian: 'id', id: 'id',
  泰语: 'th', thai: 'th', th: 'th',
  越南语: 'vi', vietnamese: 'vi', vi: 'vi',
  土耳其语: 'tr', turkish: 'tr', tr: 'tr',
  荷兰语: 'nl', dutch: 'nl', nl: 'nl',
  波兰语: 'pl', polish: 'pl', pl: 'pl',
};

function languageTextToCode(text = '') {
  const first = text.split(/[、,，/|;；\s]+/).map(s => s.trim()).find(Boolean) ?? '';
  const normalized = first.toLowerCase();
  return LANG_ALIASES[first] ?? LANG_ALIASES[normalized] ?? 'en';
}

function enterpriseLanguageCodes(text = ''): string[] {
  return [...new Set(text
    .split(/[、,，/|;；\n]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => LANG_ALIASES[item] ?? LANG_ALIASES[item.toLowerCase()] ?? '')
    .filter(code => code && LANGS.some(language => language.code === code)))];
}

interface EnterpriseProfileLite {
  company?: { industry?: string; mainMarkets?: string; primaryLanguages?: string };
  products?: {
    categories?: string;
    priceRange?: string;
    moq?: string;
    certifications?: string;
    highlights?: string;
    items?: Array<{
      sku?: string;
      name?: string;
      category?: string;
      priceRange?: string;
      moq?: string;
      certifications?: string;
      highlights?: string;
      images?: Array<{ name?: string; url?: string }>;
      factoryImages?: Array<{ name?: string; url?: string }>;
      packagingImages?: Array<{ name?: string; url?: string }>;
      certificateImages?: Array<{ name?: string; url?: string }>;
      sceneImages?: Array<{ name?: string; url?: string }>;
      brandAssets?: Array<{ name?: string; url?: string }>;
    }>;
  };
  brand?: { tone?: string; usp?: string; preferredLanguages?: string };
  strategy?: { focusProducts?: string; focusMarkets?: string };
  customers?: { targetProfiles?: string };
  socialStrategy?: { enabledRoutes?: Array<'oem_odm' | 'wholesale_distribution' | 'consumer_retail'>; routeStrategies?: Record<string, { targetBuyerRoles?: string[]; primaryCta?: string }> };
}

interface VideoKickoff {
  source?: 'inspiration_analysis' | 'inspiration_image_post' | 'seedance_video' | string;
  script?: string;
  scriptType?: 'voiceover' | 'storyboard';
  language?: string;
  productInfo?: string;
  actionContext?: { source?: string; recommendation?: string; workflowRunId?: string; workflowTaskId?: string };
  referenceAnalysis?: {
    title?: string;
    visualStyle?: string;
    coreEmotion?: string;
    details?: { time: string; environment?: string; shot: string; camera: string; visual: string; subtitle?: string; audio?: string; note?: string; purpose?: string; dialogue?: string; onScreenText?: string; ambientSound?: string; bgm?: string; soundEffects?: string[]; beats?: Array<{ time?: string; action?: string; dialogue?: string; onScreenText?: string }>; persistentState?: string; authenticity?: string; confidence?: number; needsReview?: boolean }[];
  };
  generatedVideo?: {
    id?: string;
    title?: string;
    url?: string;
    poster?: string;
    duration?: number;
    createdAt?: string;
    material?: Material;
    width?: number;
    height?: number;
    aspectRatio?: number;
  };
  materialRole?: 'hook';
  video?: {
    title?: string;
    platform?: string;
    contentFormat?: 'video' | 'image';
    videoUrl?: string;
    thumbnail?: string;
    duration?: number;
    width?: number;
    height?: number;
    aspectRatio?: number;
    sourceUrl?: string;
    aiAnalysis?: {
      materialUrl?: string;
      materialPoster?: string;
      imageEvidence?: {
        version?: number;
        status?: string;
        observedFacts?: Array<Record<string, unknown>>;
        carouselFlow?: Array<Record<string, unknown>>;
        copyEvidence?: Record<string, unknown>;
        reusableModules?: Array<Record<string, unknown>>;
        uncertainties?: string[];
      };
    };
  };
}

function normalizedSourceToken(value?: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, window.location.origin);
    url.search = '';
    url.hash = '';
    return `${url.origin}${url.pathname}`.replace(/\/$/, '').toLowerCase();
  } catch {
    return raw.split(/[?#]/, 1)[0]!.replace(/\/$/, '').toLowerCase();
  }
}

function kickoffSourceTokens(kickoff: VideoKickoff | null): string[] {
  if (!kickoff) return [];
  const values = [
    kickoff.generatedVideo?.id,
    kickoff.generatedVideo?.material?.id,
    kickoff.video?.sourceUrl,
    kickoff.video?.videoUrl,
    kickoff.video?.aiAnalysis?.materialUrl,
    kickoff.generatedVideo?.url,
  ];
  return [...new Set(values.map(normalizedSourceToken).filter(Boolean))];
}

function projectMatchesKickoff(project: StudioProject, kickoff: VideoKickoff): boolean {
  const savedKickoff = project.spec?.videoKickoff as VideoKickoff | undefined;
  if (!savedKickoff) return false;
  const incomingTokens = kickoffSourceTokens(kickoff);
  const savedTokens = new Set(kickoffSourceTokens(savedKickoff));
  if (incomingTokens.some(token => savedTokens.has(token))) return true;
  if (incomingTokens.length || savedTokens.size) return false;
  return Boolean(
    kickoff.source
    && kickoff.source === savedKickoff.source
    && kickoff.video?.title
    && kickoff.video.title.trim() === savedKickoff.video?.title?.trim()
    && kickoff.video?.platform === savedKickoff.video?.platform,
  );
}

interface ExistingSourceDraftPrompt {
  project: StudioProject;
  matchCount: number;
  title: string;
  poster: string;
}

function normalizeClipSnapshot(value: unknown): Clip | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<Clip>;
  if (!item.id || typeof item.id !== 'string') return null;
  const type = item.type === 'image' || item.type === 'audio' || item.type === 'video' ? item.type : 'video';
  const url = typeof item.url === 'string' ? item.url : '';
  const poster = typeof item.poster === 'string' ? item.poster : '';
  if (!url && !poster) return null;
  return {
    id: item.id,
    name: typeof item.name === 'string' && item.name.trim() ? item.name : '历史作品集素材',
    folder: typeof item.folder === 'string' && item.folder.trim() ? item.folder : 'upload',
    type,
    duration: Number(item.duration) || 0,
    width: Number(item.width) || undefined,
    height: Number(item.height) || undefined,
    aspectRatio: Number(item.aspectRatio) || undefined,
    size: typeof item.size === 'string' && item.size.trim() ? item.size : '作品集快照',
    url,
    poster,
    scope: item.scope === 'shared' ? 'shared' : 'own',
    usage: item.usage,
    sourceType: typeof item.sourceType === 'string' && item.sourceType.trim() ? item.sourceType : 'project-snapshot',
    assetRole: item.assetRole,
    avatarId: item.avatarId,
    avatarVersion: item.avatarVersion,
    industry: item.industry,
    shotFunction: item.shotFunction,
    applicability: item.applicability,
    tags: item.tags,
    segmentAnalysisStatus: item.segmentAnalysisStatus,
    segments: item.segments,
  };
}

function kickoffClipSnapshot(kickoff: VideoKickoff | null): Clip | null {
  if (!kickoff) return null;
  if (kickoff.generatedVideo?.material) {
    return normalizeClipSnapshot({ ...materialToClip(kickoff.generatedVideo.material), sourceType: 'historical-kickoff' });
  }
  const url = kickoff.generatedVideo?.url || kickoff.video?.aiAnalysis?.materialUrl || kickoff.video?.videoUrl || '';
  const poster = kickoff.generatedVideo?.poster || kickoff.video?.aiAnalysis?.materialPoster || kickoff.video?.thumbnail || '';
  if (!url && !poster) return null;
  return normalizeClipSnapshot({
    id: kickoff.generatedVideo?.id || `historical-kickoff-${url || poster || kickoff.video?.title || 'video'}`,
    name: kickoff.generatedVideo?.title || kickoff.video?.title || '历史对标视频',
    folder: kickoff.source === 'material_library' ? 'hot' : 'upload',
    type: kickoff.video?.contentFormat === 'image' ? 'image' : 'video',
    duration: kickoff.generatedVideo?.duration || kickoff.video?.duration || 0,
    size: '历史作品集',
    url,
    poster,
    scope: 'own',
    sourceType: 'historical-kickoff',
  });
}

const LEAD_PACKAGE_ROLE_LABELS: Record<string, string> = {
  buyer_attention: '第 1 组 · 吸引目标买家',
  capability_explanation: '第 2 组 · 解释合作能力',
  supplier_trust: '第 3 组 · 建立供应商信任',
};

function LeadContentPackagePreview({ value, imageUrl }: { value: LeadContentPackageResult; imageUrl?: string }) {
  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold text-emerald-900">三组获客内容包</p>
          <button type="button" onClick={() => navigator.clipboard?.writeText(JSON.stringify(value, null, 2))} className="text-xs font-bold text-emerald-700">复制全部</button>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-emerald-800">{value.strategySummary || '按买家注意、合作能力、供应商信任依次发布，形成连续承接。'}</p>
      </div>
      {imageUrl && (
        <div className="overflow-hidden rounded-xl border border-border bg-white">
          <div className="border-b border-border px-3 py-2 text-[11px] font-bold text-text-secondary">第 1 组首图预览</div>
          <img src={imageUrl} alt="获客内容包首图预览" className="max-h-[520px] w-full object-contain" />
        </div>
      )}
      <div className="grid gap-3 xl:grid-cols-3">
        {value.items.map((item, itemIndex) => (
          <article key={`${item.role}-${itemIndex}`} className="rounded-xl border border-border bg-surface-2 p-3">
            <p className="text-[10px] font-bold text-accent">{LEAD_PACKAGE_ROLE_LABELS[item.role] || item.role}</p>
            <h4 className="mt-1 text-sm font-bold text-text-primary">{item.title}</h4>
            <p className="mt-1 text-[11px] leading-relaxed text-text-muted">目标：{item.objective}</p>
            <div className="mt-3 space-y-2">
              {item.slides.map((slide, slideIndex) => (
                <div key={`${slide.index}-${slideIndex}`} className="rounded-lg border border-border/70 bg-white p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-black text-accent">{slide.index || slideIndex + 1}</span>
                    <span className="text-[9px] text-text-muted">{slide.assetRole}</span>
                  </div>
                  <p className="mt-1 text-[11px] font-bold text-text-primary">{slide.headline}</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-text-secondary">{slide.body}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 border-t border-border pt-3 text-[10px] leading-relaxed text-text-secondary">
              <p><span className="font-bold text-text-primary">CTA：</span>{item.cta}</p>
              <p className="mt-1"><span className="font-bold text-text-primary">私信开场：</span>{item.dmOpening}</p>
            </div>
          </article>
        ))}
      </div>
      {value.referenceModulesUsed.length > 0 && (
        <div className="rounded-xl border border-border bg-surface-2 p-3">
          <p className="text-xs font-bold text-text-primary">从对标图文保留的通用元素</p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {value.referenceModulesUsed.map((module, index) => (
              <div key={`${module.module}-${index}`} className="rounded-lg bg-white p-2 text-[10px] leading-relaxed text-text-secondary">
                <p className="font-bold text-text-primary">{module.module}</p>
                <p className="mt-1">证据：{module.evidence}</p>
                <p className="mt-1 text-text-muted">套用：{module.application}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {value.fieldsToConfirm.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          生成图片或发布前需补充确认：{value.fieldsToConfirm.join('、')}
        </div>
      )}
    </div>
  );
}

function BenchmarkVideoPreview({ kickoff, embedded = false }: { kickoff: VideoKickoff | null; embedded?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playRequestRef = useRef(0);
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState('');
  const video = kickoff?.video;
  const declaredAspectRatio = Number(video?.aspectRatio || kickoff?.generatedVideo?.aspectRatio)
    || (video?.width && video?.height ? video.width / video.height : 0)
    || (kickoff?.generatedVideo?.width && kickoff?.generatedVideo?.height ? kickoff.generatedVideo.width / kickoff.generatedVideo.height : 0);
  const [mediaAspectRatio, setMediaAspectRatio] = useState(declaredAspectRatio || 9 / 16);
  const isImageReference = video?.contentFormat === 'image';
  const poster = video?.thumbnail || video?.aiAnalysis?.materialPoster || kickoff?.generatedVideo?.poster || '';
  const rawUrl = video?.videoUrl || video?.aiAnalysis?.materialUrl || kickoff?.generatedVideo?.url || '';
  const apiUrl = rawUrl.replace(/\/media(?=\?|$)/, '/media-url');

  useEffect(() => {
    playRequestRef.current += 1;
    const element = videoRef.current;
    if (element) {
      element.pause();
      element.removeAttribute('src');
      delete element.dataset.sourceUrl;
      element.load();
    }
    setPlaybackUrl('');
    setPlaying(false);
    setPlaybackError('');
    setMediaAspectRatio(declaredAspectRatio || 9 / 16);
  }, [apiUrl]);
  const ensurePlaybackUrl = async () => {
    if (playbackUrl) return playbackUrl;
    if (!apiUrl) return '';
    if (!apiUrl.includes('/api/overseas/videos/')) {
      setPlaybackUrl(apiUrl);
      return apiUrl;
    }
    if (loading) return '';
    setLoading(true);
    try {
      const response = await fetch(apiUrl, { headers: authHeader(), credentials: 'same-origin' });
      if (!response.ok) return '';
      const next = String(((await response.json()) as { url?: string }).url || '');
      setPlaybackUrl(next);
      return next;
    } finally {
      setLoading(false);
    }
  };
  const play = async () => {
    const requestId = ++playRequestRef.current;
    setPlaybackError('');
    const url = await ensurePlaybackUrl();
    if (requestId !== playRequestRef.current) return;
    if (!url) {
      setPlaybackError('视频文件暂不可用，可点击右上角“原站”查看');
      return;
    }
    const element = videoRef.current;
    if (!element) return;
    try {
      const usedUrl = await playVideoWithAuthenticatedFallback(element, url);
      if (requestId !== playRequestRef.current) return;
      if (usedUrl !== playbackUrl) setPlaybackUrl(usedUrl);
      setPlaybackError('');
      setPlaying(true);
    } catch (error: unknown) {
      if (requestId !== playRequestRef.current) return;
      setPlaying(false);
      const message = error instanceof Error ? error.message : String(error || '');
      if (error instanceof DOMException && error.name === 'AbortError' && /interrupted by a new load/i.test(message)) return;
      setPlaybackError(message ? `视频加载失败：${message}` : '视频加载或解码失败，可点击右上角“原站”查看');
    }
  };
  const pause = () => {
    if (!videoRef.current) return;
    videoRef.current.pause();
    setPlaying(false);
  };
  const togglePlayback = () => {
    if (videoRef.current && !videoRef.current.paused) pause();
    else void play();
  };

  if (embedded) {
    return (
      <div className="relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-black">
        {video?.sourceUrl && (
          <a
            href={video.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-md bg-black/55 px-2 py-1 text-[10px] font-bold text-white backdrop-blur"
          >
            原站 <ExternalLink size={11} />
          </a>
        )}
        {!video ? (
          <div className="flex flex-col items-center justify-center px-8 text-center text-white/65">
            <Film size={28} className="opacity-50" />
            <p className="mt-3 text-xs font-bold">尚未载入对标内容</p>
          </div>
        ) : isImageReference ? (
          poster
            ? <img src={poster} alt="竞品图文首图" className="h-full w-full object-contain" />
            : <ImageIcon size={32} className="text-white/35" />
        ) : (
          <div className="group relative flex h-full w-full cursor-pointer items-center justify-center overflow-hidden bg-black" onClick={togglePlayback}>
            <video
              ref={videoRef}
              poster={poster || undefined}
              muted
              playsInline
              loop
              preload="metadata"
              className="h-full w-full object-contain"
              onLoadedMetadata={event => {
                const element = event.currentTarget;
                if (element.videoWidth > 0 && element.videoHeight > 0) setMediaAspectRatio(element.videoWidth / element.videoHeight);
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onError={() => {
                setPlaying(false);
                setPlaybackError('视频加载或解码失败，可点击右上角“原站”查看');
              }}
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/10 transition group-hover:bg-transparent">
              {!playing && <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur"><Play size={18} fill="currentColor" /></span>}
            </div>
            {loading && <span className="absolute right-3 top-3 rounded-md bg-black/55 px-2 py-1 text-[9px] text-white">加载中…</span>}
            {playbackError && <span className="absolute inset-x-3 bottom-3 rounded-md bg-black/70 px-3 py-2 text-center text-[10px] leading-4 text-white">{playbackError}</span>}
          </div>
        )}
      </div>
    );
  }

  return (
    <aside className="sticky top-0 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-black text-text-primary">{isImageReference ? '对标图文' : '对标视频'}</p>
          <p className="mt-0.5 truncate text-[10px] text-text-muted">{video?.platform || '尚未载入'} · {isImageReference ? '完整轮播证据' : '悬浮播放'}</p>
        </div>
        {video?.sourceUrl && <a href={video.sourceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] font-bold text-accent">原站 <ExternalLink size={11} /></a>}
      </div>
      {video ? (
        <div className="p-4">
          {isImageReference ? (
            <div className="relative mx-auto aspect-[4/5] max-h-[600px] overflow-hidden rounded-xl bg-surface-2">
              {poster ? <img src={poster} alt="竞品图文首图" className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center text-text-muted"><ImageIcon size={28} className="opacity-35" /></div>}
              <span className="absolute left-2 top-2 rounded-md bg-black/55 px-2 py-1 text-[9px] font-bold text-white backdrop-blur">首图参考</span>
            </div>
          ) : (
            <div className="flex max-h-[600px] items-center justify-center overflow-hidden">
              <div className="group relative max-h-full max-w-full cursor-pointer overflow-hidden rounded-xl bg-black" style={{ aspectRatio: mediaAspectRatio, width: mediaAspectRatio >= 1 ? '100%' : 'auto', height: mediaAspectRatio < 1 ? '100%' : 'auto' }} onClick={togglePlayback}>
              <video ref={videoRef} poster={poster || undefined} muted playsInline loop preload="metadata" className="h-full w-full object-contain" onLoadedMetadata={event => { const element = event.currentTarget; if (element.videoWidth > 0 && element.videoHeight > 0) setMediaAspectRatio(element.videoWidth / element.videoHeight); }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => { setPlaying(false); setPlaybackError('视频加载或解码失败，可点击右上角“原站”查看'); }} />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/15 transition group-hover:bg-transparent">
                {!playing && <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur"><Play size={18} fill="currentColor" /></span>}
              </div>
              {loading && <span className="absolute right-2 top-2 rounded-md bg-black/55 px-2 py-1 text-[9px] text-white">加载中…</span>}
              {playbackError && <span className="absolute inset-x-2 bottom-2 rounded-md bg-black/70 px-2 py-1.5 text-center text-[9px] leading-4 text-white">{playbackError}</span>}
              </div>
            </div>
          )}
          <p className="mt-3 line-clamp-2 text-xs font-bold leading-relaxed text-text-primary">{video.title || kickoff?.referenceAnalysis?.title || '未命名对标视频'}</p>
          <p className="mt-1 text-[10px] text-text-muted">{isImageReference ? `${video.aiAnalysis?.imageEvidence?.observedFacts?.length || 0} 张逐图证据已带入，只复用可见布局与信息模块` : `${video.duration ? `${video.duration}s · ` : ''}点击视频播放或暂停`}</p>
        </div>
      ) : (
        <div className="flex min-h-[360px] flex-col items-center justify-center px-8 text-center">
          <Film size={28} className="text-text-muted opacity-35" />
          <p className="mt-3 text-xs font-bold text-text-secondary">尚未载入对标内容</p>
          <p className="mt-1 text-[10px] leading-relaxed text-text-muted">从灵感中心选择视频或图文并发起创作后，将在这里显示。</p>
        </div>
      )}
    </aside>
  );
}

type ReferenceVoiceStrength = 'light' | 'balanced' | 'strong';
function referenceVoiceProfile(kickoff: VideoKickoff | null) {
  const ref = kickoff?.referenceAnalysis;
  const details = ref?.details || [];
  const audioNotes = details.map(item => item.audio || item.bgm || '').filter(Boolean).slice(0, 3);
  const hasFastCue = /快|高能|紧凑|卡点|加速|fast|upbeat/i.test(`${ref?.coreEmotion || ''} ${audioNotes.join(' ')}`);
  return {
    available: Boolean(ref && (ref.coreEmotion || details.length)),
    emotion: ref?.coreEmotion || '沿用对标视频的情绪推进，但不复制原台词和声音身份',
    summary: [ref?.coreEmotion, hasFastCue ? '快开场与紧凑推进' : '按原片信息密度自然推进', audioNotes[0]].filter(Boolean).join(' · '),
    baseSpeed: hasFastCue ? 1.1 : 1.02,
  };
}

interface ProductOption { id: string; label: string; info: string; imageUrls?: string[] }
interface ModeScriptOutput {
  id: string;
  title: string;
  script: string;
  mode: 'material' | 'product' | 'clone';
  contentTheme?: VideoThemeId;
  buyerLabel?: string;
  qualityStatus?: StudioScriptQualityStatus;
  qualityChecks?: StudioScriptQualityChecks;
  validationWarnings?: string[];
  validationIssues?: string[];
  materialCoveragePercent?: number;
  pendingMaterialScenes?: number;
  missingMaterials?: string[];
}
type EnterpriseProductItem = NonNullable<NonNullable<EnterpriseProfileLite['products']>['items']>[number];

const compact = (value?: string) => String(value || '').trim();
const PLACEHOLDER_PRODUCT_RE = /^(主推产品|this product|企业产品组合)$/i;
const modeScriptNumber = (item: ModeScriptOutput, fallbackIndex = 0): number => {
  const match = item.title.match(/脚本\s*(\d+)/);
  return match ? Number(match[1]) || fallbackIndex + 1 : fallbackIndex + 1;
};

function normalizedCoveragePercent(response: StudioScriptResult): number | undefined {
  const coverage = response.materialCoverage;
  let value: number | undefined;
  if (typeof coverage === 'number') value = coverage;
  else if (coverage && typeof coverage === 'object') {
    value = coverage.coverageRatio ?? coverage.percent ?? coverage.percentage ?? coverage.ratio;
    if (value === undefined && Number(coverage.total) > 0 && Number.isFinite(Number(coverage.covered))) {
      value = Number(coverage.covered) / Number(coverage.total);
    }
  }
  if (value === undefined) {
    const checkCoverage = response.qualityChecks?.materialCoverage;
    value = typeof checkCoverage === 'number'
      ? checkCoverage
      : checkCoverage?.coverageRatio ?? checkCoverage?.percent ?? checkCoverage?.percentage ?? checkCoverage?.ratio;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(100, value <= 1 ? value * 100 : value));
}

function pendingMaterialSceneCount(response: StudioScriptResult): number | undefined {
  const coverage = response.qualityChecks?.materialCoverage;
  const pending = typeof coverage === 'object' ? coverage.pendingScenes : undefined;
  return typeof pending === 'number' && Number.isFinite(pending) ? Math.max(0, Math.round(pending)) : undefined;
}

function missingMaterialLabels(response: StudioScriptResult): string[] {
  const coverage = response.materialCoverage;
  const nested = coverage && typeof coverage === 'object'
    ? [...(coverage.missing || []), ...(coverage.missingShots || [])]
    : [];
  return Array.from(new Set([...(response.missingMaterials || []), ...nested].map(item => String(item).trim()).filter(Boolean)));
}

function normalizedScriptQualityStatus(response: StudioScriptResult): StudioScriptQualityStatus | undefined {
  if (response.qualityStatus) return response.qualityStatus;
  if (response.source === 'ai_rejected') return 'rejected';
  if (response.source === 'ai_failed') return 'failed';
  // Old successful responses did not include V2 quality fields.
  return response.script?.trim() ? 'passed' : undefined;
}

function scriptQualityWarnings(response: StudioScriptResult): string[] {
  const status = normalizedScriptQualityStatus(response);
  const warnings = response.validationWarnings?.length
    ? response.validationWarnings
    : status !== 'rejected' && status !== 'failed'
      ? response.validationIssues || []
      : [];
  return Array.from(new Set(warnings.map(item => String(item).trim()).filter(Boolean)));
}

function scriptQualityFailure(response: StudioScriptResult, fallback: string, retainRejectedDraft = false): string | null {
  const status = normalizedScriptQualityStatus(response);
  const scriptAvailable = Boolean(response.script?.trim());
  if (scriptAvailable && status !== 'rejected' && status !== 'failed') return null;
  if (scriptAvailable && status === 'rejected' && retainRejectedDraft) return null;
  const reasons = response.validationIssues?.length
    ? response.validationIssues
    : response.validationWarnings?.length
      ? response.validationWarnings
      : [];
  const reason = reasons.map(item => String(item).trim()).filter(Boolean).slice(0, 4).join('；')
    || response.error
    || response.fallbackReason
    || fallback;
  return status === 'rejected'
    ? `生成已停止（质量校验未通过）：${reason}`
    : reason;
}

const REJECTED_STORYBOARD_ASSISTANT_MESSAGE = '当前测试账号素材太少啦，换个创作模式再试试！';

function announceRejectedStoryboard(response: StudioScriptResult): void {
  const status = normalizedScriptQualityStatus(response);
  if (status !== 'rejected' && status !== 'failed') return;
  window.dispatchEvent(new CustomEvent('lingshu-assistant-say', {
    detail: { message: REJECTED_STORYBOARD_ASSISTANT_MESSAGE, durationMs: 7_000 },
  }));
}

function qualityFields(response: StudioScriptResult): Pick<ModeScriptOutput, 'qualityStatus' | 'qualityChecks' | 'validationWarnings' | 'validationIssues' | 'materialCoveragePercent' | 'pendingMaterialScenes' | 'missingMaterials'> {
  return {
    qualityStatus: normalizedScriptQualityStatus(response),
    qualityChecks: response.qualityChecks,
    validationWarnings: scriptQualityWarnings(response),
    validationIssues: response.validationIssues || [],
    materialCoveragePercent: normalizedCoveragePercent(response),
    pendingMaterialScenes: pendingMaterialSceneCount(response),
    missingMaterials: missingMaterialLabels(response),
  };
}

function qualitySuccessNotice(response: StudioScriptResult, defaultMessage: string): string {
  const status = normalizedScriptQualityStatus(response);
  const coverage = normalizedCoveragePercent(response);
  const warnings = scriptQualityWarnings(response);
  const missing = missingMaterialLabels(response);
  const pendingScenes = pendingMaterialSceneCount(response);
  if (status === 'rejected') {
    const issueCount = response.validationIssues?.length || 1;
    return `草稿已生成，待人工审核；当前有 ${issueCount} 项内容需要确认。`;
  }
  if (status === 'needs_material') {
    const missingLabel = pendingScenes !== undefined
      ? `${pendingScenes} 个镜头`
      : missing.length
        ? `${missing.length} 个镜头`
        : '未覆盖镜头';
    return `脚本已生成并写入结果区${coverage === undefined ? '' : `，素材覆盖率 ${Math.round(coverage)}%`}；${missingLabel}已标记为待匹配素材，可继续编辑，补齐后再进入成片。`;
  }
  if (status === 'passed_with_warnings' || status === 'warning' || warnings.length) {
    return `脚本已生成并写入结果区；保留 ${warnings.length || 1} 项质量提示，请确认后继续。`;
  }
  return defaultMessage;
}
const uniqueLangs = (primary: string, count: number) => {
  const base = [primary, 'en', 'es', 'ar', 'pt', 'id', 'fr', 'de'].filter(Boolean);
  return Array.from(new Set(base)).slice(0, Math.max(1, count));
};

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      value => {
        window.clearTimeout(timer);
        resolve(value);
      },
      error => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function formatSelectedProductInfo(options: ProductOption[]): string {
  return options.map((option, index) => [
    options.length > 1 ? `选定产品 ${index + 1}：${option.label}` : '',
    option.info,
  ].filter(Boolean).join('\n')).join('\n\n');
}

function selectedProductLabel(productInfo: string): string {
  const names = Array.from(String(productInfo || '').matchAll(/产品名称[：:]\s*([^\n]+)/g))
    .map(match => compact(match[1]))
    .filter(name => name && !PLACEHOLDER_PRODUCT_RE.test(name));
  if (names.length) return names.join(' + ');
  const brief = parseProductBrief(productInfo);
  return brief.name && !PLACEHOLDER_PRODUCT_RE.test(brief.name) ? brief.name : '';
}

function productOptionFromInfo(info: string, id = 'kickoff-product'): ProductOption | null {
  const label = selectedProductLabel(info);
  if (!label) return null;
  return { id, label, info: String(info || '').trim() };
}

function productInfoRows(info: string) {
  const preferredLabels = ['所属类目', '产品卖点', '价格区间', '起订量', '认证资质'];
  const rows = String(info || '').split('\n').map(line => {
    const match = line.match(/^([^：:]+)[：:]\s*(.+)$/);
    return match ? { label: match[1].trim(), value: match[2].trim() } : null;
  }).filter((row): row is { label: string; value: string } => Boolean(row?.value));
  return preferredLabels
    .map(label => rows.find(row => row.label === label))
    .filter((row): row is { label: string; value: string } => Boolean(row));
}

function productOptionCategory(option: ProductOption): string {
  return option.info.match(/所属类目[：:]\s*([^\n]+)/)?.[1]?.trim() || '未分类';
}

function ProductInfoPreview({ products }: { products: ProductOption[] }) {
  return (
    <aside className="sticky top-0 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div className="border-b border-border px-4 py-3">
        <p className="text-sm font-black text-text-primary">产品信息</p>
        <p className="mt-0.5 text-[10px] text-text-muted">已选产品 · 生成内容将以此为准</p>
      </div>
      {products.length ? (
        <div className="max-h-[680px] space-y-4 overflow-y-auto p-4">
          {products.map(product => {
            const rows = productInfoRows(product.info);
            const images = product.imageUrls || [];
            return (
              <div key={product.id} className="overflow-hidden rounded-xl border border-border bg-surface-2">
                <div className="relative aspect-[4/3] overflow-hidden bg-surface">
                  {images[0] ? (
                    <img src={images[0]} alt={product.label} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center text-text-muted">
                      <ImageIcon size={30} className="opacity-35" />
                      <span className="mt-2 text-[10px]">暂无产品图片</span>
                    </div>
                  )}
                  <span className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-[9px] font-bold text-white backdrop-blur">企业产品</span>
                </div>
                <div className="p-4">
                  <p className="text-sm font-black leading-snug text-text-primary">{product.label}</p>
                  <div className="mt-3 space-y-2.5">
                    {rows.map(row => (
                      <div key={row.label} className="grid grid-cols-[58px_1fr] gap-2 text-[11px] leading-relaxed">
                        <span className="text-text-muted">{row.label}</span>
                        <span className="font-semibold text-text-secondary">{row.value}</span>
                      </div>
                    ))}
                  </div>
                  {images.length > 1 && (
                    <div className="mt-3 flex gap-2 overflow-x-auto">
                      {images.slice(1, 5).map((url, index) => (
                        <img key={`${url}-${index}`} src={url} alt={`${product.label} ${index + 2}`} className="h-12 w-12 shrink-0 rounded-lg border border-border object-cover" />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-[360px] flex-col items-center justify-center px-8 text-center">
          <ImageIcon size={28} className="text-text-muted opacity-35" />
          <p className="mt-3 text-xs font-bold text-text-secondary">尚未选择产品</p>
          <p className="mt-1 text-[10px] leading-relaxed text-text-muted">请从左侧“产品信息”中选择企业产品，图片和重点信息将在这里显示。</p>
        </div>
      )}
    </aside>
  );
}

function buildAiProductOptions(profile: EnterpriseProfileLite): ProductOption[] {
  const categories = compact(profile.products?.categories);
  const fallbackNames = compact(profile.strategy?.focusProducts || categories)
    .split(/[、,，\n]/)
    .map(item => item.trim())
    .filter(Boolean);
  const rawItems: EnterpriseProductItem[] = profile.products?.items?.length
    ? profile.products.items
    : fallbackNames.map(name => ({ name }));
  return rawItems
    .map((item, index) => {
      const name = compact(item.name);
      if (!name || /^产品\d+$/.test(name)) return null;
      const category = compact(item.category || categories);
      const highlights = compact(item.highlights || profile.products?.highlights || profile.brand?.usp);
      const price = compact(item.priceRange || profile.products?.priceRange);
      const moq = compact(item.moq || profile.products?.moq);
      const certifications = compact(item.certifications || profile.products?.certifications);
      const assetNames = (list?: Array<{ name?: string }>) => (list || [])
        .map(asset => compact(asset.name))
        .filter(Boolean)
        .slice(0, 6)
        .join('、');
      return {
        id: `product-${index}-${name}`,
        label: name,
        imageUrls: [
          ...(item.images || []),
          ...(item.packagingImages || []),
          ...(item.sceneImages || []),
        ].map(asset => compact(asset.url)).filter(Boolean),
        info: [
          `产品名称：${name}`,
          compact(item.sku) ? `产品SKU：${compact(item.sku)}` : '',
          category ? `所属类目：${category}` : '',
          highlights ? `产品卖点：${highlights}` : '',
          price ? `价格区间：${price}` : '',
          moq ? `起订量：${moq}` : '',
          certifications ? `认证资质：${certifications}` : '',
          assetNames(item.images) ? `产品主图素材：${assetNames(item.images)}` : '',
          assetNames(item.factoryImages) ? `工厂实拍素材：${assetNames(item.factoryImages)}` : '',
          assetNames(item.packagingImages) ? `包装定制素材：${assetNames(item.packagingImages)}` : '',
          assetNames(item.certificateImages) ? `证书资质素材：${assetNames(item.certificateImages)}` : '',
          assetNames(item.sceneImages) ? `使用场景素材：${assetNames(item.sceneImages)}` : '',
          assetNames(item.brandAssets) ? `品牌视觉素材：${assetNames(item.brandAssets)}` : '',
        ].filter(Boolean).join('\n'),
      };
    })
    .filter(Boolean) as ProductOption[];
}

function parseProductBrief(productInfo: string) {
  const lines = String(productInfo || '').split('\n').map(line => line.trim()).filter(Boolean);
  const pick = (label: string) => {
    const line = lines.find(item => item.startsWith(`${label}：`) || item.startsWith(`${label}:`));
    return compact(line?.replace(new RegExp(`^${label}[：:]\\s*`), ''));
  };
  const firstProductName = Array.from(String(productInfo || '').matchAll(/产品名称[：:]\s*([^\n]+)/g))
    .map(match => compact(match[1]))
    .filter(Boolean)
    .join(' + ');
  const first = compact(lines[0]?.replace(/^[^：:]+[：:]\s*/, ''));
  return {
    name: firstProductName || pick('产品名称') || pick('主推品') || first || '主推产品',
    category: pick('所属类目') || pick('产品类目') || '待补充类目',
    highlights: pick('产品卖点') || pick('核心优势') || '待补充真实卖点',
    price: pick('价格区间'),
    moq: pick('起订量'),
    certifications: pick('认证资质'),
  };
}

function compactCategory(product: ReturnType<typeof parseProductBrief>): string {
  const name = compact(product.name);
  const items = compact(product.category).split(/[、,，/]/).map(item => item.trim()).filter(Boolean);
  if (name && items.some(item => name.includes(item) || item.includes(name))) return name;
  return items[0] || name || '产品';
}

function buyerPainForProduct(product: ReturnType<typeof parseProductBrief>): string {
  const text = `${product.name} ${product.category} ${product.highlights}`.toLowerCase();
  if (/灯|照明|light|lighting|轨道|筒灯|线性|庭院|调光/.test(text)) {
    return '订购一大批灯具，结果现场亮度、色温和图文效果严重不符';
  }
  if (/包装|袋|盒|纸|paper|bag|box|package/.test(text)) {
    return '下单后才发现包装材质、尺寸和印刷效果跟样图不一样';
  }
  if (/美妆|护肤|cream|serum|cosmetic|skincare/.test(text)) {
    return '选品时只看图片，结果质地、包装和市场卖点都对不上';
  }
  return `批量采购${compactCategory(product)}，最怕样品看着可以，大货效果和描述不一致`;
}

function sceneEnvironmentForProduct(product: ReturnType<typeof parseProductBrief>, index: number): string {
  const text = `${product.name} ${product.category}`.toLowerCase();
  const lighting = /灯|照明|light|lighting|轨道|筒灯|线性|庭院|调光/.test(text);
  if (lighting) {
    return [
      '现代简约室内展厅，白墙和木色桌面，顶部已安装一段轨道灯',
      '半暗室内样板间，墙面保留一块明暗对比区域',
      '安装台面旁，样品、驱动、电源线和参数卡整齐摆放',
      '工程客户选型桌面，色温样品、外壳色卡和包装标签并排',
      '工厂老化测试架或样品打包台，背景能看到成排灯具点亮',
    ][index] || '真实产品演示场景';
  }
  return [
    '干净桌面实拍场景，产品和采购资料放在同一画面',
    '近距离样品展示台，手边放着规格卡和包装样',
    '简单对比测试台，保留一个普通款作为参照',
    '定制选项展示桌，颜色、尺寸、包装或 logo 样并排',
    '样品打包台或询盘电脑旁，画面收束到留言动作',
  ][index] || '真实产品演示场景';
}

function cloneReferenceAnalysisText(kickoff: VideoKickoff): string {
  const ref = kickoff.referenceAnalysis;
  if (!ref) return '';
  const details = (ref.details || [])
    .map(item => [
      normalizeScriptTimestamps(`[${item.time}]`),
      item.environment ? `环境：${item.environment}` : '',
      item.purpose ? `镜头功能：${item.purpose}` : '',
      item.visual ? `画面：${item.visual}` : '',
      item.shot ? `景别：${item.shot}` : '',
      item.camera ? `运镜：${item.camera}` : '',
      item.dialogue ? `口播：${item.dialogue}` : '口播：无',
      item.onScreenText || item.subtitle ? `屏幕文字：${item.onScreenText || item.subtitle}` : '屏幕文字：无',
      item.ambientSound ? `环境声：${item.ambientSound}` : '',
      item.bgm || item.audio ? `配乐：${item.bgm || item.audio}` : '',
      item.soundEffects?.length ? `音效：${item.soundEffects.join('、')}` : '',
      item.persistentState ? `持续状态：${item.persistentState}` : '',
      item.beats?.length ? `镜头内节拍：${item.beats.map(beat => `[${beat.time || '镜头内'}] ${beat.action || ''}${beat.dialogue ? `／口播：${beat.dialogue}` : ''}${beat.onScreenText ? `／字幕：${beat.onScreenText}` : ''}`).join('；')}` : '',
      item.authenticity ? `真实性要求：${item.authenticity}` : '',
      item.needsReview ? `人工复核：是（置信度${Math.round((item.confidence ?? 0) * 100)}%）` : '',
      item.note ? `备注：${item.note}` : '',
    ].filter(Boolean).join('；'))
    .join('\n');
  return [
    ref.visualStyle ? `结构风格：${ref.visualStyle}` : '',
    ref.coreEmotion ? `情绪节奏：${ref.coreEmotion}` : '',
    details ? `对标视频脚本详析（必须逐段依据，时间/环境/景别/运镜/配乐/动作节奏优先保持）：\n${details}` : '',
  ].filter(Boolean).join('\n\n');
}

function referenceAnalysisEnd(kickoff: VideoKickoff | null): number {
  return (kickoff?.referenceAnalysis?.details || []).reduce((max, item) => {
    const range = parseCueRange(item.time);
    return Math.max(max, range?.end || 0);
  }, 0);
}

function hasIncompleteReferenceAnalysis(kickoff: VideoKickoff | null): boolean {
  const sourceDuration = Number(kickoff?.video?.duration || 0);
  const analyzedUntil = referenceAnalysisEnd(kickoff);
  const details = kickoff?.referenceAnalysis?.details || [];
  if (!details.length) return true;
  const ranges = details
    .map(item => parseCueRange(item.time))
    .filter((item): item is { start: number; end: number } => Boolean(item))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (!ranges.length || ranges[0]!.start > 0.75) return true;
  if (sourceDuration > 0 && analyzedUntil + 1 < sourceDuration) return true;
  const timelineDuration = sourceDuration > 0 ? sourceDuration : analyzedUntil;
  if (ranges.length < Math.ceil(timelineDuration / 5)) return true;
  return ranges.some((range, index) => {
    const next = ranges[index + 1];
    return range.end - range.start > 5.5
      || Boolean(next && next.start - range.end > 0.75)
      || Boolean(next && range.end - next.start > 0.75);
  }) || details.some(item => /分析超时|缺少真实片段/.test(`${item.note || ''} ${item.visual || ''}`));
}

type MigrationMode = 'fidelity' | 'structure' | 'mechanism';

interface MigrationRecommendation {
  mode: MigrationMode;
  label: string;
  reason: string;
  preserve: string[];
  rebuild: string[];
}

function recommendMigration(kickoff: VideoKickoff | null, productInfo: string): MigrationRecommendation {
  const reference = [
    kickoff?.video?.title || '',
    kickoff?.referenceAnalysis?.visualStyle || '',
    ...(kickoff?.referenceAnalysis?.details || []).flatMap(item => [item.environment || '', item.visual || '', item.purpose || '']),
  ].join(' ').toLowerCase();
  const product = String(productInfo || '').toLowerCase();
  const groups = [
    /truck|lorry|卡车|货车|牵引车|底盘/,
    /cream|serum|cosmetic|skincare|lip gloss|lipstick|唇蜜|口红|面霜|精华|美妆|护肤/,
    /lighting|light fixture|track light|灯具|照明|轨道灯|筒灯/,
    /package|packaging|paper bag|paper box|包装|纸袋|纸盒|礼盒/,
    /furniture|sofa|chair|家具|沙发|椅子/,
    /apparel|garment|fabric|dress|服装|面料|连衣裙/,
  ];
  const referenceGroup = groups.findIndex(group => group.test(reference));
  const productGroup = groups.findIndex(group => group.test(product));
  const details = kickoff?.referenceAnalysis?.details || [];
  const preserve = [
    details.length ? `保留 ${details.length} 段原片镜头顺序与时长比例` : '保留开场钩子与信息揭示顺序',
    '保留可迁移的构图、切镜密度和音画节奏',
  ];
  if (!kickoff || !details.length) return {
    mode: 'mechanism', label: '机制借鉴', reason: '对标视频缺少完整逐镜证据，不宜直接复刻分镜。', preserve,
    rebuild: ['根据企业产品和现有素材重建场景、动作和证明内容'],
  };
  if (referenceGroup >= 0 && referenceGroup === productGroup) return {
    mode: 'fidelity', label: '高保真复刻', reason: '对标内容与所选产品展示逻辑接近，可保留大部分分镜。', preserve,
    rebuild: ['替换竞品品牌、型号、参数和不支持的卖点'],
  };
  if (referenceGroup >= 0 && productGroup >= 0 && referenceGroup !== productGroup) return {
    mode: 'structure', label: '结构迁移', reason: '对标视频与所选产品跨品类，直接替换会产生不可执行画面。', preserve,
    rebuild: ['产品场景、主体动作和细节证明', '所有竞品品牌、型号和原品类对象'],
  };
  return {
    mode: 'structure', label: '结构迁移', reason: '可保留原片的钩子、证明顺序和节奏，画面按企业产品重建更稳妥。', preserve,
    rebuild: ['产品场景、动作和证明内容', '竞品专属事实与话术'],
  };
}

function cloneReferenceHighlights(kickoff: VideoKickoff): string[] {
  const ref = kickoff.referenceAnalysis;
  const out = [
    ref?.visualStyle ? `画风：${ref.visualStyle}` : '',
    ref?.coreEmotion ? `情绪：${ref.coreEmotion}` : '',
    ...(ref?.details || []).slice(0, 12).map(item => `${item.time} ${item.environment || ''} ${item.shot}/${item.camera}：${item.visual || item.note || item.subtitle || '按原分镜动作节奏复刻'}`),
  ].filter(Boolean);
  return out.length ? out : ['复刻对标视频的开头钩子、情绪节奏、镜头关系和转化 CTA。'];
}

function referenceProductTerms(kickoff: VideoKickoff): string[] {
  const raw = [
    kickoff.video?.title || '',
    ...(kickoff.referenceAnalysis?.details || []).flatMap(item => [item.visual || '', item.subtitle || '', item.onScreenText || '']),
  ].join('\n');
  const stopWords = new Set(['facebook', 'instagram', 'youtube', 'tiktok', 'video', 'official', 'factory', 'product']);
  const titleTerms = String(kickoff.video?.title || '').match(/[A-Za-z][A-Za-z0-9-]{3,}/g) || [];
  const upperTerms = raw.match(/\b[A-Z][A-Z0-9-]{2,}\b/g) || [];
  return [...new Set([...titleTerms, ...upperTerms]
    .map(term => term.trim())
    .filter(term => term.length >= 3 && !stopWords.has(term.toLowerCase())))];
}

function adaptReferenceVisualToProduct(visual: string, product: ReturnType<typeof parseProductBrief>, kickoff?: VideoKickoff): string {
  const productObject = `${compactCategory(product)}产品`;
  const productName = product.name && product.name !== productObject ? product.name : productObject;
  let next = compact(visual) || `展示${productName}的外观、细节和实际效果`;
  for (const term of kickoff ? referenceProductTerms(kickoff) : []) {
    next = next.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), productName);
  }
  next = next
    .replace(/护肤美妆纸艺品（[^）]*）/g, `${productObject}纸艺品`)
    .replace(/护肤美妆纸艺品\([^)]*\)/g, `${productObject}纸艺品`)
    .replace(/护肤美妆产品|护肤品|美妆品|美妆产品|眼膜|唇膏|面霜|安瓶|指甲油|蒸笼/g, productObject)
    .replace(/饺子造型的[^，。；;]*?(?:纸艺品|产品)/g, `饺子造型的${productObject}纸艺品`)
    .replace(/多个[^，。；;]*?(?:产品|纸艺品)/, `多个${productObject}纸艺品`)
    .replace(/一双[^，。；;]*?手/g, '一双手')
    .replace(/粉色大饺子/g, `粉色${productObject}`)
    .replace(/可爱的饺子造型纸艺品/g, `可爱的${productObject}纸艺品`);
  const productText = `${product.name} ${product.category}`.toLowerCase();
  const incompatibleReferenceObjects = [
    { test: /truck|lorry|卡车|货车|牵引车|底盘/gi, supported: /truck|lorry|卡车|货车|牵引车|底盘/i },
    { test: /cream|serum|cosmetic|skincare|面霜|精华|美妆|护肤品/gi, supported: /cream|serum|cosmetic|skincare|面霜|精华|美妆|护肤/i },
    { test: /lighting|light fixture|track light|灯具|照明|轨道灯|筒灯/gi, supported: /lighting|light|灯具|照明|轨道灯|筒灯/i },
  ];
  for (const group of incompatibleReferenceObjects) {
    if (!group.supported.test(productText)) next = next.replace(group.test, productObject);
  }
  if (!next.includes(productObject) && !next.includes(product.name)) {
    next = next.replace(/画面中出现/, `画面中出现${productName}，`);
  }
  return next;
}

function buildLocalCloneScript(kickoff: VideoKickoff, productInfo: string, languageCode: string, variant = 0, migrationMode: MigrationMode = 'structure'): string {
  const product = parseProductBrief(productInfo);
  const details = kickoff.referenceAnalysis?.details?.length ? kickoff.referenceAnalysis.details : [];
  const variantPlans = [
    {
      environments: ['干净桌面产品主视觉区', '近距离样品展示台', '细节检验工作台', '规格与包装陈列区', '品牌产品矩阵背景'],
      visuals: [
        `${product.name}正面完整亮相，主体约占画面三分之二，用清晰轮廓建立产品识别`,
        `手持${product.name}缓慢转到侧面，展示外观、结构与包装关系`,
        `镜头贴近${product.name}关键细节，以可见纹理或结构证明${product.highlights}`,
        `把${product.name}的规格、包装或可定制部分并列摆放，逐项给出视觉对照`,
        `${product.name}与品牌资料同框收尾，保持画面整洁并强化产品记忆`,
      ],
    },
    {
      environments: ['真实使用准备区', '产品操作演示台', '结果对照区', '样品确认区', '整套交付展示区'],
      visuals: [
        `先呈现${product.name}即将投入使用的状态，以动作悬念形成开场`,
        `双手完成一次${product.name}可实际拍摄的操作，突出使用路径而非静态陈列`,
        `把操作前后或两个有效角度放在同一画面比较，用结果证明${product.highlights}`,
        `依次展示${product.name}样品、包装和可确认规格，让采购信息可被看见`,
        `将${product.name}成套排开并回到完成态，以完整交付感结束`,
      ],
    },
    {
      environments: ['质检台近景区', '结构拆解展示区', '材质细节灯光区', '包装核验区', '工厂资料背景区'],
      visuals: [
        `以${product.name}局部极近景开场，随后拉开到完整产品，制造细节揭晓`,
        `沿${product.name}结构顺序逐处移动镜头，展示组成、接口或工艺关系`,
        `用侧光拍出${product.name}材质和边缘细节，把${product.highlights}转成可见证据`,
        `手动翻转${product.name}及其包装标签，核验外观、规格和定制位置`,
        `产品、包装与企业资料形成前中后景，定格在${product.name}完整正面`,
      ],
    },
    {
      environments: ['采购验样桌', '规格并列区', '手部测试台', '定制方案板前', '询盘资料收纳区'],
      visuals: [
        `采购者把${product.name}样品推入画面中央，以验样动作直接建立开场问题`,
        `把${product.name}的两个可见角度并排摆放，手指沿结构逐项指出差异`,
        `完成一次可复现的手部检查动作，用近景记录${product.highlights}对应的真实细节`,
        `包装、标识位与${product.name}依次进入画面，形成清晰的定制确认顺序`,
        `镜头从确认清单移回${product.name}完整产品，以单一询盘动作收尾`,
      ],
    },
    {
      environments: ['仓库取样通道', '开箱检查桌', '核心部件展示垫', '批量陈列背景', '出货确认区'],
      visuals: [
        `从成排样品中抽出一件${product.name}并快速转向镜头，形成动态揭晓`,
        `拆开${product.name}外包装并依次取出内容物，保留完整开箱动作`,
        `将核心结构靠近镜头后再放回产品主体，用连续动作呈现${product.highlights}`,
        `单件样品与批量陈列同框，镜头横移展示包装和品牌位置`,
        `封箱标签与${product.name}正面依次定格，强调可执行的交付确认`,
      ],
    },
    {
      environments: ['使用场景入口', '第一视角操作区', '侧面对照区', '品牌展示桌', '简洁 CTA 背景'],
      visuals: [
        `第一视角拿起${product.name}进入使用位置，不先展示全貌以制造悬念`,
        `按真实步骤完成一次操作，镜头跟随手部与${product.name}移动`,
        `固定机位并列展示两个角度或状态，以画面差异说明${product.highlights}`,
        `将${product.name}放回品牌展示桌，补充包装与规格的可见信息`,
        `手指停在${product.name}与资料卡之间，画面只保留一个明确行动入口`,
      ],
    },
  ];
  const plan = variantPlans[Math.abs(Math.trunc(variant)) % variantPlans.length];
  if (details.length) {
    return details.map((item, index) => {
      const time = normalizeScriptTimestamps(`[${item.time || `${index * 4}-${(index + 1) * 4}s`}]`);
      const environment = migrationMode === 'fidelity'
        ? (item.environment || '沿用原片环境')
        : (plan.environments[Math.min(index, plan.environments.length - 1)] || sceneEnvironmentForProduct(product, index));
      const groundedVisual = migrationMode === 'fidelity'
        ? adaptReferenceVisualToProduct(item.visual || item.note || '', product, kickoff)
        : plan.visuals[Math.min(index, plan.visuals.length - 1)];
      const verifiedProductCue = index === 0 && product.highlights && product.highlights !== '待补充真实卖点'
        ? `，镜头中的品牌、型号和产品外观均以${product.name}的企业资料为准，重点呈现${product.highlights}`
        : '';
      const visual = `${groundedVisual}${verifiedProductCue}`;
      const voice = compact(item.dialogue);
      const subtitle = compact(item.onScreenText || item.subtitle);
      if (languageCode === 'zh') {
        return [
          time,
          `环境：${environment}`,
          `景别：${item.shot || '沿用原片景别'}`,
          `运镜：${item.camera || '沿用原片机位'}`,
          `画面：${visual}`,
          `配乐：${item.bgm || item.audio || '无'}`,
          `台词：${voice || '无'}`,
          `字幕：${subtitle || '无'}`,
        ].join('\n');
      }
      return [
        time,
        `Environment: ${environment}`,
        `Shot: ${item.shot || 'match the reference shot size'}`,
        `Camera: ${item.camera || 'match the reference camera'}`,
        `Visual: ${visual}`,
        `Music: ${item.bgm || item.audio || 'None'}`,
        `Voiceover: ${voice || 'None'}`,
        `Subtitle: ${subtitle || 'None'}`,
      ].join('\n');
    }).join('\n\n');
  }
  return '';
}

function isStandardCloneStoryboard(value: string): boolean {
  const text = String(value || '');
  if (!text.trim()) return false;
  const required = ['环境', '景别', '运镜', '画面', '配乐', '台词', '字幕'];
  const hasAllFields = required.every(label => new RegExp(`${label}[：:]`).test(text));
  const oldSparseFormat = /人物说[：:]|采购这类|真实使用场景|痛点特写|买家最关心的结果|先看真实使用效果|把「[^」]+」放到真实使用场景/.test(text);
  return hasAllFields && !oldSparseFormat && !hasUnnaturalVoiceover(text);
}

function ensureStandardCloneStoryboard(value: string, kickoff: VideoKickoff, productInfo: string, languageCode: string, strictProductName?: string, migrationMode: MigrationMode = 'structure'): { script: string; normalized: boolean } {
  const sanitized = sanitizeStoryboardScript(value, productInfo, strictProductName).trim();
  if (isStandardCloneStoryboard(sanitized)) return { script: sanitized, normalized: false };
  return { script: '', normalized: true };
}

function cloneScriptSimilarity(a: string, b: string): number {
  const grams = (value: string) => {
    const normalized = compactComparable(value)
      .replace(/脚本\d+|当前|环境|景别|运镜|画面|配乐|台词|字幕/g, '');
    const out = new Set<string>();
    for (let i = 0; i < Math.max(1, normalized.length - 1); i += 1) out.add(normalized.slice(i, i + 2));
    return out;
  };
  const left = grams(a);
  const right = grams(b);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  left.forEach(item => { if (right.has(item)) overlap += 1; });
  return overlap / Math.max(left.size, right.size);
}

function isDuplicateCloneScript(candidate: string, existingScripts: string[]): boolean {
  return existingScripts.some(item => cloneScriptSimilarity(candidate, item) > 0.82);
}

function cloneScriptMaxSimilarity(candidate: string, existingScripts: string[]): number {
  return existingScripts.reduce((max, item) => Math.max(max, cloneScriptSimilarity(candidate, item)), 0);
}

function ensureDistinctCloneStoryboard(input: {
  script: string;
  kickoff: VideoKickoff;
  productInfo: string;
  languageCode: string;
  strictProductName?: string;
  existingScripts: string[];
  variantSeed: number;
  migrationMode?: MigrationMode;
}) {
  let normalized = ensureStandardCloneStoryboard(input.script, input.kickoff, input.productInfo, input.languageCode, input.strictProductName, input.migrationMode);
  if (!isDuplicateCloneScript(normalized.script, input.existingScripts)) return normalized;
  return { script: '', normalized: true };
}

function buildLocalProductScript(productInfo: string, languageCode: string, totalDuration = 20): string {
  const product = parseProductBrief(productInfo);
  const field = (label: string) => compact(String(productInfo || '').split('\n').find(line => line.startsWith(`${label}：`) || line.startsWith(`${label}:`))?.replace(new RegExp(`^${label}[：:]\\s*`), ''));
  const details = [
    field('容量') ? `容量 ${field('容量')}` : '',
    field('杯体材质') ? `杯体材质 ${field('杯体材质')}` : '',
    field('刀片材质') ? `刀片材质 ${field('刀片材质')}` : '',
    field('充电方式') ? `充电方式 ${field('充电方式')}` : '',
    ...compact(product.highlights).split(/[、,，;；\n]/).map(item => item.trim()),
  ].filter(Boolean);
  const points = [details[0] || product.category, details[1] || '样品细节可确认', details[2] || '实际操作可打样确认'];
  const total = Math.max(10, totalDuration);
  const boundaries = [0, .18, .4, .62, .82, 1].map(value => +(value * total).toFixed(1));
  const time = (index: number) => `${boundaries[index]}-${boundaries[index + 1]}s`;
  const productText = `${product.name} ${product.category}`.toLowerCase();
  const appliance = /榨汁|果汁|搅拌|小家电|blender|juicer|appliance/.test(productText);
  const scenes = [
    {
      time: time(0), scene: '采购风险钩子',
      visual: `把「${product.name}」与采购资料放到桌面，不模拟资料未提供的效果。`,
      voice: appliance ? '榨汁杯好看，不好洗也白搭。' : `${compactCategory(product)}只看图片，真不够。`, subtitle: appliance ? '好看 ≠ 好清洗' : '先确认真实细节',
    },
    {
      time: time(1), scene: '资料与实物细节',
      visual: `用实物和参数卡确认${points[0]}，无法目测的参数只放资料卡。`,
      voice: appliance && /容量\s*420/i.test(points[0]) ? '420毫升，通勤一杯刚刚好。' : `${Array.from(points[0]).slice(0, 12).join('')}，细节拍给你看。`, subtitle: appliance ? '420mL · 通勤随行' : String(points[0]),
    },
    {
      time: time(2), scene: '第二证明点',
      visual: `展示${points[1]}对应的实物或资料，不添加跨品类动作。`,
      voice: appliance && /可拆洗|拆洗/.test(product.highlights) ? '杯体能拆，清洗不用绕弯。' : `${Array.from(points[1]).slice(0, 10).join('')}，实物更有说服力。`, subtitle: appliance ? '可拆杯体 · 清洗省事' : String(points[1]),
    },
    {
      time: time(3), scene: '定制确认',
      visual: `展示产品资料中已经提供的定制项、包装样或LOGO位置。`,
      voice: /logo|包装|彩盒/i.test(product.highlights) ? 'LOGO和彩盒，都能做成你的品牌。' : '想做自己的版本？样品可以先聊。', subtitle: /logo|包装|彩盒/i.test(product.highlights) ? 'LOGO / 彩盒定制' : '先看定制样',
    },
    {
      time: time(4), scene: '询盘转化',
      visual: `收束到数量、目标市场、包装和留言动作。`,
      voice: '想测样？发我数量和市场。', subtitle: `${product.moq ? `发数量 · MOQ ${product.moq}` : '发数量 · 拿样品报价'}`,
    },
  ];
  return scenes.map(item => [
    `[${item.time}]`,
    `环境：真实产品桌面演示区`,
    `景别：中近景`,
    `运镜：固定镜头或缓慢推进`,
    `镜头功能：${item.scene}`,
    `画面：${item.visual}`,
    `配乐：轻节奏BGM，口播时自动降低音量`,
    `人物说：“${item.voice}”`,
    `字幕：${item.subtitle}`,
  ].join('\n')).join('\n\n');
}

function publicScriptFailureReason(value: unknown): string {
  const message = String(value || '');
  if (/429|RESOURCE_EXHAUSTED|prepayment credits|quota|billing/i.test(message)) return '上游模型额度不足，未生成脚本。请更换模型 Key 或稍后重试。';
  if (/401|403|api.?key|unauthorized|permission/i.test(message)) return '上游模型授权暂不可用，未生成脚本。请检查模型 Key 或权限。';
  if (/timeout|timed out|超时|503|502|504|UNAVAILABLE/i.test(message)) return '上游模型暂时繁忙，未生成脚本。请稍后重试。';
  if (/\{\s*"?(?:error|code|message)"?|https?:\/\//i.test(message)) return '上游模型生成失败，未生成脚本。请补充素材/产品信息后重试。';
  return message || '模型生成失败，未生成脚本。';
}

function publicVoiceFailureReason(value: unknown): string {
  const message = String(value || '').trim();
  if (/arrears|recharge|past due|overdue|欠费|充值/i.test(message)) return 'DashScope 语音服务账户欠费，暂时无法生成口播。请为该 API Key 所属阿里云账户充值，或改用“上传口播”。';
  if (/quota|insufficient|balance|credit|resource_exhausted|额度|余额/i.test(message)) return '语音服务额度或余额不足，暂时无法生成口播。请补充额度，或改用“上传口播”。';
  if (/401|403|unauthorized|forbidden|api.?key|permission|鉴权|权限/i.test(message)) return '语音服务鉴权失败，请检查 API Key 与模型权限，或改用“上传口播”。';
  return message || '语音服务暂时不可用，请稍后重试或改用“上传口播”。';
}

function buildLocalMaterialScript(materialsList: Clip[], selectedIds: string[], productInfo: string, totalDuration = 20): string {
  const product = parseProductBrief(productInfo);
  const selectedMaterials = selectedIds.length
    ? materialsList.filter(item => selectedIds.includes(item.id))
    : materialsList.filter(item => item.type !== 'audio').slice(0, 4);
  const usable = selectedMaterials.length ? selectedMaterials : [{ name: '当前产品素材', folder: 'product', type: 'video', duration: 4 } as Clip];
  const infos = buildMaterialInfosForScript(usable.slice(0, 8), totalDuration);
  return infos.map((info, index) => {
    const clip = usable.find(item => item.name === info.name) || usable[index]!;
    const start = info.targetStart;
    const end = info.targetEnd;
    const materialRole = clip.folder === 'presenter' ? '真人口播素材'
      : clip.folder === 'detail' ? '产品细节素材'
      : clip.folder === 'factory' ? '工厂/实力素材'
      : clip.folder === 'scene' ? '场景使用素材'
      : clip.folder === 'model' ? '模特/效果素材'
      : '产品展示素材';
    const materialText = `${clip.name} ${clip.tags || ''} ${clip.shotFunction || ''}`;
    const isBeauty = /精华|护肤|美容|serum|skincare|cosmetic/i.test(`${product.name} ${product.category} ${materialText}`);
    const voice = index === 0
      ? (/滴|液体|质地/i.test(materialText) ? '这一滴的质感，开场就很抓眼。' : `${Array.from(product.name).slice(0, 7).join('')}，第一眼就得抓人。`)
      : index === infos.length - 1
        ? (isBeauty ? '想做自有品牌？发数量，给你配方案。' : '想测样？发我数量和市场。')
        : clip.folder === 'product'
          ? (isBeauty ? '瓶身和滴管一入镜，品牌感就来了。' : '外观和结构，镜头里一次看清。')
          : clip.folder === 'factory' ? '样品能打，大货也要接得住。'
            : clip.folder === 'packaging' ? '换上你的LOGO，才是你的产品。'
              : clip.folder === 'scene' || clip.folder === 'model' ? '放进真实场景，客户更容易代入。'
                : '细节拍到位，卖点自然站得住。';
    return [
      `[${start}-${end}s]`,
      `素材理解：${materialRole}《${clip.name}》，优先使用它已有的画面信息，不凭空新增场景。`,
      `产品承接：只把已确认的可见动作或细节连接到「${product.name}」，不推断功效。`,
      `画面：使用素材《${clip.name}》按可见内容剪辑，优先截取动作完整、主体清楚的位置。`,
      `人物说：“${voice}”`,
      `字幕：${index === 0 ? (/滴|液体|质地/i.test(materialText) ? '一滴抓住注意力' : '第一眼就要抓人') : index === usable.length - 1 ? '发数量 · 拿方案' : clip.folder === 'product' ? '质感就是品牌感' : clip.folder === 'factory' ? '样品到大货都能接' : clip.folder === 'packaging' ? '做成你的品牌' : clip.folder === 'scene' || clip.folder === 'model' ? '让客户看见使用场景' : '看得见的卖点'}`,
    ].join('\n');
  }).join('\n\n');
}

function materialRoleLabel(clip: Pick<Clip, 'folder' | 'type'>): string {
  if (clip.folder === 'presenter') return '真人口播素材';
  if (clip.folder === 'detail') return '产品细节素材';
  if (clip.folder === 'factory') return '工厂/实力素材';
  if (clip.folder === 'packaging') return '包装定制素材';
  if (clip.folder === 'certificate') return '证书资质素材';
  if (clip.folder === 'scene') return '场景使用素材';
  if (clip.folder === 'brand') return '品牌视觉素材';
  if (clip.folder === 'hot') return '爆款图文参考';
  if (clip.folder === 'model') return '模特/效果素材';
  if (clip.type === 'image') return '静态产品图';
  return '产品展示素材';
}

function buildMaterialInfosForScript(clips: Clip[], totalDuration: number, hookMaterialId = '') {
  const usable = clips.filter(item => item.type !== 'audio');
  let cursor = 0;
  const result = usable.reduce<Array<{
    name: string; type: Clip['type']; folder: string; duration: number; effectiveDuration: number; role: string;
    targetStart: number; targetEnd: number; industry?: string; shotFunction?: string; tags?: string; observations?: string[];
  }>>((result, clip) => {
    if (cursor >= totalDuration) return result;
    const effectiveDuration = Math.min(
      clip.id === hookMaterialId && clip.type === 'video' ? Math.max(0.5, clip.duration) : effectiveClipDuration(clip),
      totalDuration - cursor,
    );
    const targetStart = +cursor.toFixed(1);
    const targetEnd = +Math.min(totalDuration, cursor + effectiveDuration).toFixed(1);
    const observations = (clip.segments || []).slice(0, 6).map(segment => [
      `${segment.start}-${segment.end}s`,
      segment.action,
      segment.shot,
      segment.camera,
      segment.environment,
      segment.productVisible ? `产品清晰度${segment.productClarity}` : '',
      segment.ocrText ? `OCR:${segment.ocrText.slice(0, 120)}` : '',
      segment.needsReview && !segment.manualConfirmed ? '待人工复核' : '',
    ].filter(Boolean).join('；'));
    result.push({
      name: clip.name,
      type: clip.type,
      folder: clip.folder,
      duration: clip.type === 'image' ? 3 : clip.duration || effectiveDuration,
      effectiveDuration,
      role: materialRoleLabel(clip),
      targetStart,
      targetEnd,
      industry: clip.industry,
      shotFunction: clip.shotFunction,
      tags: clip.tags,
      observations,
    });
    cursor = targetEnd;
    return result;
  }, []);
  const last = result[result.length - 1];
  if (last && totalDuration - last.targetEnd > 0 && totalDuration - last.targetEnd <= 0.75) {
    last.effectiveDuration = +(last.effectiveDuration + totalDuration - last.targetEnd).toFixed(1);
    last.targetEnd = totalDuration;
  }
  return result;
}

function normalizeTimeLabel(value: string, fallbackIndex: number): string {
  const range = parseCueRange(value);
  if (range) return `[${range.start}-${range.end}s]`;
  const ranges = ['0-3s', '3-8s', '8-15s', '15-20s', '20-25s', '25-30s'];
  return `[${ranges[fallbackIndex] || `${fallbackIndex * 4}-${(fallbackIndex + 1) * 4}s`}]`;
}

function looksLikeProductionInstruction(value: string): boolean {
  return /^(分镜|镜头|画面|音频|注|Shot|Camera|Visual|Subtitle|Caption|Creative style|Core emotion|Goal|Storyboard|Product replacement)\b/i.test(value)
    || /(?:画面|我方画面|参考节奏|字幕|Shot|Camera|Visual|Subtitle)\s*[：:]/i.test(value);
}


const VOICEOVER_FIELD_RE = /(?:人物说|台词|Voiceover|VO|口播)\s*[：:]\s*(.+)$/i;
const NON_VOICE_FIELD_RE = /^(?:环境|景别|运镜|构图|镜头功能|画面|Visual|字幕|Caption|屏幕文字|OnScreenText|配乐|音乐|音效|Sound|SFX|BGM|真实性要求|可见事实|表达意图|未展示因果|Omni提示词|Omni禁止项)\s*[：:]/i;

function hasStoryboardFieldLabels(lines: string[]): boolean {
  return lines.some(raw => {
    const line = raw.trim();
    return VOICEOVER_FIELD_RE.test(line) || NON_VOICE_FIELD_RE.test(line);
  });
}

function looksLikeOnScreenOnlyText(value: string): boolean {
  const text = String(value || '').replace(/\s+/g, '').trim();
  if (!text) return true;
  if (isNonSpeechSfx(text)) return true;
  if (/[｜|]/.test(text)) return true;
  if (/[¥￥$€£]\s*\d/.test(text)) return true;
  if (/^[A-Z][A-Z0-9_-]{2,}(?:-\d+)?$/i.test(text)) return true;
  if (/^[A-Z][A-Z0-9_-]{2,}(?:-\d+)?(?:资料|认证|报价|PDF)$/i.test(text)) return true;
  if (/^[A-Z0-9_-]{2,}[\u4e00-\u9fff]{1,10}(?:\d+款?)?$/i.test(text)) return true;
  if (/^\d+(?:\.\d+)?\s*(?:资料|认证|报价|PDF)$/i.test(text)) return true;
  if (/^(?:[\d.]+|[A-Z0-9_-]+|PDF|CPNP|MOQ|OEM|ODM)+$/i.test(text)) return true;
  if (/^(?:按压即发|绵密不塌|现货|秒回PDF|含报价|含认证|非打样|即订即发)$/i.test(text)) return true;
  return false;
}

function looksLikeStandaloneSpeech(value: string): boolean {
  const text = cleanVoiceoverLine(value);
  if (!text || looksLikeOnScreenOnlyText(text) || looksLikeProductionInstruction(text)) return false;
  // Localized narration commonly uses ASCII punctuation (Russian and many
  // European languages in particular). Treat it as spoken prose too; the
  // previous CJK-only punctuation check caused valid translated cues to be
  // dropped before the voiceover validator saw them.
  if (/[，。！？!?؟؛、,.:;]/.test(text)) return true;
  if (/(吗|呢|吧|了|我|你|咱|这|那|真能|不是|马上|直接|发我|留言|私信)/.test(text) && text.length >= 6) return true;
  if (/\s/.test(text) && /^(check|send|watch|see|message|comment|dm|ask|get|try)\b/i.test(text)) return true;
  return text.length >= 6 && /\p{L}/u.test(text);
}

function cleanVoiceoverLine(value: string): string {
  let text = String(value || '')
    .replace(/^\s*\[[^\]]+\]\s*/g, '')
    .replace(/^(Hook|Body|CTA|口播|字幕|人物说|台词|Voiceover|VO|Caption)\s*[：:·-]?\s*/i, '')
    .replace(/[（(]\s*(?:参考原节奏|参考节奏|原节奏|参考原片|原片|原视频|日文原句|英文原句|韩文原句)[^）)]*[）)]/gi, '')
    .replace(/[（(][^）)]*(?:参考原节奏|参考节奏|原节奏|参考原片|原片|原视频|日文原句|英文原句|韩文原句)[^）)]*[）)]/gi, '')
    .replace(/[（(][^）)]*[\u3040-\u30ff\uac00-\ud7af][^）)]*[）)]/g, '')
    .replace(/\s*(?:参考原节奏|参考节奏|原节奏|参考原片|原片|原视频|日文原句|英文原句|韩文原句)\s*[：:].*$/gi, '')
    .replace(/^["“”]+|["“”]+$/g, '')
    .replace(/^[\d一二三四五六七八九十]+[.、]\s*/, '')
    .trim();
  text = text.replace(/\s{2,}/g, ' ').trim();
  return text;
}

const TECH_TERM_RE = /\b(?:CE|RoHS|UKCA|ETL|IES\/?LDT|LDT|IP\d{2,}|BSCI|REACH|ISO\d*|MOQ|OEM|ODM|SKU)\b|认证资质|认证|型号|光学文件|检测报告|参数|色温|显指|防护等级/gi;

function techTermCount(value: string): number {
  return Array.from(String(value || '').matchAll(TECH_TERM_RE)).length;
}

function humanizeVoiceLine(value: string): string {
  let text = cleanVoiceoverLine(value);
  const compacted = text.replace(/\s+/g, ' ').trim();
  const terms = techTermCount(compacted);
  const hasCjk = /[\u3400-\u9fff]/.test(compacted);
  const tooDense = terms >= 3 || (hasCjk
    ? Array.from(compacted.replace(/\s/g, '')).length > 58
    : compacted.split(/\s+/).filter(Boolean).length > 20);
  if (!tooDense) return compacted;
  // The deterministic Chinese rewrites below are not translations and must
  // never replace or truncate an English sentence. Let the backend duration
  // validator request a semantic rewrite when an English line is too long.
  if (!hasCjk) return compacted;

  if (/客户问.*价格|问了.*价格|报价|价格/i.test(compacted) && /认证|CE|RoHS|UKCA|ETL|IES|IP\d+/i.test(compacted)) {
    return '客户问完价格，真正担心的是资料能不能一次给齐。先看这个真实效果。';
  }
  if (/认证|CE|RoHS|UKCA|ETL|IES|IP\d+|检测|资质|光学文件/i.test(compacted)) {
    return '认证和检测资料别只写在表格里，先把能确认的文件和实物放一起看。';
  }
  if (/MOQ|数量|包装|标签|目标市场|规格/i.test(compacted)) {
    return '数量、包装和目标市场说清楚，我再给你整理报价和打样方案。';
  }
  if (/参数|色温|显指|亮度|型号/i.test(compacted)) {
    return '别只看参数表，先看现场效果是不是和项目需求对得上。';
  }
  return compacted
    .replace(/(?:认证资质\s*)?(?:CE|RoHS|UKCA|ETL|IES\/?LDT|IP\d{2,}|BSCI|REACH|ISO\d*|[,，、\s]){12,}/gi, '相关认证和检测资料')
    .slice(0, 58)
    .replace(/[，,、;；]\s*$/, '。');
}

function hasUnnaturalVoiceover(value: string): boolean {
  return String(value || '')
    .split(/\n+/)
    .some(line => {
      const match = line.match(/(?:台词|人物说|Voiceover|VO|口播)\s*[：:]\s*(.+)$/i);
      if (!match?.[1]) return false;
      const text = cleanVoiceoverLine(match[1]);
      return techTermCount(text) >= 3 || text.length > 72 || /CE[、,，\s]+RoHS[、,，\s]+UKCA/i.test(text);
    });
}

function mergeTimestampedVoiceoverSegments(
  segments: Array<{ time: string; text: string }>,
): Array<{ time: string; text: string }> {
  const merged: Array<{ time: string; text: string }> = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (!previous || previous.time !== segment.time) {
      merged.push({ ...segment });
      continue;
    }

    const previousKey = compactComparable(previous.text);
    const currentKey = compactComparable(segment.text);
    if (!currentKey || previousKey === currentKey || previousKey.includes(currentKey)) continue;
    if (currentKey.includes(previousKey)) {
      previous.text = segment.text;
      continue;
    }

    const separator = /[。！？!?]$/.test(previous.text) ? '' : '。';
    previous.text = `${previous.text}${separator}${segment.text}`;
  }
  return merged;
}

function parseTimestampedVoiceover(value: string): Array<{ time: string; text: string }> {
  const lines = String(value || '').split(/\n+/);
  const segments: Array<{ time: string; text: string }> = [];
  const structuredStoryboard = hasStoryboardFieldLabels(lines);
  let currentTime = '';
  let fallbackIndex = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/(?:参考原节奏|参考节奏|原节奏|参考原片|原片|原视频|日文原句|英文原句|韩文原句)/i.test(line)) continue;
    const timeMatch = line.match(/\[([^\]]*?\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:s|秒)?[^\]]*)\]/i);
    const sceneTimeMatch = line.match(/Scene\s+\d+\s*\(([^)]*?\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:s|秒)?[^)]*)\)/i);
    if (timeMatch) currentTime = normalizeTimeLabel(timeMatch[1], fallbackIndex);
    else if (sceneTimeMatch) currentTime = normalizeTimeLabel(sceneTimeMatch[1], fallbackIndex);

    const prefixed = line.match(VOICEOVER_FIELD_RE);
    if (!prefixed && NON_VOICE_FIELD_RE.test(line)) continue;
    const quoted = !prefixed && !structuredStoryboard ? line.match(/[“"]([^”"]{2,})[”"]/) : null;
    const sameLine = timeMatch ? line.replace(timeMatch[0], '').trim() : '';
    let text = quoted?.[1] || prefixed?.[1] || '';
    if (!text && sameLine && !structuredStoryboard
      && !looksLikeProductionInstruction(sameLine)
      && !looksLikeOnScreenOnlyText(sameLine)) text = sameLine;
    text = cleanVoiceoverLine(text);
    if (!text || looksLikeProductionInstruction(text) || isNonSpeechSfx(text)) continue;
    if (!prefixed && looksLikeOnScreenOnlyText(text)) continue;
    segments.push({ time: currentTime || normalizeTimeLabel('', fallbackIndex), text });
    fallbackIndex += 1;
  }
  if (segments.length) return mergeTimestampedVoiceoverSegments(segments);
  if (structuredStoryboard) return [];
  return Array.from(String(value || '').matchAll(/[“"]([^”"]{2,})[”"]/g))
    .map((match, index) => ({ time: normalizeTimeLabel('', index), text: cleanVoiceoverLine(match[1] || '') }))
    .filter(item => item.text && !isNonSpeechSfx(item.text) && !looksLikeOnScreenOnlyText(item.text));
}


function formatVoiceoverWithTimestamps(value: string): string {
  const parsed = parseTimestampedVoiceover(value).filter(item => !isNonSpeechSfx(item.text));
  if (parsed.length) return parsed.map(item => `${item.time} ${item.text}`).join('\n');
  const fallback = cleanVoiceoverLine(value);
  return isNonSpeechSfx(fallback) ? '' : fallback;
}

function stripCloneAnalysisSummary(value: string): string {
  const text = String(value || '').trim();
  if (!text) return '';
  const forbiddenBlockRe = /^\s*(?:【?\s*)?(?:基础要求|分析摘要|竞品识别|产品替换|参考爆款|成片目标|指定画风|核心情绪|参考品牌|口播语言|爆点拆解|产品承接|Purpose|Creative style|Core emotion|Product replacement|Voiceover language|Goal|Storyboard)(?:\s*】)?\s*[：:].*$/i;
  const firstTimestamp = text.search(/(?:^|\n)\s*(?:\[\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*\]|Scene\s+\d+\s*\()/i);
  if (firstTimestamp > 0) {
    const head = text.slice(0, firstTimestamp);
    if (/基础要求|分析摘要|竞品识别|产品替换|参考爆款|成片目标|指定画风|核心情绪|对标视频|参考品牌|口播语言/.test(head)) {
      return text.slice(firstTimestamp).trim();
    }
  }
  return text
    .split(/\n+/)
    .filter(line => !forbiddenBlockRe.test(line))
    .join('\n')
    .trim();
}

function compactComparable(value: string): string {
  return String(value || '')
    .replace(/[“”"「」『』\s，,。.!！?？;；:：、/\\-]/g, '')
    .toLowerCase();
}

function isExplicitNoVoiceMarker(value: string): boolean {
  return /^(?:无|none|no\s+voiceover)$/i.test(cleanVoiceoverLine(value).replace(/[。.!！]$/, '').trim());
}

function enforceScriptProduct(value: string, productInfo: string, strictProductName?: string): string {
  const productName = compact(strictProductName) || selectedProductLabel(productInfo);
  let next = stripCloneAnalysisSummary(value);
  if (productName) {
    next = next
      .replace(/「企业产品组合」|“企业产品组合”|企业产品组合/g, `「${productName}」`)
      .replace(/「主推产品」|“主推产品”|主推产品/g, `「${productName}」`)
      .replace(/把「[^」]{0,24}企业产品组合[^」]{0,24}」/g, `把「${productName}」`)
      .replace(/\bthis product\b/gi, productName);
  }
  return next;
}

export function sanitizeStoryboardScript(value: string, productInfo: string, strictProductName?: string): string {
  const enforced = enforceScriptProduct(value, productInfo, strictProductName);
  const lines = enforced.split('\n');
  const out: string[] = [];
  let lastVoiceKey = '';
  let currentVoice = '';
  let currentOriginalVoiceKey = '';

  for (const raw of lines) {
    let line = raw.trimEnd();
    line = line
      .replace(/[；;，,]?\s*只参考对标视频的[^。\n]*?(?:。|$)/g, '')
      .replace(/[；;，,]?\s*不继承原视频[^。\n]*?(?:。|$)/g, '')
      .replace(/[；;，,]?\s*第\s*\d+\s*段只参考[^。\n]*?(?:。|$)/g, '')
      .replace(/[；;，,]?\s*行业\/品类\/产品必须替换为[^。\n]*?(?:。|$)/g, '')
      .trimEnd();
    if (!line.trim()) continue;
    if (/^\s*(?:\[\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—]\s*\d+(?:\.\d+)?|Scene\s+\d+\s*\()/i.test(line)) {
      currentVoice = '';
      currentOriginalVoiceKey = '';
    }
    const voiceMatch = line.match(/^(\s*(?:人物说|台词|Voiceover|VO|口播)\s*[：:]\s*)(.+)$/i);
    if (voiceMatch) {
      const prefix = voiceMatch[1] || '';
      const originalVoice = cleanVoiceoverLine(voiceMatch[2] || '');
      currentOriginalVoiceKey = compactComparable(originalVoice);
      if (isExplicitNoVoiceMarker(originalVoice)) {
        currentVoice = originalVoice;
        out.push(`${prefix}${originalVoice}`);
        continue;
      }
      const voice = humanizeVoiceLine(voiceMatch[2] || '');
      const key = compactComparable(voice);
      if (!voice || (key && key === lastVoiceKey)) continue;
      currentVoice = voice;
      lastVoiceKey = key;
      out.push(`${prefix}${voice}`);
      continue;
    }

    const subtitleMatch = line.match(/^(\s*(?:字幕|Subtitle|Caption)\s*[：:]\s*)(.+)$/i);
    if (subtitleMatch) {
      const subtitle = cleanVoiceoverLine(subtitleMatch[2] || '');
      const subtitleKey = compactComparable(subtitle);
      const voiceKey = compactComparable(currentVoice);
      if (!subtitle) continue;
      // A subtitle mirroring narration is required storyboard structure, not
      // duplicate prose. Preserve the field and keep it synchronized if the
      // narration was humanized above.
      const mirrorsVoice = Boolean(voiceKey && (subtitleKey === voiceKey || voiceKey.includes(subtitleKey) || subtitleKey.includes(voiceKey)))
        || Boolean(currentOriginalVoiceKey && (subtitleKey === currentOriginalVoiceKey
          || currentOriginalVoiceKey.includes(subtitleKey)
          || subtitleKey.includes(currentOriginalVoiceKey)));
      out.push(`${subtitleMatch[1]}${mirrorsVoice ? currentVoice : subtitle}`);
      continue;
    }

    out.push(line);
  }

  return normalizeScriptTimestamps(out.join('\n').replace(/\n{3,}/g, '\n\n').trim());
}

function stripVoiceoverTimestamps(value: string): string {
  return String(value || '')
    .split(/\n+/)
    .map(line => cleanVoiceoverLine(line))
    .filter(Boolean)
    .join('\n');
}

function isBadTranslatedLine(text: string, target: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return true;
  const hanCount = (normalized.match(/[\u4e00-\u9fff]/g) || []).length;
  const letterCount = (normalized.match(/\p{L}/gu) || []).length;
  if (target !== 'zh' && hanCount >= 6 && hanCount / Math.max(1, letterCount) > 0.45) return true;
  if (/主推品|适合展示|产品替换|参考爆款|参考节奏|我方画面/.test(normalized)) return true;
  return looksLikeProductionInstruction(normalized);
}

function isNonSpeechSfx(text: string): boolean {
  const normalized = String(text || '')
    .replace(/[\s"'“”‘’.,，。!！?？~～…·:：;；-]/g, '')
    .trim()
    .toLowerCase();
  if (!normalized) return true;
  if (/^(无|暂无|无口播|无台词|无对白|没有口播|没有台词|none|n\/a|no voiceover|no dialogue)$/i.test(normalized)) return true;
  if (/^(噗|噗噗|砰|砰砰|咚|咚咚|哒|哒哒|啪|啪啪|嗒|嗒嗒|咔|咔哒|咔嗒|咔嚓|咯吱|嘎吱|吱呀|叮|叮咚|嘀|滴滴|唰|嗖|嗡|嗡嗡|轰|轰隆|沙沙|刷刷)$/i.test(normalized)) return true;
  if (/^(whoosh|swoosh|pop|popop|bang|boom|ding|beep|click|clack|creak|crack|snap|buzz|whirr|rustle)$/i.test(normalized)) return true;
  if (normalized.length <= 4 && /^([\u54c8\u563f\u5566\u5662\u7830\u549a\u53ee\u6ef4\u54d2\u55d2\u556a\u54d7\u55d2\u5530\u55e1\u5431\u5494\u55d2])\1+$/.test(normalized)) return true;
  return false;
}

function normalizeTranslatedVoiceover(base: string, translated: string, target: string): string {
  const source = parseTimestampedVoiceover(base).filter(item => !isNonSpeechSfx(item.text));
  const parsed = parseTimestampedVoiceover(translated);
  if (!source.length) {
    const plain = translated.trim();
    return isBadTranslatedLine(plain, target) ? '' : plain;
  }
  const rawCandidates = parsed.length
    ? parsed.map(item => item.text)
    : String(translated || '').split(/\n+/).map(line => cleanVoiceoverLine(line)).filter(Boolean);
  const candidates = rawCandidates
    .map(item => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (candidates.length !== source.length) return '';
  const uniqueTranslatedLines = new Set(candidates.map(item => item.toLowerCase()));
  const looksRepeated = candidates.length >= 4 && uniqueTranslatedLines.size === 1;
  const used = new Set<string>();
  const lines: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const item = source[index]!;
    const candidate = candidates[index] || '';
    const key = candidate.replace(/\s+/g, ' ').trim().toLowerCase();
    const duplicate = Boolean(key && used.has(key));
    if (key) used.add(key);
    if (looksRepeated || duplicate || isBadTranslatedLine(candidate, target)) return '';
    lines.push(`${item.time} ${candidate}`);
  }
  return lines.join('\n');
}

function resolveTranslatedVoiceover(base: string, translated: string, target: string): string {
  const raw = normalizeScriptTimestamps(String(translated || '')).trim();
  if (!raw) return '';
  const aligned = normalizeTranslatedVoiceover(base, raw, target);
  if (aligned.trim()) return aligned;

  // The model can return a valid localized script whose line structure is not
  // identical to the extracted source (for example after omitting an SFX or
  // merging a very short cue). Do not discard the whole translation merely
  // because the stricter index-based aligner could not rebuild every line.
  const spoken = stripVoiceoverTimestamps(raw).trim();
  if (!spoken || isBadTranslatedLine(spoken, target)) return '';
  const sourceCueCount = parseTimestampedVoiceover(base).filter(item => !isNonSpeechSfx(item.text)).length;
  const translatedCueCount = parseTimestampedVoiceover(raw).filter(item => !isNonSpeechSfx(item.text)).length;
  if (sourceCueCount > 0 && translatedCueCount !== sourceCueCount) return '';
  return raw;
}

const VOICE_TRANSLATION_BATCH_TIMEOUT_MS = 100_000;
const VOICE_TRANSLATION_SINGLE_TIMEOUT_MS = 70_000;

async function runVoiceTranslationWithTimeout<T>(
  request: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort();
  if (parentSignal.aborted) controller.abort();
  else parentSignal.addEventListener('abort', abortFromParent, { once: true });
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await request(controller.signal);
  } catch (error) {
    if (timedOut && !parentSignal.aborted) {
      throw new Error(`翻译请求超过 ${Math.round(timeoutMs / 1000)} 秒，已自动停止等待`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    parentSignal.removeEventListener('abort', abortFromParent);
  }
}

/* ── 缩略图与不可预览状态 ──────────────────────────────────────────────── */
function Thumb({ seed: _seed, label, ratio = 'aspect-video', src }: { seed: string; label?: string; ratio?: string; src?: string }) {
  const fallbackSrc = src;
  if (fallbackSrc) {
    return (
      <div className={`relative w-full ${ratio} overflow-hidden rounded-lg bg-surface-2`}>
        <img src={fallbackSrc} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
        {label && (
          <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-white bg-black/45">{label}</span>
        )}
      </div>
    );
  }
  return (
    <div className={`relative flex w-full ${ratio} items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-100 text-slate-400`}>
      <div className="flex flex-col items-center gap-1">
        <ImageIcon size={20} aria-hidden="true" />
        <span className="text-[9px] font-semibold">预览不可用</span>
      </div>
      {label && (
        <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-white bg-black/45">
          {label}
        </span>
      )}
    </div>
  );
}

function FirstVideoFrameThumb({ clip }: { clip: Clip }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setReady(false);
    setFailed(false);
  }, [clip.id, clip.url]);

  if (!clip.url || failed) return <Thumb seed={clip.id} ratio="aspect-video" />;
  return (
    <div className="relative w-full aspect-video overflow-hidden rounded-lg bg-surface-2">
      {!ready && <div className="absolute inset-0 animate-pulse bg-slate-200" />}
      <video
        ref={videoRef}
        src={clip.url}
        muted
        playsInline
        preload="auto"
        className={`absolute inset-0 h-full w-full object-cover ${ready ? 'opacity-100' : 'opacity-0'}`}
        onLoadedData={() => {
          const video = videoRef.current;
          if (!video) return;
          const target = Number.isFinite(video.duration) && video.duration > 0
            ? Math.min(0.05, video.duration / 2)
            : 0;
          if (target <= 0) { setReady(true); return; }
          try { video.currentTime = target; } catch { setReady(true); }
        }}
        onSeeked={() => setReady(true)}
        onError={() => { setReady(true); setFailed(true); }}
      />
    </div>
  );
}

function ProjectFirstFrameThumb({ project, materials }: { project: StudioProject; materials: Clip[] }) {
  const spec = project.spec || {};
  const assemblies = Array.isArray(spec.storyboardAssemblies)
    ? spec.storyboardAssemblies as Array<{ id?: string; assignments?: Record<string, string>; selected?: string[] }>
    : [];
  const activeAssemblyId = typeof spec.activeAssemblyId === 'string' ? spec.activeAssemblyId : '';
  const assembly = assemblies.find(item => item.id === activeAssemblyId) || assemblies[0];
  const legacyAssignments = spec.storyboardAssignments && typeof spec.storyboardAssignments === 'object'
    ? spec.storyboardAssignments as Record<string, string>
    : {};
  const legacySelected = Array.isArray(spec.selected) ? spec.selected.filter((id): id is string => typeof id === 'string') : [];
  const firstMaterialId = [
    ...Object.values(assembly?.assignments || {}),
    ...(assembly?.selected || []),
    ...Object.values(legacyAssignments),
    ...legacySelected,
  ].find(Boolean);
  const clip = firstMaterialId ? materials.find(item => item.id === firstMaterialId) : undefined;

  if (!clip) return <Thumb seed={project.thumbSeed ?? firstMaterialId ?? 'cv1'} ratio="aspect-video" />;
  if (clip.poster || clip.type === 'image') {
    return <Thumb seed={clip.id} ratio="aspect-video" src={clip.poster || clip.url} />;
  }
  if (clip.type === 'video') return <FirstVideoFrameThumb clip={clip} />;
  return <Thumb seed={clip.id} ratio="aspect-video" />;
}

const VIDEO_THUMB_CACHE = new Map<string, string>();

/* 真实素材的缩略图：优先服务端 poster；缺失/失效时在浏览器取约 1 秒处画面并缓存。 */
function RealThumb({ clip, onSourceError }: { clip: Clip; onSourceError?: () => void }) {
  const label = clip.type === 'image' ? 'IMG' : `0:${String(clip.duration).padStart(2, '0')}`;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [posterFailed, setPosterFailed] = useState(false);
  const [capturedPoster, setCapturedPoster] = useState(() => VIDEO_THUMB_CACHE.get(clip.id) || '');
  const [frameReady, setFrameReady] = useState(false);

  useEffect(() => {
    setPosterFailed(false);
    setCapturedPoster(VIDEO_THUMB_CACHE.get(clip.id) || '');
    setFrameReady(false);
  }, [clip.id, clip.poster, clip.url]);

  const seekThumbnailFrame = () => {
    const video = videoRef.current;
    if (!video) return;
    const videoDuration = Number.isFinite(video.duration) ? video.duration : Number(clip.duration || 0);
    const target = Math.max(0.05, Math.min(1, videoDuration > 0 ? videoDuration * 0.2 : 1));
    try { video.currentTime = target; } catch { setFrameReady(true); }
  };
  const captureThumbnailFrame = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) return;
    setFrameReady(true);
    try {
      const width = 480;
      const height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.drawImage(video, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.76);
      VIDEO_THUMB_CACHE.set(clip.id, dataUrl);
      setCapturedPoster(dataUrl);
    } catch {
      // 即使浏览器禁止 canvas 抽帧，已 seek 的 video 元素仍可直接显示该帧。
    }
  };
  const useServerPoster = Boolean(clip.poster && !posterFailed);
  return (
    <div className="relative w-full aspect-video overflow-hidden rounded-lg bg-surface-2">
      {clip.type === 'image' && (
        <img src={clip.url} alt={clip.name} className="w-full h-full object-cover" loading="lazy" onError={() => { setPosterFailed(true); onSourceError?.(); }} />
      )}
      {clip.type === 'video' && (
        <>
          {useServerPoster && (
            <img
              src={clip.poster}
              alt={clip.name}
              className="absolute inset-0 h-full w-full object-cover"
              loading="eager"
              draggable={false}
              onError={() => { setPosterFailed(true); onSourceError?.(); }}
            />
          )}
          {!useServerPoster && (capturedPoster
            ? <img src={capturedPoster} alt={clip.name} className="h-full w-full object-cover" draggable={false} />
            : <>
                {!frameReady && <div className="absolute inset-0 animate-pulse bg-slate-200" />}
                <video
                  ref={videoRef}
                  src={clip.url}
                  muted
                  playsInline
                  preload="metadata"
                  className={`h-full w-full object-cover transition-opacity ${frameReady ? 'opacity-100' : 'opacity-0'}`}
                  onLoadedMetadata={seekThumbnailFrame}
                  onLoadedData={seekThumbnailFrame}
                  onSeeked={captureThumbnailFrame}
                  onError={() => { setFrameReady(true); onSourceError?.(); }}
                />
              </>)}
        </>
      )}
      {clip.type === 'audio' && (
        <div className="w-full h-full flex items-center justify-center"><Music size={20} className="text-text-muted" /></div>
      )}
      <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-white bg-black/45">{label}</span>
    </div>
  );
}

/* 封面预览：优先用已生成的封面 SVG；否则用所选帧 + 标题叠层。
   字号用 cqw（容器宽度百分比）与 SVG 的 fontSize 比例一致，预览即所见。 */
const WEIGHT_MAP = { regular: 600, bold: 800, heavy: 900 } as const;
function coverArtCss(style: CoverStyle): React.CSSProperties {
  switch (style.artPreset) {
    case 'outline':
      return { WebkitTextStroke: '0.08em #111827', paintOrder: 'stroke fill', textShadow: '0 0.08em 0 rgba(0,0,0,.7)' };
    case 'highlight':
      return { background: '#facc15', color: '#111827', boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone', padding: '0.08em 0.18em', borderRadius: '0.12em', lineHeight: 1.18 };
    case 'magazine':
      return { textTransform: 'uppercase', letterSpacing: '-0.045em', fontStyle: 'italic', textShadow: '0.06em 0.06em 0 #ef4444' };
    case 'neon':
      return { color: '#fff', textShadow: `0 0 0.08em #fff, 0 0 0.22em ${style.color}, 0 0 0.45em ${style.color}` };
    case 'sticker':
      return { color: '#111827', WebkitTextStroke: '0.14em #fff', paintOrder: 'stroke fill', textShadow: '0.13em 0.13em 0 #16a34a' };
    default:
      return {};
  }
}

/** 视频元素本身不会保证在静止状态绘出首帧；主动 seek 后转成 JPEG，供封面预览和最终 SVG 共用。 */
function VideoCoverStill({ src, onFrameReady, onSourceError }: { src: string; onFrameReady?: (dataUrl: string) => void; onSourceError?: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const callbackRef = useRef(onFrameReady);
  const [still, setStill] = useState<string>();
  callbackRef.current = onFrameReady;

  useEffect(() => setStill(undefined), [src]);

  const seekToFrame = () => {
    const video = videoRef.current;
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    video.currentTime = Math.min(duration > 0.3 ? 0.2 : 0, Math.max(0, duration - 0.05));
  };
  const captureFrame = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    try {
      const canvas = document.createElement('canvas');
      const maxWidth = 1080;
      const scale = Math.min(1, maxWidth / video.videoWidth);
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
      setStill(dataUrl);
      callbackRef.current?.(dataUrl);
    } catch {
      // 跨域或解码异常时保留已 seek 的 video 画面，不让候选卡退回空白。
    }
  };

  return (
    <>
      {still && <img src={still} alt="" className="absolute inset-0 h-full w-full object-cover" />}
      <video ref={videoRef} src={src} muted playsInline preload="auto"
        onLoadedMetadata={seekToFrame} onLoadedData={captureFrame} onSeeked={captureFrame}
        onError={onSourceError}
        className={`absolute inset-0 h-full w-full object-cover ${still ? 'invisible' : ''}`} />
    </>
  );
}

function CoverFrameMedia({ frameUrl, frameType, fallbackVideoUrl, onFrameReady, onSourceError }: { frameUrl?: string; frameType?: Clip['type']; fallbackVideoUrl?: string; onFrameReady?: (dataUrl: string) => void; onSourceError?: () => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  const refreshRequestedRef = useRef('');
  useEffect(() => {
    setImageFailed(false);
    refreshRequestedRef.current = '';
  }, [frameUrl, fallbackVideoUrl]);
  const reportSourceError = (source?: string) => {
    if (!source || refreshRequestedRef.current === source) return;
    refreshRequestedRef.current = source;
    onSourceError?.();
  };
  if (frameUrl && frameType === 'video') return <VideoCoverStill src={frameUrl} onFrameReady={onFrameReady} onSourceError={() => reportSourceError(frameUrl)} />;
  if (frameUrl && !imageFailed) return <img src={frameUrl} alt="" className="absolute inset-0 h-full w-full object-cover" onError={() => { setImageFailed(true); reportSourceError(frameUrl); }} />;
  if (fallbackVideoUrl) return <VideoCoverStill src={fallbackVideoUrl} onFrameReady={onFrameReady} onSourceError={() => reportSourceError(fallbackVideoUrl)} />;
  return <div className="absolute inset-0 flex items-center justify-center bg-surface-2 text-xs font-semibold text-text-muted">封面加载失败，请重新选择素材</div>;
}

function CoverFace({ coverUrl, frameUrl, frameType, fallbackVideoUrl, title, style, editable, onTitleChange, onStyleChange, onFrameReady, onSourceError }: { coverUrl?: string | null; frameUrl?: string; frameType?: Clip['type']; fallbackVideoUrl?: string; title: string; style: CoverStyle; editable?: boolean; onTitleChange?: (t: string) => void; onStyleChange?: (style: CoverStyle) => void; onFrameReady?: (dataUrl: string) => void; onSourceError?: () => void }) {
  const dragRef = useRef<{ pointerId: number; startY: number; startPosition: number; height: number } | null>(null);
  if (coverUrl) return <img src={coverUrl} alt="封面" className="absolute inset-0 w-full h-full object-cover" />;
  const verticalPosition = style.verticalPosition ?? (style.position === 'top' ? 14 : style.position === 'center' ? 50 : 86);
  const cqw = style.size === 'S' ? 6.2 : style.size === 'L' ? 9.8 : 7.8;
  const scrimPosition = verticalPosition < 34 ? 'top' : verticalPosition > 66 ? 'bottom' : 'center';
  const scrim = scrimPosition === 'top'
    ? 'linear-gradient(to bottom, rgba(0,0,0,0.6), transparent 52%)'
    : scrimPosition === 'center'
      ? 'rgba(0,0,0,0.3)'
      : 'linear-gradient(to top, rgba(0,0,0,0.6), transparent 52%)';
  const titleStyle: React.CSSProperties = {
    width: '100%', color: style.color, fontSize: `${cqw}cqw`,
    fontWeight: WEIGHT_MAP[style.weight ?? 'bold'],
    textAlign: style.align, fontFamily: style.fontFamily ?? fontCss(style.font),
    ...coverArtCss(style),
  };
	  const startTitleDrag = (event: React.PointerEvent<HTMLDivElement>) => {
	    if (!editable || !onStyleChange) return;
	    event.stopPropagation();
	    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
	    if (!bounds?.height) return;
	    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startPosition: verticalPosition, height: bounds.height };
	    event.currentTarget.setPointerCapture(event.pointerId);
	  };
	  const moveTitle = (event: React.PointerEvent<HTMLDivElement>) => {
	    const drag = dragRef.current;
	    if (!drag || drag.pointerId !== event.pointerId || !onStyleChange) return;
	    const next = Math.max(8, Math.min(92, drag.startPosition + ((event.clientY - drag.startY) / drag.height) * 100));
	    onStyleChange({
	      ...style,
	      position: next < 34 ? 'top' : next > 66 ? 'bottom' : 'center',
	      verticalPosition: Math.round(next * 10) / 10,
	    });
	  };
	  const stopTitleDrag = (event: React.PointerEvent<HTMLDivElement>) => {
	    if (dragRef.current?.pointerId !== event.pointerId) return;
	    dragRef.current = null;
	    event.currentTarget.releasePointerCapture(event.pointerId);
	  };
	  return (
	    <div className="absolute inset-0" style={{ containerType: 'inline-size' }}>
	      <CoverFrameMedia frameUrl={frameUrl} frameType={frameType} fallbackVideoUrl={fallbackVideoUrl} onFrameReady={onFrameReady} onSourceError={onSourceError} />
      <div className="pointer-events-none absolute inset-0" style={{ background: scrim }} />
      <div
        className={`absolute inset-x-[5cqw] -translate-y-1/2 ${editable ? 'pointer-events-auto cursor-ns-resize touch-none select-none' : ''}`}
        style={{ top: `${verticalPosition}%` }}
        onPointerDown={startTitleDrag}
        onPointerMove={moveTitle}
        onPointerUp={stopTitleDrag}
        onPointerCancel={stopTitleDrag}
        title={editable ? '上下拖动可批量调整所有封面的标题位置；点击文字可编辑' : undefined}
      >
        {editable ? (
          // 直接在封面上唤起文本框编辑标题（失焦提交）
          <p contentEditable suppressContentEditableWarning spellCheck={false}
            onClick={e => e.stopPropagation()}
            onBlur={e => onTitleChange?.(e.currentTarget.textContent ?? '')}
            className="leading-tight outline-none rounded-[1cqw]"
            style={{ ...titleStyle, boxShadow: '0 0 0 0.4cqw rgba(255,255,255,0.55)' }}>
            {title}
          </p>
        ) : (
          <p className="leading-tight" style={titleStyle}>{title}</p>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════ */

function VariationChipEditor({
  label,
  hint,
  value,
  suggestions,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  suggestions: string[];
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const items = value.split(/[，,\n]/).map(item => item.trim()).filter(Boolean);
  const commit = (candidate = draft) => {
    const additions = candidate.split(/[，,\n]/).map(item => item.trim()).filter(Boolean);
    if (!additions.length) return;
    onChange([...new Set([...items, ...additions])].join('，'));
    setDraft('');
  };
  const remove = (item: string) => onChange(items.filter(current => current !== item).join('，'));

  return (
    <div className="rounded-xl border border-border bg-surface p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-text-primary">{label}</p>
          <p className="mt-0.5 text-[10px] text-text-muted">{hint}</p>
        </div>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-text-secondary">{items.length || 0} 个</span>
      </div>
      <div className="mt-2.5 flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface-2 p-1.5 focus-within:border-accent">
        {items.map(item => (
          <span key={item} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium text-text-primary shadow-sm">
            {item}
            <button type="button" onClick={() => remove(item)} className="text-text-muted hover:text-red-500" aria-label={`删除${item}`}><X size={11} /></button>
          </span>
        ))}
        <input
          value={draft}
          onChange={event => {
            const next = event.target.value;
            if (/[，,\n]$/.test(next)) commit(next);
            else setDraft(next);
          }}
          onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); commit(); }
            if (event.key === 'Backspace' && !draft && items.length) remove(items[items.length - 1]!);
          }}
          onBlur={() => commit()}
          placeholder={items.length ? '继续添加…' : '输入后按回车添加'}
          className="min-w-28 flex-1 bg-transparent px-1 py-1 text-[11px] text-text-primary outline-none placeholder:text-text-muted"
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] text-text-muted">快捷添加</span>
        {suggestions.filter(item => !items.includes(item)).slice(0, 4).map(item => (
          <button key={item} type="button" onMouseDown={event => event.preventDefault()} onClick={() => commit(item)}
            className="rounded-md bg-surface-2 px-2 py-1 text-[10px] text-text-secondary transition hover:bg-accent/10 hover:text-accent">
            + {item}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function AiCreateStudio({ onNavigate, onGoPublish, openProjectsSignal = 0, workflowContext, publishStorageScope }: { onNavigate?: (p: Page) => void; onGoPublish?: (payload: StudioPublishPayload) => void; openProjectsSignal?: number; workflowContext?: StudioWorkflowContext; publishStorageScope?: string } = {}) {
  const [stepIdx, setStepIdx] = useState(0);
  const [activeStoryboardSlotId, setActiveStoryboardSlotId] = useState('');
  const [canvasView, setCanvasView] = useState<'reference' | 'creation'>('creation');
  const [showSetupMaterialPicker, setShowSetupMaterialPicker] = useState(false);
  const [showFullScriptEditor, setShowFullScriptEditor] = useState(false);

  // 全局制作状态
  const [mode, setMode] = useState<'material' | 'clone' | 'product'>('material');
  const [migrationMode, setMigrationMode] = useState<MigrationMode>('structure');
  const [contentMode, setContentMode] = useState<'video' | 'poster'>('video');
  const activeSteps = useMemo(() => contentMode === 'poster' ? POSTER_STEPS : STEPS, [contentMode]);
  const activeStages = useMemo(() => contentMode === 'poster' ? POSTER_STAGES : VIDEO_STAGES, [contentMode]);
  const step = activeSteps[Math.min(stepIdx, activeSteps.length - 1)].id;
  const stageIdx = Math.max(0, activeStages.findIndex(stage => stage.steps.includes(step)));
  const [showAdvancedSetup, setShowAdvancedSetup] = useState(false);
  const [posterStyle, setPosterStyle] = useState<(typeof POSTER_STYLES)[number]['id']>('oem-factory');
  const [platform, setPlatform] = useState('tiktok');
  const [ratio, setRatio] = useState('9:16');
  const [duration, setDuration] = useState(20);
  const [lang, setLang] = useState('zh');
  const [provider, setProvider] = useState<'gemini' | 'qwen'>('qwen');
  const [productInfo, setProductInfo] = useState('');
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [productSelectMode, setProductSelectMode] = useState<'single' | 'multi'>('multi');
  const [productSearch, setProductSearch] = useState('');
  const [productCategoryFilter, setProductCategoryFilter] = useState('');
  const [showSelectedProductsOnly, setShowSelectedProductsOnly] = useState(false);
  const [productSelectorOpen, setProductSelectorOpen] = useState(false);
  const productSelectorRef = useRef<HTMLDivElement>(null);
  const [cloneCount] = useState(1);
  const [cloneOutputMode, setCloneOutputMode] = useState<'ideas' | 'languages'>('ideas');
  const [audience, setAudience] = useState('');
  const [primaryCta, setPrimaryCta] = useState(DEFAULT_VIDEO_CONVERSION_GOAL);
  const [cooperationRoute, setCooperationRoute] = useState('');
  const [availableCooperationRoutes, setAvailableCooperationRoutes] = useState<string[]>([]);
  const [enterpriseRouteStrategies, setEnterpriseRouteStrategies] = useState<Record<string, { targetBuyerRoles?: string[]; primaryCta?: string }>>({});
  const [enterprisePrimaryCta, setEnterprisePrimaryCta] = useState('');
  const [sellingPoints, setSellingPoints] = useState('');
  const [tone, setTone] = useState('高转化 · 口语化');
  const [videoThemeId, setVideoThemeId] = useState<VideoThemeId>('buyer_pain');
  const [presenterMode, setPresenterMode] = useState<PresenterMode>('real');
  const [themePainPoint, setThemePainPoint] = useState(VIDEO_THEMES[0]!.painPoint);
  const [themeConversionGoal, setThemeConversionGoal] = useState(DEFAULT_VIDEO_CONVERSION_GOAL);
  const [variationPeople, setVariationPeople] = useState('原人物');
  const [variationScenes, setVariationScenes] = useState('原场景');
  const [variationLanguages, setVariationLanguages] = useState('中文');
  const [variationHooks, setVariationHooks] = useState('原钩子');
  const [variationMax, setVariationMax] = useState(6);
  const [variationStrategy, setVariationStrategy] = useState<VariationStrategy>('hybrid');
  const [variationBatchCreating, setVariationBatchCreating] = useState(false);
  const [variationBatchState, setVariationBatchState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [variationBatches, setVariationBatches] = useState<VariationBatch[]>([]);

  useDismissibleLayer(productSelectorOpen, productSelectorRef, () => setProductSelectorOpen(false));
  const splitVariations = (value: string) => value.split(/[，,\n]/).map(item => item.trim()).filter(Boolean);
  const activeVideoTheme = VIDEO_THEMES.find(item => item.id === videoThemeId) || VIDEO_THEMES[0]!;
  const effectivePrimaryCta = enterprisePrimaryCta.trim() || primaryCta.trim();
  const applyInferredMaterialTheme = (material: Pick<Material, 'name' | 'folder' | 'shotFunction' | 'tags' | 'segments'>) => {
    const inferredId = inferVideoThemeFromMaterial(material);
    const inferred = VIDEO_THEMES.find(item => item.id === inferredId) || VIDEO_THEMES[0]!;
    setVideoThemeId(inferred.id);
    setThemePainPoint(inferred.painPoint);
    setThemeConversionGoal(DEFAULT_VIDEO_CONVERSION_GOAL);
  };
  const videoThemePayload = {
    id: activeVideoTheme.id,
    title: activeVideoTheme.title,
    painPoint: audience.trim() || activeVideoTheme.painPoint,
    conversionGoal: effectivePrimaryCta || DEFAULT_VIDEO_CONVERSION_GOAL,
    primaryCta: effectivePrimaryCta || DEFAULT_VIDEO_CONVERSION_GOAL,
    cooperationRoute,
    presenterMode,
  };
  const variationDimensionConfig = variationStrategy === 'remix' ? [
    { label: '素材组合规则', hint: '从真实素材库选择不同组合', value: variationPeople, setter: setVariationPeople, suggestions: ['自动优选素材组', '产品实拍优先', '工厂素材优先', '人物口播优先'] },
    { label: '剪辑节奏', hint: '只改变剪辑结构和镜头密度', value: variationScenes, setter: setVariationScenes, suggestions: ['沿用原节奏', '快切版', '证据链版', '产品特写版'] },
    { label: '语言版本', hint: '基于已确认脚本生成多语版本', value: variationLanguages, setter: setVariationLanguages, suggestions: ['中文', 'English', 'Español', 'العربية'] },
    { label: '开场变体', hint: '替换前三秒，后续沿用真实素材', value: variationHooks, setter: setVariationHooks, suggestions: ['沿用原钩子', '痛点提问', '结果先行', '买家质疑'] },
  ] : variationStrategy === 'recreate' ? [
    { label: '人物生成约束', hint: '从对标分镜提取，后续上传人物参考', value: variationPeople, setter: setVariationPeople, suggestions: ['沿用对标人物设定', '产品经理口播', '采购经理视角', '工程师演示'] },
    { label: '场景生成约束', hint: '按对标构图生成新的场景素材', value: variationScenes, setter: setVariationScenes, suggestions: ['沿用对标场景结构', '工厂实景风', '展会演示风', '客户应用场景'] },
    { label: '语言版本', hint: '为每条新素材生成对应口播', value: variationLanguages, setter: setVariationLanguages, suggestions: ['中文', 'English', 'Español', 'العربية'] },
    { label: '钩子重制规则', hint: '保持镜头功能，替换表达内容', value: variationHooks, setter: setVariationHooks, suggestions: ['沿用原钩子', '痛点提问', '结果先行', '事实反差'] },
  ] : [
    { label: '主体保真规则', hint: '决定哪些人物与产品必须真实', value: variationPeople, setter: setVariationPeople, suggestions: ['关键镜头保真', '产品必须真实', '人物可AI替换', '口播人物固定'] },
    { label: '逐镜来源规则', hint: '系统推荐本地、AI或融合素材', value: variationScenes, setter: setVariationScenes, suggestions: ['逐镜自动决策', '真实素材优先', 'AI场景优先', '关键镜头融合'] },
    { label: '语言版本', hint: '生成独立口播与字幕版本', value: variationLanguages, setter: setVariationLanguages, suggestions: ['中文', 'English', 'Español', 'العربية'] },
    { label: '开场变体', hint: '钩子可AI重制，正文按镜头决策', value: variationHooks, setter: setVariationHooks, suggestions: ['沿用原钩子', '痛点提问', '结果先行', '买家质疑'] },
  ];
  const createVariationBatch = async () => {
    setVariationBatchCreating(true);
    setVariationBatchState('idle');
    try {
      const result = await studioApi.createVariationBatch({
        title: projectTitle.trim() || '爆款裂变批次', templateProjectId: projectId || undefined, duration, maxItems: variationMax,
        dimensions: {
          strategy: [variationStrategy],
          product: selectedProductIds.length ? selectedProductIds : ['当前产品'],
          person: splitVariations(variationPeople).length ? splitVariations(variationPeople) : ['原人物'],
          scene: splitVariations(variationScenes).length ? splitVariations(variationScenes) : ['原场景'],
          language: splitVariations(variationLanguages).length ? splitVariations(variationLanguages) : ['中文'],
          hook: splitVariations(variationHooks).length ? splitVariations(variationHooks) : ['原钩子'],
        },
        plan: {
          platform, ratio, contentMode, mode, strategy: variationStrategy, duration, maxItems: variationMax,
          productInfo, productSelectMode, selectedProductIds, audience, sellingPoints, tone, language: lang, provider,
          dimensions: {
            product: selectedProductIds.length ? selectedProductIds : ['当前产品'],
            person: splitVariations(variationPeople).length ? splitVariations(variationPeople) : ['原人物'],
            scene: splitVariations(variationScenes).length ? splitVariations(variationScenes) : ['原场景'],
            language: splitVariations(variationLanguages).length ? splitVariations(variationLanguages) : ['中文'],
            hook: splitVariations(variationHooks).length ? splitVariations(variationHooks) : ['原钩子'],
          },
        },
      });
      if (!result.ok || !result.batch) throw new Error('save_failed');
      setVariationBatches(current => [result.batch, ...current.filter(item => item.id !== result.batch.id)]);
      setVariationBatchState('saved');
      setShowProjects(true);
    } catch {
      setVariationBatchState('error');
    } finally {
      setVariationBatchCreating(false);
    }
  };

  const [activeFolder, setActiveFolder] = useState('recommend');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [hookMaterialId, setHookMaterialId] = useState('');
  const [scriptRecommendedMaterialIds, setScriptRecommendedMaterialIds] = useState<string[]>([]);
  const [storyboardAssignments, setStoryboardAssignments] = useState<Record<string, string>>({});
  const [storyboardSourcePlans, setStoryboardSourcePlans] = useState<Record<string, StoryboardSourcePlan>>({});
  const [storyboardGenerating, setStoryboardGenerating] = useState<Record<string, boolean>>({});
  const [storyboardQualityChecking, setStoryboardQualityChecking] = useState<Record<string, boolean>>({});
  const [assemblyName, setAssemblyName] = useState('视频1');
  const [activeAssemblyId, setActiveAssemblyId] = useState('video-1');
  const [storyboardAssemblies, setStoryboardAssemblies] = useState<StoryboardAssembly[]>([
    { id: 'video-1', name: '视频1', assignments: {}, sourcePlans: {}, selected: [] },
  ]);
  const activateContentPlan = (targetId: string) => {
    if (targetId === activeAssemblyId) return;
    const target = storyboardAssemblies.find(item => item.id === targetId);
    if (!target) return;
    const current: StoryboardAssembly = { id: activeAssemblyId, name: assemblyName, assignments: storyboardAssignments, sourcePlans: storyboardSourcePlans, selected };
    setStoryboardAssemblies(items => items.map(item => item.id === activeAssemblyId ? current : item));
    setActiveAssemblyId(target.id); setAssemblyName(target.name); setStoryboardAssignments(target.assignments); setStoryboardSourcePlans(target.sourcePlans); setSelected(target.selected);
  };
  const configureVariationStrategy = (strategy: VariationStrategy) => {
    setVariationStrategy(strategy);
    setStoryboardSourcePlans({});
    if (strategy === 'remix') {
      setVariationPeople('自动优选素材组'); setVariationScenes('沿用原节奏'); setVariationLanguages('中文'); setVariationHooks('沿用原钩子');
    } else if (strategy === 'recreate') {
      setVariationPeople('沿用对标人物设定'); setVariationScenes('沿用对标场景结构'); setVariationLanguages('中文'); setVariationHooks('沿用原钩子');
    } else {
      setVariationPeople('关键镜头保真'); setVariationScenes('逐镜自动决策'); setVariationLanguages('中文'); setVariationHooks('沿用原钩子');
    }
  };

  const [materials, setMaterials] = useState<Clip[]>([]);
  const [previewClip, setPreviewClip] = useState<Clip | null>(null);
  const [uploading, setUploading] = useState(false);
  const [digitalHumanLoading, setDigitalHumanLoading] = useState(false);
  const [digitalHumanNotice, setDigitalHumanNotice] = useState('');
  const [digitalHumanMode, setDigitalHumanMode] = useState<'fast' | 'quality'>('quality');
  const [digitalHumanVoiceStrategy, setDigitalHumanVoiceStrategy] = useState<'smart' | 'brand' | 'person'>('smart');
  const [digitalHumanConsent, setDigitalHumanConsent] = useState(false);
  const [digitalHumanCapabilities, setDigitalHumanCapabilities] = useState<DigitalHumanCapabilities | null>(null);
  const [digitalHumanJob, setDigitalHumanJob] = useState<DigitalHumanJob | null>(null);
  const [shotDigitalHumanBindings, setShotDigitalHumanBindings] = useState<Record<string, ShotDigitalHumanBinding>>({});
  const [shotMediaModes, setShotMediaModes] = useState<Record<string, 'material' | 'digital'>>({});
  const [shotPreferredAvatarIds, setShotPreferredAvatarIds] = useState<Record<string, string>>({});
  const [preferredDigitalHumanAvatarId, setPreferredDigitalHumanAvatarId] = useState('');
  const [avatarPickerSlotId, setAvatarPickerSlotId] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [script, setScript] = useState('');
  const [scriptType, setScriptType] = useState<'voiceover' | 'storyboard'>('voiceover');
  const [voice, setVoice] = useState('v2');
  const [voiceCandidates, setVoiceCandidates] = useState<string[]>(['v2']);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [voiceoverLines, setVoiceoverLines] = useState('');
  const [voiceLangs, setVoiceLangs] = useState<string[]>([]);
  const [enterpriseVoiceLangs, setEnterpriseVoiceLangs] = useState<string[]>([]);
  const [activeVoiceLang, setActiveVoiceLang] = useState('zh');
  const storyboardScriptLanguage = script.trim()
    ? detectScriptLanguageCode(script)
    : '';
  const enterpriseScriptLanguage = storyboardScriptLanguage || enterpriseVoiceLangs[0] || voiceLangs[0] || '';
  // The creation form's output-language selector is authoritative. Enterprise
  // languages constrain choices but must not override an explicit selection.
  const selectedScriptLanguage = lang || enterpriseScriptLanguage || 'zh';
  const [voiceDrafts, setVoiceDrafts] = useState<Record<string, string>>({});
  const [voiceDraftStaleLangs, setVoiceDraftStaleLangs] = useState<string[]>([]);
  const [voiceDraftPendingLangs, setVoiceDraftPendingLangs] = useState<string[]>([]);
  const [voiceDraftFailedLangs, setVoiceDraftFailedLangs] = useState<string[]>([]);
  const [voiceDraftDegradedLangs, setVoiceDraftDegradedLangs] = useState<string[]>([]);
  const [voiceDraftLoading, setVoiceDraftLoading] = useState(false);
  const [voiceDraftNotice, setVoiceDraftNotice] = useState('');
  const voiceDraftAbortRef = useRef<AbortController | null>(null);
  const studioSpecEpochRef = useRef(0);
  const scriptTaskRequestRef = useRef(0);
  const [voicePreviewIdx, setVoicePreviewIdx] = useState<number | null>(null);
  const [scriptView, setScriptView] = useState<'timestamp' | 'voiceover'>('timestamp');
  const [scriptPreviewTab, setScriptPreviewTab] = useState('script');
  const [scriptStageTab, setScriptStageTab] = useState<'theme' | 'script' | 'voiceover' | 'audio' | 'subtitle' | 'bgm'>('theme');
  const [showLanguagePicker, setShowLanguagePicker] = useState(false);
  const [showVoiceAdvanced, setShowVoiceAdvanced] = useState(false);
  const [showSubtitleAdvanced, setShowSubtitleAdvanced] = useState(false);
  const [subtitleGenerating, setSubtitleGenerating] = useState(false);
  const [subtitleNotice, setSubtitleNotice] = useState('');
  const [lastGeneratedSetupSignature, setLastGeneratedSetupSignature] = useState('');
  const autoGen = useRef(false); // 标记是否已由入口生成脚本，避免覆盖用户编辑

  useEffect(() => () => voiceDraftAbortRef.current?.abort(), []);

  // 配音 TTS
  const [voiceoverUrl, setVoiceoverUrl] = useState<string | null>(null);
  const [voiceoverDur, setVoiceoverDur] = useState(0);
  const [voiceoverAudios, setVoiceoverAudios] = useState<Record<string, { url: string; duration: number; cues?: SubCue[]; text?: string; alignmentSource?: string; customVoiceStatus?: 'activated' }>>({});
  const [voiceoverStaleLangs, setVoiceoverStaleLangs] = useState<string[]>([]);
  const [alignedCuesByLang, setAlignedCuesByLang] = useState<Record<string, SubCue[]>>({});
  const [ttsLanguageSettings, setTtsLanguageSettings] = useState<Record<string, LanguageTtsSettings>>({});
  const activeTtsSettings = ttsLanguageSettings[activeVoiceLang] || DEFAULT_TTS_SETTINGS;
  const patchActiveTtsSettings = (patch: Partial<LanguageTtsSettings>) => {
    setTtsLanguageSettings(current => ({
      ...current,
      [activeVoiceLang]: { ...(current[activeVoiceLang] || DEFAULT_TTS_SETTINGS), ...patch },
    }));
  };
  const ttsPreset = activeTtsSettings.preset;
  const ttsEmotion = activeTtsSettings.emotion;
  const ttsEmotionIntensity = activeTtsSettings.emotionIntensity;
  const ttsSpeed = activeTtsSettings.speed;
  const ttsPauseStyle = activeTtsSettings.pauseStyle;
  const ttsPronunciationText = activeTtsSettings.pronunciationText;
  const setTtsPreset = (value: TtsStyleOptions['preset']) => patchActiveTtsSettings({ preset: value });
  const setTtsEmotion = (value: string) => patchActiveTtsSettings({ emotion: value });
  const setTtsEmotionIntensity = (value: number) => patchActiveTtsSettings({ emotionIntensity: value });
  const setTtsSpeed = (value: number) => patchActiveTtsSettings({ speed: value });
  const setTtsPauseStyle = (value: LanguageTtsSettings['pauseStyle']) => patchActiveTtsSettings({ pauseStyle: value });
  const setTtsPronunciationText = (value: string) => patchActiveTtsSettings({ pronunciationText: value });
  const [referenceVoiceStrength, setReferenceVoiceStrength] = useState<ReferenceVoiceStrength>('balanced');
  const [useReferenceVoiceStyle, setUseReferenceVoiceStyle] = useState(true);
  const [audioCapabilities, setAudioCapabilities] = useState<StudioAudioCapabilities | null>(null);
  const [minimaxDiagnostic, setMinimaxDiagnostic] = useState('');
  const [minimaxDiagnosing, setMinimaxDiagnosing] = useState(false);
  const [voiceoverMode, setVoiceoverMode] = useState<'unselected' | 'none' | 'ai' | 'upload'>('unselected');
  const [uploadedVoiceName, setUploadedVoiceName] = useState('');
  const [customVoiceId, setCustomVoiceId] = useState('');
  const [customVoiceName, setCustomVoiceName] = useState('');
  const [customVoiceUrl, setCustomVoiceUrl] = useState('');
  const [customVoices, setCustomVoices] = useState<Array<{ voiceId: string; name: string; url: string; duration: number; createdAt: string }>>([]);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsLoadingScope, setTtsLoadingScope] = useState<'all' | 'single' | 'upload' | null>(null);
  const [ttsActiveLangs, setTtsActiveLangs] = useState<string[]>([]);
  const [ttsFailuresByLang, setTtsFailuresByLang] = useState<Record<string, string>>({});
  const ttsRequestRef = useRef(0);
  const batchTtsLoading = ttsLoading && ttsLoadingScope === 'all';
  const singleTtsLoading = ttsLoading && ttsLoadingScope === 'single';
  const [ttsNotice, setTtsNotice] = useState('');
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [ttsCurrentTime, setTtsCurrentTime] = useState(0);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const voiceoverInputRef = useRef<HTMLInputElement>(null);
  const voiceSampleInputRef = useRef<HTMLInputElement>(null);

  const [bgm, setBgm] = useState('');   // 无内置曲库，默认不选
  const [bgmCandidates, setBgmCandidates] = useState<string[]>([]);
  const [platformBgms, setPlatformBgms] = useState<Record<string, string>>({});
  const [assemblyBgms, setAssemblyBgms] = useState<Record<string, string>>({});
  const [materialVersionBgms, setMaterialVersionBgms] = useState<Record<string, string>>({});
  const [bgmMatchMode, setBgmMatchMode] = useState<'smart' | 'unified'>('smart');
  const [bgmLibraryOpen, setBgmLibraryOpen] = useState(false);
  const bgmLibraryRef = useRef<HTMLDivElement>(null);
  useDismissibleLayer(bgmLibraryOpen, bgmLibraryRef, () => setBgmLibraryOpen(false));
  const [soundCandidatesPerContent, setSoundCandidatesPerContent] = useState<1 | 2>(1);
  const [bgmVol, setBgmVol] = useState(35);
  const [voiceVol, setVoiceVol] = useState(100);
  const [bgms, setBgms] = useState<Bgm[]>(BGMS);
  const [playingBgm, setPlayingBgm] = useState<string | null>(null);
  const [bgmUploading, setBgmUploading] = useState(false);
  const [bgmNotice, setBgmNotice] = useState('');
  const [bgmTab, setBgmTab] = useState<'library' | 'favorites'>('library');
  const [favoriteBgms, setFavoriteBgms] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('ow_favorite_bgms') || '[]') as string[];
    } catch {
      return [];
    }
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bgmInputRef = useRef<HTMLInputElement>(null);
  const previewBgmAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewVoiceAudioRef = useRef<HTMLAudioElement | null>(null);

  const [cover, setCover] = useState(''); // 某素材 id（用其帧画面作封面底图）
  const [coverTitle, setCoverTitle] = useState(COVERS[0].title);
  const [coverTitleZh, setCoverTitleZh] = useState('');   // 标题中文翻译（供确认）
  const [coverStyle, setCoverStyle] = useState<CoverStyle>({ color: '#ffffff', size: 'M', position: 'bottom', align: 'left', font: 'sans', weight: 'bold', artPreset: 'clean' });
  const [coverLoading, setCoverLoading] = useState(false);
  const [coverCanvaOpening, setCoverCanvaOpening] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(null); // 生成的封面 SVG 文件地址（发布缩略图）
  const [capturedCoverFrameUrl, setCapturedCoverFrameUrl] = useState('');
  const [coverCaptureNotice, setCoverCaptureNotice] = useState('');
  const [coverTimelineCaptureMode, setCoverTimelineCaptureMode] = useState(false);
  const [materialVersionCovers, setMaterialVersionCovers] = useState<Record<string, CoverVersionConfig>>({});
  const canvaReturnInputRef = useRef<HTMLInputElement>(null);
  const [customFonts, setCustomFonts] = useState<{ family: string; label: string }[]>([]); // 官方导入的字体模版
  const fontInputRef = useRef<HTMLInputElement>(null);


  const [rendering, setRendering] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [renderPct, setRenderPct] = useState(0);
  const [renderOutputPath, setRenderOutputPath] = useState<string | null>(null); // 桌面端合成产物路径
  const [renderOutputPreviewUrl, setRenderOutputPreviewUrl] = useState<string | null>(null);
  const [renderDownloadMessage, setRenderDownloadMessage] = useState('');
  const [languageRenderOutputs, setLanguageRenderOutputs] = useState<Record<string, LanguageRenderOutput>>({});
  const [languageRenderVersions, setLanguageRenderVersions] = useState<Record<string, LanguageRenderGeneration[]>>({});
  const [activeRenderCombinationKey, setActiveRenderCombinationKey] = useState('');
  const [batchRenderingLangs, setBatchRenderingLangs] = useState(false);
  const renderToken = useRef(0); // 取消过期的渲染循环（重复点「重新合成」时）
  const renderPreviewUrlsRef = useRef<Record<string, string>>({});
  const autoDigitalRenderKeyRef = useRef('');
  const digitalHumanQueueSubmissionRef = useRef('');

  const [account, setAccount] = useState<string | null>('a1');
  const [caption, setCaption] = useState('Factory-direct home essentials 🏠✨ #tiktokmademebuyit #homefinds');
  const [captionLoading, setCaptionLoading] = useState(false);
  const [published, setPublished] = useState(false);
  const [demoAutoLoading, setDemoAutoLoading] = useState(false);
  const [savedToWorks, setSavedToWorks] = useState(false); // 「存入我的作品」反馈
  const [modeActionLoading, setModeActionLoading] = useState(false);
  const productScriptAbortRef = useRef<AbortController | null>(null);
  const [modeActionStatus, setModeActionStatus] = useState('');
  const [materialSelectLoading, setMaterialSelectLoading] = useState(false);
  const [modeNotice, setModeNotice] = useState('');
  const [modeScripts, setModeScripts] = useState<ModeScriptOutput[]>([]);
  const [activeModeScriptId, setActiveModeScriptId] = useState('');
  const [pendingRealCloneGeneration, setPendingRealCloneGeneration] = useState(false);
  const [posterLoading, setPosterLoading] = useState(false);
  const [posterDraft, setPosterDraft] = useState<FbPosterResult | null>(null);
  const [leadContentPackage, setLeadContentPackage] = useState<LeadContentPackageResult | null>(null);
  const [posterJsonText, setPosterJsonText] = useState('');
  const [posterImageUrl, setPosterImageUrl] = useState('');

  const storyboardWorkActive = Object.values(storyboardGenerating).some(Boolean)
    || Object.values(storyboardQualityChecking).some(Boolean);
  const studioPerformancePhase = rendering || batchRenderingLangs
    ? 'render'
    : ttsLoading || digitalHumanLoading
      ? 'voice'
      : storyboardWorkActive
        ? 'storyboard'
        : materialSelectLoading
          ? 'material'
          : modeActionLoading || scriptLoading || coverLoading || captionLoading || posterLoading || demoAutoLoading || pendingRealCloneGeneration
            ? 'script'
            : '';

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('lingshu-assistant-performance', {
      detail: { active: Boolean(studioPerformancePhase), phase: studioPerformancePhase || 'default' },
    }));
  }, [studioPerformancePhase]);

  useEffect(() => () => {
    window.dispatchEvent(new CustomEvent('lingshu-assistant-performance', { detail: { active: false } }));
  }, []);

  useEffect(() => {
    let alive = true;
    fetch('/api/overseas/enterprise/profile', { headers: authHeader(), credentials: 'same-origin' })
      .then(r => r.json())
      .then((profile: EnterpriseProfileLite) => {
        if (!alive) return;
        const options = buildAiProductOptions(profile);
        setProductOptions(current => {
          const preserved = current.filter(item => item.id === 'kickoff-product');
          const seen = new Set(preserved.map(item => item.id));
          return [...preserved, ...options.filter(item => !seen.has(item.id))];
        });
        if (options[0]) setSelectedProductIds(current => current.length ? current : [options[0]!.id]);
        const configuredVoiceLanguages = enterpriseLanguageCodes(
          profile.brand?.preferredLanguages || profile.company?.primaryLanguages || '',
        );
        const defaultVoiceLanguage = configuredVoiceLanguages.includes('en')
          ? 'en'
          : configuredVoiceLanguages[0];
        setEnterpriseVoiceLangs(configuredVoiceLanguages);
        setVoiceLangs(current => current.length ? current : [defaultVoiceLanguage || 'zh']);
        if (defaultVoiceLanguage) {
          setLang(current => configuredVoiceLanguages.includes(current) ? current : defaultVoiceLanguage);
          setActiveVoiceLang(current => configuredVoiceLanguages.includes(current) ? current : defaultVoiceLanguage);
        }
        setProductInfo(prev => prev || options[0]?.info || [
          profile.strategy?.focusProducts || profile.products?.categories,
          profile.products?.priceRange,
          profile.products?.moq,
        ].filter(Boolean).join('；'));
        const inheritedRoute = profile.socialStrategy?.enabledRoutes?.[0] || '';
        const inheritedStrategy = profile.socialStrategy?.routeStrategies?.[inheritedRoute];
        setAudience(enterpriseBuyerText(inheritedStrategy?.targetBuyerRoles));
        const inheritedCta = profile.socialStrategy?.routeStrategies?.[inheritedRoute]?.primaryCta;
        setCooperationRoute(current => current || inheritedRoute);
        setAvailableCooperationRoutes(profile.socialStrategy?.enabledRoutes || []);
        setEnterpriseRouteStrategies(profile.socialStrategy?.routeStrategies || {});
        setEnterprisePrimaryCta(inheritedCta || '');
        setPrimaryCta(inheritedCta || '');
        setSellingPoints(prev => prev || [
          profile.brand?.usp,
          profile.products?.highlights,
        ].filter(Boolean).join('；'));
        setTone(prev => prev || profile.brand?.tone || '高转化 · 口语化');
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (productOptions.length === 0 || selectedProductIds.length === 0) return;
    const selectedOptions = productOptions.filter(option => selectedProductIds.includes(option.id));
    if (selectedOptions.length === 0) return;
    setProductInfo(formatSelectedProductInfo(selectedOptions));
  }, [productOptions, selectedProductIds]);

  useEffect(() => {
    if (productSelectMode === 'single' && selectedProductIds.length > 1) {
      setSelectedProductIds([selectedProductIds[0]]);
    }
  }, [productSelectMode, selectedProductIds]);

  // 成片预览：网页端只顺序播放带可访问地址的真实视频片段。
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [previewNote, setPreviewNote] = useState(false);
  const [previewVideoReady, setPreviewVideoReady] = useState(false);
  const [previewOriginalOn, setPreviewOriginalOn] = useState(false);
  const [previewVoiceOn, setPreviewVoiceOn] = useState(true);
  const [previewBgmOn, setPreviewBgmOn] = useState(true);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const workbenchVideoRef = useRef<HTMLVideoElement | null>(null);
  const [workbenchTimelineTime, setWorkbenchTimelineTime] = useState(0);
  const [workbenchTimelineHoverTime, setWorkbenchTimelineHoverTime] = useState<number | null>(null);
  const workbenchTimelineScrubbingRef = useRef(false);
  const previewVideoCacheRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const previewAdvanceTimerRef = useRef<number | null>(null);
  const previewAdvanceLockRef = useRef(false);

  // 字幕（A 层：脚本兜底对齐 + 沿用封面样式；桌面端 ffmpeg 烧录）
  const [subtitlesOn, setSubtitlesOn] = useState(true);
  const [subMode, setSubMode] = useState<'target' | 'bilingual'>('target');
  const [subPreviewIdx, setSubPreviewIdx] = useState(0); // 预览叠层当前展示的 cue
  const [cueZh, setCueZh] = useState<string[]>([]);       // 双语字幕的中文译文（与 cues 对齐）
  const [previewTime, setPreviewTime] = useState(0);
  const [clipEdits, setClipEdits] = useState<Record<string, ClipEdit>>({});

  // 草稿 / 作品
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectWorkflowContext, setProjectWorkflowContext] = useState<StudioWorkflowContext | null>(workflowContext || null);
  const generationSessionId = useRef(`session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [storyboardVideoVersions, setStoryboardVideoVersions] = useState<Record<string, VideoGenerationVersion[]>>({});
  const [productVideoVersions, setProductVideoVersions] = useState<VideoGenerationVersion[]>([]);
  const [projectTitle, setProjectTitle] = useState('未命名草稿');
  const [showProjects, setShowProjects] = useState(false);
  const [workflowProjectSelectionPending, setWorkflowProjectSelectionPending] = useState(
    () => workflowContext?.taskKey === 'content_production',
  );
  const projectsPanelWasOpenRef = useRef(false);
  const handledOpenProjectsSignalRef = useRef(0);
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [savingProj, setSavingProj] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastAutosavedAt, setLastAutosavedAt] = useState<Date | null>(null);
  const autosaveInFlightRef = useRef(false);
  const autosaveSnapshotRef = useRef<() => Promise<void>>(async () => undefined);
  const [videoKickoff, setVideoKickoff] = useState<VideoKickoff | null>(null);
  const [sourceDraftCheckPending, setSourceDraftCheckPending] = useState(true);
  const [existingSourceDraftPrompt, setExistingSourceDraftPrompt] = useState<ExistingSourceDraftPrompt | null>(null);
  const referenceVoice = useMemo(() => referenceVoiceProfile(videoKickoff), [videoKickoff]);

  useEffect(() => {
    if (!workflowContext) {
      if (!projectId) setProjectWorkflowContext(null);
      setWorkflowProjectSelectionPending(false);
      return;
    }
    const isSameTask = projectWorkflowContext?.runId === workflowContext.runId
      && projectWorkflowContext?.taskId === workflowContext.taskId;
    if (isSameTask) return;
    // A fresh Digital Employee handoff starts a new attributed draft. It must
    // never relabel an unrelated project that happened to be open in Studio.
    setProjectId(null);
    setProjectWorkflowContext(workflowContext);
    if (workflowContext.taskKey === 'content_production') {
      setProjects([]);
      setShowProjects(true);
      setWorkflowProjectSelectionPending(true);
    }
  }, [workflowContext]);

  useEffect(() => {
    if (showProjects) {
      projectsPanelWasOpenRef.current = true;
      return;
    }
    if (!projectsPanelWasOpenRef.current) return;
    projectsPanelWasOpenRef.current = false;
    window.dispatchEvent(new CustomEvent('lingshu:content-view-changed', { detail: { entry: 'create' } }));
  }, [showProjects]);

  useEffect(() => {
    void studioApi.audioCapabilities().then(setAudioCapabilities);
    void studioApi.listVoiceSamples().then(items => {
      setCustomVoices(items);
      if (items.length) setVoiceCandidates(current => [...new Set([...current, ...items.map(item => item.voiceId)])]);
    });
  }, []);
  useEffect(() => {
    if (mode === 'clone' || !useReferenceVoiceStyle) return;
    const fallback = TTS_PRESETS.find(item => item.id === 'authentic_review')!;
    setUseReferenceVoiceStyle(false);
    setTtsPreset(fallback.id);
    setTtsEmotion(fallback.emotion);
    setTtsEmotionIntensity(fallback.intensity);
    setTtsSpeed(fallback.speed);
    setVoiceoverUrl(null);
    setVoiceoverAudios({});
    setAlignedCuesByLang({});
  }, [mode, useReferenceVoiceStyle]);

  const materialById = useMemo(() => new Map(materials.map(item => [item.id, item])), [materials]);
  const selectedClips = useMemo(() => selected.map(id => materialById.get(id)).filter(Boolean) as Clip[], [selected, materialById]);
  const totalDur = selectedClips.reduce((s, c) => s + (c.type === 'image' ? 3 : c.duration), 0);
  const selectedVideoCount = selectedClips.filter(item => item.type === 'video').length;
  const selectedImageCount = selectedClips.filter(item => item.type === 'image').length;
  const unknownDurationCount = selectedClips.filter(item => item.type === 'video' && (!Number.isFinite(item.duration) || item.duration <= 0)).length;
  const targetAspectRatio = ratioNumber(ratio);
  const selectedVisualClips = selectedClips.filter(item => item.type === 'video' || item.type === 'image');
  const effectiveSelectedDuration = selectedVisualClips.reduce((sum, clip) => sum + effectiveClipDuration(clip), 0);
  const recommendedMaterialDuration = effectiveSelectedDuration <= 16 ? 15 : effectiveSelectedDuration <= 24 ? 20 : effectiveSelectedDuration <= 36 ? 30 : 45;
  useEffect(() => {
    if (hookMaterialId && !selectedVisualClips.some(item => item.id === hookMaterialId)) setHookMaterialId('');
  }, [hookMaterialId, selectedVisualClips]);
  const ratioCompatibleCount = selectedVisualClips.filter(item => {
    const itemRatio = clipAspectRatio(item);
    return itemRatio > 0 && Math.abs(itemRatio - targetAspectRatio) / Math.max(targetAspectRatio, 0.01) <= 0.18;
  }).length;
  const materialCoverageReady = effectiveSelectedDuration >= Math.max(1, duration * 0.85);
  const matNames = selectedClips.map(c => c.name);
  const storyboardSlots = useMemo(() => {
    const parsed = parseStoryboardSlots(script, duration);
    const activeAudioDuration = voiceoverMode === 'ai'
      ? voiceoverAudios[activeVoiceLang]?.duration || 0
      : voiceoverMode === 'upload' ? voiceoverDur : 0;
    return fitStoryboardSlotsToDuration(parsed, activeAudioDuration);
  }, [activeVoiceLang, duration, script, voiceoverAudios, voiceoverDur, voiceoverMode]);
  useEffect(() => {
    if (!storyboardSlots.length) {
      if (activeStoryboardSlotId) setActiveStoryboardSlotId('');
      return;
    }
    if (!storyboardSlots.some(item => item.id === activeStoryboardSlotId)) {
      setActiveStoryboardSlotId(storyboardSlots[0].id);
    }
  }, [activeStoryboardSlotId, storyboardSlots]);
  const storyboardTimelineEnd = useMemo(() => storyboardSlots.reduce((max, slot) => Math.max(max, slot.end), 0), [storyboardSlots]);
  const recommendedSourceMode = (slot: StoryboardSlot): StoryboardSourceMode => {
    const text = `${slot.title} ${slot.detail}`.toLowerCase();
    if (/证书|认证|检测|参数|包装文字|logo|工厂|生产线|质检|certificate|factory|inspection/.test(text)) return 'local';
    if (/人物|模特|口播|场景|情绪|动作|presenter|model|lifestyle/.test(text)) return 'ai';
    return 'local';
  };
  const isCriticalStoryboardSlot = (slot: StoryboardSlot) =>
    /证书|认证|检测|参数|包装文字|logo|工厂|生产线|质检|产品特写|材质|certificate|factory|inspection|product close/.test(`${slot.title} ${slot.detail}`.toLowerCase());
  const sourcePlanFor = (slot: StoryboardSlot): StoryboardSourcePlan => storyboardSourcePlans[slot.id] ?? {
    mode: recommendedSourceMode(slot),
    decided: false,
    confirmed: false,
    critical: isCriticalStoryboardSlot(slot),
  };
  const runStoryboardQualityCheck = async (slot: StoryboardSlot, materialId: string, planOverride?: StoryboardSourcePlan) => {
    const plan = planOverride ?? sourcePlanFor(slot);
    setStoryboardQualityChecking(prev => ({ ...prev, [slot.id]: true }));
    try {
      const result = await studioApi.storyboardQualityCheck({
        materialId,
        storyboard: `${slot.time} ${slot.title}\n${slot.detail}`,
        productInfo: activeProductInfo,
        critical: plan.critical,
      });
      if (!result.ok || !result.quality) throw new Error(result.error || '质检未返回结果');
      setStoryboardSourcePlans(prev => ({
        ...prev,
        [slot.id]: { ...plan, generatedClipId: materialId, confirmed: false, quality: result.quality, qualityError: '' },
      }));
    } catch (error) {
      setStoryboardSourcePlans(prev => ({
        ...prev,
        [slot.id]: { ...plan, generatedClipId: materialId, confirmed: false, qualityError: error instanceof Error ? error.message : '自动质检失败' },
      }));
    } finally {
      setStoryboardQualityChecking(prev => ({ ...prev, [slot.id]: false }));
    }
  };
  const generateStoryboardShot = async (slot: StoryboardSlot, planOverride?: StoryboardSourcePlan) => {
    const plan = planOverride ?? sourcePlanFor(slot);
    const versionGroupKey = `studio:${projectId || generationSessionId.current}:assembly:${activeAssemblyId}:frame:${slot.id}`;
    const selectedVersion = storyboardVideoVersions[slot.id]?.find(item => item.isSelected);
    if (plan.mode !== 'ai' && plan.mode !== 'hybrid') return;
    const currentClipId = plan.mode === 'hybrid'
      ? (plan.referenceClipId || storyboardAssignments[slot.id])
      : storyboardAssignments[slot.id];
    const referenceClip = currentClipId ? materialById.get(currentClipId) : undefined;
    if (plan.mode === 'hybrid' && !referenceClip) {
      setStoryboardSourcePlans(prev => ({
        ...prev,
        [slot.id]: { ...plan, confirmed: false, error: '融合生成需要先为该分镜匹配一条本地参考素材。' },
      }));
      return;
    }
    setStoryboardGenerating(prev => ({ ...prev, [slot.id]: true }));
    setStoryboardSourcePlans(prev => ({
      ...prev,
      [slot.id]: {
        ...plan,
        confirmed: false,
        referenceClipId: plan.mode === 'hybrid' ? (plan.referenceClipId || referenceClip?.id) : undefined,
        error: '',
      },
    }));
    try {
      const shotDuration = Math.max(4, Math.min(15, Math.round(slot.end - slot.start)));
      const fusionInstruction = plan.mode === 'hybrid' && referenceClip
        ? `Use the supplied real local reference image from "${referenceClip.name}" as the product/visual truth. Preserve its product appearance, color, material and packaging while integrating it into the generated scene.`
        : 'Generate the full shot with AI while keeping the product context accurate.';
      const referenceImageUrl = plan.mode === 'hybrid' && referenceClip
        ? (referenceClip.type === 'image' ? referenceClip.url : referenceClip.poster)
        : undefined;
      if (plan.mode === 'hybrid' && !referenceImageUrl) {
        throw new Error('该本地素材没有可用参考图。请改用图片素材，或为视频生成封面帧后重试。');
      }
      const generated = await studioApi.seedanceVideo({
        script: `Single storyboard shot ${slot.time}. ${slot.detail}\n${fusionInstruction}\nDo not add captions, logos, labels, UI or watermarks.`,
        productInfo: activeProductInfo,
        language: lang,
        ratio,
        duration: shotDuration,
        resolution: '720p',
        title: `${assemblyName} · 分镜${storyboardSlots.findIndex(item => item.id === slot.id) + 1} · ${plan.mode === 'hybrid' ? '融合生成' : 'AI生成'}`,
        referenceImageUrl,
        generationGroupKey: versionGroupKey,
        generationContext: { entry: 'studio-storyboard', projectId, assemblyId: activeAssemblyId, slotId: slot.id, mode: plan.mode },
        parentVersionId: selectedVersion?.id,
      });
      if (!generated.ok || !generated.url) throw new Error(generated.error || '视频生成未返回可用素材');
      const clip = generated.material
        ? { ...materialToClip(generated.material), aspectRatio: generated.material.aspectRatio || ratioNumber(ratio) }
        : {
            id: generated.id || `storyboard-ai-${slot.id}-${Date.now()}`,
            name: generated.title || `${slot.title} · AI生成`,
            folder: 'upload',
            type: 'video' as const,
            duration: generated.duration || shotDuration,
            aspectRatio: ratioNumber(ratio),
            size: 'Seedance',
            url: generated.url,
            poster: generated.poster,
            scope: 'own' as const,
            sourceType: 'ai-seedance',
          };
      setMaterials(prev => prev.some(item => item.id === clip.id) ? prev : [clip, ...prev]);
      setStoryboardAssignments(prev => ({ ...prev, [slot.id]: clip.id }));
      setSelected(prev => [...new Set([...prev, clip.id])]);
      setClipEdits(prev => ({ ...prev, [slotClipEditKey(slot.id, clip.id)]: defaultEditForSlot(clip, slot) }));
      setStoryboardSourcePlans(prev => ({
        ...prev,
        [slot.id]: {
          ...sourcePlanFor(slot),
          mode: plan.mode,
          confirmed: false,
          critical: plan.critical,
          referenceClipId: plan.mode === 'hybrid' ? (plan.referenceClipId || referenceClip?.id) : undefined,
          generatedClipId: clip.id,
          error: '',
        },
      }));
      if (generated.version) setStoryboardVideoVersions(prev => ({
        ...prev,
        [slot.id]: [generated.version!, ...(prev[slot.id] || []).map(item => ({ ...item, isSelected: false }))],
      }));
      await runStoryboardQualityCheck(slot, clip.id, {
        ...plan,
        referenceClipId: plan.mode === 'hybrid' ? (plan.referenceClipId || referenceClip?.id) : undefined,
        generatedClipId: clip.id,
      });
    } catch (error) {
      setStoryboardSourcePlans(prev => ({
        ...prev,
        [slot.id]: { ...plan, confirmed: false, error: error instanceof Error ? error.message : '分镜生成失败' },
      }));
    } finally {
      setStoryboardGenerating(prev => ({ ...prev, [slot.id]: false }));
    }
  };
  const assignedOrderedIds = useMemo(
    () => storyboardSlots.map(slot => storyboardAssignmentIdForMode(slot.id, activeVoiceLang, storyboardAssignments, shotMediaModes))
      .filter((id): id is string => Boolean(id && materialById.has(id))),
    [activeVoiceLang, shotMediaModes, storyboardAssignments, storyboardSlots, materialById],
  );
  const assignedCount = assignedOrderedIds.length;
  const selectedProductOptions = useMemo(
    () => productOptions.filter(option => selectedProductIds.includes(option.id)),
    [productOptions, selectedProductIds],
  );
  const productCategories = useMemo(
    () => Array.from(new Set(productOptions.map(productOptionCategory))).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [productOptions],
  );
  const visibleProductOptions = useMemo(() => {
    const query = productSearch.trim().toLocaleLowerCase();
    return productOptions.filter(option => {
      if (showSelectedProductsOnly && !selectedProductIds.includes(option.id)) return false;
      if (productCategoryFilter && productOptionCategory(option) !== productCategoryFilter) return false;
      return !query || `${option.label}\n${option.info}`.toLocaleLowerCase().includes(query);
    });
  }, [productCategoryFilter, productOptions, productSearch, selectedProductIds, showSelectedProductsOnly]);
  const activeProductInfo = useMemo(() => {
    const selectedInfo = formatSelectedProductInfo(selectedProductOptions);
    return selectedInfo || productInfo;
  }, [productInfo, selectedProductOptions]);
  const activeProductLabel = useMemo(() => selectedProductLabel(activeProductInfo), [activeProductInfo]);
  const migrationRecommendation = useMemo(
    () => recommendMigration(videoKickoff, activeProductInfo),
    [activeProductInfo, videoKickoff],
  );
  const cloneProductFingerprintRef = useRef('');
  const selectedBgmTrack = useMemo(() => bgms.find(track => track.id === bgm) || null, [bgm, bgms]);
  const visibleRatios = useMemo(
    () => contentMode === 'poster' ? POSTER_RATIOS : RATIOS,
    [contentMode],
  );

  useEffect(() => {
    if (!activeProductLabel) return;
    setScript(current => sanitizeStoryboardScript(current, activeProductInfo, activeProductLabel));
    setModeScripts(current => current.map(item => ({ ...item, script: sanitizeStoryboardScript(item.script, activeProductInfo, activeProductLabel) })));
  }, [activeProductInfo, activeProductLabel]);
  useEffect(() => {
    if (mode === 'clone') setMigrationMode(migrationRecommendation.mode);
  }, [migrationRecommendation, mode]);
  useEffect(() => {
    if (mode !== 'clone' || !videoKickoff?.referenceAnalysis?.details?.length) return;
    const referenceHasVoice = videoKickoff.referenceAnalysis.details.some(item => !isNonSpeechSfx(item.dialogue || ''));
    setVoiceoverMode(referenceHasVoice ? 'ai' : 'none');
  }, [mode, videoKickoff]);
  useEffect(() => {
    if (mode !== 'clone' || !videoKickoff?.referenceAnalysis?.details?.length || !activeProductInfo.trim() || !activeProductLabel) return;
    const fingerprint = `${selectedProductIds.join('|')}::${migrationMode}::${activeProductInfo}`;
    if (!cloneProductFingerprintRef.current) {
      cloneProductFingerprintRef.current = fingerprint;
      return;
    }
    if (cloneProductFingerprintRef.current === fingerprint) return;
    cloneProductFingerprintRef.current = fingerprint;
    // Product identity is part of the generation version. Audio, material
    // matches and renders derived from the previous product must not survive.
    setVoiceDrafts({});
    setVoiceoverAudios({});
    setVoiceoverUrl(null);
    setAlignedCuesByLang({});
    setSelected([]);
    setScriptRecommendedMaterialIds([]);
    setStoryboardAssignments({});
    setStoryboardSourcePlans({});
    setClipEdits({});
    setCover('');
    setRendered(false);
    setLanguageRenderOutputs({});
    setRenderOutputPath(null);
    setSavedToWorks(false);
    setModeScripts(current => current.filter(item => item.mode !== 'clone'));
    setActiveModeScriptId('');
    setScript('');
    setVoiceoverLines('');
    setScriptView('timestamp');
    setModeNotice(`产品已更换为「${activeProductLabel}」：旧脚本、配音、素材匹配和成片结果已失效，请重新调用 AI 生成真实分镜。`);
  }, [activeProductInfo, activeProductLabel, lang, migrationMode, migrationRecommendation.label, mode, selectedProductIds, videoKickoff]);
  useEffect(() => {
    if (contentMode !== 'poster') return;
    if (platform !== 'facebook' && platform !== 'instagram') {
      setPlatform('facebook');
      setRatio('1:1');
    }
    if (!POSTER_RATIOS.includes(ratio)) setRatio('1:1');
  }, [contentMode, platform, ratio]);
  // 选中的封面底图帧：取该素材的帧画面（视频抽帧 / 图片自身）
  const coverClip = useMemo(() => materials.find(m => m.id === cover), [cover, materials]);
  const coverFrameUrl = useMemo(() => {
    if (capturedCoverFrameUrl) return capturedCoverFrameUrl;
    if (!coverClip) return undefined;
    if (coverClip.poster) return coverClip.poster;
    if (coverClip.type === 'image' || coverClip.type === 'video') return coverClip.url;
    return undefined;
  }, [capturedCoverFrameUrl, coverClip]);
  // 可作封面的候选：已选中的图片/视频；视频没有抽帧时直接展示首帧
  const frameCandidates = useMemo(() => selectedClips.filter(c => c.type !== 'audio' && (c.poster || c.url)), [selectedClips]);
  useEffect(() => {
    const firstFrameId = frameCandidates[0]?.id ?? '';
    if (!cover || cover === 'gradient' || !frameCandidates.some(c => c.id === cover)) {
      setCover(firstFrameId);
      setCapturedCoverFrameUrl('');
    }
  }, [cover, frameCandidates]);
  useEffect(() => {
    setCoverUrl(null);
  }, [cover, coverFrameUrl]);
  useEffect(() => {
    setCoverUrl(null);
  }, [coverStyle]);
  const activeMaterialVersionKey = useMemo(() => materialVersionKey(activeAssemblyId, activeVoiceLang), [activeAssemblyId, activeVoiceLang]);
  useEffect(() => {
    if (!activeMaterialVersionKey) return;
    setMaterialVersionCovers(current => {
      const next: CoverVersionConfig = { coverId: cover, title: coverTitle, style: coverStyle, coverUrl };
      const prev = current[activeMaterialVersionKey];
      if (
        prev?.coverId === next.coverId
        && prev?.title === next.title
        && prev?.coverUrl === next.coverUrl
        && JSON.stringify(prev?.style) === JSON.stringify(next.style)
      ) return current;
      return { ...current, [activeMaterialVersionKey]: next };
    });
  }, [activeMaterialVersionKey, cover, coverTitle, coverStyle, coverUrl]);
  // 成片预览可播放的真实视频片段（mock 占位素材没有 url）
  const previewable = useMemo(() => selectedClips.filter(c => c.url && c.type === 'video'), [selectedClips]);
  const activeSpokenScript = voiceDrafts[activeVoiceLang] || voiceoverLines || script;
  const activeVoiceoverAudio = voiceoverMode === 'ai' && !voiceoverStaleLangs.includes(activeVoiceLang)
    ? voiceoverAudios[activeVoiceLang]
    : undefined;
  const activeVoiceoverUrl = voiceoverMode === 'none'
    ? ''
    : voiceoverMode === 'ai'
      ? activeVoiceoverAudio?.url || ''
      : voiceoverUrl || '';
  const activeVoiceDuration = voiceoverMode === 'none'
    ? 0
    : voiceoverMode === 'ai'
      ? activeVoiceoverAudio?.duration || 0
      : voiceoverDur;
  const voiceoverForLanguage = (code: string) => {
    if (voiceoverMode === 'none') return { url: '', duration: 0, cues: alignedCuesByLang[code] || [] };
    if (voiceoverMode === 'ai') {
      if (voiceoverStaleLangs.includes(code)) return { url: '', duration: 0, cues: [] };
      const audio = voiceoverAudios[code];
      return {
        url: audio?.url || '',
        duration: audio?.duration || 0,
        cues: alignedCuesByLang[code] || audio?.cues || [],
      };
    }
    const isActiveUpload = code === activeVoiceLang;
    return {
      url: isActiveUpload ? voiceoverUrl || '' : '',
      duration: isActiveUpload ? voiceoverDur : 0,
      cues: alignedCuesByLang[code] || [],
    };
  };
  const masterScriptSnapshot = useRef(script);
  useEffect(() => {
    if (masterScriptSnapshot.current !== script && Object.keys(voiceDrafts).length) {
      const sourceLanguage = detectScriptLanguageCode(script || voiceoverLines);
      setVoiceDraftStaleLangs(current => [...new Set([...current, ...voiceLangs.filter(code => code !== sourceLanguage)])]);
    }
    masterScriptSnapshot.current = script;
  }, [script, voiceDrafts, voiceLangs, voiceoverLines]);
  // 字幕 cue：当前语种口播台词 + TTS 时长（无配音则用素材总时长）
  const cues = useMemo(() => alignedCuesByLang[activeVoiceLang]?.length
    ? alignedCuesByLang[activeVoiceLang]
    : buildCues(activeSpokenScript, activeVoiceDuration || totalDur), [activeSpokenScript, activeVoiceDuration, activeVoiceLang, alignedCuesByLang, totalDur]);
  // 字幕样式沿用封面体系，但默认底部居中 + 适配字号
  const subStyle: CoverStyle = useMemo(() => ({ ...coverStyle, position: 'bottom', align: 'center', size: coverStyle.size === 'L' ? 'M' : 'S' }), [coverStyle]);

  const isStoryboardSlotReviewComplete = (slot: StoryboardSlot) => Boolean(
    storyboardAssignmentIdForMode(slot.id, activeVoiceLang, storyboardAssignments, shotMediaModes)
    && materialById.has(storyboardAssignmentIdForMode(slot.id, activeVoiceLang, storyboardAssignments, shotMediaModes)!),
  );
  const storyboardReviewPendingCount = mode === 'clone'
    ? storyboardSlots.filter(slot => !isStoryboardSlotReviewComplete(slot)).length
    : 0;
  const storyboardReviewComplete = mode !== 'clone' || storyboardReviewPendingCount === 0;
  const storyboardMatchReviewPendingCount = storyboardSlots.filter(slot => {
    const clip = materialById.get(storyboardAssignmentIdForMode(slot.id, activeVoiceLang, storyboardAssignments, shotMediaModes) || '');
    if (!clip) return false;
    const assessment = assessMaterialMatch(slot, clip, ratio);
    return assessment.level === 'review' && !sourcePlanFor(slot).confirmed;
  }).length;
  const hasTimestampScript = Boolean(script.trim());
  const hasRequestedVoiceDrafts = requestedVoiceDraftsReady(voiceLangs, voiceDrafts, voiceDraftStaleLangs, voiceDraftPendingLangs);
  const hasRequestedVoiceovers = voiceLangs.length > 0 && voiceLangs.every(code => Boolean(voiceoverAudios[code]?.url) && !voiceoverStaleLangs.includes(code));
  const hasRequestedSubtitles = voiceLangs.length > 0 && voiceLangs.every(code => Boolean(alignedCuesByLang[code]?.length));
  const hasReadyVoiceStrategy = voiceoverMode === 'none'
    || (voiceoverMode === 'upload' && Boolean(voiceoverUrl))
    || (voiceoverMode === 'ai' && hasRequestedVoiceovers);
  const hasAnyVoiceover = Object.entries(voiceoverAudios).some(([code, audio]) => Boolean(audio?.url) && !voiceoverStaleLangs.includes(code));
  const activeScriptQualityStatus = modeScripts.find(item => item.id === activeModeScriptId)?.qualityStatus;
  const activeScriptQualityBlocked = activeScriptQualityStatus === 'rejected' || activeScriptQualityStatus === 'failed';
  const canNext = contentMode === 'video' && step === 'script'
    ? scriptStageTab === 'theme'
      ? hasTimestampScript && !activeScriptQualityBlocked
      : scriptStageTab === 'voiceover'
        ? hasTimestampScript && !activeScriptQualityBlocked && hasRequestedVoiceDrafts
        : scriptStageTab === 'audio'
          ? hasTimestampScript && !activeScriptQualityBlocked && hasRequestedVoiceDrafts && hasReadyVoiceStrategy
          : scriptStageTab === 'bgm'
            ? hasTimestampScript && !activeScriptQualityBlocked && hasRequestedVoiceDrafts && hasRequestedSubtitles
          : hasTimestampScript && !activeScriptQualityBlocked && hasRequestedVoiceDrafts && hasRequestedSubtitles
    : contentMode === 'video' && step === 'material'
      ? storyboardSlots.length > 0 && assignedCount === storyboardSlots.length && storyboardMatchReviewPendingCount === 0
    : true;
  useEffect(() => {
    if (!assignedOrderedIds.length) return;
    setSelected(current => {
      const deduped = [...new Set(assignedOrderedIds)];
      return current.length === deduped.length && current.every((id, index) => id === deduped[index]) ? current : deduped;
    });
  }, [assignedOrderedIds]);
  const isLast = stepIdx === activeSteps.length - 1;
  const toggleProductSelection = (id: string) => {
    setSelectedProductIds(current => {
      if (productSelectMode === 'single') return [id];
      const next = current.includes(id) ? current.filter(item => item !== id) : [...current, id];
      return next.length ? next : [id];
    });
  };
  useEffect(() => {
    let raw = '';
    try {
      raw = localStorage.getItem('ow_video_kickoff') || localStorage.getItem('ow_seedance_kickoff') || '';
      if (raw) {
        localStorage.removeItem('ow_video_kickoff');
        localStorage.removeItem('ow_seedance_kickoff');
      }
    } catch { /* ignore */ }
    if (!raw) {
      setSourceDraftCheckPending(false);
      return;
    }
    try {
      const kickoff = JSON.parse(raw) as VideoKickoff;
      setVideoKickoff(kickoff);
      void studioApi.listProjects().then(items => {
        const matchingDrafts = items
          .filter(item => item.status === 'draft' && projectMatchesKickoff(item, kickoff))
          .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        setProjects(items);
        if (matchingDrafts[0]) {
          setExistingSourceDraftPrompt({
            project: matchingDrafts[0],
            matchCount: matchingDrafts.length,
            title: kickoff.video?.title || kickoff.generatedVideo?.title || matchingDrafts[0].title,
            poster: kickoff.generatedVideo?.poster
              || kickoff.video?.aiAnalysis?.materialPoster
              || kickoff.video?.thumbnail
              || '',
          });
        } else {
          setSourceDraftCheckPending(false);
        }
      }).catch(() => setSourceDraftCheckPending(false));
      if (kickoff.video?.duration && kickoff.video.duration > 0) setDuration(+kickoff.video.duration.toFixed(1));
      const fromInspiration = kickoff.source === 'inspiration_analysis';
      const fromImagePost = kickoff.source === 'inspiration_image_post' || kickoff.video?.contentFormat === 'image';
      if (fromImagePost) {
        setContentMode('poster');
        setMode('clone');
        setPlatform(kickoff.video?.platform === 'instagram' ? 'instagram' : 'facebook');
        setRatio('4:5');
        setActiveFolder('hot');
        setProjectTitle(kickoff.video?.title ? `竞品图文获客内容包 · ${kickoff.video.title}` : '竞品图文获客内容包');
        const kickoffOption = kickoff.productInfo ? productOptionFromInfo(kickoff.productInfo) : null;
        if (kickoffOption) {
          setProductOptions(current => current.some(item => item.id === kickoffOption.id)
            ? current.map(item => item.id === kickoffOption.id ? kickoffOption : item)
            : [kickoffOption, ...current]);
          setSelectedProductIds([kickoffOption.id]);
        }
        if (kickoff.productInfo) setProductInfo(kickoff.productInfo);
        setModeNotice(kickoff.video?.aiAnalysis?.imageEvidence?.observedFacts?.length
          ? '已带入完整轮播证据。系统将只保留可观察的布局、信息层级和表达方式，用企业中心产品与真实能力生成三组连续获客内容。'
          : '这条图文还没有完整轮播证据，请返回灵感中心点击“重新分析完整轮播”后再生成。');
        setStepIdx(1);
        autoGen.current = true;
        return;
      }
      if (fromInspiration) {
        const profile = referenceVoiceProfile(kickoff);
        if (profile.available) {
          setUseReferenceVoiceStyle(true);
          setReferenceVoiceStrength('balanced');
          setTtsEmotion(`${profile.emotion}；保留节奏结构，重新表达全部台词`);
          setTtsEmotionIntensity(78);
          setTtsSpeed(profile.baseSpeed);
        }
        setScript('');
        setVoiceoverLines('');
        setVoiceDrafts({});
        setScriptView('timestamp');
        setModeScripts([]);
        const kickoffOption = kickoff.productInfo ? productOptionFromInfo(kickoff.productInfo) : null;
        if (kickoffOption) {
          setProductOptions(current => current.some(item => item.id === kickoffOption.id)
            ? current.map(item => item.id === kickoffOption.id ? kickoffOption : item)
            : [kickoffOption, ...current]);
          setSelectedProductIds([kickoffOption.id]);
        }
        if (kickoff.productInfo && !hasIncompleteReferenceAnalysis(kickoff)) {
          setModeNotice('已带入对标视频结构和产品信息。请确认创作设置并选择本次要使用的素材，再生成脚本。');
          setPendingRealCloneGeneration(false);
        } else if (hasIncompleteReferenceAnalysis(kickoff)) {
          const analyzedUntil = referenceAnalysisEnd(kickoff);
          setModeNotice(`原视频约 ${Number(kickoff.video?.duration || 0).toFixed(1)} 秒，但当前逐镜分析只覆盖到 ${analyzedUntil.toFixed(1)} 秒。请返回灵感中心重新完成全片分析后再生成，避免脚本被截断。`);
          setPendingRealCloneGeneration(false);
        } else {
          setModeNotice('已带入对标视频分析，请先选择企业中心产品后生成脚本。');
          setPendingRealCloneGeneration(false);
        }
      } else if (kickoff.script) {
        setScript(kickoff.script);
      }
      if (kickoff.scriptType === 'voiceover' || kickoff.scriptType === 'storyboard') setScriptType(kickoff.scriptType);
      if (kickoff.language) setLang(kickoff.language);
      if (kickoff.productInfo) setProductInfo(kickoff.productInfo);
      if (kickoff.video?.platform) setPlatform(kickoff.video.platform);
      setProvider('qwen');
      const kickoffMode: ModeCard['id'] = fromInspiration ? 'clone' : 'material';
      setMode(kickoffMode);
      setActiveFolder(kickoff.generatedVideo ? 'upload' : 'hot');
      setProjectTitle(draftTitleForMode(kickoffMode, kickoff.video?.title || kickoff.generatedVideo?.title || ''));
      setStepIdx(fromInspiration || kickoff.source === 'material_library'
        ? 0
        : STEPS.findIndex(s => s.id === 'material'));
      if (fromInspiration) setCanvasView('reference');
      autoGen.current = true;
    } catch {
      setSourceDraftCheckPending(false);
    }
  }, []);

  useEffect(() => {
    if (!videoKickoff?.generatedVideo) return;
    const generated = videoKickoff.generatedVideo;
    const clip: Clip = generated.material
      ? materialToClip(generated.material)
      : {
          id: generated.id || `seedance-video-${videoKickoff.video?.title || 'output'}`,
          name: generated.title || 'Seedance 输出视频',
          folder: 'upload',
          type: 'video',
          duration: generated.duration || videoKickoff.video?.duration || duration,
          size: 'Seedance',
          url: generated.url,
          poster: generated.poster || videoKickoff.video?.aiAnalysis?.materialPoster || videoKickoff.video?.thumbnail,
          scope: 'own',
          sourceType: 'ai-generated',
        };
    setMaterials(prev => {
      if (prev.some(m => m.id === clip.id || (clip.url && m.url === clip.url))) return prev;
      return [clip, ...prev];
    });
    setSelected([clip.id]);
    if (videoKickoff.materialRole === 'hook' || videoKickoff.source === 'material_library') {
      setHookMaterialId(clip.id);
      applyInferredMaterialTheme(generated.material || clip);
    }
  }, [duration, videoKickoff]);

  useEffect(() => {
    if (!(videoKickoff?.source === 'inspiration_image_post' || videoKickoff?.video?.contentFormat === 'image')) return;
    const thumb = videoKickoff.video?.thumbnail || videoKickoff.video?.aiAnalysis?.materialPoster || '';
    const sourceUrl = videoKickoff.video?.sourceUrl || '';
    const id = `hot-image-${sourceUrl || videoKickoff.video?.title || Date.now()}`;
    const clip: Clip = {
      id,
      name: videoKickoff.video?.title || '爆款图文参考',
      folder: 'hot',
      type: 'image',
      duration: 0,
      size: '图文参考',
      url: thumb,
      poster: thumb,
      scope: 'own',
    };
    setMaterials(prev => {
      if (prev.some(m => m.id === clip.id || (clip.url && m.url === clip.url))) return prev;
      return [clip, ...prev];
    });
    setSelected([clip.id]);
  }, [videoKickoff]);

  useEffect(() => {
    if (!videoKickoff || materials.length === 0) return;
    const mayCarryMaterialSelection = videoKickoff.source === 'material_library'
      || Boolean(videoKickoff.generatedVideo)
      || videoKickoff.materialRole === 'hook';
    if (!mayCarryMaterialSelection) return;
    const materialUrl = videoKickoff.generatedVideo?.url || videoKickoff.video?.aiAnalysis?.materialUrl || videoKickoff.video?.videoUrl || '';
    const title = videoKickoff.generatedVideo?.title || videoKickoff.video?.title || '';
    const matched = materials.find(m => (materialUrl && m.url === materialUrl) || (title && m.name.includes(title.slice(0, 40))));
    if (matched) {
      setSelected([matched.id]);
      if (videoKickoff.materialRole === 'hook' || videoKickoff.source === 'material_library') {
        setHookMaterialId(matched.id);
        applyInferredMaterialTheme(matched);
      }
    }
  }, [materials, videoKickoff]);

  const editFor = (clip: Clip): ClipEdit => clipEdits[clip.id] ?? {
    trimStart: 0,
    trimEnd: clip.type === 'image' ? 3 : clip.duration,
    speed: 1,
    transition: '硬切',
    note: '',
  };
  const slotClipEditKey = (slotId: string, clipId: string) => `${slotId}:${clipId}`;
  const editForSlot = (clip: Clip, slot: StoryboardSlot): ClipEdit => {
    const scriptDuration = Math.max(0.5, slot.end - slot.start);
    const base = clipEdits[slotClipEditKey(slot.id, clip.id)] ?? editFor(clip);
    const targetDuration = Math.max(0.5, base.targetDurationEdited ? base.targetDuration || scriptDuration : scriptDuration);
    const maxEnd = clip.type === 'image' ? Math.max(10, targetDuration) : Math.max(1, clip.duration || targetDuration);
    const trimStart = Math.max(0, Math.min(base.trimStart || 0, Math.max(0, maxEnd - 0.5)));
    const automaticTrimEnd = Math.min(maxEnd, trimStart + Math.min(targetDuration, maxEnd - trimStart));
    const trimEnd = base.trimRangeEdited
      ? Math.min(maxEnd, Math.max(trimStart + 0.1, base.trimEnd || automaticTrimEnd))
      : automaticTrimEnd;
    return {
      ...base,
      trimStart,
      trimEnd,
      // Historical drafts stored the then-derived duration. Only preserve it
      // when the user explicitly changed the control; otherwise the script is
      // the source of truth (important after repairing a missed first range).
      targetDuration,
      targetDurationEdited: Boolean(base.targetDurationEdited),
      trimRangeEdited: Boolean(base.trimRangeEdited),
      speed: targetDuration > 0 && trimEnd > trimStart ? Math.max(0.25, Math.min((trimEnd - trimStart) / targetDuration, 4)) : base.speed,
      note: slot.detail,
    };
  };
  const voiceAlignedEditForSlot = (clip: Clip, slot: StoryboardSlot, language: string): ClipEdit => {
    const base = editForSlot(clip, slot);
    // Once any shot is driven by a digital human, every visual boundary must
    // follow this language's paragraph-aligned TTS cues. Otherwise the final
    // renderer scales the generated lip motion back to generic storyboard
    // durations and silently reintroduces A/V drift. Ordinary material-only
    // projects retain their existing editable timing behavior.
    const containsDigitalHuman = storyboardSlots.some(item => shotMediaModes[item.id] === 'digital');
    if (!containsDigitalHuman) return base;
    const slotIndex = Math.max(0, storyboardSlots.findIndex(item => item.id === slot.id));
    const languageVoiceover = voiceoverForLanguage(language);
    const storyboardDuration = Math.max(0.1, storyboardSlots[storyboardSlots.length - 1]?.end || duration || 15);
    const languageDuration = Math.max(0.1, languageVoiceover.duration || storyboardDuration);
    const speech = resolveShotDigitalHumanSpeechSegment({
      fullScript: voiceDrafts[language] || (language === activeVoiceLang ? activeSpokenScript : ''),
      slotIndex,
      slotCount: storyboardSlots.length,
      cues: languageVoiceover.cues,
      fallbackStart: Math.max(0, slot.start * languageDuration / storyboardDuration),
      fallbackEnd: Math.max(0.2, slot.end * languageDuration / storyboardDuration),
    });
    if (speech.alignmentSource !== 'tts_cues') return base;
    const targetDuration = Math.max(0.5, speech.end - speech.start);
    const maxEnd = clip.type === 'image' ? Math.max(10, targetDuration) : Math.max(0.1, clip.duration || targetDuration);
    const trimStart = Math.max(0, Math.min(base.trimStart, Math.max(0, maxEnd - 0.1)));
    const trimEnd = clip.type === 'image'
      ? trimStart + targetDuration
      : Math.min(maxEnd, Math.max(trimStart + 0.1, trimStart + targetDuration));
    return {
      ...base,
      trimStart,
      trimEnd,
      targetDuration,
      speed: trimEnd > trimStart ? Math.max(0.25, Math.min((trimEnd - trimStart) / targetDuration, 4)) : base.speed,
    };
  };
  const defaultEditForSlot = (clip: Clip, slot: StoryboardSlot): ClipEdit => {
    const trim = automaticStoryboardTrim(clip.duration, slot.end - slot.start, clip.type === 'image' ? 'image' : 'video');
    const usable = trim.trimEnd - trim.trimStart;
    return {
      trimStart: trim.trimStart,
      trimEnd: trim.trimEnd,
      targetDuration: trim.targetDuration,
      speed: usable > 0 ? Math.max(0.25, Math.min(usable / trim.targetDuration, 4)) : 1,
      transition: '硬切',
      note: slot.detail,
    };
  };
  useEffect(() => {
    const firstSlot = storyboardSlots[0];
    const hookClip = hookMaterialId ? materialById.get(hookMaterialId) : undefined;
    if (!firstSlot || !hookClip) return;
    setStoryboardAssignments(current => current[firstSlot.id] === hookClip.id
      ? current
      : { ...current, [firstSlot.id]: hookClip.id });
    setClipEdits(current => {
      const key = slotClipEditKey(firstSlot.id, hookClip.id);
      return current[key] ? current : { ...current, [key]: defaultEditForSlot(hookClip, firstSlot) };
    });
  }, [hookMaterialId, materialById, storyboardSlots]); // eslint-disable-line react-hooks/exhaustive-deps
  const patchStoryboardClipEdit = (slot: StoryboardSlot, clip: Clip, field: 'targetDuration' | 'trimStart' | 'trimEnd' | 'speed', rawValue: number) => {
    if (!Number.isFinite(rawValue)) return;
    const key = slotClipEditKey(slot.id, clip.id);
    setClipEdits(current => {
      const base = current[key] || defaultEditForSlot(clip, slot);
      const maxSourceDuration = clip.type === 'image' ? 60 : Math.max(0.5, clip.duration || base.trimEnd || 0.5);
      const next = { ...base };
      if (field === 'targetDuration') {
        next.targetDuration = Math.max(0.5, Math.min(60, rawValue));
        next.targetDurationEdited = true;
        if (clip.type === 'video') next.speed = Math.max(0.25, Math.min((next.trimEnd - next.trimStart) / next.targetDuration, 4));
      } else if (field === 'trimStart' && clip.type === 'video') {
        next.trimStart = Math.max(0, Math.min(rawValue, Math.max(0, next.trimEnd - 0.1)));
        next.trimRangeEdited = true;
        next.speed = Math.max(0.25, Math.min((next.trimEnd - next.trimStart) / Math.max(0.5, next.targetDuration || slot.end - slot.start), 4));
      } else if (field === 'trimEnd' && clip.type === 'video') {
        next.trimEnd = Math.max(next.trimStart + 0.1, Math.min(rawValue, maxSourceDuration));
        next.trimRangeEdited = true;
        next.speed = Math.max(0.25, Math.min((next.trimEnd - next.trimStart) / Math.max(0.5, next.targetDuration || slot.end - slot.start), 4));
      } else if (field === 'speed' && clip.type === 'video') {
        next.speed = Math.max(0.25, Math.min(4, rawValue));
        next.targetDuration = Math.max(0.5, Math.min(60, (next.trimEnd - next.trimStart) / next.speed));
        next.targetDurationEdited = true;
      }
      return { ...current, [key]: next };
    });
  };
  const renderTimeline = useMemo(() => {
    let timelineCursor = 0;
    const rows = storyboardSlots.map(slot => {
      const assignmentId = storyboardAssignmentIdForMode(slot.id, activeVoiceLang, storyboardAssignments, shotMediaModes);
      const clip = materialById.get(assignmentId || '');
      if (!clip) return null;
      const edit = voiceAlignedEditForSlot(clip, slot, activeVoiceLang);
      const targetDuration = Math.max(0.5, edit.targetDuration || slot.end - slot.start);
      const targetStart = timelineCursor;
      timelineCursor += targetDuration;
      const digitalHumanGenerated = shotMediaModes[slot.id] === 'digital';
      return {
        clipId: clip.id,
        name: clip.name,
        type: clip.type,
        url: clip.url,
        poster: clip.poster,
        folder: clip.folder,
        sourceType: digitalHumanGenerated ? 'digital-human' : clip.sourceType,
        assetRole: clip.assetRole,
        digitalHumanGenerated,
        trimStart: edit.trimStart,
        trimEnd: edit.trimEnd,
        speed: edit.speed,
        targetStart,
        targetEnd: timelineCursor,
        targetDuration,
      };
    }).filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (storyboardSlots.length) return rows;
    return selectedClips.map(clip => {
      const edit = editFor(clip);
      return {
        clipId: clip.id,
        name: clip.name,
        type: clip.type,
        url: clip.url,
        poster: clip.poster,
        folder: clip.folder,
        sourceType: clip.sourceType,
        assetRole: clip.assetRole,
        digitalHumanGenerated: clip.sourceType === 'digital-human' || clip.assetRole === 'generated_clip',
        trimStart: edit.trimStart,
        trimEnd: edit.trimEnd,
        speed: edit.speed,
        targetStart: undefined,
        targetEnd: undefined,
        targetDuration: Math.max(0.5, edit.trimEnd - edit.trimStart),
      };
    });
  }, [activeSpokenScript, activeVoiceLang, clipEdits, duration, materialById, selectedClips, shotMediaModes, storyboardAssignments, storyboardSlots, voiceDrafts, voiceoverAudios]);
  const timelineForAssembly = (assembly: StoryboardAssembly, language = activeVoiceLang) => {
    let timelineCursor = 0;
    const rows = storyboardSlots.map(slot => {
      const assignmentId = storyboardAssignmentIdForMode(slot.id, language, assembly.assignments, shotMediaModes);
      const clip = materialById.get(assignmentId || '');
      if (!clip) return null;
      const edit = voiceAlignedEditForSlot(clip, slot, language);
      const targetDuration = Math.max(0.5, edit.targetDuration || slot.end - slot.start);
      const targetStart = timelineCursor;
      timelineCursor += targetDuration;
      const digitalHumanGenerated = shotMediaModes[slot.id] === 'digital';
      return {
        clipId: clip.id, name: clip.name, type: clip.type, url: clip.url, poster: clip.poster,
        folder: clip.folder, sourceType: digitalHumanGenerated ? 'digital-human' : clip.sourceType,
        assetRole: clip.assetRole, digitalHumanGenerated,
        trimStart: edit.trimStart, trimEnd: edit.trimEnd, speed: edit.speed,
        targetStart, targetEnd: timelineCursor, targetDuration,
      };
    }).filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (storyboardSlots.length) return rows;
    return assembly.selected.map(id => materialById.get(id)).filter((clip): clip is Clip => Boolean(clip)).map(clip => {
      const edit = editFor(clip);
      return {
        clipId: clip.id, name: clip.name, type: clip.type, url: clip.url, poster: clip.poster,
        folder: clip.folder, sourceType: clip.sourceType, assetRole: clip.assetRole,
        digitalHumanGenerated: clip.sourceType === 'digital-human' || clip.assetRole === 'generated_clip',
        trimStart: edit.trimStart, trimEnd: edit.trimEnd, speed: edit.speed,
        targetStart: undefined, targetEnd: undefined, targetDuration: Math.max(0.5, edit.trimEnd - edit.trimStart),
      };
    });
  };
  const contentPlanVersions = useMemo(() => {
    const current: StoryboardAssembly = { id: activeAssemblyId, name: assemblyName, assignments: storyboardAssignments, sourcePlans: storyboardSourcePlans, selected };
    return storyboardAssemblies.map(item => item.id === activeAssemblyId ? current : item);
  }, [activeAssemblyId, assemblyName, selected, storyboardAssemblies, storyboardAssignments, storyboardSourcePlans]);
  const scriptForRenderLanguage = (code: string) => String(voiceDrafts[code] || (code === activeVoiceLang ? activeSpokenScript : '')).trim();
  const renderScriptLanguages = () => Array.from(new Set([...voiceLangs, activeVoiceLang].filter(Boolean)))
    .filter(code => Boolean(scriptForRenderLanguage(code)))
    .filter(code => {
      if (voiceoverMode === 'none') return true;
      if (voiceoverMode === 'upload') return code === activeVoiceLang && Boolean(voiceoverUrl);
      if (voiceoverMode === 'ai') return Boolean(voiceoverAudios[code]?.url) && !voiceoverStaleLangs.includes(code);
      return false;
    });
  const buildRenderableVideoVersions = () => {
    const languages = renderScriptLanguages();
    return contentPlanVersions.flatMap((plan, planIndex) => {
      return languages.map((code, languageIndex) => {
        const timeline = timelineForAssembly(plan, code);
        const validStoryboard = storyboardSlots.length > 0
          && timeline.length === storyboardSlots.length
          && timeline.every(item => Boolean(item.url && item.type !== 'audio' && item.targetDuration > 0));
        if (!validStoryboard) return null;
        const bgmId = materialVersionBgms[materialVersionKey(plan.id, code)] ?? assemblyBgms[plan.id] ?? bgm;
        const audioDuration = voiceoverForLanguage(code).duration;
        const fittedTimeline = fitTimelineToVoiceover<(typeof timeline)[number]>(timeline, audioDuration);
        const inputSignature = JSON.stringify({
          renderPipelineVersion: RENDER_AI_DISCLOSURE_PIPELINE_VERSION,
          script: scriptForRenderLanguage(code),
          voiceoverUrl: voiceoverForLanguage(code).url,
          voiceoverDuration: audioDuration,
          timeline: fittedTimeline.map(item => ({
            clipId: item.clipId, url: item.url, trimStart: item.trimStart, trimEnd: item.trimEnd,
            speed: item.speed, targetStart: item.targetStart, targetEnd: item.targetEnd, targetDuration: item.targetDuration,
            sourceType: item.sourceType, assetRole: item.assetRole, digitalHumanGenerated: item.digitalHumanGenerated,
          })),
          bgmId, bgmVol, voiceVol, ratio, subtitlesOn, subMode,
          cues: alignedCuesByLang[code] || [],
          cover, coverTitle, coverStyle, capturedCoverFrameUrl,
        });
        return {
          key: renderCombinationKey(plan.id, code, bgmId),
          plan,
          planIndex,
          code,
          languageIndex,
          bgmId,
          script: scriptForRenderLanguage(code),
          timeline: fittedTimeline,
          inputSignature,
        };
      }).filter((item): item is NonNullable<typeof item> => Boolean(item));
    });
  };
  const previewTimeline = useMemo(() => renderTimeline
    .map(item => {
      const clip = materialById.get(item.clipId || '') || materials.find(candidate => candidate.name === item.name);
      if (!clip || !clip.url || clip.type === 'audio') return null;
      return { ...item, clip };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item)), [materials, materialById, renderTimeline]);
  useEffect(() => {
    const cache = previewVideoCacheRef.current;
    const activeUrls = new Set<string>();
    previewTimeline.forEach(item => {
      if (item.clip.type !== 'video' || !item.clip.url) return;
      activeUrls.add(item.clip.url);
      if (cache.has(item.clip.url)) return;
      const video = document.createElement('video');
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      video.src = item.clip.url;
      video.load();
      cache.set(item.clip.url, video);
    });
    cache.forEach((video, url) => {
      if (activeUrls.has(url)) return;
      video.pause();
      video.removeAttribute('src');
      video.load();
      cache.delete(url);
    });

    const nextIndex = previewIdx === null ? 0 : previewIdx + 1;
    const nextItem = previewTimeline[nextIndex];
    const nextVideoUrl = nextItem?.clip.type === 'video' ? nextItem.clip.url : '';
    if (nextItem && nextVideoUrl) {
      const nextVideo = cache.get(nextVideoUrl);
      if (nextVideo) {
        const warmNextFrame = () => {
          const seekTo = Math.max(0, nextItem.trimStart || 0);
          try { nextVideo.currentTime = seekTo; } catch { /* ignore preload seek edge cases */ }
        };
        if (nextVideo.readyState >= 1) warmNextFrame();
        else nextVideo.addEventListener('loadedmetadata', warmNextFrame, { once: true });
      }
    }
  }, [previewIdx, previewTimeline]);
  useEffect(() => () => {
    previewVideoCacheRef.current.forEach(video => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    });
    previewVideoCacheRef.current.clear();
  }, []);
  const previewOffsetByIndex = useMemo(() => {
    const offsets: number[] = [];
    let cursor = 0;
    previewTimeline.forEach((item, index) => {
      offsets[index] = cursor;
      cursor += Math.max(0.5, item.targetDuration || ((item.trimEnd || 0) - (item.trimStart || 0)) || 3);
    });
    return offsets;
  }, [previewTimeline]);
  const cueAtTime = (time: number): SubCue | null => {
    if (!subtitlesOn || !cues.length) return null;
    const current = cues.find(cue => time >= cue.start && time < cue.end);
    if (current) return current;
    return cues.find(cue => Math.abs(time - cue.start) < 0.25) || null;
  };
  const activePreviewCue = cueAtTime(previewTime);
  const patchClipEdit = (clip: Clip, patch: Partial<ClipEdit>) => {
    setClipEdits(prev => {
      const base = prev[clip.id] ?? {
        trimStart: 0,
        trimEnd: clip.type === 'image' ? 3 : clip.duration,
        speed: 1,
        transition: '硬切',
        note: '',
      };
      const next = { ...base, ...patch };
      const maxEnd = clip.type === 'image' ? 10 : Math.max(1, clip.duration);
      next.trimStart = Math.max(0, Math.min(Number(next.trimStart) || 0, maxEnd));
      next.trimEnd = Math.max(next.trimStart + 0.5, Math.min(Number(next.trimEnd) || maxEnd, maxEnd));
      next.speed = Math.max(0.25, Math.min(Number(next.speed) || 1, 4));
      return { ...prev, [clip.id]: next };
    });
  };

  const goPreview = async (scriptOverride?: string, renderOverride?: { language?: string; voiceoverUrl?: string; voiceoverDur?: number; cues?: SubCue[]; outputOnly?: boolean; timeline?: typeof renderTimeline; bgmId?: string }) => {
    const outputOnly = Boolean(renderOverride?.outputOnly);
    if (!outputOnly) {
      setStepIdx(STEPS.findIndex(s => s.id === 'preview'));
      setRendered(false);
      setRendering(true);
      setRenderPct(0);
      setRenderOutputPath(null);
      setRenderOutputPreviewUrl(null);
    }
    const token = ++renderToken.current;
    try {

	    // 生成发布封面 SVG：只在有真实图片帧时生成，避免退回纯色/渐变封面。
	    const canGenerateCoverSvg = Boolean(coverFrameUrl && (capturedCoverFrameUrl || coverClip?.poster || coverClip?.type === 'image'));
	    const cv = canGenerateCoverSvg
        ? await studioApi.cover({ title: coverTitle, ratio, accent: '#16a34a', bgImageUrl: coverFrameUrl, ...coverStyle })
        : { ok: false as const, url: null };
    if (renderToken.current !== token) return;
    const cUrl = cv.ok ? (cv.url ?? null) : null;
    if (!outputOnly) setCoverUrl(cUrl);

    const outputLanguage = renderOverride?.language || lang;
    const defaultVoiceover = voiceoverForLanguage(outputLanguage);
    const outputVoiceoverUrl = renderOverride?.voiceoverUrl ?? defaultVoiceover.url;
    const outputVoiceoverDur = renderOverride?.voiceoverDur ?? defaultVoiceover.duration;
    const outputScript = scriptOverride ?? (voiceDrafts[outputLanguage] || activeSpokenScript);
    const requestedTimeline = renderOverride?.timeline ?? renderTimeline;
    const outputTimeline = voiceoverMode === 'none'
      ? requestedTimeline
      : fitTimelineToVoiceover<(typeof requestedTimeline)[number]>(requestedTimeline, outputVoiceoverDur);
    const validOutputStoryboard = storyboardSlots.length > 0
      && outputTimeline.length === storyboardSlots.length
      && outputTimeline.every(item => Boolean(item.url && item.type !== 'audio' && item.targetDuration > 0));
    if (!String(outputScript || '').trim() || !validOutputStoryboard) {
      throw new Error('生成成片需要有效脚本，并为全部分镜匹配有效视频或图片素材。');
    }
    const timelineDuration = outputTimeline.reduce((sum, item) => sum + (item.targetDuration || 0), 0);
    const rawOutputCues = renderOverride?.cues?.length
      ? renderOverride.cues
      : defaultVoiceover.cues.length
        ? defaultVoiceover.cues
        : buildCues(outputScript, outputVoiceoverDur || timelineDuration || totalDur);
    const outputCues = renderSafeCues(rawOutputCues, Math.min(
      timelineDuration || duration,
      outputVoiceoverDur > 0 ? outputVoiceoverDur : timelineDuration || duration,
    ));
    const spec = {
      materials: outputTimeline.length ? outputTimeline.map(item => item.name) : matNames,
      timeline: outputTimeline,
      script: outputScript,
      voice,
      bgm: renderOverride?.bgmId ?? bgm,
      bgmVol,
      voiceVol,
      coverId: cover,
      coverTitle,
      coverUrl: cUrl ?? undefined,
      ratio,
      sourceProjectId: projectId || undefined,
      duration: timelineDuration || duration,
      platform,
      language: outputLanguage,
      voiceoverUrl: voiceoverMode === 'none' ? undefined : outputVoiceoverUrl ?? undefined,
      subtitles: subtitlesOn ? {
        mode: subMode,
        style: { font: coverStyle.font, color: coverStyle.color, weight: coverStyle.weight, fontFamily: coverStyle.fontFamily },
        cues: subMode === 'bilingual' && outputLanguage === activeVoiceLang && cueZh.length === outputCues.length
          ? outputCues.map((c, i) => ({ ...c, zh: cueZh[i] }))
          : outputCues,
      } : { mode: 'off' as const, style: {}, cues: [] },
    };

    // 1) 向服务器申请渲染授权（原料 manifest + 短期令牌）
    const auth = await studioApi.render(spec);

    // 2) 桌面客户端：用本机原生 ffmpeg 真实合成出片
    const desktop = getDesktopRender();
    // Digital-human outputs must return through the server-owned completion
    // gate. The Electron IPC accepts a renderer-provided manifest and cannot
    // authoritatively persist or approve the final media result.
    if (desktop?.available && auth.manifest.aiDisclosure?.containsDigitalHuman !== true) {
      const unsub = desktop.onProgress(p => {
        if (!outputOnly && renderToken.current === token) setRenderPct(Math.min(99, Math.round(p)));
      });
      try {
        const out = await desktop.render(auth.manifest);
        if (renderToken.current !== token) return;
        if (out.ok) {
          if (!outputOnly) {
            setRenderOutputPath(out.outputPath ?? null);
            setRendering(false);
            setRendered(true);
            setRenderPct(100);
          }
          return out.outputPath ?? null;
        } else {
          if (!outputOnly) {
            setRendering(false);
            setRendered(false);
          }
          throw new Error(out.error || '桌面端合成失败');
        }
      } finally {
        unsub();
      }
      return;
    }

    // 3) 网页环境：没有 Electron 桥时，走本机后端 ffmpeg 兜底导出。
    if (!outputOnly) setRenderPct(20);
    const progressTimer = outputOnly ? undefined : window.setInterval(() => {
      if (renderToken.current !== token) return;
      setRenderPct(current => Math.min(90, current + (current < 60 ? 6 : 2)));
    }, 1200);
    const localOut = await studioApi.renderLocal(auth.manifest).finally(() => {
      if (progressTimer !== undefined) window.clearInterval(progressTimer);
    });
    if (renderToken.current !== token) return;
    if (!localOut.ok) throw new Error(localOut.error || '本地 MP4 导出失败');
    if (localOut.outputPath && localOut.previewUrl) renderPreviewUrlsRef.current[localOut.outputPath] = localOut.previewUrl;
    if (!outputOnly) {
      setRenderOutputPath(localOut.outputPath ?? null);
      setRenderOutputPreviewUrl(localOut.previewUrl ?? null);
      setRendering(false);
      setRendered(true);
      setRenderPct(100);
    }
    return localOut.outputPath ?? null;
    } catch (err: any) {
      if (!outputOnly && renderToken.current === token) {
        setRendering(false);
        setRendered(false);
        alert(err?.message || '成片预览失败，请稍后重试。');
      }
      throw err;
    }
  };

  const next = () => {
    if (contentMode === 'video' && step === 'script' && scriptStageTab === 'theme') {
      const unsupportedClaims = pendingClaimLocations(script, activeProductInfo);
      const missingThemeEvidence = activeVideoTheme.requires.some(requirement => (
        (requirement === 'material' && !materials.some(item => item.type !== 'audio'))
        || (requirement === 'factory' && !materials.some(item => item.folder === 'factory') && !/工厂|产线|质检|产能|factory|production line|quality control/i.test(activeProductInfo))
        || (requirement === 'case' && !/客户案例|合作案例|案例结果|customer case|case study/i.test(activeProductInfo))
      ));
      if (unsupportedClaims.length || missingThemeEvidence) {
        alert([
          '分镜质量校验未通过，请修改后重试。',
          ...unsupportedClaims.map(item => `未获企业资料支持：${item}`),
          ...(missingThemeEvidence ? [`“${activeVideoTheme.title}”缺少必需的真实素材或企业证据。`] : []),
        ].join('\n'));
        return;
      }
      if (hasTimestampScript) setScriptStageTab('voiceover');
      return;
    }
    if (contentMode === 'video' && step === 'script' && scriptStageTab === 'voiceover') {
      setScriptStageTab('audio');
      return;
    }
    if (contentMode === 'video' && step === 'script' && scriptStageTab === 'audio') {
      setScriptStageTab('subtitle');
      return;
    }
    if (contentMode === 'video' && step === 'script' && scriptStageTab === 'subtitle') {
      setScriptStageTab('bgm');
      return;
    }
    if (contentMode === 'video' && step === 'material') {
      const qualityBlockers = storyboardSlots.flatMap(slot => {
        const plan = storyboardSourcePlans[slot.id];
        if (storyboardQualityChecking[slot.id]) return [`分镜“${slot.title}”仍在质检中`];
        if (plan?.qualityError) return [`分镜“${slot.title}”质检失败：${plan.qualityError}`];
        if (plan?.quality && !plan.quality.passed) return [`分镜“${slot.title}”未通过质检：${plan.quality.issues.join('、') || plan.quality.recommendation}`];
        return [];
      });
      const blockers = [...qualityBlockers, ...validateStudioTimeline(renderTimeline)];
      if (blockers.length) {
        alert(`无法进入配乐：\n${blockers.join('\n')}`);
        return;
      }
    }
    const nextStep = activeSteps[stepIdx + 1]?.id;
    if (contentMode === 'video' && nextStep === 'material') setActiveFolder('all');
    setStepIdx(i => Math.min(i + 1, activeSteps.length - 1));
  };
  const renderSelectedLanguageVersion = async (selectedKey?: string) => {
    const combinations = buildRenderableVideoVersions();
    if (!combinations.length) {
      alert('暂无可生成的视频版本。请先完成有效脚本，并为全部分镜匹配有效素材。');
      return;
    }
    const fallbackKey = renderCombinationKey(
      activeAssemblyId,
      activeVoiceLang,
      materialVersionBgms[materialVersionKey(activeAssemblyId, activeVoiceLang)] ?? assemblyBgms[activeAssemblyId] ?? bgm,
    );
    const combination = combinations.find(item => item.key === selectedKey)
      || combinations.find(item => item.key === activeRenderCombinationKey)
      || combinations.find(item => item.key === fallbackKey)
      || combinations[0];
    if (!combination) return;
    setBatchRenderingLangs(true);
    setActiveRenderCombinationKey(combination.key);
    setLanguageRenderOutputs(prev => ({ ...prev, [combination.key]: { status: 'rendering', inputSignature: combination.inputSignature } }));
    try {
      const { key, code, bgmId } = combination;
      const audio = voiceoverForLanguage(code);
      const outputPath = await goPreview(combination.script, {
        language: code,
        voiceoverUrl: audio.url,
        voiceoverDur: audio.duration,
        cues: audio.cues,
        outputOnly: true,
        timeline: combination.timeline as typeof renderTimeline,
        bgmId,
      });
      const previewUrl = outputPath ? renderPreviewUrlsRef.current[outputPath] : undefined;
      setLanguageRenderOutputs(prev => ({ ...prev, [key]: { status: 'done', inputSignature: combination.inputSignature, path: outputPath || undefined, previewUrl } }));
      setLanguageRenderVersions(prev => ({ ...prev, [key]: [{ id: `${key}-${Date.now()}`, versionNumber: (prev[key]?.[0]?.versionNumber || 0) + 1, status: 'done', inputSignature: combination.inputSignature, path: outputPath || undefined, previewUrl, createdAt: new Date().toISOString() }, ...(prev[key] || [])] }));
    } catch (err: any) {
      const key = combination.key;
      setLanguageRenderOutputs(prev => ({ ...prev, [key]: { status: 'failed', inputSignature: combination.inputSignature, error: err?.message || '生成失败' } }));
      setLanguageRenderVersions(prev => ({ ...prev, [key]: [{ id: `${key}-${Date.now()}`, versionNumber: (prev[key]?.[0]?.versionNumber || 0) + 1, status: 'failed', inputSignature: combination.inputSignature, error: err?.message || '生成失败', createdAt: new Date().toISOString() }, ...(prev[key] || [])] }));
    } finally {
      setBatchRenderingLangs(false);
    }
  };
  const renderAllReadyLanguageVersions = async () => {
    const combinations = buildRenderableVideoVersions();
    if (!combinations.length) throw new Error('没有可合成的语言版本。');
    setBatchRenderingLangs(true);
    const failures: string[] = [];
    try {
      for (const combination of combinations) {
        const existing = languageRenderOutputs[combination.key];
        if (existing?.status === 'done' && existing.path && existing.inputSignature === combination.inputSignature) continue;
        const { key, code, bgmId } = combination;
        const audio = voiceoverForLanguage(code);
        setActiveRenderCombinationKey(key);
        setLanguageRenderOutputs(prev => ({ ...prev, [key]: { status: 'rendering', inputSignature: combination.inputSignature } }));
        try {
          const outputPath = await goPreview(combination.script, {
            language: code,
            voiceoverUrl: audio.url,
            voiceoverDur: audio.duration,
            cues: audio.cues,
            outputOnly: true,
            timeline: combination.timeline as typeof renderTimeline,
            bgmId,
          });
          const previewUrl = outputPath ? renderPreviewUrlsRef.current[outputPath] : undefined;
          setLanguageRenderOutputs(prev => ({ ...prev, [key]: { status: 'done', inputSignature: combination.inputSignature, path: outputPath || undefined, previewUrl } }));
          setLanguageRenderVersions(prev => ({ ...prev, [key]: [{ id: `${key}-${Date.now()}`, versionNumber: (prev[key]?.[0]?.versionNumber || 0) + 1, status: 'done', inputSignature: combination.inputSignature, path: outputPath || undefined, previewUrl, createdAt: new Date().toISOString() }, ...(prev[key] || [])] }));
        } catch (error) {
          const message = error instanceof Error ? error.message : '生成失败';
          failures.push(`${langZh(code) || code}：${message}`);
          setLanguageRenderOutputs(prev => ({ ...prev, [key]: { status: 'failed', inputSignature: combination.inputSignature, error: message } }));
          setLanguageRenderVersions(prev => ({ ...prev, [key]: [{ id: `${key}-${Date.now()}`, versionNumber: (prev[key]?.[0]?.versionNumber || 0) + 1, status: 'failed', inputSignature: combination.inputSignature, error: message, createdAt: new Date().toISOString() }, ...(prev[key] || [])] }));
        }
      }
    } finally {
      setBatchRenderingLangs(false);
    }
    if (failures.length) throw new Error(`部分语言成片生成失败：${failures.join('；')}`);
  };
  const retryLanguageRender = async (combination: { key: string; code: string; plan: StoryboardAssembly; bgmId: string }) => {
    const currentCombination = buildRenderableVideoVersions().find(item => item.key === combination.key);
    if (!currentCombination) return;
    const { key, code, bgmId, inputSignature } = currentCombination;
    const audio = voiceoverForLanguage(code);
    setLanguageRenderOutputs(prev => ({ ...prev, [key]: { status: 'rendering', inputSignature } }));
    try {
      const outputPath = await goPreview(currentCombination.script, {
        language: code,
        voiceoverUrl: audio.url,
        voiceoverDur: audio.duration,
        cues: audio.cues,
        outputOnly: true,
        timeline: currentCombination.timeline as typeof renderTimeline,
        bgmId,
      });
      const previewUrl = outputPath ? renderPreviewUrlsRef.current[outputPath] : undefined;
      setLanguageRenderOutputs(prev => ({ ...prev, [key]: { status: 'done', inputSignature, path: outputPath || undefined, previewUrl } }));
      setLanguageRenderVersions(prev => ({ ...prev, [key]: [{ id: `${key}-${Date.now()}`, versionNumber: (prev[key]?.[0]?.versionNumber || 0) + 1, status: 'done', inputSignature, path: outputPath || undefined, previewUrl, createdAt: new Date().toISOString() }, ...(prev[key] || [])] }));
    } catch (err: any) {
      setLanguageRenderOutputs(prev => ({ ...prev, [key]: { status: 'failed', inputSignature, error: err?.message || '生成失败' } }));
      setLanguageRenderVersions(prev => ({ ...prev, [key]: [{ id: `${key}-${Date.now()}`, versionNumber: (prev[key]?.[0]?.versionNumber || 0) + 1, status: 'failed', inputSignature, error: err?.message || '生成失败', createdAt: new Date().toISOString() }, ...(prev[key] || [])] }));
    }
  };
  const prev = () => {
    if (contentMode === 'video' && step === 'script' && scriptStageTab === 'bgm') {
      setScriptStageTab('subtitle');
      return;
    }
    if (contentMode === 'video' && step === 'script' && scriptStageTab === 'subtitle') {
      setScriptStageTab('audio');
      return;
    }
    if (contentMode === 'video' && step === 'script' && scriptStageTab === 'audio') {
      setScriptStageTab('voiceover');
      return;
    }
    if (contentMode === 'video' && step === 'script' && scriptStageTab === 'voiceover') {
      setScriptStageTab('theme');
      return;
    }
    setStepIdx(i => Math.max(i - 1, 0));
  };

  const regenScript = async (type: 'voiceover' | 'storyboard' = scriptType) => {
    if (!activeProductInfo.trim() || !activeProductLabel) {
      alert('请先在第一步选择企业中心产品，再生成脚本。');
      setStepIdx(0);
      return;
    }
    const requestId = ++scriptTaskRequestRef.current;
    const specEpoch = studioSpecEpochRef.current;
    const isCurrentRequest = () => scriptTaskRequestRef.current === requestId && studioSpecEpochRef.current === specEpoch;
    setScriptLoading(true);
    try {
      const response = await studioApi.script(
        { materials: matNames, productInfo: activeProductInfo, language: lang, platform, duration, scriptType: type, generationMode: mode, cooperationRoute, provider, audience, sellingPoints, tone, videoTheme: videoThemePayload }, script,
      );
      if (!isCurrentRequest()) return;
      if (type === 'storyboard') announceRejectedStoryboard(response);
      const qualityFailure = scriptQualityFailure(response, 'AI脚本未通过检查，未返回可编辑结果。', true);
      if (qualityFailure) throw new Error(qualityFailure);
      const s = response.script || '';
      if (!s.trim()) throw new Error('模型没有返回可用脚本。');
      const nextScript = sanitizeStoryboardScript(s, activeProductInfo, activeProductLabel);
      setScript(nextScript);
      setModeScripts(current => current.map(item => item.id === activeModeScriptId
        ? { ...item, script: nextScript, ...qualityFields(response) }
        : item));
      setModeNotice(qualitySuccessNotice(response, '脚本已重新生成并写入结果区。'));
    } catch (err: any) {
      if (isCurrentRequest()) alert(err?.message || '脚本生成失败，请稍后重试。');
    } finally {
      if (isCurrentRequest()) setScriptLoading(false);
    }
  };

  const smartSelectMaterialsFast = async () => {
    if (materialSelectLoading) return;
    setMaterialSelectLoading(true);
    setModeNotice('正在按分镜语义、镜头角色和有效时长快速匹配…');
    try {
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
      const allVisuals = materials.filter(item => (
        item.type !== 'audio'
        && item.usage !== 'reference_only'
        && item.folder !== 'presenter'
        && item.assetRole !== 'avatar_master'
        && item.assetRole !== 'avatar_motion_clip'
        && item.assetRole !== 'generated_clip'
      ));
      const compatiblePool = allVisuals.filter(item => isClipCompatibleWithRatio(item, ratio));
      if (!allVisuals.length) {
        setModeNotice('素材库暂无可匹配的视频或图片，请先上传素材。');
        return;
      }
      if (!storyboardSlots.length) {
        const rankedPool = [...allVisuals].sort((a, b) => clipRatioPreferenceScore(b, ratio) - clipRatioPreferenceScore(a, ratio));
        const picked = pickMaterialClipsLocally(rankedPool, duration, selected).selectedIds;
        setSelected(picked);
        setScriptRecommendedMaterialIds(picked);
        setActiveFolder('recommend');
        setModeNotice(`已快速选出 ${picked.length} 条候选素材；生成时间戳脚本后可继续逐镜匹配。`);
        return;
      }

      const savedCurrent: StoryboardAssembly = {
        id: activeAssemblyId,
        name: assemblyName,
        assignments: storyboardAssignments,
        sourcePlans: storyboardSourcePlans,
        selected,
      };
      const allPlans = storyboardAssemblies.map(item => item.id === activeAssemblyId ? savedCurrent : item);
      const variantIndex = Math.max(0, allPlans.findIndex(item => item.id === activeAssemblyId));
      const previousAssignments = allPlans
        .filter(item => item.id !== activeAssemblyId)
        .map(item => item.assignments)
        .filter(item => Object.keys(item).length > 0);
      // 所有视觉素材都可参与匹配；同方向优先，其他方向在渲染时居中裁切。
      const pool = allVisuals;
      const usesCropFallback = compatiblePool.length < Math.min(storyboardSlots.length, allVisuals.length);
      const lockedAssignments = Object.fromEntries(Object.entries(storyboardAssignments).filter(([assignmentKey, clipId]) => {
        if (!materialById.has(clipId)) return false;
        const parsed = parseDigitalHumanLanguageKey(assignmentKey);
        if (parsed.language) return storyboardSlots.some(slot => slot.id === parsed.slotId);
        return storyboardSlots.some(slot => slot.id === assignmentKey && shotMediaModes[slot.id] !== 'digital');
      }));
      const lockedClipIds = new Set(Object.values(lockedAssignments));
      const slotsToMatch = storyboardSlots.filter(slot => shotMediaModes[slot.id] !== 'digital' && !lockedAssignments[slot.id]);
      if (!slotsToMatch.length) {
        setModeNotice(storyboardSlots.some(slot => shotMediaModes[slot.id] === 'digital')
          ? '普通素材分镜已全部匹配；数字人分镜将在后台独立生成。'
          : '所有分镜都已经有素材，无需重复匹配。');
        return;
      }
      const unusedPool = pool.filter(item => !lockedClipIds.has(item.id));
      const matchPool = unusedPool.length ? unusedPool : pool;
      const candidateAssignments = matchMaterialsToStoryboardLocally(matchPool, slotsToMatch, selected.filter(id => id !== hookMaterialId), {
        variantIndex,
        previousAssignments,
        targetRatio: ratio,
      });
      const assessmentBySlot: Record<string, MaterialMatchAssessment> = {};
      const matchedAssignments = Object.fromEntries(Object.entries(candidateAssignments).filter(([slotId, clipId]) => {
        const slot = storyboardSlots.find(item => item.id === slotId);
        const clip = materialById.get(clipId);
        if (!slot || !clip) return false;
        const assessment = assessMaterialMatch(slot, clip, ratio);
        assessmentBySlot[slotId] = assessment;
        // Below 60 points the material is only a visual placeholder, not a
        // trustworthy match. Leave the shot open instead of silently filling it.
        return assessment.score >= 60;
      }));
      const assignments = { ...storyboardAssignments, ...lockedAssignments, ...matchedAssignments };
      storyboardSlots.forEach(slot => {
        const clip = materialById.get(assignments[slot.id] || '');
        if (clip && !assessmentBySlot[slot.id]) assessmentBySlot[slot.id] = assessMaterialMatch(slot, clip, ratio);
      });
      const orderedIds = storyboardSlots
        .map(slot => storyboardAssignmentIdForMode(slot.id, activeVoiceLang, assignments, shotMediaModes))
        .filter((id): id is string => Boolean(id));
      const nextEdits: Record<string, ClipEdit> = {};
      const nextPlans: Record<string, StoryboardSourcePlan> = {};
      slotsToMatch.forEach(slot => {
        const clipId = matchedAssignments[slot.id];
        const clip = clipId ? materialById.get(clipId) : undefined;
        if (!clip) return;
        nextEdits[slotClipEditKey(slot.id, clip.id)] = defaultEditForSlot(clip, slot);
        const detectedSource = clipSourceMode(clip);
        nextPlans[slot.id] = {
          ...sourcePlanFor(slot),
          mode: detectedSource,
          decided: true,
          confirmed: false,
          generatedClipId: detectedSource === 'ai' ? clip.id : undefined,
          error: '',
          matchScore: assessmentBySlot[slot.id]?.score,
          matchReason: assessmentBySlot[slot.id]?.reason,
          matchDifference: assessmentBySlot[slot.id]?.difference,
          matchLevel: assessmentBySlot[slot.id]?.level,
        };
      });
      setStoryboardAssignments(assignments);
      setStoryboardSourcePlans(current => ({ ...current, ...nextPlans }));
      setClipEdits(current => ({ ...current, ...nextEdits }));
      setSelected(current => [...new Set([...current, ...orderedIds])]);
      setScriptRecommendedMaterialIds([...new Set(orderedIds)]);
      setActiveFolder('recommend');
      setActiveStoryboardSlotId(storyboardSlots.find(slot => !storyboardAssignmentIdForMode(slot.id, activeVoiceLang, assignments, shotMediaModes))?.id || storyboardSlots[0]?.id || '');
      const reviewCount = storyboardSlots.filter(slot => assessmentBySlot[slot.id]?.level === 'review' && assignments[slot.id]).length;
      const missingCount = storyboardSlots.filter(slot => !storyboardAssignmentIdForMode(slot.id, activeVoiceLang, assignments, shotMediaModes)).length;
      setModeNotice(`已为 ${Object.keys(matchedAssignments).length} 个空分镜补充素材；当前 ${orderedIds.length}/${storyboardSlots.length} 个分镜已匹配${reviewCount ? `，${reviewCount} 个建议人工确认` : ''}${missingCount ? `，仍有 ${missingCount} 个待匹配` : ''}${usesCropFallback ? '。不同画幅会在预览中居中适配' : ''}。`);
    } catch (error) {
      setModeNotice(error instanceof Error ? `智能选材失败：${error.message}` : '智能选材失败，请重试。');
    } finally {
      setMaterialSelectLoading(false);
    }
  };

  const generateFromMaterialLibrary = async () => {
    if (!selectedScriptLanguage) {
      setModeNotice('企业中心尚未配置首选输出语言或主要业务语言，请先完成企业中心语言配置。');
      return false;
    }
    const requestId = ++scriptTaskRequestRef.current;
    const specEpoch = studioSpecEpochRef.current;
    const isCurrentRequest = () => scriptTaskRequestRef.current === requestId && studioSpecEpochRef.current === specEpoch;
    setModeActionLoading(true);
    setModeActionStatus('正在快速匹配本地素材…');
    setModeNotice('');
    try {
      const pool = selectedVisualClips;
      if (pool.length === 0) {
        setModeNotice('请先在创作设置中明确选择本次要使用的视频或图片，再生成脚本。');
        setShowSetupMaterialPicker(true);
        return false;
      }
      const preferred = pool.map(item => item.id);
      const hookOnly = hookMaterialId && pool.some(item => item.id === hookMaterialId);
      const selectResp = hookOnly ? { selectedIds: [hookMaterialId] } : pickMaterialClipsLocally(pool, duration, preferred);
      const nextSelected = (selectResp.selectedIds || []).filter(id => pool.some(item => item.id === id));
      const finalSelected = nextSelected.length ? nextSelected : preferred;
      const selectedMaterialsForScript = finalSelected.map(id => pool.find(item => item.id === id)).filter(Boolean) as Clip[];
      if (hookMaterialId) selectedMaterialsForScript.sort((a, b) => Number(b.id === hookMaterialId) - Number(a.id === hookMaterialId));
      const names = selectedMaterialsForScript.map(item => item.name);
      const materialInfos = buildMaterialInfosForScript(selectedMaterialsForScript, duration, hookMaterialId);
      if (hookOnly && materialInfos.length && materialInfos[0]!.targetEnd < duration - 0.5) {
        let cursor = materialInfos[0]!.targetEnd;
        let index = 2;
        while (cursor < duration - 0.1) {
          const end = Math.min(duration, cursor + 3);
          materialInfos.push({
            name: `待匹配素材（分镜${index}）`, type: 'video', folder: 'recommend', duration: end - cursor,
            effectiveDuration: end - cursor, role: '后续分镜待匹配', targetStart: cursor, targetEnd: end,
            observations: ['本步骤不选择素材；只定义镜头功能，下一步再从素材库匹配'],
          });
          cursor = end;
          index += 1;
        }
      }
      const coveredDuration = materialInfos.at(-1)?.targetEnd || 0;
      const outputs: ModeScriptOutput[] = [];
      const qualityResponses: StudioScriptResult[] = [];
      const count = Math.max(1, Math.min(5, cloneCount));
      for (let i = 0; i < count; i += 1) {
        if (!isCurrentRequest()) return false;
        setModeActionStatus(hookOnly
          ? `正在分析钩子素材并规划后续分镜${count > 1 ? ` ${i + 1}/${count}` : ''}…`
          : `正在分析 ${finalSelected.length} 个推荐素材并生成脚本${count > 1 ? ` ${i + 1}/${count}` : ''}…`);
        let nextScript = '';
        const response = await withTimeout(studioApi.script(
          {
            materials: names,
            materialInfos,
            productInfo: activeProductInfo,
            language: selectedScriptLanguage,
            platform,
            duration,
            scriptType: 'storyboard',
            generationMode: 'material',
            cooperationRoute,
            voiceoverMode: voiceoverMode === 'unselected' ? 'ai' : voiceoverMode,
            provider,
            audience,
            sellingPoints,
            tone: `${tone} · 素材库方案 ${i + 1}`,
            videoTheme: videoThemePayload,
          },
          '',
        ), 120_000, '后端模型生成超过 120 秒。');
        if (!isCurrentRequest()) return false;
        announceRejectedStoryboard(response);
        const qualityFailure = scriptQualityFailure(response, 'AI脚本未通过检查，未返回可编辑结果。', true);
        if (qualityFailure) throw new Error(qualityFailure);
        nextScript = sanitizeStoryboardScript(response.script || '', activeProductInfo, activeProductLabel).trim();
        if (!nextScript) throw new Error('后端脚本生成接口未返回结果。');
        qualityResponses.push(response);
        outputs.push({
          id: `material-${Date.now()}-${i}`,
          title: `${activeVideoTheme.title} · ${audience.trim() || '默认买家'}（${modeScripts.filter(item => item.contentTheme === activeVideoTheme.id && item.buyerLabel === (audience.trim() || '默认买家')).length + i + 1}）`,
          script: nextScript,
          mode: 'material',
          contentTheme: activeVideoTheme.id,
          buyerLabel: audience.trim() || '默认买家',
          ...qualityFields(response),
        });
      }
      const sceneCount = outputs[0] ? parseStoryboardSlots(outputs[0].script, duration).length : finalSelected.length;
      const sceneMatchedResp = !hookOnly && pool.length ? pickMaterialClipsLocally(pool, duration, finalSelected, Math.max(1, sceneCount)) : { selectedIds: [], reason: '' };
      const recommendedIds = (sceneMatchedResp.selectedIds || []).filter(id => pool.some(item => item.id === id));
      setScriptRecommendedMaterialIds(hookOnly ? [hookMaterialId] : (recommendedIds.length ? recommendedIds : finalSelected));
      setLang(selectedScriptLanguage);
      setScriptType('storyboard');
      if (outputs[0]) {
        applyTimestampScript(outputs[0].script);
        setActiveVoiceLang(selectedScriptLanguage);
        setScriptView('timestamp');
        setActiveModeScriptId(outputs[0].id);
      }
      setModeScripts(current => [...current, ...outputs]);
      setProjectTitle(projectTitle === '未命名草稿' ? `素材库创作 · ${langZh(selectedScriptLanguage) || selectedScriptLanguage}口播脚本` : projectTitle);
      const defaultSuccessNotice = hookOnly
        ? `已仅根据钩子素材生成分镜规划；本步骤未补充其他素材，下一步将从第二个分镜开始匹配。`
        : coveredDuration + 0.1 < duration
          ? `当前素材有效动作约 ${coveredDuration.toFixed(1)} 秒，短于目标 ${duration} 秒；已按真实可用时长生成分镜，请补充素材后再完成成片。`
          : `已生成${langZh(selectedScriptLanguage) || selectedScriptLanguage}口播脚本，并按 ${Math.max(1, sceneCount)} 个分镜准备了 ${recommendedIds.length || finalSelected.length} 个素材候选，下一步可确认。`;
      setModeNotice(qualitySuccessNotice(qualityResponses[0] || { script: outputs[0]?.script || '' }, defaultSuccessNotice));
      autoGen.current = true;
      return true;
    } catch (err: any) {
      if (isCurrentRequest()) setModeNotice(err?.message || '素材库生成失败，请稍后重试。');
      return false;
    } finally {
      if (isCurrentRequest()) {
        setModeActionLoading(false);
        setModeActionStatus('');
      }
    }
  };

  const generateFromProductInfo = async () => {
    if (!selectedScriptLanguage) {
      setModeNotice('企业中心尚未配置首选输出语言或主要业务语言，请先完成企业中心语言配置。');
      return false;
    }
    if (productScriptAbortRef.current) {
      setModeNotice('产品脚本已在生成中，请等待当前任务完成；如需改参数，请先等待本轮结束。');
      return false;
    }
    const controller = new AbortController();
    productScriptAbortRef.current = controller;
    const requestId = ++scriptTaskRequestRef.current;
    const specEpoch = studioSpecEpochRef.current;
    const isCurrentRequest = () => scriptTaskRequestRef.current === requestId && studioSpecEpochRef.current === specEpoch;
    const hardTimeout = window.setTimeout(() => controller.abort(), 120_000);
    setModeActionLoading(true);
    setModeActionStatus('正在生成产品脚本，最长等待 120 秒…');
    setModeNotice('');
    try {
      const product = activeProductInfo.trim();
      if (!product) {
        setModeNotice('请先填写或选择产品信息，再生成产品素材。');
        return false;
      }
      const outputs: ModeScriptOutput[] = [];
      const qualityResponses: StudioScriptResult[] = [];
      const count = Math.max(1, Math.min(5, cloneCount));
      for (let i = 0; i < count; i += 1) {
        if (!isCurrentRequest()) return false;
        let nextScript = '';
        const response = await studioApi.script(
          {
            materials: selectedVisualClips.map(item => item.name),
            materialInfos: buildMaterialInfosForScript(selectedVisualClips, duration, hookMaterialId),
            productInfo: product,
            language: selectedScriptLanguage,
            platform,
            duration,
            scriptType: 'storyboard',
            generationMode: 'product',
            cooperationRoute,
            voiceoverMode: voiceoverMode === 'unselected' ? 'ai' : voiceoverMode,
            provider: 'qwen',
            audience,
            sellingPoints,
            tone: `${tone} · 产品方案 ${i + 1}`,
            videoTheme: videoThemePayload,
          },
          '',
          { signal: controller.signal },
        );
        if (!isCurrentRequest()) return false;
        announceRejectedStoryboard(response);
        const qualityFailure = scriptQualityFailure(response, 'AI脚本未通过检查，未返回可编辑结果。', true);
        if (qualityFailure) throw new Error(qualityFailure);
        nextScript = sanitizeStoryboardScript(response.script || '', product, activeProductLabel).trim();
        if (!nextScript) throw new Error('后端脚本生成接口未返回结果。');
        qualityResponses.push(response);
        outputs.push({
          id: `product-${Date.now()}-${i}`,
          title: `${activeVideoTheme.title} · ${audience.trim() || '默认买家'}（${modeScripts.filter(item => item.contentTheme === activeVideoTheme.id && item.buyerLabel === (audience.trim() || '默认买家')).length + i + 1}）`,
          script: nextScript,
          mode: 'product',
          contentTheme: activeVideoTheme.id,
          buyerLabel: audience.trim() || '默认买家',
          ...qualityFields(response),
        });
      }
      const firstScript = outputs[0]?.script || script;
      setLang(selectedScriptLanguage);
      setScriptType('storyboard');
      applyTimestampScript(firstScript);
      setActiveVoiceLang(selectedScriptLanguage);
      setScriptView('timestamp');
      if (outputs[0]) setActiveModeScriptId(outputs[0].id);
      setModeScripts(current => [...current, ...outputs]);
      setProjectTitle(projectTitle === '未命名草稿' ? '产品生成 · 内容创作' : projectTitle);
      setModeNotice(qualitySuccessNotice(
        qualityResponses[0] || { script: firstScript },
        '产品脚本已生成。确认脚本后，可继续选择配音和素材；不会自动生成视频。',
      ));
      autoGen.current = true;
      return true;
    } catch (err: any) {
      if (isCurrentRequest() && err?.name !== 'AbortError') setModeNotice(err?.message || '产品生成失败，请稍后重试。');
      return false;
    } finally {
      window.clearTimeout(hardTimeout);
      if (productScriptAbortRef.current === controller) productScriptAbortRef.current = null;
      if (isCurrentRequest()) {
        setModeActionLoading(false);
        setModeActionStatus('');
      }
    }
  };

  const applyTimestampScript = (value: string, productInfoOverride = activeProductInfo) => {
    const cleaned = normalizeScriptTimestamps(sanitizeStoryboardScript(value, productInfoOverride, activeProductLabel));
    const spoken = extractVoiceoverText(cleaned);
    const sourceLanguage = detectScriptLanguageCode(spoken);
    setScript(cleaned);
    setVoiceoverLines(spoken);
    setVoiceLangs(current => [sourceLanguage, ...current.filter(code => code !== sourceLanguage)]);
    setActiveVoiceLang(sourceLanguage);
    setLang(sourceLanguage);
    setVoiceDrafts(drafts => ({ ...drafts, [sourceLanguage]: spoken }));
    setVoiceDraftStaleLangs(current => [...new Set([
      ...current.filter(code => code !== sourceLanguage),
      ...voiceLangs.filter(code => code !== sourceLanguage),
    ])]);
    setVoiceoverStaleLangs(current => [...new Set([
      ...current,
      ...Object.entries(voiceoverAudios).filter(([, audio]) => Boolean(audio?.url)).map(([code]) => code),
    ])]);
    setTtsFailuresByLang({});
    setRenderOutputPath(null);
    setRenderOutputPreviewUrl(null);
    setLanguageRenderOutputs({});
    setLanguageRenderVersions({});
    setStoryboardVideoVersions({});
    setProductVideoVersions([]);
    setActiveVoiceLang(sourceLanguage);
    setLang(sourceLanguage);
    setScriptView('timestamp');
  };

  const openModeScript = (item: ModeScriptOutput) => {
    setActiveModeScriptId(item.id);
    applyTimestampScript(item.script);
  };

  useEffect(() => {
    if (activeModeScriptId || !modeScripts.length) return;
    const firstForMode = modeScripts.find(item => item.mode === mode);
    if (firstForMode) setActiveModeScriptId(firstForMode.id);
  }, [activeModeScriptId, mode, modeScripts]);

  const generateTimestampScriptsForMode = async () => {
    const validation = validateStudioScriptGenerationInput({
      mode,
      language: selectedScriptLanguage,
      productInfo: activeProductInfo,
      productLabel: activeProductLabel,
      selectedMaterialCount: selectedVisualClips.length,
      hasReferenceAnalysis: Boolean(videoKickoff?.referenceAnalysis?.details?.length),
      duration,
    });
    if (!validation.ok) {
      setModeNotice(`已停止生成：${validation.message}`);
      if (validation.code === 'product_required') setStepIdx(0);
      if (validation.code === 'material_required') setShowSetupMaterialPicker(true);
      return false;
    }
    if (mode === 'material') {
      return await generateFromMaterialLibrary();
    }
    if (mode === 'product') {
      return await generateFromProductInfo();
    }
    // Retain an explicit guard here as well as the shared validator so the
    // clone branch is statically narrowed before reading its reference data.
    if (!videoKickoff?.referenceAnalysis?.details?.length) {
      setModeNotice('已停止生成：当前草稿缺少真实对标逐镜分析，请返回灵感中心完成全片分析后再生成。');
      return false;
    }
    if (hasIncompleteReferenceAnalysis(videoKickoff)) {
      const analyzedUntil = referenceAnalysisEnd(videoKickoff);
      setModeNotice(`已停止生成：当前逐镜分析未达到时间线质量标准（至少每 5 秒 1 段、单段不超过 5.5 秒、无明显缺口/重叠，且不能含超时片段；当前覆盖到 ${analyzedUntil.toFixed(1)} 秒）。请返回灵感中心完成全片精确分析后再生成脚本。`);
      return false;
    }
    const cloneProductInfo = activeProductInfo.trim()
      || videoKickoff?.productInfo?.trim()
      || script.trim()
      || '当前爆款复刻脚本';
    const cloneProductLabel = activeProductLabel || selectedProductLabel(cloneProductInfo);
    if (mode === 'clone' && !activeProductInfo.trim()) {
      setModeNotice('已停止生成：未读取到企业中心产品信息。请先在第一步选择产品，再生成真实复刻脚本。');
      return false;
    }
    const requestId = ++scriptTaskRequestRef.current;
    const specEpoch = studioSpecEpochRef.current;
    const isCurrentRequest = () => scriptTaskRequestRef.current === requestId && studioSpecEpochRef.current === specEpoch;
    setModeActionLoading(true);
    if (activeProductInfo.trim()) setModeNotice('');
    setModeActionStatus(mode === 'clone' ? '真实生成中…' : '');
    try {
      const cloneReference = videoKickoff;
      const targetCodes = cloneOutputMode === 'languages'
        ? enterpriseVoiceLangs.slice(0, Math.max(1, cloneCount))
        : Array.from({ length: cloneCount }, () => selectedScriptLanguage);
      const outputs: ModeScriptOutput[] = [];
      const qualityResponses: StudioScriptResult[] = [];
      for (let index = 0; index < targetCodes.length; index += 1) {
        if (!isCurrentRequest()) return false;
        const code = targetCodes[index] || 'zh';
        const existingCloneScripts = [
          ...modeScripts.filter(item => item.mode === 'clone').map(item => item.script),
          ...outputs.map(item => item.script),
        ];
        const existingCloneCount = modeScripts.filter(item => item.mode === 'clone').length;
        const variantSeed = existingCloneCount + index;
        setModeActionStatus(`真实生成中 ${index + 1}/${targetCodes.length}，通常 20-90 秒，高峰期最多等待 300 秒…`);
        let generatedScript = '';
        const response = await withTimeout(studioApi.script(
            {
              materials: [
                ...(cloneReference.video?.platform ? [`平台：${cloneReference.video.platform}`] : []),
                ...selectedVisualClips.map(item => `已选素材：${item.name}`),
              ],
              materialInfos: buildMaterialInfosForScript(selectedVisualClips, duration, hookMaterialId),
              productInfo: cloneProductInfo,
              language: code,
              platform,
              duration,
              scriptType: 'storyboard',
              generationMode: 'clone',
              cooperationRoute,
              provider,
              audience,
              sellingPoints,
              tone: `${tone} · 迁移方式：${migrationMode === 'fidelity' ? '高保真复刻' : migrationMode === 'structure' ? '结构迁移' : '机制借鉴'} · 第 ${variantSeed + 1} 版 · 保留原片 hook、证明顺序、切镜节奏和音画形态 · ${migrationMode === 'fidelity' ? '仅替换竞品事实' : '按所选产品重建场景、动作和证明内容'} · ${voiceoverMode === 'none' ? '原片无口播时保持台词为无，不新增口播' : '仅可在原片已有口播位重建短台词，不得增加新的口播镜头'} · 禁止新增原片不存在的字幕或 CTA`,
              voiceoverMode: voiceoverMode === 'unselected' ? 'ai' : voiceoverMode,
              videoTheme: videoThemePayload,
              referenceTitle: cloneReference.video?.title || '',
              referenceAnalysis: cloneReferenceAnalysisText(cloneReference),
              referenceHighlights: cloneReferenceHighlights(cloneReference),
              existingScripts: existingCloneScripts,
              variantSeed,
            },
            '',
        ), 300_000, '后端模型生成超过 300 秒，请稍后重试。');
        if (!isCurrentRequest()) return false;
        announceRejectedStoryboard(response);
        const qualityFailure = scriptQualityFailure(response, 'AI脚本未通过检查，未返回可编辑结果。', true);
        if (qualityFailure) throw new Error(qualityFailure);
        const normalized = ensureDistinctCloneStoryboard({
          script: response.script || '',
          kickoff: cloneReference,
          productInfo: cloneProductInfo,
          languageCode: code,
          strictProductName: cloneProductLabel,
          existingScripts: existingCloneScripts,
          variantSeed,
          migrationMode,
        });
        if (normalized.normalized) throw new Error('模型返回脚本未满足标准分镜字段或与已有脚本过于相似，未生成兜底稿。');
        generatedScript = normalized.script;
        if (!generatedScript) {
          throw new Error('模型没有返回可用脚本。');
        }
        qualityResponses.push(response);
        outputs.push({
          id: `clone-${Date.now()}-${index}`,
          title: `爆款复刻时间戳脚本 ${existingCloneCount + index + 1}`,
          script: generatedScript,
          mode: 'clone',
          ...qualityFields(response),
        });
      }
      const firstNewScript = outputs[0];
      setModeScripts(prev => [...prev, ...outputs]);
      if (firstNewScript) {
        setActiveModeScriptId(firstNewScript.id);
        applyTimestampScript(firstNewScript.script);
      }
      setModeNotice(qualitySuccessNotice(
        qualityResponses[0] || { script: firstNewScript?.script || '' },
        '已真实调用后端，按爆款结构和产品卖点生成标准分镜脚本。',
      ));
      autoGen.current = true;
      return true;
    } catch (err: any) {
      if (isCurrentRequest()) setModeNotice(err?.message || 'AI 复刻生成失败，请稍后重试。');
      return false;
    } finally {
      if (isCurrentRequest()) {
        setModeActionLoading(false);
        setModeActionStatus('');
      }
    }
  };

  useEffect(() => {
    if (!pendingRealCloneGeneration || mode !== 'clone' || !videoKickoff || modeActionLoading) return;
    if (!activeProductInfo.trim() || !activeProductLabel) return;
    setPendingRealCloneGeneration(false);
    void generateTimestampScriptsForMode();
  }, [activeProductInfo, activeProductLabel, mode, modeActionLoading, pendingRealCloneGeneration, videoKickoff]);

  const optimizeCurrentTimestampScript = async () => {
    const currentScript = script.trim();
    if (!currentScript || modeActionLoading) return;
    if (mode === 'clone' && !videoKickoff) {
      setModeNotice('已停止生成：当前草稿没有真实对标逐镜分析。请返回灵感中心完成全片精确分析后再优化脚本。');
      return;
    }
    const requestId = ++scriptTaskRequestRef.current;
    const specEpoch = studioSpecEpochRef.current;
    const isCurrentRequest = () => scriptTaskRequestRef.current === requestId && studioSpecEpochRef.current === specEpoch;
    setModeActionLoading(true);
    setModeNotice('');
    try {
      const response = await studioApi.script(
        {
          materials: matNames,
          productInfo: activeProductInfo,
          language: selectedScriptLanguage,
          platform,
          duration,
          scriptType: 'storyboard',
          generationMode: mode,
          cooperationRoute,
          provider,
          audience,
          sellingPoints,
          tone: [
            tone,
            mode === 'clone' ? '基于当前脚本重新思考，生成一版更自然的新标准分镜脚本' : '优化当前时间戳脚本',
            '保留原有时间段结构',
            mode === 'clone' ? '每段必须包含环境/景别/运镜/画面/配乐/台词/字幕' : '每段必须包含时间/画面/人物说/字幕',
            mode === 'clone' ? '台词必须是真人能直接说出口的买家痛点、需求洞察、证明点或CTA' : '人物说必须是真人能直接说出口的话',
            '不得加入镜头、画面、字幕、参考节奏等制作指令到台词或人物说',
            '不得编造未提供的数据',
          ].filter(Boolean).join(' · '),
          videoTheme: videoThemePayload,
          referenceTitle: mode === 'clone' ? videoKickoff?.video?.title || '' : '',
          referenceAnalysis: mode === 'clone' && videoKickoff ? cloneReferenceAnalysisText(videoKickoff) : '',
          referenceHighlights: mode === 'clone' && videoKickoff ? cloneReferenceHighlights(videoKickoff) : [],
        },
        currentScript,
      );
      if (!isCurrentRequest()) return;
      announceRejectedStoryboard(response);
      const qualityFailure = scriptQualityFailure(response, 'AI脚本未通过检查，未返回可编辑结果。');
      if (qualityFailure) throw new Error(qualityFailure);
      const optimized = response.script || '';
      const cloneOptimized = mode === 'clone'
        ? ensureDistinctCloneStoryboard({
          script: optimized,
          kickoff: videoKickoff || { referenceAnalysis: { details: [] } },
          productInfo: activeProductInfo,
          languageCode: 'zh',
          strictProductName: activeProductLabel,
          existingScripts: modeScripts.filter(item => item.mode === 'clone' && item.id !== activeModeScriptId).map(item => item.script),
          variantSeed: modeScripts.filter(item => item.mode === 'clone').findIndex(item => item.id === activeModeScriptId) + 1,
          migrationMode,
        })
        : null;
      if (cloneOptimized?.normalized) throw new Error('模型返回脚本未满足标准分镜字段或与已有脚本过于相似，未生成兜底稿。');
      const sanitizedOptimized = cloneOptimized
        ? cloneOptimized.script
        : sanitizeStoryboardScript(optimized, activeProductInfo, activeProductLabel);
      if (!sanitizedOptimized.trim()) throw new Error('模型没有返回可用脚本。');
      applyTimestampScript(sanitizedOptimized);
      setModeNotice(qualitySuccessNotice(response, mode === 'clone'
        ? '已按当前产品信息和标准分镜字段优化脚本。'
        : '已按当前产品信息和口播约束优化脚本。'));
      if (modeScripts[0]) setActiveModeScriptId(modeScripts[0].id);
      setModeScripts(prev => prev.map((item, index) => index === 0 ? { ...item, script: sanitizedOptimized, title: `${item.title}（已优化）`, ...qualityFields(response) } : item));
    } catch (err: any) {
      if (isCurrentRequest()) setModeNotice(err?.message || '脚本优化失败，请稍后重试。');
    } finally {
      if (isCurrentRequest()) setModeActionLoading(false);
    }
  };

  function extractVoiceoverText(value: string) {
    return formatVoiceoverWithTimestamps(value);
  }

  const cancelVoiceDraftGeneration = () => {
    const controller = voiceDraftAbortRef.current;
    if (!controller) return;
    controller.abort();
    setVoiceDraftFailedLangs(current => [...new Set([...current, ...voiceDraftPendingLangs])]);
    setVoiceDraftStaleLangs(current => [...new Set([
      ...current,
      ...voiceDraftPendingLangs.filter(code => !voiceDrafts[code]?.trim() || current.includes(code)),
    ])]);
    setVoiceDraftPendingLangs([]);
    setVoiceDraftLoading(false);
    setVoiceDraftNotice('已取消翻译；已完成的语种已保留，未完成语种可重新翻译。');
  };

  const generateVoiceDrafts = async () => {
    voiceDraftAbortRef.current?.abort();
    const controller = new AbortController();
    voiceDraftAbortRef.current = controller;
    const isCurrentRequest = () => voiceDraftAbortRef.current === controller;
    const sourceText = scriptView === 'voiceover' ? (voiceoverLines || script) : script;
    const base = extractVoiceoverText(sourceText);
    const requestDraftSnapshot = { ...voiceDrafts };
    const initiallyStale = new Set(voiceDraftStaleLangs);
    let requestTargets: string[] = [];
    setVoiceoverLines(base);
    setVoiceDraftLoading(true);
    setVoiceDraftPendingLangs([]);
    setVoiceDraftNotice(`正在提取口播，并生成 ${voiceLangs.length || 1} 个语种文案...`);
    try {
      if (!base.trim()) {
        setVoiceDraftNotice('当前脚本里没有可提取的口播台词，请先生成时间戳脚本或手动填写口播台词。');
        return;
      }
      const sourceLanguage = detectScriptLanguageCode(base);
      const langs = [sourceLanguage, ...voiceLangs.filter(code => code !== sourceLanguage)];
      setVoiceLangs(langs);
      const normalizedBase = normalizeScriptTimestamps(base);
      setVoiceDrafts(current => ({ ...current, [sourceLanguage]: normalizedBase }));
      setVoiceDraftFailedLangs(current => current.filter(code => code !== sourceLanguage));
      setVoiceDraftStaleLangs(current => current.filter(code => code !== sourceLanguage));
      setVoiceDraftDegradedLangs(current => current.filter(code => code !== sourceLanguage));
      setActiveVoiceLang(sourceLanguage);
      setLang(sourceLanguage);
      setScriptView('voiceover');

      requestTargets = voiceDraftLanguagesNeedingTranslation(
        langs,
        sourceLanguage,
        requestDraftSnapshot,
        voiceDraftStaleLangs,
        voiceDraftFailedLangs,
      );
      const changedDraftCodes = [
        ...(String(requestDraftSnapshot[sourceLanguage] || '') !== normalizedBase ? [sourceLanguage] : []),
        ...requestTargets,
      ];
      const existingAudioCodes = changedDraftCodes.filter(code => Boolean(voiceoverAudios[code]?.url));
      if (existingAudioCodes.length) setVoiceoverStaleLangs(current => [...new Set([...current, ...existingAudioCodes])]);
      setVoiceDraftFailedLangs(current => current.filter(code => !requestTargets.includes(code)));
      setVoiceDraftPendingLangs(requestTargets);
      setVoiceDraftNotice(requestTargets.length
        ? `已识别${langZh(sourceLanguage) || sourceLanguage}口播，正在生成缺失或待同步的 ${requestTargets.length} 个语种；已完成和手工文案不会被覆盖。`
        : '所选语种文案已齐全，未重新覆盖已完成或手工编辑的文案。');
      const failedLangs = new Set<string>();
      const degradedLangs = new Set<string>();
      const failureReasons = new Map<string, string>();
      let translateError = '';
      const commitTranslation = (code: string, normalized: string, source?: string) => {
        setVoiceDrafts(current => mergeGeneratedVoiceDraft(current, requestDraftSnapshot, code, normalized));
        setVoiceDraftFailedLangs(current => current.filter(item => item !== code));
        setVoiceDraftStaleLangs(current => current.filter(item => item !== code));
        setVoiceDraftDegradedLangs(current => source === 'deterministic'
          ? [...new Set([...current, code])]
          : current.filter(item => item !== code));
        if (source === 'deterministic') degradedLangs.add(code);
      };
      if (requestTargets.length) {
        const translated = await runVoiceTranslationWithTimeout(
          signal => studioApi.translateBatch(
            { text: normalizedBase, targets: requestTargets, source: sourceLanguage },
            { signal },
          ),
          controller.signal,
          VOICE_TRANSLATION_BATCH_TIMEOUT_MS,
        ).catch((err: any) => ({ ok: false, translations: {} as Record<string, string>, translationSources: {} as Record<string, 'ai' | 'deterministic'>, error: err?.message || '请求失败' }));
        if (controller.signal.aborted) throw new DOMException('翻译已取消', 'AbortError');
        translateError = translated.error || '';
        const unresolved: string[] = [];
        for (const code of requestTargets) {
          const raw = translated.translations?.[code] || '';
          const normalized = raw.trim()
            ? resolveTranslatedVoiceover(base, raw, code)
            : '';
          if (normalized.trim()) {
            commitTranslation(code, normalized, translated.translationSources?.[code]);
          } else {
            unresolved.push(code);
          }
        }
        setVoiceDraftPendingLangs(unresolved);
        if (unresolved.length) {
          setVoiceDraftNotice(`批量翻译已返回 ${requestTargets.length - unresolved.length}/${requestTargets.length} 个语种，正在并行重试其余 ${unresolved.length} 个...`);
          await Promise.all(unresolved.map(async code => {
            let normalized = '';
            let resultSource = '';
            let failureReason = translateError || '模型未返回有效译文';
            try {
              const single = await runVoiceTranslationWithTimeout(
                signal => studioApi.translate(
                  { text: normalizeScriptTimestamps(base), target: code, source: sourceLanguage },
                  { signal },
                ),
                controller.signal,
                VOICE_TRANSLATION_SINGLE_TIMEOUT_MS,
              );
              const raw = single.ok ? single.text : '';
              normalized = raw.trim() ? resolveTranslatedVoiceover(base, raw, code) : '';
              resultSource = single.source || '';
              failureReason = single.error || failureReason;
            } catch (err: any) {
              failureReason = err?.message || failureReason;
            }
            if (controller.signal.aborted || !isCurrentRequest()) return;
            if (normalized.trim()) {
              commitTranslation(code, normalized, resultSource);
            } else {
              failedLangs.add(code);
              failureReasons.set(code, failureReason);
              setVoiceDraftFailedLangs(current => [...new Set([...current, code])]);
            }
            setVoiceDraftPendingLangs(current => current.filter(item => item !== code));
          }));
        }
      }
      if (controller.signal.aborted) throw new DOMException('翻译已取消', 'AbortError');
      if (!isCurrentRequest()) return;
      const failed = [...failedLangs];
      const firstFailureReason = failed.map(code => failureReasons.get(code)).find(Boolean) || translateError;
      setVoiceDraftPendingLangs([]);
      setVoiceDraftFailedLangs(current => [...new Set([...current.filter(code => !requestTargets.includes(code)), ...failed])]);
      setVoiceDraftStaleLangs(current => [...new Set([
        ...current.filter(code => !requestTargets.includes(code)),
        ...failed.filter(code => initiallyStale.has(code) || !requestDraftSnapshot[code]?.trim()),
      ])]);
      const degraded = [...degradedLangs];
      setVoiceDraftNotice(failed.length
        ? `已保留成功文案；${failed.map(code => LANGS.find(item => item.code === code)?.label || code).join('、')} 仍缺失：${firstFailureReason || '模型未返回有效译文'}。可重试当前语言或直接手工填写。`
        : degraded.length
          ? `${degraded.map(code => LANGS.find(item => item.code === code)?.label || code).join('、')} 已使用经审核的房地产保时轴本地兜底，可继续编辑或进入配音。`
          : requestTargets.length ? '' : '所选语种文案已齐全。');
    } catch (err: any) {
      if (isCurrentRequest()) {
        setVoiceDraftPendingLangs([]);
        setVoiceDraftFailedLangs(current => [...new Set([...current, ...requestTargets])]);
        setVoiceDraftStaleLangs(current => [...new Set([
          ...current,
          ...requestTargets.filter(code => initiallyStale.has(code) || !requestDraftSnapshot[code]?.trim()),
        ])]);
        setVoiceDraftNotice(controller.signal.aborted
          ? '已取消翻译；已完成的语种已保留，未完成语种可重新翻译。'
          : (err?.message || '多语种字幕生成失败，请稍后重试。'));
      }
    } finally {
      if (isCurrentRequest()) {
        voiceDraftAbortRef.current = null;
        setVoiceDraftLoading(false);
      }
    }
  };

  const retryVoiceDraft = async (code: string) => {
    const specEpoch = studioSpecEpochRef.current;
    const isCurrentSpec = () => studioSpecEpochRef.current === specEpoch;
    const requestDraftSnapshot = { ...voiceDrafts };
    const sourceText = scriptView === 'voiceover' ? (voiceoverLines || script) : script;
    const base = extractVoiceoverText(sourceText);
    if (!base.trim()) {
      setVoiceDraftNotice('当前脚本没有可翻译的口播文案。');
      return;
    }
    const sourceLanguage = detectScriptLanguageCode(base);
    if (voiceoverAudios[code]?.url) setVoiceoverStaleLangs(current => [...new Set([...current, code])]);
    setVoiceDraftPendingLangs(current => [...new Set([...current, code])]);
    setVoiceDraftFailedLangs(current => current.filter(item => item !== code));
    try {
      const result = code === sourceLanguage
        ? { ok: true, source: 'source' as const, text: normalizeScriptTimestamps(base), error: undefined }
        : await studioApi.translate({ text: normalizeScriptTimestamps(base), target: code, source: sourceLanguage });
      if (!result.ok || !result.text.trim()) throw new Error(result.error || '模型未返回有效译文');
      const normalized = code === sourceLanguage
        ? result.text
        : resolveTranslatedVoiceover(base, result.text, code);
      if (!isCurrentSpec()) return;
      if (!normalized.trim()) throw new Error('模型未返回有效译文');
      setVoiceDrafts(current => mergeGeneratedVoiceDraft(current, requestDraftSnapshot, code, normalized));
      setVoiceDraftStaleLangs(current => current.filter(item => item !== code));
      setVoiceDraftDegradedLangs(current => result.source === 'deterministic'
        ? [...new Set([...current, code])]
        : current.filter(item => item !== code));
      setVoiceDraftNotice(result.source === 'deterministic'
        ? `${LANGS.find(item => item.code === code)?.label || code}已使用经审核的房地产保时轴本地兜底，可继续编辑或进入配音。`
        : `${LANGS.find(item => item.code === code)?.label || code}文案已更新，其他已完成语言保持不变。`);
    } catch (error: unknown) {
      if (!isCurrentSpec()) return;
      const reason = error instanceof Error ? error.message : '翻译失败';
      setVoiceDraftFailedLangs(current => [...new Set([...current, code])]);
      setVoiceDraftNotice(`${LANGS.find(item => item.code === code)?.label || code}翻译失败：${reason}`);
    } finally {
      if (isCurrentSpec()) setVoiceDraftPendingLangs(current => current.filter(item => item !== code));
    }
  };

  // 脚本生成入口集中在「口播脚本」页按钮，避免进入步骤时自动覆盖用户已编辑内容。

  const switchScriptType = (type: 'voiceover' | 'storyboard') => {
    if (type === scriptType) return;
    setScriptType(type);
    void regenScript(type);
  };


  const regenCovers = async () => {
    setCoverLoading(true);
    try {
      const { covers } = await studioApi.covers({ script, productInfo: activeProductInfo, language: lang, provider, tone }, [coverTitle]);
      if (covers[0]) setCoverTitle(covers[0]);
    } catch (err: any) {
      alert(err?.message || '封面标题生成失败，请稍后重试。');
    } finally {
      setCoverLoading(false);
    }
  };

  const openCanvaCoverEditor = async () => {
    setCoverCanvaOpening(true);
    // 必须在用户点击的同步调用栈中创建窗口，否则生成封面/写剪贴板的 await
    // 会丢失浏览器 user gesture，导致可画窗口被弹窗拦截器吞掉。
    const popup = window.open(CANVA_VIDEO_COVER_URL, 'lingshu-canva-cover');
    const openCanva = () => {
      if (!popup || popup.closed) {
        window.location.assign(CANVA_VIDEO_COVER_URL);
        return;
      }
      popup.focus();
    };
    try {
      let nextCoverUrl = coverUrl;
      const canGenerateCoverSvg = Boolean(coverFrameUrl && (capturedCoverFrameUrl || coverClip?.poster || coverClip?.type === 'image'));
      if (!nextCoverUrl && canGenerateCoverSvg) {
        const cv = await studioApi.cover({ title: coverTitle, ratio, accent: TRAFFIC_GREEN, bgImageUrl: coverFrameUrl, ...coverStyle });
        if (cv.url) {
          nextCoverUrl = cv.url;
          setCoverUrl(cv.url);
        }
      }
      rememberCanvaCoverReturn(nextCoverUrl);
      const fullCoverUrl = nextCoverUrl ? `${window.location.origin}${nextCoverUrl}` : '';
      await navigator.clipboard?.writeText?.([
        `封面标题：${coverTitle}`,
        fullCoverUrl ? `封面参考图：${fullCoverUrl}` : '',
      ].filter(Boolean).join('\n'));
      openCanva();
    } catch (err: any) {
      rememberCanvaCoverReturn(coverUrl);
      openCanva();
      if (err?.message) console.warn('Open Canva cover editor failed:', err.message);
    } finally {
      setCoverCanvaOpening(false);
    }
  };

  const importCanvaCover = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('请从可画导出 PNG、JPG 或 WebP 图片后再导回。');
      return;
    }
    setCoverCanvaOpening(true);
    try {
      const [dataBase64, media] = await Promise.all([fileToDataUrl(file), probeMedia(file)]);
      const { material } = await studioApi.uploadMaterial({
        name: file.name,
        folder: 'upload',
        type: 'image',
        width: media.width,
        height: media.height,
        dataBase64,
        mimeType: file.type,
      });
      if (!material?.id || !material.url) throw new Error('封面上传失败');
      setMaterials(current => [materialToClip(material), ...current.filter(item => item.id !== material.id)]);
      setCover(material.id);
      setCoverUrl(material.url);
    } catch (err: any) {
      alert(err?.message || '可画封面导回失败，请稍后重试。');
    } finally {
      setCoverCanvaOpening(false);
      if (canvaReturnInputRef.current) canvaReturnInputRef.current.value = '';
    }
  };

  // 封面标题中文翻译（非中文目标语言时，进入封面步后自动翻译，给用户确认）
  useEffect(() => {
    if (step !== 'cover' || lang === 'zh' || !coverTitle.trim()) { setCoverTitleZh(''); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await studioApi.translate({ text: coverTitle, target: 'zh' });
      if (!cancelled && r.ok && r.text) setCoverTitleZh(r.text);
    }, 450);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverTitle, lang, step]);

  // 官方导入字体模版（.ttf/.otf/.woff/.woff2）：注册为可用字体
  const importFont = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      const family = `custom-${f.name.replace(/\.[^.]+$/, '').replace(/\W+/g, '-')}-${Date.now()}`;
      const face = new FontFace(family, buf);
      await face.load();
      (document.fonts as FontFaceSet).add(face);
      setCustomFonts(list => [...list, { family, label: f.name.replace(/\.[^.]+$/, '') }]);
      setCoverStyle(s => ({ ...s, fontFamily: family }));
    } catch { /* 字体加载失败忽略 */ }
  };

  // 双语字幕：进入预览且开启双语时，翻译各 cue（目标语言为中文则无需翻译）
  useEffect(() => {
    if (step !== 'preview' || !subtitlesOn || subMode !== 'bilingual' || lang === 'zh' || cues.length === 0) {
      setCueZh([]); return;
    }
    let cancelled = false;
    (async () => {
      const zh = await Promise.all(cues.map(c => studioApi.translate({ text: c.text, target: 'zh' }).then(r => (r.ok ? r.text : ''))));
      if (!cancelled) setCueZh(zh);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, subtitlesOn, subMode, lang, cues]);

  // cue 数量变化时，把预览高亮夹回有效范围
  useEffect(() => { if (subPreviewIdx >= cues.length) setSubPreviewIdx(0); }, [cues.length, subPreviewIdx]);

  // 成片预览：开始 / 结束顺序播放
  const clearPreviewAdvanceTimer = () => {
    if (previewAdvanceTimerRef.current !== null) {
      window.clearTimeout(previewAdvanceTimerRef.current);
      previewAdvanceTimerRef.current = null;
    }
  };
  const startPreview = () => {
    if (rendering) return;
    if (previewTimeline.length === 0) { setPreviewNote(true); return; }
    setPreviewNote(false);
    setPreviewTime(0);
    setPreviewIdx(0);
  };
  const previewLanguageVersion = (code: string, autoPlay = true) => {
    const audio = voiceoverMode === 'ai' ? voiceoverAudios[code] : { url: voiceoverUrl || '', duration: voiceoverDur };
    setActiveVoiceLang(code);
    setLang(code);
    if (voiceoverMode === 'ai') {
      setVoiceoverUrl(audio?.url || null);
      setVoiceoverDur(audio?.duration || 0);
    } else if (audio?.url) {
      setVoiceoverMode(voiceoverMode === 'none' ? 'ai' : voiceoverMode);
      setVoiceoverUrl(audio.url);
      setVoiceoverDur(audio.duration || 0);
    }
    setSubPreviewIdx(0);
    setRenderDownloadMessage('');
    if (!autoPlay) return;
    if (previewTimeline.length === 0) {
      setPreviewNote(true);
      return;
    }
    setPreviewNote(false);
    setPreviewTime(0);
    setPreviewIdx(0);
  };
  const stopPreview = () => {
    clearPreviewAdvanceTimer();
    previewAdvanceLockRef.current = false;
    setPreviewIdx(null);
    setPreviewTime(0);
    [previewBgmAudioRef.current, previewVoiceAudioRef.current].forEach(el => {
      if (!el) return;
      el.pause();
      el.currentTime = 0;
    });
  };
  const handlePreviewClipEnded = () => {
    if (previewAdvanceLockRef.current) return;
    previewAdvanceLockRef.current = true;
    clearPreviewAdvanceTimer();
    setPreviewIdx(i => {
      if (i !== null && i + 1 < previewTimeline.length) return i + 1;
      [previewBgmAudioRef.current, previewVoiceAudioRef.current].forEach(el => {
        if (!el) return;
        el.pause();
        el.currentTime = 0;
      });
      return null;
    });
  };
  const pausePreviewAudio = () => {
    [previewBgmAudioRef.current, previewVoiceAudioRef.current].forEach(el => el?.pause());
  };
  const resumePreviewAudio = () => {
    if (!previewPlaying) return;
    [previewBgmAudioRef.current, previewVoiceAudioRef.current].forEach(el => {
      if (el && el.src && el.volume > 0) void el.play().catch(() => {});
    });
  };
  const previewPlaying = previewIdx !== null;
  useEffect(() => {
    previewAdvanceLockRef.current = false;
    setPreviewVideoReady(false);
  }, [previewIdx]);
  const jumpToPreviewClip = (index: number) => {
    if (!previewTimeline[index]) return;
    const offset = previewOffsetByIndex[index] || 0;
    setPreviewNote(false);
    setPreviewTime(offset);
    setPreviewIdx(index);
    [previewBgmAudioRef.current, previewVoiceAudioRef.current].forEach(el => {
      if (!el?.src) return;
      try { el.currentTime = offset; } catch { /* ignore seek edge cases */ }
      if (el.volume > 0) void el.play().catch(() => {});
    });
  };
  useEffect(() => {
    clearPreviewAdvanceTimer();
    if (previewIdx === null) return;
    const item = previewTimeline[previewIdx];
    if (!item) {
      setPreviewIdx(null);
      return;
    }
    const durationMs = Math.max(0.5, item.targetDuration || ((item.trimEnd || 0) - (item.trimStart || 0)) || 3) * 1000;
    setPreviewTime(previewOffsetByIndex[previewIdx] || 0);
    if (item.clip.type === 'image') {
      previewAdvanceTimerRef.current = window.setTimeout(handlePreviewClipEnded, durationMs);
      return () => clearPreviewAdvanceTimer();
    }
    // Remote ranged media does not always emit `ended` or a final
    // `timeupdate`. Advance by the storyboard duration as a deterministic
    // fallback so the preview cannot stall on a single shot.
    previewAdvanceTimerRef.current = window.setTimeout(handlePreviewClipEnded, durationMs + 250);
    const video = previewVideoRef.current;
    if (video) {
      video.playbackRate = Math.max(0.25, Math.min(item.speed || 1, 4));
      const seekTo = Math.max(0, item.trimStart || 0);
      const applySeek = () => {
        try {
          if (Number.isFinite(video.duration) && video.duration > seekTo) video.currentTime = seekTo;
          else video.currentTime = seekTo;
        } catch { /* ignore browser seek edge cases */ }
        void video.play().catch(() => {});
      };
      if (video.readyState >= 1) applySeek();
      else video.onloadedmetadata = applySeek;
    }
    return () => clearPreviewAdvanceTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewIdx, previewOffsetByIndex, previewTimeline]);
  const updatePreviewClock = () => {
    if (previewIdx === null) return;
    const item = previewTimeline[previewIdx];
    if (!item) return;
    const base = previewOffsetByIndex[previewIdx] || 0;
    if (item.type === 'image') {
      setPreviewTime(base);
      return;
    }
    const video = previewVideoRef.current;
    const trimStart = item.trimStart || 0;
    const speed = Math.max(0.25, Math.min(item.speed || 1, 4));
    const local = video ? Math.max(0, (video.currentTime || trimStart) - trimStart) / speed : 0;
    setPreviewTime(base + local);
    const targetDuration = Math.max(0.5, item.targetDuration || ((item.trimEnd || 0) - trimStart) || 3);
    if (local >= targetDuration - 0.04) handlePreviewClipEnded();
  };
  useEffect(() => {
    const bgmEl = previewBgmAudioRef.current;
    const voiceEl = previewVoiceAudioRef.current;
    const bgmUrl = selectedBgmTrack?.url || '';
    const currentVoiceUrl = previewVoiceOn ? activeVoiceoverUrl : '';
    const bgmGain = previewBgmOn ? Math.max(0, Math.min(1, (bgmVol || 0) / 100)) * (currentVoiceUrl ? 0.5 : 1) : 0;
    const voiceGain = previewVoiceOn ? Math.max(0, Math.min(1, (voiceVol || 0) / 100)) : 0;

    if (bgmEl) {
      bgmEl.volume = bgmUrl ? bgmGain : 0;
      bgmEl.loop = true;
    }
    if (voiceEl) {
      voiceEl.volume = currentVoiceUrl ? voiceGain : 0;
    }
    if (!previewPlaying) return;

    if (bgmEl && bgmUrl && bgmGain > 0) {
      if (bgmEl.src !== new URL(bgmUrl, window.location.href).href) bgmEl.src = bgmUrl;
      bgmEl.currentTime = Math.max(0, previewTime);
      void bgmEl.play().catch(() => {});
    }
    if (voiceEl && currentVoiceUrl && voiceGain > 0) {
      if (voiceEl.src !== new URL(currentVoiceUrl, window.location.href).href) voiceEl.src = currentVoiceUrl;
      voiceEl.currentTime = Math.max(0, previewTime);
      void voiceEl.play().catch(() => {});
    }
  }, [activeVoiceoverUrl, bgmVol, previewBgmOn, previewPlaying, previewVoiceOn, selectedBgmTrack, voiceVol]);
  // 离开预览步时停止播放
  useEffect(() => {
    if (step !== 'preview' && step !== 'bgm') {
      stopPreview();
      setPreviewNote(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // 导出 / 我的作品
  const openRenderOutputFolder = async (filePath = renderOutputPath) => {
    if (!filePath) return false;
    const desktop = getDesktopRender();
    if (desktop?.showItemInFolder) {
      const result = await desktop.showItemInFolder(filePath);
      if (result?.ok) return true;
    }
    const opened = await studioApi.openRenderOutput(filePath);
    if (!opened.ok) {
      const message = opened.error || '打开本地文件夹失败，请手动前往保存路径查看。';
      setRenderDownloadMessage(message);
      if (/不存在|重新导出|not found|404/i.test(message)) setRenderOutputPath(null);
      return false;
    }
    return true;
  };

  const downloadMp4 = async () => {
    if (rendering) return;
    if (renderOutputPath) {
      const opened = await openRenderOutputFolder(renderOutputPath);
      if (opened) setRenderDownloadMessage(`成片已保存到本地：${renderOutputPath}`);
      return;
    }
    setRenderDownloadMessage('');
    try {
      const outputPath = await goPreview();
      setRenderDownloadMessage(outputPath
        ? `成片已保存到本地：${outputPath}`
        : '本地导出未返回文件路径，请确认后端服务和 ffmpeg 可用后重试。');
    } catch (err: any) {
      setRenderDownloadMessage(err?.message || '成片下载失败，请稍后重试。');
    }
  };
  const saveToWorks = async () => {
    await saveProject('published'); // status=published → 进入「我的作品」
    setSavedToWorks(true);
    setTimeout(() => setSavedToWorks(false), 2200);
  };

  const buildPublishVersions = (): StudioPublishItem[] => {
    const publishPlatform = platform as StudioPublishPlatform;
    const baseTitle = projectTitle.trim() || coverTitle || 'AI 快剪成片';
    const seenPaths = new Set<string>();

    return buildRenderableVideoVersions().map(({ plan, planIndex, code, languageIndex, bgmId, key, inputSignature }) => {
      const latestDone = (languageRenderVersions[key] || []).find(item => item.status === 'done' && item.path && item.inputSignature === inputSignature);
      const storedOutput = languageRenderOutputs[key];
      const output = storedOutput?.inputSignature === inputSignature ? storedOutput : undefined;
      const path = (output?.status === 'done' ? output.path : '')
        || latestDone?.path
        || (key === activeRenderCombinationKey ? renderOutputPath : '');
      const videoPath = String(path || '').trim();
      if (!videoPath) return null;
      if (videoPath && seenPaths.has(videoPath)) return null;
      if (videoPath) seenPaths.add(videoPath);
      const versionName = `${plan.name || `视频${planIndex + 1}`} * ${langZh(code) || `语种${languageIndex + 1}`}`;
      return {
        videoPath,
        previewUrl: output?.previewUrl || latestDone?.previewUrl || (key === activeRenderCombinationKey ? renderOutputPreviewUrl || undefined : undefined),
        title: `${baseTitle} - ${versionName}`,
        description: caption.trim() || voiceDrafts[code] || activeSpokenScript,
        ratio,
        sourceProjectId: projectId || undefined,
        platform: publishPlatform,
        workflowRunId: projectWorkflowContext?.runId,
        workflowTaskId: projectWorkflowContext?.taskId,
        workflowTaskKey: projectWorkflowContext?.taskKey,
      };
    }).filter(Boolean) as StudioPublishItem[];
  };

  const buildPublishPayload = (): StudioPublishPayload => {
    const items = buildPublishVersions();
    const fallback: StudioPublishItem = {
      videoPath: renderOutputPath || '',
      previewUrl: renderOutputPreviewUrl || undefined,
      title: projectTitle.trim() || coverTitle || 'AI 快剪成片',
      description: caption.trim() || activeSpokenScript,
      ratio,
      sourceProjectId: projectId || undefined,
      platform: platform as StudioPublishPlatform,
      workflowRunId: projectWorkflowContext?.runId,
      workflowTaskId: projectWorkflowContext?.taskId,
      workflowTaskKey: projectWorkflowContext?.taskKey,
    };
    return items.length ? { ...fallback, items } : fallback;
  };

  useEffect(() => {
    try {
      const payload = buildPublishPayload();
      const publishableItems = payload.items?.length ? payload.items : [payload];
      if (publishableItems.some(item => Boolean(item.videoPath?.trim()))) {
        localStorage.setItem(publishStorageScope ? `ow_publish_draft:${encodeURIComponent(publishStorageScope)}` : 'ow_publish_draft', JSON.stringify(payload));
      } else {
        localStorage.removeItem(publishStorageScope ? `ow_publish_draft:${encodeURIComponent(publishStorageScope)}` : 'ow_publish_draft');
      }
    } catch { /* ignore */ }
    // Keep the top-level publish tab in sync with the latest generated combinations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRenderCombinationKey, activeVoiceLang, assemblyBgms, bgm, caption, contentPlanVersions, languageRenderOutputs, languageRenderVersions, materialVersionBgms, platform, projectId, projectTitle, publishStorageScope, ratio, renderOutputPath, renderOutputPreviewUrl, voiceDrafts, voiceLangs, voiceoverAudios, voiceoverMode, voiceoverUrl]);

  const goPublishCurrentWork = () => {
    const payload = buildPublishPayload();
    const items = payload.items?.length ? payload.items : [payload];
    if (!items.some(item => Boolean(item.videoPath?.trim()))) return;
    onGoPublish?.(payload);
  };

  const aiCaption = async () => {
    setCaptionLoading(true);
    try {
      const { caption: cap, hashtags } = await studioApi.caption(
        { script, productInfo: activeProductInfo, platform, language: lang, provider, audience, sellingPoints, tone },
        { caption, hashtags: [] },
      );
      const tags = (hashtags ?? []).map(t => `#${t.replace(/^#/, '')}`).join(' ');
      setCaption(tags ? `${cap} ${tags}` : cap);
    } catch (err: any) {
      alert(err?.message || '发布文案生成失败，请稍后重试。');
    } finally {
      setCaptionLoading(false);
    }
  };

  const generatePosterBrief = async () => {
    const imageEvidence = videoKickoff?.video?.aiAnalysis?.imageEvidence;
    const isEvidenceLedPackage = Boolean(
      (videoKickoff?.source === 'inspiration_image_post' || videoKickoff?.video?.contentFormat === 'image')
      && imageEvidence?.observedFacts?.length,
    );
    const isImageReferenceWithoutEvidence = Boolean(
      (videoKickoff?.source === 'inspiration_image_post' || videoKickoff?.video?.contentFormat === 'image')
      && !imageEvidence?.observedFacts?.length,
    );
    if (isImageReferenceWithoutEvidence) {
      setModeNotice('当前记录只有标题或首图，没有完整轮播证据。请返回灵感中心重新分析后再生成，避免凭空总结爆点。');
      return;
    }
    if (mode === 'product' && !activeProductLabel) {
      setModeNotice('产品信息生成需要先在第一步选择企业中心产品，再进入第二步选择配套素材。');
      return;
    }
    if (mode === 'clone' && !isEvidenceLedPackage && !selectedClips.some(item => item.folder === 'hot')) {
      setModeNotice('对标图文套用需要先选择一条公开图文参考，用于提取可见布局、信息模块和表达方式。');
      return;
    }
    setPosterLoading(true);
    setModeNotice('');
    try {
      if (isEvidenceLedPackage) {
        const result = await studioApi.leadContentPackage({
          productInfo: activeProductInfo,
          platform,
          language: lang,
          ratio,
          referenceTitle: videoKickoff?.video?.title || '',
          referenceEvidence: imageEvidence,
        });
        if (!result.ok || result.items.length < 3) throw new Error(result.error || '获客内容包生成失败');
        const first = result.items[0]!;
        const firstSlide = first.slides[0];
        const poster = {
          headline: firstSlide?.headline || first.title,
          subheadline: firstSlide?.body || first.objective,
          originBadge: '',
          trustBadges: [],
          sellingPoints: first.slides.slice(1, 4).map(slide => [slide.headline, slide.body].filter(Boolean).join('：')),
          process: [],
          categories: [],
          bottomBar: [],
          cta: first.cta,
        };
        const posterResult: FbPosterResult = {
          ok: true,
          source: 'ai',
          poster,
          caption: first.caption,
          hashtags: first.hashtags,
          commentCta: first.cta,
          dmOpening: first.dmOpening,
          fieldsToConfirm: result.fieldsToConfirm,
          imagePrompt: first.imagePrompt,
          layoutModules: result.referenceModulesUsed.map(module => ({
            module: module.module,
            referencePattern: module.evidence,
            localAssetRole: '企业中心对应产品/工厂/证书/包装素材',
            replacementInstruction: module.application,
          })),
        };
        setLeadContentPackage(result);
        setPosterDraft(posterResult);
        setPosterJsonText(JSON.stringify(result, null, 2));
        const tags = first.hashtags.map(tag => `#${String(tag).replace(/^#/, '')}`).join(' ');
        setCaption([first.caption, tags].filter(Boolean).join(' '));
        setPosterImageUrl('');

        const ownReferenceIds = selectedClips
          .filter(item => item.folder !== 'hot' && item.type !== 'audio')
          .slice(0, 4)
          .map(item => item.id);
        if (ownReferenceIds.length > 0) {
          setModeNotice('三组内容方案已生成，正在用企业素材生成第 1 组首图预览…');
          try {
            const rendered = await studioApi.fbPosterRender({
              poster,
              caption: first.caption,
              imagePrompt: [
                first.imagePrompt,
                'Generate only the first cover slide of this carousel.',
                firstSlide ? `Cover role: ${firstSlide.role}; headline: ${firstSlide.headline}; body: ${firstSlide.body}; required enterprise asset role: ${firstSlide.assetRole}.` : '',
                'The supplied reference images are owned enterprise assets. Do not reproduce any competitor product, logo, packaging, contact details, or text.',
              ].filter(Boolean).join('\n'),
              ratio,
              materialIds: ownReferenceIds,
            });
            if (!rendered.ok || !rendered.url) throw new Error(rendered.error || '首图生成失败');
            setPosterImageUrl(rendered.url);
            if (rendered.material?.id) setSelected(prev => [...new Set([...prev, rendered.material!.id])]);
            await refreshMaterials();
            setModeNotice(result.fieldsToConfirm.length
              ? `已生成三组获客内容和第 1 组首图；发布前请确认：${result.fieldsToConfirm.join('、')}`
              : '已生成三组连续获客内容和第 1 组首图预览。');
          } catch (imageErr: any) {
            setModeNotice(`三组获客内容已生成，但首图生成失败：${imageErr?.message || '请稍后重试'}`);
          }
        } else {
          setModeNotice(result.fieldsToConfirm.length
            ? `三组获客内容已生成。请先选择企业产品/工厂素材再生成图片；发布前还需确认：${result.fieldsToConfirm.join('、')}`
            : '三组获客内容已生成。为避免把竞品产品带入成图，请先选择企业中心产品/工厂素材，再生成图片。');
        }
        return;
      }
      setLeadContentPackage(null);
      const selectedMaterials = selectedClips.slice(0, 8).map(item => ({
        id: item.id,
        name: item.name,
        type: item.type,
        folder: item.folder,
        role: materialRoleLabel(item),
      }));
      const hotPosterRefs = selectedClips
        .filter(item => item.folder === 'hot')
        .map(item => [
          `爆款图文参考：${item.name}`,
          '需要模块化拆解：标题区、产品主视觉、背景氛围、工厂/证明区、徽章区、流程图、产品分类卡、CTA/底栏、配文框架。',
          '复用方式：只复用通用版式、构图、背景氛围和信息层级；用本地产品图替换竞品产品，用本地工厂图/证书图/包装图/场景图匹配对应模块。',
          '禁止复制：竞品品牌、Logo、认证、价格、MOQ、交期、出口国家、工厂资质和任何未验证商业承诺。',
        ].join('。'))
        .join('\n');
      const result = await studioApi.fbPoster({
        mode,
        productInfo: activeProductInfo,
        platform,
        ratio,
        posterStyle,
        language: lang,
        provider,
        materials: selectedMaterials,
        referenceNotes: mode === 'clone'
          ? [hotPosterRefs, videoKickoff ? cloneReferenceAnalysisText(videoKickoff) : ''].filter(Boolean).join('\n\n')
          : '',
      });
      if (!result.ok && !result.poster?.headline) throw new Error(result.error || '海报文案生成失败');
      setPosterDraft(result);
      setPosterJsonText(JSON.stringify(result.poster, null, 2));
      const tags = (result.hashtags || []).map(tag => `#${String(tag).replace(/^#/, '')}`).join(' ');
      setCaption([result.caption, tags].filter(Boolean).join(' '));
      setModeNotice('正在生成海报图...');
      try {
        const rendered = await studioApi.fbPosterRender({
          poster: result.poster,
          caption: result.caption,
          imagePrompt: result.imagePrompt,
          ratio,
          materialIds: selectedClips.filter(item => item.type !== 'audio').slice(0, 4).map(item => item.id),
        });
        if (!rendered.ok || !rendered.url) throw new Error(rendered.error || '图片生成失败');
        setPosterImageUrl(rendered.url);
        if (rendered.material?.id) setSelected(prev => [...new Set([...prev, rendered.material!.id])]);
        await refreshMaterials();
        setModeNotice(result.fieldsToConfirm?.length
          ? `已一次生成海报图和文案；请确认：${result.fieldsToConfirm.join('、')}`
          : '已一次生成海报图、海报文案 JSON 和发布配文。');
      } catch (imageErr: any) {
        setPosterImageUrl('');
        setModeNotice(result.fieldsToConfirm?.length
          ? `已生成海报文案 JSON，但图片生成失败：${imageErr?.message || '请检查图像模型 Key 或稍后重试'}；请确认：${result.fieldsToConfirm.join('、')}`
          : `已生成海报文案 JSON，但图片生成失败：${imageErr?.message || '请检查图像模型 Key 或稍后重试'}`);
      }
    } catch (err: any) {
      setModeNotice(err?.message || '海报文案生成失败，请稍后重试。');
    } finally {
      setPosterLoading(false);
    }
  };

  const demoAutoCreate = async () => {
    setDemoAutoLoading(true);
    try {
      if (selected.length === 0) setSelected(materials.slice(0, 3).map(m => m.id));
      const matNamesForDemo = selected.length > 0
        ? materials.filter(m => selected.includes(m.id)).map(m => m.name)
        : materials.slice(0, 3).map(m => m.name);
      const scriptResp = await studioApi.script(
        { materials: matNamesForDemo, productInfo: activeProductInfo, language: lang, platform, duration, scriptType, generationMode: mode, provider, audience, sellingPoints, tone, videoTheme: videoThemePayload },
        script,
      );
      if (scriptType === 'storyboard') announceRejectedStoryboard(scriptResp);
      const qualityFailure = scriptQualityFailure(scriptResp, 'AI脚本未通过检查，未返回可编辑结果。');
      if (qualityFailure) throw new Error(qualityFailure);
      if (!String(scriptResp.script || '').trim()) throw new Error('模型没有返回可用脚本。');
      setScript(scriptResp.script);
      setModeNotice(qualitySuccessNotice(scriptResp, '脚本与发布内容已生成。'));
      const coversResp = await studioApi.covers({ script: scriptResp.script, productInfo: activeProductInfo, language: lang, provider, tone }, [coverTitle]);
      if (coversResp.covers[0]) setCoverTitle(coversResp.covers[0]);
      const cap = await studioApi.caption(
        { script: scriptResp.script, productInfo: activeProductInfo, platform, language: lang, provider, audience, sellingPoints, tone },
        { caption, hashtags: [] },
      );
      const tags = (cap.hashtags ?? []).map(t => `#${t.replace(/^#/, '')}`).join(' ');
      setCaption(tags ? `${cap.caption} ${tags}` : cap.caption);
      await goPreview(scriptResp.script);
    } catch (err: any) {
      alert(err?.message || 'Demo 自动生成失败，请稍后重试。');
    } finally {
      setDemoAutoLoading(false);
    }
  };

  /* ── 素材库：只拉取真实素材 ──────────────────────── */
  const refreshMaterials = async () => {
    const real = await studioApi.listMaterials();
    const realClips = real.map(materialToClip);
    setMaterials(current => mergeClipLists(realClips, current.filter(item => item.sourceType === 'project-snapshot' || item.sourceType === 'historical-kickoff')));
  };
  const materialSourceRefreshesRef = useRef(new Set<string>());
  const refreshMaterialSource = async (materialId: string): Promise<Clip | undefined> => {
    if (materialSourceRefreshesRef.current.has(materialId)) return undefined;
    materialSourceRefreshesRef.current.add(materialId);
    try {
      const real = await studioApi.listMaterials();
      const refreshed = real.find(item => item.id === materialId);
      if (!refreshed) return undefined;
      const next = materialToClip(refreshed);
      setMaterials(current => current.map(item => item.id === materialId ? { ...item, url: next.url, poster: next.poster } : item));
      return next;
    } finally {
      materialSourceRefreshesRef.current.delete(materialId);
    }
  };
  useEffect(() => { void refreshMaterials(); }, []);
  useEffect(() => {
    const refill = (event: Event) => {
      const task = (event as CustomEvent<{ sourceProjectId?: string; uploadedMaterialIds?: string[] }>).detail;
      if (!task?.uploadedMaterialIds?.length || !projectId || task.sourceProjectId !== projectId) return;
      void refreshMaterials();
      setSelected(current => [...new Set([...current, ...task.uploadedMaterialIds!])]);
      setModeNotice('补拍素材已回填到当前草稿选材，原脚本未改写。');
    };
    window.addEventListener('lingshu:script-gap-refill', refill);
    return () => window.removeEventListener('lingshu:script-gap-refill', refill);
  }, [projectId]);
  useEffect(() => {
    const missing = materials.filter(item => item.type !== 'audio' && !clipAspectRatio(item) && (item.url || item.poster));
    if (!missing.length) return;
    let cancelled = false;
    void Promise.all(missing.map(async item => ({ id: item.id, ...(await probeClipAspect(item)) }))).then(results => {
      if (cancelled) return;
      const dimensions = new Map(results.filter(item => item.width > 0 && item.height > 0).map(item => [item.id, item]));
      if (!dimensions.size) return;
      setMaterials(current => current.map(item => {
        const found = dimensions.get(item.id);
        return found ? { ...item, width: found.width, height: found.height, aspectRatio: found.width / found.height } : item;
      }));
    });
    return () => { cancelled = true; };
  }, [materials]);

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    const uploadedIds: string[] = [];
    const targetFolder = activeFolder && !['all', 'hot', 'recommend'].includes(activeFolder) ? activeFolder : 'upload';
    for (const f of Array.from(files)) {
      try {
        const [dataBase64, media] = await Promise.all([fileToDataUrl(f), probeMedia(f)]);
        const { material } = await studioApi.uploadMaterial({
          name: f.name, folder: targetFolder, type: mediaType(f), duration: media.duration, width: media.width, height: media.height, dataBase64, mimeType: f.type,
        });
        if (material?.id) uploadedIds.push(material.id);
      } catch { /* 单个失败不影响其它 */ }
    }
    await refreshMaterials();
    if (uploadedIds.length) {
      setSelected(s => [...s, ...uploadedIds]);  // 上传完自动选中
      setActiveFolder(targetFolder);
    }
    setUploading(false);
  };

  const generateDigitalHumanPresenter = async () => {
    if (!projectId) {
      setDigitalHumanNotice('请先保存当前创作项目，保存成功后才能生成数字人。');
      return;
    }
    const source = materials.find(c => c.folder === 'presenter' && selected.includes(c.id) && c.type === 'video')
      || materials.find(c => c.folder === 'presenter' && c.type === 'video');
    if (!source?.id) {
      setDigitalHumanNotice('请先在「真人口播」文件夹上传或选择一条真人实拍视频。');
      return;
    }
    if (!activeVoiceoverUrl) {
      setDigitalHumanNotice('请先在「分镜与声音」生成或上传口播音频。');
      return;
    }
    if (!activeSpokenScript.trim()) {
      setDigitalHumanNotice('当前没有可用于数字人口播的脚本。');
      return;
    }
    if (!digitalHumanConsent) {
      setDigitalHumanNotice('请先确认已取得出镜人物授权及商业使用权。');
      return;
    }
    if (digitalHumanCapabilities && !digitalHumanCapabilities.available) {
      setDigitalHumanNotice(digitalHumanCapabilities.unavailableReason || '数字人推理服务尚未配置。');
      return;
    }
    setDigitalHumanLoading(true);
    setDigitalHumanNotice('');
    try {
      const result = await studioApi.createDigitalHumanJob({
        projectId: projectId!,
        avatarMaterialId: source.id,
        voiceoverUrl: activeVoiceoverUrl,
        script: activeSpokenScript,
        language: activeVoiceLang,
        mode: digitalHumanMode,
        voiceStrategy: digitalHumanVoiceStrategy,
        usagePurpose: 'internal_preview',
        consentConfirmed: digitalHumanConsent,
        performancePlanVersion: 'performance-v1',
        performancePlan: planDigitalHumanPerformance({ script: activeSpokenScript, durationMs: Math.max(1000, Math.round((storyboardSlots[storyboardSlots.length - 1]?.end || 15) * 1000)), preset: 'commerce' }),
        pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
      });
      if (!result.ok || !result.job) throw new Error(result.error || '数字人任务提交失败');
      setDigitalHumanJob(result.job);
      setDigitalHumanNotice('任务已提交。生成完成且质量检测通过后，会自动回流素材库。');
    } catch (err: any) {
      setDigitalHumanNotice(err?.message || '数字人口播生成失败，请稍后重试。');
      setDigitalHumanLoading(false);
    }
  };

  const digitalHumanSpeechForSlot = (slot: StoryboardSlot, language: string) => {
    const slotIndex = Math.max(0, storyboardSlots.findIndex(item => item.id === slot.id));
    const languageVoiceover = voiceoverForLanguage(language);
    const storyboardDuration = Math.max(0.1, storyboardSlots[storyboardSlots.length - 1]?.end || duration || 15);
    const languageDuration = Math.max(0.1, languageVoiceover.duration || storyboardDuration);
    const timeScale = languageDuration / storyboardDuration;
    const fallbackStart = Math.max(0, slot.start * timeScale);
    const fallbackEnd = Math.max(fallbackStart + 0.2, slot.end * timeScale);
    const localizedScript = voiceDrafts[language] || (language === activeVoiceLang ? activeSpokenScript : '');
    const resolved = resolveShotDigitalHumanSpeechSegment({
      fullScript: localizedScript,
      slotIndex,
      slotCount: storyboardSlots.length,
      cues: languageVoiceover.cues,
      fallbackStart,
      fallbackEnd,
    });
    const slotCopy = storyboardSlotScript(slot.detail);
    return {
      ...resolved,
      text: (resolved.text || slotCopy.voice || slotCopy.subtitle || slot.title).trim(),
      slotIndex,
      languageVoiceover,
    };
  };

  const digitalHumanBindingFreshness = (
    slot: StoryboardSlot,
    language: string,
    binding: ShotDigitalHumanBinding,
  ) => {
    const speech = digitalHumanSpeechForSlot(slot, language);
    const avatar = materials.find(item => item.id === binding.avatarMaterialId);
    const sourceInput = {
      slotId: slot.id,
      script: speech.text,
      language,
      voiceoverUrl: speech.languageVoiceover.url,
      start: speech.start,
      end: speech.end,
      avatarMaterialId: binding.avatarMaterialId,
      avatarVersion: avatar?.avatarVersion,
      pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
    };
    const currentSourceFingerprint = shotDigitalHumanSourceFingerprint(sourceInput);
    if (binding.sourceFingerprint) return { speech, currentSourceFingerprint };

    // Compatibility is intentionally restricted to old bindings that did not
    // persist a source fingerprint. New/profile bindings never invoke the
    // product planner while deciding whether an existing result is current.
    const legacyPlan = planDigitalHumanPerformance({
      script: speech.text,
      durationMs: Math.max(1000, Math.round((speech.end - speech.start) * 1000)),
      preset: binding.performancePreset || 'commerce',
      sceneIndex: speech.slotIndex,
      variationSeed: binding.performanceRevision || 0,
    });
    const legacyMotionClipIds = binding.motionClipIds || selectMotionClips(
      legacyPlan,
      materials
        .filter(item => item.assetRole === 'avatar_motion_clip' && item.avatarId === binding.avatarMaterialId && item.motionClip)
        .map(item => item.motionClip as AvatarMotionClip),
    ).map(item => item.motionClipId).filter((value): value is string => Boolean(value));
    const legacyCurrentPerformanceSignature = legacyShotDigitalHumanSignature({
      ...sourceInput,
      performancePlanVersion: 'performance-v1',
      performancePlanFingerprint: performancePlanFingerprint(legacyPlan),
      motionClipIds: legacyMotionClipIds,
      scenePlanFingerprint: JSON.stringify(legacyPlan.scene),
    });
    return { speech, currentSourceFingerprint, legacyCurrentPerformanceSignature };
  };

  const prepareDigitalHumanShotVariant = (
    slot: StoryboardSlot,
    avatarMaterialId: string,
    language: string,
    adjustment?: 'natural' | 'expressive' | 'alternate',
  ): {
    bindingKey: string;
    sourceFingerprint: string;
    performanceSignature: string;
    motionClipIds: string[];
    performanceRevision: number;
    performancePreset: 'natural' | 'professional' | 'commerce';
    request: DigitalHumanShotBatchVariant;
  } => {
    if (!projectId) throw new Error('请先保存当前创作项目，保存成功后才能生成数字人。');
    const bindingKey = digitalHumanLanguageKey(slot.id, language);
    const previousBinding = shotDigitalHumanBindings[bindingKey];
    const performanceRevision = adjustment ? (previousBinding?.performanceRevision || 0) + 1 : (previousBinding?.performanceRevision || 0);
    const performancePreset = adjustment === 'natural' ? 'natural' : adjustment === 'expressive' ? 'commerce' : (previousBinding?.performancePreset || 'commerce');
    const avatar = materials.find(item => item.id === avatarMaterialId && item.folder === 'presenter' && item.type === 'video');
    const speech = digitalHumanSpeechForSlot(slot, language);
    const { text: spokenText, slotIndex, languageVoiceover } = speech;
    if (!avatar || avatar.productionReady !== true || (avatar.personSetup && avatar.personSetup.state !== 'ready')) throw new Error('所选人物尚未准备完成。请等待本人授权与人物准备，或主动更换人物。');
    if (!languageVoiceover.url) throw new Error(`${LANGS.find(item => item.code === language)?.label || language}口播音频尚未就绪。`);
    if (!spokenText) throw new Error('当前分镜没有可驱动数字人的口播内容。');
    if (digitalHumanCapabilities?.available === false) throw new Error(digitalHumanCapabilities.unavailableReason || '数字人服务暂不可用。');

    const languageStart = speech.start;
    const languageEnd = speech.end;

    const performancePlan = planDigitalHumanPerformance({
      script: spokenText,
      durationMs: Math.max(1000, Math.round((languageEnd - languageStart) * 1000)),
      preset: performancePreset,
      sceneIndex: slotIndex,
      variationSeed: performanceRevision,
    });
    const motionClips = materials
      .filter(item => item.assetRole === 'avatar_motion_clip' && item.avatarId === avatarMaterialId && item.motionClip)
      .map(item => item.motionClip as AvatarMotionClip);
    const previousSlot = slotIndex > 0 ? storyboardSlots[slotIndex - 1] : undefined;
    const adjacentMotionClipIds = previousSlot
      // A multilingual hook may contain multiple beats. Only the final motion is
      // adjacent to this shot; excluding every earlier beat can force an
      // unrelated CTA clip onto an ordinary benefit sentence.
      ? (shotDigitalHumanBindings[digitalHumanLanguageKey(previousSlot.id, language)]?.motionClipIds || []).slice(-1)
      : [];
    const motionClipIds = selectMotionClips(
      performancePlan,
      motionClips,
      false,
      adjustment ? previousBinding?.motionClipIds || [] : adjacentMotionClipIds,
    )
      .map(item => item.motionClipId).filter((value): value is string => Boolean(value));
    const planFingerprint = performancePlanFingerprint(performancePlan);
    const sourceInput = {
      slotId: slot.id, script: spokenText, language, voiceoverUrl: languageVoiceover.url,
      start: languageStart, end: languageEnd, avatarMaterialId,
      avatarVersion: avatar.avatarVersion, pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
    };
    const sourceFingerprint = shotDigitalHumanSourceFingerprint(sourceInput);
    const performanceSignature = shotDigitalHumanSignature({
      ...sourceInput, performancePlanVersion: 'performance-v1', performancePlanFingerprint: planFingerprint,
      motionClipIds, scenePlanFingerprint: JSON.stringify(performancePlan.scene), pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
    });
    return {
      bindingKey, sourceFingerprint, performanceSignature, motionClipIds, performanceRevision, performancePreset,
      request: {
        audioStartSeconds: languageStart,
        audioEndSeconds: languageEnd,
        inputSignature: performanceSignature,
        voiceoverUrl: languageVoiceover.url,
        script: spokenText,
        language,
        performancePlanVersion: 'performance-v1',
        performancePlan,
        motionClipIds,
        pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
      },
    };
  };

  const generateDigitalHumanForShot = async (
    slot: StoryboardSlot,
    avatarMaterialId: string,
    language = activeVoiceLang,
    adjustment?: 'natural' | 'expressive' | 'alternate',
  ) => {
    setShotPreferredAvatarIds(current => ({ ...current, [slot.id]: avatarMaterialId }));
    let prepared: ReturnType<typeof prepareDigitalHumanShotVariant>;
    try {
      prepared = prepareDigitalHumanShotVariant(slot, avatarMaterialId, language, adjustment);
    } catch (error) {
      setDigitalHumanNotice(error instanceof Error ? error.message : '数字人任务参数无效。');
      return;
    }
    const { bindingKey, sourceFingerprint, performanceSignature, motionClipIds, performanceRevision, performancePreset } = prepared;
    setShotDigitalHumanBindings(current => ({
      ...current,
      [bindingKey]: {
        jobId: '', avatarMaterialId, status: 'submitting', inputSignature: performanceSignature,
        sourceFingerprint, performanceSignature, motionClipIds, performanceRevision, performancePreset,
      },
    }));
    setDigitalHumanNotice('');
    try {
      const result = await studioApi.createDigitalHumanJob({
        projectId: projectId!,
        storyboardSlotId: slot.id,
        avatarMaterialId,
        mode: 'quality',
        voiceStrategy: digitalHumanVoiceStrategy,
        timelineComposition: Object.values(shotMediaModes).some(value => value === 'material') ? 'mixed' : 'all_digital',
        allShotsUseSamePerson: new Set(Object.values(shotPreferredAvatarIds).filter(Boolean)).size <= 1,
        usagePurpose: 'internal_preview',
        consentConfirmed: true,
        ...prepared.request,
      });
      if (!result.ok || !result.job) throw new Error(result.error || '数字人任务提交失败');
      if (!result.job.inputSignature
        || result.job.sourceFingerprint !== sourceFingerprint
        || result.job.performanceSignature !== result.job.inputSignature
        || result.job.pipelineVersion !== prepared.request.pipelineVersion
        || JSON.stringify(result.job.motionClipIds || []) !== JSON.stringify(motionClipIds)
        || JSON.stringify(result.job.performancePlan) !== JSON.stringify(prepared.request.performancePlan)) {
        throw new Error('服务端返回的数字人任务签名与本次分镜不一致。');
      }
      setShotDigitalHumanBindings(current => ({
        ...current,
        [bindingKey]: {
          jobId: result.job!.id, avatarMaterialId, status: result.job!.status,
          inputSignature: result.job!.inputSignature!, sourceFingerprint,
          performanceSignature: result.job!.performanceSignature,
          motionClipIds, performanceRevision, performancePreset,
        },
      }));
    } catch (error) {
      setShotDigitalHumanBindings(current => ({
        ...current,
        [bindingKey]: {
          jobId: '', avatarMaterialId, status: 'failed', inputSignature: performanceSignature,
          sourceFingerprint, performanceSignature, motionClipIds, performanceRevision, performancePreset,
          error: error instanceof Error ? error.message : '数字人任务提交失败',
        },
      }));
    }
  };

  const generateDigitalHumanBatchForShot = async (
    slot: StoryboardSlot,
    avatarMaterialId: string,
    languages: string[],
  ) => {
    const uniqueLanguages = [...new Set(languages.filter(Boolean))];
    if (!uniqueLanguages.length) { setDigitalHumanNotice('请先完成至少一个目标语言的口播音频。'); return; }
    setShotPreferredAvatarIds(current => ({ ...current, [slot.id]: avatarMaterialId }));
    let prepared: Array<ReturnType<typeof prepareDigitalHumanShotVariant>>;
    try {
      prepared = uniqueLanguages.map(language => prepareDigitalHumanShotVariant(slot, avatarMaterialId, language));
    } catch (error) {
      setDigitalHumanNotice(error instanceof Error ? error.message : '数字人多语言任务参数无效。');
      return;
    }
    const batchSubmissionKey = `${slot.id}|${avatarMaterialId}|${prepared.map(item => item.performanceSignature).join('||')}`;
    if (digitalHumanQueueSubmissionRef.current === batchSubmissionKey) return;
    digitalHumanQueueSubmissionRef.current = batchSubmissionKey;
    setShotDigitalHumanBindings(current => {
      const next = { ...current };
      for (const item of prepared) {
        next[item.bindingKey] = {
          jobId: '', avatarMaterialId, status: 'submitting', inputSignature: item.performanceSignature,
          sourceFingerprint: item.sourceFingerprint, performanceSignature: item.performanceSignature,
          motionClipIds: item.motionClipIds, performanceRevision: item.performanceRevision, performancePreset: item.performancePreset,
        };
      }
      return next;
    });
    setDigitalHumanNotice(`正在一次性提交 ${prepared.length} 个语言变体…`);
    try {
      const result = await studioApi.createDigitalHumanShotBatch({
        projectId: projectId!,
        storyboardSlotId: slot.id,
        avatarMaterialId,
        mode: 'quality',
        voiceStrategy: digitalHumanVoiceStrategy,
        timelineComposition: Object.values(shotMediaModes).some(value => value === 'material') ? 'mixed' : 'all_digital',
        allShotsUseSamePerson: new Set(Object.values(shotPreferredAvatarIds).filter(Boolean)).size <= 1,
        usagePurpose: 'internal_preview',
        consentConfirmed: true,
        variants: prepared.map(item => item.request),
      });
      if (!result.ok || !result.batch || !result.jobs || result.jobs.length !== prepared.length) {
        throw new Error(result.error || '数字人多语言任务提交失败');
      }
      const jobsByLanguage = new Map(result.jobs.map(job => [job.language.replace(/_/g, '-').toLowerCase(), job]));
      setShotDigitalHumanBindings(current => {
        const next = { ...current };
        for (const item of prepared) {
          if (next[item.bindingKey]?.performanceSignature !== item.performanceSignature) continue;
          const job = jobsByLanguage.get(item.request.language.replace(/_/g, '-').toLowerCase());
          const exactJob = job?.inputSignature
            && job.storyboardSlotId === slot.id
            && job.avatarMaterialId === avatarMaterialId
            && job.sourceFingerprint === item.sourceFingerprint
            && job.performanceSignature === job.inputSignature
            && job.pipelineVersion === item.request.pipelineVersion
            && JSON.stringify(job.motionClipIds || []) === JSON.stringify(item.motionClipIds)
            && JSON.stringify(job.performancePlan) === JSON.stringify(item.request.performancePlan)
            ? job : undefined;
          next[item.bindingKey] = exactJob ? {
            jobId: exactJob.id, avatarMaterialId, status: exactJob.status, inputSignature: exactJob.inputSignature!,
            sourceFingerprint: item.sourceFingerprint, performanceSignature: exactJob.performanceSignature,
            outputMaterialId: exactJob.outputMaterialId, motionClipIds: item.motionClipIds,
            performanceRevision: item.performanceRevision, performancePreset: item.performancePreset,
          } : {
            ...next[item.bindingKey]!, status: 'failed', error: '服务端未返回对应语言任务。',
          };
        }
        return next;
      });
      setDigitalHumanNotice(`分镜已原子入队 ${result.jobs.length} 个语言任务；关闭或刷新页面也会继续生成。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '数字人多语言任务提交失败';
      setShotDigitalHumanBindings(current => {
        const next = { ...current };
        for (const item of prepared) {
          if (next[item.bindingKey]?.performanceSignature === item.performanceSignature) next[item.bindingKey] = { ...next[item.bindingKey]!, status: 'failed', error: message };
        }
        return next;
      });
      setDigitalHumanNotice(message);
    } finally {
      if (digitalHumanQueueSubmissionRef.current === batchSubmissionKey) digitalHumanQueueSubmissionRef.current = '';
    }
  };

  const activateDigitalHumanForShot = async (slot: StoryboardSlot) => {
    setShotMediaModes(current => ({ ...current, [slot.id]: 'digital' }));
    setDigitalHumanConsent(true);
    const hasMotionPack = (avatarId: string) => materials.some(item => item.assetRole === 'avatar_motion_clip' && item.avatarId === avatarId && item.motionClip);
    const eligibleAvatar = (item: Clip) => item.folder === 'presenter'
      && item.type === 'video'
      && item.assetRole === 'avatar_master'
      && item.productionReady === true
      && item.rightsStatus === 'commercial_cleared'
      && (!item.personSetup || item.personSetup.state === 'ready')
      && (hasMotionPack(item.id) || personIsReady(item));
    const preferredAvatarId = shotPreferredAvatarIds[slot.id] || shotDigitalHumanBindings[digitalHumanLanguageKey(slot.id, activeVoiceLang)]?.avatarMaterialId || preferredDigitalHumanAvatarId;
    const avatar = selectPerson(materials, preferredAvatarId, preferredDigitalHumanAvatarId, eligibleAvatar);
    if (!avatar) {
      setDigitalHumanNotice('所选或首选人物暂不可用，已保留选择。请等待人物准备完成，或点击更换人物；系统不会自动换成其他人。');
      return;
    }
    const readyLanguages = renderScriptLanguages();
    if (!readyLanguages.length) { setDigitalHumanNotice('请先完成至少一个目标语言的口播音频。'); return; }
    // Persist every language before returning control to the browser. The
    // local 8 GB Worker remains serial; only queue creation is batched.
    await generateDigitalHumanBatchForShot(slot, avatar.id, readyLanguages);
  };

  useEffect(() => {
    if (digitalHumanCapabilities?.available !== true) return;
    const readyLanguages = renderScriptLanguages();
    const pendingSlot = storyboardSlots.find(slot => shotMediaModes[slot.id] === 'digital'
      && !readyLanguages.some(language => shotDigitalHumanBindings[digitalHumanLanguageKey(slot.id, language)]?.status === 'submitting')
      && readyLanguages.some(language => {
        const binding = shotDigitalHumanBindings[digitalHumanLanguageKey(slot.id, language)];
        return !binding || binding.status === 'stale';
      }));
    if (!pendingSlot) return;
    const hasMotionPack = (avatarId: string) => materials.some(item => item.assetRole === 'avatar_motion_clip' && item.avatarId === avatarId && item.motionClip);
    const eligibleAvatar = (item: Clip) => item.folder === 'presenter'
      && item.type === 'video'
      && item.assetRole === 'avatar_master'
      && item.productionReady === true
      && item.rightsStatus === 'commercial_cleared'
      && (!item.personSetup || item.personSetup.state === 'ready')
      && (hasMotionPack(item.id) || personIsReady(item));
    const preferredAvatarId = shotPreferredAvatarIds[pendingSlot.id] || shotDigitalHumanBindings[digitalHumanLanguageKey(pendingSlot.id, activeVoiceLang)]?.avatarMaterialId;
    const avatar = selectPerson(materials, preferredAvatarId, preferredDigitalHumanAvatarId, eligibleAvatar);
    if (!avatar) return;
    void generateDigitalHumanBatchForShot(pendingSlot, avatar.id, readyLanguages);
    // The batch helper writes every submitting binding synchronously before
    // the request, preventing a second render from duplicating the batch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVoiceoverUrl, activeVoiceLang, digitalHumanCapabilities?.available, materials, preferredDigitalHumanAvatarId, shotDigitalHumanBindings, shotMediaModes, shotPreferredAvatarIds, storyboardSlots, voiceDrafts, voiceLangs, voiceoverAudios, voiceoverMode, voiceoverStaleLangs]);

  useEffect(() => {
    if (step !== 'preview') return;
    const digitalSlotIds = storyboardSlots.filter(slot => shotMediaModes[slot.id] === 'digital').map(slot => slot.id);
    if (!digitalSlotIds.length || rendering || batchRenderingLangs) return;
    const languages = renderScriptLanguages();
    if (!languages.length) return;
    const digitalReady = languages.every(code => digitalSlotIds.every(slotId => (
      shotDigitalHumanBindings[digitalHumanLanguageKey(slotId, code)]?.status === 'completed'
      && storyboardAssignments[digitalHumanLanguageKey(slotId, code)]
    )));
    const allShotsReady = languages.every(code => storyboardSlots.length > 0 && storyboardSlots.every(slot => shotMediaModes[slot.id] === 'digital'
      ? storyboardAssignments[digitalHumanLanguageKey(slot.id, code)]
      : storyboardAssignments[slot.id]));
    if (!digitalReady || !allShotsReady) return;
    const readyCombinations = buildRenderableVideoVersions();
    if (!readyCombinations.length) return;
    const renderKey = JSON.stringify(readyCombinations.map(item => [item.key, item.inputSignature]));
    if (autoDigitalRenderKeyRef.current === renderKey) return;
    autoDigitalRenderKeyRef.current = renderKey;
    setModeNotice(`数字人分镜已通过质检并回填，正在自动合成 ${languages.length} 个语言版本…`);
    void renderAllReadyLanguageVersions().catch(error => {
      setModeNotice(error instanceof Error ? `自动合成失败：${error.message}` : '自动合成失败，请重试。');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchRenderingLangs, languageRenderOutputs, projectId, rendering, shotDigitalHumanBindings, shotMediaModes, storyboardAssignments, storyboardSlots, step, voiceDrafts, voiceLangs, voiceoverAudios, voiceoverMode, voiceoverStaleLangs]);

  useEffect(() => {
    let cancelled = false;
    void studioApi.digitalHumanCapabilities().then(value => { if (!cancelled) setDigitalHumanCapabilities(value); });
    void studioApi.listDigitalHumanAvatars(true).then(value => {
      if (cancelled) return;
      setPreferredDigitalHumanAvatarId(value.preferredAvatarMaterialId);
      setMaterials(current => {
        const avatarIds = new Set(value.items.map(item => item.id));
        return [...current.filter(item => !avatarIds.has(item.id)), ...value.items] as Clip[];
      });
    });
    void studioApi.listDigitalHumanJobs(projectId || undefined).then(async jobs => {
      if (cancelled || !jobs.length) return;
      const latestWholeVideoJob = jobs.find(job => !job.storyboardSlotId);
      if (latestWholeVideoJob) {
        setDigitalHumanJob(latestWholeVideoJob);
        setDigitalHumanLoading(['queued', 'submitting', 'processing', 'quality_check'].includes(latestWholeVideoJob.status));
      }
      const restored: Record<string, ShotDigitalHumanBinding> = {};
      for (const job of [...jobs].reverse()) {
        if (!job.storyboardSlotId || !job.inputSignature) continue;
        const bindingKey = digitalHumanLanguageKey(job.storyboardSlotId, job.language || 'zh');
        const savedBinding = shotDigitalHumanBindings[bindingKey];
        restored[bindingKey] = {
          ...savedBinding,
          jobId: job.id, avatarMaterialId: job.avatarMaterialId, status: job.status,
          inputSignature: job.inputSignature, outputMaterialId: job.outputMaterialId, error: job.errorMessage,
          sourceFingerprint: job.sourceFingerprint || savedBinding?.sourceFingerprint,
          performanceSignature: job.performanceSignature || savedBinding?.performanceSignature,
          motionClipIds: job.motionClipIds,
          performanceRevision: job.performancePlan?.variationSeed || 0,
          performancePreset: job.performancePlan?.preset || 'commerce',
        };
      }
      setShotDigitalHumanBindings(current => ({ ...current, ...restored }));
      const completedResults = await Promise.allSettled(jobs
        .filter(job => Boolean(job.storyboardSlotId && job.inputSignature && job.status === 'completed' && job.outputMaterialId))
        .map(job => studioApi.getDigitalHumanJob(job.id)));
      if (cancelled) return;
      const restoredOutputs = completedResults
        .filter((item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof studioApi.getDigitalHumanJob>>> => item.status === 'fulfilled')
        .map(item => item.value)
        .filter(item => {
          const job = item.job;
          if (!job?.storyboardSlotId || !job.inputSignature || !item.outputMaterial?.id) return false;
          const language = job.language || 'zh';
          const binding = restored[digitalHumanLanguageKey(job.storyboardSlotId, language)];
          const slot = storyboardSlots.find(candidate => candidate.id === job.storyboardSlotId);
          if (!binding || !slot) return false;
          const freshness = digitalHumanBindingFreshness(slot, language, binding);
          const resolution = resolveShotDigitalHumanResult({
            binding,
            currentSignature: freshness.legacyCurrentPerformanceSignature,
            currentSourceFingerprint: freshness.currentSourceFingerprint,
            jobInputSignature: job.inputSignature,
            jobSourceFingerprint: job.sourceFingerprint,
            jobStatus: job.status, outputMaterialId: job.outputMaterialId,
            error: job.errorMessage,
          });
          return Boolean(resolution.assignmentMaterialId);
        });
      if (restoredOutputs.length) {
        setMaterials(current => mergeClipLists(current, restoredOutputs.map(item => item.outputMaterial as Clip)));
        setStoryboardAssignments(current => ({
          ...current,
          ...Object.fromEntries(restoredOutputs.map(item => [
            digitalHumanLanguageKey(item.job!.storyboardSlotId!, item.job!.language || 'zh'),
            item.outputMaterial!.id,
          ])),
        }));
      }
    });
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    const refreshCapabilities = () => {
      if (document.hidden) return;
      void studioApi.digitalHumanCapabilities().then(value => {
        if (!cancelled) setDigitalHumanCapabilities(value);
      });
      void studioApi.listDigitalHumanAvatars(true).then(value => {
        if (cancelled) return;
        setPreferredDigitalHumanAvatarId(value.preferredAvatarMaterialId);
        setMaterials(current => [...current.filter(item => item.assetRole !== 'avatar_master'), ...value.items] as Clip[]);
      });
    };
    const timer = window.setInterval(refreshCapabilities, 10_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const active = Object.entries(shotDigitalHumanBindings).filter(([bindingKey, binding]) => binding.jobId && (
      isShotDigitalHumanActive(binding.status)
      || (binding.status === 'completed' && !storyboardAssignments[bindingKey])
    ));
    if (!active.length) return;
    let cancelled = false;
    const poll = async () => {
      for (const [bindingKey, binding] of active) {
        const { slotId, language } = parseDigitalHumanLanguageKey(bindingKey);
        const result = await studioApi.getDigitalHumanJob(binding.jobId);
        if (cancelled || !result.job) continue;
        const job = result.job;
        if (job.status === 'completed' && result.outputMaterial?.id) {
          const slot = storyboardSlots.find(item => item.id === slotId);
          const effectiveLanguage = language || job.language || activeVoiceLang;
          const freshness = slot ? digitalHumanBindingFreshness(slot, effectiveLanguage, binding) : undefined;
          const resolution = resolveShotDigitalHumanResult({
            binding,
            currentSignature: freshness?.legacyCurrentPerformanceSignature,
            currentSourceFingerprint: freshness?.currentSourceFingerprint || '',
            jobInputSignature: job.inputSignature,
            jobSourceFingerprint: job.sourceFingerprint,
            jobStatus: job.status, outputMaterialId: job.outputMaterialId,
            error: job.errorMessage,
          });
          if (resolution.assignmentMaterialId) {
            setMaterials(current => mergeClipLists(current, [result.outputMaterial as Clip]));
            setSelected(current => [...new Set([...current, result.outputMaterial!.id])]);
            setStoryboardAssignments(current => ({ ...current, [digitalHumanLanguageKey(slotId, language || job.language)]: resolution.assignmentMaterialId! }));
            setStoryboardSourcePlans(current => ({ ...current, [slotId]: { ...sourcePlanFor(slot!), mode: 'ai', decided: true, confirmed: true, generatedClipId: resolution.assignmentMaterialId } }));
          }
          setShotDigitalHumanBindings(current => ({ ...current, [bindingKey]: resolution.binding }));
          continue;
        }
        setShotDigitalHumanBindings(current => ({
          ...current,
          [bindingKey]: {
            ...current[bindingKey]!, status: job.status, outputMaterialId: job.outputMaterialId,
            error: job.status === 'review' ? (job.qualityReport?.gateFailures?.join('；') || '质量检测未通过') : job.errorMessage,
          },
        }));
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [shotDigitalHumanBindings, storyboardAssignments, storyboardSlots, activeVoiceLang, activeVoiceoverUrl, activeSpokenScript, duration, materials, voiceDrafts, voiceoverAudios]);

  useEffect(() => {
    let changed = false;
    const staleOutputIds: string[] = [];
    const next = { ...shotDigitalHumanBindings };
    for (const [bindingKey, binding] of Object.entries(shotDigitalHumanBindings)) {
      if (binding.status === 'stale') continue;
      const { slotId, language } = parseDigitalHumanLanguageKey(bindingKey);
      const slot = storyboardSlots.find(item => item.id === slotId);
      if (!slot) continue;
      const freshness = digitalHumanBindingFreshness(slot, language || activeVoiceLang, binding);
      if (!isShotDigitalHumanSourceCurrent(
        binding,
        freshness.currentSourceFingerprint,
        freshness.legacyCurrentPerformanceSignature,
      )) {
        next[bindingKey] = { ...binding, status: 'stale', error: '分镜口播、配音或时间区间已变化，请重新生成。' };
        if (binding.outputMaterialId) staleOutputIds.push(binding.outputMaterialId);
        changed = true;
      }
    }
    if (!changed) return;
    setShotDigitalHumanBindings(next);
    if (staleOutputIds.length) {
      setStoryboardAssignments(current => Object.fromEntries(Object.entries(current).filter(([, materialId]) => !staleOutputIds.includes(materialId))));
    }
  }, [storyboardSlots, activeVoiceLang, activeVoiceoverUrl, activeSpokenScript, duration, materials, voiceDrafts, voiceoverAudios]);

  useEffect(() => {
    if (!digitalHumanJob || !['queued', 'submitting', 'processing', 'quality_check'].includes(digitalHumanJob.status)) return;
    let cancelled = false;
    const poll = async () => {
      const result = await studioApi.getDigitalHumanJob(digitalHumanJob.id);
      if (cancelled || !result.job) return;
      setDigitalHumanJob(result.job);
      if (result.job.status === 'completed') {
        setDigitalHumanLoading(false);
        await refreshMaterials();
        if (result.outputMaterial?.id) setSelected(current => [...current.filter(id => id !== digitalHumanJob.avatarMaterialId), result.outputMaterial!.id]);
        setDigitalHumanNotice('数字人口播已通过质量检测并回流素材库。');
      } else if (result.job.status === 'review') {
        setDigitalHumanLoading(false);
        setDigitalHumanNotice('自动质量检测未通过，成片已拦截，请重试或人工复核。');
      } else if (result.job.status === 'failed' || result.job.status === 'cancelled') {
        setDigitalHumanLoading(false);
        setDigitalHumanNotice(result.job.errorMessage || '数字人任务未完成。');
      }
    };
    const timer = window.setInterval(() => void poll(), 3000);
    void poll();
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [digitalHumanJob?.id, digitalHumanJob?.status]);

  /* ── BGM 曲库 ────────────────────────────────────────────────────────── */
  const refreshBgm = async () => {
    const list = await studioApi.listBgm();
    setBgms(list as Bgm[]);
  };
  useEffect(() => { void refreshBgm(); }, []);
  useEffect(() => {
    if (step === 'bgm') void refreshBgm();
  }, [step]);
  useEffect(() => {
    try {
      localStorage.setItem('ow_favorite_bgms', JSON.stringify(favoriteBgms));
    } catch {
      // Embedded browsers can disable localStorage; favorites simply become session-only.
    }
  }, [favoriteBgms]);

  // 离开配乐步骤时停止试听
  useEffect(() => {
    if (step !== 'bgm' && audioRef.current) {
      audioRef.current.pause();
      setPlayingBgm(null);
    }
  }, [step]);

  const togglePlay = (track: Bgm) => {
    if (!track.url) return;
    const el = audioRef.current;
    if (!el) return;
    if (playingBgm === track.id) {
      el.pause();
      setPlayingBgm(null);
      return;
    }
    el.src = track.url;
    void el.play().then(() => setPlayingBgm(track.id)).catch(() => setPlayingBgm(null));
  };

  const toggleFavoriteBgm = (id: string) => {
    setFavoriteBgms(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  };

  const handleBgmUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBgmUploading(true);
    setBgmNotice('正在上传音乐…');
    const f = files[0];
    try {
      const dataBase64 = await fileToDataUrl(f);
      const { track } = await studioApi.uploadBgm({ name: f.name, dataBase64, mimeType: f.type });
      await refreshBgm();
      if (track?.id) {
        setBgm(track.id);
        setAssemblyBgms(current => ({ ...current, [activeAssemblyId]: track.id }));
        setMaterialVersionBgms(current => ({ ...current, [materialVersionKey(activeAssemblyId, activeVoiceLang)]: track.id }));
        setPreviewBgmOn(true);
        setBgmNotice(`已上传并选中「${track.name || f.name}」`);
      } else {
        setBgmNotice('音乐已上传，但未返回可用曲目，请刷新后重试。');
      }
    } catch (error: any) {
      setBgmNotice(error?.message || '音乐上传失败，请检查文件格式后重试。');
    } finally {
      setBgmUploading(false);
    }
  };

  /* ── 配音 TTS ────────────────────────────────────────────────────────── */
  const clearVoiceover = () => {
    setVoiceoverMode('none');
    setVoiceoverUrl(null);
    setVoiceoverDur(0);
    setVoiceoverAudios({});
    setAlignedCuesByLang({});
    setUploadedVoiceName('');
    setTtsNotice('');
    setTtsPlaying(false);
    if (ttsAudioRef.current) ttsAudioRef.current.pause();
  };

  const handleVoiceoverUpload = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setTtsLoading(true);
    setTtsLoadingScope('upload');
    try {
      const [dataBase64, duration] = await Promise.all([fileToDataUrl(f), probeAudioDuration(f)]);
      const r = await studioApi.uploadVoiceover({ name: f.name, dataBase64, mimeType: f.type, duration });
      if (!r.ok || !r.url) throw new Error(r.error || '口播音频上传失败');
      setVoiceoverMode('upload');
      setVoiceoverUrl(r.url);
      setVoiceoverDur(r.duration || duration);
      setVoiceoverAudios({ [activeVoiceLang || 'zh']: { url: r.url, duration: r.duration || duration } });
      setVoiceoverStaleLangs(current => current.filter(code => code !== (activeVoiceLang || 'zh')));
      setRenderOutputPath(null);
      setRenderOutputPreviewUrl(null);
      setLanguageRenderOutputs({});
      setLanguageRenderVersions({});
      setStoryboardVideoVersions({});
      setProductVideoVersions([]);
      setUploadedVoiceName(f.name);
      setSubtitlesOn(true);
      setSubMode('target');
      const audioDuration = r.duration || duration;
      const transcriptHint = stripVoiceoverTimestamps(activeSpokenScript);
      if (audioDuration > 0) {
        setTtsNotice('口播已上传，正在识别语音并生成字幕时间轴…');
        const transcription = await studioApi.transcribeVoiceover({
          url: r.url,
          duration: audioDuration,
          language: activeVoiceLang || lang,
          transcriptHint,
        });
        if (transcription.ok && transcription.text && transcription.cues?.length) {
          const code = activeVoiceLang || 'zh';
          setVoiceoverLines(transcription.text);
          setVoiceDrafts(current => ({ ...current, [code]: transcription.text }));
          setAlignedCuesByLang(current => ({ ...current, [code]: transcription.cues }));
          setVoiceoverAudios({ [code]: { url: r.url, duration: audioDuration, cues: transcription.cues, text: transcription.text, alignmentSource: transcription.source } });
          setTtsNotice(transcription.source === 'audio_ai'
            ? '已根据上传音频自动识别口播，并生成逐句/逐词字幕时间轴。'
            : '已生成字幕时间轴；当前使用脚本比例对齐，建议播放后人工确认。');
        } else {
          setTtsNotice(`音频已上传，但自动识别字幕失败：${transcription.error || '未识别到清晰人声'}`);
        }
      }
    } catch (err: any) {
      alert(err?.message || '口播音频上传失败，请稍后重试。');
    } finally {
      setTtsLoading(false);
      setTtsLoadingScope(null);
    }
  };

  const handleVoiceSampleUpload = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setTtsLoading(true);
    setTtsLoadingScope('upload');
    try {
      const [dataBase64, duration] = await Promise.all([fileToDataUrl(f), probeAudioDuration(f)]);
      const r = await studioApi.uploadVoiceSample({ name: f.name, dataBase64, mimeType: f.type, duration });
      if (!r.ok || !r.voiceId) throw new Error(r.error || '真人音色录入失败');
      setVoice(r.voiceId);
      setCustomVoiceId(r.voiceId);
      setCustomVoiceName(r.name || f.name);
      setCustomVoiceUrl(r.url || '');
      setCustomVoices(current => [{ voiceId: r.voiceId!, name: r.name || f.name, url: r.url || '', duration: r.duration || duration, createdAt: new Date().toISOString() }, ...current.filter(item => item.voiceId !== r.voiceId)]);
      setVoiceCandidates(current => current.includes(r.voiceId!) ? current : [...current, r.voiceId!]);
      setVoiceoverMode('ai');
      setVoiceoverUrl(null);
      setVoiceoverAudios({});
      setAudioCapabilities(current => current ? {
        ...current,
        customVoice: { ...current.customVoice, synthesis: Boolean(r.synthesisReady), message: r.warning || (r.synthesisReady ? `真人音色合成可用（${r.engine === 'xtts' ? 'XTTS/Coqui' : 'MiniMax'}）` : current.customVoice.message) },
      } : current);
      setTtsNotice(r.synthesisReady
        ? `已录入真人音色，可通过 ${r.engine === 'xtts' ? 'XTTS/Coqui' : 'MiniMax'} 生成配音。`
        : `声音样本已保存，但暂不能合成：${r.warning || '服务器未配置真人音色克隆引擎。'}`);
    } catch (err: any) {
      alert(err?.message || '真人音色录入失败，请检查音频文件后重试。');
    } finally {
      setTtsLoading(false);
      setTtsLoadingScope(null);
    }
  };

  const openVoiceSamplePicker = () => {
    voiceSampleInputRef.current?.click();
  };

  const diagnoseMinimax = async () => {
    setMinimaxDiagnosing(true);
    setMinimaxDiagnostic('正在检查 MiniMax Key、网络和音色查询权限…');
    try {
      const result = await studioApi.diagnoseMinimax();
      setMinimaxDiagnostic(result.ok
        ? `${result.message || 'MiniMax 连接正常'}${result.latencyMs != null ? `（${result.latencyMs}ms）` : ''}`
        : `诊断失败：${result.error || '未知错误'}`);
    } finally {
      setMinimaxDiagnosing(false);
    }
  };

  const genTts = async (onlyLanguage?: string) => {
    const requestId = ++ttsRequestRef.current;
    const isCurrentTtsRequest = () => ttsRequestRef.current === requestId;
    const ttsDraftSnapshot = { ...voiceDrafts };
    setTtsLoading(true);
    setTtsLoadingScope(onlyLanguage ? 'single' : 'all');
    const detectedSourceLanguage = detectScriptLanguageCode(voiceoverLines || extractVoiceoverText(script));
    const requestedLangs = onlyLanguage ? [onlyLanguage] : (voiceLangs.length ? voiceLangs : [detectedSourceLanguage]);
    const failureReasonsByLang: Record<string, string> = {};
    setTtsActiveLangs(requestedLangs);
    setTtsFailuresByLang(current => Object.fromEntries(Object.entries(current).filter(([code]) => !requestedLangs.includes(code))));
    setTtsNotice(`正在生成 ${requestedLangs.length} 个语种配音...`);
    const existingRequestedAudioCodes = requestedLangs.filter(code => Boolean(voiceoverAudios[code]?.url));
    if (existingRequestedAudioCodes.length) setVoiceoverStaleLangs(current => [...new Set([...current, ...existingRequestedAudioCodes])]);
    if (!onlyLanguage) {
      setVoiceoverUrl(null);
      setAlignedCuesByLang({});
    }
    try {
      const langs = requestedLangs;
      const sourceText = extractVoiceoverText(script) || voiceoverLines || script;
      const sourceLanguage = detectScriptLanguageCode(sourceText);
      const base = primaryVoiceDraft(sourceLanguage, sourceText, voiceDrafts);
      const drafts: Record<string, string> = { ...voiceDrafts, [sourceLanguage]: voiceDrafts[sourceLanguage] || base };
      const mergeTtsDraftsIntoState = () => setVoiceDrafts(current => Object.entries(drafts).reduce(
        (next, [code, value]) => mergeGeneratedVoiceDraft(next, ttsDraftSnapshot, code, value),
        current,
      ));
      const missingTranslationLangs: string[] = [];
      const degradedTranslationLangs = new Set<string>();
      const targetsToTranslate: string[] = [];
      for (const code of langs) {
        if (drafts[code]?.trim()) continue;
        if (code === sourceLanguage) {
          drafts[sourceLanguage] = base;
        } else {
          targetsToTranslate.push(code);
        }
      }
      if (targetsToTranslate.length) {
        const translated = await studioApi.translateBatch({ text: normalizeScriptTimestamps(base), targets: targetsToTranslate, source: sourceLanguage })
          .catch((err: any) => ({ ok: false, translations: {} as Record<string, string>, translationSources: {} as Record<string, 'ai' | 'deterministic'>, error: err?.message || '请求失败' }));
        for (const code of targetsToTranslate) {
          let raw = translated.translations?.[code] || '';
          let translationSource = translated.translationSources?.[code] || '';
          let normalized = raw.trim()
            ? resolveTranslatedVoiceover(base, raw, code)
            : '';
          if (!normalized.trim()) {
            const single = await studioApi.translate({ text: normalizeScriptTimestamps(base), target: code, source: sourceLanguage })
              .catch(() => ({ ok: false, text: '', source: 'fallback' as const }));
            raw = single.ok ? single.text : '';
            normalized = raw.trim() ? resolveTranslatedVoiceover(base, raw, code) : '';
            translationSource = single.source || '';
          }
          if (normalized.trim()) {
            drafts[code] = normalized;
            if (translationSource === 'deterministic') degradedTranslationLangs.add(code);
          }
          else missingTranslationLangs.push(`${code}:${translated.error || '模型未返回有效译文'}`);
        }
      }
      if (!isCurrentTtsRequest()) return;
      setVoiceoverLines(base);
      mergeTtsDraftsIntoState();
      if (targetsToTranslate.length) {
        setVoiceDraftDegradedLangs(current => [
          ...current.filter(code => !targetsToTranslate.includes(code)),
          ...degradedTranslationLangs,
        ]);
      }

      const audios: Record<string, { url: string; duration: number; cues?: SubCue[]; text?: string; alignmentSource?: string; customVoiceStatus?: 'activated' }> = { ...voiceoverAudios };
      const aligned: Record<string, SubCue[]> = onlyLanguage ? { ...alignedCuesByLang } : {};
      const generatedCodes = new Set<string>();
      const failures: string[] = [];
      const availableLangs = langs.filter(code => drafts[code]?.trim());
      const ttsJobs = availableLangs.map(code => {
          const text = drafts[code];
          const settings = ttsLanguageSettings[code] || DEFAULT_TTS_SETTINGS;
          const inheritReferenceRhythm = mode === 'clone' && useReferenceVoiceStyle && referenceVoice.available;
          const style: Partial<TtsStyleOptions> = {
            preset: settings.preset,
            emotion: inheritReferenceRhythm
              ? `${referenceVoice.emotion}；沿用对标口播的信息密度、能量推进和自然停顿，不复制原声音身份`
              : settings.emotion,
            emotionIntensity: inheritReferenceRhythm ? 78 : settings.emotionIntensity,
            speed: inheritReferenceRhythm ? referenceVoice.baseSpeed : settings.speed,
            targetDuration: (mode === 'material' || mode === 'clone') && storyboardTimelineEnd > 0 ? storyboardTimelineEnd : duration,
            pauseStyle: inheritReferenceRhythm ? 'natural' : settings.pauseStyle,
            pronunciations: parsePronunciationRules(settings.pronunciationText),
          };
          return { code, text, voiceId: settings.voiceId || voice, style };
      });
      const acceptTtsResult = (code: string, r: Awaited<ReturnType<typeof studioApi.tts>>) => {
          if (r.ok && r.url) {
            audios[code] = { url: r.url, duration: r.duration ?? 0, cues: r.cues, text: r.text, alignmentSource: r.alignmentSource, customVoiceStatus: r.customVoiceStatus };
            generatedCodes.add(code);
            if (r.cues?.length) aligned[code] = r.cues;
            if (r.text?.trim()) drafts[code] = r.text;
          } else {
            const label = LANGS.find(item => item.code === code)?.label || code;
            const reason = publicVoiceFailureReason(r.error || (r.source === 'local' ? '后端连接失败或额度不可用' : '未返回音频'));
            failureReasonsByLang[code] = reason;
            failures.push(`${label}：${reason}`);
          }
      };
      if (onlyLanguage) {
        await Promise.all(ttsJobs.map(async job => {
          const result = await studioApi.tts({ text: stripVoiceoverTimestamps(job.text), voice: job.voiceId, language: job.code, style: job.style });
          acceptTtsResult(job.code, result);
        }));
      } else {
        const groups = new Map<string, typeof ttsJobs>();
        for (const job of ttsJobs) {
          const key = JSON.stringify({ voice: job.voiceId, style: job.style });
          groups.set(key, [...(groups.get(key) || []), job]);
        }
        for (const jobs of groups.values()) {
          if (!isCurrentTtsRequest()) return;
          const batch = await studioApi.ttsBatch({
            voice: jobs[0]!.voiceId,
            style: jobs[0]!.style,
            items: jobs.map(job => ({ code: job.code, language: job.code, text: stripVoiceoverTimestamps(job.text) })),
          });
          for (const job of jobs) acceptTtsResult(job.code, batch.audios[job.code] || { ok: false, source: 'batch', error: batch.error || '批量配音未返回音频' });
        }
      }
      if (!isCurrentTtsRequest()) return;
      await Promise.all(Object.entries(audios).filter(([code]) => availableLangs.includes(code)).map(async ([code, audio]) => {
        const text = audio.text || drafts[code] || '';
        if (audio.alignmentSource === 'minimax_native' && audio.cues?.length) {
          aligned[code] = audio.cues;
          return;
        }
        if (!text || !audio.url || !audio.duration) return;
        const result = await studioApi.alignTts({ text, url: audio.url, duration: audio.duration });
        if (result.ok && result.cues?.length) {
          audio.cues = result.cues;
          audio.alignmentSource = result.source;
          aligned[code] = result.cues;
        } else if (audio.cues?.length) {
          aligned[code] = audio.cues;
        }
      }));
      if (!isCurrentTtsRequest()) return;
      const activeCode = langs.includes(activeVoiceLang) ? activeVoiceLang : langs[0] || 'zh';
      const activeAudio = generatedCodes.has(activeCode)
        ? audios[activeCode]
        : [...generatedCodes].map(code => audios[code]).find(Boolean);
      if (!activeAudio) {
        throw new Error(failures[0] || '没有生成可用配音，请检查 TTS Key 或试用额度。');
      }
      setVoiceoverMode('ai');
      setVoiceoverAudios(audios);
      setRenderOutputPath(null);
      setRenderOutputPreviewUrl(null);
      setLanguageRenderOutputs({});
      setLanguageRenderVersions({});
      setStoryboardVideoVersions({});
      setProductVideoVersions([]);
      mergeTtsDraftsIntoState();
      setVoiceDraftStaleLangs(current => current.filter(code => !availableLangs.includes(code)));
      setVoiceoverStaleLangs(current => current.filter(code => !generatedCodes.has(code)));
      setActiveVoiceLang(activeCode);
      setLang(activeCode);
      setVoiceoverUrl(activeAudio.url);
      setVoiceoverDur(activeAudio.duration);
      setUploadedVoiceName('');
      setSubtitlesOn(true);
      setSubMode('target');
      missingTranslationLangs.forEach(item => {
        const separatorIndex = item.indexOf(':');
        const code = separatorIndex >= 0 ? item.slice(0, separatorIndex) : item;
        const reason = separatorIndex >= 0 ? item.slice(separatorIndex + 1) : '翻译失败';
        failureReasonsByLang[code] = `翻译失败，未生成配音（${reason || '未知原因'}）`;
      });
      if (Object.keys(failureReasonsByLang).length) {
        setTtsFailuresByLang(current => ({ ...current, ...failureReasonsByLang }));
      }
      const projectAudioLanguages = [...new Set([...voiceLangs, ...requestedLangs])];
      const validProjectAudioLanguages = validProjectVoiceoverLanguages(
        projectAudioLanguages,
        audios,
        voiceoverStaleLangs,
        existingRequestedAudioCodes,
        [...generatedCodes],
      );
      const validProjectAudioSummary = `当前项目已有 ${validProjectAudioLanguages.length}/${projectAudioLanguages.length} 个有效语种配音`;
      setTtsNotice(failures.length || missingTranslationLangs.length
        ? `本次已生成 ${availableLangs.length - failures.length}/${langs.length} 个语种配音；${[...failures, ...missingTranslationLangs.map(item => {
          const [code, reason] = item.split(':');
          return `${LANGS.find(langItem => langItem.code === code)?.label || code}：翻译失败，未生成配音（${reason || '未知原因'}）`;
        })].join('；')}`
        : voice.startsWith('custom:') && Object.values(audios).some(item => item.customVoiceStatus === 'activated')
          ? `${validProjectAudioSummary}，真人音色已通过正式 TTS 激活并保存。下一步可一键生成字幕。`
          : `${validProjectAudioSummary}。下一步可一键生成字幕。`);
    } catch (err: any) {
      if (!isCurrentTtsRequest()) return;
      const reason = err?.message || '配音生成失败，请稍后重试。';
      setTtsFailuresByLang(current => ({
        ...current,
        ...Object.fromEntries(requestedLangs.map(code => [code, failureReasonsByLang[code] || reason])),
      }));
      setTtsNotice(reason);
    } finally {
      if (isCurrentTtsRequest()) {
        setTtsLoading(false);
        setTtsLoadingScope(null);
        setTtsActiveLangs([]);
      }
    }
  };
  const generateSubtitleDrafts = async () => {
    setSubtitleGenerating(true);
    setSubtitleNotice('正在按每个语言的真实口播时长生成字幕文案…');
    try {
      const next: Record<string, SubCue[]> = { ...alignedCuesByLang };
      const failed: string[] = [];
      for (const code of voiceLangs) {
        const text = voiceDrafts[code]?.trim();
        if (!text) {
          failed.push(LANGS.find(item => item.code === code)?.label || code);
          continue;
        }
        const audio = voiceoverAudios[code];
        const generated = audio?.cues?.length
          ? audio.cues
          : buildCues(text, audio?.duration || voiceoverDur || totalDur || duration);
        if (generated.length) next[code] = generated;
        else failed.push(LANGS.find(item => item.code === code)?.label || code);
      }
      setAlignedCuesByLang(next);
      setSubtitlesOn(true);
      setSubtitleNotice(failed.length
        ? `其余语言字幕已生成；${failed.join('、')}缺少可用文案，请先补全文案。`
        : `已生成 ${voiceLangs.length} 个语言的字幕文案，可直接逐条调整。`);
    } finally {
      setSubtitleGenerating(false);
    }
  };
	  useEffect(() => {
	    const audio = voiceoverAudios[activeVoiceLang];
	    if (!audio || voiceoverMode !== 'ai') return;
	    setVoiceoverUrl(audio.url);
	    setVoiceoverDur(audio.duration);
	  }, [activeVoiceLang, voiceoverAudios, voiceoverMode]);
  useEffect(() => {
    const el = ttsAudioRef.current;
    if (!el) return;
    const update = () => {
      setTtsCurrentTime(el.currentTime);
      if (!cues.length) return;
      const current = cues.findIndex(cue => el.currentTime >= cue.start && el.currentTime < cue.end);
      if (current >= 0) setSubPreviewIdx(current);
    };
    el.addEventListener('timeupdate', update);
    return () => el.removeEventListener('timeupdate', update);
  }, [cues]);
  const playTtsForLang = (code: string) => {
    const audio = voiceoverAudios[code];
    if (!audio?.url) return;
    setVoiceoverMode('ai');
    setActiveVoiceLang(code);
    setLang(code);
    setVoiceoverUrl(audio.url);
    setVoiceoverDur(audio.duration);
    const el = ttsAudioRef.current;
    if (!el) return;
    void playAudioWithAuthenticatedFallback(el, audio.url, ttsLanguageSettings[code]?.volume ?? voiceVol / 100)
      .then(() => setTtsPlaying(true))
      .catch((error: unknown) => {
        setTtsPlaying(false);
        const message = error instanceof Error ? error.message : String(error || '浏览器未能加载音频');
        setTtsNotice(`配音播放失败：${message}。请重新生成配音后再试。`);
      });
  };
  const switchVoicePreviewLanguage = (code: string) => {
    if (!code || code === activeVoiceLang) return;
    const audio = voiceoverAudios[code];
    const el = ttsAudioRef.current;
    if (el) {
      el.pause();
      el.currentTime = 0;
    }
    setTtsPlaying(false);
    setVoicePreviewIdx(null);
    setActiveVoiceLang(code);
    setLang(code);
    if (voiceoverMode === 'ai') {
      setVoiceoverUrl(audio?.url || null);
      setVoiceoverDur(audio?.duration || 0);
    }
    setSubPreviewIdx(0);
    setTtsNotice(audio?.url
      ? `已切换到${langZh(code)}试听。`
      : `${langZh(code)}还没有可试听配音，请先生成当前语言或生成全部语种。`);
  };
	  const toggleTts = () => {
	    const el = ttsAudioRef.current;
	    const currentVoiceUrl = activeVoiceoverUrl;
	    if (!el || !currentVoiceUrl) {
      setTtsNotice('暂时无法试听：当前语种还没有可用配音，请先生成或上传音频。');
      return;
    }
    if (ttsPlaying) {
      el.pause();
      setTtsPlaying(false);
      setTtsNotice('配音试听已暂停。');
      return;
    }
    void playAudioWithAuthenticatedFallback(el, currentVoiceUrl, voiceVol / 100).then(() => {
      setTtsPlaying(true);
      setTtsNotice('正在试听当前语种配音。');
    }).catch((error: unknown) => {
      setTtsPlaying(false);
      const message = error instanceof Error ? error.message : String(error || '浏览器未能加载音频');
      setTtsNotice(`配音播放失败：${message}。请重新生成配音后再试。`);
    });
  };
  const startVoiceAssemblyPreview = () => {
    const currentVoiceUrl = activeVoiceoverUrl;
    const currentVoiceDuration = activeVoiceDuration;
    if (!currentVoiceUrl || currentVoiceDuration <= 0) {
      setTtsNotice('暂时无法预览：当前音频时长为 0 秒，请重新上传或重新生成配音。');
      return;
    }
    if (!cues.length) {
      setTtsNotice('暂时无法预览：当前没有字幕，请先生成配音并完成字幕对齐。');
      return;
    }
    setPreviewNote(false);
    setSubtitlesOn(true);
    setVoicePreviewIdx(0);
    const el = ttsAudioRef.current;
    if (el) {
      // 必须在点击事件的用户手势中直接 play，不能等 React effect，否则浏览器会按自动播放拦截。
      void playAudioWithAuthenticatedFallback(el, currentVoiceUrl, voiceVol / 100).then(() => {
        setTtsPlaying(true);
        setTtsNotice('配音预览播放中。');
      }).catch((error: unknown) => {
        setVoicePreviewIdx(null);
        setTtsPlaying(false);
        const message = error instanceof Error ? error.message : String(error || '浏览器未能加载音频');
        setTtsNotice(`配音播放失败：${message}。请重新生成配音后再试。`);
      });
    }
  };
  const stopVoiceAssemblyPreview = () => {
    setVoicePreviewIdx(null);
    if (ttsAudioRef.current) ttsAudioRef.current.pause();
    setTtsPlaying(false);
  };
  const applyTtsPreset = (presetId: TtsStyleOptions['preset']) => {
    const preset = TTS_PRESETS.find(item => item.id === presetId) || TTS_PRESETS[1];
    setTtsPreset(preset.id);
    setTtsEmotion(preset.emotion);
    setTtsEmotionIntensity(preset.intensity);
    setTtsSpeed(preset.speed);
    setUseReferenceVoiceStyle(false);
    setVoiceoverUrl(null);
    setVoiceoverAudios({});
    setAlignedCuesByLang({});
    setTtsNotice('表达方式已调整，请重新生成配音。');
  };
  const toggleReferenceVoiceStyle = () => {
    const enabled = !useReferenceVoiceStyle;
    setUseReferenceVoiceStyle(enabled);
    setVoiceoverUrl(null);
    setVoiceoverAudios({});
    setAlignedCuesByLang({});
    setTtsNotice(enabled
      ? '生成试听配音时将自动沿用对标口播的情绪、信息密度和停顿节奏。'
      : '已关闭对标口播节奏，将使用当前手动配音参数。');
  };
  const patchAlignedCue = (index: number, patch: Partial<SubCue>) => {
    setAlignedCuesByLang(current => {
      const base = current[activeVoiceLang]?.length ? current[activeVoiceLang] : cues;
      const next = base.map((cue, cueIndex) => cueIndex === index ? { ...cue, ...patch, words: patch.text != null ? undefined : cue.words } : cue);
      return { ...current, [activeVoiceLang]: next };
    });
  };
  // 换音色 / 改脚本类型后，旧配音失效
  const pickVoice = (id: string) => { setVoice(id); setVoiceCandidates(current => current.includes(id) ? current : [...current, id]); setVoiceoverUrl(null); setVoiceoverAudios({}); setAlignedCuesByLang({}); setTtsNotice(''); setTtsPlaying(false); };
  // 离开脚本步时停止试听
  useEffect(() => {
    if (step !== 'script' && ttsAudioRef.current) { ttsAudioRef.current.pause(); setTtsPlaying(false); }
    if (step !== 'script') setVoicePreviewIdx(null);
  }, [step]);

  /* ── 草稿 / 作品 ─────────────────────────────────────────────────────── */
  const assembliesForSave = storyboardAssemblies.map(item => item.id === activeAssemblyId
    ? { ...item, name: assemblyName, assignments: storyboardAssignments, sourcePlans: storyboardSourcePlans, selected }
    : item);
  const materialSnapshotIds = new Set<string>([
    hookMaterialId,
    cover,
    ...selected,
    ...scriptRecommendedMaterialIds,
    ...Object.values(storyboardAssignments),
    ...assembliesForSave.flatMap(item => [
      ...(item.selected || []),
      ...Object.values(item.assignments || {}),
      ...Object.values(item.sourcePlans || {}).flatMap(plan => [plan.referenceClipId, plan.generatedClipId]),
    ]),
  ].filter((id): id is string => Boolean(id)));
  const kickoffSnapshot = kickoffClipSnapshot(videoKickoff);
  if (kickoffSnapshot) materialSnapshotIds.add(kickoffSnapshot.id);
  const materialSnapshots = [
    ...materials.filter(item => materialSnapshotIds.has(item.id)),
    ...(kickoffSnapshot && !materials.some(item => item.id === kickoffSnapshot.id) ? [kickoffSnapshot] : []),
  ].map(item => ({
    id: item.id,
    name: item.name,
    folder: item.folder,
    type: item.type,
    duration: item.duration,
    width: item.width,
    height: item.height,
    aspectRatio: item.aspectRatio,
    size: item.size,
    url: item.url,
    poster: item.poster,
    scope: item.scope,
    usage: item.usage,
    sourceType: item.sourceType || 'project-snapshot',
    assetRole: item.assetRole,
    avatarId: item.avatarId,
    avatarVersion: item.avatarVersion,
    industry: item.industry,
    shotFunction: item.shotFunction,
    applicability: item.applicability,
    tags: item.tags,
    segmentAnalysisStatus: item.segmentAnalysisStatus,
    segments: item.segments,
  }));
  const collectSpec = () => ({
    mode, contentMode, posterStyle, platform, ratio, duration, lang, provider,
    workflowRunId: projectWorkflowContext?.runId || '', workflowTaskId: projectWorkflowContext?.taskId || '', workflowTaskKey: projectWorkflowContext?.taskKey || '',
    activeStepId: step, activeStoryboardSlotId, canvasView, scriptStageTab,
    videoKickoff,
    productInfo, productSelectMode, selectedProductIds, audience, primaryCta, cooperationRoute, sellingPoints, tone,
    videoThemeId, themePainPoint, themeConversionGoal, lastGeneratedSetupSignature, presenterMode,
    selected, scriptRecommendedMaterialIds, storyboardAssignments, storyboardSourcePlans, shotDigitalHumanBindings, shotMediaModes, shotPreferredAvatarIds, assemblyName, hookMaterialId, materialSnapshots,
    storyboardAssemblies: assembliesForSave, activeAssemblyId, script, scriptType, modeScripts, activeModeScriptId, voice, voiceCandidates,
    bgm, bgmCandidates, platformBgms, assemblyBgms, materialVersionBgms, soundCandidatesPerContent, bgmVol, voiceVol, cover, coverTitle, coverStyle, capturedCoverFrameUrl, materialVersionCovers, account, caption,
    subtitlesOn, subMode, clipEdits, voiceoverMode, uploadedVoiceName, customVoiceId, customVoiceName, customVoiceUrl,
    ttsPreset, ttsEmotion, ttsEmotionIntensity, ttsSpeed, ttsPauseStyle, ttsPronunciationText, ttsLanguageSettings, voiceLangs, activeVoiceLang, voiceDrafts, voiceDraftStaleLangs, voiceDraftFailedLangs, voiceDraftDegradedLangs, voiceoverStaleLangs,
    voiceoverUrl, voiceoverDur, voiceoverAudios, languageRenderOutputs, languageRenderVersions, referenceVoiceStrength, useReferenceVoiceStyle, alignedCuesByLang,
    storyboardVideoVersions, productVideoVersions,
    variationStrategy, variationPeople, variationScenes, variationLanguages, variationHooks, variationMax,
    posterDraft, posterJsonText, posterImageUrl,
  });

  const applySpec = (s: Record<string, unknown>) => {
    setProjectWorkflowContext(studioWorkflowContextFromSpec(s));
    studioSpecEpochRef.current += 1;
    scriptTaskRequestRef.current += 1;
    productScriptAbortRef.current?.abort();
    productScriptAbortRef.current = null;
    voiceDraftAbortRef.current?.abort();
    voiceDraftAbortRef.current = null;
    ttsRequestRef.current += 1;
    setVoiceDraftPendingLangs([]);
    setVoiceDraftFailedLangs([]);
    setVoiceDraftDegradedLangs([]);
    setTtsActiveLangs([]);
    setTtsFailuresByLang({});
    setModeActionLoading(false);
    setModeActionStatus('');
    setScriptLoading(false);
    setMaterialSelectLoading(false);
    setPendingRealCloneGeneration(false);
    setStoryboardGenerating({});
    setStoryboardQualityChecking({});
    setVoiceoverStaleLangs(Array.isArray(s.voiceoverStaleLangs) ? s.voiceoverStaleLangs as string[] : []);
    const restoredVoiceDrafts = s.voiceDrafts && typeof s.voiceDrafts === 'object'
      ? s.voiceDrafts as Record<string, string>
      : {};
    const restoredVoiceoverAudios = s.voiceoverAudios && typeof s.voiceoverAudios === 'object'
      ? s.voiceoverAudios as typeof voiceoverAudios
      : {};
    const restoredAlignedCues = s.alignedCuesByLang && typeof s.alignedCuesByLang === 'object'
      ? s.alignedCuesByLang as Record<string, SubCue[]>
      : {};
    const savedVoiceLangs = Array.isArray(s.voiceLangs)
      ? s.voiceLangs.filter((code): code is string => typeof code === 'string' && Boolean(code.trim()))
      : [];
    const savedOutputLang = typeof s.lang === 'string' && LANGS.some(item => item.code === s.lang)
      ? s.lang
      : '';
    // Once a draft has an explicit language selection, that list is the
    // user's source of truth. Do not resurrect a removed language merely
    // because an older translation/audio record is still present.
    const restoredLanguageCandidates = savedVoiceLangs.length
      ? [...new Set(savedVoiceLangs)]
      : [...new Set([
        ...Object.keys(restoredVoiceDrafts),
        ...Object.keys(restoredVoiceoverAudios),
        ...Object.keys(restoredAlignedCues),
      ])];
    const restoredScriptSourceLanguage = typeof s.script === 'string' && s.script.trim()
      ? detectScriptLanguageCode(extractVoiceoverText(s.script) || s.script)
      : '';
    const restoredVoiceLangs = restoredLanguageCandidates.length || savedOutputLang || restoredScriptSourceLanguage
      ? orderedVoiceLanguages(restoredScriptSourceLanguage, restoredLanguageCandidates, savedOutputLang)
      : [enterpriseVoiceLangs.includes('en') ? 'en' : enterpriseVoiceLangs[0] || 'zh'];
    const nextVoiceDrafts = restoredVoiceDrafts;
    const nextVoiceoverAudios = restoredVoiceoverAudios;
    const nextAlignedCues = restoredAlignedCues;
    const savedActiveVoiceLang = typeof s.activeVoiceLang === 'string' ? s.activeVoiceLang : '';
    const restoredActiveVoiceLang = restoredVoiceLangs.includes(savedActiveVoiceLang)
      ? savedActiveVoiceLang
      : savedOutputLang
        || restoredVoiceLangs.find(code => Boolean(nextVoiceoverAudios[code]?.url))
        || restoredVoiceLangs[0]
        || '';

    setVoiceLangs(restoredVoiceLangs);
    if (restoredActiveVoiceLang) {
      setActiveVoiceLang(restoredActiveVoiceLang);
      setLang(savedOutputLang || restoredActiveVoiceLang);
    }
    setVoiceDrafts(nextVoiceDrafts);
    setVoiceoverAudios(nextVoiceoverAudios);
    setAlignedCuesByLang(nextAlignedCues);
    const restoredActiveAudio = restoredActiveVoiceLang ? nextVoiceoverAudios[restoredActiveVoiceLang] : undefined;
    const restoredVoiceoverUrl = restoredActiveAudio?.url || (typeof s.voiceoverUrl === 'string' ? s.voiceoverUrl : null);
    const restoredVoiceoverDur = restoredActiveAudio?.duration || (typeof s.voiceoverDur === 'number' ? s.voiceoverDur : 0);
    setVoiceoverUrl(restoredVoiceoverUrl);
    setVoiceoverDur(restoredVoiceoverDur);
    setVoiceDraftNotice('');
    setTtsNotice('');
    setVoiceDraftLoading(false);
    setTtsLoading(false);
    setTtsLoadingScope(null);
    const restoredVideoKickoff = s.videoKickoff && typeof s.videoKickoff === 'object'
      ? s.videoKickoff as VideoKickoff
      : null;
    const restoredMaterialSnapshots = [
      ...(Array.isArray(s.materialSnapshots) ? s.materialSnapshots.map(normalizeClipSnapshot).filter((item): item is Clip => Boolean(item)) : []),
      kickoffClipSnapshot(restoredVideoKickoff),
    ].filter((item): item is Clip => Boolean(item));
    if (restoredMaterialSnapshots.length) {
      setMaterials(current => mergeClipLists(current, restoredMaterialSnapshots));
    }
    const restoredMode = s.mode === 'material' || s.mode === 'clone' || s.mode === 'product'
      ? s.mode
      : restoredVideoKickoff ? 'clone' : 'material';
    setMode(restoredMode);
    if (restoredVideoKickoff) setVideoKickoff(restoredVideoKickoff);
    const restoredContentMode = s.contentMode === 'poster' ? 'poster' : 'video';
    setContentMode(restoredContentMode);
    const restoredSteps = restoredContentMode === 'poster' ? POSTER_STEPS : STEPS;
    const restoredStepId = typeof s.activeStepId === 'string' ? s.activeStepId as StepId : null;
    const restoredLegacyBgmStep = restoredContentMode === 'video' && restoredStepId === 'bgm';
    const restoredStepIndex = restoredLegacyBgmStep ? restoredSteps.findIndex(item => item.id === 'script') : restoredStepId ? restoredSteps.findIndex(item => item.id === restoredStepId) : -1;
    setStepIdx(restoredStepIndex >= 0 ? restoredStepIndex : 0);
    setActiveStoryboardSlotId(typeof s.activeStoryboardSlotId === 'string' ? s.activeStoryboardSlotId : '');
    setCanvasView(s.canvasView === 'reference' ? 'reference' : 'creation');
    setScriptStageTab(restoredLegacyBgmStep || s.scriptStageTab === 'bgm' ? 'bgm' : s.scriptStageTab === 'voiceover' || s.scriptStageTab === 'audio' || s.scriptStageTab === 'subtitle' ? s.scriptStageTab : 'theme');
    setLastGeneratedSetupSignature(typeof s.lastGeneratedSetupSignature === 'string' ? s.lastGeneratedSetupSignature : '');
    if (typeof s.posterStyle === 'string' && POSTER_STYLES.some(item => item.id === s.posterStyle)) {
      setPosterStyle(s.posterStyle as typeof posterStyle);
    }
    if (s.platform) setPlatform(s.platform as string);
    if (s.ratio) setRatio(s.ratio as string);
    if (typeof s.duration === 'number') setDuration(s.duration);
    // 语言由企业中心统一提供；旧草稿中的历史语言配置不得覆盖企业设置。
    setProvider('qwen');
    if (typeof s.productInfo === 'string') setProductInfo(s.productInfo);
    if (s.productSelectMode === 'single' || s.productSelectMode === 'multi') setProductSelectMode('multi');
    if (Array.isArray(s.selectedProductIds)) setSelectedProductIds(s.selectedProductIds as string[]);
    if (typeof s.audience === 'string') setAudience(s.audience);
    if (typeof s.primaryCta === 'string') setPrimaryCta(s.primaryCta);
    if (typeof s.cooperationRoute === 'string') setCooperationRoute(s.cooperationRoute);
    if (typeof s.sellingPoints === 'string') setSellingPoints(s.sellingPoints);
    if (typeof s.tone === 'string') setTone(s.tone);
    if (typeof s.videoThemeId === 'string' && VIDEO_THEMES.some(item => item.id === s.videoThemeId)) {
      setVideoThemeId(s.videoThemeId as VideoThemeId);
    } else if (s.videoThemeId === 'talking_head') {
      // 兼容旧草稿：真人口播不再是内容主题，迁移为默认主题与真人出镜。
      setVideoThemeId('buyer_pain');
      setPresenterMode('real');
    }
    if (s.presenterMode === 'real' || s.presenterMode === 'digital') setPresenterMode(s.presenterMode);
    if (typeof s.themePainPoint === 'string') setThemePainPoint(s.themePainPoint);
    setThemeConversionGoal(typeof s.themeConversionGoal === 'string' && s.themeConversionGoal.trim()
      ? s.themeConversionGoal
      : DEFAULT_VIDEO_CONVERSION_GOAL);
    if (s.variationStrategy === 'remix' || s.variationStrategy === 'recreate' || s.variationStrategy === 'hybrid') setVariationStrategy(s.variationStrategy);
    if (typeof s.hookMaterialId === 'string') setHookMaterialId(s.hookMaterialId);
    setSelected(Array.isArray(s.selected) ? s.selected as string[] : []);
    setScriptRecommendedMaterialIds(Array.isArray(s.scriptRecommendedMaterialIds) ? s.scriptRecommendedMaterialIds as string[] : []);
    setStoryboardAssignments(s.storyboardAssignments && typeof s.storyboardAssignments === 'object' ? s.storyboardAssignments as Record<string, string> : {});
    setStoryboardSourcePlans(s.storyboardSourcePlans && typeof s.storyboardSourcePlans === 'object' ? s.storyboardSourcePlans as Record<string, StoryboardSourcePlan> : {});
    setShotDigitalHumanBindings(s.shotDigitalHumanBindings && typeof s.shotDigitalHumanBindings === 'object' ? s.shotDigitalHumanBindings as Record<string, ShotDigitalHumanBinding> : {});
    setShotMediaModes(s.shotMediaModes && typeof s.shotMediaModes === 'object' ? s.shotMediaModes as Record<string, 'material' | 'digital'> : {});
    setShotPreferredAvatarIds(s.shotPreferredAvatarIds && typeof s.shotPreferredAvatarIds === 'object' ? s.shotPreferredAvatarIds as Record<string, string> : {});
    if (typeof s.assemblyName === 'string') setAssemblyName(s.assemblyName);
    if (Array.isArray(s.storyboardAssemblies) && s.storyboardAssemblies.length) {
      const restored = s.storyboardAssemblies as StoryboardAssembly[];
      const restoredActiveId = typeof s.activeAssemblyId === 'string' && restored.some(item => item.id === s.activeAssemblyId)
        ? s.activeAssemblyId
        : restored[0].id;
      const restoredActive = restored.find(item => item.id === restoredActiveId) || restored[0];
      setStoryboardAssemblies(restored);
      setActiveAssemblyId(restoredActiveId);
      setAssemblyName(restoredActive.name);
      setStoryboardAssignments(restoredActive.assignments || {});
      setStoryboardSourcePlans(restoredActive.sourcePlans || {});
      setSelected(restoredActive.selected || []);
    } else {
      const legacyName = typeof s.assemblyName === 'string' ? s.assemblyName : '视频1';
      setStoryboardAssemblies([{
        id: 'video-1', name: legacyName,
        assignments: s.storyboardAssignments as Record<string, string> || {},
        sourcePlans: s.storyboardSourcePlans as Record<string, StoryboardSourcePlan> || {},
        selected: Array.isArray(s.selected) ? s.selected as string[] : [],
      }]);
      setActiveAssemblyId('video-1');
    }
    if (typeof s.script === 'string') {
      masterScriptSnapshot.current = s.script;
      setScript(s.script);
    }
    if (s.scriptType) setScriptType(s.scriptType as typeof scriptType);
    if (Array.isArray(s.modeScripts)) setModeScripts(s.modeScripts as ModeScriptOutput[]);
    if (typeof s.activeModeScriptId === 'string') setActiveModeScriptId(s.activeModeScriptId);
    if (s.voice) setVoice(s.voice as string);
    if (Array.isArray(s.voiceCandidates)) setVoiceCandidates(s.voiceCandidates as string[]);
    if (s.voiceoverMode === 'unselected' || s.voiceoverMode === 'none' || s.voiceoverMode === 'ai' || s.voiceoverMode === 'upload') setVoiceoverMode(s.voiceoverMode);
    if (typeof s.uploadedVoiceName === 'string') setUploadedVoiceName(s.uploadedVoiceName);
    if (typeof s.customVoiceId === 'string') setCustomVoiceId(s.customVoiceId);
    if (typeof s.customVoiceName === 'string') setCustomVoiceName(s.customVoiceName);
    if (typeof s.customVoiceUrl === 'string') setCustomVoiceUrl(s.customVoiceUrl);
    if (s.ttsLanguageSettings && typeof s.ttsLanguageSettings === 'object') setTtsLanguageSettings(s.ttsLanguageSettings as Record<string, LanguageTtsSettings>);
    setVoiceDraftStaleLangs(Array.isArray(s.voiceDraftStaleLangs) ? s.voiceDraftStaleLangs as string[] : []);
    setVoiceDraftFailedLangs(Array.isArray(s.voiceDraftFailedLangs) ? s.voiceDraftFailedLangs as string[] : []);
    setVoiceDraftDegradedLangs(Array.isArray(s.voiceDraftDegradedLangs) ? s.voiceDraftDegradedLangs as string[] : []);
    setLanguageRenderOutputs(s.languageRenderOutputs && typeof s.languageRenderOutputs === 'object' ? s.languageRenderOutputs as typeof languageRenderOutputs : {});
    setLanguageRenderVersions(s.languageRenderVersions && typeof s.languageRenderVersions === 'object' ? s.languageRenderVersions as typeof languageRenderVersions : {});
    if (s.storyboardVideoVersions && typeof s.storyboardVideoVersions === 'object') setStoryboardVideoVersions(s.storyboardVideoVersions as typeof storyboardVideoVersions);
    if (Array.isArray(s.productVideoVersions)) setProductVideoVersions(s.productVideoVersions as VideoGenerationVersion[]);
    if (typeof s.ttsPreset === 'string' && TTS_PRESETS.some(item => item.id === s.ttsPreset)) setTtsPreset(s.ttsPreset as TtsStyleOptions['preset']);
    if (typeof s.ttsEmotion === 'string') setTtsEmotion(s.ttsEmotion);
    if (typeof s.ttsEmotionIntensity === 'number') setTtsEmotionIntensity(s.ttsEmotionIntensity);
    if (typeof s.ttsSpeed === 'number') setTtsSpeed(s.ttsSpeed);
    if (s.ttsPauseStyle === 'few' || s.ttsPauseStyle === 'natural' || s.ttsPauseStyle === 'dramatic') setTtsPauseStyle(s.ttsPauseStyle);
    if (typeof s.ttsPronunciationText === 'string') setTtsPronunciationText(s.ttsPronunciationText);
    if (s.referenceVoiceStrength === 'light' || s.referenceVoiceStrength === 'balanced' || s.referenceVoiceStrength === 'strong') setReferenceVoiceStrength(s.referenceVoiceStrength);
    if (typeof s.useReferenceVoiceStyle === 'boolean') setUseReferenceVoiceStyle(s.useReferenceVoiceStyle);
    if (s.bgm) setBgm(s.bgm as string);
    if (Array.isArray(s.bgmCandidates)) setBgmCandidates(s.bgmCandidates as string[]);
    if (s.platformBgms && typeof s.platformBgms === 'object') setPlatformBgms(s.platformBgms as Record<string, string>);
    if (s.assemblyBgms && typeof s.assemblyBgms === 'object') setAssemblyBgms(s.assemblyBgms as Record<string, string>);
    if (s.materialVersionBgms && typeof s.materialVersionBgms === 'object') setMaterialVersionBgms(s.materialVersionBgms as Record<string, string>);
    if (s.soundCandidatesPerContent === 1 || s.soundCandidatesPerContent === 2) setSoundCandidatesPerContent(s.soundCandidatesPerContent);
    if (typeof s.bgmVol === 'number') setBgmVol(s.bgmVol);
    if (typeof s.voiceVol === 'number') setVoiceVol(s.voiceVol);
    if (s.cover && s.cover !== 'gradient') setCover(s.cover as string);
    if (typeof s.coverTitle === 'string') setCoverTitle(s.coverTitle);
    if (s.coverStyle) setCoverStyle(s.coverStyle as CoverStyle);
    setCapturedCoverFrameUrl(typeof s.capturedCoverFrameUrl === 'string' ? s.capturedCoverFrameUrl : '');
    if (s.materialVersionCovers && typeof s.materialVersionCovers === 'object') setMaterialVersionCovers(s.materialVersionCovers as Record<string, CoverVersionConfig>);
    if (s.account !== undefined) setAccount(s.account as string | null);
    if (typeof s.caption === 'string') setCaption(s.caption);
    if (s.posterDraft && typeof s.posterDraft === 'object') setPosterDraft(s.posterDraft as FbPosterResult);
    if (typeof s.posterJsonText === 'string') setPosterJsonText(s.posterJsonText);
    if (typeof s.posterImageUrl === 'string') setPosterImageUrl(s.posterImageUrl);
    if (typeof s.subtitlesOn === 'boolean') setSubtitlesOn(s.subtitlesOn);
    if (s.subMode === 'target' || s.subMode === 'bilingual') setSubMode(s.subMode);
    if (s.clipEdits && typeof s.clipEdits === 'object') setClipEdits(s.clipEdits as Record<string, ClipEdit>);
    if (typeof s.variationPeople === 'string') setVariationPeople(s.variationPeople);
    if (typeof s.variationScenes === 'string') setVariationScenes(s.variationScenes);
    if (typeof s.variationLanguages === 'string') setVariationLanguages(s.variationLanguages);
    if (typeof s.variationHooks === 'string') setVariationHooks(s.variationHooks);
    if (typeof s.variationMax === 'number') setVariationMax(s.variationMax);
  };

  const rememberCanvaCoverReturn = (nextCoverUrl: string | null = coverUrl) => {
    try {
      const payload: CanvaCoverReturnState = {
        at: Date.now(),
        stepId: 'cover',
        projectId,
        projectTitle,
        coverUrl: nextCoverUrl,
        spec: collectSpec(),
      };
      localStorage.setItem(CANVA_COVER_RETURN_KEY, JSON.stringify(payload));
    } catch {
      // Some embedded browsers can block storage; the new window still keeps the current page alive.
    }
  };

  useEffect(() => {
    let raw = '';
    try {
      raw = localStorage.getItem(CANVA_COVER_RETURN_KEY) || '';
      if (raw) localStorage.removeItem(CANVA_COVER_RETURN_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as CanvaCoverReturnState;
      if (!saved?.at || Date.now() - saved.at > CANVA_COVER_RETURN_TTL) return;
      if (saved.spec && typeof saved.spec === 'object') applySpec(saved.spec);
      setProjectId(saved.projectId ?? null);
      if (saved.projectTitle) setProjectTitle(saved.projectTitle);
      if (saved.coverUrl) setCoverUrl(saved.coverUrl);
      setStepIdx(STEPS.findIndex(s => s.id === saved.stepId) >= 0 ? STEPS.findIndex(s => s.id === saved.stepId) : COVER_STEP_INDEX);
      autoGen.current = true;
    } catch {
      // Ignore malformed return payloads from older local builds.
    }
  }, []);

  const saveProject = async (
    status: 'draft' | 'ready_for_approval' | 'published' | 'template' = 'draft',
    options: { silent?: boolean } = {},
  ) => {
    const silent = options.silent === true;
    if (silent && (sourceDraftCheckPending || existingSourceDraftPrompt)) return;
    if (silent && workflowProjectSelectionPending) return;
    if (silent && (
      modeActionLoading || scriptLoading || materialSelectLoading || coverLoading
      || rendering || batchRenderingLangs || posterLoading || captionLoading
    )) return;
    if (voiceDraftLoading || ttsLoading) {
      if (!silent) alert('多语字幕或配音仍在生成，请等待完成后再保存草稿。');
      return;
    }
    const nextSpec = collectSpec();
    if (silent && !projectId && !studioSpecHasMeaningfulContent(nextSpec)) return;
    if (silent && autosaveInFlightRef.current) return;
    if (silent) {
      autosaveInFlightRef.current = true;
      setAutosaveStatus('saving');
    }
    else setSavingProj(true);
    try {
      const { project } = await studioApi.saveProject({
        id: status === 'template' ? undefined : projectId ?? undefined,
        title: projectTitle.trim() || '未命名草稿',
        status,
        spec: nextSpec,
        thumbSeed: cover,
      });
      if (project?.id && status !== 'template') {
        setProjectId(project.id);
        setProjects(current => [project, ...current.filter(item => item.id !== project.id)]);
        // The server may protect a newer reviewed/API voice draft from an old
        // browser autosave. Reflect that language-local merge immediately so
        // the next autosave cannot keep submitting the obsolete snapshot.
        if (Object.prototype.hasOwnProperty.call(project.spec || {}, 'voiceDrafts')) {
          const persistedDrafts = project.spec.voiceDrafts && typeof project.spec.voiceDrafts === 'object'
            ? project.spec.voiceDrafts as Record<string, string>
            : {};
          setVoiceDrafts(persistedDrafts);
          setVoiceDraftStaleLangs(Array.isArray(project.spec.voiceDraftStaleLangs) ? project.spec.voiceDraftStaleLangs as string[] : []);
          setVoiceDraftFailedLangs(Array.isArray(project.spec.voiceDraftFailedLangs) ? project.spec.voiceDraftFailedLangs as string[] : []);
          setVoiceDraftDegradedLangs(Array.isArray(project.spec.voiceDraftDegradedLangs) ? project.spec.voiceDraftDegradedLangs as string[] : []);
        }
        try { sessionStorage.setItem(STUDIO_ACTIVE_PROJECT_KEY, JSON.stringify({ at: Date.now(), projectId: project.id })); } catch { /* ignore */ }
      }
      if (!silent) {
        completeDemoStep('traffic');
        setSavedTick(true);
        setTimeout(() => setSavedTick(false), 1800);
      } else {
        setAutosaveStatus('saved');
        setLastAutosavedAt(new Date());
      }
    } catch (error) {
      if (!silent) throw error;
      setAutosaveStatus('error');
      console.warn('[AiCreateStudio] autosave failed', error);
    } finally {
      if (silent) autosaveInFlightRef.current = false;
      else setSavingProj(false);
    }
  };

  autosaveSnapshotRef.current = () => saveProject('draft', { silent: true });

  useEffect(() => {
    const timer = window.setInterval(() => {
      void autosaveSnapshotRef.current();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const openProjects = async () => {
    setShowProjects(true);
    const [nextProjects, nextBatches] = await Promise.all([studioApi.listProjects(), studioApi.listVariationBatches()]);
    if (workflowContext?.taskKey === 'content_production') {
      const entry = resolveStudioWorkflowProjectEntry(nextProjects, workflowContext);
      setProjects(entry.projects);
      setVariationBatches([]);
      if (entry.project) {
        setWorkflowProjectSelectionPending(false);
        loadProject(entry.project);
        setModeNotice(`已打开当前任务的内容项目“${entry.project.title}”。`);
      } else {
        setWorkflowProjectSelectionPending(true);
        setModeNotice(entry.projects.length
          ? `当前任务共有 ${entry.projects.length} 个内容项目，请选择要查看的项目。`
          : '当前任务尚未创建可用的内容项目。');
      }
      return;
    }
    setProjects(nextProjects); setVariationBatches(nextBatches);
  };
  useEffect(() => {
    if (!openProjectsSignal || openProjectsSignal <= handledOpenProjectsSignalRef.current) return;
    handledOpenProjectsSignalRef.current = openProjectsSignal;
    window.dispatchEvent(new CustomEvent('lingshu:content-view-changed', { detail: { entry: 'works' } }));
    void openProjects();
  }, [openProjectsSignal]);
  const reviewVariationItem = async (batchId: string, itemId: string, status: 'approved' | 'rejected') => {
    await studioApi.updateVariationItem(batchId, itemId, { status });
    setVariationBatches(await studioApi.listVariationBatches());
  };
  const reuseVariationBatch = async (batch: VariationBatch) => {
    const inferredDimensions = ['product', 'person', 'scene', 'language', 'hook'].reduce<Record<string, string[]>>((result, key) => {
      result[key] = [...new Set(batch.items.map(item => item.variables[key]).filter(Boolean))];
      return result;
    }, {});
    const dimensions = batch.plan?.dimensions || inferredDimensions;
    const nextStrategy = ['remix', 'recreate', 'hybrid'].includes(String(batch.plan?.strategy)) ? batch.plan!.strategy as VariationStrategy : 'hybrid';
    const nextPlatform = String(batch.plan?.platform || platform);
    const nextRatio = String(batch.plan?.ratio || ratio);
    const nextDuration = Math.max(1, Number(batch.plan?.duration) || Math.round(batch.estimatedCostCny / Math.max(1, batch.items.length) / 1.5) || duration);
    const nextMax = Math.max(1, Number(batch.plan?.maxItems) || batch.items.length || 20);
    const nextProductIds = (dimensions.product || []).filter(id => productOptions.some(option => option.id === id));
    const nextTitle = `${batch.title.replace(/\s*·\s*复用\s*\d*$/, '')} · 复用`;
    const cleanSpec: Record<string, unknown> = {
      mode: 'clone', contentMode: 'video', platform: nextPlatform, ratio: nextRatio, duration: nextDuration,
      productInfo: batch.plan?.productInfo || '', productSelectMode: batch.plan?.productSelectMode || 'single',
      audience: batch.plan?.audience || '', sellingPoints: batch.plan?.sellingPoints || '', tone: batch.plan?.tone || '高转化 · 口语化',
      lang: batch.plan?.language || 'zh', provider: 'qwen',
      variationStrategy: nextStrategy,
      variationPeople: (dimensions.person || ['原人物']).join('，'),
      variationScenes: (dimensions.scene || ['原场景']).join('，'),
      variationLanguages: (dimensions.language || ['中文']).join('，'),
      variationHooks: (dimensions.hook || ['原钩子']).join('，'),
      variationMax: nextMax, selectedProductIds: nextProductIds,
      script: '', selected: [], scriptRecommendedMaterialIds: [], storyboardAssignments: {}, storyboardSourcePlans: {},
      voiceDrafts: {}, voiceoverAudios: {}, alignedCuesByLang: {}, languageRenderOutputs: {}, clipEdits: {},
      bgm: '', cover: '', coverTitle: '', caption: '', posterJsonText: '', posterImageUrl: '',
    };
    const saved = await studioApi.saveProject({ title: nextTitle, status: 'draft', spec: cleanSpec });
    if (!saved.ok || !saved.project) return;
    applySpec(cleanSpec);
    setScript(''); setVoiceoverLines(''); setVoiceDrafts({}); setModeScripts([]); setActiveModeScriptId('');
    setSelected([]); setScriptRecommendedMaterialIds([]); setStoryboardAssignments({}); setStoryboardSourcePlans({});
    setVoiceoverUrl(null); setVoiceoverAudios({}); setAlignedCuesByLang({}); setLanguageRenderOutputs({});
    setBgm(''); setCover(''); setCoverUrl(null); setCapturedCoverFrameUrl(''); setCoverTimelineCaptureMode(false); setCaption(''); setClipEdits({}); setRendered(false); setPreviewIdx(null);
    setPosterDraft(null); setPosterJsonText(''); setPosterImageUrl('');
    setProjectId(saved.project.id); setProjectTitle(nextTitle); setProjects(current => [saved.project, ...current.filter(item => item.id !== saved.project.id)]);
    setStepIdx(0); setShowProjects(false); setSavedTick(true); window.setTimeout(() => setSavedTick(false), 1800);
  };

  const loadProject = (p: StudioProject) => {
    applySpec(p.status === 'template' ? withoutStudioWorkflowContext(p.spec) : p.spec);
    setWorkflowProjectSelectionPending(false);
    setProjectId(p.status === 'template' ? null : p.id);
    setProjectTitle(p.status === 'template' ? `${p.title} · 副本` : p.title);
    autoGen.current = true; // 载入已有脚本，别再自动覆盖
    setShowProjects(false);
    setPublished(false);
    if (p.status !== 'template') {
      try { sessionStorage.setItem(STUDIO_ACTIVE_PROJECT_KEY, JSON.stringify({ at: Date.now(), projectId: p.id })); } catch { /* ignore */ }
    }
  };

  useEffect(() => {
    if (workflowContext) {
      try { localStorage.removeItem(STUDIO_OPEN_PROJECT_KEY); } catch { /* ignore */ }
      return;
    }
    let raw = '';
    try {
      raw = localStorage.getItem(STUDIO_OPEN_PROJECT_KEY) || sessionStorage.getItem(STUDIO_ACTIVE_PROJECT_KEY) || '';
      if (localStorage.getItem(STUDIO_OPEN_PROJECT_KEY)) localStorage.removeItem(STUDIO_OPEN_PROJECT_KEY);
    } catch { return; }
    if (!raw) return;
    try {
      const state = JSON.parse(raw) as { at?: number; projectId?: string };
      if (!state.at || Date.now() - state.at > 10 * 60 * 1000 || !state.projectId) return;
      void studioApi.listProjects().then(list => {
        setProjects(list);
        const project = list.find(item => item.id === state.projectId && item.status === 'draft');
        if (!project) {
          setModeNotice('未找到该历史创作草稿。');
          return;
        }
        applySpec(project.spec);
        setProjectId(project.id);
        setProjectTitle(project.title);
        try { sessionStorage.setItem(STUDIO_ACTIVE_PROJECT_KEY, JSON.stringify({ at: Date.now(), projectId: project.id })); } catch { /* ignore */ }
        autoGen.current = true;
        setShowProjects(false);
        setPublished(false);
        setModeNotice(`已恢复历史创作草稿“${project.title}”。`);
      }).catch(() => setModeNotice('历史创作草稿读取失败，请稍后重试。'));
    } catch {
      // Ignore malformed navigation payloads from older local builds.
    }
  }, [workflowContext?.runId, workflowContext?.taskId]);

  const reuseProject = async (p: StudioProject) => {
    if (voiceDraftLoading || ttsLoading || savingProj) return;
    setSavingProj(true);
    try {
      const baseTitle = p.title.replace(/\s*·\s*复用\s*\d*$/, '').trim() || '历史作品集';
      const nextTitle = `${baseTitle} · 复用`;
      const clonedSpec = withoutStudioWorkflowContext(
        JSON.parse(JSON.stringify(p.spec || {})) as Record<string, unknown>,
      );
      const saved = await studioApi.saveProject({
        title: nextTitle,
        status: 'draft',
        spec: clonedSpec,
        thumbSeed: p.thumbSeed,
      });
      if (!saved.ok || !saved.project) throw new Error('复用失败，请稍后重试。');
      applySpec(saved.project.spec);
      setProjectId(saved.project.id);
      setProjectTitle(saved.project.title);
      setProjects(current => [saved.project, ...current.filter(item => item.id !== saved.project.id)]);
      autoGen.current = true;
      setStepIdx(0);
      setShowProjects(false);
      setPublished(false);
      setSavedTick(true);
      window.setTimeout(() => setSavedTick(false), 1800);
    } catch (err: any) {
      alert(err?.message || '复用失败，请稍后重试。');
    } finally {
      setSavingProj(false);
    }
  };

  useEffect(() => {
    let raw = '';
    try {
      raw = localStorage.getItem(PUBLISH_RETURN_PREVIEW_KEY) || '';
      if (raw) localStorage.removeItem(PUBLISH_RETURN_PREVIEW_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    const goPreviewStep = () => {
      const previewIndex = STEPS.findIndex(item => item.id === 'preview');
      setContentMode('video');
      setShowProjects(false);
      setPublished(false);
      setPreviewIdx(null);
      window.setTimeout(() => setStepIdx(previewIndex >= 0 ? previewIndex : Math.max(0, STEPS.length - 1)), 0);
    };
    try {
      const state = JSON.parse(raw) as { at?: number; projectId?: string };
      if (!state?.at || Date.now() - state.at > PUBLISH_RETURN_PREVIEW_TTL) return;
      const targetProjectId = String(state.projectId || '').trim();
      if (!targetProjectId) {
        goPreviewStep();
        return;
      }
      void studioApi.listProjects().then(list => {
        setProjects(list);
        const project = list.find(item => item.id === targetProjectId);
        if (project) {
          applySpec(project.spec);
          setProjectId(project.status === 'template' ? null : project.id);
          setProjectTitle(project.status === 'template' ? `${project.title} · 副本` : project.title);
        }
        goPreviewStep();
        setModeNotice(project ? '已从发布设置返回素材成片预览。' : '未找到来源项目，已返回当前素材成片预览。');
      }).catch(() => {
        goPreviewStep();
        setModeNotice('项目列表读取失败，已返回当前素材成片预览。');
      });
    } catch {
      goPreviewStep();
    }
  }, []);

  const removeProject = async (id: string) => {
    await studioApi.deleteProject(id);
    setProjects(await studioApi.listProjects());
    if (projectId === id) {
      setProjectId(null);
      setProjectWorkflowContext(null);
      try { sessionStorage.removeItem(STUDIO_ACTIVE_PROJECT_KEY); } catch { /* ignore */ }
    }
  };

  /* ── 渲染各步骤操作区 ─────────────────────────────────────────────── */
  const renderStep = () => {
    switch (step) {
      /* ① 选模式 */
      case 'mode':
        const visibleModes = contentMode === 'poster' ? POSTER_MODES : MODES;
        return (
          <div className="w-full min-w-0 overflow-x-hidden">
            <input ref={fileInputRef} type="file" multiple accept="video/*,image/*" className="hidden" onChange={event => { void handleUpload(event.target.files); event.target.value = ''; }} />
            <div className="mb-4">
              <p className="mb-2 text-[10px] font-black uppercase tracking-[0.12em] text-text-muted">内容类型</p>
              <div className="grid grid-cols-2 rounded-lg bg-surface-2 p-1">
                {([
                  ['video', '视频模式'],
                  ['poster', '图文模式'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      if (value !== contentMode) {
                        setStepIdx(0);
                        setModeNotice('已切换内容模式，产品、主题、目标客户和合作路线均已保留。');
                      }
                      setContentMode(value);
                      if (value === 'poster') {
                        setPlatform('facebook');
                        setRatio(ratio === '9:16' ? '1:1' : ratio);
                      } else if (contentMode === 'poster') {
                        setPlatform('tiktok');
                        setRatio('9:16');
                      }
                    }}
                    className={`rounded-md px-3 py-2 text-[11px] font-bold transition ${contentMode === value ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-text-muted">创作方式</p>
            <div className="mb-5 mt-2 divide-y divide-border/70 border-y border-border/70">
              {visibleModes.map(m => {
                const on = mode === m.id;
                return (
                  <button key={m.id} onClick={() => {
                    if (m.id !== mode) {
                      setScriptStageTab('theme');
                      setVoiceoverMode('unselected');
                      setScript('');
                      setVoiceoverLines('');
                      setVoiceDrafts({});
                      setVoiceoverAudios({});
                      setAlignedCuesByLang({});
                      setVoiceoverUrl(null);
                      setVoiceoverDur(0);
                      setModeNotice('');
                    }
                    setMode(m.id);
                  }}
                    className={`min-h-[62px] w-full min-w-0 overflow-hidden px-1 py-2.5 text-left transition ${on ? 'bg-emerald-50/60' : 'hover:bg-surface-2/70'}`}>
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ background: on ? TRAFFIC_GREEN : 'var(--color-surface-2)', color: on ? '#fff' : 'var(--color-text-muted)' }}>
                        <m.icon size={14} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-text-primary">{m.title}</p>
                        <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-text-muted">{m.desc}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="mb-2 text-[10px] font-black uppercase tracking-[0.12em] text-text-muted">内容信息</p>
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1">
                  <span className="mb-1.5 block text-xs font-semibold text-text-secondary">产品信息（多选）</span>
                  <div ref={productSelectorRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setProductSelectorOpen(value => !value)}
                      className="flex h-9 w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 text-left text-xs font-semibold text-text-primary transition hover:border-accent/50"
                    >
                      <span className="truncate">
                        {productOptions.length === 0
                          ? '暂无可选产品'
                          : selectedProductIds.length === 0
                            ? '请选择产品'
                            : `已选 ${selectedProductIds.length} 个产品`}
                      </span>
                      <ChevronDown size={15} className={`shrink-0 text-text-muted transition ${productSelectorOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {productSelectorOpen && (
                    <div className="mt-2 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
                      <div className="space-y-2 border-b border-border bg-surface p-2.5">
                        <div className="relative">
                          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                          <input
                            value={productSearch}
                            onChange={event => setProductSearch(event.target.value)}
                            placeholder="搜索产品名、SKU 或卖点"
                            className="h-9 w-full rounded-lg border border-border bg-white pl-8 pr-3 text-xs font-semibold text-text-primary outline-none focus:border-accent"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={productCategoryFilter}
                            onChange={event => setProductCategoryFilter(event.target.value)}
                            className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-white px-2 text-[11px] font-bold text-text-secondary outline-none focus:border-accent"
                          >
                            <option value="">全部类目</option>
                            {productCategories.map(category => <option key={category} value={category}>{category}</option>)}
                          </select>
                          <button
                            type="button"
                            onClick={() => setShowSelectedProductsOnly(value => !value)}
                            className={`h-8 rounded-lg border px-2.5 text-[11px] font-bold ${showSelectedProductsOnly ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-border bg-white text-text-secondary'}`}
                          >
                            仅看已选
                          </button>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="text-text-muted">当前 {visibleProductOptions.length} 款 · 已选 {selectedProductIds.length} 款</span>
                          <span className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={visibleProductOptions.length === 0}
                              onClick={() => setSelectedProductIds(current => productSelectMode === 'single'
                                ? visibleProductOptions.slice(0, 1).map(option => option.id)
                                : Array.from(new Set([...current, ...visibleProductOptions.map(option => option.id)])))}
                              className="rounded-md px-2 py-1 font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                            >
                              全选当前结果
                            </button>
                            <button
                              type="button"
                              onClick={() => { setSelectedProductIds([]); setProductInfo(''); }}
                              className="rounded-md px-2 py-1 font-bold text-text-muted hover:bg-surface-2 hover:text-red"
                            >
                              清空
                            </button>
                          </span>
                        </div>
                      </div>
                      <div className="max-h-72 overflow-y-auto p-2">
                      {productOptions.length > 0 && visibleProductOptions.length > 0 ? visibleProductOptions.map(option => {
                        const active = selectedProductIds.includes(option.id);
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => toggleProductSelection(option.id)}
                            className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-surface-2"
                          >
                            <span
                              className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border"
                              style={active ? { borderColor: TRAFFIC_GREEN, background: TRAFFIC_GREEN, color: '#fff' } : { borderColor: 'var(--color-border)' }}
                            >
                              {active && <Check size={11} />}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-bold text-text-primary">{option.label}</span>
                              {option.info && <span className="mt-0.5 block line-clamp-1 text-[11px] text-text-muted">{option.info}</span>}
                            </span>
                          </button>
                        );
                      }) : productOptions.length === 0 ? (
                        <div className="px-2.5 py-3 text-xs leading-relaxed text-text-muted">
                          企业中心暂无产品信息，请先完成配置。
                        </div>
                      ) : (
                        <div className="px-2.5 py-6 text-center text-xs leading-relaxed text-text-muted">
                          没有匹配的产品，请调整搜索词或筛选条件。
                        </div>
                      )}
                      </div>
                    </div>
                    )}
                  </div>
                </div>
              </div>
              {contentMode === 'video' && (
                <section className="border-t border-border pt-4">
                  <div className="mb-3">
                    <p className="text-xs font-black text-text-primary">创作主题</p>
                    <p className="mt-0.5 text-[10px] text-text-muted">项目基础设置只在这里编辑，后续分镜与成片步骤直接复用。</p>
                  </div>
                  <div className="grid gap-3">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold text-text-secondary">主题</span>
                    <span className="relative block">
                      <select
                        value={videoThemeId}
                        onChange={event => {
                          const nextTheme = VIDEO_THEMES.find(item => item.id === event.target.value as VideoThemeId) || VIDEO_THEMES[0]!;
                          setVideoThemeId(nextTheme.id);
                          setThemePainPoint(nextTheme.painPoint);
                          setThemeConversionGoal(DEFAULT_VIDEO_CONVERSION_GOAL);
                          if (script.trim()) setModeNotice(`视频主题已切换为“${nextTheme.title}”，请重新生成可执行分镜。`);
                        }}
                        className="h-9 w-full appearance-none rounded-lg border border-border bg-surface-2 px-3 pr-9 text-xs font-semibold text-text-primary outline-none transition focus:border-accent"
                      >
                        {VIDEO_THEMES.map(theme => <option key={theme.id} value={theme.id}>{theme.title}</option>)}
                      </select>
                      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" />
                    </span>
                  </label>
                  <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold text-text-secondary">合作路线</span>
                      <span className="relative block">
                        <select
                          value={cooperationRoute}
                          disabled={availableCooperationRoutes.length <= 1}
                          onChange={event => {
                            const route = event.target.value;
                            const defaults = enterpriseRouteStrategies[route];
                            setCooperationRoute(route);
                            setAudience(enterpriseBuyerText(defaults?.targetBuyerRoles));
                            setEnterprisePrimaryCta(defaults?.primaryCta || '');
                            setPrimaryCta(defaults?.primaryCta || '');
                          }}
                          className="h-9 w-full appearance-none rounded-lg border border-border bg-surface-2 px-3 pr-9 text-xs font-semibold text-text-primary outline-none transition focus:border-accent disabled:cursor-default disabled:opacity-80"
                        >
                          {availableCooperationRoutes.map(route => <option key={route} value={route}>{route === 'oem_odm' ? 'OEM / ODM' : route === 'wholesale_distribution' ? '现货批发 / 经销' : 'C 端零售'}</option>)}
                        </select>
                        <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" />
                      </span>
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold text-text-secondary">目标客户</span>
                    <input
                      value={audience}
                      onChange={event => setAudience(event.target.value)}
                      placeholder={activeVideoTheme.painPoint}
                      className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none transition focus:border-accent"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold text-text-secondary">主 CTA</span>
                    <input
                      value={effectivePrimaryCta || DEFAULT_VIDEO_CONVERSION_GOAL}
                      onChange={event => {
                        setEnterprisePrimaryCta(event.target.value);
                        setPrimaryCta(event.target.value);
                      }}
                      placeholder={DEFAULT_VIDEO_CONVERSION_GOAL}
                      className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none transition focus:border-accent"
                    />
                  </label>
                </div>
                </section>
              )}
              <section className="border-t border-border pt-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black text-text-primary">本次创作素材</p>
                    <p className="mt-0.5 text-[10px] text-text-muted">优先选择已有素材可让脚本更贴合真实画面；不要求上传新素材，参考爆款和产品模式也可稍后补充。</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${selectedVisualClips.length ? 'bg-emerald-50 text-emerald-700' : 'bg-surface-2 text-text-muted'}`}>
                    {selectedVisualClips.length ? `${selectedVisualClips.length} 项已准备` : (mode === 'material' ? '待选择' : '可稍后补充')}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  {[
                    ['视频', `${selectedVideoCount} 个`],
                    ['图片', `${selectedImageCount} 张`],
                    ['有效时长', `${effectiveSelectedDuration.toFixed(1)}s`],
                    ['时长未知', `${unknownDurationCount} 项`],
                    ['比例适配', `${ratioCompatibleCount}/${selectedVisualClips.length}`],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg bg-surface-2 px-2.5 py-2">
                      <p className="text-[9px] font-bold text-text-muted">{label}</p>
                      <p className="mt-0.5 text-xs font-black text-text-primary">{value}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowSetupMaterialPicker(true)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-white px-2.5 text-[10px] font-bold text-text-secondary transition hover:border-accent/40 hover:bg-surface-2"
                  >
                    <FolderOpen size={13} /> 从素材库选择
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-white px-2.5 text-[10px] font-bold text-text-secondary transition hover:border-accent/40 hover:bg-surface-2"
                  >
                    <Upload size={13} /> 上传素材
                  </button>
                  <span className={`text-[10px] font-semibold ${materialCoverageReady ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {!selectedVisualClips.length ? (mode === 'material' ? '从素材库选择至少 1 项即可，不强制上传' : '可先生成脚本，成片前再补素材') : materialCoverageReady ? '有效镜头时长可覆盖当前目标' : `建议时长改为 ${recommendedMaterialDuration}s，或再补 ${Math.max(0, duration - effectiveSelectedDuration).toFixed(1)}s 素材`}
                  </span>
                </div>
                {mode === 'material' && selectedVisualClips.length > 0 && (
                  <div className="mt-3 rounded-xl border border-border bg-surface-2 p-3">
                    <p className="text-[10px] font-black text-text-secondary">这批素材怎么用</p>
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      <button type="button" onClick={() => setHookMaterialId('')} className={`rounded-lg border px-2 py-2 text-[10px] font-bold ${!hookMaterialId ? 'border-emerald-400 bg-white text-emerald-700' : 'border-border bg-white text-text-muted'}`}>
                        整段规划
                        <span className="mt-0.5 block font-normal">围绕全部已选素材写脚本</span>
                      </button>
                      <button type="button" onClick={() => setHookMaterialId(selectedVisualClips[0]!.id)} className={`rounded-lg border px-2 py-2 text-[10px] font-bold ${hookMaterialId ? 'border-emerald-400 bg-white text-emerald-700' : 'border-border bg-white text-text-muted'}`}>
                        仅作开场钩子
                        <span className="mt-0.5 block font-normal">先用第一条，后续镜头再匹配</span>
                      </button>
                    </div>
                  </div>
                )}
                {selectedVisualClips.length > 0 && (
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    {selectedVisualClips.map(clip => (
                      <button key={clip.id} type="button" title="点击移除" onClick={() => setSelected(current => current.filter(id => id !== clip.id))} className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border bg-surface-2">
                        {clip.poster || clip.type === 'image' ? <img src={clip.poster || clip.url} alt={clip.name} className="h-full w-full object-cover" /> : <Film size={16} className="absolute inset-0 m-auto text-text-muted" />}
                        <span className="absolute inset-0 hidden items-center justify-center bg-black/55 text-[9px] font-bold text-white group-hover:flex">移除</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
              {showSetupMaterialPicker && (
                <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/45 p-4" onClick={() => setShowSetupMaterialPicker(false)}>
                  <div role="dialog" aria-modal="true" aria-label="选择本次创作素材" className="flex max-h-[82vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl" onClick={event => event.stopPropagation()}>
                    <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
                      <div><p className="text-sm font-black text-text-primary">选择本次创作素材</p><p className="mt-1 text-[11px] text-text-muted">选择即时生效；只有你明确勾选的素材会用于脚本和后续分镜。</p></div>
                      <button type="button" onClick={() => setShowSetupMaterialPicker(false)} className="rounded-lg p-2 text-text-muted hover:bg-surface-2"><X size={18} /></button>
                    </header>
                    <div className="flex items-center gap-2 border-b border-border px-5 py-3">
                      <div className="relative min-w-0 flex-1"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索素材名称" className="h-9 w-full rounded-lg border border-border bg-surface-2 pl-9 pr-3 text-xs outline-none focus:border-accent" /></div>
                      <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-bold text-text-secondary hover:bg-surface-2"><Upload size={14} />上传素材</button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-5">
                      {materials.filter(item => item.type !== 'audio' && (!search.trim() || item.name.toLowerCase().includes(search.trim().toLowerCase()))).length ? (
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                          {materials.filter(item => item.type !== 'audio' && (!search.trim() || item.name.toLowerCase().includes(search.trim().toLowerCase()))).map(clip => {
                            const checked = selected.includes(clip.id);
                            return <button key={clip.id} type="button" onClick={() => setSelected(current => checked ? current.filter(id => id !== clip.id) : [...current, clip.id])} className={`overflow-hidden rounded-xl border text-left transition ${checked ? 'border-accent ring-2 ring-accent/15' : 'border-border hover:border-accent/40'}`}>
                              <span className="relative block aspect-video bg-slate-900">{clip.poster || clip.type === 'image' ? <img src={clip.poster || clip.url} alt="" className="h-full w-full object-cover" /> : <Film size={20} className="absolute inset-0 m-auto text-white/55" />}{checked && <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white"><Check size={14} /></span>}</span>
                              <span className="block truncate px-3 py-2 text-[11px] font-bold text-text-primary">{clip.name}</span>
                            </button>;
                          })}
                        </div>
                      ) : <div className="py-16 text-center text-xs text-text-muted">暂无可用素材，请先上传视频或图片。</div>}
                    </div>
                    <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-4"><p className="text-xs font-bold text-text-secondary">已选择 {selectedVisualClips.length} 项 · 已即时保存</p><button type="button" onClick={() => setShowSetupMaterialPicker(false)} disabled={mode === 'material' && !selectedVisualClips.length} className="rounded-xl bg-accent px-5 py-2.5 text-xs font-black text-white disabled:opacity-40">{selectedVisualClips.length ? '完成选择' : '暂不选择'}</button></footer>
                  </div>
                </div>
              )}
              <div className="overflow-hidden border-y border-border bg-surface">
                <button
                  type="button"
                  onClick={() => setShowAdvancedSetup(open => !open)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface-2/60"
                >
                  <span>
                    <span className="block text-xs font-black text-text-primary">高级设置</span>
                    <span className="mt-0.5 block text-[10px] text-text-muted">{platform} · {ratio} · {duration}s · {LANGS.find(item => item.code === lang)?.label || lang}</span>
                  </span>
                  <ChevronDown size={15} className={`text-text-muted transition ${showAdvancedSetup ? 'rotate-180' : ''}`} />
                </button>
                {showAdvancedSetup && (
                  <div className="grid grid-cols-1 gap-3 border-t border-border bg-surface-2/40 p-4">
                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold text-text-secondary">发布平台</span>
                      <select value={platform} onChange={event => setPlatform(event.target.value)} className="h-9 w-full rounded-lg border border-border bg-white px-2 text-xs font-semibold text-text-primary outline-none focus:border-accent">
                        {(contentMode === 'poster'
                          ? [['facebook', 'Facebook'], ['instagram', 'Instagram']]
                          : [['tiktok', 'TikTok'], ['instagram', 'Instagram'], ['youtube', 'YouTube']]
                        ).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold text-text-secondary">画面比例</span>
                      <select value={ratio} onChange={event => setRatio(event.target.value)} className="h-9 w-full rounded-lg border border-border bg-white px-2 text-xs font-semibold text-text-primary outline-none focus:border-accent">
                        {visibleRatios.map(item => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold text-text-secondary">目标时长</span>
                      <input type="number" min={5} max={180} value={duration} onChange={event => setDuration(Math.max(5, Number(event.target.value) || 5))} className="h-9 w-full rounded-lg border border-border bg-white px-2 text-xs font-semibold text-text-primary outline-none focus:border-accent" />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold text-text-secondary">输出语言</span>
                      <select value={lang} onChange={event => setLang(event.target.value)} className="h-9 w-full rounded-lg border border-border bg-white px-2 text-xs font-semibold text-text-primary outline-none focus:border-accent">
                        {LANGS.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold text-text-secondary">生成引擎</span>
                      <select value={provider} onChange={event => setProvider(event.target.value as 'gemini' | 'qwen')} className="h-9 w-full rounded-lg border border-border bg-white px-2 text-xs font-semibold text-text-primary outline-none focus:border-accent">
                        <option value="qwen">千问（默认）</option>
                      </select>
                    </label>
                  </div>
                )}
              </div>
              {false && contentMode === 'video' && mode === 'clone' && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Sparkles size={14} className="text-accent" />
                        <p className="text-sm font-black text-text-primary">AI 推荐迁移方案：{migrationRecommendation.label}</p>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-bold text-emerald-700">已采用</span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-text-secondary">{migrationRecommendation.reason}</p>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <div className="rounded-xl border border-emerald-100 bg-white/80 p-3">
                      <p className="text-[10px] font-black text-emerald-700">保留的爆点机制</p>
                      {migrationRecommendation.preserve.map(item => <p key={item} className="mt-1 text-[11px] leading-relaxed text-text-secondary">• {item}</p>)}
                    </div>
                    <div className="rounded-xl border border-amber-100 bg-white/80 p-3">
                      <p className="text-[10px] font-black text-amber-700">按企业产品重建</p>
                      {migrationRecommendation.rebuild.map(item => <p key={item} className="mt-1 text-[11px] leading-relaxed text-text-secondary">• {item}</p>)}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {([
                      ['fidelity', '高保真复刻'],
                      ['structure', '结构迁移'],
                      ['mechanism', '机制借鉴'],
                    ] as const).map(([value, label]) => {
                      const recommended = migrationRecommendation.mode === value;
                      const risky = value === 'fidelity' && migrationRecommendation.mode !== 'fidelity';
                      return (
                        <button key={value} type="button" disabled={risky}
                          onClick={() => setMigrationMode(value)}
                          title={risky ? '当前对标视频与企业产品不兼容，禁止直接高保真替换' : undefined}
                          className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold transition ${migrationMode === value ? 'border-slate-400 bg-slate-100 text-text-primary' : 'border-border bg-white text-text-secondary'} disabled:cursor-not-allowed disabled:opacity-40`}>
                          {label}{recommended ? '（推荐）' : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {false && contentMode === 'poster' && (
                <Field label="海报风格">
                  <div className="flex flex-wrap gap-2">
                    {POSTER_STYLES.map(style => (
                      <Pill key={style.id} active={posterStyle === style.id} onClick={() => setPosterStyle(style.id)}>
                        {style.label}
                      </Pill>
                    ))}
                  </div>
                </Field>
              )}
            </div>
          </div>
        );

      case 'poster':
        return (
          <div className="max-w-4xl">
            <SectionTitle title="生成图文" />
            <div className="grid gap-4">
              <div className="rounded-2xl border border-border bg-surface p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-bold text-text-primary">图文内容</p>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${posterLoading ? 'bg-amber-50 text-amber-700' : posterJsonText ? 'bg-emerald-50 text-emerald-700' : 'bg-surface-2 text-text-muted'}`}>
                    {posterLoading ? '生成中' : posterJsonText ? '已生成' : '待生成'}
                  </span>
                </div>
                {modeNotice && (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                    {modeNotice}
                  </div>
                )}
                <textarea
                  value={posterJsonText}
                  onChange={event => setPosterJsonText(event.target.value)}
                  rows={posterJsonText ? 12 : 6}
                  placeholder={videoKickoff?.video?.contentFormat === 'image'
                    ? '生成后这里会出现三组内容 JSON：买家注意、合作能力、供应商信任，以及每组轮播结构、配文、CTA 和私信开场。'
                    : '生成后这里会出现海报文案 JSON：标题、副标题、认证徽章、流程六步、产品分类卡、底部卖点和 CTA。'}
                  className="mt-3 w-full rounded-xl border border-border bg-surface-2 p-3 font-mono text-xs leading-relaxed text-text-secondary outline-none focus:border-accent"
                />
                {leadContentPackage && <LeadContentPackagePreview value={leadContentPackage} imageUrl={posterImageUrl} />}
                {posterDraft && !leadContentPackage && (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {posterImageUrl && (
                      <div className="md:col-span-2 overflow-hidden rounded-xl border border-border bg-surface-2">
                        <img src={posterImageUrl} alt="AI 图文海报" className="max-h-[520px] w-full object-contain bg-white" />
                      </div>
                    )}
                    {mode === 'clone' && posterDraft.layoutModules?.length ? (
                      <div className="md:col-span-2 rounded-xl border border-border bg-surface-2 p-3">
                        <p className="text-xs font-bold text-text-primary">爆款模块拆解与本地素材替换</p>
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          {posterDraft.layoutModules.slice(0, 6).map((item, index) => (
                            <div key={`${item.module}-${index}`} className="rounded-lg bg-white p-2 text-[11px] leading-relaxed text-text-secondary">
                              <p className="font-bold text-text-primary">{item.module}</p>
                              <p className="mt-1">参考：{item.referencePattern}</p>
                              <p className="mt-1">素材：{item.localAssetRole}</p>
                              <p className="mt-1 text-text-muted">{item.replacementInstruction}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="rounded-xl border border-border bg-surface-2 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-bold text-text-primary">发布配文</p>
                        <button type="button" onClick={() => navigator.clipboard?.writeText(caption)} className="text-xs font-bold text-accent">复制</button>
                      </div>
                      <p className="whitespace-pre-line text-xs leading-relaxed text-text-secondary">{caption}</p>
                    </div>
                    <div className="rounded-xl border border-border bg-surface-2 p-3">
                      <p className="text-xs font-bold text-text-primary">承接话术</p>
                      <p className="mt-2 text-xs leading-relaxed text-text-secondary">评论 CTA：{posterDraft.commentCta || '待生成'}</p>
                      <p className="mt-2 text-xs leading-relaxed text-text-secondary">私信开场：{posterDraft.dmOpening || '待生成'}</p>
                    </div>
                    <div className="md:col-span-2 rounded-xl border border-border bg-surface-2 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-bold text-text-primary">图片模型 Prompt</p>
                        <button type="button" onClick={() => navigator.clipboard?.writeText(posterDraft.imagePrompt || '')} className="text-xs font-bold text-accent">复制</button>
                      </div>
                      <p className="text-xs leading-relaxed text-text-muted">{posterDraft.imagePrompt || '待生成'}</p>
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-3">
                <div className="rounded-2xl border border-border bg-surface p-4">
                  <p className="text-xs font-bold text-text-primary">当前配置</p>
                  <div className="mt-3 space-y-2 text-xs leading-relaxed text-text-secondary">
                    <p>平台：{platform === 'instagram' ? 'Instagram' : 'Facebook'}</p>
                    <p>比例：{ratio}</p>
                    <p>风格：{POSTER_STYLES.find(item => item.id === posterStyle)?.label}</p>
                    <p>模式：{POSTER_MODES.find(item => item.id === mode)?.title}</p>
                    <p>参考素材：{selectedClips.filter(item => item.type !== 'audio').length} 个</p>
                  </div>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs font-bold text-amber-900">生成前确认</p>
                  <p className="mt-2 text-xs leading-relaxed text-amber-800">
                    MOQ、认证、交期、价格、出口国家、工厂资质等商业承诺必须来自企业中心或用户确认，AI 只优化表达，不编造承诺。
                  </p>
                </div>
              </div>
            </div>
          </div>
        );

      /* ③ 选素材 —— 文件夹 + 网格 两栏 */
      case 'material': {
        const folderName = (id: string) => FOLDERS.find(f => f.id === id)?.name ?? '';
        // 按内容相关性搜索：匹配素材名 + 所属文件夹（分类）名
        const q = search.trim().toLowerCase();
        const matchSearch = (c: Clip) => q === '' || [c.name, folderName(c.folder), c.industry, c.shotFunction, c.applicability, c.tags]
          .filter(Boolean).some(value => String(value).toLowerCase().includes(q));
        // 「当前选择」跟随当前视频版本的分镜分配，不能读取跨版本的全局勾选状态。
        // 同一素材若用于多个分镜，只在素材网格中展示一次，并保持首次出现顺序。
        const currentVersionMaterialIds = [...new Set(assignedOrderedIds)];
        const recommendationSource = storyboardSlots.length > 0 ? currentVersionMaterialIds : selected;
        const recommended = recommendationSource
          .map(id => materialById.get(id))
          .filter((item): item is Clip => Boolean(item && item.type !== 'audio'));
        const visible = (activeFolder === 'recommend'
          ? recommended
          : materials.filter(c => activeFolder === 'all' || c.folder === activeFolder)
        ).filter(matchSearch);
        const materialQualityIssueCount = storyboardSlots.filter(slot => {
          const plan = storyboardSourcePlans[slot.id];
          return Boolean(plan?.qualityError || (plan?.quality && !plan.quality.passed));
        }).length;
        const materialQualityCheckingCount = storyboardSlots.filter(slot => storyboardQualityChecking[slot.id]).length;
        if (contentMode === 'poster') {
          const posterFolderName = (id: string) => POSTER_FOLDERS.find(f => f.id === id)?.name ?? folderName(id);
          const posterFolders = new Set(POSTER_FOLDERS.map(item => item.id));
          const posterActiveFolder = posterFolders.has(activeFolder) ? activeFolder : 'all';
          const posterMaterials = materials.filter(c => c.type !== 'audio');
          const selectedPosterClips = selected
            .map(id => materialById.get(id))
            .filter((item): item is Clip => Boolean(item && item.type !== 'audio'));
          const posterRecommended = selectedPosterClips.length
            ? selectedPosterClips
            : posterMaterials.filter(c => ['product', 'factory', 'packaging', 'certificate', 'scene', 'brand', 'hot'].includes(c.folder));
          const visiblePoster = (posterActiveFolder === 'recommend'
            ? posterRecommended
            : posterMaterials.filter(c => posterActiveFolder === 'all' || c.folder === posterActiveFolder)
          ).filter(c => q === '' || c.name.toLowerCase().includes(q) || posterFolderName(c.folder).toLowerCase().includes(q));
          const folderCount = (folderId: string) => {
            if (folderId === 'recommend') return posterRecommended.length;
            if (folderId === 'all') return posterMaterials.length;
            return posterMaterials.filter(c => c.folder === folderId).length;
          };
          const clipsForFolders = (folders: readonly string[]) =>
            selectedPosterClips.filter(clip => folders.includes(clip.folder));
          const smartSelectPosterMaterials = () => {
            const byFolder = (folders: string[], limit = 1) => posterMaterials
              .filter(clip => folders.includes(clip.folder))
              .slice(0, limit)
              .map(clip => clip.id);
            const picked = [
              ...byFolder(['product'], 4),
              ...byFolder(['factory'], 2),
              ...byFolder(['packaging', 'certificate'], 2),
              ...byFolder(['scene', 'brand'], 2),
              ...(mode === 'clone' ? byFolder(['hot'], 1) : []),
            ];
            setSelected([...new Set(picked.length ? picked : posterMaterials.slice(0, 6).map(clip => clip.id))]);
            setActiveFolder('recommend');
            setModeNotice(mode === 'clone'
              ? '已按爆款图文复刻逻辑推荐素材：先拆解爆款参考，再匹配产品、工厂、包装证书和场景图。'
              : '已按海报文案需要推荐素材：产品图优先，补充工厂背书、包装证书和使用场景。');
          };

          return (
            <div className="flex min-h-full flex-col gap-4">
              <div className="w-40 flex-shrink-0 border-r border-border p-2.5 overflow-y-auto">
                <div className="relative mb-3">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索图文素材…"
                    className="w-full pl-8 pr-2 py-1.5 rounded-lg border border-border bg-surface text-xs outline-none focus:border-accent" />
                </div>
                <div className="flex items-center justify-between px-1.5 mb-1.5">
                  <span className="text-[11px] font-semibold text-text-secondary">图文素材</span>
                  <Plus size={13} className="text-text-muted cursor-pointer hover:text-text-primary" />
                </div>
                {POSTER_FOLDERS.map(f => (
                  <button key={f.id} onClick={() => setActiveFolder(f.id)}
                    className={`w-full flex items-center gap-1.5 px-2 py-2 rounded-lg text-xs transition-colors ${
                      posterActiveFolder === f.id ? 'bg-accent-glow text-accent font-semibold' : 'text-text-secondary hover:bg-surface-2'}`}>
                    <Folder size={12} className="flex-shrink-0" />
                    <span className="flex-1 text-left truncate">{f.name}</span>
                    {f.id === 'hot' && <span className="text-[7px] font-bold px-1 py-0.5 rounded text-white flex-shrink-0" style={{ background: '#0891b2' }}>爬取</span>}
                    <span className="text-[10px] text-text-muted">{folderCount(f.id)}</span>
                  </button>
                ))}
              </div>

              <div className="flex-1 min-w-0 flex flex-col">
                <div className="flex items-center gap-3 px-5 py-3 border-b border-border flex-shrink-0">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary">{posterFolderName(posterActiveFolder)}</p>
                    <p className="mt-0.5 text-[11px] text-text-muted">
                      {mode === 'clone'
                        ? '爆款图文参考用于拆解画风、画面和图文构成，本地素材用于生成最终海报。'
                        : '上传产品、工厂、包装、证书、场景和品牌视觉素材，AI 会按海报文案智能推荐。'}
                    </p>
                  </div>
                  <input ref={fileInputRef} type="file" multiple accept="image/*" className="hidden"
                    onChange={e => { void handleUpload(e.target.files); e.target.value = ''; }} />
                  <button
                    type="button"
                    onClick={smartSelectPosterMaterials}
                    disabled={posterMaterials.length === 0}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-border bg-white px-3 py-1.5 text-xs font-bold text-text-secondary transition hover:bg-surface-2 disabled:opacity-50"
                  >
                    <Sparkles size={12} />
                    智能推荐参考图
                  </button>
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                    className="btn-ghost !px-3 !py-1.5 !text-xs flex items-center gap-1.5 disabled:opacity-60">
                    {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                    {uploading ? '上传中…' : '上传图片'}
                  </button>
                  <span className="text-xs text-text-muted">已选 {selectedPosterClips.length}</span>
                </div>

                <div className="flex-1 overflow-y-auto p-5">
                  <div className={`mb-4 rounded-xl border px-4 py-3 text-xs leading-relaxed ${activeProductLabel ? 'border-accent/20 bg-accent-glow text-text-secondary' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                    <span className="font-bold text-text-primary">当前产品：</span>
                    {activeProductLabel || '尚未选择。产品信息生成模式需要先在第一步选择企业中心产品，再补充/选择图文素材。'}
                    {activeProductLabel && mode === 'product' ? '。请继续选择产品图、工厂图、包装图、证书图或场景图作为海报参考。' : ''}
                  </div>
                  {mode === 'clone' && (
                    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
                      参考爆款创作需要先从「灵感中心 - 拍摄任务 - 图文」选择已采集的图文素材。系统会把对标图文拆成标题区、产品主视觉、背景氛围、信息栏、认证徽章、流程图、CTA 等模块，再用本地素材逐模块替换。
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-3">
                    {visiblePoster.map(c => {
                      const on = selected.includes(c.id);
                      const idx = selected.indexOf(c.id);
                      return (
                        <button key={c.id}
                          onClick={() => setSelected(s => on ? s.filter(x => x !== c.id) : [...s, c.id])}
                          className="card !rounded-xl overflow-hidden text-left relative group"
                          style={on ? { borderColor: TRAFFIC_GREEN, boxShadow: `0 0 0 1px ${TRAFFIC_GREEN}` } : undefined}>
                          <div className="relative">
                            {c.url
                              ? <RealThumb clip={c} onSourceError={() => { void refreshMaterialSource(c.id); }} />
                              : <Thumb seed={c.id} src={c.poster} label={c.type === 'image' ? 'IMG' : fmtDur(c.duration)} />}
                            {on && (
                              <span className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white z-10"
                                style={{ background: TRAFFIC_GREEN }}>{idx + 1}</span>
                            )}
                            {c.folder === 'hot' && (
                              <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[8px] font-bold text-white bg-black/45 z-10">
                                爆款参考
                              </span>
                            )}
                          </div>
                          <div className="p-2">
                            <p className="text-[11px] font-medium text-text-primary truncate">{c.name}</p>
                            <p className="text-[10px] text-text-muted mt-0.5">{posterFolderName(c.folder)} · {c.size}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {visiblePoster.length === 0 && (
                    <div className="text-center py-16">
                      <Upload size={26} className="mx-auto text-text-muted mb-3 opacity-30" />
                      <p className="text-sm text-text-muted">
                        {search.trim() ? '没有匹配的图文素材' : posterActiveFolder === 'hot' ? '暂无爆款图文参考，请从灵感中心采集或选择拍摄任务中的图文' : '这个分类还没有图片素材'}
                      </p>
                      {posterActiveFolder !== 'hot' && !search.trim() && (
                        <button onClick={() => fileInputRef.current?.click()} className="mt-2 text-xs font-semibold" style={{ color: TRAFFIC_GREEN }}>
                          上传到{posterFolderName(posterActiveFolder)}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <aside className="flex w-full flex-col rounded-2xl border border-border bg-surface/40">
                <div className="border-b border-border bg-white px-4 py-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">海报参考素材</p>
                      <p className="mt-0.5 text-sm font-black text-text-primary">
                        {mode === 'clone' ? '爆款拆解 + 本地素材回填' : '按文案推荐素材'}
                      </p>
                    </div>
                    <button type="button" onClick={() => setSelected([])}
                      className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold text-text-secondary hover:bg-surface-2">
                      清空
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[11px] text-text-muted">
                    <span>{selectedPosterClips.length} 个已选 · 下一步生成海报 JSON 和图片</span>
                    <button type="button" onClick={smartSelectPosterMaterials}
                      className="font-bold text-accent disabled:opacity-40"
                      disabled={!posterMaterials.length}>
                      智能推荐
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
                  {POSTER_MATERIAL_GROUPS.map(group => {
                    const groupClips = clipsForFolders(group.folders);
                    if (group.id === 'hot' && mode !== 'clone') return null;
                    return (
                      <div key={group.id} className={`rounded-xl border p-3 ${groupClips.length ? 'border-green-200 bg-green-50/60' : 'border-dashed border-border bg-white'}`}>
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-bold text-text-primary">{group.title}</p>
                            <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">{group.desc}</p>
                          </div>
                          <span className="rounded-md bg-slate-950 px-1.5 py-0.5 text-[10px] font-bold text-white">{groupClips.length}</span>
                        </div>
                        {groupClips.length ? (
                          <div className="space-y-2">
                            {groupClips.map(clip => (
                              <div key={clip.id} className="flex items-center gap-2 rounded-lg bg-white p-2 shadow-sm">
                                <div className="h-12 w-16 flex-shrink-0 overflow-hidden rounded-md bg-surface-2">
                                  {clip.url
                                    ? <RealThumb clip={clip} onSourceError={() => { void refreshMaterialSource(clip.id); }} />
                                    : <Thumb seed={clip.id} src={clip.poster} label={clip.type === 'image' ? 'IMG' : fmtDur(clip.duration)} />}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-[11px] font-bold text-text-primary">{clip.name}</p>
                                  <p className="mt-0.5 text-[10px] text-text-muted">{posterFolderName(clip.folder)} · {clip.size}</p>
                                </div>
                                <button type="button" onClick={() => setSelected(list => list.filter(id => id !== clip.id))}
                                  className="rounded-md p-1 text-text-muted hover:bg-surface-2 hover:text-red">
                                  <X size={12} />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex h-14 items-center justify-center rounded-lg border border-dashed border-border bg-surface-2 text-center text-[11px] font-bold text-text-muted">
                            {group.id === 'hot' ? '从灵感中心选择爆款图文' : '从左侧选择或上传'}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </aside>
            </div>
          );
        }
        const assignClipToSlot = (slotId: string, clipId: string) => {
          const clip = materialById.get(clipId);
          const slot = storyboardSlots.find(item => item.id === slotId);
          if (!clip || !slot) return;
          if (!isClipCompatibleWithRatio(clip, ratio)) {
            setModeNotice(`“${clip.name}”与当前 ${ratio} 方向不同，已加入分镜；成片时会自动居中裁切，可在预览页检查主体是否完整。`);
          }
          const detectedSource = clipSourceMode(clip);
          const assessment = assessMaterialMatch(slot, clip, ratio);
          setStoryboardAssignments(prev => ({ ...prev, [slotId]: clipId }));
          setSelected(prev => prev.includes(clipId) ? prev : [...prev, clipId]);
          setClipEdits(prev => ({ ...prev, [slotClipEditKey(slot.id, clipId)]: defaultEditForSlot(clip, slot) }));
          setStoryboardSourcePlans(prev => ({
            ...prev,
            [slotId]: {
              ...sourcePlanFor(slot),
              mode: detectedSource,
              decided: true,
              confirmed: true,
              generatedClipId: detectedSource === 'ai' ? clip.id : undefined,
              error: '',
              matchScore: assessment.score,
              matchReason: assessment.reason,
              matchDifference: assessment.difference,
              matchLevel: assessment.level,
            },
          }));
          const currentIndex = storyboardSlots.findIndex(item => item.id === slotId);
          const prospectiveAssignments = { ...storyboardAssignments, [slotId]: clip.id };
          const orderedFollowingSlots = [...storyboardSlots.slice(currentIndex + 1), ...storyboardSlots.slice(0, currentIndex)];
          const nextSlot = orderedFollowingSlots.find(item => !storyboardAssignmentIdForMode(item.id, activeVoiceLang, prospectiveAssignments, shotMediaModes));
          if (nextSlot) setActiveStoryboardSlotId(nextSlot.id);
          setModeNotice(`已将“${clip.name}”应用到第 ${currentIndex + 1} 段，匹配 ${assessment.score} 分（${assessment.reason}）${assessment.level === 'missing' ? '；该素材低于自动匹配线，但已按你的手动选择保留' : ''}${nextSlot ? `。请继续确认第 ${storyboardSlots.findIndex(item => item.id === nextSlot.id) + 1} 段` : '。当前分镜素材已全部确认'}。`);
        };
        const removeSlotClip = (slotId: string) => {
          setStoryboardAssignments(prev => {
            const next = { ...prev };
            delete next[slotId];
            return next;
          });
        };
        const currentAssemblySnapshot = (): StoryboardAssembly => ({
          id: activeAssemblyId,
          name: assemblyName,
          assignments: storyboardAssignments,
          sourcePlans: storyboardSourcePlans,
          selected,
        });
        const switchAssembly = (targetId: string) => {
          if (targetId === activeAssemblyId) return;
          const target = storyboardAssemblies.find(item => item.id === targetId);
          if (!target) return;
          const current = currentAssemblySnapshot();
          setStoryboardAssemblies(items => items.map(item => item.id === activeAssemblyId ? current : item));
          setActiveAssemblyId(target.id);
          setAssemblyName(target.name);
          setStoryboardAssignments(target.assignments);
          setStoryboardSourcePlans(target.sourcePlans);
          setSelected(target.selected);
          setActiveStoryboardSlotId(storyboardSlots.find(slot => !target.assignments[slot.id])?.id || storyboardSlots[0]?.id || '');
        };
        const createAssembly = () => {
          const current = currentAssemblySnapshot();
          const nextNumber = storyboardAssemblies.reduce((max, item) => {
            const match = item.name.match(/^视频(\d+)$/);
            return Math.max(max, match ? Number(match[1]) : 0);
          }, 0) + 1;
          const next: StoryboardAssembly = {
            id: `video-${Date.now()}`,
            name: `视频${nextNumber}`,
            assignments: {},
            sourcePlans: {},
            selected: [],
          };
          setStoryboardAssemblies(items => [...items.map(item => item.id === activeAssemblyId ? current : item), next]);
          setActiveAssemblyId(next.id);
          setAssemblyName(next.name);
          setStoryboardAssignments({});
          setStoryboardSourcePlans({});
          setSelected([]);
          setActiveStoryboardSlotId(storyboardSlots[0]?.id || '');
        };
        const updateSourcePlan = (slot: StoryboardSlot, patch: Partial<StoryboardSourcePlan>) => {
          const current = sourcePlanFor(slot);
          setStoryboardSourcePlans(prev => ({
            ...prev,
            [slot.id]: {
              ...sourcePlanFor(slot),
              ...patch,
              decided: patch.mode ? true : sourcePlanFor(slot).decided,
              referenceClipId: patch.mode === 'hybrid'
                ? (storyboardAssignments[slot.id] || sourcePlanFor(slot).referenceClipId)
                : patch.mode ? undefined : sourcePlanFor(slot).referenceClipId,
              generatedClipId: patch.mode && patch.mode !== sourcePlanFor(slot).mode ? undefined : sourcePlanFor(slot).generatedClipId,
              error: patch.mode ? '' : sourcePlanFor(slot).error,
            },
          }));
        };
        const preferredFoldersForSlot = (slot: StoryboardSlot) => {
          const text = `${slot.title} ${slot.detail}`.toLowerCase();
          if (/证书|认证|检测|certificate/.test(text)) return ['certificate', 'factory', 'upload'];
          if (/工厂|生产线|质检|factory|inspection/.test(text)) return ['factory', 'upload'];
          if (/包装|瓶身|logo|产品特写|材质|product|detail/.test(text)) return ['product', 'detail', 'packaging', 'upload'];
          if (/人物|模特|口播|presenter|model/.test(text)) return ['presenter', 'model', 'upload'];
          if (/场景|生活|户外|室内|scene|lifestyle/.test(text)) return ['scene', 'upload'];
          return ['upload', 'scene', 'product', 'detail', 'factory', 'presenter', 'model'];
        };
        const bestLocalClipForSlot = (slot: StoryboardSlot) => {
          const folders = preferredFoldersForSlot(slot);
          const candidates = materials.filter(item => item.type !== 'audio' && item.folder !== 'hot');
          return [...candidates].sort((a, b) => {
            const ratioDelta = clipRatioPreferenceScore(b, ratio) - clipRatioPreferenceScore(a, ratio);
            if (ratioDelta) return ratioDelta;
            const aRank = folders.indexOf(a.folder);
            const bRank = folders.indexOf(b.folder);
            const normalizedA = aRank < 0 ? 999 : aRank;
            const normalizedB = bRank < 0 ? 999 : bRank;
            if (normalizedA !== normalizedB) return normalizedA - normalizedB;
            const detail = `${slot.title} ${slot.detail}`.toLowerCase();
            const aMatch = a.name.toLowerCase().split(/\s+|[-_]/).filter(word => word.length > 1 && detail.includes(word)).length;
            const bMatch = b.name.toLowerCase().split(/\s+|[-_]/).filter(word => word.length > 1 && detail.includes(word)).length;
            return bMatch - aMatch;
          })[0];
        };
        const executeAutoPlan = async (slot: StoryboardSlot) => {
          const recommendedMode = recommendedSourceMode(slot);
          const localClip = bestLocalClipForSlot(slot);
          const resolvedMode: StoryboardSourceMode = recommendedMode === 'auto'
            ? (localClip ? 'local' : 'ai')
            : recommendedMode;
          if ((resolvedMode === 'local' || resolvedMode === 'hybrid') && !localClip) {
            setStoryboardSourcePlans(prev => ({
              ...prev,
              [slot.id]: {
                ...sourcePlanFor(slot),
                mode: resolvedMode,
                critical: isCriticalStoryboardSlot(slot),
                confirmed: false,
                error: '没有找到符合该分镜的真实素材，请先上传或手动匹配。',
              },
            }));
            return;
          }
          if (localClip) assignClipToSlot(slot.id, localClip.id);
          const nextPlan: StoryboardSourcePlan = {
            mode: resolvedMode,
            critical: isCriticalStoryboardSlot(slot),
            confirmed: false,
            referenceClipId: resolvedMode === 'hybrid' ? localClip?.id : undefined,
            error: '',
          };
          setStoryboardSourcePlans(prev => ({ ...prev, [slot.id]: nextPlan }));
          if (resolvedMode === 'ai' || resolvedMode === 'hybrid') {
            await generateStoryboardShot(slot, nextPlan);
          }
        };
        const executeAllAutoPlans = async () => {
          for (const slot of storyboardSlots) {
            await executeAutoPlan(slot);
          }
        };
        const confirmAllStoryboardPlans = () => {
          const next: Record<string, StoryboardSourcePlan> = {};
          storyboardSlots.forEach(slot => {
            const plan = sourcePlanFor(slot);
            const hasLocalMaterial = Boolean(storyboardAssignments[slot.id]);
            const generatedReady = plan.mode !== 'ai' && plan.mode !== 'hybrid' || Boolean(plan.generatedClipId && materialById.has(plan.generatedClipId));
            next[slot.id] = {
              ...plan,
              confirmed: Boolean(plan.decided) && generatedReady && (plan.mode === 'ai' || hasLocalMaterial),
            };
          });
          setStoryboardSourcePlans(prev => ({ ...prev, ...next }));
        };
        const activeStoryboardSlot = storyboardSlots.find(slot => slot.id === activeStoryboardSlotId)
          || storyboardSlots.find(slot => !storyboardAssignmentIdForMode(slot.id, activeVoiceLang, storyboardAssignments, shotMediaModes))
          || storyboardSlots[0];
        const activeStoryboardIndex = activeStoryboardSlot
          ? storyboardSlots.findIndex(slot => slot.id === activeStoryboardSlot.id)
          : -1;
        const remainingStoryboardCount = Math.max(0, storyboardSlots.length - assignedCount);
        return (
          <div className="flex min-h-full flex-col gap-4">
            {/* 文件夹栏（含内容搜索） */}
            <div className="w-full flex-shrink-0 rounded-2xl border border-border p-2.5">
              {/* 内容相关性搜索 */}
              <div className="relative mb-3">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索素材内容…"
                  className="w-full pl-8 pr-2 py-1.5 rounded-lg border border-border bg-surface text-xs outline-none focus:border-accent" />
              </div>
              <div className="flex items-center justify-between px-1.5 mb-1.5">
                <span className="text-[11px] font-semibold text-text-secondary">文件夹</span>
                <Plus size={13} className="text-text-muted cursor-pointer hover:text-text-primary" />
              </div>
              {FOLDERS.map(f => {
                const count = f.id === 'recommend'
                  ? recommended.length
                  : f.id === 'all'
                    ? materials.length
                    : materials.filter(c => c.folder === f.id).length;
                return (
                  <button key={f.id} onClick={() => setActiveFolder(f.id)}
                    className={`w-full flex items-center gap-1.5 px-2 py-2 rounded-lg text-xs transition-colors ${
                      activeFolder === f.id ? 'bg-accent-glow text-accent font-semibold' : 'text-text-secondary hover:bg-surface-2'}`}>
                    <Folder size={12} className="flex-shrink-0" />
                    <span className="flex-1 text-left truncate">{f.name}</span>
                    {f.id === 'hot' && <span className="text-[7px] font-bold px-1 py-0.5 rounded text-white flex-shrink-0" style={{ background: '#0891b2' }}>实时</span>}
                    <span className="text-[10px] text-text-muted">{count}</span>
                  </button>
                );
              })}
            </div>

            {/* 素材网格 */}
            <div className="flex-1 min-w-0 flex flex-col">
	              {mode === 'clone' && (
	                <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-5 py-3">
	                  <div>
	                    <p className="text-sm font-black text-text-primary">逐镜放入素材</p>
	                    <p className="mt-0.5 text-[10px] text-text-muted">拖入已有视频，或直接 AI 生成；素材来源由系统自动识别，无需确认。</p>
	                  </div>
	                  <div className="flex items-center gap-2 text-[10px] font-bold">
	                    <span className="rounded-lg bg-accent/10 px-2.5 py-1.5 text-accent">{storyboardSlots.length ? `已完成 ${assignedCount}/${storyboardSlots.length}` : '暂无分镜'}</span>
	                  </div>
	                </div>
	              )}
	              <div className="flex items-center gap-3 px-5 py-3 border-b border-border flex-shrink-0">
		                <span className="text-sm font-semibold text-text-primary">{folderName(activeFolder)}</span>
		                {activeFolder === 'recommend' && <span className="text-[11px] text-text-muted">查看当前视频版本全部分镜使用的素材</span>}
		                {activeFolder === 'hot' && <span className="text-[11px] text-text-muted">官方实时更新</span>}
	                {activeFolder === 'presenter' && <span className="text-[11px] text-text-muted">上传并选择已授权的真人出镜视频</span>}
	                <input ref={fileInputRef} type="file" multiple accept={activeFolder === 'presenter' ? 'video/*' : 'video/*,image/*,audio/*'} className="hidden"
	                  onChange={e => { void handleUpload(e.target.files); e.target.value = ''; }} />
		                <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
		                  className="btn-ghost ml-auto !px-3 !py-1.5 !text-xs flex items-center gap-1.5 disabled:opacity-60">
		                  {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} {uploading ? '上传中…' : '上传'}
		                </button>
	                <span className="text-xs text-text-muted">已选 {activeFolder === 'recommend' ? recommendationSource.length : selected.length}</span>
	              </div>

	              <div className="flex-1 overflow-y-auto p-5">
	                {activeFolder === 'presenter' && digitalHumanNotice && (
	                  <div className="mb-4 rounded-xl border border-accent/20 bg-accent-glow px-4 py-3 text-xs font-semibold text-accent">
	                    {digitalHumanNotice}
	                  </div>
	                )}
	                <div className="grid grid-cols-1 gap-3">
	                  {visible.map(c => {
                    const displaySelection = activeFolder === 'recommend' ? recommendationSource : selected;
                    const on = displaySelection.includes(c.id);
                    const idx = displaySelection.indexOf(c.id);
	                    return (
	                      <div key={c.id}
	                        role="button"
	                        tabIndex={0}
                        draggable={c.type !== 'audio'}
                        onDragStart={e => {
                          e.dataTransfer.setData('application/x-lingshu-material-id', c.id);
                          e.dataTransfer.setData('text/plain', c.id);
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => setSelected(s => on ? s.filter(x => x !== c.id) : [...s, c.id])}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelected(s => on ? s.filter(x => x !== c.id) : [...s, c.id]);
                          }
                        }}
                        className="card !rounded-xl overflow-hidden text-left relative group"
                        style={on ? { borderColor: TRAFFIC_GREEN, boxShadow: `0 0 0 1px ${TRAFFIC_GREEN}` } : undefined}>
                        <div className="relative">
	                          {/* 真实素材显示实际预览；来源不可访问时明确显示不可预览。 */}
                          {c.url
                            ? <RealThumb clip={c} onSourceError={() => { void refreshMaterialSource(c.id); }} />
                            : <Thumb seed={c.id} src={c.poster} label={c.type === 'image' ? 'IMG' : `0:${String(c.duration).padStart(2, '0')}`} />}
                          {on && (
                            <span className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white z-10"
                              style={{ background: TRAFFIC_GREEN }}>{idx + 1}</span>
                          )}
                          {c.scope === 'shared' && !on && (
                            <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[8px] font-bold text-white z-10" style={{ background: '#0891b2' }}>在线</span>
                          )}
                          <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold text-white bg-black/45 uppercase z-10">
                            {c.type}
                          </span>
                          {c.type === 'video' && c.url && (
                            <button
                              type="button"
                              aria-label={`播放 ${c.name}`}
                              onClick={event => {
                                event.preventDefault();
                                event.stopPropagation();
                                setPreviewClip(c);
                              }}
                              className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full focus:outline-none focus:ring-2 focus:ring-white/80"
                            >
                              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/65 text-white shadow-lg transition group-hover:scale-105">
                                <Play size={18} fill="currentColor" />
                              </span>
                            </button>
                          )}
                        </div>
	                        <div className="p-2">
	                          <p className="text-[11px] font-medium text-text-primary truncate">{c.name}</p>
	                          <p className="text-[10px] text-text-muted mt-0.5">{c.folder === 'presenter' ? '真人口播素材 · ' : ''}{c.size}</p>
	                          {(c.industry || c.shotFunction) && (
	                            <p className="mt-1 truncate text-[9px] text-text-muted">{[c.industry, c.shotFunction].filter(Boolean).join(' · ')}</p>
	                          )}
	                          {activeStoryboardSlot && c.type !== 'audio' && (
	                            <button
	                              type="button"
	                              onClick={event => {
	                                event.preventDefault();
	                                event.stopPropagation();
	                                assignClipToSlot(activeStoryboardSlot.id, c.id);
	                              }}
	                              className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg bg-slate-950 px-2 py-1.5 text-[10px] font-bold text-white transition hover:bg-accent"
	                            >
	                              <Check size={11} />
	                              应用到第 {activeStoryboardIndex + 1} 段
	                            </button>
	                          )}
	                        </div>
	                      </div>
                    );
                  })}
                </div>
                {visible.length === 0 && (
                  <div className="text-center py-16">
                    <Upload size={26} className="mx-auto text-text-muted mb-3 opacity-30" />
		                    <p className="text-sm text-text-muted">
		                      {search.trim() ? '没有匹配的素材' : activeFolder === 'recommend' ? '当前视频版本还没有匹配分镜素材；请从其他文件夹选择或拖入分镜' : activeFolder === 'hot' ? '爆款素材库更新中，敬请期待' : activeFolder === 'presenter' ? '还没有真人口播素材' : '这个文件夹还没有素材'}
		                    </p>
		                    {activeFolder !== 'hot' && activeFolder !== 'recommend' && !search.trim() && (
	                      <div className="mt-2 space-y-2">
	                        <button onClick={() => fileInputRef.current?.click()} className="text-xs font-semibold" style={{ color: TRAFFIC_GREEN }}>
	                          {activeFolder === 'presenter' ? '上传真人实拍视频' : '点此上传'}
	                        </button>
	                        {activeFolder === 'presenter' && (
	                          <p className="text-[11px] text-text-muted">这里只补充普通真人实拍素材；数字人人物统一在企业知识库管理。</p>
	                        )}
	                      </div>
	                    )}
	                  </div>
                )}
              </div>
            </div>

            {previewClip?.type === 'video' && previewClip.url && (
              <div
                className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-6"
                role="dialog"
                aria-modal="true"
                aria-label="素材视频预览"
                onClick={() => setPreviewClip(null)}
              >
                <div className="w-full max-w-4xl overflow-hidden rounded-2xl bg-black shadow-2xl" onClick={event => event.stopPropagation()}>
                  <div className="flex items-center justify-between gap-4 bg-surface px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-text-primary">{previewClip.name}</p>
                      <p className="text-[11px] text-text-muted">{folderName(previewClip.folder)} · {fmtDur(previewClip.duration)}</p>
                    </div>
                    <button type="button" aria-label="关闭视频预览" onClick={() => setPreviewClip(null)} className="rounded-lg p-2 text-text-muted hover:bg-surface-2 hover:text-text-primary">
                      <X size={18} />
                    </button>
                  </div>
                  <video
                    key={`${previewClip.id}:${previewClip.url}`}
                    src={previewClip.url}
                    poster={previewClip.poster}
                    controls
                    autoPlay
                    playsInline
                    preload="metadata"
                    className="max-h-[75vh] w-full bg-black object-contain"
                    onLoadedData={() => setModeNotice('')}
                    onError={() => {
                      setModeNotice('素材预览链接已失效，正在刷新后重试…');
                      void refreshMaterialSource(previewClip.id).then(refreshed => {
                        if (refreshed) setPreviewClip(refreshed);
                      });
                    }}
                  >
                    当前浏览器不支持视频播放。
                  </video>
                </div>
              </div>
            )}

            <aside className="flex w-full flex-shrink-0 flex-col rounded-2xl border border-border bg-surface/40">
              <div className="border-b border-border bg-white px-4 py-3">
                <div className={`mb-3 rounded-xl border px-3 py-2.5 ${remainingStoryboardCount || materialQualityIssueCount ? 'border-amber-200 bg-amber-50' : materialQualityCheckingCount ? 'border-blue-200 bg-blue-50' : 'border-emerald-200 bg-emerald-50'}`}>
                  <div className="flex items-start gap-2">
                    {remainingStoryboardCount || materialQualityIssueCount
                      ? <Clock size={14} className="mt-0.5 shrink-0 text-amber-600" />
                      : materialQualityCheckingCount
                        ? <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-blue-600" />
                        : <Check size={14} className="mt-0.5 shrink-0 text-emerald-600" />}
                    <div className="min-w-0">
                      <p className="text-xs font-black text-text-primary">
                        {remainingStoryboardCount || materialQualityIssueCount
                          ? `优先处理 ${remainingStoryboardCount + materialQualityIssueCount} 项异常`
                          : materialQualityCheckingCount ? `AI 正在检查 ${materialQualityCheckingCount} 个分镜` : 'AI 已完成素材匹配与质量检查'}
                      </p>
                      <p className="mt-0.5 text-[10px] leading-4 text-text-muted">
                        {remainingStoryboardCount ? `${remainingStoryboardCount} 个分镜缺素材` : '素材完整'} · {materialQualityIssueCount ? `${materialQualityIssueCount} 个质量问题` : '质量正常'}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">分镜匹配 · 视频草稿</p>
                  <button type="button" onClick={createAssembly}
                    className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold text-text-secondary hover:bg-surface-2">
                    + 新建视频
                  </button>
                </div>
                <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
                  {storyboardAssemblies.map(item => {
                    const active = item.id === activeAssemblyId;
                    const itemAssignments = active ? storyboardAssignments : item.assignments;
                    const matched = storyboardSlots.filter(slot => Boolean(storyboardAssignmentIdForMode(slot.id, activeVoiceLang, itemAssignments, shotMediaModes))).length;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => switchAssembly(item.id)}
                        className={`flex flex-shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-left transition ${active ? 'border-accent bg-accent/5 text-accent shadow-sm' : 'border-border bg-white text-text-secondary hover:border-accent/40'}`}
                      >
                        <span className="text-xs font-black">{active ? assemblyName : item.name}</span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${active ? 'bg-accent/10 text-accent' : 'bg-surface-2 text-text-muted'}`}>{storyboardSlots.length ? `${matched}/${storyboardSlots.length}` : '暂无'}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-text-muted">
                  <span>{storyboardSlots.length ? `${assignedCount}/${storyboardSlots.length} 已匹配 · ${remainingStoryboardCount ? `${remainingStoryboardCount} 段待处理` : '可以进入下一步'}` : '暂无分镜'}</span>
                  {renderTimeline.length > 0 && <span className="font-bold text-accent">成片约 {renderTimeline.reduce((sum, item) => sum + item.targetDuration, 0).toFixed(1)}s</span>}
                </div>
                {storyboardSlots.length > 0 && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(assignedCount / storyboardSlots.length) * 100}%` }} />
                  </div>
                )}
                {remainingStoryboardCount > 0 && storyboardSlots.length > 0 && (
                  <div data-lingshu-guide="ai-storyboard" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <div className="flex items-start gap-2">
                      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-amber-500 text-xs font-black text-white">!</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-black text-amber-950">还剩 {remainingStoryboardCount} 个分镜没有视频</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void smartSelectMaterialsFast()}
                      disabled={materialSelectLoading}
                      className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-black text-white transition hover:bg-amber-600"
                      title="根据分镜语义、素材标签和有效时长在本地即时匹配，不调用大模型"
                    >
                      {materialSelectLoading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                      {materialSelectLoading ? '快速匹配中…' : '快速本地匹配全部空分镜'}
                    </button>
                  </div>
                )}
                {mode === 'clone' && storyboardReviewComplete && storyboardSlots.length > 0 && (
                  <div className="mt-3 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2.5 text-xs font-black text-green-700">
                    <Check size={14} /> 所有分镜已有视频，可以进入下一步
                  </div>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-2">
	                {storyboardSlots.length === 0 && (
	                  <div className="flex min-h-[240px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-white px-6 text-center">
	                    <Film size={28} className="text-text-muted opacity-35" />
	                    <p className="mt-3 text-sm font-black text-text-primary">暂无分镜</p>
	                  </div>
	                )}
	                {storyboardSlots.map((slot, index) => {
	                  const clip = slot.id ? materialById.get(storyboardAssignmentIdForMode(slot.id, activeVoiceLang, storyboardAssignments, shotMediaModes) || '') : undefined;
	                  const slotEdit = clip ? editForSlot(clip, slot) : null;
	                  const shotGenerating = Boolean(storyboardGenerating[slot.id]);
                  const slotVersions = storyboardVideoVersions[slot.id] || [];
                  const slotScript = storyboardSlotScript(slot.detail);
                  return (
                    <div
                      key={slot.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setActiveStoryboardSlotId(slot.id)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') setActiveStoryboardSlotId(slot.id);
                      }}
                      onDragOver={event => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'copy';
                      }}
                      onDrop={event => {
                        event.preventDefault();
                        const clipId = event.dataTransfer.getData('application/x-lingshu-material-id')
                          || event.dataTransfer.getData('text/plain');
                        if (clipId) assignClipToSlot(slot.id, clipId);
                      }}
                      className={`rounded-xl border p-3 transition-all ${activeStoryboardSlot?.id === slot.id ? 'border-accent bg-accent/5 shadow-[0_0_0_1px_rgba(22,163,74,.16)]' : clip ? 'border-green-200 bg-green-50/60' : 'border-dashed border-border bg-white hover:border-accent/50'}`}
                    >
                      <div className="mb-2 grid grid-cols-[78px_minmax(0,1fr)_auto] items-start gap-2">
                        <div className="min-w-0 pt-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="rounded-md bg-slate-950 px-1.5 py-0.5 text-[10px] font-bold text-white">{index + 1}</span>
                            <span className="font-mono text-[11px] font-bold text-accent">{slot.time}</span>
                          </div>
                          <p className="mt-1 truncate text-xs font-bold text-text-primary">{slot.title}</p>
                        </div>
                        <div className="min-w-0 rounded-lg border border-border/70 bg-white/80 px-2.5 py-2">
                          <p className="mb-1 text-[9px] font-black uppercase tracking-wider text-text-muted">分镜脚本</p>
                          {slotScript.visual && (
                            <p className="line-clamp-2 text-[10px] leading-4 text-text-secondary">
                              <span className="font-black text-text-primary">画面：</span>{slotScript.visual}
                            </p>
                          )}
                          {slotScript.voice && (
                            <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-text-secondary">
                              <span className="font-black text-text-primary">口播：</span>{slotScript.voice}
                            </p>
                          )}
                          {slotScript.subtitle && (
                            <p className="mt-1 truncate rounded bg-accent/5 px-1.5 py-0.5 text-[9px] font-bold text-accent">字幕：{slotScript.subtitle}</p>
                          )}
                          {!slotScript.visual && !slotScript.voice && !slotScript.subtitle && (
                            <p className="line-clamp-3 text-[10px] leading-4 text-text-secondary">{slotScript.fallback || '该时间段暂未填写分镜脚本'}</p>
                          )}
                        </div>
                        {clip && (
                          <button type="button" onClick={() => removeSlotClip(slot.id)}
                            className="rounded-md p-1 text-text-muted hover:bg-white hover:text-red">
                            <X size={12} />
                          </button>
                        )}
                      </div>
                      {clip ? (
                        <div className="space-y-2"><div className="flex items-center gap-2 rounded-lg bg-white p-2 shadow-sm">
                          <div className="h-12 w-16 flex-shrink-0 overflow-hidden rounded-md bg-surface-2">
                            {clip.url
                              ? <RealThumb clip={clip} onSourceError={() => { void refreshMaterialSource(clip.id); }} />
                              : <Thumb seed={clip.id} src={clip.poster} label={clip.type === 'image' ? 'IMG' : fmtDur(clip.duration)} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[11px] font-bold text-text-primary">{clip.name}</p>
                            <p className="mt-0.5 text-[10px] text-text-muted">{clipSourceMode(clip) === 'online' ? '在线素材' : clipSourceMode(clip) === 'ai' ? 'AI素材' : '本地素材'} · {clip.type === 'image' ? '3s' : fmtDur(clip.duration)}</p>
                          </div>
                        </div>
                        {slotVersions.length > 0 && <div className="flex flex-wrap items-center gap-1">
                          {slotVersions.map(item => <button key={item.id} type="button" onClick={async event => {
                            event.stopPropagation();
                            await studioApi.selectVideoVersion(item.id);
                            setStoryboardVideoVersions(prev => ({ ...prev, [slot.id]: (prev[slot.id] || []).map(v => ({ ...v, isSelected: v.id === item.id })) }));
                            if (item.materialId) { setStoryboardAssignments(prev => ({ ...prev, [slot.id]: item.materialId! })); setSelected(prev => [...new Set([...prev, item.materialId!])]); }
                          }} className={`rounded-md border px-2 py-1 text-[9px] font-bold ${item.isSelected ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-white text-text-muted'}`}>V{item.versionNumber}</button>)}
                          {mode === 'clone' && <button type="button" onClick={event => { event.stopPropagation(); void generateStoryboardShot(slot, { ...sourcePlanFor(slot), mode: sourcePlanFor(slot).mode === 'hybrid' ? 'hybrid' : 'ai', decided: true, confirmed: false }); }} disabled={shotGenerating} className="rounded-md bg-slate-950 px-2 py-1 text-[9px] font-bold text-white disabled:opacity-50">{shotGenerating ? '生成中…' : '再生成一版'}</button>}
                        </div>}
                        {slotEdit && (
                          <div className="grid grid-cols-2 gap-2 rounded-lg border border-border/70 bg-white p-2" onClick={event => event.stopPropagation()}>
                            <label className="text-[9px] font-bold text-text-muted">
                              <span className="mb-1 block">目标时长（秒）</span>
                              <input
                                aria-label={`分镜${index + 1}目标时长`}
                                type="number" min={0.5} max={60} step={0.1}
                                value={Number((slotEdit.targetDuration || Math.max(0.5, slot.end - slot.start)).toFixed(2))}
                                onChange={event => patchStoryboardClipEdit(slot, clip, 'targetDuration', Number(event.target.value))}
                                className="w-full rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-[10px] text-text-primary outline-none focus:border-accent"
                              />
                            </label>
                            <label className="text-[9px] font-bold text-text-muted">
                              <span className="mb-1 block">播放速度</span>
                              <input
                                aria-label={`分镜${index + 1}播放速度`}
                                type="number" min={0.25} max={4} step={0.05}
                                value={Number(slotEdit.speed.toFixed(2))}
                                disabled={clip.type === 'image'}
                                onChange={event => patchStoryboardClipEdit(slot, clip, 'speed', Number(event.target.value))}
                                className="w-full rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-[10px] text-text-primary outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-45"
                              />
                            </label>
                            <label className="text-[9px] font-bold text-text-muted">
                              <span className="mb-1 block">素材入点（秒）</span>
                              <input
                                aria-label={`分镜${index + 1}素材入点`}
                                type="number" min={0} max={Math.max(0, clip.duration - 0.1)} step={0.1}
                                value={Number(slotEdit.trimStart.toFixed(2))}
                                disabled={clip.type === 'image'}
                                onChange={event => patchStoryboardClipEdit(slot, clip, 'trimStart', Number(event.target.value))}
                                className="w-full rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-[10px] text-text-primary outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-45"
                              />
                            </label>
                            <label className="text-[9px] font-bold text-text-muted">
                              <span className="mb-1 block">素材出点（秒）</span>
                              <input
                                aria-label={`分镜${index + 1}素材出点`}
                                type="number" min={0.1} max={Math.max(0.5, clip.duration)} step={0.1}
                                value={Number(slotEdit.trimEnd.toFixed(2))}
                                disabled={clip.type === 'image'}
                                onChange={event => patchStoryboardClipEdit(slot, clip, 'trimEnd', Number(event.target.value))}
                                className="w-full rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-[10px] text-text-primary outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-45"
                              />
                            </label>
                            <p className="col-span-2 text-[9px] leading-4 text-text-muted">
                              {clip.type === 'image' ? '图片分镜只需调整目标时长。' : '入点/出点决定取用片段；速度与目标时长会自动联动。'}
                            </p>
                          </div>
                        )}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex h-14 items-center justify-center rounded-lg border border-dashed border-border bg-surface-2 text-[11px] font-bold text-text-muted">
                            拖拽素材到这里
                          </div>
                          {mode === 'clone' && (
                            <button
                              type="button"
                              onClick={() => void generateStoryboardShot(slot, { ...sourcePlanFor(slot), mode: 'ai', decided: true, confirmed: false })}
                              disabled={shotGenerating}
                              className="flex w-full items-center justify-center gap-1 rounded-lg bg-slate-950 px-2 py-1.5 text-[10px] font-black text-white disabled:opacity-50"
                            >
                              {shotGenerating ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />}
                              {shotGenerating ? 'AI 生成中…' : 'AI 生成此分镜'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </aside>
          </div>
        );
      }

      /* ② 分镜与声音 */
      case 'script': {
        const currentModeScripts = modeScripts
          .filter(item => item.mode === mode)
          .map((item, index) => ({ item, number: modeScriptNumber(item, index) }))
          .sort((a, b) => {
            const aActive = activeModeScriptId === a.item.id;
            const bActive = activeModeScriptId === b.item.id;
            if (aActive !== bActive) return aActive ? -1 : 1;
            return a.number - b.number;
          });
        const activeQualityScript = modeScripts.find(item => item.id === activeModeScriptId && item.mode === mode);
        const activeQualityWarnings = activeQualityScript?.validationWarnings || [];
        const activeQualityIssues = activeQualityScript?.validationIssues || [];
        const activeQualityStatus = activeQualityScript?.qualityStatus;
        const activeCoveragePercent = activeQualityScript?.materialCoveragePercent;
        const activePendingMaterialScenes = activeQualityScript?.pendingMaterialScenes;
        const activeMissingMaterials = activeQualityScript?.missingMaterials || [];
        const qualityCheckLabels: Record<string, string> = {
          materialGrounded: '画面事实',
          timelineGrounded: '时间线',
          productGrounded: '产品事实',
          dialogueFits: '口播自然度',
          structurallyComplete: '分镜结构',
          ctaComplete: '主 CTA',
        };
        const activeBooleanQualityChecks = Object.entries(activeQualityScript?.qualityChecks || {})
          .filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean');
        const referenceAnalysisIncomplete = mode === 'clone' && hasIncompleteReferenceAnalysis(videoKickoff);
        const languageConfigurationRequired = !enterpriseScriptLanguage
          && modeNotice.includes('企业中心尚未配置首选输出语言或主要业务语言');
        const detectedVoiceLang = detectScriptLanguageCode(extractVoiceoverText(script) || voiceoverLines || script);
        const updatePrimaryScriptContent = (value: string) => {
          const spoken = extractVoiceoverText(value);
          const sourceLanguage = detectScriptLanguageCode(spoken || value);
          setScript(value);
          setVoiceoverLines(spoken);
          setScriptView('timestamp');
          setModeScripts(current => current.map(item => {
            if (item.id !== activeModeScriptId) return item;
            const previousReviewNotes = [
              ...(item.validationIssues || []),
              ...(item.validationWarnings || []),
            ].map(note => String(note).trim()).filter(Boolean);
            return {
              ...item,
              script: value,
              // 人工修改是有效的修正流程，改完后转为待审核，而不是永久保留失败状态。
              qualityStatus: 'warning',
              qualityChecks: undefined,
              validationWarnings: Array.from(new Set([
                '内容已手动修改，等待人工审核。',
                ...previousReviewNotes,
              ])),
              validationIssues: [],
              materialCoveragePercent: undefined,
              pendingMaterialScenes: undefined,
              missingMaterials: [],
            };
          }));
          if (spoken.trim()) {
            setVoiceDrafts(current => ({ ...current, [sourceLanguage]: spoken }));
            setVoiceDraftStaleLangs(current => [...new Set([
              ...current,
              ...voiceLangs.filter(code => code !== sourceLanguage),
            ])]);
          }
          setVoiceoverAudios({});
          setAlignedCuesByLang({});
          setLanguageRenderOutputs({});
          setRenderOutputPath('');
          setModeNotice('脚本已手动修改，请保存草稿；如需配音或成片，请重新生成对应语种配音。');
        };
        const updateVoiceScriptContent = (code: string, value: string) => {
          setVoiceDrafts(current => ({ ...current, [code]: value }));
          if (code === detectedVoiceLang) setVoiceoverLines(value);
          setActiveVoiceLang(code);
          setLang(code);
          setScriptView('voiceover');
          setVoiceDraftStaleLangs(current => current.filter(item => item !== code));
          setVoiceoverAudios(current => { const next = { ...current }; delete next[code]; return next; });
          setAlignedCuesByLang(current => { const next = { ...current }; delete next[code]; return next; });
          setLanguageRenderOutputs({});
          setRenderOutputPath('');
          setVoiceDraftNotice(`${langZh(code) || code}脚本已手动修改，请保存草稿并重新生成该语种配音。`);
        };
        const scriptPreviewTabs = [
          {
            id: 'script',
            label: '脚本',
            content: script,
            placeholder: '可直接输入或粘贴完整时间戳脚本。保存后会写入当前草稿。',
            dir: detectScriptLanguageCode(script) === 'ar' ? 'rtl' : 'ltr',
            onChange: updatePrimaryScriptContent,
          },
          {
            id: 'voiceover',
            label: `${langZh(detectedVoiceLang) || detectedVoiceLang}口播`,
            content: voiceDrafts[detectedVoiceLang] || voiceoverLines || extractVoiceoverText(script),
            placeholder: '可直接编辑当前口播台词；修改后需重新生成配音。',
            dir: detectedVoiceLang === 'ar' ? 'rtl' : 'ltr',
            onChange: (value: string) => updateVoiceScriptContent(detectedVoiceLang, value),
          },
          ...voiceLangs.filter(code => code !== detectedVoiceLang).map(code => ({
            id: `lang:${code}`,
            label: LANGS.find(item => item.code === code)?.label.split(' - ')[1] || code.toUpperCase(),
            content: voiceDrafts[code] || '',
            placeholder: `可直接编辑${langZh(code) || code}版本脚本；修改后需重新生成该语种配音。`,
            dir: code === 'ar' ? 'rtl' : 'ltr',
            onChange: (value: string) => updateVoiceScriptContent(code, value),
          })),
        ];
        const activeScriptPreview = scriptPreviewTabs.find(tab => tab.id === scriptPreviewTab) || scriptPreviewTabs[0];
        const hasFactoryEvidence = materials.some(item => item.folder === 'factory') || /工厂|产线|质检|产能|factory|production line|quality control/i.test(activeProductInfo);
        const hasCaseEvidence = /客户案例|合作案例|案例结果|customer case|case study/i.test(activeProductInfo);
        const themeUnavailableReason = (theme: VideoTheme): string => {
          if (theme.requires.includes('product') && !activeProductInfo.trim()) return '需要先选择企业中心产品';
          if (theme.requires.includes('material') && !materials.some(item => item.type !== 'audio')) return '素材库中暂无可用画面证据';
          if (theme.requires.includes('factory') && !hasFactoryEvidence) return '缺少工厂、产线、质检或产能证据';
          if (theme.requires.includes('comparison') && selectedProductIds.length < 2) return '需要至少选择两个可比较产品';
          if (theme.requires.includes('case') && !hasCaseEvidence) return '企业资料中没有已确认客户案例';
          if (theme.requires.includes('trend') && !videoKickoff) return '缺少对标内容或趋势来源';
          return '';
        };
        return (
          <div className="grid w-full min-w-0 grid-cols-1 items-start gap-5">
          <div className="min-w-0">
            <div className="flex items-center justify-between mb-4">
              <SectionTitle title="生成内容" noMargin />
            </div>

            <div className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${activeQualityStatus === 'rejected' || activeQualityStatus === 'failed' ? 'border-red-200 bg-red-50' : activeQualityWarnings.length || activeQualityIssues.length ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
              <div className="flex items-center gap-2">
                {activeQualityStatus === 'rejected' || activeQualityStatus === 'failed'
                  ? <X size={15} className="text-red-600" />
                  : activeQualityWarnings.length || activeQualityIssues.length
                    ? <Clock size={15} className="text-amber-600" />
                    : <Check size={15} className="text-emerald-600" />}
                <div>
                  <p className="text-xs font-black text-text-primary">
                    {activeQualityStatus === 'rejected' || activeQualityStatus === 'failed'
                      ? '分镜质量未通过，请先处理异常'
                      : activeQualityWarnings.length || activeQualityIssues.length
                        ? `发现 ${activeQualityWarnings.length + activeQualityIssues.length} 项需要确认`
                        : script.trim() ? '分镜检查已完成' : 'AI 将自动生成并检查分镜'}
                  </p>
                </div>
              </div>
              {typeof activeCoveragePercent === 'number' && <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-text-secondary">素材覆盖 {Math.round(activeCoveragePercent)}%</span>}
            </div>

            <div className="mb-4 grid gap-2 md:grid-cols-3">
            {([
              { id: 'theme' as const, number: 1, title: '分镜', done: Boolean(videoThemeId) && hasTimestampScript },
              { id: 'voiceover' as const, number: 2, title: '口播与翻译', done: hasRequestedVoiceDrafts },
              { id: 'audio' as const, number: 3, title: '声音', done: voiceoverMode === 'none' || hasAnyVoiceover || (voiceoverMode === 'upload' && Boolean(voiceoverUrl)) },
            ]).filter(item => scriptStageTab !== 'theme' || item.id === 'theme').map(item => (
                <button type="button" key={item.number} onClick={() => setScriptStageTab(item.id)}
                  className={`rounded-xl border px-3 py-3 text-left transition ${scriptStageTab === item.id ? 'border-accent bg-accent/5 shadow-sm' : item.done ? 'border-accent/20 bg-surface hover:border-accent/40' : 'border-border bg-surface-2 hover:border-border-bright'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-black ${item.done ? 'bg-accent text-white' : scriptStageTab === item.id ? 'border border-accent text-accent' : 'bg-white text-text-muted'}`}>
                      {item.done ? <Check size={12} /> : item.number}
                    </span>
                    <p className="text-xs font-black text-text-primary">{item.title}</p>
                  </div>
                </button>
              ))}
            </div>
            {scriptStageTab === 'theme' && (
              <div className="mb-4 rounded-2xl border border-border bg-surface p-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <label className="min-w-[220px] flex-1">
                    <span className="mb-1.5 block text-xs font-black text-text-primary">创作方案</span>
                    <span className="relative block">
                      <select
                        value={videoThemeId}
                        onChange={event => {
                          const nextTheme = VIDEO_THEMES.find(item => item.id === event.target.value as VideoThemeId) || VIDEO_THEMES[0]!;
                          setVideoThemeId(nextTheme.id);
                          setThemePainPoint(nextTheme.painPoint);
                          setThemeConversionGoal(DEFAULT_VIDEO_CONVERSION_GOAL);
                          if (script.trim()) setModeNotice(`主题已切换为“${nextTheme.title}”，请重新生成分镜。`);
                        }}
                        className="h-10 w-full appearance-none rounded-xl border border-border bg-surface-2 px-3 pr-9 text-sm font-semibold text-text-primary outline-none focus:border-accent"
                      >
                        {VIDEO_THEMES.map(theme => <option key={theme.id} value={theme.id}>{theme.title}</option>)}
                      </select>
                      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" />
                    </span>
                  </label>
                  <span className="rounded-full bg-accent/10 px-2.5 py-1.5 text-[10px] font-black text-accent">AI 策略已匹配</span>
                </div>
                {themeUnavailableReason(activeVideoTheme) && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
                    <div>
                      <p className="text-xs font-black text-amber-900">缺少：{themeUnavailableReason(activeVideoTheme)}</p>
                      <p className="mt-1 text-[11px] text-amber-700">当前可先生成：产品识别 + 钩子结构</p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setStepIdx(STEPS.findIndex(item => item.id === 'material'))} className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-[11px] font-black text-amber-800">选择其他素材</button>
                      <button type="button" onClick={() => {
                        createScriptGapTask({ title: themeUnavailableReason(activeVideoTheme), productLabel: activeProductLabel || '当前产品', themeTitle: activeVideoTheme.title, shotBrief: `补拍可用于“${activeVideoTheme.title}”的${themeUnavailableReason(activeVideoTheme)}镜头`, suggestedDurationSec: 3, sourceProjectId: projectId || undefined, sourceStoryboardSlotId: activeStoryboardSlotId || undefined });
                        setModeNotice('已创建建议补拍任务，可在灵感中心 → 拍摄任务查看。');
                      }} className="rounded-lg bg-amber-600 px-3 py-2 text-[11px] font-black text-white">创建建议补拍</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {(scriptStageTab === 'theme' || scriptStageTab === 'script') && (
            <>
            <div className="mb-4 rounded-2xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-text-primary">分镜内容</p>
                  <p className="mt-1 text-xs text-text-muted">{script.trim() ? '已生成，可直接检查和修改' : '确认后由 AI 生成首版分镜'}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${modeActionLoading ? 'bg-amber-50 text-amber-700' : script.trim() ? 'bg-emerald-50 text-emerald-700' : 'bg-surface-2 text-text-muted'}`}>
                  {modeActionLoading ? (modeActionStatus || '生成中') : script.trim() ? '已生成' : '待生成'}
                </span>
              </div>
              {mode === 'clone' && !videoKickoff?.referenceAnalysis?.details?.length && (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700">
                  当前为旧版草稿，未保存对标逐镜分析；请返回灵感中心完成全片精确分析后再生成脚本。
                </p>
              )}
              {modeNotice && (
                <div
                  role="status"
                  aria-live="polite"
                  className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold leading-relaxed text-amber-800"
                >
                  <span className="min-w-0 flex-1">{modeNotice}</span>
                  {referenceAnalysisIncomplete && (
                    <button
                      type="button"
                      onClick={() => window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'socialInspiration', view: 'materials' } }))}
                      className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[10px] font-black text-amber-800 hover:bg-amber-100"
                    >
                      返回灵感中心补全分析
                    </button>
                  )}
                  {languageConfigurationRequired && (
                    <button
                      type="button"
                      onClick={() => {
                        window.sessionStorage.setItem('lingshu:enterprise-focus', 'language-settings');
                        onNavigate?.('enterprise');
                      }}
                      className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[10px] font-black text-amber-800 hover:bg-amber-100"
                    >
                      前往企业中心配置
                    </button>
                  )}
                </div>
              )}
              {activeQualityScript && (activeQualityStatus || activeQualityWarnings.length > 0 || activeCoveragePercent !== undefined) && (
                <div className={`mt-3 rounded-xl border px-3 py-3 ${
                  activeQualityStatus === 'rejected' || activeQualityStatus === 'failed'
                    ? 'border-rose-200 bg-rose-50'
                    : activeQualityStatus === 'needs_material'
                    ? 'border-amber-200 bg-amber-50'
                    : activeQualityStatus === 'passed_with_warnings' || activeQualityStatus === 'warning' || activeQualityWarnings.length
                      ? 'border-sky-200 bg-sky-50'
                      : 'border-emerald-200 bg-emerald-50'
                }`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className={`text-xs font-black ${activeQualityStatus === 'rejected' || activeQualityStatus === 'failed' ? 'text-rose-900' : activeQualityStatus === 'needs_material' ? 'text-amber-900' : activeQualityStatus === 'passed_with_warnings' || activeQualityStatus === 'warning' || activeQualityWarnings.length ? 'text-sky-900' : 'text-emerald-900'}`}>
                      {activeQualityStatus === 'rejected' || activeQualityStatus === 'failed'
                        ? '草稿已生成待人工审核'
                        : activeQualityStatus === 'needs_material'
                        ? '脚本可用 · 需要补充素材'
                        : activeQualityStatus === 'passed_with_warnings' || activeQualityStatus === 'warning' || activeQualityWarnings.length
                          ? '脚本可用 · 请确认质量提示'
                          : '脚本质量检查通过'}
                    </p>
                    {activeCoveragePercent !== undefined && (
                      <span className="rounded-lg bg-white px-2 py-1 text-[10px] font-black text-amber-800 shadow-sm">
                        素材覆盖 {Math.round(activeCoveragePercent)}%
                      </span>
                    )}
                  </div>
                  {activeQualityStatus === 'needs_material' && (
                    <p className="mt-2 text-[11px] leading-5 text-amber-800">
                      {activePendingMaterialScenes !== undefined ? `还有 ${activePendingMaterialScenes} 个分镜待匹配。` : '未覆盖分镜已保留为“待匹配素材”。'}不会丢失脚本；补齐素材后再进入最终成片。
                    </p>
                  )}
                  {(activeQualityStatus === 'rejected' || activeQualityStatus === 'failed') && (
                    <div className="mt-2 text-[11px] leading-5 text-rose-800">
                      {activeQualityIssues.length > 0 && (
                        <ul className="space-y-1">
                          {activeQualityIssues.slice(0, 4).map((issue, index) => <li key={`${issue}-${index}`}>• {issue}</li>)}
                        </ul>
                      )}
                    </div>
                  )}
                  {activeMissingMaterials.length > 0 && (
                    <p className="mt-1 text-[11px] leading-5 text-amber-800">
                      待补：{activeMissingMaterials.slice(0, 4).join('、')}{activeMissingMaterials.length > 4 ? ` 等 ${activeMissingMaterials.length} 项` : ''}
                    </p>
                  )}
                  {activeQualityWarnings.length > 0 && (
                    <ul className="mt-2 space-y-1 text-[11px] leading-5 text-sky-800">
                      {activeQualityWarnings.slice(0, 4).map((warning, index) => <li key={`${warning}-${index}`}>• {warning}</li>)}
                    </ul>
                  )}
                  {activeBooleanQualityChecks.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {activeBooleanQualityChecks.map(([key, passed]) => (
                        <span key={key} className={`rounded-md border px-2 py-1 text-[9px] font-bold ${passed ? 'border-emerald-200 bg-white text-emerald-700' : 'border-amber-200 bg-white text-amber-700'}`}>
                          {passed ? '✓' : '待确认'} {qualityCheckLabels[key] || key}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {currentModeScripts.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {currentModeScripts.map(({ item, number }) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => openModeScript(item)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${activeModeScriptId === item.id ? 'border-accent bg-accent-glow text-accent' : 'border-border bg-white text-text-muted hover:text-text-secondary'}`}
                    >
                      {item.title}
                      {item.qualityStatus === 'rejected' || item.qualityStatus === 'failed' ? ' · 人工待审核' : item.qualityStatus === 'needs_material' ? ' · 待补素材' : item.qualityStatus === 'passed_with_warnings' || item.qualityStatus === 'warning' || item.validationWarnings?.length ? ' · 人工待审核' : ''}
                      {activeModeScriptId === item.id ? ' · 当前' : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
            </>
            )}

            {scriptStageTab === 'voiceover' && (
            <div className="mb-5 rounded-2xl border border-border bg-surface p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-text-primary">提取口播与多语种字幕</p>
                  <p className="mt-1 text-xs text-text-muted">从时间戳脚本里提取口播台词，保留时间段，再生成不同语种版本。</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void generateVoiceDrafts()}
                    disabled={voiceDraftLoading || !hasTimestampScript || !voiceLangs.length}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                  >
                    {voiceDraftLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    {voiceDraftLoading ? `翻译中 ${voiceLangs.length - voiceDraftPendingLangs.length}/${voiceLangs.length}` : '提取口播并翻译'}
                  </button>
                  {voiceDraftLoading && (
                    <button
                      type="button"
                      onClick={cancelVoiceDraftGeneration}
                      className="inline-flex items-center gap-1 rounded-xl border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary hover:border-red-200 hover:text-red-600"
                    >
                      <X size={12} /> 取消
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-accent/20 bg-accent-glow px-3 py-2">
                <span className="text-[10px] font-black text-accent">企业中心语种</span>
                {voiceLangs.length ? voiceLangs.map(code => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => { setActiveVoiceLang(code); setLang(code); }}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                      activeVoiceLang === code
                        ? 'border-accent bg-accent text-white'
                        : 'border-accent/30 bg-white text-accent hover:border-accent'
                    }`}
                  >
                    {langZh(code) || code}
                  </button>
                )) : (
                  <span className="text-xs font-semibold text-amber-700">企业中心尚未配置口播语言，请先到企业中心设置。</span>
                )}
              </div>
              {voiceDraftNotice && (
                <div className={`mt-3 rounded-xl border px-3 py-2 text-xs font-semibold ${
                  voiceDraftNotice.includes('失败') || voiceDraftNotice.includes('没有可提取')
                    ? 'border-red-100 bg-red-50 text-red-600'
                    : voiceDraftNotice.includes('取消') || voiceDraftNotice.includes('超时')
                      ? 'border-amber-200 bg-amber-50 text-amber-700'
                    : 'border-accent/20 bg-accent-glow text-accent'
                }`}>
                  {voiceDraftNotice}
                </div>
              )}
              {Object.keys(voiceDrafts).length > 0 && (
                <div className="mt-4 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {voiceLangs.map(code => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => { setActiveVoiceLang(code); setLang(code); }}
                        className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${activeVoiceLang === code ? 'bg-accent text-white' : 'bg-surface-2 text-text-muted hover:text-text-secondary'}`}
                      >
                        {LANGS.find(l => l.code === code)?.label || code}
                        {voiceoverAudios[code] && <span className="ml-1 opacity-80">已配音</span>}
                        {voiceDraftPendingLangs.includes(code)
                          ? <span className="ml-1 text-emerald-600">翻译中</span>
                          : voiceDraftFailedLangs.includes(code)
                            ? <span className="ml-1 text-red-600">翻译失败</span>
                            : voiceDraftStaleLangs.includes(code)
                              ? <span className="ml-1 text-amber-600">待同步</span>
                              : voiceDraftDegradedLangs.includes(code) && <span className="ml-1 text-amber-600">本地兜底</span>}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={voiceDrafts[activeVoiceLang] || ''}
                    placeholder={voiceDraftPendingLangs.includes(activeVoiceLang)
                      ? '正在翻译该语种，请稍候…'
                      : voiceDraftFailedLangs.includes(activeVoiceLang)
                        ? '该语种翻译失败，可点击“提取口播并翻译”重试。'
                        : '请输入该语种口播内容。'}
                    onChange={e => {
                      const nextValue = e.target.value;
                      const sourceLanguage = detectScriptLanguageCode(voiceoverLines || script);
                      setVoiceDrafts(drafts => ({ ...drafts, [activeVoiceLang]: nextValue }));
                      if (nextValue.trim()) {
                        setVoiceDraftFailedLangs(current => current.filter(code => code !== activeVoiceLang));
                        setVoiceDraftStaleLangs(current => current.filter(code => code !== activeVoiceLang));
                      }
                      setVoiceDraftDegradedLangs(current => current.filter(code => code !== activeVoiceLang));
                      setVoiceoverAudios(current => { const next = { ...current }; delete next[activeVoiceLang]; return next; });
                      setAlignedCuesByLang(current => { const next = { ...current }; delete next[activeVoiceLang]; return next; });
                      if (activeVoiceLang === sourceLanguage) setVoiceDraftStaleLangs(current => [...new Set([...current, ...voiceLangs.filter(code => code !== sourceLanguage)])]);
                    }}
                    rows={6}
                    dir={activeVoiceLang === 'ar' ? 'rtl' : 'ltr'}
                    className="w-full rounded-xl border border-border bg-surface-2 p-3 font-mono text-sm leading-7 text-text-secondary outline-none focus:border-accent resize-none"
                  />
                  {voiceDraftStaleLangs.includes(activeVoiceLang) && (
                    <p className="text-xs font-semibold text-amber-700">主脚本已更新，此语言版本尚未同步。点击上方“提取口播并翻译”会重新本地化。</p>
                  )}
                  {voiceDraftFailedLangs.includes(activeVoiceLang) && (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                      <span>该语种未完成，其他已成功文案不受影响。可直接手工填写。</span>
                      <button type="button" onClick={() => void retryVoiceDraft(activeVoiceLang)} className="shrink-0 rounded-lg border border-red-200 bg-white px-2 py-1 font-bold">仅重试当前语种</button>
                    </div>
                  )}
                  {voiceDraftDegradedLangs.includes(activeVoiceLang) && !voiceDraftStaleLangs.includes(activeVoiceLang) && (
                    <p className="text-xs font-semibold text-amber-700">上游暂时不可用，已使用经审核的房地产保时轴本地兜底；建议确认措辞后配音。</p>
                  )}
                </div>
              )}
            </div>
            )}

            {scriptStageTab === 'audio' && (<>
            <Field label="配音方式">
              <input ref={voiceoverInputRef} type="file" accept="audio/*" className="hidden"
                onChange={e => { void handleVoiceoverUpload(e.target.files); e.target.value = ''; }} />
              <input ref={voiceSampleInputRef} type="file" accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/x-wav,audio/mp4" className="hidden"
                onChange={e => { void handleVoiceSampleUpload(e.target.files); e.target.value = ''; }} />
              <div className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-border bg-surface-2 p-1">
                {[
                  { id: 'none' as const, icon: <X size={15} />, title: '不配音', desc: '仅保留画面与字幕' },
                  { id: 'ai' as const, icon: <Mic size={15} />, title: 'AI 配音', desc: '按当前语种生成口播' },
                  { id: 'upload' as const, icon: <Upload size={15} />, title: '上传本地音频', desc: uploadedVoiceName || 'mp3 / wav / m4a' },
                ].map(option => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      if (option.id === 'none') clearVoiceover();
                      if (option.id === 'ai') setVoiceoverMode('ai');
                      if (option.id === 'upload') voiceoverInputRef.current?.click();
                    }}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-all ${voiceoverMode === option.id ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}
                  >
                    <div className="flex h-6 w-6 items-center justify-center rounded-md"
                      style={{ background: voiceoverMode === option.id ? TRAFFIC_GREEN : 'transparent', color: voiceoverMode === option.id ? '#fff' : 'var(--color-text-muted)' }}>
                      {option.icon}
                    </div>
                    <span>
                      <span className="block text-xs font-bold">{option.title}</span>
                      <span className="block max-w-[130px] truncate text-[9px] text-text-muted">{option.desc}</span>
                    </span>
                  </button>
                ))}
              </div>

              {voiceoverMode === 'ai' && (
                <div className="mt-3 flex max-w-2xl flex-wrap items-end gap-2">
                  <div className="basis-full">
                    <span className="mb-1.5 block text-[10px] font-bold text-text-muted">音色候选（可多选）</span>
                    <div className="flex flex-wrap gap-2">
                      {[...VOICES, ...customVoices.map(item => ({ id: item.voiceId, name: item.name, tag: '自定义音色' })), ...(customVoiceId && customVoiceName && !customVoices.some(item => item.voiceId === customVoiceId) ? [{ id: customVoiceId, name: customVoiceName, tag: '自定义音色' }] : [])].map(item => {
                        const selectedCandidate = voiceCandidates.includes(item.id);
                        const activeCandidate = voice === item.id;
                        return <button key={item.id} type="button" onClick={() => {
                          const next = selectedCandidate ? voiceCandidates.filter(id => id !== item.id) : [...voiceCandidates, item.id];
                          if (!next.length) return;
                          setVoiceCandidates(next);
                          const nextActive = !selectedCandidate ? item.id : activeCandidate ? next[0]! : voice;
                          if (!selectedCandidate || activeCandidate) {
                            const stored = customVoices.find(candidate => candidate.voiceId === nextActive);
                            setCustomVoiceId(stored?.voiceId || ''); setCustomVoiceName(stored?.name || ''); setCustomVoiceUrl(stored?.url || '');
                            pickVoice(nextActive);
                          }
                        }} className={`rounded-xl border px-3 py-2 text-left text-xs transition ${activeCandidate ? 'border-accent bg-accent/10 text-accent' : selectedCandidate ? 'border-accent/40 bg-white text-text-primary' : 'border-border bg-white text-text-muted'}`}>
                          <span className="block font-bold">{item.name}</span><span className="mt-0.5 block text-[9px] opacity-70">{item.tag}{activeCandidate ? ' · 当前试听' : ''}</span>
                        </button>;
                      })}
                    </div>
                  </div>
                  <button type="button" onClick={openVoiceSamplePicker}
                    className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border bg-white px-3 text-xs font-bold text-text-secondary hover:border-accent hover:text-accent">
                    <Plus size={13} />增加新音色
                  </button>
                </div>
              )}

              {voiceoverMode === 'ai' && (
                <details data-lingshu-guide="ai-voice" className="group mt-3 max-w-2xl rounded-xl border border-border bg-surface-2">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-xs font-bold text-text-secondary [&::-webkit-details-marker]:hidden">
                    <span>高级配音设置</span>
                    <span className="flex items-center gap-2 text-[10px] font-medium text-text-muted">
                      {TTS_PRESETS.find(item => item.id === ttsPreset)?.label} · {ttsSpeed.toFixed(2)}x
                      <ChevronDown size={13} className="transition group-open:rotate-180" />
                    </span>
                  </summary>
                  <div className="border-t border-border p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-black text-text-primary">表达方式与目标时长</p>
                      <p className="mt-0.5 text-[10px] font-bold text-text-muted">当前：{LANGS.find(item => item.code === activeVoiceLang)?.label || activeVoiceLang} · 约 {duration}s</p>
                    </div>
                    <select value={ttsPreset} onChange={e => applyTtsPreset(e.target.value as TtsStyleOptions['preset'])}
                      className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-bold text-text-secondary outline-none">
                      {TTS_PRESETS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                  </div>
                  {mode === 'clone' && referenceVoice.available && (
                    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent/20 bg-accent/5 px-3 py-2">
                      <span className="text-[10px] font-bold text-text-primary">爆款裂变专属</span>
                      <button type="button" onClick={toggleReferenceVoiceStyle}
                        className={`rounded-lg px-2.5 py-1 text-[10px] font-bold ${useReferenceVoiceStyle ? 'bg-accent text-white' : 'border border-border bg-white text-text-muted'}`}>
                        沿用对标口播节奏
                      </button>
                      <span className="text-[10px] text-text-muted">{useReferenceVoiceStyle ? `已开启 · ${referenceVoice.summary}` : '已关闭 · 使用手动配音参数'}</span>
                    </div>
                  )}
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_150px_150px]">
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-bold text-text-muted">情绪描述</span>
                      <input value={ttsEmotion} onChange={e => { setTtsEmotion(e.target.value); setVoiceoverUrl(null); }}
                        className="w-full rounded-lg border border-border bg-white px-2.5 py-2 text-xs text-text-primary outline-none focus:border-accent" />
                    </label>
                    <label className="block">
                      <span className="mb-1 flex justify-between text-[10px] font-bold text-text-muted"><span>情绪强度</span><span>{ttsEmotionIntensity}%</span></span>
                      <input type="range" min={0} max={100} value={ttsEmotionIntensity}
                        onChange={e => { setTtsEmotionIntensity(+e.target.value); setVoiceoverUrl(null); }} className="w-full accent-[#16a34a]" />
                    </label>
                    <label className="block">
                      <span className="mb-1 flex justify-between text-[10px] font-bold text-text-muted"><span>语速</span><span>{ttsSpeed.toFixed(2)}x</span></span>
                      <input type="range" min={75} max={135} value={Math.round(ttsSpeed * 100)}
                        onChange={e => { setTtsSpeed(+e.target.value / 100); setVoiceoverUrl(null); }} className="w-full accent-[#16a34a]" />
                    </label>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-bold text-text-muted">口播停顿</span>
                      <select value={ttsPauseStyle} onChange={e => { setTtsPauseStyle(e.target.value as typeof ttsPauseStyle); setVoiceoverUrl(null); }}
                        className="w-full rounded-lg border border-border bg-white px-2.5 py-2 text-xs text-text-primary outline-none focus:border-accent">
                        <option value="few">少停顿</option>
                        <option value="natural">自然停顿</option>
                        <option value="dramatic">戏剧性停顿</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-bold text-text-muted">品牌/术语读法（每行：原词=期望读法）</span>
                      <textarea value={ttsPronunciationText} onChange={e => { setTtsPronunciationText(e.target.value); setVoiceoverUrl(null); }} rows={3}
                        placeholder={'GUIANFA=G U I A N F A\nST-ELLICE=ess tee eh-liss\nMOQ=M O Q'}
                        className="w-full rounded-lg border border-border bg-white px-2.5 py-2 font-mono text-[10px] text-text-primary outline-none focus:border-accent resize-none" />
                      <span className="mt-1 block text-[10px] leading-relaxed text-text-muted">逐字母读用空格分开；连读就写近似音节，例如 GUIANFA=gui-an-fa。重新生成配音后生效。</span>
                    </label>
                  </div>
                  <div className={`mt-3 rounded-xl border px-3 py-2 text-[10px] leading-relaxed ${audioCapabilities?.customVoice.synthesis ? 'border-accent/20 bg-accent/5 text-accent' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>{audioCapabilities?.customVoice.message || '正在检测品牌音色引擎…'}</span>
                      <button type="button" onClick={() => void diagnoseMinimax()} disabled={minimaxDiagnosing || !audioCapabilities?.minimax?.configured}
                        className="inline-flex items-center gap-1 rounded-lg border border-current/20 bg-white/70 px-2 py-1 font-bold disabled:opacity-50">
                        {minimaxDiagnosing ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}检查服务
                      </button>
                    </div>
                    {minimaxDiagnostic && <p className={`mt-1 font-semibold ${minimaxDiagnostic.includes('失败') ? 'text-red-600' : ''}`}>{minimaxDiagnostic}</p>}
                  </div>
                  </div>
                </details>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2 max-w-xl">
                {voiceoverMode === 'ai' && voiceLangs.length > 1 && Object.keys(voiceDrafts).length > 0 && (
                  <div className="basis-full mb-1 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-2 p-2">
                    <span className="px-1 text-[10px] font-black text-text-muted">试听语种</span>
                    <div className="flex flex-wrap gap-1">
                      {voiceLangs.map(code => {
                        const hasAudio = Boolean(voiceoverAudios[code]?.url);
                        const active = activeVoiceLang === code;
                        return (
                          <button
                            key={`listen-lang-${code}`}
                            type="button"
                            onClick={() => switchVoicePreviewLanguage(code)}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-bold transition ${
                              active
                                ? 'bg-accent text-white'
                                : hasAudio
                                  ? 'bg-white text-text-secondary hover:text-accent'
                                  : 'bg-white text-text-muted opacity-75'
                            }`}
                          >
                            {langZh(code) || code}
                            <span className={`rounded px-1 py-0.5 text-[9px] ${active ? 'bg-white/20 text-white' : hasAudio ? 'bg-accent-glow text-accent' : 'bg-surface-2 text-text-muted'}`}>
                              {hasAudio ? '可试听' : '待生成'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {voiceoverMode === 'ai' && (
	                  <button
                        type="button"
	                    onClick={() => void genTts()}
	                    disabled={ttsLoading || !hasRequestedVoiceDrafts || (voice.startsWith('custom:') && audioCapabilities?.customVoice.synthesis === false)}
	                    aria-busy={batchTtsLoading}
	                    className="inline-flex min-w-[214px] items-center justify-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
	                  >
	                    {batchTtsLoading ? <Loader2 size={12} className="animate-spin" /> : <Mic size={13} />}
	                    {batchTtsLoading ? `正在生成 ${voiceLangs.length || 1} 个语种试听配音…` : `生成 ${voiceLangs.length || 1} 个语种试听配音`}
	                  </button>
                )}
                {voiceoverMode === 'ai' && voiceLangs.length > 1 && (
                  <button type="button" onClick={() => void genTts(activeVoiceLang)}
                    disabled={ttsLoading || !voiceDrafts[activeVoiceLang]?.trim() || (voice.startsWith('custom:') && audioCapabilities?.customVoice.synthesis === false)}
                    aria-busy={singleTtsLoading}
                    className={`inline-flex min-w-[154px] items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition disabled:opacity-50 ${singleTtsLoading ? 'border-accent bg-accent text-white' : 'border-accent text-accent'}`}>
                    {singleTtsLoading ? <Loader2 size={12} className="animate-spin" /> : <Languages size={13} />}
                    {singleTtsLoading ? '正在生成当前语言…' : '只生成当前语言'}
                  </button>
                )}
                {voiceoverMode === 'ai' && !hasRequestedVoiceDrafts && (
                  <span className="basis-full text-xs font-semibold text-text-muted">请先完成口播提取与多语种翻译，再生成试听配音。</span>
                )}
	                {voiceoverMode === 'upload' && (
	                  <button
	                    onClick={() => voiceoverInputRef.current?.click()}
                    disabled={ttsLoading}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                  >
                    {ttsLoading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={13} />}
	                    {uploadedVoiceName ? '重新上传音频' : '上传本地音频'}
	                  </button>
	                )}
                {voiceoverMode === 'ai' && voice.startsWith('custom:') && customVoiceName && (
                  <div className="basis-full rounded-xl border border-accent/20 bg-accent-glow px-3 py-2 text-xs font-semibold text-accent">
                    当前使用真人音色：{customVoiceName}{customVoiceUrl ? '。' : '。'} 跨语言可保持品牌声线，但与录音语言不同的版本可能带原语言口音，建议逐语种试听确认。
                  </div>
                )}
                {voiceoverUrl && (
                  <button
                    type="button"
                    onClick={toggleTts}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold text-text-secondary hover:text-text-primary"
                  >
                    {ttsPlaying ? <Pause size={12} /> : <Play size={12} />}
                    {ttsPlaying ? '暂停音频' : '只听配音'}
                  </button>
                )}
                <span className="text-xs text-text-muted">
                  {voiceoverMode === 'none' ? '当前成片不会混入口播音频，但仍可保留字幕。' : '音频会用于后续成片预览与导出。'}
                </span>
                {ttsNotice && (
                  <span className={`basis-full text-xs font-semibold ${voiceoverUrl ? 'text-accent' : 'text-red-500'}`}>
                    {ttsNotice}
                  </span>
                )}
              </div>
              <audio ref={ttsAudioRef} onEnded={() => setTtsPlaying(false)} className="hidden" />
            </Field>
            {voiceoverUrl && (
              <div id="subtitle-effect-preview" className="mt-5 scroll-mt-5 rounded-2xl border border-border bg-surface p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-text-primary">分镜画面 + AI 口播同步确认</p>
                    <p className="mt-1 text-xs text-text-muted">
                      当前 {langZh(activeVoiceLang) || activeVoiceLang} · 录音 {voiceoverDur || 0}s · 字幕 {cues.length} 条 · 素材 {selectedClips.length} 段
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {voiceoverMode === 'ai' && voiceLangs.length > 1 && (
                      <div className="flex flex-wrap gap-1 rounded-xl bg-surface-2 p-1">
                        {voiceLangs.map(code => {
                          const hasAudio = Boolean(voiceoverAudios[code]?.url);
                          return (
                            <button
                              key={`preview-lang-${code}`}
                              type="button"
                              onClick={() => switchVoicePreviewLanguage(code)}
                              disabled={!hasAudio}
                              className={`rounded-lg px-2.5 py-1.5 text-[10px] font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${activeVoiceLang === code ? 'bg-accent text-white' : 'bg-white text-text-muted hover:text-accent'}`}
                            >
                              {langZh(code) || code}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <button onClick={() => downloadSubtitleFile(cues, 'srt', activeVoiceLang)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold text-text-secondary">
                      <Download size={12} /> SRT
                    </button>
                    <button onClick={() => downloadSubtitleFile(cues, 'vtt', activeVoiceLang)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold text-text-secondary">
                      <Download size={12} /> VTT
                    </button>
                    <button
                      onClick={startVoiceAssemblyPreview}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white"
                    >
                      <Play size={12} /> 播放预览
                    </button>
                    {voicePreviewIdx !== null && (
                      <button
                        onClick={stopVoiceAssemblyPreview}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold text-text-secondary"
                      >
                        <X size={12} /> 停止
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid min-w-0 grid-cols-1 gap-4">
                  <div className="relative overflow-hidden rounded-2xl border border-border bg-black" style={{ aspectRatio: '9 / 16' }}>
                    {voicePreviewIdx !== null && previewable[voicePreviewIdx] ? (
                      <video
                        src={previewable[voicePreviewIdx].url}
                        autoPlay
                        muted
                        playsInline
                        className="absolute inset-0 h-full w-full object-cover"
                        onEnded={() => setVoicePreviewIdx(i => (i !== null && i + 1 < previewable.length ? i + 1 : null))}
                      />
                    ) : (
                      <CoverFace coverUrl={coverUrl} frameUrl={coverFrameUrl} frameType={coverClip?.poster ? 'image' : coverClip?.type} fallbackVideoUrl={coverClip?.type === 'video' ? coverClip.url : undefined} title={coverTitle} style={coverStyle} />
                    )}
                    {subtitlesOn && cues[subPreviewIdx] && (
                      <div className="absolute inset-x-0 bottom-[26%] z-10 px-3 text-center pointer-events-none">
                        <p className="leading-snug text-white text-[12px] font-bold" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}>
                          {cues[subPreviewIdx].words?.length
                            ? cues[subPreviewIdx].words!.map((word, wordIndex) => (
                                <span key={`${word.start}-${wordIndex}`} style={ttsCurrentTime >= word.start && ttsCurrentTime < word.end ? { color: '#86efac' } : undefined}>
                                  {word.text}
                                </span>
                              ))
                            : cues[subPreviewIdx].text}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="mb-3 rounded-xl border border-accent/20 bg-accent-glow px-3 py-2 text-xs leading-5 text-accent">
                      下方是<strong>口播音轨的句级时间</strong>，用于校准配音与字幕，不是分镜切换时间。系统会先按当前语种的真实配音总时长自动校准分镜；进入素材匹配后仍可逐镜微调目标时长、素材入点、出点和速度。
                    </div>
                    <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
                      {cues.map((cue, i) => (
                        <div key={`${cue.start}-${i}`} onClick={() => setSubPreviewIdx(i)}
                          className={`rounded-lg border px-2.5 py-2 text-xs transition ${i === subPreviewIdx ? 'border-accent/30 bg-accent-glow' : 'border-transparent hover:bg-surface-2'}`}>
                          <div className="mb-1 flex flex-wrap items-center gap-1.5">
                            <input type="number" min={0} step={0.05} value={cue.start}
                              onChange={e => patchAlignedCue(i, { start: Math.max(0, +e.target.value) })}
                              className="w-16 rounded border border-border bg-white px-1.5 py-1 font-mono text-[10px] text-text-muted" />
                            <span className="text-text-muted">–</span>
                            <input type="number" min={0} step={0.05} value={cue.end}
                              onChange={e => patchAlignedCue(i, { end: Math.max(cue.start + 0.1, +e.target.value) })}
                              className="w-16 rounded border border-border bg-white px-1.5 py-1 font-mono text-[10px] text-text-muted" />
                            <span className="basis-full whitespace-nowrap text-[9px] font-bold text-text-muted sm:ml-auto sm:basis-auto">{cue.words?.length ? `口播音轨 · ${cue.words.length} 词已对齐` : '口播音轨 · 句级时间'}</span>
                          </div>
                          <textarea value={cue.text} rows={2} onChange={e => patchAlignedCue(i, { text: e.target.value })}
                            className="w-full resize-none rounded border border-border bg-white px-2 py-1.5 text-xs leading-5 text-text-secondary outline-none focus:border-accent" />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
            </>)}
          </div>
          <aside className="sticky top-0 min-w-0 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
            <div className="border-b border-border px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-text-primary">生成内容</p>
                  <p className="mt-0.5 text-[10px] text-text-muted">脚本、口播与多语言版本</p>
                </div>
                <div className="flex max-w-full flex-wrap justify-end gap-1">
                  {scriptPreviewTabs.map(tab => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setScriptPreviewTab(tab.id);
                        if (tab.id.startsWith('lang:')) {
                          const code = tab.id.slice(5);
                          setActiveVoiceLang(code);
                          setLang(code);
                        }
                      }}
                      className={`rounded-lg px-2.5 py-1.5 text-[10px] font-bold transition ${activeScriptPreview.id === tab.id ? 'bg-accent text-white' : 'bg-surface-2 text-text-muted hover:text-text-secondary'}`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="min-h-[520px] p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="rounded-md bg-accent-glow px-2 py-1 text-[10px] font-black text-accent">{activeScriptPreview.label}</span>
                <div className="flex items-center gap-2">
                  {activeScriptPreview.content && (
                    <button type="button" onClick={() => void navigator.clipboard?.writeText(activeScriptPreview.content)} className="inline-flex items-center gap-1 text-[10px] font-bold text-text-muted hover:text-accent">
                      <Copy size={11} /> 复制
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void saveProject('draft').catch(error => {
                      alert(error instanceof Error ? error.message : '草稿保存失败，请稍后重试。');
                    })}
                    disabled={savingProj || voiceDraftLoading || ttsLoading}
                    className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[10px] font-black text-white disabled:opacity-50"
                  >
                    {savingProj ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                    {savedTick ? '已保存' : '保存'}
                  </button>
                </div>
              </div>
              <textarea
                value={activeScriptPreview.content}
                onChange={event => activeScriptPreview.onChange(event.target.value)}
                placeholder={activeScriptPreview.placeholder}
                dir={activeScriptPreview.dir}
                spellCheck={false}
                className="min-h-[430px] max-h-[620px] w-full resize-y overflow-y-auto rounded-xl border border-border bg-white p-4 font-sans text-xs leading-6 text-text-secondary outline-none focus:border-accent focus:bg-white"
              />
              {pendingClaimLocations(activeScriptPreview.content, activeProductInfo).length > 0 && (
                <div className="mt-3 space-y-2">
                  {pendingClaimLocations(activeScriptPreview.content, activeProductInfo).map((line, index) => <div key={`${line}-${index}`} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800"><span className="mr-1 font-black">待确认：</span>{line}</div>)}
                </div>
              )}
              {!activeScriptPreview.content && (
                <div className="mt-3 flex min-h-[120px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-2 px-8 text-center">
                  <FileText size={28} className="text-text-muted opacity-35" />
                  <p className="mt-3 text-xs font-bold text-text-secondary">{activeScriptPreview.id === 'script' ? '尚未生成脚本，也可以直接手动填写' : '尚未生成此版本，也可以直接手动填写'}</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-text-muted">输入后点击“保存”，后续配音、素材匹配和成片会使用这里的最新内容。</p>
                </div>
              )}
            </div>
          </aside>
          </div>
        );
      }

      /* ④ 配乐 */
      case 'bgm': {
        const visibleBgms = bgmTab === 'favorites'
          ? bgms.filter(track => favoriteBgms.includes(track.id))
          : bgms;
        const activeBgmPreviewItem = previewIdx !== null ? previewTimeline[previewIdx] : null;
        const bgmPreviewDuration = previewTimeline.reduce((sum, item) => sum + Math.max(0.5, item.targetDuration || 0), 0);
        const firstBgmPreviewClip = previewTimeline[0]?.clip;
        const bgmPreviewPoster = firstBgmPreviewClip?.poster || (firstBgmPreviewClip?.type === 'image' ? firstBgmPreviewClip.url : coverFrameUrl);
        const generatedLanguages = voiceLangs.filter(code => voiceDrafts[code]?.trim());
        const effectiveLanguages = generatedLanguages.length ? generatedLanguages : [activeVoiceLang];
        const materialVersions = contentPlanVersions.flatMap((plan, planIndex) => effectiveLanguages.map((code, languageIndex) => ({
          key: materialVersionKey(plan.id, code), plan, code,
          name: `${plan.name || `视频${planIndex + 1}`} * ${langZh(code) || `语种${languageIndex + 1}`}`,
          language: LANGS.find(item => item.code === code)?.label || code.toUpperCase(),
          materialCount: timelineForAssembly(plan, code).length,
          hasScript: Boolean(voiceDrafts[code]?.trim()),
          hasAudio: voiceoverMode !== 'ai' || Boolean(voiceoverAudios[code]?.url),
        })));
        const activeVersionKey = materialVersionKey(activeAssemblyId, activeVoiceLang);
        const assignBgm = (trackId: string) => {
          setBgm(trackId);
          setAssemblyBgms(current => ({ ...current, [activeAssemblyId]: trackId }));
          setMaterialVersionBgms(current => ({ ...current, [activeVersionKey]: trackId }));
        };
        const switchMaterialVersion = (version: typeof materialVersions[number]) => {
          activateContentPlan(version.plan.id);
          previewLanguageVersion(version.code, false);
          setBgm(materialVersionBgms[version.key] ?? assemblyBgms[version.plan.id] ?? '');
          stopPreview();
        };
        const batchAssignBgms = () => {
          const candidates = (bgmCandidates.length ? bgmCandidates.map(id => bgms.find(track => track.id === id)) : bgms)
            .filter((track): track is Bgm => Boolean(track));
          if (!candidates.length) {
            setModeNotice('配乐库暂无可用音乐，请先展开配乐库并上传音乐。');
            setBgmLibraryOpen(true);
            return;
          }
          const next = Object.fromEntries(materialVersions.map((item, index) => [item.key, candidates[index % candidates.length]!.id]));
          setMaterialVersionBgms(current => ({ ...current, ...next }));
          setBgm(next[activeVersionKey] || candidates[0]!.id);
          setBgmMatchMode('smart');
          setPreviewBgmOn(true);
          setModeNotice(`已按版本节奏为 ${materialVersions.length} 个“语言 × 分镜组合 × 脚本”素材版本批量匹配配乐。`);
        };
        return (
          <div className="grid min-w-0 grid-cols-1 items-start gap-6">
          <div className="xl:col-span-2">
            <SectionTitle title="可选优化 · 背景音乐" desc="系统已保留无配乐成片能力；可直接继续，也可展开乐库为不同版本匹配音乐" noMargin />
          </div>
          <div className="min-w-0">
            <div ref={bgmLibraryRef} className="relative z-30 mb-4 rounded-2xl border border-border bg-surface shadow-sm">
              <button type="button" onClick={() => setBgmLibraryOpen(open => !open)} className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-surface-2/60">
                <span className="min-w-0">
                  <span className="block text-sm font-black text-text-primary">配乐库</span>
                  <span className="mt-0.5 block truncate text-[11px] text-text-muted">{selectedBgmTrack ? `当前：${selectedBgmTrack.name}` : `${bgms.length} 首音乐 · 点击展开选择`}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-[11px] font-bold text-accent">{bgmLibraryOpen ? '收起乐库' : '展开乐库'}<ChevronDown size={15} className={`transition ${bgmLibraryOpen ? 'rotate-180' : ''}`} /></span>
              </button>
              {bgmLibraryOpen && <div className="absolute inset-x-0 top-full z-40 mt-2 max-h-[min(540px,calc(100vh-220px))] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-surface p-4 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <SectionTitle title="选择配乐" desc="试听后可应用到当前素材版本，也可加入批量候选" noMargin />
              <input ref={bgmInputRef} type="file" accept="audio/*" className="hidden"
                onChange={e => { void handleBgmUpload(e.target.files); e.target.value = ''; }} />
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={() => bgmInputRef.current?.click()} disabled={bgmUploading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border hover:border-border-bright disabled:opacity-60">
                  {bgmUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} 上传音乐
                </button>
                <button
                  type="button"
                  onClick={() => setBgmLibraryOpen(false)}
                  aria-label="收起配乐库"
                  title="收起配乐库"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-muted transition hover:border-border-bright hover:bg-surface-2 hover:text-text-primary"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="mb-4 inline-flex rounded-xl border border-border bg-surface-2 p-1">
              {[
                { id: 'library', label: '配乐曲库' },
                { id: 'favorites', label: `我的收藏 ${favoriteBgms.length}` },
              ].map(tab => {
                const on = bgmTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setBgmTab(tab.id as 'library' | 'favorites')}
                    className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${on ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}
                    style={on ? { color: TRAFFIC_GREEN } : undefined}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
            {bgms.length === 0 && (
              <div className="card !rounded-xl border-dashed text-center py-10 mb-7">
                <Music size={24} className="mx-auto text-text-muted opacity-40 mb-2" />
                <p className="text-sm text-text-muted">暂无背景音乐</p>
                <button onClick={() => bgmInputRef.current?.click()} className="text-xs font-semibold mt-2" style={{ color: TRAFFIC_GREEN }}>上传一首</button>
              </div>
            )}
            <div className="space-y-2 pr-1">
              <button onClick={() => { assignBgm(''); setBgmCandidates([]); if (audioRef.current) audioRef.current.pause(); setPlayingBgm(null); }}
                className="card !rounded-xl w-full p-3 flex items-center gap-3 text-left"
                style={!bgm ? { borderColor: TRAFFIC_GREEN, boxShadow: `0 0 0 1px ${TRAFFIC_GREEN}` } : undefined}>
                <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: !bgm ? TRAFFIC_GREEN : 'var(--color-surface-2)', color: !bgm ? '#fff' : 'var(--color-text-muted)' }}>
                  <X size={15} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-primary truncate">不配乐</p>
                  <p className="text-xs text-text-muted mt-0.5">只保留原素材声音和口播配音</p>
                </div>
                {!bgm && <Check size={16} style={{ color: TRAFFIC_GREEN }} />}
              </button>
              {bgmTab === 'favorites' && visibleBgms.length === 0 && (
                <div className="card !rounded-xl border-dashed p-8 text-center">
                  <Heart size={22} className="mx-auto mb-2 text-text-muted opacity-50" />
                  <p className="text-sm font-semibold text-text-primary">还没有收藏的配乐</p>
                  <p className="mt-1 text-xs text-text-muted">在配乐曲库里点心形即可加入收藏。</p>
                </div>
              )}
              {visibleBgms.map(b => {
                const on = bgmCandidates.includes(b.id);
                const activePreview = bgm === b.id;
                const playing = playingBgm === b.id;
                const favored = favoriteBgms.includes(b.id);
                return (
                  <button key={b.id} onClick={() => {
                    if (on) {
                      const next = bgmCandidates.filter(id => id !== b.id);
                      setBgmCandidates(next);
                      if (activePreview) assignBgm(next[0] || '');
                    } else {
                      if (bgmCandidates.length >= 3) { setModeNotice('每套内容最多选择 3 首配乐候选。'); return; }
                      setBgmCandidates(current => [...current, b.id]); assignBgm(b.id);
                    }
                    setPreviewBgmOn(true);
                  }}
                    className="card !rounded-xl w-full p-3 flex items-center gap-3 text-left"
                    style={on ? { borderColor: TRAFFIC_GREEN, boxShadow: `0 0 0 1px ${TRAFFIC_GREEN}` } : undefined}>
                    {/* 试听播放/暂停 */}
                    <span onClick={e => { e.stopPropagation(); togglePlay(b); }}
                      className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors"
                      style={{ background: playing ? TRAFFIC_GREEN : activePreview ? 'var(--color-accent-glow)' : 'var(--color-surface-2)', color: playing ? '#fff' : activePreview ? TRAFFIC_GREEN : 'var(--color-text-muted)' }}>
                      {playing ? <Pause size={15} /> : <Play size={15} />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-text-primary truncate">{b.name}</p>
                        {b.recommended && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: TRAFFIC_GREEN, color: '#fff' }}>AI 推荐</span>
                        )}
                        {playing && <span className="text-[10px] font-medium" style={{ color: TRAFFIC_GREEN }}>♪ 试听中</span>}
                      </div>
                      <p className="text-xs text-text-muted mt-0.5">{b.mood}</p>
                      <p className="mt-0.5 text-[10px] font-semibold text-text-muted">
                        {b.scope === 'shared' ? `共享曲库 · ${b.uploadedBy || '灵枢管理员上传'}` : b.uploadedBy || '客户上传'}
                      </p>
                    </div>
                    <span
                      role="button"
                      tabIndex={0}
                      title={favored ? '取消收藏' : '收藏'}
                      onClick={e => { e.stopPropagation(); toggleFavoriteBgm(b.id); }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleFavoriteBgm(b.id);
                        }
                      }}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:bg-surface-2 transition-colors"
                      style={favored ? { color: TRAFFIC_GREEN } : undefined}
                    >
                      <Heart size={15} fill={favored ? 'currentColor' : 'none'} />
                    </span>
                    <span className="text-xs font-mono text-text-muted">{fmtDur(b.duration)}</span>
                    {on ? <Check size={16} style={{ color: TRAFFIC_GREEN }} /> : <Volume2 size={15} className="text-text-muted opacity-0" />}
                  </button>
                );
              })}
            </div>
              </div>}
            </div>
            <section className="mb-5 rounded-2xl border border-border bg-surface p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-text-primary">素材版本管理</p>
                  <p className="mt-1 text-[11px] text-text-muted">每个版本由生成语言、分镜素材组合和对应脚本共同确定；发布平台不参与版本划分。</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-accent-glow px-2 py-1 text-[10px] font-black text-accent">{materialVersions.filter(item => materialVersionBgms[item.key]).length}/{materialVersions.length} 已配乐</span>
                  <button type="button" onClick={batchAssignBgms} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-[11px] font-black text-text-secondary hover:bg-surface-2">
                    <Sparkles size={12} />一键批量配乐
                  </button>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                {materialVersions.map((item, index) => {
                  const active = item.key === activeVersionKey;
                  const itemAssignments = item.plan.id === activeAssemblyId ? storyboardAssignments : item.plan.assignments;
                  const itemSelected = item.plan.id === activeAssemblyId ? selected : item.plan.selected;
                  const matched = storyboardSlots.filter(slot => Boolean(itemAssignments[slot.id])).length;
                  const trackId = materialVersionBgms[item.key] ?? assemblyBgms[item.plan.id] ?? '';
                  const track = bgms.find(candidate => candidate.id === trackId);
                  const firstClipId = storyboardSlots.map(slot => itemAssignments[slot.id]).find(Boolean) || itemSelected[0];
                  const firstClip = firstClipId ? materialById.get(firstClipId) : undefined;
                  return (
                    <div key={item.key} className={`rounded-xl border p-3 transition ${active ? 'border-accent bg-accent/5 shadow-[0_0_0_1px_var(--color-accent)]' : 'border-border bg-white hover:border-border-bright'}`}>
                      <button type="button" onClick={() => switchMaterialVersion(item)} className="flex w-full items-center gap-3 text-left">
                        <span className="relative flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2">
                          {firstClip?.poster ? <img src={firstClip.poster} alt="" className="h-full w-full object-cover" /> : <Film size={17} className="text-text-muted" />}
                          <span className="absolute bottom-1 right-1 rounded bg-black/55 px-1 text-[8px] font-bold text-white">{index + 1}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2"><span className="text-xs font-black text-text-primary">{item.name}</span><span className="text-[9px] font-bold text-text-muted">{matched}/{storyboardSlots.length} 分镜</span></span>
                          <span className="mt-1 block truncate text-[10px] text-text-muted">{!item.hasScript
                            ? '脚本待生成'
                            : !item.hasAudio
                              ? '脚本已生成 · 配音待生成'
                              : track
                                ? `当前配乐：${track.name}`
                                : '脚本与配音已生成 · 尚未配乐'}</span>
                        </span>
                        {active && <span className="rounded-md bg-accent px-2 py-1 text-[9px] font-black text-white">预览中</span>}
                      </button>
                      <div className="mt-3 flex items-center gap-2 border-t border-border/70 pt-3">
                        <Music size={13} className="shrink-0 text-text-muted" />
                        <select value={trackId} onClick={event => event.stopPropagation()} onChange={event => {
                          const nextTrackId = event.target.value;
                          setMaterialVersionBgms(current => ({ ...current, [item.key]: nextTrackId }));
                          if (active) { setBgm(nextTrackId); setPreviewBgmOn(Boolean(nextTrackId)); }
                        }} className="min-w-0 flex-1 rounded-lg border border-border bg-white px-2.5 py-2 text-[11px] font-bold text-text-secondary outline-none focus:border-accent">
                          <option value="">不配乐</option>
                          {bgms.map(trackItem => <option key={trackItem.id} value={trackItem.id}>{trackItem.name} · {trackItem.mood}</option>)}
                        </select>
                        <button type="button" onClick={() => { switchMaterialVersion(item); setBgmLibraryOpen(true); }} className="rounded-lg border border-border px-2.5 py-2 text-[10px] font-black text-accent hover:border-accent">打开乐库</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
            <div data-lingshu-guide="ai-audio-mix" className="rounded-2xl border border-border bg-surface p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-text-primary">音量调节</p>
                </div>
                <span className="rounded-lg bg-accent-glow px-2.5 py-1 text-[11px] font-bold text-accent">ducking</span>
              </div>
              <div className="space-y-4">
                <label className="block">
                  <div className="mb-1.5 flex items-center justify-between text-xs font-semibold">
                    <span className="text-text-secondary">背景乐</span>
                    <span className={bgm ? 'text-text-primary' : 'text-text-muted'}>{bgm ? `${bgmVol}%` : '关闭'}</span>
                  </div>
                  <input type="range" min={0} max={100} value={bgmVol}
                    onChange={e => setBgmVol(+e.target.value)} disabled={!bgm} className="w-full accent-[#16a34a] disabled:opacity-40" />
                </label>
                <label className="block">
                  <div className="mb-1.5 flex items-center justify-between text-xs font-semibold">
                    <span className="text-text-secondary">口播</span>
                    <span className={voiceoverMode === 'none' ? 'text-text-muted' : 'text-text-primary'}>{voiceoverMode === 'none' ? '关闭' : `${voiceVol}%`}</span>
                  </div>
                  <input type="range" min={0} max={150} value={voiceVol}
                    onChange={e => setVoiceVol(+e.target.value)} disabled={voiceoverMode === 'none'} className="w-full accent-[#16a34a] disabled:opacity-40" />
                </label>
              </div>
            </div>
          </div>
          <aside className="sticky top-4 rounded-2xl border border-border bg-surface p-4 shadow-sm">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black text-text-primary">实时混剪预览 · {assemblyName}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">切换左侧素材版本或配乐后立即同步试听，不生成正式文件</p>
              </div>
              <span className="shrink-0 rounded-md bg-accent-glow px-2 py-1 text-[10px] font-black text-accent">草稿</span>
            </div>

            <div className="mx-auto w-full max-w-[250px]">
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black shadow-xl">
                <div className="relative aspect-[9/16]">
                  {activeBgmPreviewItem ? (
                    activeBgmPreviewItem.clip.type === 'image' ? (
                      <img src={activeBgmPreviewItem.clip.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
                    ) : (
                      <>
                        {activeBgmPreviewItem.clip.poster && (
                          <img src={activeBgmPreviewItem.clip.poster} alt="素材预览帧" className="absolute inset-0 h-full w-full object-cover" />
                        )}
                        <video
                          key={`bgm-preview-${activeBgmPreviewItem.clipId}-${activeBgmPreviewItem.trimStart}-${activeBgmPreviewItem.clip.url}`}
                          ref={previewVideoRef}
                          src={activeBgmPreviewItem.clip.url}
                          poster={activeBgmPreviewItem.clip.poster}
                          autoPlay
                          preload="auto"
                          playsInline
                          muted={!previewOriginalOn}
                          className={`absolute inset-0 h-full w-full object-cover ${previewVideoReady ? 'opacity-100' : 'opacity-0'}`}
                          onLoadedData={() => { setPreviewVideoReady(true); setPreviewNote(false); }}
                          onCanPlay={() => setPreviewVideoReady(true)}
                          onError={() => {
                            setPreviewVideoReady(false);
                            setPreviewNote(true);
                            void refreshMaterialSource(activeBgmPreviewItem.clipId).then(refreshed => {
                              if (!refreshed) return;
                              setPreviewNote(false);
                              setPreviewVideoReady(false);
                            });
                          }}
                          onPause={pausePreviewAudio}
                          onPlay={resumePreviewAudio}
                          onWaiting={pausePreviewAudio}
                          onPlaying={resumePreviewAudio}
                          onTimeUpdate={updatePreviewClock}
                          onEnded={handlePreviewClipEnded}
                        />
                        {!activeBgmPreviewItem.clip.poster && !previewVideoReady && (
                          <div className="absolute inset-0 flex items-center justify-center text-white/60">
                            <Loader2 size={24} className="animate-spin" />
                          </div>
                        )}
                      </>
                    )
                  ) : bgmPreviewPoster ? (
                    <img src={bgmPreviewPoster} alt="粗剪预览封面" className="absolute inset-0 h-full w-full object-cover opacity-90" />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-white/60">
                      <Film size={30} className="mb-3 opacity-60" />
                      <p className="text-xs font-bold">还没有可播放素材</p>
                      <p className="mt-1 text-[10px] leading-relaxed text-white/45">返回“选素材”完成分镜匹配后即可预览</p>
                    </div>
                  )}

                  {activeBgmPreviewItem && (
                    <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-md bg-black/55 px-2 py-1 text-[10px] font-bold text-white">
                      镜头 {previewIdx! + 1}/{previewTimeline.length}
                    </div>
                  )}
                  {previewIdx !== null && activePreviewCue && subtitlesOn && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-[8%] z-20 px-3 text-center">
                      <p className="inline-block max-w-full rounded-md bg-black/45 px-2 py-1 text-sm font-black leading-tight text-white" style={{ textShadow: '0 1px 3px rgba(0,0,0,.9)' }}>
                        {activePreviewCue.text}
                      </p>
                    </div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <button
                      type="button"
                      onClick={previewPlaying ? stopPreview : startPreview}
                      disabled={!previewTimeline.length}
                      className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-text-primary shadow-lg transition hover:scale-105 disabled:opacity-40"
                      aria-label={previewPlaying ? '停止粗剪预览' : '播放粗剪预览'}
                    >
                      {previewPlaying ? <Pause size={19} fill="currentColor" /> : <Play size={19} className="ml-0.5" fill="currentColor" />}
                    </button>
                  </div>
                </div>
                <audio ref={previewBgmAudioRef} src={selectedBgmTrack?.url || undefined} preload="auto" />
                <audio ref={previewVoiceAudioRef} src={activeVoiceoverUrl || undefined} preload="auto" />
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-text-muted">
                <span>{fmtDur(previewTime)}</span>
                <span>{fmtDur(bgmPreviewDuration || totalDur)}</span>
              </div>
              <div className="flex h-9 overflow-hidden rounded-lg border border-border bg-surface-2 p-1">
                {previewTimeline.length ? previewTimeline.map((item, index) => {
                  const active = previewIdx === index;
                  const width = `${Math.max(12, ((item.targetDuration || 1) / Math.max(1, bgmPreviewDuration)) * 100)}%`;
                  return (
                    <button
                      type="button"
                      key={`${item.clipId}-${index}`}
                      onClick={() => jumpToPreviewClip(index)}
                      title={`${index + 1}. ${item.name}`}
                      className="relative min-w-0 overflow-hidden rounded-md border-r border-white/70 px-1 text-[9px] font-bold transition"
                      style={{ width, background: active ? TRAFFIC_GREEN : '#e8eef5', color: active ? '#fff' : '#64748b' }}
                    >
                      <span className="block truncate">{index + 1}</span>
                    </button>
                  );
                }) : <div className="flex w-full items-center justify-center text-[10px] text-text-muted">暂无时间轴</div>}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                { label: '原声', on: previewOriginalOn, toggle: () => setPreviewOriginalOn(value => !value) },
                { label: '口播', on: previewVoiceOn && Boolean(activeVoiceoverUrl), toggle: () => setPreviewVoiceOn(value => !value), disabled: !activeVoiceoverUrl },
                { label: '配乐', on: previewBgmOn && Boolean(selectedBgmTrack?.url), toggle: () => setPreviewBgmOn(value => !value), disabled: !selectedBgmTrack?.url },
              ].map(item => (
                <button
                  type="button"
                  key={item.label}
                  onClick={item.toggle}
                  disabled={item.disabled}
                  className="rounded-xl border px-2 py-2 text-[11px] font-bold transition disabled:opacity-35"
                  style={item.on ? { borderColor: TRAFFIC_GREEN, background: 'var(--color-accent-glow)', color: TRAFFIC_GREEN } : { borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
                >
                  <Volume2 size={13} className="mx-auto mb-1" />{item.label}
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-xl bg-surface-2 px-3 py-2.5">
              <p className="truncate text-xs font-bold text-text-primary">{selectedBgmTrack?.name || '当前未选择配乐'}</p>
              <p className="mt-1 text-[10px] text-text-muted">
                {previewVoiceOn && activeVoiceoverUrl && bgm ? '口播出现时，配乐按当前设置自动降低' : bgm ? `配乐音量 ${bgmVol}%` : '选择一首音乐即可试听混剪效果'}
              </p>
            </div>
            {previewNote && <p className="mt-2 text-[11px] leading-relaxed text-amber-600">素材缺少可播放源文件，请返回上一步更换或上传素材。</p>}
          </aside>
          </div>
        );
      }

      /* ⑤ 封面 —— 用所选视频的真实帧画面，便于辨认内容 */
      case 'cover': {
        const SEG = (active: boolean) => `px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${active ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`;
        const SWATCHES = ['#ffffff', '#111827', '#16a34a', '#14b8a6', '#ef4444', '#3b82f6'];
        const ART_PRESETS: Array<{ id: NonNullable<CoverStyle['artPreset']>; label: string; sample: string; patch: Partial<CoverStyle> }> = [
          { id: 'clean', label: '简洁标题', sample: 'Clean', patch: { font: 'sans', color: '#ffffff', weight: 'bold' } },
          { id: 'outline', label: '描边爆款', sample: '爆款', patch: { font: 'impact', color: '#ffffff', weight: 'heavy' } },
          { id: 'highlight', label: '荧光高亮', sample: '重点', patch: { font: 'sans', color: '#111827', weight: 'heavy' } },
          { id: 'magazine', label: '杂志标题', sample: 'TREND', patch: { font: 'impact', color: '#ffffff', weight: 'heavy' } },
          { id: 'neon', label: '霓虹发光', sample: 'NEON', patch: { font: 'rounded', color: '#14b8a6', weight: 'heavy' } },
          { id: 'sticker', label: '贴纸立体', sample: 'WOW!', patch: { font: 'rounded', color: '#111827', weight: 'heavy' } },
        ];
        const generatedLanguages = voiceLangs.filter(code => voiceDrafts[code]?.trim());
        const effectiveLanguages = generatedLanguages.length ? generatedLanguages : [activeVoiceLang];
        const coverMaterialVersions = contentPlanVersions.flatMap((plan, planIndex) => effectiveLanguages.map((code, languageIndex) => {
          const key = materialVersionKey(plan.id, code);
          const timeline = timelineForAssembly(plan, code);
          return {
            key,
            plan,
            code,
            name: `${plan.name || `视频${planIndex + 1}`} * ${langZh(code) || `语种${languageIndex + 1}`}`,
            language: LANGS.find(item => item.code === code)?.label || code.toUpperCase(),
            materialCount: timeline.length || plan.selected.length,
            saved: materialVersionCovers[key],
          };
        }));
        const frameCandidatesForPlan = (plan: StoryboardAssembly, code = activeVoiceLang) => {
          const ids = timelineForAssembly(plan, code).map(item => item.clipId).filter(Boolean) as string[];
          const sourceIds = ids.length ? ids : plan.selected;
          const seen = new Set<string>();
          return sourceIds
            .map(id => materialById.get(id))
            .filter((clip): clip is Clip => Boolean(clip && clip.type !== 'audio' && (clip.poster || clip.url)))
            .filter(clip => {
              if (seen.has(clip.id)) return false;
              seen.add(clip.id);
              return true;
            });
        };
        const activeCoverVersion = coverMaterialVersions.find(item => item.key === activeMaterialVersionKey) || coverMaterialVersions[0];
        const activeCoverFrameCandidates = activeCoverVersion ? frameCandidatesForPlan(activeCoverVersion.plan, activeCoverVersion.code) : frameCandidates;
        const switchCoverMaterialVersion = (version: typeof coverMaterialVersions[number]) => {
          activateContentPlan(version.plan.id);
          previewLanguageVersion(version.code, false);
          const saved = materialVersionCovers[version.key];
          const candidates = frameCandidatesForPlan(version.plan, version.code);
          const savedCoverId = saved?.coverId && candidates.some(item => item.id === saved.coverId) ? saved.coverId : '';
          setCover(savedCoverId || candidates[0]?.id || '');
          setCoverTitle(saved?.title || coverTitle);
          setCoverStyle(saved?.style || coverStyle);
          setCoverUrl(saved?.coverUrl ?? null);
        };
        const batchApplyCoverStyle = () => {
          setMaterialVersionCovers(current => {
            const next = { ...current };
            coverMaterialVersions.forEach(version => {
              const candidates = frameCandidatesForPlan(version.plan, version.code);
              const currentCover = next[version.key];
              const coverId = currentCover?.coverId && candidates.some(item => item.id === currentCover.coverId)
                ? currentCover.coverId
                : candidates[0]?.id || cover;
              next[version.key] = { coverId, title: coverTitle, style: coverStyle, coverUrl: version.key === activeMaterialVersionKey ? coverUrl : null };
            });
            return next;
          });
          setModeNotice(`已将当前封面标题和艺术字参数同步到 ${coverMaterialVersions.length} 个素材版本。`);
        };
        const batchUseFirstFrames = () => {
          setMaterialVersionCovers(current => {
            const next = { ...current };
            coverMaterialVersions.forEach(version => {
              const first = frameCandidatesForPlan(version.plan, version.code)[0]?.id || '';
              next[version.key] = { coverId: first, title: current[version.key]?.title || coverTitle, style: current[version.key]?.style || coverStyle, coverUrl: null };
            });
            return next;
          });
          if (activeCoverFrameCandidates[0]?.id) {
            setCover(activeCoverFrameCandidates[0].id);
            setCoverUrl(null);
          }
          setModeNotice(`已为 ${coverMaterialVersions.length} 个素材版本按各自首个素材设置封面底图。`);
        };
        return (
          <div className="grid min-w-0 grid-cols-1 items-start gap-6">
            <div className="xl:col-span-2">
              <SectionTitle title="可选优化 · 封面与标题" desc="封面不会阻塞成片生成；可沿用首帧，也可在此统一优化标题与视觉样式" noMargin />
            </div>
            <div className="min-w-0 space-y-4">
              <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
                <SectionTitle title="封面参数选择" desc="标题、艺术字和手动编辑会应用到当前选中的素材版本" noMargin />
                <div className="mt-4">
                  <p className="mb-1.5 text-xs font-semibold text-text-secondary">封面标题</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input value={coverTitle} onChange={e => setCoverTitle(e.target.value)}
                      className="min-w-[220px] flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
                    <button onClick={regenCovers} disabled={coverLoading}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:border-border-bright disabled:opacity-60">
                      {coverLoading ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} AI 重写
                    </button>
                    <button onClick={() => void openCanvaCoverEditor()} disabled={coverCanvaOpening}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-text-secondary hover:bg-surface-2 disabled:opacity-60">
                      {coverCanvaOpening ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />}
                      编辑当前封面
                    </button>
                    <input ref={canvaReturnInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => void importCanvaCover(event.target.files)} />
                    <button type="button" onClick={() => canvaReturnInputRef.current?.click()} disabled={coverCanvaOpening}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:border-border-bright disabled:opacity-60">
                      <Upload size={13} /> 导回灵枢
                    </button>
                  </div>
                  {lang !== 'zh' && coverTitleZh && <p className="mt-1.5 text-[11px] text-text-muted">译：{coverTitleZh}</p>}
                </div>

                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-text-secondary">艺术字</p>
                      <p className="mt-0.5 text-[10px] text-text-muted">一键套用字体、颜色、描边和光影效果，仍可继续微调。</p>
                    </div>
                    <span className="rounded-md bg-accent-glow px-2 py-1 text-[10px] font-bold text-accent">即时预览</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {ART_PRESETS.map(preset => {
                      const active = (coverStyle.artPreset ?? 'clean') === preset.id;
                      const previewStyle = coverArtCss({ ...coverStyle, ...preset.patch, artPreset: preset.id });
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            setCoverUrl(null);
                            setCoverStyle(current => ({ ...current, ...preset.patch, artPreset: preset.id }));
                          }}
                          className={`overflow-hidden rounded-xl border p-2 text-left transition ${active ? 'border-accent bg-accent/5 shadow-[0_0_0_1px_rgba(22,163,74,.18)]' : 'border-border bg-surface-2 hover:border-accent/40'}`}
                        >
                          <span className="flex h-12 items-center justify-center overflow-hidden rounded-lg bg-slate-800 px-1">
                            <span className="text-sm font-black leading-none" style={{ fontFamily: fontCss(preset.patch.font ?? coverStyle.font), ...previewStyle }}>{preset.sample}</span>
                          </span>
                          <span className="mt-1.5 block truncate text-center text-[10px] font-bold text-text-secondary">{preset.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-text-secondary">颜色</span>
                    {SWATCHES.map(c => (
                      <button key={c} onClick={() => setCoverStyle(s => ({ ...s, color: c }))}
                        className="h-5 w-5 rounded-full border transition-all"
                        style={{ background: c, borderColor: coverStyle.color === c ? TRAFFIC_GREEN : 'var(--color-border)', boxShadow: coverStyle.color === c ? `0 0 0 2px ${TRAFFIC_GREEN}` : undefined }} />
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-text-secondary">字号</span>
                    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5">
                      {(['S', 'M', 'L'] as const).map(z => <button key={z} className={SEG(coverStyle.size === z)} onClick={() => setCoverStyle(s => ({ ...s, size: z }))}>{z}</button>)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-text-secondary">位置</span>
                    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5">
                      {([['top', '上'], ['center', '中'], ['bottom', '下']] as const).map(([p, l]) => (
                        <button key={p} className={SEG(coverStyle.position === p && coverStyle.verticalPosition === undefined)} onClick={() => setCoverStyle(s => ({ ...s, position: p, verticalPosition: undefined }))}>{l}</button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-text-secondary">对齐</span>
                    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5">
                      {([['left', '左'], ['center', '居中']] as const).map(([a, l]) => <button key={a} className={SEG(coverStyle.align === a)} onClick={() => setCoverStyle(s => ({ ...s, align: a }))}>{l}</button>)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-text-secondary">粗细</span>
                    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5">
                      {([['regular', '常规'], ['bold', '加粗'], ['heavy', '特粗']] as const).map(([w, l]) => <button key={w} className={SEG((coverStyle.weight ?? 'bold') === w)} onClick={() => setCoverStyle(s => ({ ...s, weight: w }))}>{l}</button>)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-text-secondary">字体</span>
                    <div className="flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5">
                      {COVER_FONTS.map(f => <button key={f.id} className={SEG(coverStyle.font === f.id && !coverStyle.fontFamily)} style={{ fontFamily: f.css }} onClick={() => setCoverStyle(s => ({ ...s, font: f.id, fontFamily: undefined }))}>{f.label}</button>)}
                      {customFonts.map(cf => <button key={cf.family} className={SEG(coverStyle.fontFamily === cf.family)} style={{ fontFamily: cf.family }} onClick={() => setCoverStyle(s => ({ ...s, fontFamily: cf.family }))}>{cf.label}</button>)}
                    </div>
                    <input ref={fontInputRef} type="file" accept=".ttf,.otf,.woff,.woff2,font/*" className="hidden"
                      onChange={e => { void importFont(e.target.files); e.target.value = ''; }} />
                    <button onClick={() => fontInputRef.current?.click()} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-text-muted hover:text-text-primary">
                      <Upload size={12} /> 导入字体模版
                    </button>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-text-primary">素材版本管理</p>
                    <p className="mt-1 text-[11px] text-text-muted">每个版本可独立选择封面底图；标题和艺术字可单独改，也可批量同步。</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-accent-glow px-2 py-1 text-[10px] font-black text-accent">{Object.keys(materialVersionCovers).length}/{coverMaterialVersions.length} 已配置</span>
                    <button type="button" onClick={batchApplyCoverStyle} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-[11px] font-black text-text-secondary hover:bg-surface-2">
                      <Sparkles size={12} />批量同步参数
                    </button>
                    <button type="button" onClick={batchUseFirstFrames} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] font-black text-text-secondary hover:border-accent hover:text-accent">
                      <ImageIcon size={12} />批量首帧
                    </button>
                  </div>
                </div>
                <div className="mt-4 max-h-[min(520px,calc(100vh-520px))] min-h-[260px] space-y-2 overflow-y-auto pr-1">
                  {coverMaterialVersions.map((item, index) => {
                    const active = item.key === activeMaterialVersionKey;
                    const candidates = frameCandidatesForPlan(item.plan, item.code);
                    const saved = item.saved;
                    const coverId = active ? cover : (saved?.coverId || candidates[0]?.id || '');
                    const coverClipForVersion = candidates.find(candidate => candidate.id === coverId) || candidates[0];
                    return (
                      <div key={item.key} className={`rounded-xl border p-3 transition ${active ? 'border-accent bg-accent/5 shadow-[0_0_0_1px_var(--color-accent)]' : 'border-border bg-white hover:border-border-bright'}`}>
                        <button type="button" onClick={() => switchCoverMaterialVersion(item)} className="flex w-full items-center gap-3 text-left">
                          <span className="relative flex h-14 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2">
                            {coverClipForVersion?.poster || coverClipForVersion?.url ? (
                              <img src={coverClipForVersion.poster || coverClipForVersion.url} alt="" className="h-full w-full object-cover" />
                            ) : <Film size={15} className="text-text-muted" />}
                            <span className="absolute bottom-1 right-1 rounded bg-black/55 px-1 text-[8px] font-bold text-white">{index + 1}</span>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-xs font-black text-text-primary">{item.name}</span>
                              <span className="shrink-0 text-[9px] font-bold text-text-muted">{item.materialCount} 段素材</span>
                            </span>
                            <span className="mt-1 block truncate text-[10px] text-text-muted">{saved?.title || (active ? coverTitle : '沿用当前封面标题')}</span>
                          </span>
                          {active && <span className="rounded-md bg-accent px-2 py-1 text-[9px] font-black text-white">编辑中</span>}
                        </button>
                        <div className="mt-3 flex items-center gap-2 border-t border-border/70 pt-3">
                          <ImageIcon size={13} className="shrink-0 text-text-muted" />
                          <select
                            value={coverId}
                            onClick={event => event.stopPropagation()}
                            onChange={event => {
                              const nextCover = event.target.value;
                              if (!active) switchCoverMaterialVersion(item);
                              setCover(nextCover);
                              setCoverUrl(null);
                              setMaterialVersionCovers(current => ({
                                ...current,
                                [item.key]: { coverId: nextCover, title: active ? coverTitle : saved?.title || coverTitle, style: active ? coverStyle : saved?.style || coverStyle, coverUrl: null },
                              }));
                            }}
                            className="min-w-0 flex-1 rounded-lg border border-border bg-white px-2.5 py-2 text-[11px] font-bold text-text-secondary outline-none focus:border-accent"
                          >
                            {candidates.length ? candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>) : <option value="">暂无可用封面素材</option>}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                  {coverMaterialVersions.length === 0 && (
                    <div className="rounded-xl border border-dashed border-border bg-surface-2 px-4 py-8 text-center text-xs text-text-muted">
                      暂无素材版本。请先完成分镜、配音和素材选择。
                    </div>
                  )}
                </div>
              </section>
            </div>

            <aside className="sticky top-4 rounded-2xl border border-border bg-surface p-4 shadow-sm">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-black text-text-primary">实时封面预览</p>
                  <p className="mt-0.5 truncate text-[11px] text-text-muted">{activeCoverVersion?.name || '当前素材版本'}</p>
                </div>
                <span className="shrink-0 rounded-md bg-accent-glow px-2 py-1 text-[10px] font-black text-accent">草稿</span>
              </div>
              <div className="mx-auto w-full max-w-[260px]">
                <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black shadow-xl">
                  <div className="relative aspect-[9/16]">
                    {coverFrameUrl ? (
                      <CoverFace
                        coverUrl={coverUrl}
                        frameUrl={coverFrameUrl}
                        frameType={coverClip?.poster ? 'image' : coverClip?.type}
                        fallbackVideoUrl={coverClip?.type === 'video' ? coverClip.url : undefined}
                        title={coverTitle}
                        style={coverStyle}
                        editable
                        onTitleChange={setCoverTitle}
                        onStyleChange={nextStyle => { setCoverUrl(null); setCoverStyle(nextStyle); }}
                        onFrameReady={coverClip?.type === 'video' ? dataUrl => {
                          setMaterials(prev => prev.map(item => item.id === coverClip.id ? { ...item, poster: dataUrl } : item));
                        } : undefined}
                        onSourceError={() => { if (coverClip) void refreshMaterialSource(coverClip.id); }}
                      />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-white/60">
                        <ImageIcon size={30} className="mb-3 opacity-60" />
                        <p className="text-xs font-bold">还没有可用封面素材</p>
                        <p className="mt-1 text-[10px] leading-relaxed text-white/45">返回“选素材”完成分镜匹配后即可预览</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-4 rounded-xl bg-surface-2 px-3 py-2.5">
                <p className="truncate text-xs font-bold text-text-primary">{coverClip?.name || '未选择封面底图'}</p>
                <p className="mt-1 text-[10px] leading-relaxed text-text-muted">在右侧预览里可直接编辑选中版本标题位置；使用“批量同步参数”可同步到全部版本。</p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={batchApplyCoverStyle} className="rounded-xl border border-accent bg-accent-glow px-3 py-2 text-[11px] font-black text-accent">
                  批量封面编辑
                </button>
                <button type="button" onClick={() => void openCanvaCoverEditor()} disabled={coverCanvaOpening}
                  className="rounded-xl border border-border px-3 py-2 text-[11px] font-black text-text-secondary hover:border-accent hover:text-accent disabled:opacity-50">
                  编辑当前版本
                </button>
              </div>
            </aside>
          </div>
        );
      }

      /* ⑥ 成片预览 */
      case 'preview': {
        const activePreviewItem = previewIdx !== null ? previewTimeline[previewIdx] : null;
        const previewTimelineDuration = renderTimeline.reduce((sum, item) => sum + (item.targetDuration || 0), 0);
        const outputVersions = buildRenderableVideoVersions().map(({ key, code, plan, planIndex, languageIndex, bgmId, script: versionScript, timeline: planTimeline, inputSignature }) => ({
            id: key, key, code, plan, bgmId,
            inputSignature,
            name: `${plan.name || `视频${planIndex + 1}`} * ${langZh(code) || `语种${languageIndex + 1}`}`,
            language: LANGS.find(item => item.code === code)?.label || code.toUpperCase(),
            script: versionScript,
            materials: planTimeline.map(item => item.name),
            bgm: bgms.find(item => item.id === bgmId)?.name || '无配乐',
            output: languageRenderOutputs[key]?.inputSignature === inputSignature ? languageRenderOutputs[key] : undefined,
            generations: (languageRenderVersions[key] || []).filter(item => item.inputSignature === inputSignature),
          }));
        const fallbackActiveKey = renderCombinationKey(activeAssemblyId, activeVoiceLang, bgm);
        const activeOutputVersion = outputVersions.find(item => item.key === activeRenderCombinationKey)
          || outputVersions.find(item => item.key === fallbackActiveKey)
          || outputVersions[0];
        const activeFormalPreviewUrl = activeOutputVersion?.output?.previewUrl
          || activeOutputVersion?.generations.find(item => item.status === 'done' && item.previewUrl)?.previewUrl
          || renderOutputPreviewUrl
          || '';
        const hasFormalVideo = Boolean(renderOutputPath || outputVersions.some(version => (
          Boolean(version.output?.status === 'done' && version.output.path)
          || version.generations.some(generation => generation.status === 'done' && generation.path)
        )));
        const selectOutputVersion = (version: typeof outputVersions[number]) => {
          stopPreview();
          setActiveRenderCombinationKey(version.key);
          activateContentPlan(version.plan.id);
          setBgm(version.bgmId);
          previewLanguageVersion(version.code, false);
          if (version.output?.path) {
            setRenderOutputPath(version.output.path);
            setRenderOutputPreviewUrl(version.output.previewUrl || null);
          } else {
            setRenderOutputPath(null);
            setRenderOutputPreviewUrl(null);
          }
        };
        return (
          <div className="flex min-w-0 flex-col items-stretch gap-5">
            {/* 播放器 */}
            <div className="flex-shrink-0">
              <div className="relative rounded-2xl overflow-hidden border border-border bg-black" style={{ width: 260 }}>
                <div className="relative aspect-[9/16]">
                  {activeFormalPreviewUrl ? (
                    <video
                      key={`formal-preview-${activeFormalPreviewUrl}`}
                      src={activeFormalPreviewUrl}
                      controls
                      playsInline
                      preload="auto"
                      className="absolute inset-0 h-full w-full bg-black object-contain"
                      onPlay={stopPreview}
                      onError={() => setRenderDownloadMessage('正式成片预览加载失败，请重新生成或下载后检查。')}
                    />
                  ) : activePreviewItem ? (
                    activePreviewItem.clip.type === 'image' ? (
                      <img src={activePreviewItem.clip.url} alt="" className="absolute inset-0 w-full h-full object-cover bg-black" />
                    ) : (
                      // 按时间戳 timeline 播放：视频未解码前保留素材封面，避免实时预览只剩黑屏。
                      <>
                        {activePreviewItem.clip.poster && <img src={activePreviewItem.clip.poster} alt="素材预览帧" className="absolute inset-0 h-full w-full object-cover" />}
                        <video
                          key={`${activePreviewItem.clipId}-${activePreviewItem.trimStart}-${activePreviewItem.targetStart}`}
                          ref={previewVideoRef}
                          src={activePreviewItem.clip.url}
                          poster={activePreviewItem.clip.poster}
                          autoPlay
                          preload="auto"
                          controls
                          playsInline
                          muted={!previewOriginalOn}
                          className={`absolute inset-0 w-full h-full object-cover bg-black ${previewVideoReady ? 'opacity-100' : 'opacity-0'}`}
                          onLoadedData={() => { setPreviewVideoReady(true); setPreviewNote(false); }}
                          onCanPlay={() => setPreviewVideoReady(true)}
                          onError={() => { setPreviewVideoReady(false); setPreviewNote(true); }}
                          onPause={pausePreviewAudio}
                          onPlay={resumePreviewAudio}
                          onWaiting={pausePreviewAudio}
                          onPlaying={resumePreviewAudio}
                          onTimeUpdate={updatePreviewClock}
                          onEnded={handlePreviewClipEnded}
                        />
                      </>
                    )
                  ) : (
                    <CoverFace coverUrl={coverUrl} frameUrl={coverFrameUrl} frameType={coverClip?.poster ? 'image' : coverClip?.type} fallbackVideoUrl={coverClip?.type === 'video' ? coverClip.url : undefined} title={coverTitle} style={coverStyle} />
                  )}
                </div>
                {activeFormalPreviewUrl ? (
                  <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-md bg-accent px-2 py-1 text-[10px] font-black text-white">
                    正式成片 · 连续 MP4
                  </div>
                ) : activePreviewItem && (
                  <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-md bg-black/60 px-2 py-1 text-[10px] font-bold text-white">
                    {previewIdx! + 1}/{previewTimeline.length} · {activePreviewItem.targetStart ?? 0}s-{activePreviewItem.targetEnd ?? activePreviewItem.targetDuration}s
                  </div>
                )}
                {!activeFormalPreviewUrl && previewIdx !== null && activePreviewCue && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-[7%] z-20 px-4 text-center">
                    <p className="inline-block max-w-full rounded-md bg-black/35 px-2 py-1 text-[17px] font-black leading-tight text-white"
                      style={{ textShadow: '0 2px 4px rgba(0,0,0,0.9)' }}>
                      {activePreviewCue.text}
                    </p>
                  </div>
                )}
                {!activeFormalPreviewUrl && previewIdx === null && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    {rendering ? (
                      <div className="text-center">
                        <Loader2 size={30} className="text-white animate-spin mx-auto mb-2" />
                        <p className="text-white text-xs font-medium">{renderPct >= 90 ? '正在写入 MP4…' : 'AI 合成中…'} {renderPct}%</p>
                        <div className="mx-auto mt-2 h-1 w-32 rounded-full bg-white/25 overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${renderPct}%`, background: '#fff' }} />
                        </div>
                      </div>
                    ) : (
                      <button onClick={startPreview}
                        className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg active:scale-95 transition-transform">
                        <Play size={22} className="text-text-primary ml-0.5" fill="currentColor" />
                      </button>
                    )}
                  </div>
                )}
                <audio ref={previewBgmAudioRef} src={selectedBgmTrack?.url || undefined} preload="auto" />
                <audio ref={previewVoiceAudioRef} src={activeVoiceoverUrl || undefined} preload="auto" />
                {!activeFormalPreviewUrl && previewIdx !== null && (
                  <button onClick={stopPreview} className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-black/55 flex items-center justify-center text-white">
                    <X size={14} />
                  </button>
                )}
              </div>
              {/* 无真实可播放素材时的说明 */}
              {previewNote && (
                <p className="text-[11px] text-text-muted mt-2 w-[260px] leading-relaxed">
                  该片段暂无可播放源文件，请上传真实视频素材，或在桌面客户端合成后下载完整成片。
                </p>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <SectionTitle title="预览与发布" desc="确认成片后下载留档，或直接带入账号发布页" />
              <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
                <div className="rounded-2xl border border-border bg-surface-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-text-primary">视频版本</p>
                      <p className="mt-0.5 text-xs text-text-muted">仅显示具备有效脚本和完整有效分镜的版本；配音、配乐为可选项。</p>
                    </div>
                    <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-text-muted">
                      {batchRenderingLangs ? '正在生成选中版本' : '选定版本后使用底部主按钮生成'}
                    </span>
                  </div>
                  <div className="mt-3 grid max-h-[360px] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                    {outputVersions.map(version => {
                      const item = version.output;
                      const active = activeOutputVersion?.id === version.id;
                      return (
                        <div key={version.id} className={`rounded-xl border bg-white px-3 py-2.5 transition ${active ? 'border-accent shadow-[0_0_0_1px_var(--color-accent)]' : 'border-border'}`}>
                          <button type="button" onClick={() => selectOutputVersion(version)}
                            className="w-full text-left"
                            title="点击在左侧预览该视频版本">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-black text-text-primary">{version.name}</span>
                            <span className={`text-[10px] font-bold ${
                              active ? 'text-accent'
                              : item?.status === 'done' ? 'text-accent'
                              : item?.status === 'failed' ? 'text-red-500'
                              : item?.status === 'rendering' ? 'text-text-primary'
                              : 'text-text-muted'
                            }`}>
                              {active ? '预览中'
                                : item?.status === 'done' ? '已生成'
                                : item?.status === 'failed' ? '失败'
                                : item?.status === 'rendering' ? '生成中'
                                : '可生成'}
                            </span>
                          </div>
                          <p className="mt-1.5 text-xs font-bold text-text-secondary">{version.language}</p>
                          <p className="mt-1 truncate text-[10px] text-text-muted">{version.materials.length} 段素材 · {version.bgm}</p>
                          </button>
                          {version.generations.length > 0 && <div className="mt-2 flex flex-wrap gap-1 border-t border-border pt-2">
                            {version.generations.map(generation => <button key={generation.id} type="button" onClick={() => {
                              setLanguageRenderOutputs(prev => ({ ...prev, [version.key]: { status: generation.status, inputSignature: generation.inputSignature, path: generation.path, previewUrl: generation.previewUrl, error: generation.error } }));
                              if (generation.path) {
                                setRenderOutputPath(generation.path);
                                setRenderOutputPreviewUrl(generation.previewUrl || null);
                              }
                            }} className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[9px] font-bold text-text-secondary">
                              V{generation.versionNumber}{generation.status === 'failed' ? ' 失败' : ''}
                            </button>)}
                          </div>}
                          {item?.status === 'failed' && (
                            <button type="button" onClick={() => void retryLanguageRender(version)}
                              className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-accent">
                              <RefreshCw size={10} /> 仅重试此组合
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {outputVersions.length === 0 && (
                    <div className="mt-3 rounded-xl border border-dashed border-border bg-white px-4 py-8 text-center text-xs text-text-muted">
                      暂无符合生成条件的视频版本，请先完成有效脚本和全部分镜素材匹配。
                    </div>
                  )}
                  {activeOutputVersion && (
                    <div className="mt-3 rounded-xl border border-border bg-white p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-black text-text-primary">{activeOutputVersion.name} 配置</p>
                        <span className="text-[10px] font-bold text-accent">正在预览</span>
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <div className="rounded-lg bg-surface-2 px-2.5 py-2"><p className="text-[10px] text-text-muted">语言 / 脚本</p><p className="mt-0.5 truncate text-xs font-bold text-text-primary">{activeOutputVersion.language} · {activeOutputVersion.script || '无脚本'}</p></div>
                        <div className="rounded-lg bg-surface-2 px-2.5 py-2"><p className="text-[10px] text-text-muted">素材组合</p><p className="mt-0.5 truncate text-xs font-bold text-text-primary">{activeOutputVersion.materials.join('、') || '未选择素材'}</p></div>
                        <div className="rounded-lg bg-surface-2 px-2.5 py-2"><p className="text-[10px] text-text-muted">背景配乐</p><p className="mt-0.5 truncate text-xs font-bold text-text-primary">{activeOutputVersion.bgm}</p></div>
                        <div className="rounded-lg bg-surface-2 px-2.5 py-2"><p className="text-[10px] text-text-muted">输出状态</p><p className="mt-0.5 truncate text-xs font-bold text-text-primary">{activeOutputVersion.output?.status === 'done' ? '成片已生成' : activeOutputVersion.output?.status === 'rendering' ? '生成中' : '可实时预览'}</p></div>
                      </div>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => void downloadMp4()}
                  disabled={rendering}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-white px-5 py-3.5 text-sm font-black text-text-primary shadow-sm transition hover:border-accent/50 hover:bg-surface-2 disabled:opacity-50 active:scale-[0.99]"
                >
                  {rendering ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                  {rendering ? (renderPct >= 90 ? `正在写入 MP4 ${renderPct}%` : `正在生成本地成片 ${renderPct}%`) : renderOutputPath ? '打开本地成片' : '下载成片到本地'}
                </button>
                {renderDownloadMessage && (
                  <div className="mt-3 rounded-xl border border-border bg-surface-2 px-3 py-2 text-xs leading-relaxed text-text-secondary">
                    {renderOutputPath && renderDownloadMessage.includes(renderOutputPath) ? (
                      <>
                        <span>成片已保存到本地：</span>
                        <button
                          type="button"
                          onClick={() => void openRenderOutputFolder(renderOutputPath)}
                          className="inline text-left font-bold text-blue-600 underline decoration-blue-600/30 underline-offset-2 transition hover:text-blue-700"
                          title={`点击打开所在文件夹：${renderOutputPath}`}
                        >
                          {localFileName(renderOutputPath)}
                        </button>
                      </>
                    ) : renderDownloadMessage}
                  </div>
                )}
                <div className="mt-3 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-text-muted">
                  {hasFormalVideo
                    ? '成片已就绪。使用底部唯一主按钮进入内容发布，将自动带入作品标题、文案和成片信息。'
                    : '选定视频版本后，使用底部唯一主按钮生成成片。'}
                </div>
              </div>
            </div>
          </div>
        );
      }
    }
  };

  const setupSignature = useMemo(() => JSON.stringify({
    mode,
    contentMode,
    platform,
    ratio,
    duration,
    selectedProductIds: [...selectedProductIds].sort(),
    productInfo: activeProductInfo.trim(),
    audience: audience.trim(),
    primaryCta: effectivePrimaryCta.trim(),
    cooperationRoute,
    sellingPoints: sellingPoints.trim(),
    tone,
    videoThemeId,
    themePainPoint: themePainPoint.trim(),
    themeConversionGoal: themeConversionGoal.trim(),
    selectedMaterialIds: selectedVisualClips.map(item => item.id).sort(),
    hookMaterialId,
    referenceId: videoKickoff?.generatedVideo?.id || videoKickoff?.video?.videoUrl || videoKickoff?.video?.sourceUrl || '',
  }), [mode, contentMode, platform, ratio, duration, selectedProductIds, activeProductInfo, audience, effectivePrimaryCta, cooperationRoute, sellingPoints, tone, videoThemeId, themePainPoint, themeConversionGoal, selectedVisualClips, hookMaterialId, videoKickoff]);
  useEffect(() => {
    if (hasTimestampScript && !lastGeneratedSetupSignature) setLastGeneratedSetupSignature(setupSignature);
  }, [hasTimestampScript, lastGeneratedSetupSignature, setupSignature]);
  const setupChangedSinceGeneration = hasTimestampScript && Boolean(lastGeneratedSetupSignature) && lastGeneratedSetupSignature !== setupSignature;
  const primaryGeneratesSetupScript = contentMode === 'video' && step === 'mode' && (!hasTimestampScript || setupChangedSinceGeneration);
  const primaryReturnsToExistingScript = contentMode === 'video' && step === 'mode' && hasTimestampScript && !setupChangedSinceGeneration;
  const primaryGeneratesStoryboard = contentMode === 'video' && step === 'script' && scriptStageTab === 'theme' && !hasTimestampScript;
  const primaryGeneratesPoster = contentMode === 'poster' && step === 'poster';
  const primaryGeneratesCopy = contentMode === 'video' && step === 'script' && scriptStageTab === 'voiceover' && !hasRequestedVoiceDrafts;
  const primaryGeneratesVoice = contentMode === 'video' && step === 'script' && scriptStageTab === 'audio' && voiceoverMode === 'ai' && !hasRequestedVoiceovers;
  const primaryGeneratesSubtitles = contentMode === 'video' && step === 'script' && scriptStageTab === 'subtitle' && !hasRequestedSubtitles;
  const storyboardGenerationBlocked = modeActionLoading || (mode === 'clone' && hasIncompleteReferenceAnalysis(videoKickoff));
  const workbenchStageId = stageIdx === 0 ? 'settings' : stageIdx === 1 ? 'script' : 'production';
  const workbenchSteps: StudioWorkbenchStep[] = contentMode === 'poster'
    ? [
      { id: 'settings', label: '创作设置', status: stageIdx > 0 ? 'complete' : 'active' },
      { id: 'script', label: '素材准备', status: stageIdx > 1 ? 'complete' : stageIdx === 1 ? 'active' : 'upcoming' },
      { id: 'production', label: '图文制作', status: stageIdx === 2 ? 'active' : 'upcoming' },
    ]
    : [
      { id: 'settings', label: '创作设置', status: stageIdx > 0 ? 'complete' : 'active' },
      { id: 'script', label: '脚本与声音', status: stageIdx > 1 ? 'complete' : stageIdx === 1 ? 'active' : 'upcoming' },
      { id: 'production', label: '成片制作', status: stageIdx === 2 ? 'active' : 'upcoming' },
    ];
  const productVisualCount = selectedProductOptions.reduce((sum, item) => sum + (item.imageUrls?.length || 0), 0)
    + selectedVisualClips.filter(item => /^(product|detail|packaging)$/.test(item.folder)).length;
  const setupReadiness = mode === 'material'
    ? {
      status: selectedVisualClips.length ? (materialCoverageReady ? 'ready' : 'adjustable') : 'blocked',
      title: selectedVisualClips.length ? (materialCoverageReady ? '素材可直接规划' : '素材可用，建议调整时长') : '请先从素材库选择画面',
      detail: selectedVisualClips.length
        ? `${selectedVisualClips.length} 项素材 · 有效 ${effectiveSelectedDuration.toFixed(1)}s · 建议成片 ${recommendedMaterialDuration}s`
        : '不要求上传新文件，选择素材库里的已有视频或图片即可。',
    }
    : mode === 'clone'
      ? {
        status: videoKickoff && !hasIncompleteReferenceAnalysis(videoKickoff) ? (selectedVisualClips.length ? 'ready' : 'adjustable') : 'blocked',
        title: videoKickoff ? (hasIncompleteReferenceAnalysis(videoKickoff) ? '参考片仍在分析' : '参考结构已准备') : '缺少参考视频',
        detail: selectedVisualClips.length
          ? `参考结构 + ${selectedVisualClips.length} 项企业素材；将优先使用真实画面。`
          : '可先生成脚本，成片前再补企业真实素材；不会把参考片当成可发布素材。',
      }
      : {
        status: activeProductInfo.trim() ? (productVisualCount ? 'ready' : 'adjustable') : 'blocked',
        title: activeProductInfo.trim() ? (productVisualCount ? '产品事实与画面已准备' : '可先生成内容方案') : '请先选择产品',
        detail: productVisualCount
          ? `${productVisualCount} 项产品视觉依据可用于后续分镜。`
          : '当前没有产品画面：可生成脚本、翻译和配音，但成片前必须补齐真实产品视觉。',
      };
  const storyboardFeasibility = useMemo(() => {
    const rows = storyboardSlots.map(slot => {
      const assigned = materialById.get(storyboardAssignmentIdForMode(slot.id, activeVoiceLang, storyboardAssignments, shotMediaModes) || '');
      const candidates = assigned ? [assigned] : selectedVisualClips;
      const best = candidates.map(clip => ({ clip, assessment: assessMaterialMatch(slot, clip, ratio) }))
        .sort((a, b) => b.assessment.score - a.assessment.score)[0];
      return { slot, clip: best?.clip, assessment: best?.assessment };
    });
    const direct = rows.filter(item => item.assessment?.level === 'direct').length;
    const review = rows.filter(item => item.assessment?.level === 'review').length;
    const missing = rows.filter(item => !item.assessment || item.assessment.level === 'missing');
    return {
      rows,
      direct,
      review,
      missing,
      status: missing.length ? 'blocked' as const : review ? 'adjustable' as const : 'ready' as const,
    };
  }, [activeVoiceLang, materialById, ratio, selectedVisualClips, shotMediaModes, storyboardAssignments, storyboardSlots]);
  const activeWorkbenchSlot = storyboardSlots.find(item => item.id === activeStoryboardSlotId) || storyboardSlots[0];
  const activeShotDigitalHuman = activeWorkbenchSlot ? shotDigitalHumanBindings[digitalHumanLanguageKey(activeWorkbenchSlot.id, activeVoiceLang)] : undefined;
  const activeShotMediaMode = activeWorkbenchSlot
    ? shotMediaModes[activeWorkbenchSlot.id] || (activeShotDigitalHuman ? 'digital' : 'material')
    : 'material';
  const avatarIdsWithMotionPack = new Set(materials
    .filter(item => item.assetRole === 'avatar_motion_clip' && item.motionClip && item.avatarId)
    .map(item => item.avatarId as string));
  const digitalHumanAvatars = materials.filter(item => (
    item.folder === 'presenter'
    && item.type === 'video'
    && item.assetRole === 'avatar_master'
    && item.productionReady === true
    && (!item.personSetup || item.personSetup.state === 'ready')
    && item.rightsStatus === 'commercial_cleared'
    && (avatarIdsWithMotionPack.has(item.id) || personIsReady(item))
  ));
  const explicitlySelectedPerson = shotPreferredAvatarIds[activeWorkbenchSlot?.id || ''] || activeShotDigitalHuman?.avatarMaterialId;
  const activeDigitalHumanAvatar = selectPerson(digitalHumanAvatars, explicitlySelectedPerson, preferredDigitalHumanAvatarId, () => true);
  const activeWorkbenchClip = activeWorkbenchSlot
    ? materialById.get(storyboardAssignmentIdForMode(activeWorkbenchSlot.id, activeVoiceLang, storyboardAssignments, shotMediaModes) || '')
    : previewClip || selectedClips[0];
  const activeMaterialPlan = activeWorkbenchSlot ? sourcePlanFor(activeWorkbenchSlot) : null;
  const activeMaterialAssessment = activeWorkbenchSlot && activeWorkbenchClip
    ? assessMaterialMatch(activeWorkbenchSlot, activeWorkbenchClip, ratio)
    : null;
  const activeMaterialCandidates = useMemo(() => {
    if (!activeWorkbenchSlot) return [] as Array<{ clip: Clip; assessment: MaterialMatchAssessment }>;
    return materials
      .filter(clip => (
        (clip.type === 'video' || clip.type === 'image')
        && clip.usage !== 'reference_only'
        && clip.folder !== 'presenter'
        && clip.assetRole !== 'avatar_master'
        && clip.assetRole !== 'avatar_motion_clip'
        && clip.assetRole !== 'generated_clip'
      ))
      .map(clip => ({ clip, assessment: assessMaterialMatch(activeWorkbenchSlot, clip, ratio) }))
      .sort((a, b) => b.assessment.score - a.assessment.score)
      .slice(0, 6);
  }, [activeWorkbenchSlot, materials, ratio]);
  const assignWorkbenchMaterial = (clip: Clip) => {
    if (!activeWorkbenchSlot) return;
    const slot = activeWorkbenchSlot;
    const assessment = assessMaterialMatch(slot, clip, ratio);
    const detectedSource = clipSourceMode(clip);
    setStoryboardAssignments(current => ({ ...current, [slot.id]: clip.id }));
    setSelected(current => current.includes(clip.id) ? current : [...current, clip.id]);
    setClipEdits(current => ({ ...current, [slotClipEditKey(slot.id, clip.id)]: defaultEditForSlot(clip, slot) }));
    setStoryboardSourcePlans(current => ({
      ...current,
      [slot.id]: {
        ...sourcePlanFor(slot),
        mode: detectedSource,
        decided: true,
        confirmed: true,
        generatedClipId: detectedSource === 'ai' ? clip.id : undefined,
        error: '',
        matchScore: assessment.score,
        matchReason: assessment.reason,
        matchDifference: assessment.difference,
        matchLevel: assessment.level,
      },
    }));
    setPreviewClip(clip);
    setCanvasView('creation');
    const currentIndex = storyboardSlots.findIndex(item => item.id === slot.id);
    const prospectiveAssignments = { ...storyboardAssignments, [slot.id]: clip.id };
    const orderedFollowingSlots = [...storyboardSlots.slice(currentIndex + 1), ...storyboardSlots.slice(0, currentIndex)];
    const nextSlot = orderedFollowingSlots.find(item => !storyboardAssignmentIdForMode(item.id, activeVoiceLang, prospectiveAssignments, shotMediaModes));
    if (nextSlot) setActiveStoryboardSlotId(nextSlot.id);
    setModeNotice(`已为分镜 ${currentIndex + 1} 选择“${clip.name}”，将从素材第一帧起按分镜时长自动裁切。`);
  };
  const workbenchSeekTime = activeWorkbenchSlot && activeWorkbenchClip?.type === 'video'
    ? (() => {
      const edit = editForSlot(activeWorkbenchClip, activeWorkbenchSlot);
      const localOffset = workbenchTimelineTime >= activeWorkbenchSlot.start && workbenchTimelineTime <= activeWorkbenchSlot.end
        ? workbenchTimelineTime - activeWorkbenchSlot.start
        : 0;
      return edit.trimStart + Math.max(0, localOffset) * Math.max(0.1, edit.speed || 1);
    })()
    : 0;
  useEffect(() => {
    const video = workbenchVideoRef.current;
    if (!video || activeWorkbenchClip?.type !== 'video') return;
    const seek = () => {
      const maxTime = Number.isFinite(video.duration) && video.duration > 0
        ? Math.max(0, video.duration - 0.05)
        : workbenchSeekTime;
      try {
        video.pause();
        video.currentTime = Math.min(Math.max(0, workbenchSeekTime), maxTime);
      } catch { /* 等待媒体元数据后由 loadedmetadata 再定位 */ }
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener('loadedmetadata', seek, { once: true });
    return () => video.removeEventListener('loadedmetadata', seek);
  }, [activeWorkbenchClip?.id, activeWorkbenchClip?.type, activeWorkbenchSlot?.id, workbenchSeekTime]);
  const focusWorkbenchStoryboardSlot = (slotId: string) => {
    const nextSlot = storyboardSlots.find(item => item.id === slotId);
    if (!nextSlot) return;
    if (activeWorkbenchSlot?.id === slotId && activeWorkbenchClip?.type === 'video') {
      const video = workbenchVideoRef.current;
      const seekTo = editForSlot(activeWorkbenchClip, nextSlot).trimStart;
      if (video && video.readyState >= 1) {
        try {
          video.pause();
          video.currentTime = Math.min(Math.max(0, seekTo), Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.05) : seekTo);
        } catch { /* ignore media seek edge cases */ }
      }
    }
    setActiveStoryboardSlotId(slotId);
    setWorkbenchTimelineTime(nextSlot.start);
    setCanvasView('creation');
  };
  const workbenchTimelineDuration = Math.max(0.1, ...storyboardSlots.map(slot => slot.end));
  const seekWorkbenchTimeline = (nextTime: number) => {
    const safeTime = Math.max(0, Math.min(workbenchTimelineDuration, nextTime));
    const nextSlot = storyboardSlots.find(slot => safeTime >= slot.start && safeTime < slot.end)
      || storyboardSlots[storyboardSlots.length - 1];
    setWorkbenchTimelineTime(safeTime);
    if (!nextSlot) return;
    setActiveStoryboardSlotId(nextSlot.id);
    setCanvasView('creation');
    if (step === 'cover') setCoverTimelineCaptureMode(true);
  };
  const timeFromWorkbenchTimelinePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return 0;
    return Math.max(0, Math.min(workbenchTimelineDuration, ((event.clientX - bounds.left) / bounds.width) * workbenchTimelineDuration));
  };
  const captureWorkbenchCoverFrame = () => {
    if (activeWorkbenchClip?.type === 'image') {
      setCapturedCoverFrameUrl(activeWorkbenchClip.url || activeWorkbenchClip.poster || '');
      setCover(activeWorkbenchClip.id);
      setCoverUrl(null);
      setCoverTimelineCaptureMode(false);
      setCoverCaptureNotice('已将当前图片设为封面底图。');
      return;
    }
    const video = workbenchVideoRef.current;
    if (!video || activeWorkbenchClip?.type !== 'video' || !video.videoWidth || !video.videoHeight) {
      setCoverCaptureNotice('当前画面尚未加载完成，请稍等后再截取。');
      return;
    }
    try {
      const maxWidth = 1280;
      const scale = Math.min(1, maxWidth / video.videoWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法创建封面画布');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      setCapturedCoverFrameUrl(canvas.toDataURL('image/jpeg', 0.9));
      setCover(activeWorkbenchClip.id);
      setCoverUrl(null);
      setCoverTimelineCaptureMode(false);
      setCoverCaptureNotice(`已截取 ${workbenchTimelineTime.toFixed(1)}s 画面作为封面。`);
    } catch {
      setCoverCaptureNotice('该素材暂不允许浏览器直接截帧，请选择推荐封面或换一段本地素材。');
    }
  };
  const coverRecommendationClips = useMemo(() => {
    const pool = frameCandidates.length ? frameCandidates : materials.filter(item => item.type !== 'audio' && (item.poster || item.url));
    if (pool.length <= 3) return pool;
    return [pool[0], pool[Math.floor((pool.length - 1) / 2)], pool[pool.length - 1]].filter((item, index, rows) => item && rows.findIndex(row => row?.id === item.id) === index);
  }, [frameCandidates, materials]);
  const updateWorkbenchStoryboardSlot = (slotId: string, detail: string) => {
    const rebuilt = storyboardSlots.map(slot => {
      const nextDetail = slot.id === slotId ? detail : slot.detail;
      return `[${slot.start.toFixed(1)}s-${slot.end.toFixed(1)}s]\n${nextDetail.trim()}`;
    }).join('\n\n');
    applyTimestampScript(rebuilt);
  };
  const workbenchStoryboardItems = storyboardSlots.map((slot, index) => {
    const material = materialById.get(storyboardAssignmentIdForMode(slot.id, activeVoiceLang, storyboardAssignments, shotMediaModes) || '');
    const materialAssessment = material ? assessMaterialMatch(slot, material, ratio) : null;
    const slotScript = storyboardSlotScript(slot.detail);
    const working = Boolean(storyboardGenerating[slot.id] || storyboardQualityChecking[slot.id]);
    const warning = Boolean(sourcePlanFor(slot).qualityError || sourcePlanFor(slot).error);
    const copyReady = Boolean(voiceDrafts[activeVoiceLang]?.trim() || voiceoverLines.trim());
    const voiceReady = voiceoverMode === 'none' || (Boolean(voiceoverAudios[activeVoiceLang]?.url) && !voiceoverStaleLangs.includes(activeVoiceLang));
    const stageStatus = step === 'script'
      ? scriptStageTab === 'theme'
        ? { status: 'ready' as const, label: '脚本已生成' }
        : scriptStageTab === 'voiceover'
          ? copyReady ? { status: 'ready' as const, label: '口播已准备' } : { status: 'idle' as const, label: '待生成口播' }
          : scriptStageTab === 'audio'
            ? voiceReady ? { status: 'ready' as const, label: voiceoverMode === 'none' ? '无需口播' : '配音完成' } : { status: 'idle' as const, label: '待生成配音' }
            : alignedCuesByLang[activeVoiceLang]?.length ? { status: 'ready' as const, label: '字幕完成' } : { status: 'idle' as const, label: '待生成字幕' }
      : materialAssessment?.level === 'direct'
        ? { status: 'ready' as const, label: `匹配 ${materialAssessment.score} 分` }
        : materialAssessment?.level === 'review'
          ? { status: 'warning' as const, label: `需确认 ${materialAssessment.score} 分` }
          : material ? { status: 'warning' as const, label: `低匹配 ${materialAssessment?.score || 0} 分` } : { status: 'idle' as const, label: '待匹配' };
    return {
      id: slot.id,
      index: index + 1,
      title: slot.title || `分镜 ${index + 1}`,
      thumbnailUrl: material?.poster || (material?.type === 'image' ? material.url : undefined),
      duration: `${Math.max(0.1, slot.end - slot.start).toFixed(1)}s`,
      voiceover: slotScript.voice || slotScript.visual || slotScript.fallback,
      status: working ? 'working' as const : warning ? 'warning' as const : stageStatus.status,
      statusLabel: working ? '处理中' : warning ? '需检查' : stageStatus.label,
    };
  });
  const currentRenderableVideoVersions = buildRenderableVideoVersions();
  const currentRenderOutputFor = (version: typeof currentRenderableVideoVersions[number]) => {
    const output = languageRenderOutputs[version.key];
    return output?.inputSignature === version.inputSignature ? output : undefined;
  };
  const workbenchHasFormalVideo = currentRenderableVideoVersions.length > 0
    && currentRenderableVideoVersions.every(version => {
      const output = currentRenderOutputFor(version);
      return output?.status === 'done' && Boolean(output.path);
    });
  const activeWorkbenchRenderVersion = currentRenderableVideoVersions.find(version => version.key === activeRenderCombinationKey)
    || currentRenderableVideoVersions.find(version => version.code === activeVoiceLang)
    || currentRenderableVideoVersions[0];
  const activeWorkbenchRenderOutput = activeWorkbenchRenderVersion
    ? currentRenderOutputFor(activeWorkbenchRenderVersion)
    : undefined;
  const selectWorkbenchRenderVersion = (version: typeof currentRenderableVideoVersions[number]) => {
    stopPreview();
    setActiveRenderCombinationKey(version.key);
    setActiveVoiceLang(version.code);
    setLang(version.code);
    activateContentPlan(version.plan.id);
    setBgm(version.bgmId);
    const output = currentRenderOutputFor(version);
    setRenderOutputPath(output?.path || null);
    setRenderOutputPreviewUrl(output?.previewUrl || null);
  };
  const primaryGeneratesVideo = contentMode === 'video' && step === 'preview' && !workbenchHasFormalVideo;
  const workbenchRenderableVersionCount = primaryGeneratesVideo ? currentRenderableVideoVersions.length : 0;
  const generateSetupScriptAndContinue = async () => {
    if (mode === 'material' && !selectedVisualClips.length) {
      setModeNotice('请先选择本次创作要使用的素材。脚本会根据你明确选择的画面规划分镜。');
      setShowSetupMaterialPicker(true);
      return;
    }
    const generated = await generateTimestampScriptsForMode();
    if (!generated) return;
    setLastGeneratedSetupSignature(setupSignature);
    const scriptIndex = activeSteps.findIndex(item => item.id === 'script');
    if (scriptIndex >= 0) setStepIdx(scriptIndex);
    setScriptStageTab('theme');
    setShowFullScriptEditor(false);
    setCanvasView('creation');
  };
  const runPrimaryAction = () => {
    if (step === 'script' && scriptStageTab !== 'theme' && !hasTimestampScript) {
      setScriptStageTab('theme');
      setModeNotice('请先生成并确认分镜脚本，再继续口播、翻译和配音。');
      return;
    }
    if (step === 'preview' && workbenchHasFormalVideo) {
      goPublishCurrentWork();
      return;
    }
    if (primaryGeneratesPoster) {
      void generatePosterBrief();
      return;
    }
    if (primaryGeneratesStoryboard) {
      void generateTimestampScriptsForMode();
      return;
    }
    if (primaryGeneratesSetupScript) {
      void generateSetupScriptAndContinue();
      return;
    }
    if (primaryReturnsToExistingScript) {
      const scriptIndex = activeSteps.findIndex(item => item.id === 'script');
      if (scriptIndex >= 0) setStepIdx(scriptIndex);
      setScriptStageTab('theme');
      setCanvasView('creation');
      return;
    }
    if (primaryGeneratesVoice) {
      void genTts();
      return;
    }
    if (primaryGeneratesCopy) {
      void generateVoiceDrafts();
      return;
    }
    if (primaryGeneratesSubtitles) {
      void generateSubtitleDrafts();
      return;
    }
    if (primaryGeneratesVideo) {
      void renderAllReadyLanguageVersions().catch(error => {
        setModeNotice(error instanceof Error ? error.message : '成片生成失败，请重试。');
      });
      return;
    }
    next();
  };

  const primaryActionLabel = primaryGeneratesPoster
    ? posterJsonText ? '重新生成图文' : '生成图文'
    : primaryGeneratesSetupScript
      ? hasTimestampScript ? '更新脚本' : '生成脚本'
    : primaryReturnsToExistingScript
      ? '返回脚本与声音'
    : primaryGeneratesStoryboard
      ? '生成脚本'
      : primaryGeneratesCopy
        ? '一键生成文案'
      : primaryGeneratesVoice
        ? '一键生成口播语音'
        : primaryGeneratesSubtitles
          ? '一键生成字幕文案'
        : primaryGeneratesVideo
          ? '生成成片'
      : step === 'script'
        ? scriptStageTab === 'theme'
          ? '确认分镜'
          : scriptStageTab === 'voiceover'
            ? '进入口播语音'
            : scriptStageTab === 'subtitle'
              ? '进入配乐'
            : scriptStageTab === 'bgm'
              ? '进入成片制作'
            : voiceoverMode === 'unselected'
              ? '选择声音策略'
              : voiceoverMode === 'none'
                ? '进入成片制作'
                : voiceoverMode === 'upload'
                  ? voiceoverUrl ? '进入成片制作' : '等待上传口播'
                  : hasAnyVoiceover ? '进入成片制作' : '生成配音'
        : step === 'material'
          ? canNext ? '确认素材' : assignedCount < storyboardSlots.length
            ? `还需匹配 ${Math.max(0, storyboardSlots.length - assignedCount)} 个分镜`
            : `确认 ${storyboardMatchReviewPendingCount} 个匹配`
          : step === 'bgm'
            ? '确认配乐'
            : step === 'cover'
              ? '预览成片'
              : step === 'preview' && workbenchHasFormalVideo
                ? '进入内容发布'
                : '下一步';
  const primaryActionBlockedReason = primaryGeneratesSetupScript && mode === 'material' && !selectedVisualClips.length
    ? '先选择本次创作素材，脚本才会按真实画面生成。'
    : (primaryGeneratesSetupScript || primaryGeneratesStoryboard) && mode === 'clone' && hasIncompleteReferenceAnalysis(videoKickoff)
    ? '参考视频尚未完成分析，请稍后再生成脚本。'
    : step === 'script' && scriptStageTab !== 'theme' && !hasTimestampScript
      ? '请先生成并确认分镜脚本。'
    : primaryGeneratesCopy && !hasTimestampScript
      ? '请先保存脚本，再生成多语言文案。'
    : primaryGeneratesVoice && !hasRequestedVoiceDrafts
      ? '请先一键生成所选语言文案，再生成口播语音。'
    : primaryGeneratesSubtitles && !hasRequestedVoiceDrafts
      ? '请先完成所选语言文案。'
      : primaryGeneratesVideo && workbenchRenderableVersionCount === 0
        ? '请先完成一种语言的口播，并为所有分镜匹配素材。'
    : step === 'material' && !canNext
      ? assignedCount < storyboardSlots.length
        ? `仍有 ${Math.max(0, storyboardSlots.length - assignedCount)} 个分镜缺少素材。`
        : `有 ${storyboardMatchReviewPendingCount} 个 60–79 分的素材匹配需要确认。`
      : step === 'script' && !canNext && !primaryGeneratesStoryboard
        ? voiceoverMode === 'unselected' ? '请选择 AI 配音、上传口播或无口播。' : '至少完成一种语言的有效口播，或明确选择无口播。'
        : undefined;
  const primaryActionLoading = primaryGeneratesPoster ? posterLoading : primaryGeneratesSetupScript || primaryGeneratesStoryboard ? modeActionLoading : primaryGeneratesCopy ? voiceDraftLoading : primaryGeneratesSubtitles ? subtitleGenerating : ttsLoading || rendering || batchRenderingLangs;
  const primaryActionDisabled = primaryGeneratesPoster
    ? posterLoading
    : primaryGeneratesSetupScript || primaryGeneratesStoryboard
      ? storyboardGenerationBlocked || (primaryGeneratesSetupScript && mode === 'material' && !selectedVisualClips.length)
      : primaryGeneratesCopy
        ? voiceDraftLoading || !hasTimestampScript
      : primaryGeneratesVoice
        ? ttsLoading || !hasTimestampScript || !hasRequestedVoiceDrafts
      : primaryGeneratesSubtitles
        ? subtitleGenerating || !hasRequestedVoiceDrafts
        : primaryGeneratesVideo
          ? rendering || batchRenderingLangs || workbenchRenderableVersionCount === 0
      : step === 'preview'
        ? !workbenchHasFormalVideo || rendering || batchRenderingLangs
        : !canNext;
  const activeLanguageLabel = LANGS.find(item => item.code === activeVoiceLang)?.label || activeVoiceLang;
  const workflowTaskLabel: Record<string, string> = {
    content_mode_routing: '选择内容生产路径',
    content_production: '脚本、素材与成片生产',
    content_quality_gate: '内容质量门',
    content_release_approval: '内容发布审批',
    publishing_calendar: '发布日历',
    platform_publish: '平台发布',
  };
  const agentSourceContext = projectWorkflowContext?.taskKey
    ? `${projectWorkflowContext.preview ? '计划预览' : '内容 Agent'} · ${workflowTaskLabel[projectWorkflowContext.taskKey] || projectWorkflowContext.taskKey}`
    : studioAgentSourceLabel(videoKickoff?.actionContext?.source || videoKickoff?.source);
  const focusProductContext = activeProductLabel || '待选择企业产品';
  const activeSlotTime = activeWorkbenchSlot && activeWorkbenchSlot.end > activeWorkbenchSlot.start
    ? `${activeWorkbenchSlot.start.toFixed(1)}s–${activeWorkbenchSlot.end.toFixed(1)}s`
    : '';
  const workbenchPropertyTitle = step === 'mode' ? '创作设置'
    : step === 'script' && scriptStageTab === 'theme' ? '分镜脚本'
      : step === 'script' && scriptStageTab === 'voiceover' ? '口播与翻译'
        : step === 'script' && scriptStageTab === 'audio' ? '口播语音'
          : step === 'script' && scriptStageTab === 'subtitle' ? '字幕文案'
            : step === 'script' && scriptStageTab === 'bgm' ? '配乐设置'
          : step === 'script' ? '脚本与声音'
          : step === 'material' && activeWorkbenchSlot ? `分镜 ${storyboardSlots.findIndex(item => item.id === activeWorkbenchSlot.id) + 1} · 素材匹配`
            : step === 'bgm' ? '配乐设置'
              : step === 'cover' ? '封面设置'
                : step === 'preview' ? '合成输出'
                  : step === 'poster' ? '图文制作'
                    : activeSteps.find(item => item.id === step)?.label || '当前设置';
  const workbenchPropertyDescription = step === 'mode' ? '确认内容、素材与输出参数'
    : step === 'script' && scriptStageTab === 'theme' ? (activeSlotTime || '确认分镜结构与内容')
      : step === 'script' && scriptStageTab === 'voiceover' ? `${activeLanguageLabel} · 选择语言并生成文案`
        : step === 'script' && scriptStageTab === 'audio' ? `${activeLanguageLabel} · 选择声音策略并生成语音`
          : step === 'script' && scriptStageTab === 'subtitle' ? `${activeLanguageLabel} · 生成并调整字幕`
            : step === 'script' && scriptStageTab === 'bgm' ? '试听、上传并选择整片背景音乐'
          : step === 'script' ? '完成脚本与声音设置'
        : step === 'material' && activeWorkbenchSlot ? `${activeSlotTime || '当前分镜'} · ${activeMaterialAssessment ? `匹配 ${activeMaterialAssessment.score} 分` : '待匹配'}`
          : activeStages[stageIdx]?.hint;
  const workflowSourceLanguage = detectScriptLanguageCode(voiceoverLines || extractVoiceoverText(script)) || voiceLangs[0] || 'zh';
  const removeTranslationLanguage = (code: string) => {
    if (!code || code === workflowSourceLanguage) return;
    if (voiceDraftLoading) {
      voiceDraftAbortRef.current?.abort();
      voiceDraftAbortRef.current = null;
      setVoiceDraftLoading(false);
      setVoiceDraftPendingLangs([]);
      setVoiceDraftNotice('已按新的语种选择停止上一次翻译；已完成的文案已保留。');
    }
    setVoiceLangs(current => [workflowSourceLanguage, ...current.filter(item => item !== workflowSourceLanguage && item !== code)]);
    setVoiceDrafts(current => { const next = { ...current }; delete next[code]; return next; });
    setVoiceDraftStaleLangs(current => current.filter(item => item !== code));
    setVoiceDraftPendingLangs(current => current.filter(item => item !== code));
    setVoiceDraftFailedLangs(current => current.filter(item => item !== code));
    setVoiceDraftDegradedLangs(current => current.filter(item => item !== code));
    setVoiceoverAudios(current => { const next = { ...current }; delete next[code]; return next; });
    setVoiceoverStaleLangs(current => current.filter(item => item !== code));
    setAlignedCuesByLang(current => { const next = { ...current }; delete next[code]; return next; });
    setTtsLanguageSettings(current => { const next = { ...current }; delete next[code]; return next; });
    setTtsFailuresByLang(current => { const next = { ...current }; delete next[code]; return next; });
    // Render combinations encode language in their key. Clearing generated
    // outputs is safer than publishing a version for a language the user has
    // explicitly removed.
    setRenderOutputPath(null);
    setRenderOutputPreviewUrl(null);
    setLanguageRenderOutputs({});
    setLanguageRenderVersions({});
    if (activeVoiceLang === code) {
      setActiveVoiceLang(workflowSourceLanguage);
      setLang(workflowSourceLanguage);
    }
  };
  const toggleTranslationLanguage = (code: string) => {
    if (code === workflowSourceLanguage) return;
    if (voiceLangs.includes(code)) {
      removeTranslationLanguage(code);
      return;
    }
    setVoiceLangs(current => {
      const sourceFirst = [workflowSourceLanguage, ...current.filter(item => item !== workflowSourceLanguage)];
      return [...sourceFirst, code];
    });
  };
  const languageSwitcher = (
    <section className="space-y-2" aria-label="创作语言">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold text-text-muted">已选 {voiceLangs.length} 种 · 翻译语种可随时删除</p>
        {voiceLangs.length === 1 && <span className="text-[9px] font-bold text-emerald-700">仅生成原文</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {voiceLangs.map(code => {
          const selectedLanguage = activeVoiceLang === code;
          const failed = voiceDraftFailedLangs.includes(code) || Boolean(ttsFailuresByLang[code]);
          const degraded = voiceDraftDegradedLangs.includes(code);
          const stale = voiceDraftStaleLangs.includes(code);
          const isSource = code === workflowSourceLanguage;
          return (
            <div key={code} className={`flex items-center overflow-hidden rounded-lg border transition ${selectedLanguage ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : failed ? 'border-red-200 bg-red-50 text-red-600' : stale || degraded ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-border bg-white text-text-secondary'}`}>
              <button type="button" onClick={() => { setActiveVoiceLang(code); setLang(code); }} className="px-2.5 py-1.5 text-[10px] font-bold hover:bg-black/[0.03]">
                {LANGS.find(item => item.code === code)?.label || code}{isSource ? ' · 原文' : failed ? ' · 缺失' : stale ? ' · 待同步' : degraded ? ' · 本地兜底' : ''}
              </button>
              {!isSource && <button type="button" onClick={() => removeTranslationLanguage(code)} aria-label={`删除 ${LANGS.find(item => item.code === code)?.label || code}`} title="不再生成该语种" className="mr-1 flex h-5 w-5 items-center justify-center rounded-md hover:bg-black/10"><X size={10} /></button>}
            </div>
          );
        })}
        <button type="button" onClick={() => setShowLanguagePicker(value => !value)} className="rounded-lg border border-dashed border-border px-2.5 py-1.5 text-[10px] font-bold text-text-muted hover:border-emerald-300 hover:text-emerald-700">
          {showLanguagePicker ? <ChevronDown size={11} className="mr-1 inline rotate-180" /> : <Plus size={11} className="mr-1 inline" />}
          {showLanguagePicker ? '收起语种库' : '添加翻译语种（可选）'}
        </button>
      </div>
      {showLanguagePicker && (
        <div className="max-h-48 overflow-y-auto rounded-xl border border-border bg-surface-2 p-2">
          <div className="flex items-start justify-between gap-2 px-1 pb-2">
            <p className="text-[10px] leading-4 text-text-muted">可多选，也可以不选择；原文语言会始终保留。</p>
            <button type="button" onClick={() => setShowLanguagePicker(false)} className="shrink-0 rounded-md px-2 py-1 text-[9px] font-bold text-text-secondary hover:bg-white">收起</button>
          </div>
          <div className="grid grid-cols-2 gap-1">
            {LANGS.filter(item => item.code !== workflowSourceLanguage).map(item => {
              const checked = voiceLangs.includes(item.code);
              return <label key={item.code} className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-[10px] font-bold ${checked ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:bg-white/70'}`}><input type="checkbox" checked={checked} onChange={() => toggleTranslationLanguage(item.code)} className="accent-emerald-600" />{item.label}</label>;
            })}
          </div>
        </div>
      )}
    </section>
  );

  const applyWorkbenchBgm = (trackId: string) => {
    setBgm(trackId);
    setAssemblyBgms(current => ({ ...current, [activeAssemblyId]: trackId }));
    setMaterialVersionBgms(current => ({ ...current, [materialVersionKey(activeAssemblyId, activeVoiceLang)]: trackId }));
    setPreviewBgmOn(Boolean(trackId));
  };
  const workbenchFormalPreviewUrl = activeWorkbenchRenderOutput?.previewUrl || '';
  const workbenchProductionPanel = (step === 'bgm' || (step === 'script' && scriptStageTab === 'bgm')) ? (
    <section ref={bgmLibraryRef} className="space-y-3">
      <input ref={bgmInputRef} type="file" accept="audio/*" className="hidden" onChange={event => { void handleBgmUpload(event.target.files); event.target.value = ''; }} />
      <div className="rounded-xl border border-border bg-surface-2 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><p className="text-xs font-black text-text-primary">当前配乐</p><p className="mt-1 truncate text-[10px] text-text-muted">{selectedBgmTrack?.name || '不配乐，仅保留口播'}</p></div>
          {selectedBgmTrack && <button type="button" onClick={() => togglePlay(selectedBgmTrack)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-white text-text-secondary">{playingBgm === selectedBgmTrack.id ? <Pause size={13} /> : <Play size={13} />}</button>}
        </div>
        <label className="mt-3 block text-[10px] font-bold text-text-secondary">配乐音量 · {bgmVol}%<input type="range" min="0" max="100" value={bgmVol} disabled={!bgm} onChange={event => setBgmVol(Number(event.target.value))} className="mt-2 w-full accent-emerald-600 disabled:opacity-35" /></label>
        {selectedBgmTrack && <p className="mt-2 rounded-lg border border-border bg-white px-2.5 py-2 text-[9px] leading-4 text-text-muted">从视频 0 秒开始铺满整片；音乐不足 {workbenchTimelineDuration.toFixed(1)} 秒时自动循环，超过时从开头截到成片结束。口播出现时配乐自动降为当前音量的一半。</p>}
      </div>
      <button type="button" onClick={() => setBgmLibraryOpen(value => !value)} className="flex w-full items-center justify-between rounded-xl border border-border bg-white px-3 py-3 text-left">
        <span><span className="block text-xs font-black text-text-primary">选择配乐</span><span className="mt-0.5 block text-[10px] text-text-muted">{bgms.length} 首音乐，可试听后选择</span></span>
        <ChevronDown size={14} className={`text-text-muted transition ${bgmLibraryOpen ? 'rotate-180' : ''}`} />
      </button>
      {bgmLibraryOpen && (
        <div className="space-y-2 rounded-xl border border-border bg-surface-2 p-2">
          <div className="flex items-center justify-between gap-2 px-1 pb-1"><p className="text-[10px] font-bold text-text-muted">曲库</p><button type="button" onClick={() => bgmInputRef.current?.click()} disabled={bgmUploading} className="rounded-md border border-border bg-white px-2 py-1 text-[9px] font-bold text-text-secondary">{bgmUploading ? '上传中…' : '上传音乐'}</button></div>
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            <button type="button" onClick={() => { applyWorkbenchBgm(''); audioRef.current?.pause(); setPlayingBgm(null); }} className={`flex w-full items-center gap-2 rounded-lg border p-2 text-left ${!bgm ? 'border-emerald-300 bg-emerald-50' : 'border-border bg-white'}`}><span className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-2"><X size={12} /></span><span className="min-w-0 flex-1 text-[10px] font-black text-text-primary">不配乐</span>{!bgm && <Check size={12} className="text-emerald-600" />}</button>
            {bgms.map(track => (
              <div key={track.id} className={`flex items-center gap-2 rounded-lg border p-2 ${bgm === track.id ? 'border-emerald-300 bg-emerald-50' : 'border-border bg-white'}`}>
                <button type="button" onClick={() => togglePlay(track)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-secondary">{playingBgm === track.id ? <Pause size={12} /> : <Play size={12} />}</button>
                <button type="button" onClick={() => applyWorkbenchBgm(track.id)} className="min-w-0 flex-1 text-left"><span className="block truncate text-[10px] font-black text-text-primary">{track.name}</span><span className="mt-0.5 block truncate text-[9px] text-text-muted">{track.mood || '背景音乐'} · {fmtDur(track.duration)}</span></button>
                <button type="button" onClick={() => toggleFavoriteBgm(track.id)} className="flex h-7 w-7 shrink-0 items-center justify-center text-text-muted"><Heart size={12} fill={favoriteBgms.includes(track.id) ? 'currentColor' : 'none'} /></button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setBgmLibraryOpen(false)} className="w-full rounded-lg border border-border bg-white px-3 py-2 text-[10px] font-bold text-text-secondary">收起曲库</button>
        </div>
      )}
      {bgmNotice && <p className={`rounded-lg border px-3 py-2 text-[10px] leading-4 ${/失败|错误|未返回/.test(bgmNotice) ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{bgmNotice}</p>}
      <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[10px] leading-4 text-text-muted">视频画面统一在中间预览；这里仅负责试听和调整配乐。</p>
    </section>
  ) : step === 'cover' ? (
    <section className="space-y-3">
      <div><p className="text-xs font-black text-text-primary">封面与标题</p><p className="mt-1 text-[10px] leading-4 text-text-muted">中间区域实时显示封面，这里只保留必要参数。</p></div>
      <label className="block text-[10px] font-bold text-text-secondary">封面底图<select value={cover} onChange={event => { setCover(event.target.value); setCapturedCoverFrameUrl(''); setCoverTimelineCaptureMode(false); setCoverUrl(null); }} className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-2 text-[10px]">{frameCandidates.length ? frameCandidates.map(item => <option key={item.id} value={item.id}>{item.name}</option>) : <option value="">暂无可用素材</option>}</select></label>
      <div className="rounded-xl border border-border bg-surface-2 p-3">
        <div className="flex items-center justify-between gap-2"><div><p className="text-[10px] font-black text-text-primary">从素材截取封面</p><p className="mt-0.5 text-[9px] text-text-muted">拖动底部整片时间轴定位画面，再截取当前帧。</p></div><button type="button" onClick={() => { setCoverTimelineCaptureMode(true); setCanvasView('creation'); }} className="shrink-0 rounded-lg border border-border bg-white px-2.5 py-1.5 text-[9px] font-bold text-text-secondary">选择画面</button></div>
        {coverTimelineCaptureMode && <button type="button" onClick={captureWorkbenchCoverFrame} className="mt-2 w-full rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-black text-white">截取当前帧</button>}
        {coverCaptureNotice && <p className={`mt-2 text-[9px] leading-4 ${/不允许|无法|尚未/.test(coverCaptureNotice) ? 'text-red-600' : 'text-emerald-700'}`}>{coverCaptureNotice}</p>}
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between"><p className="text-[10px] font-black text-text-primary">推荐封面</p><span className="text-[9px] text-text-muted">从真实素材中推荐 3 张</span></div>
        <div className="grid grid-cols-3 gap-2">
          {coverRecommendationClips.map((item, index) => <button key={item.id} type="button" onClick={() => { setCover(item.id); setCapturedCoverFrameUrl(''); setCoverTimelineCaptureMode(false); setCoverUrl(null); setCoverCaptureNotice(`已选择推荐封面 ${index + 1}`); }} className={`overflow-hidden rounded-lg border text-left ${cover === item.id && !capturedCoverFrameUrl ? 'border-emerald-400 ring-1 ring-emerald-200' : 'border-border'}`}><div className="aspect-[4/3] bg-slate-950">{item.poster || item.type === 'image' ? <img src={item.poster || item.url} alt="" className="h-full w-full object-cover" /> : <video src={item.url} muted preload="metadata" className="h-full w-full object-cover" />}</div><p className="truncate bg-white px-1.5 py-1 text-[8px] font-bold text-text-secondary">推荐 {index + 1}</p></button>)}
        </div>
      </div>
      <label className="block text-[10px] font-bold text-text-secondary">封面标题<textarea value={coverTitle} rows={3} onChange={event => { setCoverTitle(event.target.value); setCoverUrl(null); }} className="mt-1 w-full resize-y rounded-lg border border-border bg-white p-2 text-xs leading-5 outline-none focus:border-accent" /></label>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={regenCovers} disabled={coverLoading} className="rounded-lg border border-border bg-white px-3 py-2 text-[10px] font-bold text-text-secondary">{coverLoading ? '生成中…' : 'AI 重写标题'}</button>
        <button type="button" onClick={() => void openCanvaCoverEditor()} disabled={coverCanvaOpening} className="rounded-lg border border-border bg-white px-3 py-2 text-[10px] font-bold text-text-secondary">{coverCanvaOpening ? '打开中…' : '精细编辑封面'}</button>
      </div>
      <div className="rounded-xl border border-border bg-surface-2 p-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[10px] font-bold text-text-secondary">字体<select value={coverStyle.font} onChange={event => setCoverStyle(current => ({ ...current, font: event.target.value as CoverStyle['font'] }))} className="mt-1 h-8 w-full rounded-lg border border-border bg-white px-2 text-[10px]">{COVER_FONTS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label className="text-[10px] font-bold text-text-secondary">字号<select value={coverStyle.size} onChange={event => setCoverStyle(current => ({ ...current, size: event.target.value as CoverStyle['size'] }))} className="mt-1 h-8 w-full rounded-lg border border-border bg-white px-2 text-[10px]"><option value="S">小</option><option value="M">中</option><option value="L">大</option></select></label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">{['#ffffff', '#111827', '#16a34a', '#14b8a6', '#ef4444', '#3b82f6'].map(color => <button key={color} type="button" onClick={() => setCoverStyle(current => ({ ...current, color }))} className="h-6 w-6 rounded-full border" style={{ background: color, borderColor: coverStyle.color === color ? TRAFFIC_GREEN : 'var(--color-border)', boxShadow: coverStyle.color === color ? `0 0 0 2px ${TRAFFIC_GREEN}` : undefined }} />)}</div>
      </div>
    </section>
  ) : step === 'preview' ? (
    <section className="space-y-3">
      <div className={`rounded-xl border p-3 ${workbenchHasFormalVideo ? 'border-emerald-200 bg-emerald-50' : 'border-border bg-surface-2'}`}><p className="text-xs font-black text-text-primary">{workbenchHasFormalVideo ? '成片已生成' : '等待生成成片'}</p><p className="mt-1 text-[10px] leading-4 text-text-muted">{workbenchHasFormalVideo ? '正式成片在中间播放器查看，确认后可进入发布。' : '确认素材、配乐和封面后，点击底部“生成成片”。'}</p></div>
      <div className="space-y-2 rounded-xl border border-border bg-white p-3">
        <div className="flex items-center justify-between gap-2"><p className="text-[10px] font-black text-text-primary">语言成片</p><span className="text-[9px] text-text-muted">{currentRenderableVideoVersions.length} 个版本</span></div>
        {currentRenderableVideoVersions.map(version => {
          const output = currentRenderOutputFor(version);
          const selectedVersion = activeWorkbenchRenderVersion?.key === version.key;
          const statusLabel = output?.status === 'done' ? '已生成' : output?.status === 'rendering' ? '生成中' : output?.status === 'failed' ? '生成失败' : '待生成';
          return <div key={version.key} className={`rounded-lg border p-2 ${selectedVersion ? 'border-emerald-300 bg-emerald-50' : 'border-border bg-surface-2'}`}>
            <button type="button" onClick={() => selectWorkbenchRenderVersion(version)} className="flex w-full items-center justify-between gap-2 text-left"><span className="text-[10px] font-black text-text-primary">{LANGS.find(item => item.code === version.code)?.label || version.code}</span><span className={`text-[9px] font-bold ${output?.status === 'done' ? 'text-emerald-700' : output?.status === 'failed' ? 'text-red-600' : 'text-text-muted'}`}>{statusLabel}</span></button>
            {(output?.status === 'failed' || output?.status === 'done') && <div className="mt-2 flex gap-2 border-t border-border pt-2">
              {output.status === 'failed' && <button type="button" onClick={() => void retryLanguageRender(version)} className="text-[9px] font-black text-red-600">重试此语言</button>}
              {output.status === 'done' && output.path && <button type="button" onClick={() => void openRenderOutputFolder(output.path)} className="text-[9px] font-black text-blue-600">打开本地成片</button>}
            </div>}
          </div>;
        })}
        {!currentRenderableVideoVersions.length && <p className="rounded-lg border border-dashed border-border px-2 py-4 text-center text-[9px] text-text-muted">完成全部分镜后才会生成语言版本。</p>}
      </div>
      <div className="space-y-2 rounded-xl border border-border bg-white p-3 text-[10px]">
        <div className="flex justify-between gap-3"><span className="text-text-muted">内容版本</span><span className="truncate font-bold text-text-primary">{assemblyName}</span></div>
        <div className="flex justify-between gap-3"><span className="text-text-muted">语言</span><span className="truncate font-bold text-text-primary">{activeLanguageLabel}</span></div>
        <div className="flex justify-between gap-3"><span className="text-text-muted">配乐</span><span className="truncate font-bold text-text-primary">{selectedBgmTrack?.name || '不配乐'}</span></div>
        <div className="flex justify-between gap-3"><span className="text-text-muted">封面</span><span className="truncate font-bold text-text-primary">{coverClip?.name || '沿用首帧'}</span></div>
      </div>
      <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[10px] leading-4 text-text-muted">此处不再重复放置播放器，所有预览统一在中间区域完成。</p>
    </section>
  ) : null;

  return (
    <div className="flex flex-col h-full relative">
      {/* BGM 试听用的隐藏音频元素 */}
      <audio ref={audioRef} loop className="hidden" />

      <StudioWorkbenchFrame
        className="h-full min-h-0 rounded-none border-0 shadow-none lg:h-full lg:min-h-0"
        projectTitle={projectTitle}
        projectSubtitle={`${contentMode === 'video' ? '视频' : '图文'} · ${platform} · ${ratio}`}
        onProjectTitleChange={setProjectTitle}
        saveStatus={{
          state: autosaveStatus,
          savedAt: lastAutosavedAt?.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
          onRetry: () => void saveProject('draft'),
        }}
        steps={workbenchSteps}
        activeStepId={workbenchStageId}
        onStepChange={targetId => {
          const targetStageIndex = targetId === 'settings' ? 0 : targetId === 'script' ? 1 : 2;
          if (targetStageIndex > stageIdx) return;
          const anchor = activeSteps.findIndex(item => activeStages[targetStageIndex]?.steps.includes(item.id));
          if (anchor >= 0) setStepIdx(anchor);
        }}
        objectTitle={contentMode === 'video' && storyboardSlots.length ? '分镜脚本' : '创作输入'}
        objectDescription={contentMode === 'video' && storyboardSlots.length ? `${storyboardSlots.length} 个分镜 · 点击定位画面` : '生成前确认关键输入'}
        objectPanel={(
          contentMode === 'video' && storyboardSlots.length ? (
            <StudioStoryboardList items={workbenchStoryboardItems} selectedId={activeWorkbenchSlot?.id} onSelect={focusWorkbenchStoryboardSlot} />
          ) : (
            <StudioInputSummary
              title="已确认内容"
              description="只显示会影响本次生成的输入"
              items={[
                { id: 'agent-source', label: 'Agent 来源', value: agentSourceContext },
                { id: 'product', label: '焦点产品', value: activeProductLabel, emptyLabel: '待选择' },
                { id: 'theme', label: '主题', value: activeVideoTheme.title },
                { id: 'audience', label: '目标受众', value: audience.trim(), emptyLabel: '待填写' },
                { id: 'route', label: '合作路线', value: cooperationRoute, emptyLabel: '待选择' },
                { id: 'materials', label: '本次素材', value: selectedVisualClips.length ? `${selectedVisualClips.length} 项已选择` : '', emptyLabel: '待选择', thumbnailUrl: selectedVisualClips[0]?.poster || (selectedVisualClips[0]?.type === 'image' ? selectedVisualClips[0]?.url : undefined) },
                ...(mode === 'clone' && videoKickoff ? [{ id: 'reference', label: '参考视频', value: videoKickoff.video?.title || '已带入对标视频', thumbnailUrl: videoKickoff.video?.thumbnail || videoKickoff.video?.aiAnalysis?.materialPoster }] : []),
              ]}
              emptyAction={<button type="button" onClick={() => setShowSetupMaterialPicker(true)} className="rounded-lg border border-border px-3 py-2 text-[11px] font-bold text-text-secondary">选择素材</button>}
            />
          )
        )}
        canvasTitle=""
        canvasToolbar={mode === 'clone' && videoKickoff ? (
          <div className="flex rounded-lg border border-border bg-surface-2 p-0.5">
            <button type="button" onClick={() => setCanvasView('reference')} className={`rounded-md px-2 py-1 text-[10px] font-bold ${canvasView === 'reference' ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted'}`}>参考视频</button>
            <button type="button" onClick={() => setCanvasView('creation')} className={`rounded-md px-2 py-1 text-[10px] font-bold ${canvasView === 'creation' ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted'}`}>创作预览</button>
          </div>
        ) : undefined}
        propertyTitle={workbenchPropertyTitle}
        propertyDescription={workbenchPropertyDescription}
        propertyPanel={(
          <div className="space-y-4">
            <section aria-label="Agent 任务上下文" className="rounded-xl border border-sky-100 bg-sky-50/60 p-3">
              <p className="text-[10px] font-black uppercase tracking-[0.1em] text-sky-700">Agent 任务上下文</p>
              <dl className="mt-2 space-y-1.5 text-[10px] leading-4">
                <div className="flex gap-2"><dt className="shrink-0 text-text-muted">来源</dt><dd className="min-w-0 break-words font-bold text-text-primary">{agentSourceContext}</dd></div>
                <div className="flex gap-2"><dt className="shrink-0 text-text-muted">焦点产品</dt><dd className="min-w-0 break-words font-bold text-text-primary">{focusProductContext}</dd></div>
              </dl>
            </section>
            {contentMode === 'video' && step === 'mode' && (
              <section className={`rounded-xl border p-3 ${setupReadiness.status === 'ready' ? 'border-emerald-200 bg-emerald-50/60' : setupReadiness.status === 'adjustable' ? 'border-amber-200 bg-amber-50/60' : 'border-red-200 bg-red-50/60'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-black text-text-primary">当前模式的创作依据</p>
                    <p className="mt-1 text-xs font-black text-text-primary">{setupReadiness.title}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black ${setupReadiness.status === 'ready' ? 'bg-emerald-100 text-emerald-700' : setupReadiness.status === 'adjustable' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                    {setupReadiness.status === 'ready' ? '可执行' : setupReadiness.status === 'adjustable' ? '可先继续' : '需补充'}
                  </span>
                </div>
                <p className="mt-2 text-[10px] leading-4 text-text-secondary">{setupReadiness.detail}</p>
              </section>
            )}
            {contentMode === 'video' && stageIdx === 2 && (
              <section className="border-b border-border pb-3" aria-label="成片制作任务">
                <p className="px-1 pb-2 text-[10px] font-bold text-text-muted">成片制作任务</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {([
                    { id: 'material', label: '素材匹配', done: storyboardSlots.length > 0 && assignedCount === storyboardSlots.length },
                    { id: 'cover', label: '封面', done: Boolean(cover) },
                    { id: 'preview', label: '合成输出', done: workbenchHasFormalVideo },
                  ] as Array<{ id: StepId; label: string; done: boolean }>).map(task => {
                    const taskIndex = activeSteps.findIndex(item => item.id === task.id);
                    const active = step === task.id;
                    return (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => { if (taskIndex >= 0) setStepIdx(taskIndex); }}
                        className={`flex min-w-0 items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-[11px] font-bold transition ${active ? 'border-slate-400 bg-white text-text-primary shadow-sm' : 'border-transparent text-text-secondary hover:border-border hover:bg-white'}`}
                      >
                        <span className="truncate">{task.label}</span>
                        {task.done && <Check size={12} className="shrink-0 text-emerald-600" aria-label="已完成" />}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
            {step === 'script' && (
              <nav className="grid grid-cols-5 gap-1 rounded-xl bg-surface-2 p-1" aria-label="脚本与声音阶段">
                {([
                  { id: 'theme' as const, label: '分镜脚本' },
                  { id: 'voiceover' as const, label: '口播与翻译' },
                  { id: 'audio' as const, label: '口播语音' },
                  { id: 'subtitle' as const, label: '字幕文案' },
                  { id: 'bgm' as const, label: '配乐' },
                ]).map(item => {
                  const unavailable = item.id !== 'theme' && (!hasTimestampScript
                    || (item.id === 'audio' && !hasRequestedVoiceDrafts)
                    || (item.id === 'subtitle' && (!hasRequestedVoiceDrafts || !hasReadyVoiceStrategy))
                    || (item.id === 'bgm' && (!hasRequestedVoiceDrafts || !hasRequestedSubtitles)));
                  return (
                  <button key={item.id} type="button" disabled={unavailable} title={unavailable ? '请按顺序完成前面的步骤' : undefined} onClick={() => setScriptStageTab(item.id)} className={`min-w-0 whitespace-nowrap rounded-lg px-0.5 py-2 text-[9px] font-black transition disabled:cursor-not-allowed disabled:opacity-35 ${scriptStageTab === item.id ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
                    {item.label}
                  </button>
                  );
                })}
              </nav>
            )}
            {step === 'script' && scriptStageTab === 'theme' && (
              <section className="space-y-3">
                {activeWorkbenchSlot ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <div><p className="text-xs font-black text-text-primary">分镜 {storyboardSlots.findIndex(item => item.id === activeWorkbenchSlot.id) + 1}</p><p className="mt-0.5 text-[10px] text-text-muted">{activeSlotTime} · 修改后会同步更新完整脚本</p></div>
                      <button type="button" onClick={() => setShowFullScriptEditor(value => !value)} className="rounded-lg border border-border px-2.5 py-1.5 text-[10px] font-bold text-text-secondary hover:bg-surface-2">{showFullScriptEditor ? '收起整稿' : '编辑完整脚本'}</button>
                    </div>
                    <label className="block text-[10px] font-bold text-text-secondary">当前分镜内容
                      <textarea value={activeWorkbenchSlot.detail} rows={8} onChange={event => updateWorkbenchStoryboardSlot(activeWorkbenchSlot.id, event.target.value)} className="mt-1.5 w-full resize-y rounded-lg border border-border bg-surface-2 p-3 text-xs leading-6 text-text-secondary outline-none focus:border-accent" />
                    </label>
                    {showFullScriptEditor && <label className="block border-t border-border pt-3 text-[10px] font-bold text-text-secondary">完整时间轴脚本<textarea value={script} rows={12} onChange={event => applyTimestampScript(event.target.value)} className="mt-1.5 w-full resize-y rounded-lg border border-border bg-white p-3 font-mono text-[11px] leading-5 text-text-secondary outline-none focus:border-accent" /></label>}
                    <div className={`rounded-xl border p-3 ${storyboardFeasibility.status === 'ready' ? 'border-emerald-200 bg-emerald-50/60' : storyboardFeasibility.status === 'adjustable' ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-surface-2'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div><p className="text-[10px] font-black text-text-primary">制作可行性摘要</p><p className="mt-1 text-[10px] leading-4 text-text-secondary">脚本完成不代表画面已经齐全；这里按镜头功能检查，不按文件数量判断。</p></div>
                        <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black ${storyboardFeasibility.status === 'ready' ? 'bg-emerald-100 text-emerald-700' : storyboardFeasibility.status === 'adjustable' ? 'bg-amber-100 text-amber-700' : 'bg-white text-text-muted'}`}>{storyboardFeasibility.status === 'ready' ? '可直接制作' : storyboardFeasibility.status === 'adjustable' ? '建议确认' : '存在素材缺口'}</span>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-1.5">
                        <div className="rounded-lg bg-white px-2 py-2"><p className="text-[9px] text-text-muted">直接匹配</p><p className="mt-0.5 text-sm font-black text-emerald-700">{storyboardFeasibility.direct}</p></div>
                        <div className="rounded-lg bg-white px-2 py-2"><p className="text-[9px] text-text-muted">需确认</p><p className="mt-0.5 text-sm font-black text-amber-700">{storyboardFeasibility.review}</p></div>
                        <div className="rounded-lg bg-white px-2 py-2"><p className="text-[9px] text-text-muted">缺口</p><p className="mt-0.5 text-sm font-black text-red-600">{storyboardFeasibility.missing.length}</p></div>
                      </div>
                      {storyboardFeasibility.missing.length > 0 && <p className="mt-2 text-[10px] leading-4 text-text-secondary">缺少：{storyboardFeasibility.missing.slice(0, 3).map(item => item.slot.title || item.slot.time).join('、')}{storyboardFeasibility.missing.length > 3 ? ` 等 ${storyboardFeasibility.missing.length} 个镜头` : ''}。优先补真实素材；事实证明镜头不会用无关画面自动顶替。</p>}
                      <button type="button" onClick={() => { const materialIndex = activeSteps.findIndex(item => item.id === 'material'); if (materialIndex >= 0) setStepIdx(materialIndex); }} className="mt-3 w-full rounded-lg border border-border bg-white px-3 py-2 text-[10px] font-bold text-text-secondary hover:bg-surface-2">查看并处理素材方案</button>
                    </div>
                  </>
                ) : <div className="rounded-xl border border-dashed border-border bg-surface-2 px-4 py-8 text-center text-xs text-text-muted">尚未生成分镜，请返回创作设置选择素材并生成脚本。</div>}
              </section>
            )}
            {step === 'script' && scriptStageTab !== 'theme' && (
              <div className="space-y-3">
                {scriptStageTab === 'voiceover' && <section className="space-y-3 pt-1">
                  {languageSwitcher}
                  <div><p className="text-xs font-black text-text-primary">当前语言文案</p><p className="mt-0.5 text-[10px] text-text-muted">先选择需要的翻译语种，再用底部按钮一次生成全部文案。</p></div>
                  <textarea
                    value={voiceDrafts[activeVoiceLang] || ((activeVoiceLang === enterpriseScriptLanguage || (!enterpriseScriptLanguage && activeVoiceLang === detectScriptLanguageCode(script))) ? (voiceoverLines || extractVoiceoverText(script)) : '')}
                    onChange={event => {
                      const nextValue = event.target.value;
                      const sourceLanguage = enterpriseScriptLanguage || detectScriptLanguageCode(script);
                      setVoiceDrafts(current => ({ ...current, [activeVoiceLang]: nextValue }));
                      setVoiceDraftFailedLangs(current => current.filter(code => code !== activeVoiceLang));
                      setVoiceDraftDegradedLangs(current => current.filter(code => code !== activeVoiceLang));
                      setVoiceDraftStaleLangs(current => activeVoiceLang === sourceLanguage
                        ? [...new Set([...current.filter(code => code !== activeVoiceLang), ...voiceLangs.filter(code => code !== activeVoiceLang)])]
                        : current.filter(code => code !== activeVoiceLang));
                      setVoiceoverStaleLangs(current => [...new Set([...current, activeVoiceLang])]);
                      setTtsFailuresByLang(current => { const next = { ...current }; delete next[activeVoiceLang]; return next; });
                      if (activeVoiceLang === sourceLanguage) setVoiceoverLines(nextValue);
                    }}
                    rows={5}
                    dir={activeVoiceLang === 'ar' ? 'rtl' : 'ltr'}
                    placeholder="输入该语言的口播文案"
                    className="w-full resize-y rounded-lg border border-border bg-surface-2 p-3 text-xs leading-6 text-text-secondary outline-none focus:border-accent"
                  />
                  {voiceDraftFailedLangs.includes(activeVoiceLang) && <div className="flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[10px] leading-4 text-red-700"><span>{voiceDrafts[activeVoiceLang]?.trim() ? '本次重试失败，已保留现有文案。' : '该语种仍缺失；可手工填写，不会清空其他语种。'}</span><button type="button" onClick={() => void retryVoiceDraft(activeVoiceLang)} className="shrink-0 rounded-md border border-red-200 bg-white px-2 py-1 font-bold">仅重试此语种</button></div>}
                  {voiceDraftStaleLangs.includes(activeVoiceLang) && (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] leading-4 text-amber-700">
                      <span>主脚本已更新，此语种待同步。也可手工改写后继续。</span>
                      <button
                        type="button"
                        onClick={() => void retryVoiceDraft(activeVoiceLang)}
                        disabled={voiceDraftPendingLangs.includes(activeVoiceLang)}
                        className="shrink-0 rounded-md border border-amber-200 bg-white px-2 py-1 font-bold disabled:cursor-wait disabled:opacity-60"
                      >
                        {voiceDraftPendingLangs.includes(activeVoiceLang) ? '同步中…' : '仅重试当前语种'}
                      </button>
                    </div>
                  )}
                  {voiceDraftDegradedLangs.includes(activeVoiceLang) && !voiceDraftStaleLangs.includes(activeVoiceLang) && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] leading-4 text-amber-700">该文案来自经审核的房地产保时轴本地兜底；可继续编辑，完整文案不会阻断进入配音。</p>}
                  {voiceDraftNotice && <div className={`rounded-lg border px-3 py-2 text-[10px] leading-4 ${voiceDraftFailedLangs.length ? 'border-red-200 bg-red-50 text-red-700' : 'border-border bg-surface-2 text-text-muted'}`}><p>{voiceDraftNotice}</p></div>}
                </section>}

                {scriptStageTab === 'audio' && <section className="space-y-3 pt-1">
                  {languageSwitcher}
                  <input ref={voiceoverInputRef} type="file" accept="audio/*" className="hidden" onChange={event => { void handleVoiceoverUpload(event.target.files); event.target.value = ''; }} />
                  <div><p className="text-xs font-black text-text-primary">声音策略</p><p className="mt-0.5 text-[10px] text-text-muted">先选策略，再用底部按钮一次生成所选语言口播。</p></div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {([
                      { id: 'ai' as const, label: 'AI 配音', icon: <Mic size={13} /> },
                      { id: 'upload' as const, label: '上传口播', icon: <Upload size={13} /> },
                      { id: 'none' as const, label: '无口播', icon: <X size={13} /> },
                    ]).map(option => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          if (option.id === 'none') clearVoiceover();
                          else if (option.id === 'ai') setVoiceoverMode('ai');
                          else voiceoverInputRef.current?.click();
                        }}
                        className={`flex min-w-0 flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[10px] font-bold transition ${voiceoverMode === option.id ? 'border-slate-400 bg-surface-2 text-text-primary' : 'border-border bg-white text-text-muted hover:bg-surface-2'}`}
                      >
                        {option.icon}<span className="truncate">{option.label}</span>
                      </button>
                    ))}
                  </div>
                  {(uploadedVoiceName || ttsNotice) && (
                    <div className={`rounded-lg border px-3 py-2 text-[10px] leading-4 ${ttsFailuresByLang[activeVoiceLang] || /欠费|额度|余额|鉴权|失败|不可用/.test(ttsNotice) ? 'border-red-200 bg-red-50 text-red-700' : 'border-border bg-surface-2 text-text-muted'}`}>
                      <p>{uploadedVoiceName ? `已上传：${uploadedVoiceName}。` : ''}{ttsNotice ? publicVoiceFailureReason(ttsNotice) : ''}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {voiceoverMode === 'ai' && ttsFailuresByLang[activeVoiceLang] && (
                          <button type="button" onClick={() => void genTts(activeVoiceLang)} disabled={ttsLoading || !voiceDrafts[activeVoiceLang]?.trim()} className="rounded-md border border-red-200 bg-white px-2 py-1 font-bold disabled:cursor-wait disabled:opacity-60">
                            {singleTtsLoading ? '正在重试当前语言…' : '只重试当前语言'}
                          </button>
                        )}
                        {/欠费|额度|余额|鉴权|失败|不可用/.test(ttsNotice) && <button type="button" onClick={() => voiceoverInputRef.current?.click()} className="rounded-md border border-red-200 bg-white px-2 py-1 font-bold">改用上传口播</button>}
                      </div>
                    </div>
                  )}
                  {voiceoverMode === 'ai' && <div className="border-t border-border pt-3">
                    <button type="button" onClick={() => setShowVoiceAdvanced(value => !value)} className="flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-left text-[10px] font-black text-text-secondary"><span>高级设置 · 当前语言</span><ChevronDown size={13} className={`transition ${showVoiceAdvanced ? 'rotate-180' : ''}`} /></button>
                    {showVoiceAdvanced && <div className="mt-2 space-y-3 rounded-xl border border-border bg-surface-2 p-3">
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-[10px] font-bold text-text-secondary">音色<select value={activeTtsSettings.voiceId || voice} onChange={event => { patchActiveTtsSettings({ voiceId: event.target.value }); setVoiceCandidates(current => current.includes(event.target.value) ? current : [...current, event.target.value]); if (voiceoverAudios[activeVoiceLang]?.url) setVoiceoverStaleLangs(current => [...new Set([...current, activeVoiceLang])]); }} className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-2 text-[10px]">{VOICES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                        <label className="text-[10px] font-bold text-text-secondary">风格<select value={ttsPreset} onChange={event => { setTtsPreset(event.target.value as TtsStyleOptions['preset']); if (voiceoverAudios[activeVoiceLang]?.url) setVoiceoverStaleLangs(current => [...new Set([...current, activeVoiceLang])]); }} className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-2 text-[10px]">{TTS_PRESETS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                        <label className="col-span-2 text-[10px] font-bold text-text-secondary">情绪<select value={ttsEmotion} onChange={event => { setTtsEmotion(event.target.value); if (voiceoverAudios[activeVoiceLang]?.url) setVoiceoverStaleLangs(current => [...new Set([...current, activeVoiceLang])]); }} className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-2 text-[10px]">{[...new Set(TTS_PRESETS.map(item => item.emotion))].map(item => <option key={item} value={item}>{item}</option>)}</select></label>
                      </div>
                      <label className="block text-[10px] font-bold text-text-secondary">语速 · {ttsSpeed.toFixed(1)}x<input type="range" min="0.7" max="1.3" step="0.05" value={ttsSpeed} onChange={event => { setTtsSpeed(Number(event.target.value)); if (voiceoverAudios[activeVoiceLang]?.url) setVoiceoverStaleLangs(current => [...new Set([...current, activeVoiceLang])]); }} className="mt-2 w-full accent-emerald-600" /></label>
                      <label className="block text-[10px] font-bold text-text-secondary">试听音量 · {Math.round((activeTtsSettings.volume ?? voiceVol / 100) * 100)}%<input type="range" min="0" max="1" step="0.05" value={activeTtsSettings.volume ?? voiceVol / 100} onChange={event => patchActiveTtsSettings({ volume: Number(event.target.value) })} className="mt-2 w-full accent-emerald-600" /></label>
                      {voiceoverAudios[activeVoiceLang]?.url && <button type="button" onClick={() => playTtsForLang(activeVoiceLang)} className="rounded-lg border border-border bg-white px-3 py-2 text-[10px] font-bold text-text-secondary">{ttsPlaying ? '暂停试听' : '试听当前语言'}</button>}
                    </div>}
                  </div>}
                  {voiceoverMode === 'ai' && voiceLangs.length > 1 && (!voiceoverAudios[activeVoiceLang]?.url || voiceoverStaleLangs.includes(activeVoiceLang)) && (
                    <button
                      type="button"
                      onClick={() => void genTts(activeVoiceLang)}
                      disabled={ttsLoading || !voiceDrafts[activeVoiceLang]?.trim()}
                      className="w-full rounded-lg border border-accent bg-white px-3 py-2 text-[10px] font-black text-accent disabled:cursor-wait disabled:opacity-60"
                    >
                      {singleTtsLoading ? '正在生成当前语言…' : '只生成当前语言'}
                    </button>
                  )}
                </section>
                }
                {scriptStageTab === 'subtitle' && <section className="space-y-3 pt-1">
                  {languageSwitcher}
                  <div className="flex items-start justify-between gap-2"><div><p className="text-xs font-black text-text-primary">字幕文案</p><p className="mt-0.5 text-[10px] text-text-muted">按已生成的文案和真实口播时长生成字幕。</p></div>{hasRequestedSubtitles && <button type="button" onClick={() => void generateSubtitleDrafts()} disabled={subtitleGenerating} className="rounded-lg border border-border px-2.5 py-1.5 text-[10px] font-bold text-text-secondary">重新生成</button>}</div>
                  {subtitleNotice && <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[10px] leading-4 text-text-muted">{subtitleNotice}</p>}
                  <div className="rounded-xl border border-border bg-surface-2 px-3 py-3"><p className="text-[10px] font-bold text-text-secondary">{activeLanguageLabel}</p><p className="mt-1 text-xs font-black text-text-primary">{alignedCuesByLang[activeVoiceLang]?.length || 0} 条字幕</p></div>
                  <div>
                    <div className="mb-2 flex items-center justify-between"><p className="text-[10px] font-black text-text-primary">逐条调整</p><span className="text-[9px] text-text-muted">修改后自动保存到当前草稿</span></div>
                    <div className="max-h-80 space-y-2 overflow-y-auto pr-1">{(alignedCuesByLang[activeVoiceLang] || []).length ? (alignedCuesByLang[activeVoiceLang] || []).map((cue, index) => <div key={`${cue.start}-${index}`} className="rounded-lg border border-border bg-white p-2"><p className="text-[9px] font-bold text-text-muted">{cue.start.toFixed(1)}s – {cue.end.toFixed(1)}s</p><textarea value={cue.text} rows={2} onChange={event => setAlignedCuesByLang(current => ({ ...current, [activeVoiceLang]: (current[activeVoiceLang] || []).map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item) }))} className="mt-1 w-full resize-y rounded-md border border-border px-2 py-1.5 text-[10px] leading-4 text-text-secondary outline-none focus:border-accent" /></div>) : <p className="rounded-lg border border-dashed border-border bg-surface-2 px-3 py-6 text-center text-[10px] text-text-muted">请先一键生成字幕文案。</p>}</div>
                  </div>
                  <div className="border-t border-border pt-3">
                    <button type="button" onClick={() => setShowSubtitleAdvanced(value => !value)} className="flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-left text-[10px] font-black text-text-secondary"><span>高级设置 · 字幕样式</span><ChevronDown size={13} className={`transition ${showSubtitleAdvanced ? 'rotate-180' : ''}`} /></button>
                    {showSubtitleAdvanced && <div className="mt-2 space-y-3 rounded-xl border border-border bg-surface-2 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2"><label className="inline-flex items-center gap-2 text-[10px] font-bold text-text-secondary"><input type="checkbox" checked={subtitlesOn} onChange={event => setSubtitlesOn(event.target.checked)} className="accent-emerald-600" />烧录字幕</label><select value={subMode} onChange={event => setSubMode(event.target.value as 'target' | 'bilingual')} className="h-8 rounded-lg border border-border bg-white px-2 text-[10px] font-bold text-text-secondary"><option value="target">单语字幕</option><option value="bilingual">双语字幕</option></select></div>
                      <div className="grid grid-cols-2 gap-2"><label className="text-[10px] font-bold text-text-secondary">字体<select value={coverStyle.font} onChange={event => setCoverStyle(current => ({ ...current, font: event.target.value as CoverStyle['font'] }))} className="mt-1 h-8 w-full rounded-lg border border-border bg-white px-2 text-[10px]">{COVER_FONTS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label className="text-[10px] font-bold text-text-secondary">字号<select value={coverStyle.size} onChange={event => setCoverStyle(current => ({ ...current, size: event.target.value as CoverStyle['size'] }))} className="mt-1 h-8 w-full rounded-lg border border-border bg-white px-2 text-[10px]"><option value="S">小</option><option value="M">中</option><option value="L">大</option></select></label></div>
                    </div>}
                  </div>
                </section>}
              </div>
            )}
            {step === 'material' && activeWorkbenchSlot && (
              <section className="space-y-3">
                <input ref={fileInputRef} type="file" multiple accept="video/*,image/*" className="hidden" onChange={event => { void handleUpload(event.target.files); event.target.value = ''; }} />
                <div className="rounded-xl border border-border bg-surface-2 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-black text-text-primary">分镜 {storyboardSlots.findIndex(item => item.id === activeWorkbenchSlot.id) + 1}</p>
                      <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-text-secondary">{storyboardSlotScript(activeWorkbenchSlot.detail).visual || activeWorkbenchSlot.title}</p>
                    </div>
                    <span className={`flex-shrink-0 rounded-full px-2 py-1 text-[9px] font-black ${activeWorkbenchClip ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{activeWorkbenchClip ? '已匹配' : '待匹配'}</span>
                  </div>
                  {activeWorkbenchClip && (
                    <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-white p-2">
                      <div className="h-12 w-16 flex-shrink-0 overflow-hidden rounded-md bg-slate-950">{activeWorkbenchClip.url ? <RealThumb clip={activeWorkbenchClip} onSourceError={() => { void refreshMaterialSource(activeWorkbenchClip.id); }} /> : <Thumb seed={activeWorkbenchClip.id} src={activeWorkbenchClip.poster} label={fmtDur(activeWorkbenchClip.duration)} />}</div>
                      <div className="min-w-0 flex-1"><p className="truncate text-[10px] font-black text-text-primary">{activeWorkbenchClip.name}</p><p className="mt-1 text-[9px] text-text-muted">从 0 秒开始 · 自动截取 {Math.max(0.5, activeWorkbenchSlot.end - activeWorkbenchSlot.start).toFixed(1)} 秒</p></div>
                      <span className="text-[10px] font-black text-emerald-700">{activeMaterialAssessment?.score || activeMaterialPlan?.matchScore || 0}分</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => void smartSelectMaterialsFast()} disabled={materialSelectLoading} title={!activeMaterialCandidates.length ? '素材库为空时仍可点击，系统会告知需要补充的素材' : '按分镜语义自动匹配'} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-[10px] font-black text-text-secondary disabled:opacity-50">{materialSelectLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}自动匹配空分镜</button>
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-[10px] font-black text-text-secondary"><Upload size={12} />添加素材</button>
                </div>
                {!activeMaterialCandidates.length && <p className="-mt-1 rounded-lg bg-amber-50 px-2.5 py-2 text-[9px] leading-4 text-amber-700">当前素材库没有可匹配的视频或图片。你仍可点击自动匹配查看缺口，或直接添加素材。</p>}
                <div className="rounded-xl border border-border bg-white p-3">
                  <div className="mb-3">
                    <p className="text-[10px] font-black text-text-primary">当前分镜画面来源</p>
                    <p className="mt-0.5 text-[9px] text-text-muted">每个分镜单独决定，不影响其他分镜。</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {([
                        { id: 'material' as const, label: '素材画面', description: '实拍、产品或其他素材' },
                        { id: 'digital' as const, label: '数字人口播', description: '用人物驱动当前分镜' },
                      ]).map(option => {
                        const selectedMode = activeShotMediaMode === option.id;
                        return <button key={option.id} type="button" onClick={() => {
                          if (option.id === 'digital') void activateDigitalHumanForShot(activeWorkbenchSlot);
                          else setShotMediaModes(current => ({ ...current, [activeWorkbenchSlot.id]: 'material' }));
                        }} className={`rounded-lg border px-2.5 py-2 text-left transition ${selectedMode ? 'border-accent bg-accent-glow' : 'border-border bg-surface-2 hover:border-accent/40'}`}>
                          <span className="block text-[10px] font-black text-text-primary">{option.label}</span>
                          <span className="mt-0.5 block text-[8px] leading-3 text-text-muted">{option.description}</span>
                        </button>;
                      })}
                    </div>
                  </div>
                  {activeShotMediaMode === 'digital' && <>
                  <div className="mb-3 rounded-xl border border-border bg-surface-2 p-2.5">
                    <p className="text-[9px] font-black text-text-primary">全片声音</p>
                    <p className="mt-0.5 text-[8px] text-text-muted">整条成片只使用一个主声音源。</p>
                    <div className="mt-2 grid grid-cols-3 gap-1">
                      {([
                        { id: 'smart' as const, label: '智能选择' },
                        { id: 'brand' as const, label: '固定品牌声音' },
                        { id: 'person' as const, label: '跟随人物声音' },
                      ]).map(option => <button key={option.id} type="button" onClick={() => setDigitalHumanVoiceStrategy(option.id)} className={`rounded-md border px-1.5 py-2 text-[8px] font-black ${digitalHumanVoiceStrategy === option.id ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-border bg-white text-text-muted'}`}>{option.label}</button>)}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div><p className="text-[10px] font-black text-text-primary">人物口播 · 数字人</p><p className="mt-0.5 text-[9px] text-text-muted">已自动选用默认人物、当前分镜口播与配音；质检通过后自动回填。</p></div>
                    {activeShotDigitalHuman && <span className={`rounded-full px-2 py-1 text-[9px] font-black ${activeShotDigitalHuman.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : ['failed', 'review', 'stale'].includes(activeShotDigitalHuman.status) ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>{activeShotDigitalHuman.status === 'completed' ? '已完成' : activeShotDigitalHuman.status === 'review' ? '待复核' : activeShotDigitalHuman.status === 'stale' ? '需重生成' : activeShotDigitalHuman.status === 'failed' ? '生成失败' : '后台生成中'}</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Array.from(new Set([...voiceLangs, activeVoiceLang])).filter(code => Boolean(voiceDrafts[code]?.trim() || code === activeVoiceLang)).map(code => {
                      const binding = shotDigitalHumanBindings[digitalHumanLanguageKey(activeWorkbenchSlot.id, code)];
                      const ready = binding?.status === 'completed';
                      const failed = binding && ['failed', 'review', 'stale'].includes(binding.status);
                      return <button key={code} type="button" onClick={() => { setActiveVoiceLang(code); setLang(code); }} title="查看此语言的分镜状态" className={`rounded-full px-2 py-1 text-[8px] font-black ${activeVoiceLang === code ? 'ring-1 ring-current' : ''} ${ready ? 'bg-emerald-50 text-emerald-700' : failed ? 'bg-red-50 text-red-700' : binding ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{langZh(code) || code} · {ready ? '已就绪' : failed ? '需处理' : binding ? '生成中' : '等待配音'}</button>;
                    })}
                  </div>
                  {activeDigitalHumanAvatar ? (
                    <>
                      <div className="mt-2 flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 p-2">
                        <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-md bg-slate-950">{activeDigitalHumanAvatar.url ? <RealThumb clip={activeDigitalHumanAvatar} onSourceError={() => { void refreshMaterialSource(activeDigitalHumanAvatar.id); }} /> : <Thumb seed={activeDigitalHumanAvatar.id} src={activeDigitalHumanAvatar.poster} label="人物" />}</div>
                        <div className="min-w-0 flex-1"><p className="truncate text-[9px] font-black text-text-primary">当前人物：{activeDigitalHumanAvatar.name}</p><p className="mt-0.5 text-[8px] text-text-muted">{activeShotDigitalHuman && isShotDigitalHumanActive(activeShotDigitalHuman.status) ? '后台生成中…' : '已用于当前分镜'}</p></div>
                        <button type="button" onClick={() => setAvatarPickerSlotId(current => current === activeWorkbenchSlot.id ? '' : activeWorkbenchSlot.id)} className="shrink-0 rounded-md border border-blue-200 bg-white px-2 py-1 text-[8px] font-black text-blue-700">更换人物 IP</button>
                      </div>
                      {avatarPickerSlotId === activeWorkbenchSlot.id && (
                        <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface-2 p-2">
                          {digitalHumanAvatars.map(avatar => {
                            const selectedAvatar = avatar.id === activeDigitalHumanAvatar.id;
                            return <button key={avatar.id} type="button" onClick={() => {
                              setAvatarPickerSlotId('');
                              setShotPreferredAvatarIds(current => ({ ...current, [activeWorkbenchSlot.id]: avatar.id }));
                              const activeJobs = Object.entries(shotDigitalHumanBindings)
                                .filter(([key, binding]) => parseDigitalHumanLanguageKey(key).slotId === activeWorkbenchSlot.id && binding.jobId && isShotDigitalHumanActive(binding.status))
                                .map(([, binding]) => binding.jobId);
                              const readyLanguages = renderScriptLanguages();
                              void Promise.allSettled(activeJobs.map(jobId => studioApi.cancelDigitalHumanJob(jobId))).finally(() => {
                                setShotDigitalHumanBindings(current => Object.fromEntries(Object.entries(current).filter(([key]) => parseDigitalHumanLanguageKey(key).slotId !== activeWorkbenchSlot.id)));
                                setStoryboardAssignments(current => Object.fromEntries(Object.entries(current).filter(([key]) => parseDigitalHumanLanguageKey(key).slotId !== activeWorkbenchSlot.id)));
                                digitalHumanQueueSubmissionRef.current = '';
                                setDigitalHumanNotice('已切换人物 IP，正在原子重建当前分镜的全部语言任务。');
                                void generateDigitalHumanBatchForShot(activeWorkbenchSlot, avatar.id, readyLanguages);
                              });
                            }} className={`flex min-w-0 items-center gap-2 rounded-lg border p-2 text-left ${selectedAvatar ? 'border-blue-300 bg-blue-50' : 'border-border bg-white hover:border-blue-200'}`}>
                              <div className="h-8 w-8 shrink-0 overflow-hidden rounded-md bg-slate-950">{avatar.url ? <RealThumb clip={avatar} onSourceError={() => { void refreshMaterialSource(avatar.id); }} /> : <Thumb seed={avatar.id} src={avatar.poster} label="IP" />}</div>
                              <div className="min-w-0"><p className="truncate text-[9px] font-black text-text-primary">{avatar.name}</p><p className="text-[8px] text-text-muted">{selectedAvatar ? '当前 IP' : '点击替换'}</p></div>
                            </button>;
                          })}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="mt-2 rounded-lg border border-dashed border-border p-3 text-[9px] text-text-muted"><p>所选企业人物尚未就绪或已不可用，已保留选择。可到企业知识库完成授权和准备，或主动更换平台人物。</p>{digitalHumanAvatars.filter(a => a.sourceType === 'platform-person').map(a => <button key={a.id} className="mt-2 mr-2 text-blue-700" onClick={() => { setShotPreferredAvatarIds(current => ({...current, [activeWorkbenchSlot.id]: a.id})); void generateDigitalHumanBatchForShot(activeWorkbenchSlot, a.id, renderScriptLanguages()); }}>使用{a.name}</button>)}</div>
                  )}
                  {digitalHumanCapabilities?.available === false && <p className="mt-2 rounded-lg bg-amber-50 px-2 py-2 text-[9px] text-amber-700">已选择数字人，但当前不能开始生成：{digitalHumanCapabilities.unavailableReason || '数字人服务暂不可用'}</p>}
                  {activeShotDigitalHuman?.error && <p className="mt-2 text-[9px] leading-4 text-red-600">{activeShotDigitalHuman.error}</p>}
                  {activeShotDigitalHuman?.status === 'completed' && <div className="mt-2 flex gap-1.5"><button type="button" onClick={() => activeDigitalHumanAvatar && void generateDigitalHumanForShot(activeWorkbenchSlot, activeDigitalHumanAvatar.id, activeVoiceLang, 'natural')} className="rounded-md border border-border bg-white px-2 py-1 text-[8px] font-black text-text-secondary">更自然</button><button type="button" onClick={() => activeDigitalHumanAvatar && void generateDigitalHumanForShot(activeWorkbenchSlot, activeDigitalHumanAvatar.id, activeVoiceLang, 'expressive')} className="rounded-md border border-border bg-white px-2 py-1 text-[8px] font-black text-text-secondary">更有感染力</button><button type="button" onClick={() => activeDigitalHumanAvatar && void generateDigitalHumanForShot(activeWorkbenchSlot, activeDigitalHumanAvatar.id, activeVoiceLang, 'alternate')} className="rounded-md border border-border bg-white px-2 py-1 text-[8px] font-black text-text-secondary">换一个动作</button></div>}
                  {activeShotDigitalHuman && ['failed', 'review', 'stale', 'cancelled'].includes(activeShotDigitalHuman.status) && activeDigitalHumanAvatar && <button type="button" onClick={() => void generateDigitalHumanForShot(activeWorkbenchSlot, activeDigitalHumanAvatar.id, activeVoiceLang, 'alternate')} className="mt-2 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-[8px] font-black text-red-600">重新生成当前语言</button>}
                  {!activeVoiceoverUrl && <p className="mt-2 text-[9px] text-amber-700">完成口播音频后即可生成。</p>}
                  </>}
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between"><p className="text-[10px] font-black text-text-primary">推荐素材</p><span className="text-[9px] text-text-muted">按分镜语义排序</span></div>
                  <div className="space-y-2">
                    {activeShotMediaMode === 'material' && activeMaterialCandidates.map(({ clip, assessment }) => {
                      const active = activeWorkbenchClip?.id === clip.id;
                      return <button key={clip.id} type="button" onClick={() => assignWorkbenchMaterial(clip)} className={`flex w-full items-center gap-2 rounded-lg border p-2 text-left transition ${active ? 'border-emerald-300 bg-emerald-50' : 'border-border bg-white hover:border-emerald-200'}`}>
                        <div className="h-11 w-14 flex-shrink-0 overflow-hidden rounded-md bg-slate-950">{clip.url ? <RealThumb clip={clip} onSourceError={() => { void refreshMaterialSource(clip.id); }} /> : <Thumb seed={clip.id} src={clip.poster} label={clip.type === 'image' ? 'IMG' : fmtDur(clip.duration)} />}</div>
                        <div className="min-w-0 flex-1"><p className="truncate text-[10px] font-black text-text-primary">{clip.name}</p><p className="mt-1 truncate text-[9px] text-text-muted">{assessment.reason}</p></div>
                        <span className={`text-[10px] font-black ${assessment.level === 'direct' ? 'text-emerald-700' : assessment.level === 'review' ? 'text-amber-700' : 'text-text-muted'}`}>{assessment.score}</span>
                      </button>;
                    })}
                    {activeShotMediaMode === 'material' && !activeMaterialCandidates.length && <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[10px] text-text-muted">暂无可用素材，可先上传视频或图片。</div>}
                    {activeShotMediaMode === 'digital' && <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-3 text-[9px] leading-4 text-blue-700">当前分镜已选择数字人，不再推荐普通素材。</div>}
                  </div>
                </div>
              </section>
            )}
            {workbenchProductionPanel}
            {step !== 'script' && step !== 'material' && step !== 'bgm' && step !== 'cover' && step !== 'preview' && (
              <AnimatePresence mode="wait">
                <motion.div key={`${step}-${scriptStageTab}`} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.16 }}>
                  {renderStep()}
                </motion.div>
              </AnimatePresence>
            )}
          </div>
        )}
        timelineTitle="整片时间轴"
        timelineDescription={storyboardSlots.length ? `${storyboardSlots.length} 个分镜 · 可拖动定位画面` : undefined}
        timelineToolbar={storyboardSlots.length ? <div className="flex items-center gap-2"><span className="text-[10px] font-black tabular-nums text-text-secondary">{workbenchTimelineTime.toFixed(1)}s / {workbenchTimelineDuration.toFixed(1)}s</span>{step === 'cover' && <button type="button" onClick={captureWorkbenchCoverFrame} className="rounded-md border border-border bg-white px-2 py-1 text-[9px] font-bold text-text-secondary">截取为封面</button>}</div> : undefined}
        timelinePanel={storyboardSlots.length ? (
          <div className="relative h-full min-w-[560px]">
            <div
              role="slider"
              tabIndex={0}
              aria-label="整片时间轴"
              aria-valuemin={0}
              aria-valuemax={workbenchTimelineDuration}
              aria-valuenow={Math.min(workbenchTimelineTime, workbenchTimelineDuration)}
              onPointerDown={event => {
                workbenchTimelineScrubbingRef.current = true;
                event.currentTarget.setPointerCapture(event.pointerId);
                const nextTime = timeFromWorkbenchTimelinePointer(event);
                setWorkbenchTimelineHoverTime(nextTime);
                seekWorkbenchTimeline(nextTime);
              }}
              onPointerMove={event => {
                const nextTime = timeFromWorkbenchTimelinePointer(event);
                setWorkbenchTimelineHoverTime(nextTime);
                if (event.currentTarget.hasPointerCapture(event.pointerId)) seekWorkbenchTimeline(nextTime);
              }}
              onPointerUp={event => {
                const nextTime = timeFromWorkbenchTimelinePointer(event);
                seekWorkbenchTimeline(nextTime);
                workbenchTimelineScrubbingRef.current = false;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => { workbenchTimelineScrubbingRef.current = false; }}
              onLostPointerCapture={() => { workbenchTimelineScrubbingRef.current = false; }}
              onPointerLeave={() => setWorkbenchTimelineHoverTime(null)}
              onKeyDown={event => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                seekWorkbenchTimeline(workbenchTimelineTime + (event.key === 'ArrowRight' ? 0.1 : -0.1));
              }}
              className="relative flex h-8 cursor-col-resize touch-none select-none overflow-hidden rounded-md border border-border bg-surface-2 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              {storyboardSlots.map((slot, index) => {
                const clip = materialById.get(storyboardAssignmentIdForMode(slot.id, activeVoiceLang, storyboardAssignments, shotMediaModes) || '');
                const width = Math.max(4, ((slot.end - slot.start) / workbenchTimelineDuration) * 100);
                return <div key={slot.id} style={{ width: `${width}%` }} className={`relative min-w-[42px] overflow-hidden border-r border-white/70 text-left last:border-r-0 ${activeWorkbenchSlot?.id === slot.id ? 'ring-1 ring-inset ring-emerald-500' : ''}`}>
                  {clip?.poster || clip?.type === 'image' ? <img src={clip.poster || clip.url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-55" /> : <span className="absolute inset-0 bg-slate-700" />}
                  <span className="relative z-10 flex h-full items-end bg-gradient-to-t from-slate-950/80 to-transparent px-1 pb-0.5 text-[8px] font-black text-white">{index + 1}</span>
                </div>;
              })}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 bg-emerald-500 shadow-[0_0_0_1px_rgba(255,255,255,0.85)]"
                style={{ left: `${Math.min(100, Math.max(0, (workbenchTimelineTime / workbenchTimelineDuration) * 100))}%` }}
              />
              {workbenchTimelineHoverTime !== null && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute top-0.5 z-30 -translate-x-1/2 rounded bg-slate-950/90 px-1.5 py-0.5 text-[8px] font-black tabular-nums text-white shadow-sm"
                  style={{ left: `${Math.min(98, Math.max(2, (workbenchTimelineHoverTime / workbenchTimelineDuration) * 100))}%` }}
                >
                  {workbenchTimelineHoverTime.toFixed(1)}s
                </span>
              )}
            </div>
          </div>
        ) : undefined}
        previousAction={{ label: '上一步', onClick: prev, disabled: stepIdx === 0 }}
        previewAction={{
          label: '预览',
          onClick: () => {
            const previewIndex = activeSteps.findIndex(item => item.id === (contentMode === 'poster' ? 'poster' : 'preview'));
            if (previewIndex >= 0) setStepIdx(previewIndex);
          },
          disabled: contentMode === 'video'
            ? !storyboardSlots.length || !(voiceoverMode === 'none' || (voiceoverMode === 'upload' && Boolean(voiceoverUrl)) || (voiceoverMode === 'ai' && hasAnyVoiceover))
            : !posterJsonText,
        }}
        primaryAction={{
          label: primaryActionLabel,
          onClick: runPrimaryAction,
          disabled: primaryActionDisabled,
          loading: primaryActionLoading,
          loadingLabel: modeActionStatus || (rendering ? `正在生成 ${renderPct}%` : undefined),
          blockReason: primaryActionBlockedReason,
          icon: step === 'preview' && workbenchHasFormalVideo ? <Send size={15} /> : <ChevronRight size={15} />,
        }}
      >
        <div className={`relative flex h-full min-h-[360px] w-full items-center justify-center overflow-hidden ${canvasView === 'reference' && mode === 'clone' && videoKickoff ? 'bg-black' : 'rounded-lg border border-slate-300/70 bg-[#e7e9ec] p-3 shadow-inner'}`}>
          {canvasView === 'reference' && mode === 'clone' && videoKickoff ? (
            <BenchmarkVideoPreview kickoff={videoKickoff} embedded />
          ) : step === 'cover' && !coverTimelineCaptureMode ? (
            <div className={`relative max-h-full overflow-hidden bg-black shadow-xl ${ratio === '16:9' ? 'aspect-video' : ratio === '1:1' ? 'aspect-square' : ratio === '4:5' ? 'aspect-[4/5]' : 'aspect-[9/16]'}`}>
              <CoverFace
                coverUrl={coverUrl}
                frameUrl={coverFrameUrl}
                frameType={capturedCoverFrameUrl || coverClip?.poster ? 'image' : coverClip?.type}
                fallbackVideoUrl={coverClip?.type === 'video' ? coverClip.url : undefined}
                title={coverTitle}
                style={coverStyle}
                editable
                onTitleChange={setCoverTitle}
                onStyleChange={setCoverStyle}
              />
            </div>
          ) : step === 'preview' && workbenchFormalPreviewUrl ? (
            <div className="flex h-full w-full items-center justify-center bg-black">
              <video
                key={workbenchFormalPreviewUrl}
                src={workbenchFormalPreviewUrl}
                controls
                playsInline
                preload="metadata"
                className="h-full w-full object-contain"
              />
            </div>
          ) : activeWorkbenchClip?.type === 'video' && activeWorkbenchClip.url ? (
            <div className="flex h-full w-full items-center justify-center rounded-lg bg-slate-950 shadow-xl">
              <video
                ref={workbenchVideoRef}
                key={`${activeWorkbenchClip.id}:${activeWorkbenchSlot?.id || 'preview'}`}
                src={activeWorkbenchClip.url}
                poster={activeWorkbenchClip.poster}
                controls
                playsInline
                preload="metadata"
                onLoadedMetadata={event => {
                  const video = event.currentTarget;
                  const maxTime = Number.isFinite(video.duration) && video.duration > 0 ? Math.max(0, video.duration - 0.05) : workbenchSeekTime;
                  try { video.currentTime = Math.min(Math.max(0, workbenchSeekTime), maxTime); } catch { /* ignore media seek edge cases */ }
                }}
                onTimeUpdate={event => {
                  if (!activeWorkbenchSlot || workbenchTimelineScrubbingRef.current) return;
                  const edit = editForSlot(activeWorkbenchClip, activeWorkbenchSlot);
                  const elapsed = Math.max(0, (event.currentTarget.currentTime - edit.trimStart) / Math.max(0.1, edit.speed || 1));
                  setWorkbenchTimelineTime(Math.min(activeWorkbenchSlot.end, activeWorkbenchSlot.start + elapsed));
                }}
                className="max-h-full max-w-full object-contain"
              />
            </div>
          ) : activeWorkbenchClip && (activeWorkbenchClip.poster || activeWorkbenchClip.url) ? (
            <div className="flex h-full w-full items-center justify-center rounded-lg bg-slate-950 shadow-xl"><img src={activeWorkbenchClip.poster || activeWorkbenchClip.url} alt={activeWorkbenchClip.name} className="max-h-full max-w-full object-contain" /></div>
          ) : mode === 'product' && selectedProductOptions[0]?.imageUrls?.[0] ? (
            <div className="flex h-full w-full items-center justify-center rounded-lg bg-white p-5 shadow-xl"><img src={selectedProductOptions[0].imageUrls[0]} alt={selectedProductOptions[0].label} className="max-h-full max-w-full object-contain" /></div>
          ) : activeWorkbenchSlot ? (
            <div className="flex max-w-sm flex-col items-center text-center text-text-muted">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-white/70"><Film size={20} /></div>
              <p className="mt-3 text-sm font-black text-text-primary">分镜 {storyboardSlots.findIndex(item => item.id === activeWorkbenchSlot.id) + 1} 暂无画面</p>
              <p className="mt-1 max-w-xs truncate text-[11px]">{activeWorkbenchSlot.title}</p>
              <button
                type="button"
                onClick={() => { const materialIndex = activeSteps.findIndex(item => item.id === 'material'); if (materialIndex >= 0) setStepIdx(materialIndex); }}
                className="mt-4 rounded-md bg-slate-900 px-3 py-2 text-[11px] font-bold text-white hover:bg-slate-800"
              >
                匹配素材
              </button>
            </div>
          ) : (
            <div className="flex max-w-sm flex-col items-center text-center text-text-muted">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm"><Film size={20} /></div>
              <p className="mt-3 text-sm font-black text-text-primary">暂无预览</p>
              <div className="mt-4 flex justify-center gap-2">
                <button type="button" onClick={() => { const materialIndex = activeSteps.findIndex(item => item.id === 'material'); if (materialIndex >= 0) setStepIdx(materialIndex); }} className="rounded-md border border-border bg-white px-3 py-2 text-[11px] font-bold text-text-secondary hover:bg-surface-2">选择素材</button>
                <button type="button" onClick={() => fileInputRef.current?.click()} className="rounded-md bg-slate-900 px-3 py-2 text-[11px] font-bold text-white hover:bg-slate-800">上传素材</button>
              </div>
            </div>
          )}
        </div>
      </StudioWorkbenchFrame>

      {/* ── 我的作品 / 草稿 列表浮层 ─────────────────────── */}
      <AnimatePresence>
        {existingSourceDraftPrompt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4"
          >
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="existing-source-draft-title"
              className="grid w-full max-w-[720px] grid-cols-1 overflow-hidden rounded-lg border border-border bg-white shadow-2xl sm:grid-cols-[minmax(0,1fr)_220px]"
            >
              <div className="flex min-w-0 flex-col justify-center p-6">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-accent-glow text-accent">
                  <FolderOpen size={20} />
                </div>
                <h2 id="existing-source-draft-title" className="text-base font-black text-text-primary">
                  基于本素材已经生成过草稿了，是否要新建作品集？
                </h2>
                <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-text-muted">{existingSourceDraftPrompt.title}</p>
                <p className="mt-2 text-[11px] text-text-muted">
                  {existingSourceDraftPrompt.matchCount > 1
                    ? `检测到 ${existingSourceDraftPrompt.matchCount} 条历史草稿，将优先继续最近更新的一条。`
                    : '可以继续最近的草稿，也可以从当前素材重新创建。'}
                </p>
                <div className="mt-6 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const project = existingSourceDraftPrompt.project;
                      setExistingSourceDraftPrompt(null);
                      setSourceDraftCheckPending(false);
                      loadProject(project);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-xs font-black text-white hover:bg-accent/90"
                  >
                    <FolderOpen size={14} />继续编辑已有草稿
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProjectId(null);
                      try { sessionStorage.removeItem(STUDIO_ACTIVE_PROJECT_KEY); } catch { /* ignore */ }
                      setExistingSourceDraftPrompt(null);
                      setSourceDraftCheckPending(false);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-4 py-2.5 text-xs font-black text-text-secondary hover:border-accent/40 hover:bg-surface-2"
                  >
                    <Plus size={14} />新建作品集
                  </button>
                </div>
              </div>
              <div className="min-h-[180px] border-t border-border bg-surface-2 sm:min-h-[300px] sm:border-l sm:border-t-0">
                {existingSourceDraftPrompt.poster ? (
                  <img src={existingSourceDraftPrompt.poster} alt="来源视频素材封面" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full min-h-[180px] items-center justify-center text-text-muted sm:min-h-[300px]">
                    <Film size={34} className="opacity-35" />
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
        {showProjects && (
          <ProjectsOverlay
            projects={projects}
            batches={variationBatches}
            materials={materials}
            currentId={projectId}
            workflowContext={workflowContext?.taskKey === 'content_production' ? workflowContext : undefined}
            onClose={() => setShowProjects(false)}
            onLoad={loadProject}
            onDelete={removeProject}
            onReview={reviewVariationItem}
            onReuseProject={reuseProject}
            onReuse={reuseVariationBatch}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── 我的作品 / 草稿 浮层 ─────────────────────────────────────────────── */
function ProjectsOverlay({ projects, batches, materials, currentId, workflowContext, onClose, onLoad, onDelete, onReview, onReuseProject, onReuse }: {
  projects: StudioProject[];
  batches: VariationBatch[];
  materials: Clip[];
  currentId: string | null;
  workflowContext?: StudioWorkflowContext;
  onClose: () => void;
  onLoad: (p: StudioProject) => void;
  onDelete: (id: string) => void;
  onReview: (batchId: string, itemId: string, status: 'approved' | 'rejected') => void;
  onReuseProject: (p: StudioProject) => void | Promise<void>;
  onReuse: (batch: VariationBatch) => void;
}) {
  const drafts = projects.filter(p => p.status === 'draft');
  const works = projects.filter(p => p.status === 'ready_for_approval' || p.status === 'published');

  const Section = ({ title, items }: { title: string; items: StudioProject[] }) => (
    <div className="mb-5">
      <p className="text-xs font-semibold text-text-secondary mb-2">{title} · {items.length}</p>
      {items.length === 0 ? (
        <p className="text-xs text-text-muted py-3 text-center">暂无</p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {items.map(p => (
            <div key={p.id}
              className="card !rounded-xl overflow-hidden group cursor-pointer relative"
              style={p.id === currentId ? { borderColor: TRAFFIC_GREEN, boxShadow: `0 0 0 1px ${TRAFFIC_GREEN}` } : undefined}
              onClick={() => onLoad(p)}>
              <div className="relative">
                <ProjectFirstFrameThumb project={p} materials={materials} />
                <button
                  type="button"
                  onClick={event => {
                    event.stopPropagation();
                    void onReuseProject(p);
                  }}
                  className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded-lg bg-accent px-2 py-1 text-[10px] font-black text-white shadow-sm hover:brightness-95"
                  title="复制为新草稿并进入编辑"
                >
                  <Copy size={10} /> 一键复用
                </button>
              </div>
              <div className="p-2.5">
                <p className="text-xs font-semibold text-text-primary truncate">{p.title}</p>
                <p className="text-[10px] text-text-muted mt-0.5">{new Date(p.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
              </div>
              <button
                type="button"
                aria-label={`删除草稿：${p.title}`}
                title="删除草稿"
                onClick={e => { e.stopPropagation(); onDelete(p.id); }}
                className="absolute top-1.5 right-1.5 w-6 h-6 rounded-lg bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}>
      <motion.div
        initial={{ scale: 0.96, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 10 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320 }}
        className="w-[560px] max-h-[80%] flex flex-col rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <FolderOpen size={15} style={{ color: TRAFFIC_GREEN }} />
            <div>
              <span className="text-sm font-bold text-text-primary">{workflowContext ? '当前任务的内容项目' : '我的创作'}</span>
              {workflowContext && <p className="mt-0.5 text-[10px] text-text-muted">仅显示本次运行与任务关联的项目</p>}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭我的创作" title="关闭" className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-primary transition-colors">
            <X size={15} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {drafts.length === 0 && works.length === 0 && batches.length === 0 ? (
            <div className="text-center py-12">
              <FolderOpen size={28} className="mx-auto text-text-muted mb-3 opacity-30" />
              <p className="text-sm text-text-muted">{workflowContext ? '当前任务尚未创建内容项目' : '还没有保存任何草稿或作品'}</p>
              <p className="text-xs text-text-muted mt-1">{workflowContext ? '请返回执行中心查看任务状态或重试任务' : '开始创作后会自动保存，也可在顶部手动保存'}</p>
            </div>
          ) : (
            <>
              <Section title="作品集草稿" items={drafts} />
              <Section title="已完成 / 待审核作品" items={works} />
              {batches.length > 0 && (
                <div className="mb-5">
                  <p className="mb-2 text-xs font-semibold text-text-secondary">裂变批次 · {batches.length}</p>
                  <div className="space-y-2">
                    {batches.map(batch => (
                      <div key={batch.id} className="rounded-xl border border-border bg-surface-2 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div><p className="text-xs font-bold text-text-primary">{batch.title}</p><p className="mt-0.5 text-[10px] text-text-muted">{batch.items.length} 条 · 预计生成成本 ¥{batch.estimatedCostCny} · {batch.status}</p></div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <button type="button" onClick={() => void onReuse(batch)}
                              className="flex items-center gap-1 rounded-md border border-accent/25 bg-white px-2 py-1 text-[10px] font-bold text-accent transition hover:bg-accent/10">
                              <Copy size={10} /> 复用
                            </button>
                          </div>
                        </div>
                        {batch.items.filter(item => item.status === 'review').map(item => (
                          <div key={item.id} className="mt-2 flex items-center gap-2 rounded-lg bg-surface px-2.5 py-2">
                            <p className="min-w-0 flex-1 truncate text-[10px] text-text-secondary">{Object.values(item.variables).join(' · ')}{item.qualityScore != null ? ` · 质检 ${item.qualityScore}` : ''}</p>
                            <button onClick={() => onReview(batch.id, item.id, 'approved')} className="text-[10px] font-bold text-accent">通过</button>
                            <button onClick={() => onReview(batch.id, item.id, 'rejected')} className="text-[10px] font-bold text-red">驳回</button>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ── 小组件 ───────────────────────────────────────────────────────────── */

function SectionTitle({ title, desc, noMargin }: { title: string; desc?: string; noMargin?: boolean }) {
  return (
    <div className={noMargin ? '' : 'mb-4'}>
      <h3 className="text-base font-bold text-text-primary font-display">{title}</h3>
      {desc && <p className="text-xs text-text-muted mt-0.5">{desc}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-text-secondary mb-2">{label}</p>
      {children}
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border"
      style={active
        ? { background: TRAFFIC_GREEN, color: '#fff', borderColor: TRAFFIC_GREEN }
        : { background: 'var(--color-surface)', color: 'var(--color-text-secondary)', borderColor: 'var(--color-border)' }}>
      {children}
    </button>
  );
}
