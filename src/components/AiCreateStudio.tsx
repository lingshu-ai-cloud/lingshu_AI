import { socialContentApi } from '../lib/socialContentApi';
import { enterpriseBuyerText, validateStudioTimeline, pendingClaimLocations } from '../lib/studioValidation';
export { enterpriseBuyerText, validateStudioTimeline, pendingClaimLocations } from '../lib/studioValidation';
import { mediaType, fileToDataUrl, blobToDataUrl, localFileName } from '../lib/studioFileInputs';
import { studioWorkflowContextFromSpec, resolveStudioWorkflowProjectEntry, isUnverifiedLegacyCoverTitle, studioSpecHasMeaningfulContent, withoutStudioWorkflowContext, type StudioWorkflowContext } from '../lib/studioProjectContext';
export { studioWorkflowContextFromSpec, resolveStudioWorkflowProjectEntry, isUnverifiedLegacyCoverTitle, studioSpecHasMeaningfulContent, type StudioWorkflowContext } from '../lib/studioProjectContext';
import { materialShotPlan } from '../lib/materialShotPlan';
import { ensureMaterialAnalysis } from '../lib/studioApi';
import MaterialAnalysisStatus from './studio/MaterialAnalysisStatus';
import MaterialLibraryStatus from './studio/MaterialLibraryStatus';
import ProductionTaskScene from './ProductionTaskScene';
import DirectorTaskContext from './DirectorTaskContext';
import { requestProductionBack } from '../lib/productionNavigation';
import ContentLibrary from './ContentLibrary';
import ProductionRevisionPanel from './ProductionRevisionPanel';
import { useAgentProductionAction } from '../lib/agentProductionSession';
import { VIDEO_PRESENTATIONS, type VideoCreationPlan } from '../lib/videoCreationPlan';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LayoutGrid, Film, FileText, Music, Image as ImageIcon, Play, Send, Check, ChevronLeft, ChevronRight, Folder, Search, Volume2, Mic, Download, Loader2, Sparkles, Wand2, Copy, RefreshCw, Clock, Upload, X, Plus, List, Save, FolderOpen, Trash2, Pause, ChevronDown, Heart, ExternalLink, Languages } from 'lucide-react';
import { studioApi, getDesktopRender, type StudioProject, type VariationBatch, type Material, type MaterialSegment, type BgmTrack, type CoverStyle, type SubCue, type TtsStyleOptions, type StudioAudioCapabilities, type FbPosterResult, type LeadContentPackageResult, type StoryboardQualityResult, type VideoGenerationVersion, type StudioScriptResult, type StudioScriptQualityStatus, type StudioScriptQualityChecks, type StudioGenerationProvenance, type DigitalHumanCapabilities, type DigitalHumanJob, type HeyGenAvatarOption } from '../lib/studioApi';
import { isMeasuredVoiceAlignment, matchVoiceCuesToShots, productionVoiceCues, retimeVisualShotsToVoiceover } from '../lib/voiceoverAlignment';
import { createPresetEffectPlan, type EffectIntensity, type EffectPresetId } from '../../shared/contracts/effectPlan';
import type { Page } from '../App';
import type { SocialContentCreateRequest } from './socialContent/SocialContentWorkspace';
import { completeDemoStep } from '../lib/demoProgress';
import { authHeader } from '../lib/auth';
import { useDismissibleLayer } from '../hooks/useDismissibleLayer';
import { useModalFocus } from '../hooks/useModalFocus';
import { createScriptGapTask, readScriptGapTasks, SCRIPT_GAP_QUEUE_EVENT, type ScriptGapTask } from '../lib/scriptGapQueue';
import { isSocialArtifactMediaSourceEligible } from '../lib/socialContentArtifactMedia';
import { contentCreationDemoMaterialIds, contentCreationTestBypassEnabled } from '../lib/contentCreationTestBypass';
import { useStudioSocialArtifactSubmission } from './socialContent/useStudioSocialArtifactSubmission';
import { useStudioSocialTaskHydration, socialTaskReferenceKickoff, socialTaskShotMaterialBindings, type StudioSocialShotMaterialBinding, type StudioSocialTaskSeed } from './socialContent/useStudioSocialTaskHydration';
import { reconcileShootingSlots, shootingRefillTarget, transcriptMatches, type ShootingSlot } from '../lib/shootingWorkflow';
import ShootingTaskDialog from './ShootingTaskDialog';
import ShotProductionPanel from './ShotProductionPanel';
import DigitalHumanProductionOverview from './studio/DigitalHumanProductionOverview';
import RenderedVideoPlayer from './RenderedVideoPlayer';
import { applyDefaultsToUnlockedAvatarShots, avatarCandidateReady, automaticAvatarRefreshes, EMPTY_DEFAULTS, newShotProduction, patchShot, presenterCapabilities, shotFingerprint, shotBlockers, recommendShot, productionSummary, type ShotProduction, type ProductionDefaults, type AvatarJob, type AppearancePreference } from '../lib/shotProduction';
import { productionApi } from '../lib/productionApi';
import { matchEvidenceSegment, usableEvidenceSegment } from '../lib/segmentEvidence';
import { mapNarrationCues, spokenText } from '../lib/narrationAlignment';
import {
  StudioWorkbenchFrame,
  StudioInputSummary,
  StudioStoryboardList,
  type StudioWorkbenchStep,
} from './studio/StudioWorkbenchFrame';
import {
  authenticatedAudioBlobUrl,
  playAudioWithAuthenticatedFallback,
  playVideoWithAuthenticatedFallback,
  StudioRequestTimeoutError,
  waitForStudioMediaReady,
  withStudioTimeout,
} from './studio/studioAuthenticatedMedia';
import { BenchmarkVideoPreview, LeadContentPackagePreview, VariationChipEditor } from './studio/StudioPreviewPanels';
import { newDigitalHumanRequirements, planDigitalHumanShot, type DigitalHumanExecutionRecord, type DigitalHumanPlanRecord } from '../lib/digitalHumanPlan';
import { shotKeyframeCues } from '../lib/shotKeyframes';
import { CoverFace, ProjectFirstFrameThumb, RealThumb, Thumb, coverArtCss } from './StudioMediaPreviews';
import { Field, Pill, SectionTitle } from './StudioFormPrimitives';
export { StudioRequestTimeoutError, waitForStudioMediaReady, withStudioTimeout } from './studio/studioAuthenticatedMedia';
// AI 生成内容工作台：创作设置 → 脚本与声音 → 成片制作。
const TRAFFIC_GREEN = '#117f51';
const CANVA_VIDEO_COVER_URL = 'https://www.canva.cn/create/video-covers/';
const CANVA_COVER_RETURN_KEY = 'ow_canva_cover_return';
const CANVA_COVER_RETURN_TTL = 6 * 60 * 60 * 1000;
const PUBLISH_RETURN_PREVIEW_KEY = 'ow_publish_return_to_preview';
const STUDIO_OPEN_PROJECT_KEY = 'ow_studio_open_project';
const PUBLISH_RETURN_PREVIEW_TTL = 2 * 60 * 60 * 1000;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
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
// Media preview components live in StudioMediaPreviews.
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
// Thumb extracted to StudioMediaPreviews.
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
  usage: m.usage, sourceType: m.sourceType, industry: m.industry, shotFunction: m.shotFunction, applicability: m.applicability, tags: m.tags,
  segmentAnalysisStatus: m.segmentAnalysisStatus, segmentAnalysisError: m.segmentAnalysisError, segments: m.segments, visualObservations: m.visualObservations,
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

const DEFAULT_VIDEO_CONVERSION_GOAL = '引导通过 Messenger 联系';

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

export interface Clip {
  transcript?: string;
  transcriptCues?: SubCue[];
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
  industry?: string;
  shotFunction?: string;
  applicability?: string;
  tags?: string;
  segmentAnalysisStatus?: 'pending' | 'analyzing' | 'completed' | 'failed';
  segmentAnalysisError?: string;
  visualObservations?: string[];
  segments?: MaterialSegment[];
}

interface ClipEdit {
  segmentId?: string;
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
  generationKind: 'script';
  generationProvenance: string;
  qualityStatus: string;
  publishable: boolean;
  generationRecordId: string;
};
type StudioPublishPayload = StudioPublishItem & { items?: StudioPublishItem[] };

type LanguageRenderOutput = {
  status: 'pending' | 'rendering' | 'done' | 'failed';
  path?: string;
  previewUrl?: string;
  error?: string;
};

type LanguageRenderGeneration = {
  id: string;
  versionNumber: number;
  status: 'done' | 'failed';
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

/** Either visual topic or expression purpose may nominate a local asset.
 * Duration and aspect ratio never establish semantic eligibility on their own. */
function materialSemanticDimensions(clip: Clip, slot: StoryboardSlot): { topic: boolean; purpose: boolean } {
  const visual = storyboardSlotScript(slot.detail).visual || slot.title;
  const purpose = slot.detail.match(/镜头功能\s*[：:]\s*(.+?)(?=\s+(?:口播|台词|字幕|配乐|画面|环境|景别|运镜)\s*[：:]|$)/i)?.[1]?.trim() || '';
  const segments = (clip.segments || []).filter(segment => usableEvidenceSegment(segment, clip.duration));
  if (!visual.trim() || !purpose.trim()) return { topic: false, purpose: false };
  const topicRules: Array<{ visual: RegExp; folders: string[]; metadata: RegExp }> = [
    // Factory B-roll is matched by the scene's subject and purpose. The
    // number of people, clothing and exact hand movement are not requirements.
    { visual: /(?:两人|人员|工人|白大褂).*(?:操作|指认|工作|生产|整理)/i, folders: [], metadata: /工人|人员|人工|白大褂|戴白手套的人|worker|staff/i },
    { visual: /灌装|填充|瓶口注液|filling/i, folders: [], metadata: /灌装|填充|注液|filling/i },
    { visual: /移液管|秤盘|烧杯|实验|研发|化验/i, folders: [], metadata: /移液|称重|烧杯|实验|研发|滴液|化验/i },
    { visual: /瓶罐.*(?:摆放|陈列)|产品.*(?:陈列|展示)|货架.*(?:瓶|产品)/i, folders: [], metadata: /陈列|摆放|包装展示|产品展示|瓶罐展示|packshot|display/i },
    { visual: /工厂|车间|产线|生产|质检|灌装|流水线|移液管|秤盘|factory|workshop|production|inspection|filling/i, folders: ['factory'], metadata: /工厂|生产|车间|质检|灌装|流水线|设备|工人|factory|production|inspection|filling/i },
    { visual: /产品|瓶身|瓶罐|包装|质地|成分|product|bottle|package|texture/i, folders: ['product', 'detail', 'packaging'], metadata: /产品|瓶身|瓶罐|包装|质地|瓶|罐|product|bottle|package|texture/i },
    { visual: /使用|上脸|试用|体验|application|usage|try.?on/i, folders: ['scene', 'model'], metadata: /使用|试用|上脸|场景|usage|application|try.?on/i },
    { visual: /证书|检测报告|认证|certificate|test report/i, folders: ['certificate'], metadata: /证书|检测|认证|certificate|test report/i },
  ];
  const topic = topicRules.find(rule => rule.visual.test(visual));
  const purposeRules: Array<{ purpose: RegExp; metadata: RegExp }> = [
    { purpose: /钩子|截流|吸引|hook|attention/i, metadata: /钩子|开场|吸引|hook|attention/i },
    { purpose: /证明|信任|背书|proof|trust|credibility/i, metadata: /证明|信任|背书|实力|实拍|生产流程|工艺稳定|设备精度|proof|trust|evidence/i },
    { purpose: /展示|介绍|演示|价值|demo|show|introduc|demonstration|value/i, metadata: /展示|介绍|演示|细节|生产流程|show|demo|display/i },
    { purpose: /痛点|对比|反差|problem|comparison|contrast/i, metadata: /痛点|对比|反差|problem|comparison|contrast/i },
    { purpose: /转化|询价|行动|cta|conversion/i, metadata: /转化|询价|行动|cta|conversion|contact/i },
  ];
  const intended = purposeRules.find(rule => rule.purpose.test(purpose));
  const purposeTerms = purpose.toLowerCase().match(/[\u4e00-\u9fff]{2,4}|[a-z]{4,}/g) || [];
  const evaluate = (visualEvidence: string, purposeEvidence: string, folder = '') => ({
    topic: Boolean(topic && (topic.folders.includes(folder) || topic.metadata.test(visualEvidence))),
    purpose: intended ? intended.metadata.test(purposeEvidence) : purposeTerms.some(term => purposeEvidence.includes(term)),
  });
  const candidates = [
    evaluate(`${clip.folder} ${clip.tags || ''}`, `${clip.shotFunction || ''} ${clip.applicability || ''} ${clip.tags || ''}`, clip.folder),
    ...segments.map(segment => evaluate(
      `${segment.visualTopic || ''} ${segment.subject.join(' ')} ${segment.action} ${segment.environment}`,
      `${segment.expressionPurpose || ''} ${segment.recommendedFunctions.join(' ')}`,
    )),
  ];
  return candidates.sort((a, b) => Number(b.topic) + Number(b.purpose) - Number(a.topic) - Number(a.purpose))[0]!;
}

function matchStoryboardMetadata(clip: Clip, slot: StoryboardSlot): boolean {
  const dimensions = materialSemanticDimensions(clip, slot);
  return dimensions.topic || dimensions.purpose;
}

export function matchMaterialsToStoryboardLocally(
  pool: Clip[],
  slots: StoryboardSlot[],
  preferredIds: string[] = [],
  options: {
    variantIndex?: number;
    previousAssignments?: Array<Record<string, string>>;
    targetRatio?: string;
    allowSemanticMetadata?: boolean;
    requireEvidence?: boolean;
    allowReuse?: boolean;
    preferredBoost?: number;
  } = {},
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
  // Legacy drafts can contain title-only slots. They have no visual claim to
  // verify, so keep the historical deterministic matcher for those slots.
  // Generated slots with a real detail continue to require segment evidence.
  const allowLegacyTitleOnlyMatching = slots.every(slot => !String(slot.detail || '').trim());

  slots.forEach((slot, slotIndex) => {
    const slotText = `${slot.title} ${slot.detail}`.toLowerCase();
    const targetDuration = Math.max(0.5, slot.end - slot.start);
    const remainingSlots = slots.length - slotIndex;
    const freshStillNeeded = Math.max(0, minimumFreshCount - freshAssignedCount);
    const supportedPool = allowLegacyTitleOnlyMatching || options.requireEvidence === false
      ? pool
      : pool.filter(clip => options.allowSemanticMetadata
        ? matchStoryboardMetadata(clip, slot) : Boolean(matchEvidenceSegment(clip, slot)));
    const unusedSupported = supportedPool.filter(clip => unused.has(clip.id));
    const uniquePool = unusedSupported.length
      ? unusedSupported
      : options.allowReuse === false ? [] : supportedPool;
    const freshUniquePool = uniquePool.filter(clip => !previousMaterialIds.has(clip.id));
    const mustChooseFresh = freshStillNeeded >= remainingSlots && freshUniquePool.length > 0;
    // Reuse is allowed across non-adjacent shots when it preserves a stronger
    // semantic match. Adjacent reuse incurs a larger penalty below.
    const eligiblePool = options.allowReuse === false
      ? mustChooseFresh ? freshUniquePool : uniquePool
      : options.allowSemanticMetadata ? supportedPool : mustChooseFresh ? freshUniquePool : uniquePool;
    const openingRoleOrder = [
      ['detail', 'product', 'presenter'],
      ['presenter', 'model', 'scene'],
      ['product', 'detail', 'scene'],
    ][variantIndex % 3] || ['detail', 'product', 'presenter'];
    const candidates = eligiblePool.map(clip => {
      if (options.allowSemanticMetadata) return {
        clip,
        score: assessMaterialMatch(slot, clip, options.targetRatio || '9:16').score * 10
          + Number(unused.has(clip.id)) * 20
          - Number(slotIndex > 0 && assignments[slots[slotIndex - 1].id] === clip.id) * 600,
      };
      const clipText = `${clip.name} ${clip.folder} ${clip.industry || ''} ${clip.shotFunction || ''} ${clip.applicability || ''} ${clip.tags || ''}`.toLowerCase();
      let score = 0;
      if (unused.has(clip.id)) score += 18;
      if (preferred.has(clip.id)) score += options.preferredBoost ?? 7;
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

export function resolveWorkbenchSeekTime(formalPreview: boolean, timelineTime: number, sourceTime: number): number {
  return Math.max(0, formalPreview ? timelineTime : sourceTime);
}

type MaterialMatchAssessment = {
  score: number;
  level: 'direct' | 'review' | 'missing';
  reason: string;
  difference: string;
};

export function assessMaterialMatch(slot: StoryboardSlot, clip: Clip, _targetRatio: string): MaterialMatchAssessment {
  const { topic, purpose } = materialSemanticDimensions(clip, slot);
  const score = (topic ? 50 : 0) + (purpose ? 50 : 0);
  const level = score === 100 ? 'direct' : score === 50 ? 'review' : 'missing';
  const reason = score === 100 ? '视觉主题和表达目的均匹配'
    : topic ? '视觉主题匹配，表达目的待标注'
      : purpose ? '表达目的匹配，视觉主题待标注' : '视觉主题和表达目的均待标注';
  return { score, level, reason, difference: reason };
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

function inferPersonShot(value: string): boolean | undefined {
  const text=String(value||'').toLowerCase();
  if(/人物|真人|口播|讲解|主持|主播|模特|面部|半身|全身|woman|man|person|presenter|speaker|talking/.test(text)) return true;
  if(/产品|机器|设备|工厂|车间|包装|细节|特写|信息图|文字卡|场景空镜|b-?roll|product|factory|machine|diagram/.test(text)) return false;
  return undefined;
}

/** Voiceover belongs to the audio track; it does not turn a visual B-roll shot into an avatar shot. */
export function visualShotRoute(slot: Pick<StoryboardSlot, 'title' | 'detail'>): 'presenter' | 'motion' | 'material' {
  const visual = slot.detail.match(/(?:^|\n)画面[：:]([^\n]+)/)?.[1] || slot.title;
  const text = visual.toLowerCase();
  if (/背影|背对|路人|工人|背景人物|会议|工厂|车间|产线|使用场景|操作|手部|b-?roll|background|back view|factory|meeting/.test(text)) return 'material';
  if (/动作|转身|走向|起身|手势|运镜|动态|表演|左手举至镜头前|右手举至镜头前|靠近镜头|指向镜头|双臂.*(?:展开|伸展)|motion|walking|gesture|turns? around/.test(text)) return 'motion';
  if (/产品|包装|product|packaging/.test(text)) return 'material';
  if (/女性|男性|女人|男人|女士|男士|销售|企业人物|主播|主持人|数字人|主角|主人公|presenter|sales/.test(text)
    && /正面|面对镜头|直视镜头|镜头前|出镜讲解|对镜口播|说话|口型|口播|front.?facing|talking to camera|lip.?sync/.test(text)
    && /口播[：:]\s*(?!无(?:\s|$))\S/.test(slot.detail)) return 'presenter';
  return 'material';
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

function parseStandaloneTimeRangeLabel(value: string): { label: string; start: number; end: number } | null {
  // A plain, unbracketed timestamp must occupy the beginning of the line and
  // end there (or be followed by a colon). Product specifications such as
  // "0–50 kN" inside narration are data, not new storyboard boundaries.
  const standaloneRange = /^\s*(?:(?:start|开始)|\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*(?:[:：]|$)/i;
  return standaloneRange.test(value) ? parseTimeRangeLabel(value) : null;
}

export function parseStoryboardSlots(value: string, totalDuration: number): StoryboardSlot[] {
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
    const inline = !bracket && !scene ? parseStandaloneTimeRangeLabel(line) : null;
    const range = bracket ? parseTimeRangeLabel(bracket[1]) : scene ? parseTimeRangeLabel(scene[1]) : inline;
    if (range) {
      push();
      current = { range, lines: [line.replace(bracket?.[0] || scene?.[0] || '', '').trim()].filter(Boolean) };
    } else if (current) {
      current.lines.push(line);
    }
  }
  push();

  if (slots.length) return slots;
  // 没有真实时间戳脚本时不伪造等分分镜，选材页明确显示“暂无分镜”。
  return [];
}

/** Keep the source ASR sentence order while the observed visual cuts define production shots. */
export function referenceProductSlots(kickoff: VideoKickoff | null): Array<{ shotId: string; sourceLabel: string; time: string; visual: string }> {
  return (kickoff?.referenceAnalysis?.details || []).flatMap((detail, index) => {
    const range = parseCueRange(detail.time);
    if (!range || index === 0 || range.end - range.start > 2.5
      || !/mask|marks|cream|foundation|essence|oil|shampoo|面膜|修护|美白|粉底|精华|按摩|洗发/i.test(detail.subtitle || '')
      || /实验服|工人|灌装|传送带|试剂|设备|实验台|生产线/.test((detail.visual || '').slice(0, 45))) return [];
    return [{ shotId: detail.shotId || `reference-shot-${index + 1}`, sourceLabel: detail.subtitle?.trim() || `原片产品 ${index + 1}`, time: detail.time, visual: detail.visual || '' }];
  });
}

type ReferenceProductMapping = { shotId: string; sourceTerm: string; productId: string; productLabel: string };

export function buildReferenceSpeechPlan(kickoff: VideoKickoff | null, productMappings: ReferenceProductMapping[] = []): { script: string; lines: Array<{ id: string; source: string; draft: string; time: string; visuals: Array<{ time: string; label: string }> }>; error?: string } {
  const details = kickoff?.referenceAnalysis?.details || [];
  if (!details.length) return { script: '', lines: [], error: '参考视频尚无可用的画面切点。' };
  if (kickoff?.referenceAnalysis?.narrationSourceStatus === 'missing_source_asr') return { script: '', lines: [], error: '原片 ASR 尚未提取完成，请等待编导 Agent 自动提取口播后再试。' };
  const replacements = productMappings.filter(mapping => mapping.sourceTerm.trim() && mapping.productLabel.trim())
    .sort((left, right) => right.sourceTerm.length - left.sourceTerm.length);
  const replacementPattern = replacements.length ? new RegExp(replacements.map(mapping => mapping.sourceTerm.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi') : null;
  const lines = new Map<string, { id: string; source: string; draft: string; time: string; visuals: Array<{ time: string; label: string }> }>();
  const shotRows = details.map((shot, shotIndex) => {
    const range = parseCueRange(shot.time);
    if (!range) return null;
    const ownerId = shot.shotId || `shot-${shotIndex + 1}`;
    const spoken: string[] = [];
    for (const [lineIndex, line] of (shot.speechLines || []).entries()) {
      if (line.narrationOwnerShotId && line.narrationOwnerShotId !== ownerId) continue;
      const source = String(line.referenceText || '').trim();
      const draft = replacementPattern ? source.replace(replacementPattern, match => replacements.find(mapping => mapping.sourceTerm.trim().toLocaleLowerCase() === match.toLocaleLowerCase())?.productLabel.trim() || match) : productMappings.length ? source : String(line.draftText || source).trim();
      if (!source || !draft) continue;
      const id = line.lineId || `${ownerId}:${lineIndex}`;
      if (lines.has(id)) continue;
      const start = Number(line.sourceStartSeconds);
      const end = Number(line.sourceEndSeconds);
      const time = Number.isFinite(start) && Number.isFinite(end) && end > start
        ? `${start.toFixed(2)}–${end.toFixed(2)}s` : `${range.start.toFixed(2)}–${range.end.toFixed(2)}s`;
      const visualShots = details.filter(item => (item.speechLines || []).some(speech => speech.lineId === id));
      lines.set(id, { id, source, draft, time, visuals: visualShots.map(item => ({ time: item.time, label: item.visual || item.shot || '画面待分析' })) });
      spoken.push(draft);
    }
    const mappedProduct = productMappings.find(mapping => mapping.shotId === ownerId);
    return `[${range.start.toFixed(2)}s-${range.end.toFixed(2)}s]\n画面：${shot.visual || shot.shot || '按参考视频画面'}\n${mappedProduct ? `目标产品：${mappedProduct.productLabel}\n` : ''}镜头功能：${shot.purpose || '沿用参考视频表达目的'}\n口播：${spoken.join(' ') || '无'}`;
  }).filter((row): row is string => Boolean(row));
  if (!lines.size) return { script: '', lines: [], error: '参考视频缺少真实 ASR 原片口播，无法生成忠实复刻口播方案。' };
  const unmatched = productMappings.filter(mapping => mapping.sourceTerm.trim()
    && ![...lines.values()].some(line => line.source.toLocaleLowerCase().includes(mapping.sourceTerm.trim().toLocaleLowerCase())));
  if (unmatched.length) return { script: shotRows.join('\n\n'), lines: [...lines.values()],
    error: `${unmatched.map(mapping => mapping.sourceTerm).join('、')} 未在原片口播中识别到；请核对产品词后再生成配音。` };
  return { script: shotRows.join('\n\n'), lines: [...lines.values()] };
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
  // A shorter voiceover may end before the visuals, but must not compress an
  // approved storyboard. Only extend the visual timeline when narration needs
  // more room so captions and speech are not cut off.
  if (voiceoverDuration <= sourceDuration) return timeline;
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

/** Align one narration cue with one storyboard shot for each language version. */
export function fitTimelineToVoiceoverCues<T extends {
  trimStart?: number;
  trimEnd?: number;
  speed?: number;
  targetStart?: number;
  targetEnd?: number;
  targetDuration: number;
}>(timeline: T[], voiceoverDuration: number, cues?: SubCue[]): T[] {
  if (!cues?.length || cues.length !== timeline.length) return fitTimelineToVoiceover(timeline, voiceoverDuration);
  if (!Number.isFinite(voiceoverDuration) || voiceoverDuration <= 0) return timeline;
  const boundaries = [0, ...cues.slice(1).map(cue => Number(cue.start)), voiceoverDuration];
  if (boundaries.some((value, index) => !Number.isFinite(value) || value < 0 || (index > 0 && value <= boundaries[index - 1]))) {
    return fitTimelineToVoiceover(timeline, voiceoverDuration);
  }
  return timeline.map((item, index) => {
    const targetStart = boundaries[index];
    const targetEnd = boundaries[index + 1];
    const targetDuration = targetEnd - targetStart;
    const sourceClipDuration = Math.max(0, (Number(item.trimEnd) || 0) - (Number(item.trimStart) || 0));
    return {
      ...item,
      targetStart: +targetStart.toFixed(3),
      targetEnd: +targetEnd.toFixed(3),
      targetDuration: +targetDuration.toFixed(3),
      speed: sourceClipDuration > 0 ? Math.max(0.25, Math.min(4, sourceClipDuration / targetDuration)) : item.speed,
    };
  });
}

export function fitStoryboardSlotsToDuration(slots: StoryboardSlot[], duration: number): StoryboardSlot[] {
  const sourceDuration = slots.reduce((max, slot) => Math.max(max, slot.end), 0);
  if (!slots.length || !Number.isFinite(duration) || duration <= 0 || sourceDuration <= 0) return slots;
  if (duration <= sourceDuration) return slots;
  const scale = duration / sourceDuration;
  return slots.map((slot, index) => {
    const start = index === 0 ? 0 : slot.start * scale;
    const end = index === slots.length - 1 ? duration : slot.end * scale;
    return { ...slot, start: +start.toFixed(3), end: +end.toFixed(3), time: `${start.toFixed(1)}s-${end.toFixed(1)}s` };
  });
}

function storyboardSlotScript(detail: string) {
  const text = String(detail || '').replace(/\s+/g, ' ').trim();
  const labels = '环境|景别|运镜|镜头功能|画面|Visual|人物说|台词|Voiceover|VO|口播|字幕|Caption|素材|素材依据|配乐|真实性要求|可见事实|表达意图|未展示因果|Omni提示词|Omni禁止项';
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
export const fontCss = (id: CoverStyle['font']) => COVER_FONTS.find(f => f.id === id)?.css ?? COVER_FONTS[0].css;

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
  { id: 'oem-factory', label: 'B2B 产品说明风' },
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
  if (normalized === 'inspiration_analysis') return '灵感中心 · 爆款视频分析';
  if (normalized === 'inspiration_image_post') return '灵感中心 · 爆款图文分析';
  if (normalized === 'material_library' || normalized === 'material_segment_analysis') return '素材库';
  if (normalized === 'seedance_video') return 'AI 视频创作';
  if (normalized === 'agent_memory' || normalized === 'content_memory_recommendation') return '智能推荐 · 内容策略';
  return '手动创建';
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

export function detectSourceSpeechLanguageCode(value: string): string {
  const text = String(value || '').trim();
  const latinWords = text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)?.length || 0;
  const hanCount = text.match(/[\u4e00-\u9fff]/g)?.length || 0;
  if (latinWords >= 3 && latinWords * 2 >= hanCount) return 'en';
  return detectScriptLanguageCode(text);
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

export interface VideoKickoff {
  source?: 'inspiration_analysis' | 'inspiration_image_post' | 'seedance_video' | string;
  script?: string;
  scriptType?: 'voiceover' | 'storyboard';
  language?: string;
  productInfo?: string;
  actionContext?: { source?: string; recommendation?: string; workflowRunId?: string; workflowTaskId?: string };
  referenceAnalysis?: {
    title?: string;
    narrationSourceStatus?: 'asr_aligned' | 'missing_source_asr';
    visualStyle?: string;
    coreEmotion?: string;
    details?: { time: string; shotId?: string; personContinuityId?: string; environment?: string; shot: string; camera: string; visual: string; subtitle?: string; audio?: string; note?: string; purpose?: string; dialogue?: string; speechLines?: Array<{ lineId?: string; referenceText: string; draftText?: string; sourceStartSeconds: number; sourceEndSeconds: number; sourcePrecision?: 'coarse' | 'phrase'; sourceProvenance?: string; replacedEntityTypes?: string[]; narrationOwnerShotId?: string; visualShotIds?: string[] }>; onScreenText?: string; ambientSound?: string; bgm?: string; soundEffects?: string[]; beats?: Array<{ time?: string; action?: string; dialogue?: string; onScreenText?: string }>; persistentState?: string; authenticity?: string; confidence?: number; needsReview?: boolean }[];
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
    referenceRecordId?: string;
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

type ReferenceVoiceStrength = 'light' | 'balanced' | 'strong';

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
  generationSource?: string;
  generationProvenance?: StudioGenerationProvenance | string;
  publishable?: boolean;
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
  if (response.ok === false && response.source !== 'ai_rejected') return 'failed';
  if (['fallback', 'local', 'template', 'ai_failed'].includes(String(response.source || '').toLowerCase())) return 'failed';
  if (response.qualityStatus) return response.qualityStatus;
  if (response.source === 'ai_rejected') return 'rejected';
  if (response.source === 'ai_failed') return 'failed';
  // Legacy responses without an explicit quality verdict remain drafts. A
  // non-empty string alone must never be upgraded to "passed".
  return response.script?.trim() ? 'warning' : undefined;
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

export function scriptQualityFailure(response: StudioScriptResult, fallback: string, retainRejectedDraft = false): string | null {
  const status = normalizedScriptQualityStatus(response);
  const scriptAvailable = Boolean(response.script?.trim());
  const source = String(response.source || '').toLowerCase();
  if (response.ok === false && source !== 'ai_rejected') return response.error || fallback;
  if (['fallback', 'local', 'template', 'ai_failed'].includes(source)) {
    return response.error || 'AI 生成失败；本地或历史内容未被当作本次 AI 结果。';
  }
  if (scriptAvailable && status !== 'rejected' && status !== 'failed') return null;
  if (scriptAvailable && status === 'rejected' && retainRejectedDraft) return null;
  const reasons = response.validationIssues?.length
    ? response.validationIssues
    : response.validationWarnings?.length
      ? response.validationWarnings
      : [];
  const reason = reasons.map(item => String(item).trim()).filter(Boolean).map((issue, issueIndex) => `${issueIndex + 1}. ${issue}`).join('；')
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

function qualityFields(response: StudioScriptResult): Pick<ModeScriptOutput, 'generationSource' | 'generationProvenance' | 'publishable' | 'qualityStatus' | 'qualityChecks' | 'validationWarnings' | 'validationIssues' | 'materialCoveragePercent' | 'pendingMaterialScenes' | 'missingMaterials'> {
  return {
    generationSource: response.source,
    generationProvenance: response.provenance || (response.source === 'ai' ? 'ai' : response.source),
    publishable: response.publishable,
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

function manualScriptDraft(item: ModeScriptOutput, script: string): ModeScriptOutput {
  const previousReviewNotes = [
    ...(item.validationIssues || []),
    ...(item.validationWarnings || []),
  ].map(note => String(note).trim()).filter(Boolean);
  return {
    ...item,
    script,
    generationSource: 'manual_draft',
    generationProvenance: 'manual_draft',
    publishable: false,
    qualityStatus: 'unreviewed',
    qualityChecks: undefined,
    validationWarnings: Array.from(new Set([
      '内容已手动修改，等待基于企业中心资料重新审核。',
      ...previousReviewNotes,
    ])),
    validationIssues: [],
    materialCoveragePercent: undefined,
    pendingMaterialScenes: undefined,
    missingMaterials: [],
  };
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
      item.needsReview ? `编导 Agent 自动补证：待完成（置信度${Math.round((item.confidence ?? 0) * 100)}%）` : '',
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
  return ranges.some((range, index) => {
    const next = ranges[index + 1];
    return Boolean(next && next.start - range.end > 0.75)
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
    const observations = [...(clip.visualObservations || []), ...(clip.segments || []).filter(segment => !segment.needsReview && Number(segment.confidence) >= .65).slice(0, 6).map(segment => [
      `${segment.start}-${segment.end}s`,
      segment.action,
      segment.shot,
      segment.camera,
      segment.environment,
      segment.productVisible ? `产品清晰度${segment.productClarity}` : '',
      segment.ocrText ? `OCR:${segment.ocrText.slice(0, 120)}` : '',
      segment.needsReview && !segment.manualConfirmed ? '待人工复核' : '',
    ].filter(Boolean).join('；'))];
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
  if (result.length === 1 && result[0]!.type === 'video') {
    const item = result[0]!;
    const usableDuration = Math.max(0, item.targetEnd - item.targetStart);
    if (usableDuration > 8) {
      const segmentCount = Math.max(3, Math.min(4, Math.ceil(usableDuration / 8)));
      // Reserve a longer final slot for the enterprise's exact CTA instead of
      // forcing a full B2B action into the same short duration as proof shots.
      const segmentDuration = usableDuration / (segmentCount + 1);
      return Array.from({ length: segmentCount }, (_, index) => {
        const targetStart = +(item.targetStart + segmentDuration * index).toFixed(1);
        const targetEnd = +(index === segmentCount - 1
          ? item.targetEnd
          : item.targetStart + segmentDuration * (index + 1)).toFixed(1);
        return {
          ...item,
          effectiveDuration: +(targetEnd - targetStart).toFixed(1),
          role: `${item.role}（连续片段 ${index + 1}/${segmentCount}）`,
          targetStart,
          targetEnd,
          observations: item.observations?.length
            ? item.observations
            : [`同一原始视频的连续时间段 ${targetStart}-${targetEnd}s；只使用该时间段可见内容`],
        };
      });
    }
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


// Storyboard rows can be persisted either one field per line or as one packed
// line. Stop at the next field label so an inline `字幕：无` does not make a
// valid `台词：...` look like a production instruction and disappear.
const VOICEOVER_FIELD_RE = /(?:人物说|台词|Voiceover|VO|口播)\s*[：:]\s*(.*?)(?=\s+(?:环境|景别|运镜|构图|镜头功能|画面|Visual|字幕|Caption|屏幕文字|OnScreenText|配乐|音乐|音效|Sound|SFX|BGM|真实性要求|可见事实|表达意图|未展示因果|Omni提示词|Omni禁止项)\s*[：:]|$)/i;
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
  // Avoid overlapping repetitions that freeze on long Latin identifiers.
  if (/^[A-Z0-9_.-]+$/i.test(text)) return true;
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
    // A plain timestamped document is already the extracted voiceover format.
    // Treat every non-empty line as speech instead of sending it through the
    // storyboard/on-screen-text heuristics again; otherwise valid middle cues
    // can disappear when a saved draft is revalidated or translated.
    if (!structuredStoryboard && timeMatch && sameLine && !prefixed) {
      const directText = cleanVoiceoverLine(sameLine);
      if (directText && !looksLikeProductionInstruction(directText) && !isNonSpeechSfx(directText)) {
        segments.push({ time: currentTime || normalizeTimeLabel('', fallbackIndex), text: directText });
        fallbackIndex += 1;
      }
      continue;
    }
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


export function formatVoiceoverWithTimestamps(value: string): string {
  const parsed = parseTimestampedVoiceover(value).filter(item => !isNonSpeechSfx(item.text));
  if (parsed.length) return parsed.map(item => `${item.time} ${item.text}`).join('\n');
  if (hasStoryboardFieldLabels(String(value || '').split(/\n+/))) return '';
  const fallback = cleanVoiceoverLine(value);
  return isNonSpeechSfx(fallback) || looksLikeProductionInstruction(fallback) ? '' : fallback;
}

function voiceoverTimelineSignature(value: string): string[] {
  const directTimeline = String(value || '')
    .split(/\n+/)
    .map(line => line.match(/^\s*\[([^\]]*?\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—]\s*\d+(?:\.\d+)?\s*(?:s|秒)?[^\]]*)\]/i)?.[1] || '')
    .filter(Boolean)
    .map((time, index) => normalizeTimeLabel(time, index));
  if (directTimeline.length) return directTimeline;
  return parseTimestampedVoiceover(value)
    .filter(item => !isNonSpeechSfx(item.text))
    .map(item => item.time);
}

export function voiceoverDraftCoversSource(sourceVoiceover: string, draft: string): boolean {
  const sourceTimeline = voiceoverTimelineSignature(sourceVoiceover);
  const draftTimeline = voiceoverTimelineSignature(draft);
  if (!sourceTimeline.length) return Boolean(String(draft || '').trim());
  // A one-cue TTS response commonly comes back as plain text. It still covers
  // a one-cue source even though the provider omitted the timestamp wrapper.
  if (!draftTimeline.length) {
    return sourceTimeline.length === 1 && Boolean(formatVoiceoverWithTimestamps(draft).trim());
  }
  return draftTimeline.length === sourceTimeline.length
    && draftTimeline.every((time, index) => time === sourceTimeline[index]);
}

/**
 * A storyboard is the source of truth for which shots contain speech. Keep a
 * manually edited voice draft only when it still covers the exact storyboard
 * cue timeline; otherwise rebuild from every 台词/Voiceover field so a stale
 * two-line draft cannot hide newly added middle shots.
 */
export function selectCompleteVoiceoverSource(storyboard: string, currentVoiceover = ''): string {
  const storyboardVoiceover = formatVoiceoverWithTimestamps(storyboard);
  if (!storyboardVoiceover.trim()) return formatVoiceoverWithTimestamps(currentVoiceover);
  if (!hasStoryboardFieldLabels(String(storyboard || '').split(/\n+/))) {
    return formatVoiceoverWithTimestamps(currentVoiceover || storyboard);
  }

  const current = formatVoiceoverWithTimestamps(currentVoiceover);
  if (!current.trim()) return storyboardVoiceover;
  return voiceoverDraftCoversSource(storyboardVoiceover, current) ? current : storyboardVoiceover;
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
      // Repeated narration in different shots is intentional timeline data.
      // Only duplicate voice fields inside the same shot may be collapsed.
      lastVoiceKey = '';
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

export function normalizeTranslatedVoiceover(base: string, translated: string, target: string): string {
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
  const sourceKeys = source.map(item => compactComparable(item.text));
  const uniqueTranslatedLines = new Set(candidates.map(item => item.toLowerCase()));
  const looksRepeated = candidates.length > 1
    && new Set(sourceKeys).size > 1
    && uniqueTranslatedLines.size === 1;
  const targetSourceOwners = new Map<string, string>();
  const lines: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const item = source[index]!;
    const candidate = candidates[index] || '';
    const key = candidate.replace(/\s+/g, ' ').trim().toLowerCase();
    const sourceKey = sourceKeys[index] || `cue-${index}`;
    const existingSourceOwner = key ? targetSourceOwners.get(key) : undefined;
    // The same source sentence may legitimately repeat at another timestamp.
    // Reject only when distinct source lines collapse into one target line.
    if (key && !existingSourceOwner) targetSourceOwners.set(key, sourceKey);
    if (looksRepeated || (existingSourceOwner && existingSourceOwner !== sourceKey) || isBadTranslatedLine(candidate, target)) return '';
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
export default function AiCreateStudio({ onNavigate, onGoPublish, openProjectsSignal = 0, workflowContext, publishStorageScope, socialContentTaskId, studioCreateRequest }: { onNavigate?: (p: Page) => void; onGoPublish?: (payload: StudioPublishPayload) => void; openProjectsSignal?: number; workflowContext?: StudioWorkflowContext; publishStorageScope?: string; socialContentTaskId?: string | null; studioCreateRequest?: SocialContentCreateRequest | null } = {}) {
  const localGateBypass = contentCreationTestBypassEnabled();
  const [stepIdx, setStepIdx] = useState(0);
  const [activeStoryboardSlotId, setActiveStoryboardSlotId] = useState('');
  const [canvasView, setCanvasView] = useState<'reference' | 'creation'>('creation');
  const [referenceTimelineTime, setReferenceTimelineTime] = useState(0);
  const [referenceSeekRequest, setReferenceSeekRequest] = useState<{ seconds: number; requestId: number } | null>(null);
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
  const [referenceProductAssignments, setReferenceProductAssignments] = useState<Record<string, string>>({});
  const [referenceProductTerms, setReferenceProductTerms] = useState<Record<string, string>>({});
  const [socialTaskProductReference, setSocialTaskProductReference] = useState('');
  const [productSelectMode, setProductSelectMode] = useState<'single' | 'multi'>('multi');
  const [productSearch, setProductSearch] = useState('');
  const [productCategoryFilter, setProductCategoryFilter] = useState('');
  const [showSelectedProductsOnly, setShowSelectedProductsOnly] = useState(false);
  const [productSelectorOpen, setProductSelectorOpen] = useState(false);
  const productSelectorRef = useRef<HTMLDivElement>(null);
  const [cloneCount] = useState(1);
  const [cloneOutputMode, setCloneOutputMode] = useState<'ideas' | 'languages'>('ideas');
  const studioSettingsEditedRef = useRef(false);
  const [audience, setAudience] = useState('');
  const [primaryCta, setPrimaryCta] = useState(DEFAULT_VIDEO_CONVERSION_GOAL);
  const [productContentGoal, setProductContentGoal] = useState<'reach' | 'leads'>('leads');
  const [reachCta, setReachCta] = useState('');
  const [cooperationRoute, setCooperationRoute] = useState('');
  const [availableCooperationRoutes, setAvailableCooperationRoutes] = useState<string[]>([]);
  const [enterpriseRouteStrategies, setEnterpriseRouteStrategies] = useState<Record<string, { targetBuyerRoles?: string[]; primaryCta?: string }>>({});
  const [enterprisePrimaryCta, setEnterprisePrimaryCta] = useState('');
  const [sellingPoints, setSellingPoints] = useState('');
  const [tone, setTone] = useState('高转化 · 口语化');
  const [videoThemeId, setVideoThemeId] = useState<VideoThemeId>('buyer_pain');
  const [presenterMode, setPresenterMode] = useState<PresenterMode>('real');
  const [presentationMode, setPresentationMode] = useState<VideoCreationPlan['presenter']>('material');
  const [presentationSources, setPresentationSources] = useState<Record<string, 'avatar' | 'material'>>({});
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
  const effectiveContentGoal = mode === 'product' ? productContentGoal : 'leads';
  const effectivePrimaryCta = effectiveContentGoal === 'reach' ? reachCta.trim() : enterprisePrimaryCta.trim() || primaryCta.trim();
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
    painPoint: themePainPoint.trim() || activeVideoTheme.painPoint,
    contentGoal: effectiveContentGoal,
    conversionGoal: effectivePrimaryCta || (effectiveContentGoal === 'reach' ? '' : DEFAULT_VIDEO_CONVERSION_GOAL),
    primaryCta: effectivePrimaryCta || (effectiveContentGoal === 'reach' ? '' : DEFAULT_VIDEO_CONVERSION_GOAL),
    cooperationRoute,
    presenterMode, presentationMode,
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
  const [heygenAvatarId, setHeygenAvatarId] = useState('');
  const [heygenAvatars, setHeygenAvatars] = useState<HeyGenAvatarOption[]>([]);
  const [heygenAvatarOrientation, setHeygenAvatarOrientation] = useState<'unknown' | 'portrait' | 'landscape' | 'square'>('unknown');
  const [heygenAvatarBinding, setHeygenAvatarBinding] = useState(false);
  const [digitalHumanLoading, setDigitalHumanLoading] = useState(false);
  const shootingSlotsRef = useRef<ShootingSlot[]>([]);
  const [shootingIdentityEpoch, setShootingIdentityEpoch] = useState(0);
  const [shootingTasks, setShootingTasks] = useState<ScriptGapTask[]>([]);
  const [shootingAdoptions, setShootingAdoptions] = useState<Record<string, string>>({});
  const [shootingSlotId, setShootingSlotId] = useState('');
  const [shootingBusy, setShootingBusy] = useState(false);
  const [shootingError, setShootingError] = useState('');
  const [shotProductions, setShotProductions] = useState<Record<string, ShotProduction>>({});
  const [productionDefaults, setProductionDefaults] = useState<ProductionDefaults>(EMPTY_DEFAULTS);
  const [appearancePreference, setAppearancePreference] = useState<AppearancePreference | ''>('');
  const [productionEditorId, setProductionEditorId] = useState('');
  const [productionJobs, setProductionJobs] = useState<AvatarJob[]>([]);
  const [productionPlans, setProductionPlans] = useState<DigitalHumanPlanRecord[]>([]);
  const [productionExecutions, setProductionExecutions] = useState<DigitalHumanExecutionRecord[]>([]);
  const [serverShotRoutes, setServerShotRoutes] = useState<{ projectId: string; routes: Record<string, 'presenter' | 'motion' | 'material'> }>({ projectId: '', routes: {} });
  const [productionSentenceResults, setProductionSentenceResults] = useState<Record<string, import('../lib/digitalHumanPlan').SentenceReplicationResult>>({});
  const [socialDigitalHumanPlans, setSocialDigitalHumanPlans] = useState<StudioSocialTaskSeed['digitalHumanShotPlans']>([]);
  const productionRefreshInFlight = useRef(new Set<string>());
  const [productionRefreshingIds, setProductionRefreshingIds] = useState<string[]>([]);
  const [renderProductionSignatures, setRenderProductionSignatures] = useState<Record<string, string>>({});
  const [productionBusy, setProductionBusy] = useState(false);
  const [batchShotBusy, setBatchShotBusy] = useState(false);
  const [batchShotSummary, setBatchShotSummary] = useState<{ submitted: number; matched: number; needsMaterial: number; blocked: number } | null>(null);
  const [batchShotResults, setBatchShotResults] = useState<Array<{ shotId: string; slotId: string; state: 'submitted' | 'matched' | 'needs_material' | 'blocked'; jobId?: string; reason: string }>>([]);
  const batchShotRequestRef = useRef<{ signature: string; batchId: string } | null>(null);
  const productionRequestIds = useRef(new Map<string, string>());
  const projectRevisionRef = useRef<unknown>(undefined);
  const [productionError, setProductionError] = useState('');
  const [productionCapability, setProductionCapability] = useState({ configured: false, reason: '正在读取数字人配置', costPerSecond: null as number | null, referenceBudgetLimitCny: null as number | null, maxAttemptsPerShot: 3,
    tools: [] as Array<{ id: string; label: string; methods: string[]; planning: boolean; execution: boolean; qualityInspection: boolean; cancellation: boolean; costReconciliation: boolean; reason: string; executionProfile?: { maxDurationSeconds?: number; preserves: string[]; qualityInspection: boolean; estimatedCostCnyPerSecond?: number } }> });
  const [digitalHumanNotice, setDigitalHumanNotice] = useState('');
  const [digitalHumanMode, setDigitalHumanMode] = useState<'fast' | 'quality'>('quality');
  const [digitalHumanConsent, setDigitalHumanConsent] = useState(false);
  const [digitalHumanCapabilities, setDigitalHumanCapabilities] = useState<DigitalHumanCapabilities | null>(null);
  const [digitalHumanJob, setDigitalHumanJob] = useState<DigitalHumanJob | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [script, setScript] = useState('');
  const [scriptType, setScriptType] = useState<'voiceover' | 'storyboard'>('voiceover');
  const [voice, setVoice] = useState('v1');
  const [voiceCandidates, setVoiceCandidates] = useState<string[]>(['v1']);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [voiceoverLines, setVoiceoverLines] = useState('');
  const [voiceLangs, setVoiceLangs] = useState<string[]>([]);
  const [enterpriseVoiceLangs, setEnterpriseVoiceLangs] = useState<string[]>([]);
  const [activeVoiceLang, setActiveVoiceLang] = useState('zh');
  const enterpriseScriptLanguage = voiceLangs[0] || enterpriseVoiceLangs[0] || '';
  const [voiceDrafts, setVoiceDrafts] = useState<Record<string, string>>({});
  const [voiceDraftStaleLangs, setVoiceDraftStaleLangs] = useState<string[]>([]);
  const [voiceDraftPendingLangs, setVoiceDraftPendingLangs] = useState<string[]>([]);
  const [voiceDraftFailedLangs, setVoiceDraftFailedLangs] = useState<string[]>([]);
  const [voiceDraftLoading, setVoiceDraftLoading] = useState(false);
  const voiceDraftRunRef = useRef(0);
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
  const [effectPreset, setEffectPreset] = useState<EffectPresetId>('natural');
  const [effectIntensity, setEffectIntensity] = useState<EffectIntensity>(0);
  const [disabledEffectSceneIds, setDisabledEffectSceneIds] = useState<string[]>([]);
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
  const [coverTitle, setCoverTitle] = useState('');
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

  const [account, setAccount] = useState<string | null>('a1');
  const [caption, setCaption] = useState('');
  const [captionLoading, setCaptionLoading] = useState(false);
  const [published, setPublished] = useState(false);
  const [demoAutoLoading, setDemoAutoLoading] = useState(false);
  const [savedToWorks, setSavedToWorks] = useState(false); // 「存入我的作品」反馈
  const [modeActionLoading, setModeActionLoading] = useState(false);
  const productScriptAbortRef = useRef<AbortController | null>(null);
  const [modeActionStatus, setModeActionStatus] = useState('');
  const [materialSelectLoading, setMaterialSelectLoading] = useState(false);
  const [modeNotice, setModeNotice] = useState('');
  const [evidenceGaps, setEvidenceGaps] = useState<Array<{ shotId: string; slotId: string; index: number; code: string; message: string; canShoot: boolean }> | null>(null);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [modeScripts, setModeScripts] = useState<ModeScriptOutput[]>([]);
  const [activeModeScriptId, setActiveModeScriptId] = useState('');
  const [pendingRealCloneGeneration, setPendingRealCloneGeneration] = useState(false);
  const [posterLoading, setPosterLoading] = useState(false);
  const [posterDraft, setPosterDraft] = useState<FbPosterResult | null>(null);
  const [leadContentPackage, setLeadContentPackage] = useState<LeadContentPackageResult | null>(null);
  const [posterJsonText, setPosterJsonText] = useState('');
  const [posterImageUrl, setPosterImageUrl] = useState('');
  const posterGenerationIsVerified = Boolean(
    posterDraft?.ok
    && posterDraft.source === 'ai'
    && posterDraft.provenance === 'ai'
    && posterDraft.qualityStatus === 'passed'
    && posterDraft.publishable === true
    && !posterDraft.fieldsToConfirm?.length,
  );
  const markPosterJsonAsManualDraft = (value: string) => {
    setPosterJsonText(value);
    setPosterImageUrl('');
    setLeadContentPackage(null);
    setPosterDraft(current => ({
      ...(current || {
        caption: '', hashtags: [], commentCta: '', dmOpening: '', imagePrompt: '',
      }),
      ok: false,
      source: undefined,
      provenance: 'manual_draft',
      qualityStatus: 'unreviewed',
      publishable: false,
      fieldsToConfirm: [...new Set([...(current?.fieldsToConfirm || []), '手动修改后的图文内容'])],
    }));
    setModeNotice('图文 JSON 已手动修改，原图片已失效。当前内容仅为待复核草稿，需按企业中心资料重新生成并通过校验后才能提交。');
  };

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
          const preserved = current.filter(item => item.id === 'kickoff-product' || item.id.startsWith('social-task-product:'));
          const seen = new Set(preserved.map(item => item.id));
          return [...preserved, ...options.filter(item => !seen.has(item.id))];
        });
        if (options[0] && !socialContentTaskId) setSelectedProductIds(current => current.length ? current : [options[0]!.id]);
        const configuredVoiceLanguages = enterpriseLanguageCodes(
          profile.brand?.preferredLanguages || profile.company?.primaryLanguages || '',
        );
        const defaultVoiceLanguage = configuredVoiceLanguages.includes('en')
          ? 'en'
          : configuredVoiceLanguages[0];
        setEnterpriseVoiceLangs(configuredVoiceLanguages);
        setVoiceLangs(current => current.length ? current : [defaultVoiceLanguage || 'zh']);
        if (defaultVoiceLanguage && !studioSettingsEditedRef.current) {
          setLang(current => configuredVoiceLanguages.includes(current) ? current : defaultVoiceLanguage);
          setActiveVoiceLang(current => configuredVoiceLanguages.includes(current) ? current : defaultVoiceLanguage);
        }
        if (!socialContentTaskId) setProductInfo(prev => prev || options[0]?.info || [
          profile.strategy?.focusProducts || profile.products?.categories,
          profile.products?.priceRange,
          profile.products?.moq,
        ].filter(Boolean).join('；'));
        const inheritedRoute = profile.socialStrategy?.enabledRoutes?.[0] || '';
        const inheritedStrategy = profile.socialStrategy?.routeStrategies?.[inheritedRoute];
        if (!studioSettingsEditedRef.current) setAudience(enterpriseBuyerText(inheritedStrategy?.targetBuyerRoles));
        const inheritedCta = profile.socialStrategy?.routeStrategies?.[inheritedRoute]?.primaryCta;
        setCooperationRoute(current => current || inheritedRoute);
        setAvailableCooperationRoutes(profile.socialStrategy?.enabledRoutes || []);
        setEnterpriseRouteStrategies(profile.socialStrategy?.routeStrategies || {});
        setEnterprisePrimaryCta(inheritedCta || '');
        if (!studioSettingsEditedRef.current) setPrimaryCta(inheritedCta || '');
        setSellingPoints(prev => prev || [
          profile.brand?.usp,
          profile.products?.highlights,
        ].filter(Boolean).join('；'));
        setTone(prev => prev || profile.brand?.tone || '高转化 · 口语化');
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [socialContentTaskId]);

  useEffect(() => {
    if (!socialContentTaskId || !socialTaskProductReference || productOptions.length === 0 || selectedProductIds.length > 0) return;
    const requested = compactComparable(socialTaskProductReference);
    const matched = productOptions.find(option => {
      const label = compactComparable(option.label);
      return label === requested || (requested.length >= 4 && (label.includes(requested) || requested.includes(label)));
    });
    if (!matched) {
      setModeNotice(`任务中的产品“${socialTaskProductReference}”尚未匹配企业知识库产品；请先返回任务核对产品信息。`);
      return;
    }
    setSelectedProductIds([matched.id]);
  }, [productOptions, selectedProductIds.length, socialContentTaskId, socialTaskProductReference]);

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
  const [previewPreparing, setPreviewPreparing] = useState(false);
  const [previewPlaybackError, setPreviewPlaybackError] = useState('');
  const [previewVoicePlayableUrl, setPreviewVoicePlayableUrl] = useState('');
  const [previewVoiceLoading, setPreviewVoiceLoading] = useState(false);
  const [previewOriginalOn, setPreviewOriginalOn] = useState(false);
  const [previewVoiceOn, setPreviewVoiceOn] = useState(true);
  const [previewBgmOn, setPreviewBgmOn] = useState(true);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const workbenchVideoRef = useRef<HTMLVideoElement | null>(null);
  const [workbenchTimelineTime, setWorkbenchTimelineTime] = useState(0);
  const [workbenchPlaying, setWorkbenchPlaying] = useState(false);
  const [workbenchSourceAudioOn, setWorkbenchSourceAudioOn] = useState(false);
  const [workbenchPlaybackError, setWorkbenchPlaybackError] = useState('');
  const workbenchImageTimerRef = useRef<number | null>(null);
  const workbenchLoopOffsetRef = useRef(0);
  const workbenchAdvanceLockRef = useRef(false);
  const previewVideoCacheRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const previewAdvanceTimerRef = useRef<number | null>(null);
  const previewAdvanceLockRef = useRef(false);
  const previewStartRequestRef = useRef(0);

  // 字幕（A 层：脚本兜底对齐 + 沿用封面样式；桌面端 ffmpeg 烧录）
  const [subtitlesOn, setSubtitlesOn] = useState(true);
  const [subMode, setSubMode] = useState<'target' | 'bilingual'>('target');
  const [subPreviewIdx, setSubPreviewIdx] = useState(0); // 预览叠层当前展示的 cue
  const [cueZh, setCueZh] = useState<string[]>([]);       // 双语字幕的中文译文（与 cues 对齐）
  const [previewTime, setPreviewTime] = useState(0);
  const [clipEdits, setClipEdits] = useState<Record<string, ClipEdit>>({});

  // 草稿 / 作品
  const [projectId, setProjectId] = useState<string | null>(null);
  const [socialTaskProjectLookupDone, setSocialTaskProjectLookupDone] = useState(() => !socialContentTaskId);
  const currentProjectRef = useRef(projectId); currentProjectRef.current = projectId;
  const managedProductionProjectRef = useRef(false);
  const agentProduction = useAgentProductionAction('studio');
  const [projectWorkflowContext, setProjectWorkflowContext] = useState<StudioWorkflowContext | null>(workflowContext || null);
  const generationSessionId = useRef(`session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [storyboardVideoVersions, setStoryboardVideoVersions] = useState<Record<string, VideoGenerationVersion[]>>({});
  const [productVideoVersions, setProductVideoVersions] = useState<VideoGenerationVersion[]>([]);
  const [referenceRecoveryMessage, setReferenceRecoveryMessage] = useState('');
  const [referenceNeedsDirectorReview, setReferenceNeedsDirectorReview] = useState(false);
  const [retryingReference, setRetryingReference] = useState(false);
  const [refreshingReferenceShots, setRefreshingReferenceShots] = useState(false);
  const refreshReferenceShots = async () => {
    const recordId = videoKickoff?.video?.referenceRecordId;
    if (!socialContentTaskId || !recordId || refreshingReferenceShots) return;
    setRefreshingReferenceShots(true);
    setReferenceRecoveryMessage('正在重新分析原片产品短分镜…');
    try {
      const response = await fetch(`/api/overseas/videos/${encodeURIComponent(recordId)}/reanalyze`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ analysisMode: 'exact', force: true }),
      });
      const started = await response.json() as { status?: string; analysisRunId?: string; error?: string };
      if (!response.ok || started.status !== 'pending' || !started.analysisRunId) throw new Error(started.error || '原片分析未启动');
      let complete = false;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await sleep(3000);
        const progress = await fetch(`/api/overseas/videos/${encodeURIComponent(recordId)}`, { headers: authHeader() });
        if (!progress.ok) throw new Error('无法读取原片分析进度');
        const record = await progress.json() as { status?: string; aiAnalysis?: string };
        const analysis = typeof record.aiAnalysis === 'string' ? JSON.parse(record.aiAnalysis) as { analysisRunId?: string; analysisError?: string; analysisMode?: string; geminiStatus?: string } : {};
        if (analysis.analysisRunId !== started.analysisRunId) throw new Error('有更新的分析任务已启动，请刷新页面');
        if (record.status !== 'pending' && (analysis.analysisError || analysis.geminiStatus === 'analysis_retryable')) throw new Error(analysis.analysisError || '原片分析未通过，请重试');
        if (record.status === 'analyzed' && analysis.analysisMode === 'exact' && ['analyzed', 'needs_review'].includes(analysis.geminiStatus || '')) { complete = true; break; }
      }
      if (!complete) throw new Error('原片仍在分析中，请稍后重新打开任务');
      const task = await socialContentApi.getTask(socialContentTaskId);
      const refreshed = await socialContentApi.refreshReference(task.taskId, task.version);
      const kickoff = socialTaskReferenceKickoff(refreshed);
      if (!kickoff?.referenceAnalysis?.details?.length) throw new Error('分析已完成，但编导交接物尚未就绪');
      setVideoKickoff(kickoff);
      setReferenceRecoveryMessage(`产品分镜已重新提取：当前 ${kickoff.referenceAnalysis.details.length} 镜。`);
    } catch (error) { setReferenceRecoveryMessage(error instanceof Error ? error.message : '重新分析失败'); }
    finally { setRefreshingReferenceShots(false); }
  };
  const retryReference = async () => {
    if (!socialContentTaskId || retryingReference) return;
    setRetryingReference(true);
    try {
      const task = await socialContentApi.getTask(socialContentTaskId);
      await socialContentApi.startTask(task.taskId, task.version);
      setReferenceRecoveryMessage('已重新检查参考分析，请等待状态更新。');
    } catch (error) { setReferenceRecoveryMessage(error instanceof Error ? error.message : '参考分析重试失败'); }
    finally { setRetryingReference(false); }
  };
  const [projectTitle, setProjectTitle] = useState('未命名草稿');
  const [socialShotMaterialBindings, setSocialShotMaterialBindings] = useState<StudioSocialShotMaterialBinding[]>([]);
  const rememberSocialShotMaterialBindings = (bindings: StudioSocialShotMaterialBinding[]) => {
    setSocialShotMaterialBindings(current => JSON.stringify(current) === JSON.stringify(bindings) ? current : bindings);
  };
  useStudioSocialTaskHydration({
    taskId: socialTaskProjectLookupDone ? socialContentTaskId : null,
    // A saved workbench shell can predate the task's reference analysis. Rehydrate
    // that empty shell from the authoritative task instead of trapping the user
    // in a manual draft with no reference or enabled script action.
    canApply: () => (!projectId && !autoGen.current && !studioSettingsEditedRef.current)
      || Boolean(projectId && socialContentTaskId && !videoKickoff && !hasTimestampScript),
    onRefresh: task => {
      rememberSocialShotMaterialBindings(socialTaskShotMaterialBindings(task));
      const reference = socialTaskReferenceKickoff(task);
      if (reference) setVideoKickoff(reference);
      const failure = task.referencePreparation;
      const needsReview = failure?.status === 'review_required' && failure.reason === 'director_review_pending';
      setReferenceNeedsDirectorReview(needsReview);
      setReferenceRecoveryMessage(needsReview ? '参考视频的全片分析已完成，正在等待编导复核逐镜与逐句证据。请到灵感中心打开原片的编导分析，完成复核后再生成脚本。' : failure?.status === 'blocked' ? (failure.reason === 'reference_provider_quota'
        ? '参考视频下载失败：采集服务额度已耗尽，备用下载也未成功。恢复下载服务后可重试，或返回灵感中心更换参考视频。'
        : '参考视频暂不可分析，请检查原视频与下载服务后重试，或返回灵感中心更换参考视频。') : '');
      if (reference?.referenceAnalysis || failure?.status === 'blocked' || needsReview) setModeNotice('');
    },
    onHydrate: seed => {
      studioSettingsEditedRef.current = true;
      autoGen.current = true;
      setSocialTaskProductReference(seed.productReference);
      rememberSocialShotMaterialBindings(seed.shotMaterialBindings);
      if (seed.reference) {
        setVideoKickoff(seed.reference); setCanvasView('creation');
        setScriptView('timestamp'); setStepIdx(0);
        if (seed.reference.video?.duration) setDuration(seed.reference.video.duration);
        setModeNotice(seed.reference.referenceAnalysis ? '已载入当前复刻任务的参考分析。' : '参考视频尚未完成分析；工作台已打开，分析完成后可继续脚本与口播制作。');
      }
      setProjectTitle(seed.projectTitle); setContentMode(seed.contentMode); setMode(seed.creationMode);
      if (seed.creationMode === 'clone') setProductSelectMode('multi');
      setPlatform(seed.platform); setRatio(seed.aspectRatio); setLang(seed.languageCodes[0]!);
      setVoiceLangs(seed.languageCodes); setActiveVoiceLang(seed.languageCodes[0]!);
      setAudience(seed.audience); setPrimaryCta(seed.primaryCta);
      if (seed.contentTheme) {
        const hydratedTheme = VIDEO_THEMES.find(item => item.id === seed.contentTheme);
        if (hydratedTheme) {
          setVideoThemeId(hydratedTheme.id);
          setThemePainPoint(seed.themeTopic || hydratedTheme.painPoint);
          setThemeConversionGoal(DEFAULT_VIDEO_CONVERSION_GOAL);
        }
      }
      if (seed.selectedMaterialIds.length) setSelected(seed.selectedMaterialIds);
      setSocialDigitalHumanPlans(seed.digitalHumanShotPlans);
      const hydrationNotices = [
        seed.factVerificationNotice,
        seed.unsupportedLanguages.length ? `本次任务中的${seed.unsupportedLanguages.join('、')}暂不在创作语言列表中，请先选择可用语言。` : '',
      ].filter(Boolean);
      if (hydrationNotices.length) setModeNotice(hydrationNotices.join(' '));
    },
  });
  const [showProjects, setShowProjects] = useState(false);
  const [workflowProjectSelectionPending, setWorkflowProjectSelectionPending] = useState(
    () => ['content_production', 'content_quality_gate'].includes(workflowContext?.taskKey || ''),
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
  const appliedCreateRequestRef = useRef<number | null>(null);
  useEffect(() => {
    if (!studioCreateRequest || socialContentTaskId || appliedCreateRequestRef.current === studioCreateRequest.requestId) return;
    appliedCreateRequestRef.current = studioCreateRequest.requestId;
    const prefill = studioCreateRequest.prefill;
    setProjectId(null);
    setStepIdx(0);
    setMode(studioCreateRequest.creationPath === 'viral_replication' ? 'clone' : 'material');
    if (prefill?.title?.trim()) setProjectTitle(prefill.title.trim());
    if (prefill?.productName?.trim()) setProductInfo(prefill.productName.trim());
    if (prefill?.platforms?.[0]) setPlatform(prefill.platforms[0]);
    setCanvasView('creation');
  }, [socialContentTaskId, studioCreateRequest]);
  const [sourceDraftCheckPending, setSourceDraftCheckPending] = useState(true);
  const [existingSourceDraftPrompt, setExistingSourceDraftPrompt] = useState<ExistingSourceDraftPrompt | null>(null);
  const existingSourceDraftDialogRef = useModalFocus<HTMLDivElement>({
    open: Boolean(existingSourceDraftPrompt),
    onClose: () => undefined,
    closeOnEscape: false,
  });
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
    if (['content_production', 'content_quality_gate'].includes(workflowContext.taskKey || '')) {
      setProjects([]);
      setShowProjects(true);
      setWorkflowProjectSelectionPending(true);
    }
  }, [workflowContext]);

  useEffect(() => {
    if (showProjects) {
      projectsPanelWasOpenRef.current = true;
      const frame = requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('lingshu:content-view-changed', { detail: { entry: 'works' } })));
      return () => cancelAnimationFrame(frame);
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
  const removeSelectedVisualClip = (clipId: string) => {
    const remaining = selectedVisualClips.filter(item => item.id !== clipId);
    setSelected(current => current.filter(id => id !== clipId));
    if (hookMaterialId === clipId) setHookMaterialId(remaining[0]?.id || '');
  };
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
    const audio = voiceoverAudios[activeVoiceLang];
    const measured = productionVoiceCues(audio?.cues, audio?.alignmentSource, audio?.duration || 0);
    const seen = new Set<string>();
    const sourceLines = (videoKickoff?.referenceAnalysis?.details || []).flatMap((shot, shotIndex) =>
      (shot.speechLines || []).flatMap((line, lineIndex) => {
        const owner = shot.shotId || `shot-${shotIndex + 1}`;
        if (line.narrationOwnerShotId && line.narrationOwnerShotId !== owner) return [];
        const id = line.lineId || `${owner}:${lineIndex}`;
        if (seen.has(id)) return [];
        seen.add(id);
        return [{ start: Number(line.sourceStartSeconds), end: Number(line.sourceEndSeconds), text: line.referenceText }];
      }));
    const retimed = voiceoverMode === 'ai' && measured.length
      ? retimeVisualShotsToVoiceover(parsed, sourceLines, measured, activeAudioDuration)
      : null;
    if (retimed) return parsed.map((slot, index) => ({ ...slot, ...retimed[index],
      time: `${retimed[index].start.toFixed(1)}s-${retimed[index].end.toFixed(1)}s` }));
    return fitStoryboardSlotsToDuration(parsed, activeAudioDuration);
  }, [activeVoiceLang, duration, script, videoKickoff, voiceoverAudios, voiceoverDur, voiceoverMode]);
  useEffect(() => {
    if (!socialShotMaterialBindings.length || !storyboardSlots.length) return;
    const materialIds = socialShotMaterialBindings.map(item => item.materialId);
    setSelected(current => [...new Set([...current, ...materialIds])]);
    setStoryboardAssignments(current => {
      let changed = false;
      const next = { ...current };
      socialShotMaterialBindings.forEach(({ shotIndex, materialId }) => {
        const slot = storyboardSlots[shotIndex];
        if (!slot || next[slot.id]) return;
        next[slot.id] = materialId;
        changed = true;
      });
      return changed ? next : current;
    });
  }, [socialShotMaterialBindings, storyboardSlots]);
  const personContinuityBySlot = useMemo(() => {
    const details = videoKickoff?.referenceAnalysis?.details || [];
    return Object.fromEntries(storyboardSlots.flatMap(slot => {
      const reference = details.map(detail => {
        const range = parseCueRange(detail.time);
        return { detail, overlap: range ? Math.max(0, Math.min(slot.end, range.end) - Math.max(slot.start, range.start)) : 0 };
      }).sort((a, b) => b.overlap - a.overlap)[0];
      const id = reference?.overlap && reference.detail.personContinuityId?.trim();
      return id ? [[slot.id, id]] : [];
    })) as Record<string, string>;
  }, [storyboardSlots, videoKickoff]);
  const shootingSlots = useMemo(() => {
    const slots = reconcileShootingSlots(shootingSlotsRef.current, storyboardSlots,
      slotId => JSON.stringify({ lang: activeVoiceLang || lang, ratio, productInfo, selectedProductIds,
        sound: shotProductions[`${activeAssemblyId}:${shootingSlotsRef.current.find(item => item.slotId === slotId)?.id}`]?.sound || 'voiceover' }), () => crypto.randomUUID());
    shootingSlotsRef.current = slots;
    return slots;
  }, [storyboardSlots, activeVoiceLang, lang, ratio, productInfo, selectedProductIds, shootingIdentityEpoch, shotProductions, activeAssemblyId]);
  const productionAudioUrl = (voiceoverMode === 'ai' ? voiceoverAudios[activeVoiceLang]?.url : voiceoverUrl) || '';
  const asrContextRef = useRef('');
  asrContextRef.current = JSON.stringify([projectId, productionAudioUrl, activeVoiceLang, voiceDrafts[activeVoiceLang], script]);
  const productionAlignment = productionVoiceCues(
    alignedCuesByLang[activeVoiceLang] || voiceoverAudios[activeVoiceLang]?.cues,
    voiceoverAudios[activeVoiceLang]?.alignmentSource,
    voiceoverAudios[activeVoiceLang]?.duration || 0,
  );
  const productionShotWindows = matchVoiceCuesToShots(storyboardSlots, productionAlignment, voiceoverAudios[activeVoiceLang]?.duration || 0);
  const shotProductionContext = JSON.stringify({
    language: activeVoiceLang || lang, ratio, productInfo,
    audioIdentity: productionAudioUrl ? new URL(productionAudioUrl, 'http://local').pathname : '',
    audioDuration: voiceoverMode === 'ai' ? voiceoverAudios[activeVoiceLang]?.duration || 0 : voiceoverDur,
    voiceProfile: voiceoverMode === 'upload'
      ? { mode: 'upload', identity: productionAudioUrl ? new URL(productionAudioUrl, 'http://local').pathname : '' }
      : { mode: voiceoverMode, voiceId: activeTtsSettings.voiceId || voice, preset: ttsPreset, emotion: ttsEmotion, emotionIntensity: ttsEmotionIntensity, speed: ttsSpeed, pauseStyle: ttsPauseStyle, pronunciation: ttsPronunciationText },
    audioSegments: shootingSlots.map(item => {
      const storyboard = storyboardSlots.find(slot => slot.id === item.slotId);
      const window = storyboard ? productionShotWindows[storyboardSlots.indexOf(storyboard)] : undefined;
      return { id: item.id, duration: window ? window.end - window.start : item.duration, cues: window
        ? window.cues.map(cue => ({ text: cue.text, start: Math.max(0, cue.start - window.start), end: Math.min(window.end, cue.end) - window.start })) : [] };
    }),
    alignment: productionAlignment,
    alignmentSource: voiceoverAudios[activeVoiceLang]?.alignmentSource,
  });
  const productionSignature = JSON.stringify({ renderPolicyVersion: 'avatar-cover-v2-effects-v1', script, ratio, assignments: storyboardAssignments, clipEdits, bgm, bgmVol, voiceVol, effectPreset, effectIntensity, disabledEffectSceneIds, subtitlesOn, subMode, audio: productionAudioUrl ? new URL(productionAudioUrl, 'http://local').pathname : '', alignment: alignedCuesByLang, alignmentSources: Object.fromEntries(Object.entries(voiceoverAudios).map(([code, audio]) => [code, audio.alignmentSource])), shots: Object.fromEntries(Object.entries(shotProductions).map(([key, value]) => { const { candidates, revision, locked, ...output } = value; return [key, output]; })) });
  const productionKey = (slotId: string, assembly = activeAssemblyId) => `${assembly}:${shootingSlots.find(item => item.slotId === slotId)?.id || slotId}`;
  const newProductionFor = (slot: StoryboardSlot): ShotProduction => {
    const salesPresenterId = mode === 'clone'
      ? productionDefaults.presenters.find(item => item.authorized && item.name.trim() === '销售')?.id
      : undefined;
    const shot = newShotProduction(storyboardSlotScript(slot.detail).voice, salesPresenterId || productionDefaults.defaultPresenterId, productionDefaults);
    const requirements = newDigitalHumanRequirements();
    const agentPlan = socialDigitalHumanPlans.find(item => item.shotId === slot.id)
      ?? socialDigitalHumanPlans.find(item => item.shotIndex === storyboardSlots.findIndex(candidate => candidate.id === slot.id));
    if (agentPlan) {
      shot.source = 'avatar';
      shot.sound = 'source';
      shot.presenterId = agentPlan.presenterAssetIds.find(id => productionDefaults.presenters.some(item => item.id === id))
        || salesPresenterId || productionDefaults.defaultPresenterId;
      requirements.workflow = agentPlan.workflow;
      requirements.method = agentPlan.method;
      requirements.action = agentPlan.requestedDescription;
      requirements.scene = agentPlan.requestedDescription;
      requirements.preserve = agentPlan.workflow === 'viral_replication'
        ? '参考视频的信息作用与语句节奏、企业人物身份、已确认产品事实'
        : '';
      const referenceMaterialId = agentPlan.referenceMaterialIds[0];
      if (agentPlan.referenceRequired && referenceMaterialId) {
        const referenceMaterial = materials.find(item => item.id === referenceMaterialId && item.type === 'video');
        requirements.reference = {
          materialId: referenceMaterialId,
          videoUrl: referenceMaterial?.url || '',
          start: 0,
          end: 0,
          originalText: '',
          derivativeAuthorized: false,
          cues: [],
        };
      }
    }
    if (mode === 'clone' && videoKickoff?.referenceAnalysis?.details?.length) {
      const matching = videoKickoff.referenceAnalysis.details.filter(item => {
        const range = parseCueRange(item.time);
        return range && range.start < slot.end && range.end > slot.start;
      });
      const ranges = matching.map(item => parseCueRange(item.time)!);
      requirements.workflow = 'viral_replication';
      requirements.method = videoKickoff.source === 'inspiration_person_replace' ? 'replace' : 'reenact';
      requirements.action = matching.map(item => item.visual).filter(Boolean).join('\n');
      requirements.scene = matching.map(item => item.environment).filter(Boolean).join('\n');
      requirements.preserve = '原片对应语句与表达节奏、目标人物身份、产品事实';
      requirements.reference = {
        videoUrl: videoKickoff.video?.aiAnalysis?.materialUrl || videoKickoff.video?.videoUrl || '',
        start: ranges.length ? Math.min(...ranges.map(item => item.start)) : slot.start,
        end: ranges.length ? Math.max(...ranges.map(item => item.end)) : slot.end,
        originalText: matching.map(item => item.dialogue).filter(Boolean).join('\n'),
        derivativeAuthorized: false,
        cues: matching.map((item, index) => {
          const range = parseCueRange(item.time)!;
          const personShot=inferPersonShot(`${item.visual || ''} ${item.environment || ''}`);
          return { id: `${slot.id}:reference:${index}:${range.start}-${range.end}`, start: range.start, end: range.end,
            originalText: item.dialogue || '', targetText: '', shotIds: storyboardSlots.filter(candidate => range.start < candidate.end && range.end > candidate.start).map(candidate => candidate.id),
            ...(personShot===undefined?{}:{personShot,classificationSource:'analysis' as const}),
            ...(personShot===true?{compositionClusterId:`${item.visual || '人物'}|${item.environment || '场景'}`.slice(0,160)}:{}) };
        }).filter(cue => cue.originalText.trim()),
      };
    }
    return { ...shot, digitalHuman: requirements };
  };
  const productionFor = (slot: StoryboardSlot) => shotProductions[productionKey(slot.id)] || newProductionFor(slot);
  const productionFingerprint = (slot: StoryboardSlot, shot = productionFor(slot)) => shotFingerprint(
    shot,
    shotProductionContext,
    shootingSlots.find(item => item.slotId === slot.id)?.id || slot.id,
  );
  useEffect(() => {
    if (!socialDigitalHumanPlans.length || !storyboardSlots.length) return;
    setShotProductions(current => {
      let next = current;
      for (const plan of socialDigitalHumanPlans) {
        const slot = storyboardSlots.find(item => item.id === plan.shotId) || storyboardSlots[plan.shotIndex];
        if (!slot) continue;
        const key = productionKey(slot.id);
        if (!next[key]) next = { ...next, [key]: newProductionFor(slot) };
      }
      return next;
    });
  }, [activeAssemblyId, socialDigitalHumanPlans, storyboardSlots, shootingSlots]);
  const openProduction = (slot: StoryboardSlot) => {
    const key = productionKey(slot.id);
    const scriptNarration = storyboardSlotScript(slot.detail).voice;
    setShotProductions(current => {
      const existing = current[key];
      if (!existing) return { ...current, [key]: newProductionFor(slot) };
      if (!scriptNarration || existing.narration === scriptNarration) return current;
      return { ...current, [key]: patchShot(existing, { narration: scriptNarration }) };
    });
    setProductionError(''); setProductionEditorId(slot.id); setActiveStoryboardSlotId(slot.id);
  };
  const bindHeygenAvatarToShot = async (slot: StoryboardSlot) => {
    if (heygenAvatarBinding) return;
    if (productionFor(slot).locked) { setModeNotice('镜头已锁定，请先解锁'); return; }
    const avatar = heygenAvatars.find(item => item.id === heygenAvatarId);
    if (!avatar) { setDigitalHumanNotice('请选择一个 HeyGen 数字人资产。'); return; }
    if (!avatar.defaultVoiceId) { setDigitalHumanNotice('该 HeyGen 资产没有默认声音，请先在 HeyGen 中绑定声音后刷新。'); return; }
    if (!digitalHumanConsent) { setDigitalHumanNotice('请先确认人物、声音和商业使用授权。'); return; }
    if (ratio === '9:16' && heygenAvatarOrientation !== 'portrait') {
      setDigitalHumanNotice('当前为竖屏成片，请先确认该数字人资产的原生画幅为竖屏，避免付费生成后出现大面积留白。'); return;
    }
    setHeygenAvatarBinding(true); setDigitalHumanNotice('');
    try {
      const existing = productionDefaults.presenters.find(item => (item.toolMappings?.heygen?.avatarId || item.avatarId) === avatar.id);
      const presenterId = existing?.id || crypto.randomUUID();
      const now = new Date().toISOString();
      const presenter: import('../lib/shotProduction').PresenterAsset = {
        ...(existing || {}),
        id: presenterId,
        name: avatar.name,
        avatarId: avatar.id,
        voiceId: avatar.defaultVoiceId,
        authorized: true,
        supportsAlpha: existing?.supportsAlpha === true,
        nativeOrientation: heygenAvatarOrientation,
        commercialRightsStatus: 'cleared',
        rightsEvidence: existing?.rightsEvidence || {
          authorizationRef: `rights://heygen-account-asset/${encodeURIComponent(avatar.id)}`,
          consentRef: `consent://studio-operator-confirmation/${encodeURIComponent(now)}`,
          grantedAt: now,
          subjectAdultConfirmed: true,
          permittedProviders: ['heygen'],
          permittedUses: ['digital_presenter', 'voice_synthesis'],
          providerScopes: [{ provider: 'heygen', uses: ['digital_presenter', 'voice_synthesis'] }],
        },
        toolMappings: { ...(existing?.toolMappings || {}), heygen: { avatarId: avatar.id, voiceId: avatar.defaultVoiceId } },
      };
      const presenters = existing
        ? productionDefaults.presenters.map(item => item.id === existing.id ? presenter : item)
        : [...productionDefaults.presenters, presenter];
      const saved = await productionApi.saveDefaults({
        ...productionDefaults,
        preference: 'avatar',
        presenters,
        defaultPresenterId: productionDefaults.defaultPresenterId || presenterId,
      });
      const savedPresenter = saved.presenters.find(item => item.id === presenterId);
      if (!savedPresenter) throw new Error('数字人资产保存后未能回填，请刷新后重试');
      setProductionDefaults(saved); setAppearancePreference('avatar');
      const key = productionKey(slot.id);
      setShotProductions(current => ({
        ...current,
        [key]: patchShot(current[key] || productionFor(slot), {
          source: 'avatar',
          contentType: 'enterprise_presenter',
          presenterId: savedPresenter.id,
          sound: 'source',
        }),
      }));
      setDigitalHumanNotice(`已将“${savedPresenter.name}”绑定到当前分镜；保存制作方案后即可生成。`);
    } catch (error) {
      setDigitalHumanNotice(error instanceof Error ? error.message : '数字人资产绑定失败');
    } finally {
      setHeygenAvatarBinding(false);
    }
  };
  useEffect(() => {
    let live = true;
    void Promise.all([productionApi.defaults(), productionApi.capabilities(), studioApi.digitalHumanAvatars(), studioApi.digitalHumanCapabilities()]).then(([defaults, capability, avatars, digitalCapability]) => {
      if (!live) return;
      setProductionDefaults(defaults); setProductionCapability(capability); setHeygenAvatars(avatars.items); setDigitalHumanCapabilities(digitalCapability);
      setHeygenAvatarId(current => current || avatars.items.find(item => item.ownership === 'private')?.id || '');
    }).catch(error => { if (live) setProductionError(String(error)); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!projectId) { setProductionJobs([]); setProductionPlans([]); setProductionExecutions([]); return; }
    let live = true;
    const refresh = () => void Promise.all([productionApi.jobs(projectId), productionApi.plans(projectId), productionApi.executions(projectId)]).then(([jobs, plans, executions]) => { if (live) { setProductionJobs(jobs); setProductionPlans(plans); setProductionExecutions(executions); } }).catch(error => { if (live) setProductionError(String(error)); });
    refresh(); window.addEventListener('focus', refresh);
    return () => { live = false; window.removeEventListener('focus', refresh); };
  }, [projectId]);
  useEffect(() => {
    if (!projectId) { setServerShotRoutes({ projectId: '', routes: {} }); return; }
    let live = true;
    void productionApi.batchShotRoutes(projectId).then(result => {
      if (!live) return;
      setServerShotRoutes({ projectId, routes: Object.fromEntries(result.routes.map(item => [item.slotId,
        item.route === 'digital_human' ? 'presenter' : item.route === 'seedance_action' ? 'motion' : 'material'])) });
    }).catch(() => { if (live) setServerShotRoutes({ projectId: '', routes: {} }); });
    return () => { live = false; };
  }, [projectId, shootingSlots.length, activeAssemblyId]);
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
    if (productionFor(slot).locked) { setModeNotice('镜头已锁定，请先解锁'); return; }
    const requestProductionKey = productionKey(slot.id);
    const requestProduction = { ...productionFor(slot), source: 'ai' as const };
    const requestFingerprint = productionFingerprint(slot, requestProduction);
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
      setShotProductions(prev => {
        const current = prev[requestProductionKey] || requestProduction;
        return { ...prev, [requestProductionKey]: { ...current, source: current.source === 'material' ? 'ai' : current.source,
          candidates: [...current.candidates, { id: crypto.randomUUID(), materialId: clip.id, source: 'ai', fingerprint: requestFingerprint, createdAt: new Date().toISOString() }] } };
      });
      setModeNotice('新AI画面已保存为候选，请在镜头编辑中采用；未覆盖当前画面。');
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
    () => storyboardSlots.map(slot => storyboardAssignments[slot.id]).filter((id): id is string => Boolean(id && materialById.has(id))),
    [storyboardAssignments, storyboardSlots, materialById],
  );
  const assignedCount = assignedOrderedIds.length;
  const personContinuityConflicts = useMemo(() => {
    const groups = new Map<string, Array<{ slot: StoryboardSlot; clipId: string }>>();
    storyboardSlots.forEach(slot => {
      const groupId = personContinuityBySlot[slot.id];
      const clipId = storyboardAssignments[slot.id];
      if (groupId && clipId && storyboardSourcePlans[slot.id]?.mode !== 'ai') {
        groups.set(groupId, [...(groups.get(groupId) || []), { slot, clipId }]);
      }
    });
    return [...groups.entries()].filter(([, rows]) => new Set(rows.map(row => row.clipId)).size > 1)
      .map(([groupId, rows]) => `同一人物 ${groupId} 的分镜 ${rows.map(row => storyboardSlots.indexOf(row.slot) + 1).join('、')} 使用了不同人物素材`);
  }, [storyboardSlots, personContinuityBySlot, storyboardAssignments, storyboardSourcePlans]);
  const selectedProductOptions = useMemo(
    () => selectedProductIds.map(id => productOptions.find(option => option.id === id)).filter((option): option is ProductOption => Boolean(option)),
    [productOptions, selectedProductIds],
  );
  const referenceProducts = useMemo(() => referenceProductSlots(videoKickoff), [videoKickoff]);
  useEffect(() => {
    if (!socialContentTaskId || !referenceProducts.length) return;
    setReferenceProductAssignments(current => {
      const next: Record<string, string> = {};
      referenceProducts.forEach((slot, index) => {
        next[slot.shotId] = selectedProductIds.includes(current[slot.shotId] || '') ? current[slot.shotId]! : selectedProductIds[index] || '';
      });
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
    setReferenceProductTerms(current => {
      const next = { ...current };
      for (const slot of referenceProducts) if (!(slot.shotId in next)) next[slot.shotId] = slot.sourceLabel;
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, [referenceProducts, selectedProductIds, socialContentTaskId]);
  const referenceProductMappings = useMemo(() => referenceProducts.map(slot => {
    const productId = referenceProductAssignments[slot.shotId] || '';
    return { shotId: slot.shotId, sourceTerm: referenceProductTerms[slot.shotId] || slot.sourceLabel,
      productId, productLabel: productOptions.find(option => option.id === productId)?.label || '' };
  }), [referenceProducts, referenceProductAssignments, referenceProductTerms, productOptions]);
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
    // Catalog hydration and automatic migration recommendations are not product edits.
    const fingerprint = selectedProductIds.length
      ? `products:${selectedProductIds.join('|')}`
      : `manual:${activeProductInfo}`;
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
  const frameCandidates = useMemo(() => {
    const assigned = storyboardSlots
      .map(slot => materialById.get(storyboardAssignments[slot.id] || ''))
      .filter((clip): clip is Clip => Boolean(clip));
    return [...new Map((assigned.length ? assigned : selectedClips)
      .filter(c => c.type !== 'audio' && (c.poster || c.url))
      .map(c => [c.id, c])).values()];
  }, [selectedClips, storyboardSlots, storyboardAssignments, materialById]);
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
  // 成片预览只采用带可访问地址的真实视频片段。
  const previewable = useMemo(() => selectedClips.filter(c => c.url && c.type === 'video'), [selectedClips]);
  const masterSourceVoiceover = useMemo(
    () => selectCompleteVoiceoverSource(script, voiceoverLines),
    [script, voiceoverLines],
  );
  const masterSourceLanguage = detectScriptLanguageCode(masterSourceVoiceover || script);
  const activeSpokenScript = voiceDrafts[activeVoiceLang] || masterSourceVoiceover || script;
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
      setVoiceDraftStaleLangs(current => [...new Set([...current, ...voiceLangs.filter(code => code !== masterSourceLanguage)])]);
    }
    masterScriptSnapshot.current = script;
  }, [masterSourceLanguage, script, voiceDrafts, voiceLangs]);
  // 字幕 cue：当前语种口播台词 + TTS 时长（无配音则用素材总时长）
  const cues = useMemo(() => alignedCuesByLang[activeVoiceLang]?.length
    ? alignedCuesByLang[activeVoiceLang]
    : buildCues(activeSpokenScript, activeVoiceDuration || totalDur), [activeSpokenScript, activeVoiceDuration, activeVoiceLang, alignedCuesByLang, totalDur]);
  // 字幕样式沿用封面体系，但默认底部居中 + 适配字号
  const subStyle: CoverStyle = useMemo(() => ({ ...coverStyle, position: 'bottom', align: 'center', size: coverStyle.size === 'L' ? 'M' : 'S' }), [coverStyle]);

  const isStoryboardSlotReviewComplete = (slot: StoryboardSlot) => Boolean(
    storyboardAssignments[slot.id] && materialById.has(storyboardAssignments[slot.id]),
  );
  const storyboardReviewPendingCount = mode === 'clone'
    ? storyboardSlots.filter(slot => !isStoryboardSlotReviewComplete(slot)).length
    : 0;
  const storyboardReviewComplete = mode !== 'clone' || storyboardReviewPendingCount === 0;
  const storyboardMatchReviewPendingCount = storyboardSlots.filter(slot => {
    const clip = materialById.get(storyboardAssignments[slot.id] || '');
    if (!clip) return false;
    if (presentationMode !== 'material' && clip.id === digitalHumanJob?.outputMaterialId) return false;
    const assessment = assessMaterialMatch(slot, clip, ratio);
    return assessment.level === 'review' && !sourcePlanFor(slot).confirmed;
  }).length;
  const hasTimestampScript = Boolean(script.trim());
  const hasRequestedVoiceDrafts = voiceLangs.length > 0 && voiceLangs.every(code => Boolean((voiceDrafts[code] || voiceoverAudios[code]?.text)?.trim())
    && (voiceoverDraftCoversSource(masterSourceVoiceover, voiceDrafts[code] || voiceoverAudios[code]?.text || '')
      || (Boolean(voiceoverAudios[code]?.url) && !voiceoverStaleLangs.includes(code)))
    && !voiceDraftFailedLangs.includes(code)
    && !voiceDraftStaleLangs.includes(code)
    && !voiceDraftPendingLangs.includes(code));
  const hasRequestedVoiceovers = voiceLangs.length > 0 && voiceLangs.every(code => Boolean(voiceoverAudios[code]?.url) && !voiceoverStaleLangs.includes(code));
  const hasRequestedSubtitles = voiceLangs.length > 0 && voiceLangs.every(code => Boolean(alignedCuesByLang[code]?.length));
  const hasReadyVoiceStrategy = voiceoverMode === 'none'
    || (voiceoverMode === 'upload' && Boolean(voiceoverUrl))
    || (voiceoverMode === 'ai' && hasRequestedVoiceovers);
  const hasAnyVoiceover = Object.entries(voiceoverAudios).some(([code, audio]) => Boolean(audio?.url) && !voiceoverStaleLangs.includes(code));
  const activeScriptQualityItem = modeScripts.find(item => item.id === activeModeScriptId);
  const activeScriptQualityStatus = activeScriptQualityItem?.qualityStatus;
  // A quality verdict belongs to the exact script snapshot that was checked.
  // Once the user edits a shot, a stale rejection must not deadlock the flow
  // before the production step where avatar/material bindings are resolved.
  const activeScriptQualityApplies = Boolean(activeScriptQualityItem?.script)
    && String(activeScriptQualityItem?.script || '').trim() === String(script || '').trim();
  const activeScriptGenerationIsVerified = activeScriptQualityApplies
    && String(activeScriptQualityItem?.generationProvenance || activeScriptQualityItem?.generationSource || '').toLowerCase() === 'ai'
    && activeScriptQualityStatus === 'passed'
    && activeScriptQualityItem?.publishable === true
    && Boolean(activeScriptQualityItem?.id);
  const activeScriptQualityBlocked = activeScriptQualityApplies
    && (activeScriptQualityStatus === 'rejected' || activeScriptQualityStatus === 'failed');
  const canNext = localGateBypass || (contentMode === 'video' && step === 'script'
    ? scriptStageTab === 'theme'
      ? hasTimestampScript && !activeScriptQualityBlocked
      : scriptStageTab === 'voiceover'
        ? hasTimestampScript && !activeScriptQualityBlocked && hasRequestedVoiceDrafts
        : scriptStageTab === 'audio'
          ? hasTimestampScript && !activeScriptQualityBlocked && (hasRequestedVoiceDrafts || hasRequestedVoiceovers) && hasReadyVoiceStrategy
          : scriptStageTab === 'bgm'
            ? hasTimestampScript && !activeScriptQualityBlocked && hasRequestedVoiceDrafts && hasRequestedSubtitles
          : hasTimestampScript && !activeScriptQualityBlocked && hasRequestedVoiceDrafts && hasRequestedSubtitles
    : contentMode === 'video' && step === 'material'
      ? storyboardSlots.length > 0 && assignedCount === storyboardSlots.length && storyboardMatchReviewPendingCount === 0
    : true);
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
      if (productSelectMode === 'single' && !socialContentTaskId) return [id];
      const next = current.includes(id) ? current.filter(item => item !== id) : [...current, id];
      return next.length ? next : [id];
    });
  };
  useEffect(() => {
    if (socialContentTaskId) { setSourceDraftCheckPending(false); return; }
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
      const fromImagePost = kickoff.source === 'inspiration_image_post' || (kickoff.source !== 'material_library' && kickoff.video?.contentFormat === 'image');
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
          setModeNotice(`原视频约 ${Number(kickoff.video?.duration || 0).toFixed(1)} 秒，当前逐镜结构覆盖到 ${analyzedUntil.toFixed(1)} 秒，但尚未达到脚本生成的逐镜质量要求。请返回灵感中心复核原片与口播证据。`);
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
    if (videoKickoff?.source === 'material_library' || !(videoKickoff?.source === 'inspiration_image_post' || videoKickoff?.video?.contentFormat === 'image')) return;
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
  const defaultEditForSlot = (clip: Clip, slot: StoryboardSlot): ClipEdit => {
    const targetDuration = slot.end - slot.start;
    const matchedSegment = (clip.segments || []).find(segment => {
      if (!usableEvidenceSegment(segment, clip.duration)) return false;
      const dimensions = materialSemanticDimensions({ ...clip, folder: '', tags: '', shotFunction: '', applicability: '', segments: [segment] }, slot);
      return dimensions.topic && dimensions.purpose && segment.end - segment.start >= targetDuration;
    });
    const evidenceTrim = matchedSegment ? {
      segmentId: matchedSegment.id, trimStart: matchedSegment.start,
      trimEnd: +(matchedSegment.start + targetDuration).toFixed(3), targetDuration,
    } : /(?:^|\n)镜头功能[：:]/.test(slot.detail) ? null : matchEvidenceSegment(clip, slot);
    const trim = evidenceTrim || automaticStoryboardTrim(clip.duration, slot.end - slot.start, clip.type === 'image' ? 'image' : 'video');
    const usable = trim.trimEnd - trim.trimStart;
    return {
      ...(evidenceTrim ? { segmentId: evidenceTrim.segmentId } : {}),
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
    if (!firstSlot || !hookClip || productionFor(firstSlot).locked) return;
    setStoryboardAssignments(current => current[firstSlot.id] === hookClip.id
      ? current
      : { ...current, [firstSlot.id]: hookClip.id });
    setClipEdits(current => {
      const key = slotClipEditKey(firstSlot.id, hookClip.id);
      return current[key] ? current : { ...current, [key]: defaultEditForSlot(hookClip, firstSlot) };
    });
  }, [hookMaterialId, materialById, storyboardSlots]); // eslint-disable-line react-hooks/exhaustive-deps
  const patchStoryboardClipEdit = (slot: StoryboardSlot, clip: Clip, field: 'targetDuration' | 'trimStart' | 'trimEnd' | 'speed', rawValue: number) => {
    if (productionFor(slot).locked) { setModeNotice('镜头已锁定，请先解锁'); return; }
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
    const rows = storyboardSlots.map((slot, index) => {
      const avatarSlot = presentationMode === 'avatar' || presentationMode === 'heygen' && (presentationSources[slot.id] || (index === 0 ? 'avatar' : 'material')) === 'avatar';
      const clip = materialById.get(storyboardAssignments[slot.id] || '');
      const edit = clip ? editForSlot(clip, slot) : { trimStart: 0, trimEnd: slot.end - slot.start, speed: 1, targetDuration: slot.end - slot.start };
      const targetDuration = Math.max(0.5, edit.targetDuration || slot.end - slot.start);
      const targetStart = timelineCursor;
      timelineCursor += targetDuration;
      if (avatarSlot) {
        const production = productionFor(slot);
        const adopted = production.candidates.find(item => item.id === production.adoptedId && item.source === 'avatar');
        if (adopted && clip) return { production, clipId: clip.id, name: clip.name, type: clip.type, url: clip.url, poster: clip.poster, trimStart: 0, trimEnd: Math.min(clip.duration || targetDuration, targetDuration), speed: 1, targetStart, targetEnd: timelineCursor, targetDuration };
        return digitalHumanJob?.outputUrl ? { clipId: digitalHumanJob.outputMaterialId || digitalHumanJob.id, name: 'HeyGen 数字人', type: 'video' as const, url: digitalHumanJob.outputUrl, poster: undefined, trimStart: targetStart, trimEnd: timelineCursor, speed: 1, targetStart, targetEnd: timelineCursor, targetDuration } : null;
      }
      if (!clip) return null;
      return {
        clipId: clip.id,
        name: clip.name,
        type: clip.type,
        url: clip.url,
        poster: clip.poster,
        trimStart: edit.trimStart,
        trimEnd: edit.trimEnd,
        speed: edit.speed,
        targetStart,
        targetEnd: timelineCursor,
        targetDuration,
      };
    }).filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (rows.length) return rows;
    return selectedClips.map(clip => {
      const edit = editFor(clip);
      return {
        clipId: clip.id,
        name: clip.name,
        type: clip.type,
        url: clip.url,
        poster: clip.poster,
        trimStart: edit.trimStart,
        trimEnd: edit.trimEnd,
        speed: edit.speed,
        targetStart: undefined,
        targetEnd: undefined,
        targetDuration: Math.max(0.5, edit.trimEnd - edit.trimStart),
      };
    });
  }, [clipEdits, materialById, selectedClips, storyboardAssignments, storyboardSlots, presentationMode, presentationSources, digitalHumanJob, shotProductions]);
  const timelineForAssembly = (assembly: StoryboardAssembly) => {
    let timelineCursor = 0;
    const rows = storyboardSlots.map(slot => {
      const clip = materialById.get(assembly.assignments[slot.id] || '');
      if (!clip) return null;
      const edit = editForSlot(clip, slot);
      const targetDuration = Math.max(0.5, edit.targetDuration || slot.end - slot.start);
      const targetStart = timelineCursor;
      timelineCursor += targetDuration;
      return {
        production: shotProductions[productionKey(slot.id, assembly.id)] || newShotProduction(storyboardSlotScript(slot.detail).voice, (mode === 'clone'
          ? productionDefaults.presenters.find(item => item.authorized && item.name.trim() === '销售')?.id
          : undefined) || productionDefaults.defaultPresenterId, productionDefaults),
        voiceStart: slot.start, voiceEnd: slot.end,
        screenCaption: storyboardSlotScript(slot.detail).subtitle,
        productUrl: materialById.get((shotProductions[productionKey(slot.id, assembly.id)] || productionFor(slot)).productMaterialId)?.url,
        productType: materialById.get((shotProductions[productionKey(slot.id, assembly.id)] || productionFor(slot)).productMaterialId)?.type,
        backgroundUrl: materialById.get((shotProductions[productionKey(slot.id, assembly.id)] || productionFor(slot)).backgroundMaterialId)?.url,
        backgroundType: materialById.get((shotProductions[productionKey(slot.id, assembly.id)] || productionFor(slot)).backgroundMaterialId)?.type,
        clipId: clip.id, name: clip.name, type: clip.type, url: clip.url, poster: clip.poster,
        trimStart: edit.trimStart, trimEnd: edit.trimEnd, speed: edit.speed,
        targetStart, targetEnd: timelineCursor, targetDuration,
      };
    }).filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (rows.length) return rows;
    return assembly.selected.map(id => materialById.get(id)).filter((clip): clip is Clip => Boolean(clip)).map(clip => {
      const edit = editFor(clip);
      return {
        clipId: clip.id, name: clip.name, type: clip.type, url: clip.url, poster: clip.poster,
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
      const timeline = timelineForAssembly(plan);
      const validStoryboard = storyboardSlots.length > 0
        && timeline.length === storyboardSlots.length
        && timeline.every(item => Boolean(item.url && item.type !== 'audio' && item.targetDuration > 0));
      if (!validStoryboard) return [];
      return languages.map((code, languageIndex) => {
        const bgmId = materialVersionBgms[materialVersionKey(plan.id, code)] ?? assemblyBgms[plan.id] ?? bgm;
        const audioDuration = voiceoverForLanguage(code).duration;
        return {
          key: renderCombinationKey(plan.id, code, bgmId),
          plan,
          planIndex,
          code,
          languageIndex,
          bgmId,
          script: scriptForRenderLanguage(code),
          timeline: fitTimelineToVoiceoverCues<(typeof timeline)[number]>(timeline, audioDuration,
            productionVoiceCues(alignedCuesByLang[code] || voiceoverAudios[code]?.cues, voiceoverAudios[code]?.alignmentSource, audioDuration)),
        };
      });
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
    let active = true;
    const sourceUrl = voiceoverMode === 'none' || !previewVoiceOn ? '' : voiceoverUrl || '';
    setPreviewVoicePlayableUrl('');
    if (!sourceUrl) {
      setPreviewVoiceLoading(false);
      return () => { active = false; };
    }
    setPreviewVoiceLoading(true);
    void withStudioTimeout(authenticatedAudioBlobUrl(sourceUrl), 20_000)
      .then(playableUrl => {
        if (!active) return;
        setPreviewVoicePlayableUrl(playableUrl);
        setPreviewPlaybackError(current => current.startsWith('口播加载失败') ? '' : current);
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : String(error || '未知错误');
        setPreviewPlaybackError(`口播加载失败：${message}`);
      })
      .finally(() => { if (active) setPreviewVoiceLoading(false); });
    return () => { active = false; };
  }, [previewVoiceOn, voiceoverMode, voiceoverUrl]);
  useEffect(() => {
    const cache = previewVideoCacheRef.current;
    const activeUrls = new Set<string>();
    const warmIndex = previewIdx === null ? 0 : previewIdx + 1;
    const warmItem = previewTimeline[warmIndex];
    if (warmItem?.clip.type === 'video' && warmItem.clip.url) {
      activeUrls.add(warmItem.clip.url);
      if (!cache.has(warmItem.clip.url)) {
        const video = document.createElement('video');
        video.preload = 'auto';
        video.muted = true;
        video.playsInline = true;
        video.src = warmItem.clip.url;
        video.load();
        cache.set(warmItem.clip.url, video);
      }
    }
    cache.forEach((video, url) => {
      if (activeUrls.has(url)) return;
      video.pause();
      video.removeAttribute('src');
      video.load();
      cache.delete(url);
    });

    const nextItem = warmItem;
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

  const goPreview = async (scriptOverride?: string, renderOverride?: { language?: string; voiceoverUrl?: string; voiceoverDur?: number; cues?: SubCue[]; outputOnly?: boolean; timeline?: typeof renderTimeline; bgmId?: string; serverPreviewRequired?: boolean }) => {
    const blockers = storyboardSlots.flatMap(slot => shotBlockers(productionFor(slot), shotProductionContext).map(message => `${slot.title}：${message}`));
    if (!localGateBypass && blockers.length) { setModeNotice(blockers.join('；')); throw new Error(blockers.join('\n')); }
    setStepIdx(STEPS.findIndex(s => s.id === 'preview'));
    setRendered(false);
    setRendering(true);
    setRenderPct(0);
    if (!renderOverride?.outputOnly) {
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
    setCoverUrl(cUrl);

    const outputLanguage = renderOverride?.language || lang;
    const defaultVoiceover = voiceoverForLanguage(outputLanguage);
    const outputVoiceoverUrl = renderOverride?.voiceoverUrl ?? defaultVoiceover.url;
    const outputVoiceoverDur = renderOverride?.voiceoverDur ?? defaultVoiceover.duration;
    const outputScript = scriptOverride ?? (voiceDrafts[outputLanguage] || activeSpokenScript);
    const requestedTimeline = renderOverride?.timeline ?? renderTimeline;
    let outputTimeline = voiceoverMode === 'none'
      ? requestedTimeline
      : fitTimelineToVoiceoverCues<(typeof requestedTimeline)[number]>(requestedTimeline, outputVoiceoverDur,
        productionVoiceCues(renderOverride?.cues ?? alignedCuesByLang[outputLanguage] ?? voiceoverAudios[outputLanguage]?.cues,
          voiceoverAudios[outputLanguage]?.alignmentSource, outputVoiceoverDur));
    const usesAdoptedShotAvatar = storyboardSlots.some(slot => {
      const production = productionFor(slot);
      return production.source === 'avatar' && production.candidates.some(item => item.id === production.adoptedId && item.source === 'avatar');
    });
    if (presentationMode !== 'material' && !usesAdoptedShotAvatar) {
      if (!digitalHumanJob?.outputUrl || !['review', 'completed'].includes(digitalHumanJob.status)) throw new Error('请先生成所选数字人视频，不能自动切换为素材成片');
      if (!outputVoiceoverUrl || new URL(digitalHumanJob.voiceoverUrl, location.origin).pathname !== new URL(outputVoiceoverUrl, location.origin).pathname) throw new Error('本语言配音与数字人视频不一致，请按当前配音重新生成数字人');
      const choices = storyboardSlots.map((slot, index) => presentationMode === 'avatar' ? 'avatar' : presentationSources[slot.id] || (index === 0 ? 'avatar' : 'material'));
      if (presentationMode === 'heygen' && (!choices.includes('avatar') || !choices.includes('material'))) throw new Error('混剪必须同时包含数字人和素材镜头，请调整分镜来源');
      if (presentationMode === 'heygen' && outputTimeline.length !== storyboardSlots.length) throw new Error('混剪仍有镜头缺少素材，请逐镜补齐');
      if (!digitalHumanJob.subtitleCues?.length) throw new Error('当前数字人缺少对应音频字幕，请重新获取字幕后合成');
      const weights = storyboardSlots.map(slot => Math.max(.5, slot.end - slot.start));
      const total = weights.reduce((sum, value) => sum + value, 0);
      let cursor = 0;
      outputTimeline = storyboardSlots.map((slot, index) => {
        const targetStart = cursor, targetDuration = outputVoiceoverDur * weights[index] / total; cursor += targetDuration;
        if (choices[index] === 'avatar') return { clipId: digitalHumanJob.outputMaterialId || digitalHumanJob.id, name: 'HeyGen 数字人', type: 'video' as const, url: digitalHumanJob.outputUrl!, poster: undefined, trimStart: targetStart, trimEnd: cursor, speed: 1, targetStart, targetEnd: cursor, targetDuration };
        const original = outputTimeline[index];
        if (!original?.url || original.clipId === digitalHumanJob.outputMaterialId) throw new Error(`第 ${index + 1} 镜缺少指定素材，不能使用数字人顶替`);
        return { ...original, targetStart, targetEnd: cursor, targetDuration };
      });
    }
    const validOutputStoryboard = storyboardSlots.length > 0
      && outputTimeline.length === storyboardSlots.length
      && outputTimeline.every(item => Boolean(item.url && item.type !== 'audio' && item.targetDuration > 0));
    if (!String(outputScript || '').trim() || !validOutputStoryboard) {
      throw new Error('生成成片需要有效脚本，并为全部分镜匹配有效视频或图片素材。');
    }
    const timelineDuration = outputTimeline.reduce((sum, item) => sum + (item.targetDuration || 0), 0);
    const rawOutputCues = presentationMode !== 'material' && digitalHumanJob?.subtitleCues?.length ? digitalHumanJob.subtitleCues : renderOverride?.cues?.length
      ? renderOverride.cues
      : defaultVoiceover.cues.length
        ? defaultVoiceover.cues
        : buildCues(outputScript, outputVoiceoverDur || timelineDuration || totalDur);
    const outputCues = renderSafeCues(rawOutputCues, Math.min(
      timelineDuration || duration,
      outputVoiceoverDur > 0 ? outputVoiceoverDur : timelineDuration || duration,
    ));
    const effectTimeline = outputTimeline.map((item, index) => ({
      sceneId: 'sceneId' in item && typeof item.sceneId === 'string'
        ? item.sceneId
        : ('clipId' in item ? String(item.clipId || index) : String(index)),
      clipId: 'clipId' in item ? String(item.clipId || '') : undefined,
      targetDuration: item.targetDuration,
    }));
    const disabledEffects = new Set(disabledEffectSceneIds);
    const presetEffectPlan = createPresetEffectPlan(effectPreset, effectIntensity, effectTimeline, 198);
    const effectPlan = {
      ...presetEffectPlan,
      scenes: presetEffectPlan.scenes.map(scene => disabledEffects.has(scene.sceneId)
        ? { ...scene, enabled: false, transitionOut: { type: 'cut' as const, duration: 0 }, overlays: [] }
        : scene),
    };
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
      effectPlan,
      subtitles: subtitlesOn ? {
        mode: subMode,
        style: { font: coverStyle.font, color: coverStyle.color, weight: coverStyle.weight, fontFamily: coverStyle.fontFamily },
        cues: [...(subMode === 'bilingual' && outputLanguage === activeVoiceLang && cueZh.length === outputCues.length
          ? outputCues.map((c, i) => ({ ...c, zh: cueZh[i] }))
          : outputCues), ...outputTimeline.flatMap(item => {
            if (!('production' in item) || typeof item.targetStart !== 'number' || typeof item.targetEnd !== 'number') return [];
            const production = item.production as ShotProduction;
            const text = 'screenCaption' in item ? String(item.screenCaption || '').trim() : '';
            const normalize = (value: string) => value.replace(/[\p{P}\s]/gu, '');
            if (outputLanguage !== lang || !text || /^(无|none)$/i.test(text)
              || normalize(text) === normalize(production.narration)) return [];
            return [{ text, start: item.targetStart, end: item.targetEnd, kind: 'screen' as const }];
          })],
      } : { mode: 'off' as const, style: {}, cues: [] },
    };

    // 1) 向服务器申请渲染授权（原料 manifest + 短期令牌）
    const auth = await studioApi.render(spec);

    // 2) 桌面客户端：用本机原生 ffmpeg 真实合成出片
    const desktop = getDesktopRender();
    if (desktop?.available && !renderOverride?.serverPreviewRequired) {
      const unsub = desktop.onProgress(p => {
        if (renderToken.current === token) setRenderPct(Math.min(99, Math.round(p)));
      });
      try {
        const out = await desktop.render(auth.manifest);
        if (renderToken.current !== token) return;
        if (out.ok) {
          if (out.outputPath) setRenderProductionSignatures(current => ({ ...current, [out.outputPath!]: productionSignature }));
          if (!renderOverride?.outputOnly) setRenderOutputPath(out.outputPath ?? null);
          setRendering(false);
          setRendered(true);
          setRenderPct(100);
          return out.outputPath ?? null;
        } else {
          setRendering(false);
          setRendered(false);
          throw new Error(out.error || '桌面端合成失败');
        }
      } finally {
        unsub();
      }
      return;
    }

    // 3) 网页环境：没有 Electron 桥时，走本机后端 ffmpeg 兜底导出。
    setRenderPct(20);
    const progressTimer = window.setInterval(() => {
      if (renderToken.current !== token) return;
      setRenderPct(current => Math.min(90, current + (current < 60 ? 6 : 2)));
    }, 1200);
    const localOut = await studioApi.renderLocal(auth.manifest).finally(() => window.clearInterval(progressTimer));
    if (renderToken.current !== token) return;
    if (!localOut.ok) throw new Error(localOut.error || '本地 MP4 导出失败');
    if (localOut.outputPath) setRenderProductionSignatures(current => ({ ...current, [localOut.outputPath!]: productionSignature }));
    if (localOut.outputPath && localOut.previewUrl) renderPreviewUrlsRef.current[localOut.outputPath] = localOut.previewUrl;
    if (!renderOverride?.outputOnly) {
      setRenderOutputPath(localOut.outputPath ?? null);
      setRenderOutputPreviewUrl(localOut.previewUrl ?? null);
    }
    setRendering(false);
    setRendered(true);
    setRenderPct(100);
    return localOut.outputPath ?? null;
    } catch (err: any) {
      if (renderToken.current === token) {
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
      if (!localGateBypass && (unsupportedClaims.length || missingThemeEvidence)) {
        alert([
          '分镜质量校验未通过，请修改后重试。',
          ...unsupportedClaims.map(item => `未获企业资料支持：${item}`),
          ...(missingThemeEvidence ? [`“${activeVideoTheme.title}”缺少必需的真实素材或企业证据。`] : []),
        ].join('\n'));
        return;
      }
      if (hasTimestampScript || localGateBypass) setScriptStageTab('voiceover');
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
      const blockers = [...qualityBlockers, ...personContinuityConflicts, ...validateStudioTimeline(renderTimeline)];
      if (!localGateBypass && blockers.length) {
        alert(`无法进入配乐：\n${blockers.join('\n')}`);
        return;
      }
    }
    const nextStep = activeSteps[stepIdx + 1]?.id;
    if (contentMode === 'video' && nextStep === 'material') setActiveFolder('all');
    setStepIdx(i => Math.min(i + 1, activeSteps.length - 1));
  };
  const renderSelectedLanguageVersion = async (selectedKey?: string, serverPreviewRequired = false) => {
    if (!localGateBypass && personContinuityConflicts.length) {
      alert(`人物连续性未通过：\n${personContinuityConflicts.join('\n')}`);
      return;
    }
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
    setLanguageRenderOutputs(prev => ({ ...prev, [combination.key]: { status: 'rendering' } }));
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
        bgmId, serverPreviewRequired,
      });
      const previewUrl = outputPath ? renderPreviewUrlsRef.current[outputPath] : undefined;
      setLanguageRenderOutputs(prev => ({ ...prev, [key]: { status: 'done', path: outputPath || undefined, previewUrl } }));
      setLanguageRenderVersions(prev => ({ ...prev, [key]: [{ id: `${key}-${Date.now()}`, versionNumber: (prev[key]?.[0]?.versionNumber || 0) + 1, status: 'done', path: outputPath || undefined, previewUrl, createdAt: new Date().toISOString() }, ...(prev[key] || [])] }));
    } catch (err: any) {
      const key = combination.key;
      setLanguageRenderOutputs(prev => ({ ...prev, [key]: { status: 'failed', error: err?.message || '生成失败' } }));
      setLanguageRenderVersions(prev => ({ ...prev, [key]: [{ id: `${key}-${Date.now()}`, versionNumber: (prev[key]?.[0]?.versionNumber || 0) + 1, status: 'failed', error: err?.message || '生成失败', createdAt: new Date().toISOString() }, ...(prev[key] || [])] }));
    } finally {
      setBatchRenderingLangs(false);
    }
  };
  const retryLanguageRender = async (combination: { key: string; code: string; plan: StoryboardAssembly; bgmId: string }) => {
    const { key, code, plan, bgmId } = combination;
    const audio = voiceoverForLanguage(code);
    setLanguageRenderOutputs(prev => ({ ...prev, [key]: { status: 'rendering' } }));
    try {
      const outputPath = await goPreview(scriptForRenderLanguage(code), {
        language: code,
        voiceoverUrl: audio.url,
        voiceoverDur: audio.duration,
        cues: audio.cues,
        outputOnly: true,
        timeline: timelineForAssembly(plan),
        bgmId,
      });
      const previewUrl = outputPath ? renderPreviewUrlsRef.current[outputPath] : undefined;
      setLanguageRenderOutputs(prev => ({ ...prev, [key]: { status: 'done', path: outputPath || undefined, previewUrl } }));
      setLanguageRenderVersions(prev => ({ ...prev, [key]: [{ id: `${key}-${Date.now()}`, versionNumber: (prev[key]?.[0]?.versionNumber || 0) + 1, status: 'done', path: outputPath || undefined, previewUrl, createdAt: new Date().toISOString() }, ...(prev[key] || [])] }));
    } catch (err: any) {
      setLanguageRenderOutputs(prev => ({ ...prev, [key]: { status: 'failed', error: err?.message || '生成失败' } }));
      setLanguageRenderVersions(prev => ({ ...prev, [key]: [{ id: `${key}-${Date.now()}`, versionNumber: (prev[key]?.[0]?.versionNumber || 0) + 1, status: 'failed', error: err?.message || '生成失败', createdAt: new Date().toISOString() }, ...(prev[key] || [])] }));
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
    if (!localGateBypass && (!activeProductInfo.trim() || !activeProductLabel)) {
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
        {
          materials: matNames, materialInfos: buildMaterialInfosForScript(selectedVisualClips, duration, hookMaterialId),
          productInfo: activeProductInfo, language: lang, platform, duration, scriptType: type, generationMode: mode,
          voiceoverMode: voiceoverMode === 'unselected' ? 'ai' : voiceoverMode,
          cooperationRoute, provider, audience, sellingPoints, tone, videoTheme: videoThemePayload,
          existingScripts: modeScripts.filter(item => item.mode === mode).map(item => item.script).concat(script || []),
          variantSeed: modeScripts.filter(item => item.mode === mode).length,
        }, script,
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
      if (isCurrentRequest()) setModeNotice(err?.message || '脚本生成失败，请稍后重试。');
    } finally {
      if (isCurrentRequest()) setScriptLoading(false);
    }
  };

  const fillLocalDemoMaterials = (preferredMaterialIds: string[]) => {
    const editablePool = materials.filter(item => item.type !== 'audio'
      && item.scope !== 'shared'
      && item.usage !== 'reference_only'
      && Boolean(item.url || item.poster));
    const assignments: Record<string, string> = {};
    // Explicit task bindings remain authoritative, including an already
    // generated presenter shot. All other shots are matched to distinct assets.
    socialShotMaterialBindings.forEach(({ shotIndex, materialId }) => {
      const slot = storyboardSlots[shotIndex];
      if (slot && materialById.has(materialId)) assignments[slot.id] = materialId;
    });
    const boundMaterialIds = new Set(Object.values(assignments));
    const slotsToMatch = storyboardSlots.filter(slot => !assignments[slot.id]);
    const strictAssignments = matchMaterialsToStoryboardLocally(
      editablePool.filter(item => !boundMaterialIds.has(item.id)),
      slotsToMatch,
      preferredMaterialIds,
      {
        targetRatio: ratio,
        allowSemanticMetadata: true,
        requireEvidence: true,
        allowReuse: false,
      },
    );
    Object.assign(assignments, strictAssignments);
    const usedMaterialIds = new Set(Object.values(assignments));
    const remainingSlots = storyboardSlots.filter(slot => !assignments[slot.id]);
    const fallbackAssignments = matchMaterialsToStoryboardLocally(
      editablePool.filter(item => !usedMaterialIds.has(item.id)),
      remainingSlots,
      preferredMaterialIds,
      {
        targetRatio: ratio,
        requireEvidence: false,
        allowReuse: false,
        preferredBoost: 34,
      },
    );
    Object.assign(assignments, fallbackAssignments);
    const fallbackSlotIds = new Set(Object.keys(fallbackAssignments));
    const nextEdits: Record<string, ClipEdit> = {};
    const nextPlans: Record<string, StoryboardSourcePlan> = {};
    storyboardSlots.forEach(slot => {
      const clip = materialById.get(assignments[slot.id] || '');
      if (!clip) return;
      const assessed = assessMaterialMatch(slot, clip, ratio);
      const assessment: MaterialMatchAssessment = fallbackSlotIds.has(slot.id) && assessed.level === 'missing'
        ? {
          score: 50,
          level: 'review',
          reason: '名称、分类、标签、时长和画幅综合排序命中',
          difference: '素材缺少完整语义标注，演示模式已按内容相关性采用',
        }
        : assessed;
      nextEdits[slotClipEditKey(slot.id, clip.id)] = defaultEditForSlot(clip, slot);
      const currentPlan = sourcePlanFor(slot);
      nextPlans[slot.id] = {
        ...currentPlan,
        mode: clipSourceMode(clip),
        decided: true,
        confirmed: true,
        error: '',
        qualityError: '',
        matchScore: assessment.score,
        matchLevel: assessment.level,
        matchReason: `内容 Agent：${assessment.reason}`,
        matchDifference: assessment.difference,
      };
    });
    const orderedIds = storyboardSlots.map(slot => assignments[slot.id]).filter((id): id is string => Boolean(id));
    const selectedIds = [...new Set(orderedIds)];
    setStoryboardAssignments(assignments);
    setStoryboardSourcePlans(current => ({ ...current, ...nextPlans }));
    setClipEdits(current => ({ ...current, ...nextEdits }));
    setSelected(selectedIds);
    setScriptRecommendedMaterialIds(selectedIds);
    setActiveFolder('recommend');
    setActiveStoryboardSlotId(storyboardSlots[0]?.id || '');
    setPresentationMode('material');
    setPresenterMode('real');
    const recentUsed = preferredMaterialIds.filter(id => selectedIds.includes(id));
    const recentNames = recentUsed.map(id => materialById.get(id)?.name).filter(Boolean);
    const strictCount = Object.keys(strictAssignments).length;
    const fallbackCount = Object.keys(fallbackAssignments).length;
    setModeNotice(`内容 Agent 已用 ${selectedIds.length} 条不同的本地素材覆盖 ${Object.keys(assignments).length}/${storyboardSlots.length} 个分镜：${strictCount} 个语义强匹配，${fallbackCount} 个按名称、分类、标签、时长和画幅补位${recentNames.length ? `；已采用最近上传的 ${recentNames.join('、')}` : ''}。`);
    return {
      storyboardAssignments: assignments,
      storyboardSourcePlans: { ...storyboardSourcePlans, ...nextPlans },
      clipEdits: { ...clipEdits, ...nextEdits },
      selected: selectedIds,
    };
  };

  const smartSelectMaterialsFast = async () => {
    if (materialSelectLoading) return;
    if (!localGateBypass && socialViralTask && (!voiceoverAudios[activeVoiceLang]?.url
      || voiceoverStaleLangs.includes(activeVoiceLang)
      || !productionVoiceCues(voiceoverAudios[activeVoiceLang]?.cues, voiceoverAudios[activeVoiceLang]?.alignmentSource, voiceoverAudios[activeVoiceLang]?.duration || 0).length)) {
      setModeNotice('请先生成口播配音并取得实测逐句时间码，再匹配分镜素材。');
      return;
    }
    setMaterialSelectLoading(true);
    setModeNotice(socialViralTask ? '正在按视觉主题或表达目的匹配本地素材，双项命中优先…' : '正在按分镜语义、镜头角色和有效时长快速匹配…');
    try {
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
      const allVisuals = materials.filter(item => item.type !== 'audio');
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

      if (localGateBypass && socialViralTask) {
        const preferredIds = contentCreationDemoMaterialIds(allVisuals);
        if (preferredIds.length) return fillLocalDemoMaterials(preferredIds);
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
      const lockedAssignments = Object.fromEntries(Object.entries(storyboardAssignments).filter(([slotId, clipId]) => (
        storyboardSlots.some(slot => slot.id === slotId && (() => {
          const clip = materialById.get(clipId);
          return Boolean(clip && (storyboardSourcePlans[slotId]?.confirmed || assessMaterialMatch(slot, clip, ratio).level === 'direct'));
        })())
      )));
      const lockedClipIds = new Set(Object.values(lockedAssignments));
      const slotsToMatch = storyboardSlots.filter(slot => {
        if (lockedAssignments[slot.id]) return false;
        if (!socialViralTask) return true;
        const visual = storyboardSlotScript(slot.detail).visual || slot.title;
        const foregroundIdentity = /人物|女性|男性|销售|主播|主讲|presenter|speaker/i.test(visual)
          && /镜头|正面|面部|目光|嘴|口播|手势|手指|手臂|双臂|迈步|前行|讲解/i.test(visual)
          && !/^(?:背景人物|远景人物|路人|人群)|(?:人物|女性|男性).{0,8}背影/i.test(visual);
        return shotRouteFor(slot) === 'material' && !foregroundIdentity;
      });
      if (!slotsToMatch.length) {
        setModeNotice('可直接匹配的分镜已处理；正面承接口播的销售人物镜头可使用数字人制作入口。');
        return;
      }
      const unusedPool = pool.filter(item => !lockedClipIds.has(item.id));
      const matchPool = unusedPool.length ? unusedPool : pool;
      const candidateAssignments = matchMaterialsToStoryboardLocally(matchPool, slotsToMatch, selected.filter(id => id !== hookMaterialId), {
        variantIndex,
        previousAssignments,
        targetRatio: ratio,
        allowSemanticMetadata: socialViralTask,
      });
      // Identity is a cross-shot constraint. A semantic match of three
      // different faces cannot fill three cuts of the same source person.
      const continuityGroups = new Map<string, StoryboardSlot[]>();
      storyboardSlots.forEach(slot => {
        const id = personContinuityBySlot[slot.id];
        if (id) continuityGroups.set(id, [...(continuityGroups.get(id) || []), slot]);
      });
      for (const group of continuityGroups.values()) {
        if (group.length < 2 || !group.some(slot => slotsToMatch.includes(slot))) continue;
        const lockedIds = [...new Set(group.map(slot => lockedAssignments[slot.id]).filter(Boolean))];
        const common = lockedIds.length > 1 ? undefined : pool.find(clip =>
          (!lockedIds.length || clip.id === lockedIds[0])
          && clip.type === 'video'
          && effectiveClipDuration(clip) >= group.reduce((sum, slot) => sum + slot.end - slot.start, 0)
          && group.every(slot => assessMaterialMatch(slot, clip, ratio).level !== 'missing'
            && (!socialViralTask || Boolean(matchEvidenceSegment(clip, slot) || matchStoryboardMetadata(clip, slot)))));
        group.forEach(slot => {
          if (lockedAssignments[slot.id]) return;
          if (common) candidateAssignments[slot.id] = common.id;
          else delete candidateAssignments[slot.id];
        });
      }
      const assessmentBySlot: Record<string, MaterialMatchAssessment> = {};
      const matchedAssignments = Object.fromEntries(Object.entries(candidateAssignments).filter(([slotId, clipId]) => {
        const slot = storyboardSlots.find(item => item.id === slotId);
        const clip = materialById.get(clipId);
        if (!slot || !clip) return false;
        const assessment = assessMaterialMatch(slot, clip, ratio);
        assessmentBySlot[slotId] = assessment;
        // Below 60 points the material is only a visual placeholder, not a
        // trustworthy match. Leave the shot open instead of silently filling it.
        return assessment.level !== 'missing' && (!socialViralTask
          || Boolean(matchEvidenceSegment(clip, slot) || matchStoryboardMetadata(clip, slot)));
      }));
      const assignments = { ...lockedAssignments, ...matchedAssignments };
      storyboardSlots.forEach(slot => {
        const clip = materialById.get(assignments[slot.id] || '');
        if (clip && !assessmentBySlot[slot.id]) assessmentBySlot[slot.id] = assessMaterialMatch(slot, clip, ratio);
      });
      const orderedIds = storyboardSlots.map(slot => assignments[slot.id]).filter((id): id is string => Boolean(id));
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
      setSelected([...new Set(orderedIds)]);
      setScriptRecommendedMaterialIds([...new Set(orderedIds)]);
      setActiveFolder('recommend');
      setActiveStoryboardSlotId(storyboardSlots.find(slot => !assignments[slot.id])?.id || storyboardSlots[0]?.id || '');
      const reviewCount = storyboardSlots.filter(slot => assessmentBySlot[slot.id]?.level === 'review' && assignments[slot.id]).length;
      const missingCount = storyboardSlots.filter(slot => !assignments[slot.id]).length;
      setModeNotice(`已为 ${Object.keys(matchedAssignments).length} 个空分镜补充本地素材；当前 ${orderedIds.length}/${storyboardSlots.length} 个分镜已匹配${reviewCount ? `，${reviewCount} 个单项命中分镜可继续优化` : ''}${missingCount ? `，仍有 ${missingCount} 个待匹配或待数字人生成` : ''}${usesCropFallback ? '。不同画幅会在预览中居中适配' : ''}。`);
      // Return the same snapshot to batch submission; React state updates are
      // asynchronous and collectSpec() in this click still sees old assignments.
      return {
        storyboardAssignments: assignments,
        storyboardSourcePlans: { ...storyboardSourcePlans, ...nextPlans },
        clipEdits: { ...clipEdits, ...nextEdits },
        selected: [...new Set(orderedIds)],
      };
    } catch (error) {
      setModeNotice(error instanceof Error ? `智能选材失败：${error.message}` : '智能选材失败，请重试。');
    } finally {
      setMaterialSelectLoading(false);
    }
  };

  const localDemoFillSignatureRef = useRef('');
  useEffect(() => {
    if (!localGateBypass || !socialContentTaskId || mode !== 'clone' || contentMode !== 'video'
      || sourceDraftCheckPending || existingSourceDraftPrompt
      || !storyboardSlots.length || !materials.length) return;
    const preferredIds = contentCreationDemoMaterialIds(materials);
    if (!preferredIds.length) return;
    const signature = [
      projectId || socialContentTaskId || 'unsaved',
      storyboardSlots.map(slot => slot.id).join(','),
      materials.filter(item => item.type !== 'audio').map(item => item.id).join(','),
      socialShotMaterialBindings.map(item => `${item.shotIndex}:${item.materialId}`).join(','),
    ].join('|');
    if (localDemoFillSignatureRef.current === signature) return;
    localDemoFillSignatureRef.current = signature;
    fillLocalDemoMaterials(preferredIds);
  }, [contentMode, existingSourceDraftPrompt, localGateBypass, materials, mode, projectId, socialContentTaskId, socialShotMaterialBindings, sourceDraftCheckPending, storyboardSlots]); // eslint-disable-line react-hooks/exhaustive-deps

  const generateFromMaterialLibrary = async () => {
    if (!localGateBypass && !enterpriseScriptLanguage) {
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
      let pool = selectedVisualClips;
      if (!localGateBypass && pool.length === 0) {
        setModeNotice('请先在创作设置中明确选择本次要使用的视频或图片，再生成脚本。');
        setShowSetupMaterialPicker(true);
        return false;
      }
      const editable = pool.filter(item => item.scope !== 'shared');
      const analyzed = await ensureMaterialAnalysis(editable.map(item => item.id), isCurrentRequest, setModeActionStatus);
      if (!isCurrentRequest()) return false;
      const fresh = new Map(analyzed.map(item => [item.id, materialToClip(item)]));
      pool = pool.map(item => fresh.get(item.id) || item);
      setMaterials(current => current.map(item => fresh.get(item.id) || item));
      const preferred = pool.map(item => item.id);
      const hookOnly = hookMaterialId && pool.some(item => item.id === hookMaterialId);
      const selectResp = hookOnly ? { selectedIds: [hookMaterialId] } : pickMaterialClipsLocally(pool, duration, preferred);
      const nextSelected = (selectResp.selectedIds || []).filter(id => pool.some(item => item.id === id));
      const finalSelected = hookOnly ? [hookMaterialId] : preferred;
      const selectedMaterialsForScript = finalSelected.map(id => pool.find(item => item.id === id)).filter(Boolean) as Clip[];
      if (hookMaterialId) selectedMaterialsForScript.sort((a, b) => Number(b.id === hookMaterialId) - Number(a.id === hookMaterialId));
      const names = selectedMaterialsForScript.map(item => item.name);
      const materialInfos: ReturnType<typeof buildMaterialInfosForScript> = !hookOnly && selectedMaterialsForScript.every(item=>item.type==='video')
        ? materialShotPlan(selectedMaterialsForScript,duration)
        : buildMaterialInfosForScript(selectedMaterialsForScript, duration, hookMaterialId);
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
            language: enterpriseScriptLanguage,
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
            existingScripts: [...modeScripts.filter(item => item.mode === 'material').map(item => item.script), ...outputs.map(item => item.script)],
            variantSeed: modeScripts.filter(item => item.mode === 'material').length + i,
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
      setLang(enterpriseScriptLanguage);
      setScriptType('storyboard');
      if (outputs[0]) {
        applyTimestampScript(outputs[0].script, activeProductInfo, false);
        setActiveVoiceLang(enterpriseScriptLanguage);
        setScriptView('timestamp');
        setActiveModeScriptId(outputs[0].id);
      }
      setModeScripts(current => [...current, ...outputs]);
      setProjectTitle(projectTitle === '未命名草稿' ? `素材库创作 · ${langZh(enterpriseScriptLanguage) || enterpriseScriptLanguage}口播脚本` : projectTitle);
      const defaultSuccessNotice = hookOnly
        ? `已仅根据钩子素材生成分镜规划；本步骤未补充其他素材，下一步将从第二个分镜开始匹配。`
        : coveredDuration + 0.1 < duration
          ? `当前素材有效动作约 ${coveredDuration.toFixed(1)} 秒，短于目标 ${duration} 秒；已按真实可用时长生成分镜，请补充素材后再完成成片。`
          : `已生成${langZh(enterpriseScriptLanguage) || enterpriseScriptLanguage}口播脚本，并按 ${Math.max(1, sceneCount)} 个分镜准备了 ${recommendedIds.length || finalSelected.length} 个素材候选，下一步可确认。`;
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
    if (!enterpriseScriptLanguage) {
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
            language: enterpriseScriptLanguage,
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
            existingScripts: [...modeScripts.filter(item => item.mode === 'product').map(item => item.script), ...outputs.map(item => item.script)],
            variantSeed: modeScripts.filter(item => item.mode === 'product').length + i,
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
      setLang(enterpriseScriptLanguage);
      setScriptType('storyboard');
      applyTimestampScript(firstScript, activeProductInfo, false);
      setActiveVoiceLang(enterpriseScriptLanguage);
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

  const applyTimestampScript = (value: string, productInfoOverride = activeProductInfo, invalidateGeneration = true) => {
    const cleaned = normalizeScriptTimestamps(sanitizeStoryboardScript(value, productInfoOverride, activeProductLabel));
    const spoken = extractVoiceoverText(cleaned);
    const sourceLanguage = detectScriptLanguageCode(spoken);
    setScript(cleaned);
    if (invalidateGeneration && activeModeScriptId) {
      setModeScripts(current => current.map(item => item.id === activeModeScriptId ? manualScriptDraft(item, cleaned) : item));
    }
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
    applyTimestampScript(item.script, activeProductInfo, false);
  };

  useEffect(() => {
    if (activeModeScriptId || !modeScripts.length) return;
    const firstForMode = modeScripts.find(item => item.mode === mode);
    if (firstForMode) setActiveModeScriptId(firstForMode.id);
  }, [activeModeScriptId, mode, modeScripts]);

  const generateTimestampScriptsForMode = async () => {
    const validation = validateStudioScriptGenerationInput({
      mode,
      language: enterpriseScriptLanguage,
      productInfo: activeProductInfo,
      productLabel: activeProductLabel,
      selectedMaterialCount: selectedVisualClips.length,
      hasReferenceAnalysis: Boolean(videoKickoff?.referenceAnalysis?.details?.length),
      duration,
    });
    if (!localGateBypass && !validation.ok) {
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
    if (!localGateBypass && !videoKickoff?.referenceAnalysis?.details?.length) {
      setModeNotice('已停止生成：当前草稿缺少真实对标逐镜分析，请返回灵感中心完成全片分析后再生成。');
      return false;
    }
    if (!localGateBypass && hasIncompleteReferenceAnalysis(videoKickoff)) {
      const analyzedUntil = referenceAnalysisEnd(videoKickoff);
      setModeNotice(`已停止生成：当前逐镜结构覆盖到 ${analyzedUntil.toFixed(1)} 秒，但时间线存在明显缺口、重叠或未分析片段。请返回灵感中心补全原片证据。`);
      return false;
    }
    const cloneProductInfo = activeProductInfo.trim()
      || videoKickoff?.productInfo?.trim()
      || script.trim()
      || '当前爆款复刻脚本';
    const cloneProductLabel = activeProductLabel || selectedProductLabel(cloneProductInfo);
    if (!localGateBypass && mode === 'clone' && !activeProductInfo.trim()) {
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
      const cloneReference = videoKickoff || ({
        source: 'inspiration',
        referenceAnalysis: { details: [] },
      } as VideoKickoff);
      const targetCodes = cloneOutputMode === 'languages'
        ? enterpriseVoiceLangs.slice(0, Math.max(1, cloneCount))
        : Array.from({ length: cloneCount }, () => enterpriseScriptLanguage);
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
        applyTimestampScript(firstNewScript.script, activeProductInfo, false);
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
          language: enterpriseScriptLanguage,
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
      applyTimestampScript(sanitizedOptimized, activeProductInfo, false);
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

  const extractVoiceoverText = (value: string) => {
    return formatVoiceoverWithTimestamps(value);
  };

  const cancelVoiceDraftGeneration = () => {
    const controller = voiceDraftAbortRef.current;
    if (!controller) return;
    controller.abort();
    setVoiceDraftFailedLangs(current => [...new Set([...current, ...voiceDraftPendingLangs])]);
    setVoiceDraftStaleLangs(current => [...new Set([...current, ...voiceDraftPendingLangs])]);
    setVoiceDraftPendingLangs([]);
    setVoiceDraftLoading(false);
    setVoiceDraftNotice('已取消翻译；已完成的语种已保留，未完成语种可重新翻译。');
  };

  const generateVoiceDrafts = async () => {
    const runId = ++voiceDraftRunRef.current;
    voiceDraftAbortRef.current?.abort();
    const controller = new AbortController();
    voiceDraftAbortRef.current = controller;
    const isCurrentRequest = () => voiceDraftAbortRef.current === controller;
    const sourceText = scriptView === 'voiceover' ? (voiceoverLines || script) : script;
    const base = selectCompleteVoiceoverSource(script, sourceText);
    setVoiceoverLines(base);
    setVoiceDraftLoading(true);
    setVoiceDraftFailedLangs([]);
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
      const existingAudioCodes = langs.filter(code => Boolean(voiceoverAudios[code]?.url));
      if (existingAudioCodes.length) setVoiceoverStaleLangs(current => [...new Set([...current, ...existingAudioCodes])]);
      const immediate: Record<string, string> = { ...voiceDrafts, [sourceLanguage]: normalizeScriptTimestamps(base) };
      setVoiceDrafts(immediate);
      setActiveVoiceLang(sourceLanguage);
      setLang(sourceLanguage);
      setScriptView('voiceover');

      const improved: Record<string, string> = { ...immediate };
      const targets = langs.filter(code => code !== sourceLanguage);
      setVoiceDraftPendingLangs(targets);
      setVoiceDraftNotice(targets.length
          ? `已识别${langZh(sourceLanguage) || sourceLanguage}口播，正在批量翻译 ${targets.length} 个语种；可切换到其他栏目，任务会继续在后台运行。`
        : '');
      const failedLangs = new Set<string>();
      const failureReasons = new Map<string, string>();
      let translateError = '';
      if (targets.length) {
        const translated = await runVoiceTranslationWithTimeout(
          signal => studioApi.translateBatch(
            { text: normalizeScriptTimestamps(base), targets, source: sourceLanguage },
            { signal },
          ),
          controller.signal,
          VOICE_TRANSLATION_BATCH_TIMEOUT_MS,
        ).catch((err: any) => ({ ok: false, translations: {} as Record<string, string>, error: err?.message || '请求失败' }));
        if (controller.signal.aborted) throw new DOMException('翻译已取消', 'AbortError');
        translateError = translated.error || '';
        const unresolved: string[] = [];
        for (const code of targets) {
          const raw = translated.translations?.[code] || '';
          const normalized = raw.trim()
            ? resolveTranslatedVoiceover(base, raw, code)
            : '';
          if (normalized.trim()) {
            improved[code] = normalized;
            setVoiceDrafts(current => ({ ...current, [code]: normalized }));
          } else {
            unresolved.push(code);
          }
        }
        setVoiceDraftPendingLangs(unresolved);
        if (unresolved.length) {
          setVoiceDraftNotice(`批量翻译已返回 ${targets.length - unresolved.length}/${targets.length} 个语种，正在并行重试其余 ${unresolved.length} 个...`);
          await Promise.all(unresolved.map(async code => {
            let normalized = '';
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
              failureReason = single.error || failureReason;
            } catch (err: any) {
              failureReason = err?.message || failureReason;
            }
            if (controller.signal.aborted || !isCurrentRequest()) return;
            if (normalized.trim()) {
              improved[code] = normalized;
              setVoiceDrafts(current => ({ ...current, [code]: normalized }));
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
      setVoiceDrafts(improved);
      setVoiceDraftPendingLangs([]);
      setVoiceDraftFailedLangs(failed);
      setVoiceDraftNotice(failed.length
        ? `已生成 ${langs.length - failed.length}/${langs.length} 个语种；${failed.map(code => LANGS.find(item => item.code === code)?.label || code).join('、')} 翻译失败：${firstFailureReason || '模型未返回有效译文'}。可再次点击重试。`
        : '');
      setVoiceDraftStaleLangs(failed);
    } catch (err: any) {
      if (isCurrentRequest()) {
        setVoiceDraftPendingLangs([]);
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
      const normalized = code === sourceLanguage
        ? normalizeScriptTimestamps(base)
        : await studioApi.translate({ text: normalizeScriptTimestamps(base), target: code, source: sourceLanguage })
          .then(result => result.ok && result.text.trim() ? resolveTranslatedVoiceover(base, result.text, code) : Promise.reject(new Error(result.error || '模型未返回有效译文')));
      if (!isCurrentSpec()) return;
      if (!normalized.trim()) throw new Error('模型未返回有效译文');
      setVoiceDrafts(current => ({ ...current, [code]: normalized }));
      setVoiceDraftStaleLangs(current => current.filter(item => item !== code));
      setVoiceDraftNotice(`${LANGS.find(item => item.code === code)?.label || code}文案已更新，其他已完成语言保持不变。`);
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
      const result = await studioApi.covers({ script, productInfo: activeProductInfo, language: lang, provider, tone }, [coverTitle]);
      if (!result.ok || result.source !== 'ai' || !result.covers[0]) throw new Error(result.error || '封面标题生成失败，原标题已保留。');
      setCoverTitle(result.covers[0]);
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

  // Never seed a cover with generic promotional claims (years, shipping
  // promises, popularity). Until the user asks AI to rewrite it, the verified
  // enterprise product name is the only safe default.
  useEffect(() => {
    if (step !== 'cover' || (coverTitle.trim() && !isUnverifiedLegacyCoverTitle(coverTitle))) return;
    setCoverTitle(activeProductLabel.trim() || projectTitle.trim() || '产品实拍');
  }, [activeProductLabel, coverTitle, projectTitle, step]);

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
  const startPreview = async (voiceSourceOverride?: string) => {
    if (rendering) return;
    if (previewTimeline.length === 0) { setPreviewNote(true); return; }
    const requestId = ++previewStartRequestRef.current;
    const requestedVoiceUrl = typeof voiceSourceOverride === 'string' ? voiceSourceOverride : voiceoverUrl || '';
    const needsVoice = previewVoiceOn && voiceoverMode !== 'none';
    setPreviewPreparing(true);
    setPreviewPlaybackError('');
    setPreviewNote(false);
    try {
      if (needsVoice) {
        if (!requestedVoiceUrl) throw new Error('当前版本没有可用的口播文件');
        const playableVoiceUrl = await withStudioTimeout(authenticatedAudioBlobUrl(requestedVoiceUrl), 20_000);
        if (requestId !== previewStartRequestRef.current) return;
        setPreviewVoicePlayableUrl(playableVoiceUrl);
        const voiceEl = previewVoiceAudioRef.current;
        if (!voiceEl) throw new Error('口播播放器尚未初始化');
        if (voiceEl.src !== playableVoiceUrl) {
          voiceEl.pause();
          voiceEl.src = playableVoiceUrl;
          voiceEl.dataset.sourceUrl = requestedVoiceUrl;
          voiceEl.load();
        }
        await waitForStudioMediaReady(voiceEl, 8_000);
        if (requestId !== previewStartRequestRef.current) return;
        voiceEl.currentTime = 0;
      }
      setPreviewVideoReady(false);
      setPreviewTime(0);
      setPreviewIdx(0);
    } catch (error: unknown) {
      if (requestId !== previewStartRequestRef.current) return;
      const message = error instanceof Error ? error.message : String(error || '未知错误');
      setPreviewPlaybackError(`预览准备失败：${message}`);
    } finally {
      if (requestId === previewStartRequestRef.current) setPreviewPreparing(false);
    }
  };
  const previewLanguageVersion = (code: string, autoPlay = true) => {
    const audio = voiceoverMode === 'ai' ? voiceoverAudios[code] : { url: voiceoverUrl || '', duration: voiceoverDur };
    if (autoPlay) stopPreview();
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
    setPreviewVideoReady(false);
    void startPreview(audio?.url || '');
  };
  const stopPreview = () => {
    previewStartRequestRef.current += 1;
    clearPreviewAdvanceTimer();
    previewAdvanceLockRef.current = false;
    setPreviewPreparing(false);
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
    setPreviewVideoReady(false);
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
    const currentItem = previewIdx === null ? null : previewTimeline[previewIdx];
    const base = previewIdx === null ? 0 : previewOffsetByIndex[previewIdx] || 0;
    const video = currentItem?.clip.type === 'video' ? previewVideoRef.current : null;
    const trimStart = currentItem?.trimStart || 0;
    const speed = Math.max(0.25, Math.min(currentItem?.speed || 1, 4));
    const local = video ? Math.max(0, (video.currentTime || trimStart) - trimStart) / speed : 0;
    const expectedTime = Math.max(0, base + local);
    [previewBgmAudioRef.current, previewVoiceAudioRef.current].forEach(el => {
      if (!el || !el.src || el.volume <= 0) return;
      try {
        const targetTime = el.loop && Number.isFinite(el.duration) && el.duration > 0
          ? expectedTime % el.duration
          : expectedTime;
        if (Number.isFinite(targetTime) && Math.abs((el.currentTime || 0) - targetTime) > 0.18) el.currentTime = targetTime;
      } catch { /* wait for metadata before the next playing event */ }
      void el.play().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error || '浏览器拒绝播放');
        setPreviewPlaybackError(`音轨播放失败：${message}`);
      });
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
    setPreviewPlaybackError('');
    setPreviewVideoReady(false);
    setPreviewTime(offset);
    setPreviewIdx(index);
    [previewBgmAudioRef.current, previewVoiceAudioRef.current].forEach(el => {
      if (!el?.src) return;
      try { el.currentTime = offset; } catch { /* ignore seek edge cases */ }
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
    const offset = previewOffsetByIndex[previewIdx] || 0;
    setPreviewTime(offset);
    if (item.clip.type === 'image') {
      resumePreviewAudio();
      previewAdvanceTimerRef.current = window.setTimeout(handlePreviewClipEnded, durationMs);
      return () => clearPreviewAdvanceTimer();
    }
    // Never advance the storyboard while a remote clip is still buffering.
    // `timeupdate` below advances at the real media clock instead of wall time.
    if (!previewVideoReady) return;
    const video = previewVideoRef.current;
    if (video) {
      video.playbackRate = Math.max(0.25, Math.min(item.speed || 1, 4));
      const seekTo = Math.max(0, item.trimStart || 0);
      const applySeek = () => {
        try {
          if (Number.isFinite(video.duration) && video.duration > seekTo) video.currentTime = seekTo;
          else video.currentTime = seekTo;
        } catch { /* ignore browser seek edge cases */ }
        void video.play().catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error || '浏览器拒绝播放');
          setPreviewPlaybackError(`视频播放失败：${message}`);
        });
      };
      if (video.readyState >= 1) applySeek();
      else video.onloadedmetadata = applySeek;
    }
    return () => clearPreviewAdvanceTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewIdx, previewOffsetByIndex, previewTimeline, previewVideoReady]);
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
    const bgmGain = previewBgmOn ? Math.max(0, Math.min(1, (bgmVol || 0) / 100)) : 0;
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
      void bgmEl.play().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error || '浏览器拒绝播放');
        setPreviewPlaybackError(`背景音乐播放失败：${message}`);
      });
    }
    if (voiceEl && currentVoiceUrl && voiceGain > 0) {
      if (voiceEl.src !== new URL(currentVoiceUrl, window.location.href).href) voiceEl.src = currentVoiceUrl;
      voiceEl.currentTime = Math.max(0, previewTime);
      void voiceEl.play().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error || '浏览器拒绝播放');
        setPreviewPlaybackError(`口播播放失败：${message}`);
      });
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

  const downloadMp4 = async (filePath = renderOutputPath) => {
    if (rendering) return;
    setRenderDownloadMessage('');
    try {
      const outputPath = filePath || await goPreview();
      if (!outputPath) throw Error('成片尚未生成');
      const response = await fetch('/api/overseas/studio/library/download-file', { method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' }, body: JSON.stringify({ path: outputPath }) });
      if (!response.ok) throw Error('文件不可下载，请检查文件是否存在或已同步到服务器');
      const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
      link.href = url; link.download = '成片.mp4'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      setRenderDownloadMessage('成片已开始下载');
    } catch (error) { setRenderDownloadMessage((error as Error).message); }
  };
  const saveToWorks = async () => {
    if (!await saveProject('ready_for_approval')) return; // 保存作品不等于平台发布
    setSavedToWorks(true);
    setTimeout(() => setSavedToWorks(false), 2200);
  };

  const currentPublishGeneration = () => ({
    generationKind: 'script' as const,
    generationProvenance: activeScriptQualityApplies
      ? String(activeScriptQualityItem?.generationProvenance || activeScriptQualityItem?.generationSource || '')
      : 'manual_draft',
    qualityStatus: activeScriptQualityApplies ? String(activeScriptQualityStatus || 'unreviewed') : 'unreviewed',
    publishable: activeScriptGenerationIsVerified,
    generationRecordId: activeScriptQualityApplies ? String(activeScriptQualityItem?.id || '') : '',
  });

  const buildPublishVersions = (): StudioPublishItem[] => {
    const publishPlatform = platform as StudioPublishPlatform;
    const baseTitle = projectTitle.trim() || coverTitle || 'AI 快剪成片';
    const seenPaths = new Set<string>();

    return buildRenderableVideoVersions().map(({ plan, planIndex, code, languageIndex, bgmId, key }) => {
      const latestDone = (languageRenderVersions[key] || []).find(item => item.status === 'done' && item.path);
      const output = languageRenderOutputs[key];
      const path = (output?.status === 'done' ? output.path : '')
        || latestDone?.path
        || (key === activeRenderCombinationKey ? renderOutputPath : '');
      const videoPath = String(path || '').trim();
      if (!videoPath) return null;
      if (videoPath && seenPaths.has(videoPath)) return null;
      if (videoPath) seenPaths.add(videoPath);
      const versionName = `${plan.name || `视频${planIndex + 1}`} * ${langZh(code) || `语种${languageIndex + 1}`}`;
      return {
        ...currentPublishGeneration(),
        videoPath,
        previewUrl: output?.previewUrl || latestDone?.previewUrl || (key === activeRenderCombinationKey ? renderOutputPreviewUrl || undefined : undefined),
        title: `${baseTitle} - ${versionName}`,
        description: (code === activeVoiceLang ? caption.trim() : '') || voiceDrafts[code] || activeSpokenScript,
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
      ...currentPublishGeneration(),
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
  }, [activeModeScriptId, activeRenderCombinationKey, activeVoiceLang, assemblyBgms, bgm, caption, contentPlanVersions, languageRenderOutputs, languageRenderVersions, materialVersionBgms, modeScripts, platform, projectId, projectTitle, publishStorageScope, ratio, renderOutputPath, renderOutputPreviewUrl, voiceDrafts, voiceLangs, voiceoverAudios, voiceoverMode, voiceoverUrl]);

  const goPublishCurrentWork = () => {
    const payload = buildPublishPayload();
    const items = payload.items?.length ? payload.items : [payload];
    if (!activeScriptGenerationIsVerified) {
      setModeNotice('当前脚本不是与正文一致且已通过质量校验的 AI 版本。请重新生成或审核后再进入发布。');
      return;
    }
    if (Object.keys(shotProductions).length && items.some(item => item.videoPath && renderProductionSignatures[item.videoPath] !== productionSignature)) {
      setModeNotice('镜头或声音已修改，当前成片版本与草稿不一致。请重新生成并确认成片后发布；已排期成片不会被替换。'); return;
    }
    if (!items.some(item => Boolean(item.videoPath?.trim()))) return;
    onGoPublish?.(payload);
  };

  const aiCaption = async () => {
    setCaptionLoading(true);
    try {
      const result = await studioApi.caption(
        { script, productInfo: activeProductInfo, platform, language: lang, provider, audience, sellingPoints, tone },
        { caption, hashtags: [] },
      );
      if (!result.ok || result.source !== 'ai' || !result.caption.trim()) throw new Error(result.error || '发布文案生成失败，原文案已保留。');
      const { caption: cap, hashtags } = result;
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
    if (!activeProductInfo.trim() || !activeProductLabel) {
      setModeNotice('生成商业图文前必须先选择企业中心已确认的产品资料；缺少资料时不会创建本地营销话术。');
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
        if (!result.ok || result.source !== 'ai' || result.items.length < 3) throw new Error(result.error || '获客内容包生成失败');
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
          provenance: result.provenance || 'ai',
          qualityStatus: result.qualityStatus || 'needs_confirmation',
          publishable: result.publishable === true && result.qualityStatus === 'passed' && result.fieldsToConfirm.length === 0,
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
      if (!result.ok || result.source !== 'ai' || !result.poster?.headline) throw new Error(result.error || '海报文案生成失败');
      const generatedPoster = result.poster;
      setPosterDraft(result);
      setPosterJsonText(JSON.stringify(generatedPoster, null, 2));
      const tags = (result.hashtags || []).map(tag => `#${String(tag).replace(/^#/, '')}`).join(' ');
      setCaption([result.caption, tags].filter(Boolean).join(' '));
      setModeNotice('正在生成海报图...');
      try {
        const rendered = await studioApi.fbPosterRender({
          poster: generatedPoster,
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
      const generatedScriptId = `demo-${Date.now()}`;
      setModeScripts(current => [...current, {
        id: generatedScriptId,
        title: 'AI 自动生成脚本',
        script: scriptResp.script,
        mode,
        contentTheme: activeVideoTheme.id,
        buyerLabel: audience.trim() || '默认买家',
        ...qualityFields(scriptResp),
      }]);
      setActiveModeScriptId(generatedScriptId);
      setModeNotice(qualitySuccessNotice(scriptResp, '脚本与发布内容已生成。'));
      const coversResp = await studioApi.covers({ script: scriptResp.script, productInfo: activeProductInfo, language: lang, provider, tone }, [coverTitle]);
      if (!coversResp.ok || coversResp.source !== 'ai' || !coversResp.covers[0]) throw new Error(coversResp.error || '封面标题生成失败');
      setCoverTitle(coversResp.covers[0]);
      const cap = await studioApi.caption(
        { script: scriptResp.script, productInfo: activeProductInfo, platform, language: lang, provider, audience, sellingPoints, tone },
        { caption, hashtags: [] },
      );
      if (!cap.ok || cap.source !== 'ai' || !cap.caption.trim()) throw new Error(cap.error || '发布文案生成失败');
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
    try {
      const real = await studioApi.listMaterials('all');
      const realClips = real.map(materialToClip);
      setMaterials(current => mergeClipLists(realClips, current.filter(item => item.sourceType === 'project-snapshot' || item.sourceType === 'historical-kickoff')));
    } catch { /* retain the last inventory; MaterialLibraryStatus offers retry */ }
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
    } catch { return undefined; } finally {
      materialSourceRefreshesRef.current.delete(materialId);
    }
  };
  useEffect(() => { void refreshMaterials(); }, []);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void readScriptGapTasks().then(tasks => { if (!cancelled) setShootingTasks(tasks); })
        .catch(() => { if (!cancelled && projectId) setModeNotice('待拍任务读取失败，可稍后返回草稿重试。'); });
      void refreshMaterials();
    };
    refresh();
    window.addEventListener(SCRIPT_GAP_QUEUE_EVENT, refresh);
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; window.removeEventListener(SCRIPT_GAP_QUEUE_EVENT, refresh); window.removeEventListener('focus', refresh); };
  }, [projectId]);
  useEffect(() => {
    if (!projectId || published || sourceDraftCheckPending || existingSourceDraftPrompt) return;
    const assignments = { ...storyboardAssignments };
    const edits: Record<string, ClipEdit> = {};
    const adopted: string[] = [];
    const plans: Record<string, StoryboardSourcePlan> = {};
    const adoptions: Record<string, string> = {};
    const productionPatches: Record<string, ShotProduction> = {};
    for (const task of shootingTasks) {
      if (shootingAdoptions[task.id]) continue;
      if (task.soundMode !== 'source' && task.soundMode !== 'silent' && !['ai', 'upload', 'none'].includes(voiceoverMode)) continue;
      const target = shootingRefillTarget(task, { projectId, assemblyId: activeAssemblyId, slots: shootingSlots, assignments,
        confirmed: Object.fromEntries(Object.entries(storyboardSourcePlans).map(([id, plan]) => [id, plan.confirmed])) });
      if (!target.slot) continue;
      const candidate = task.uploadedMaterialIds.map(id => materialById.get(id)).find(clip => clip?.type === 'video'
        && Boolean(clip.url) && clip.duration >= target.slot!.duration && Boolean(clipAspectRatio(clip)) && isClipCompatibleWithRatio(clip, ratio)
        && (task.soundMode !== 'source' || transcriptMatches(clip.transcript, task.expectedNarration)));
      const slot = storyboardSlots.find(item => item.id === target.slot!.slotId);
      if (!candidate || !slot) continue;
      if (productionFor(slot).locked) continue;
      assignments[slot.id] = candidate.id;
      edits[slotClipEditKey(slot.id, candidate.id)] = defaultEditForSlot(candidate, slot);
      if (task.soundMode === 'source') {
        edits[slotClipEditKey(slot.id, candidate.id)] = { ...defaultEditForSlot(candidate, slot), trimStart: 0, trimEnd: candidate.duration, speed: 1, targetDuration: candidate.duration, targetDurationEdited: true };
        productionPatches[productionKey(slot.id)] = { ...productionFor(slot), source: 'shoot', sound: 'source', narration: task.expectedNarration || candidate.transcript || '' };
      }
      const production = productionPatches[productionKey(slot.id)] || { ...productionFor(slot), source: 'shoot' as const };
      const candidateId = `shoot-${task.id}-${candidate.id}`;
      productionPatches[productionKey(slot.id)] = { ...production, adoptedId: candidateId, candidates: [...production.candidates, { id: candidateId, materialId: candidate.id, source: 'shoot', fingerprint: productionFingerprint(slot, production), createdAt: new Date().toISOString() }] };
      plans[slot.id] = { mode: 'local', decided: true, confirmed: false, critical: false };
      adopted.push(candidate.id);
      adoptions[task.id] = candidate.id;
    }
    if (adopted.length) {
      setStoryboardAssignments(assignments);
      setClipEdits(current => ({ ...current, ...edits }));
      setStoryboardSourcePlans(current => ({ ...current, ...plans }));
      setSelected(current => [...new Set([...current, ...adopted])]);
      setShootingAdoptions(current => ({ ...current, ...adoptions }));
      setShotProductions(current => ({ ...current, ...productionPatches }));
      setModeNotice(`已为 ${adopted.length} 个空镜头补位拍摄视频，并按任务声音方式处理。请预览并保存；其他候选仍在素材库。`);
    }
  }, [projectId, published, sourceDraftCheckPending, existingSourceDraftPrompt, voiceoverMode, activeAssemblyId, shootingTasks, shootingSlots, shootingAdoptions, storyboardAssignments, storyboardSourcePlans, materialById, ratio]);
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
    const uploadErrors: string[] = [];
    const targetFolder = activeFolder && !['all', 'hot', 'recommend'].includes(activeFolder) ? activeFolder : 'upload';
    for (const f of Array.from(files)) {
      try {
        const media = await probeMedia(f);
        const { material, ok, error } = await studioApi.uploadMaterialFile(f, {
          folder: targetFolder,
          type: mediaType(f),
          duration: media.duration,
          width: media.width,
          height: media.height,
        });
        if (!ok || !material?.id) throw new Error(error || `「${f.name}」上传失败`);
        if (material?.id) uploadedIds.push(material.id);
      } catch (error) {
        uploadErrors.push(error instanceof Error ? error.message : `「${f.name}」上传失败`);
      }
    }
    await refreshMaterials();
    if (uploadedIds.length) {
      setSelected(s => [...s, ...uploadedIds]);  // 上传完自动选中
      setActiveFolder(targetFolder);
    }
    if (uploadErrors.length) setModeNotice(uploadErrors[0]);
    setUploading(false);
  };

  const generateDigitalHumanPresenter = async () => {
    const slot = storyboardSlots.find(item => item.id === activeStoryboardSlotId) || storyboardSlots[0];
    if (!slot) { setDigitalHumanNotice('请先确认分镜脚本，再为具体镜头配置数字人'); return; }
    openProduction(slot);
    if (!productionFor(slot).locked) {
      setShotProductions(current => ({
        ...current,
        [productionKey(slot.id)]: { ...productionFor(slot), source: 'avatar', sound: 'source' },
      }));
    }
    if (!productionCapability.configured) {
      setDigitalHumanNotice(productionCapability.reason || '数字人服务尚未接入');
    }
  };

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
        if (transcription.ok && transcription.matches !== false && transcription.text && transcription.cues?.length) {
          const code = activeVoiceLang || 'zh';
          setVoiceoverLines(transcription.text);
          setVoiceDrafts(current => ({ ...current, [code]: transcription.text }));
          setAlignedCuesByLang(current => ({ ...current, [code]: transcription.cues }));
          setVoiceoverAudios({ [code]: { url: r.url, duration: audioDuration, cues: transcription.cues, text: transcription.text, alignmentSource: transcription.source } });
          setTtsNotice(transcription.source === 'audio_ai' || transcription.source === 'qwen_asr'
            ? '已根据上传音频自动识别口播，并生成逐句/逐词字幕时间轴。'
            : '已生成字幕时间轴；当前使用脚本比例对齐，建议播放后人工确认。');
        } else {
          setTtsNotice(`音频已上传，${transcription.matches === false ? '识别内容与当前台词不一致，未覆盖文案。' : transcription.error || '请点击千问转写/刷新，确认提交或读取已有任务。'}`);
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
    setTtsLoading(true);
    setTtsLoadingScope(onlyLanguage ? 'single' : 'all');
    const completeSourceVoiceover = selectCompleteVoiceoverSource(script, voiceoverLines);
    const detectedSourceLanguage = detectScriptLanguageCode(completeSourceVoiceover || extractVoiceoverText(script));
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
      const base = completeSourceVoiceover || extractVoiceoverText(script) || script;
      const sourceLanguage = detectScriptLanguageCode(base);
      const drafts: Record<string, string> = { ...voiceDrafts, [sourceLanguage]: base };
      const missingTranslationLangs: string[] = [];
      const targetsToTranslate: string[] = [];
      for (const code of langs) {
        if (code === sourceLanguage) {
          drafts[sourceLanguage] = base;
        } else if (drafts[code]?.trim() && voiceoverDraftCoversSource(base, drafts[code])) {
          continue;
        } else {
          delete drafts[code];
          targetsToTranslate.push(code);
        }
      }
      if (targetsToTranslate.length) {
        const translated = await studioApi.translateBatch({ text: normalizeScriptTimestamps(base), targets: targetsToTranslate, source: sourceLanguage })
          .catch((err: any) => ({ ok: false, translations: {} as Record<string, string>, error: err?.message || '请求失败' }));
        for (const code of targetsToTranslate) {
          let raw = translated.translations?.[code] || '';
          let normalized = raw.trim()
            ? resolveTranslatedVoiceover(base, raw, code)
            : '';
          if (!normalized.trim()) {
            const single = await withStudioTimeout(studioApi.translate({ text: normalizeScriptTimestamps(base), target: code, source: sourceLanguage }))
              .catch(() => ({ ok: false, text: '' }));
            if (!isCurrentTtsRequest()) return;
            raw = single.ok ? single.text : '';
            normalized = raw.trim() ? resolveTranslatedVoiceover(base, raw, code) : '';
          }
          if (normalized.trim()) drafts[code] = normalized;
          else missingTranslationLangs.push(`${code}:${translated.error || '模型未返回有效译文'}`);
        }
      }
      if (!isCurrentTtsRequest()) return;
      setVoiceoverLines(base);
      setVoiceDrafts(drafts);

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
            if (r.cues?.length && isMeasuredVoiceAlignment(r.alignmentSource)) aligned[code] = r.cues;
            if (r.text?.trim()) {
              // TTS providers return plain spoken text without storyboard
              // timestamps. Keep/rebuild the cue timeline here; replacing the
              // draft with plain text makes the completed audio fail the next
              // step's coverage gate after autosave or reload.
              drafts[code] = resolveTranslatedVoiceover(completeSourceVoiceover, r.text, code)
                || drafts[code]
                || r.text;
            }
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
        if (isMeasuredVoiceAlignment(audio.alignmentSource) && audio.cues?.length) {
          aligned[code] = audio.cues;
          return;
        }
        if (!text || !audio.url || !audio.duration) return;
        const result = await studioApi.alignTts({ text, url: audio.url, duration: audio.duration });
        if (result.ok && result.cues?.length && isMeasuredVoiceAlignment(result.source)) {
          audio.cues = result.cues;
          audio.alignmentSource = result.source;
          aligned[code] = result.cues;
        } else {
          audio.alignmentSource = 'pending_alignment';
          delete aligned[code];
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
      setVoiceDrafts({ ...drafts });
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
      setTtsNotice(failures.length || missingTranslationLangs.length
        ? `本次已生成 ${availableLangs.length - failures.length}/${langs.length} 个语种配音；${[...failures, ...missingTranslationLangs.map(item => {
          const [code, reason] = item.split(':');
          return `${LANGS.find(langItem => langItem.code === code)?.label || code}：翻译失败，未生成配音（${reason || '未知原因'}）`;
        })].join('；')}`
        : voice.startsWith('custom:') && Object.values(audios).some(item => item.customVoiceStatus === 'activated')
          ? `已生成 ${langs.length} 个语种配音，真人音色已通过正式 TTS 激活并保存。下一步可一键生成字幕。`
          : `已生成 ${langs.length} 个语种配音。下一步可一键生成字幕。`);
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
    setVoiceoverAudios(current => current[activeVoiceLang] ? { ...current, [activeVoiceLang]: { ...current[activeVoiceLang], alignmentSource: 'manual_pending' } } : current);
    setAlignedCuesByLang(current => {
      const base = current[activeVoiceLang]?.length ? current[activeVoiceLang] : cues;
      const next = base.map((cue, cueIndex) => cueIndex === index ? { ...cue, ...patch, words: undefined } : cue);
      return { ...current, [activeVoiceLang]: next };
    });
  };
  const refreshQwenAsr = async () => {
    if (ttsLoading || !productionAudioUrl) return;
    const context = asrContextRef.current; const code = activeVoiceLang;
    const audioDuration = voiceoverMode === 'ai' ? voiceoverAudios[code]?.duration || 0 : voiceoverDur;
    const request = { url: productionAudioUrl, duration: audioDuration, text: voiceDrafts[code] || activeSpokenScript };
    setTtsLoading(true); setTtsNotice('正在读取千问转写任务；命中缓存不会重新扣费…');
    try {
      let result = await studioApi.qwenAsr(request);
      if (asrContextRef.current !== context) return;
      if (result.status === 'needs_confirmation') {
        if (!window.confirm(`此音频暂无千问转写缓存，将提交 ${audioDuration.toFixed(1)} 秒音频并产生ASR费用。北京公开原价0.00022元/秒，其他地域及实际费用以账单为准。确认提交？`)) { setTtsNotice('已取消，没有提交转写。'); return; }
        result = await studioApi.qwenAsr({ ...request, confirmed: true });
      }
      if (asrContextRef.current !== context) return;
      if (!result.ok || ['FAILED', 'uncertain', 'submitting'].includes(result.status || '')) throw new Error(result.error || '转写提交状态需人工核对，不自动重复提交');
      if (result.status !== 'SUCCEEDED') { setTtsNotice(`千问转写任务${result.taskId ? ` ${result.taskId}` : ''}处理中，可稍后点击同一按钮刷新，关闭页面后任务仍可恢复。`); return; }
      if (!result.matches) { setTtsNotice(`识别台词与当前文案不一致，未覆盖草稿。识别内容：${result.text}`); return; }
      if (!result.cues?.length) throw new Error('未返回字词时间戳');
      setAlignedCuesByLang(current => ({ ...current, [code]: result.cues! }));
      setVoiceoverAudios(current => ({ ...current, [code]: { ...current[code], url: request.url, duration: audioDuration, cues: result.cues, text: result.text, alignmentSource: 'qwen_asr' } }));
      setRendered(false);
      setTtsNotice('千问字词时间戳已应用，台词核对一致。请保存草稿；旧数字人口型候选需重新核验，不代表人工试听已通过。');
    } catch (error) { if (asrContextRef.current === context) setTtsNotice(error instanceof Error ? error.message : '转写失败'); }
    finally { setTtsLoading(false); }
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
    sourceType: 'project-snapshot',
    industry: item.industry,
    shotFunction: item.shotFunction,
    applicability: item.applicability,
    tags: item.tags,
    segmentAnalysisStatus: item.segmentAnalysisStatus,
    segments: item.segments,
  }));
  const collectSpec = () => {
    let savedShotProductions = shotProductions;
    for (const plan of socialDigitalHumanPlans) {
      const slot = storyboardSlots.find(item => item.id === plan.shotId) || storyboardSlots[plan.shotIndex];
      if (!slot) continue;
      const key = productionKey(slot.id);
      if (!savedShotProductions[key]) savedShotProductions = { ...savedShotProductions, [key]: newProductionFor(slot) };
    }
    return ({
    mode, contentMode, posterStyle, platform, ratio, duration, lang, provider,
    workflowRunId: projectWorkflowContext?.runId || '', workflowTaskId: projectWorkflowContext?.taskId || '', workflowTaskKey: projectWorkflowContext?.taskKey || '',
    activeStepId: step, activeStoryboardSlotId, canvasView, scriptStageTab,
    videoKickoff,
    ...(socialContentTaskId ? { socialContentTaskId } : {}),
    productInfo, productSelectMode, selectedProductIds, referenceProductAssignments, referenceProductTerms, audience, primaryCta, productContentGoal, reachCta, cooperationRoute, sellingPoints, tone,
    videoThemeId, themePainPoint, themeConversionGoal, lastGeneratedSetupSignature, presenterMode, presentationMode, presentationSources,
    selected, scriptRecommendedMaterialIds, storyboardAssignments, storyboardSourcePlans, assemblyName, hookMaterialId, materialSnapshots,
    storyboardAssemblies: assembliesForSave, activeAssemblyId, script, scriptType, voiceoverLines, modeScripts, activeModeScriptId, voice, voiceCandidates,
    bgm, bgmCandidates, platformBgms, assemblyBgms, materialVersionBgms, soundCandidatesPerContent, bgmVol, voiceVol, effectPreset, effectIntensity, disabledEffectSceneIds, cover, coverTitle, coverStyle, capturedCoverFrameUrl, materialVersionCovers, account, caption,
    subtitlesOn, subMode, clipEdits, voiceoverMode, uploadedVoiceName, customVoiceId, customVoiceName, customVoiceUrl,
    ttsPreset, ttsEmotion, ttsEmotionIntensity, ttsSpeed, ttsPauseStyle, ttsPronunciationText, ttsLanguageSettings, voiceLangs, activeVoiceLang, voiceDrafts, voiceDraftStaleLangs, voiceoverStaleLangs,
    voiceoverUrl, voiceoverDur, voiceoverAudios, languageRenderOutputs, languageRenderVersions, referenceVoiceStrength, useReferenceVoiceStyle, alignedCuesByLang,
    storyboardVideoVersions, productVideoVersions,
    variationStrategy, variationPeople, variationScenes, variationLanguages, variationHooks, variationMax,
    shootingSlots, shotProductions: savedShotProductions, shotProductionContext, socialDigitalHumanPlans,
    posterDraft, leadContentPackage, posterJsonText, posterImageUrl,
    });
  };

  const applySpec = (s: Record<string, unknown>) => {
    // Seed the identity before restoring state so loading a draft cannot erase it.
    const restoredProductIds = Array.isArray(s.selectedProductIds) ? s.selectedProductIds as string[] : [];
    cloneProductFingerprintRef.current = restoredProductIds.length
      ? `products:${restoredProductIds.join('|')}`
      : `manual:${String(s.productInfo || '')}`;
    studioSettingsEditedRef.current = true;
    managedProductionProjectRef.current = Boolean(s.workflowRunId && (s.automation as { managedBy?: string } | undefined)?.managedBy === 'digital_employee');
    setProjectWorkflowContext(
      workflowContext?.taskKey === 'content_quality_gate'
        ? workflowContext
        : studioWorkflowContextFromSpec(s),
    );
    studioSpecEpochRef.current += 1;
    scriptTaskRequestRef.current += 1;
    productScriptAbortRef.current?.abort();
    productScriptAbortRef.current = null;
    voiceDraftAbortRef.current?.abort();
    voiceDraftAbortRef.current = null;
    ttsRequestRef.current += 1;
    setVoiceDraftPendingLangs([]);
    setVoiceDraftFailedLangs([]);
    setTtsActiveLangs([]);
    setTtsFailuresByLang({});
    setModeActionLoading(false);
    setModeActionStatus('');
    setScriptLoading(false);
    setMaterialSelectLoading(false);
    setPendingRealCloneGeneration(false);
    setStoryboardGenerating({});
    setStoryboardQualityChecking({});
    shootingSlotsRef.current = Array.isArray(s.shootingSlots) ? s.shootingSlots as ShootingSlot[] : [];
    setShootingIdentityEpoch(current => current + 1);
    setShotProductions(s.shotProductions && typeof s.shotProductions === 'object' ? s.shotProductions as Record<string, ShotProduction> : {});
    setSocialDigitalHumanPlans(Array.isArray(s.socialDigitalHumanPlans) ? s.socialDigitalHumanPlans as StudioSocialTaskSeed['digitalHumanShotPlans'] : []);
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
    const restoredVoiceLangs = restoredLanguageCandidates.length
      ? restoredLanguageCandidates
      : [enterpriseVoiceLangs.includes('en') ? 'en' : enterpriseVoiceLangs[0] || 'zh'];
    const nextVoiceDrafts = restoredVoiceDrafts;
    const nextVoiceoverAudios = restoredVoiceoverAudios;
    const nextAlignedCues = restoredAlignedCues;
    const savedActiveVoiceLang = typeof s.activeVoiceLang === 'string' ? s.activeVoiceLang : '';
    const restoredActiveVoiceLang = restoredVoiceLangs.includes(savedActiveVoiceLang)
      ? savedActiveVoiceLang
      : restoredVoiceLangs.find(code => Boolean(nextVoiceoverAudios[code]?.url)) || restoredVoiceLangs[0] || '';

    setVoiceLangs(restoredVoiceLangs);
    if (restoredActiveVoiceLang) {
      setActiveVoiceLang(restoredActiveVoiceLang);
      setLang(restoredActiveVoiceLang);
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
      ...(Array.isArray(s.materialSnapshots) ? s.materialSnapshots.map(normalizeClipSnapshot).filter((item): item is Clip => Boolean(item)).map(item => ({ ...item, sourceType: 'project-snapshot' })) : []),
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
    const savedStep = s.activeStepId ?? s.workspaceStep;
    const restoredStepId = typeof savedStep === 'string' ? savedStep as StepId : null;
    const restoredLegacyBgmStep = restoredContentMode === 'video' && restoredStepId === 'bgm';
    const restoredStepIndex = restoredLegacyBgmStep ? restoredSteps.findIndex(item => item.id === 'script') : restoredStepId ? restoredSteps.findIndex(item => item.id === restoredStepId) : -1;
    setStepIdx(restoredStepIndex >= 0 ? restoredStepIndex : 0);
    setActiveStoryboardSlotId(typeof s.activeStoryboardSlotId === 'string' ? s.activeStoryboardSlotId : '');
    setCanvasView(s.canvasView === 'reference' ? 'reference' : 'creation');
    const savedScriptStage = s.scriptStageTab ?? s.workspaceScriptStage;
    setScriptStageTab(restoredLegacyBgmStep ? 'bgm' : (['theme', 'script', 'voiceover', 'audio', 'subtitle', 'bgm'] as const).find(stage => stage === savedScriptStage) || 'theme');
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
    if (s.referenceProductAssignments && typeof s.referenceProductAssignments === 'object') setReferenceProductAssignments(s.referenceProductAssignments as Record<string, string>);
    if (s.referenceProductTerms && typeof s.referenceProductTerms === 'object') setReferenceProductTerms(s.referenceProductTerms as Record<string, string>);
    if (typeof s.audience === 'string') setAudience(s.audience);
    if (typeof s.primaryCta === 'string') setPrimaryCta(s.primaryCta);
    setProductContentGoal(s.productContentGoal === 'reach' ? 'reach' : 'leads');
    setReachCta(typeof s.reachCta === 'string' ? s.reachCta : '');
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
    const savedPlan = (s.contentOrder as { videoPlan?: VideoCreationPlan } | undefined)?.videoPlan;
    const savedMode = s.presentationMode || savedPlan?.presenter;
    const nextMode = savedMode === 'heygen' || savedMode === 'avatar' || savedMode === 'material' ? savedMode : s.presenterMode === 'digital' ? 'avatar' : 'material';
    setPresentationMode(nextMode);
    setPresenterMode(nextMode === 'material' ? 'real' : 'digital');
    const restoredSources: Record<string, 'avatar' | 'material'> = {};
    if (s.presentationSources && typeof s.presentationSources === 'object') {
      for (const [key, value] of Object.entries(s.presentationSources)) if (value === 'avatar' || value === 'material') restoredSources[key] = value;
    } else if (savedPlan?.scenePlan?.length) {
      parseStoryboardSlots(String(s.script || ''), Number(s.duration) || 30).forEach((slot, index) => {
        const choice = savedPlan.scenePlan?.[index];
        if (choice) restoredSources[slot.id] = choice.source;
      });
    }
    setPresentationSources(restoredSources);
    if (typeof s.themePainPoint === 'string') setThemePainPoint(s.themePainPoint);
    setThemeConversionGoal(typeof s.themeConversionGoal === 'string' && s.themeConversionGoal.trim()
      ? s.themeConversionGoal
      : DEFAULT_VIDEO_CONVERSION_GOAL);
    if (s.variationStrategy === 'remix' || s.variationStrategy === 'recreate' || s.variationStrategy === 'hybrid') setVariationStrategy(s.variationStrategy);
    if (typeof s.hookMaterialId === 'string') setHookMaterialId(s.hookMaterialId);
    if (Array.isArray(s.selected)) setSelected(s.selected as string[]);
    if (Array.isArray(s.scriptRecommendedMaterialIds)) setScriptRecommendedMaterialIds(s.scriptRecommendedMaterialIds as string[]);
    if (s.storyboardAssignments && typeof s.storyboardAssignments === 'object') setStoryboardAssignments(s.storyboardAssignments as Record<string, string>);
    if (s.storyboardSourcePlans && typeof s.storyboardSourcePlans === 'object') setStoryboardSourcePlans(s.storyboardSourcePlans as Record<string, StoryboardSourcePlan>);
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
    const restoredScript = typeof s.script === 'string' ? s.script : '';
    // Loading a saved project is not a script edit: its translations belong
    // to this snapshot and must not be invalidated by the change effect.
    masterScriptSnapshot.current = restoredScript;
    setScript(restoredScript);
    const restoredSourceLanguage = detectScriptLanguageCode(formatVoiceoverWithTimestamps(restoredScript));
    setVoiceoverLines(typeof s.voiceoverLines === 'string'
      ? s.voiceoverLines
      : restoredVoiceDrafts[restoredSourceLanguage] || formatVoiceoverWithTimestamps(restoredScript));
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
    if (s.languageRenderOutputs && typeof s.languageRenderOutputs === 'object') setLanguageRenderOutputs(s.languageRenderOutputs as typeof languageRenderOutputs);
    if (s.languageRenderVersions && typeof s.languageRenderVersions === 'object') setLanguageRenderVersions(s.languageRenderVersions as typeof languageRenderVersions);
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
    setBgm(typeof s.bgm === 'string' ? s.bgm : '');
    if (Array.isArray(s.bgmCandidates)) setBgmCandidates(s.bgmCandidates as string[]);
    if (s.platformBgms && typeof s.platformBgms === 'object') setPlatformBgms(s.platformBgms as Record<string, string>);
    if (s.assemblyBgms && typeof s.assemblyBgms === 'object') setAssemblyBgms(s.assemblyBgms as Record<string, string>);
    if (s.materialVersionBgms && typeof s.materialVersionBgms === 'object') setMaterialVersionBgms(s.materialVersionBgms as Record<string, string>);
    if (s.soundCandidatesPerContent === 1 || s.soundCandidatesPerContent === 2) setSoundCandidatesPerContent(s.soundCandidatesPerContent);
    if (typeof s.bgmVol === 'number') setBgmVol(s.bgmVol);
    if (typeof s.voiceVol === 'number') setVoiceVol(s.voiceVol);
    if (s.effectPreset === 'natural' || s.effectPreset === 'dynamic' || s.effectPreset === 'tech' || s.effectPreset === 'cinematic') setEffectPreset(s.effectPreset);
    if (s.effectIntensity === 0 || s.effectIntensity === 1 || s.effectIntensity === 2 || s.effectIntensity === 3) setEffectIntensity(s.effectIntensity);
    setDisabledEffectSceneIds(Array.isArray(s.disabledEffectSceneIds) ? s.disabledEffectSceneIds.filter((value): value is string => typeof value === 'string') : []);
    if (s.cover && s.cover !== 'gradient') setCover(s.cover as string);
    if (typeof s.coverTitle === 'string') setCoverTitle(s.coverTitle);
    if (s.coverStyle) setCoverStyle(s.coverStyle as CoverStyle);
    setCapturedCoverFrameUrl(typeof s.capturedCoverFrameUrl === 'string' ? s.capturedCoverFrameUrl : '');
    if (s.materialVersionCovers && typeof s.materialVersionCovers === 'object') setMaterialVersionCovers(s.materialVersionCovers as Record<string, CoverVersionConfig>);
    if (s.account !== undefined) setAccount(s.account as string | null);
    if (typeof s.caption === 'string') setCaption(s.caption);
    setPosterDraft(s.posterDraft && typeof s.posterDraft === 'object' ? s.posterDraft as FbPosterResult : null);
    setLeadContentPackage(s.leadContentPackage && typeof s.leadContentPackage === 'object' ? s.leadContentPackage as LeadContentPackageResult : null);
    setPosterJsonText(typeof s.posterJsonText === 'string' ? s.posterJsonText : '');
    setPosterImageUrl(typeof s.posterImageUrl === 'string' ? s.posterImageUrl : '');
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
    if (managedProductionProjectRef.current) {
      if (!silent) setModeNotice('请使用下方“生产现场：修改配置并继续原任务”，按节点保存，避免覆盖后台结果。');
      return false;
    }
    if (silent && (sourceDraftCheckPending || existingSourceDraftPrompt)) return false;
    if (silent && workflowProjectSelectionPending) return false;
    if (silent && (
      modeActionLoading || scriptLoading || materialSelectLoading || coverLoading
      || rendering || batchRenderingLangs || posterLoading || captionLoading
    )) return false;
    if (voiceDraftLoading || ttsLoading) {
      if (!silent) alert('多语字幕或配音仍在生成，请等待完成后再保存草稿。');
      return false;
    }
    if (agentProduction.active) return false;
    const nextSpec = collectSpec();
    if (!['draft', 'template'].includes(status)) {
      const invalidScript = modeScripts.find(item => {
        const provenance = String(item.generationProvenance || item.generationSource || '').toLowerCase();
        const quality = String(item.qualityStatus || '').toLowerCase();
        return provenance !== 'ai'
          || !quality
          || ['failed', 'rejected', 'fallback', 'unreviewed', 'needs_confirmation'].includes(quality)
          || item.publishable !== true;
      });
      const activeScriptHasVerifiedRecord = !script.trim() || modeScripts.some(item => (
        item.script.trim() === script.trim()
        && String(item.generationProvenance || item.generationSource || '').toLowerCase() === 'ai'
        && Boolean(item.qualityStatus)
        && !['failed', 'rejected', 'fallback', 'unreviewed', 'needs_confirmation'].includes(String(item.qualityStatus).toLowerCase())
        && item.publishable === true
      ));
      if ((contentMode === 'poster' && Boolean(posterJsonText.trim()) && !posterGenerationIsVerified) || invalidScript || (contentMode === 'video' && !activeScriptHasVerifiedRecord)) {
        const reason = contentMode === 'poster'
          ? posterDraft?.fieldsToConfirm?.length
            ? `图文仍有待确认商业字段：${posterDraft.fieldsToConfirm.join('、')}`
            : '图文尚未获得可发布的 AI 事实与质量校验结果'
          : invalidScript
            ? `${invalidScript.title || '脚本'}仍是失败、降级或待复核草稿`
            : '当前脚本缺少与正文一致的 AI 来源、质量和可发布记录';
        setModeNotice(`${reason}。已保留在当前编辑器中；请先保存为草稿，不能直接进入作品交付。`);
        return false;
      }
    }
    if (silent && !projectId && !studioSpecHasMeaningfulContent(nextSpec)) return false;
    if (silent && autosaveInFlightRef.current) return false;
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
      if (!project?.id) throw new Error('草稿保存失败，请重试；当前编辑仍保留在页面中。');
      if (project?.id && status !== 'template') {
        setProjectId(project.id);
        setProjects(current => [project, ...current.filter(item => item.id !== project.id)]);
        if (socialDigitalHumanPlans.length) {
          const syncedPlans = await productionApi.syncAgentPlans(project.id);
          setProductionPlans(current => [...syncedPlans, ...current.filter(item => !syncedPlans.some(synced => synced.id === item.id))]);
        }
        if (!workflowContext && new URLSearchParams(location.search).get('page') === 'smartAssets') {
          const url = new URL(location.href);
          url.searchParams.set('project', project.id);
          history.replaceState(history.state, '', url);
        }
      }
      setAutosaveStatus('saved');
      setLastAutosavedAt(new Date());
      if (!silent) {
        completeDemoStep('traffic');
        setSavedTick(true);
        setTimeout(() => setSavedTick(false), 1800);
      } else {
        setAutosaveStatus('saved');
        setLastAutosavedAt(new Date());
      }
      return true;
    } catch (error) {
      setAutosaveStatus('error');
      if (!silent) throw error;
      console.warn('[AiCreateStudio] autosave failed', error);
      return false;
    } finally {
      if (silent) autosaveInFlightRef.current = false;
      else setSavingProj(false);
    }
  };

  autosaveSnapshotRef.current = async () => { await saveProject('draft', { silent: true }); };

  const refreshProductionJob = async (id: string) => {
    if (productionRefreshInFlight.current.has(id)) return;
    const requestedProject = currentProjectRef.current;
    productionRefreshInFlight.current.add(id);
    setProductionRefreshingIds(current => [...current, id]);
    setProductionError('');
    try {
      const job = await productionApi.refresh(id);
      if (job.projectId !== currentProjectRef.current) return;
      setProductionJobs(current => [job, ...current.filter(item => item.id !== job.id)]);
      setProductionExecutions(await productionApi.executions(job.projectId));
      if (job.status === 'completed' && job.materialId) {
        await refreshMaterials();
        if (job.projectId !== currentProjectRef.current) return;
        const key = `${job.assemblyId}:${job.shotId}`;
        setShotProductions(current => {
          const shot = current[key];
          if (!shot || shot.candidates.some(item => item.jobId === job.id)) return current;
          return { ...current, [key]: { ...shot, candidates: [...shot.candidates, { id: `job-${job.id}`, materialId: job.materialId!, source: 'avatar', fingerprint: job.fingerprint, jobId: job.id, createdAt: job.updatedAt }] } };
        });
      }
    } catch (error) { if (currentProjectRef.current === requestedProject) setProductionError(error instanceof Error ? error.message : '任务刷新失败'); }
    finally {
      productionRefreshInFlight.current.delete(id);
      setProductionRefreshingIds(current => current.filter(item => item !== id));
    }
  };
  const refreshReferenceProduction = async (id: string) => {
    if (productionRefreshInFlight.current.has(id)) return;
    const requestedProject = currentProjectRef.current;
    productionRefreshInFlight.current.add(id); setProductionRefreshingIds(current => [...current, id]); setProductionError('');
    try {
      const execution = await productionApi.refreshReference(id);
      if (execution.projectId !== currentProjectRef.current) return;
      setProductionExecutions(current => [execution, ...current.filter(item => item.id !== execution.id)]);
      if (execution.state === 'completed' && execution.materialId) await refreshMaterials();
    } catch (error) { if (currentProjectRef.current === requestedProject) setProductionError(error instanceof Error ? error.message : '参考人物任务刷新失败'); }
    finally { productionRefreshInFlight.current.delete(id); setProductionRefreshingIds(current => current.filter(item => item !== id)); }
  };
  const cancelReferenceProduction = async (id: string) => {
    if (productionRefreshInFlight.current.has(id)) return;
    const requestedProject = currentProjectRef.current;
    productionRefreshInFlight.current.add(id); setProductionRefreshingIds(current => [...current, id]); setProductionError('');
    try {
      const execution = await productionApi.cancelReference(id);
      if (execution.projectId !== currentProjectRef.current) return;
      setProductionExecutions(current => [execution, ...current.filter(item => item.id !== execution.id)]);
      setDigitalHumanNotice('供应商已确认取消当前分镜任务；历史执行记录已保留。');
    } catch (error) { if (currentProjectRef.current === requestedProject) setProductionError(error instanceof Error ? error.message : '参考人物任务取消失败'); }
    finally { productionRefreshInFlight.current.delete(id); setProductionRefreshingIds(current => current.filter(item => item !== id)); }
  };
  const reconcileProductionCost = async (id: string) => {
    if (productionRefreshInFlight.current.has(id)) return;
    const requestedProject = currentProjectRef.current;
    productionRefreshInFlight.current.add(id); setProductionRefreshingIds(current => [...current, id]); setProductionError('');
    try {
      const execution = await productionApi.reconcileSupplierCost(id);
      if (execution.projectId !== currentProjectRef.current) return;
      setProductionExecutions(current => [execution, ...current.filter(item => item.id !== execution.id)]);
      setDigitalHumanNotice(`供应商账单已核对：实际费用 ¥${(execution.actualCostCny || 0).toFixed(2)}，依据 ${execution.costSourceRef || '供应商用量记录'}。`);
    } catch (error) { if (currentProjectRef.current === requestedProject) setProductionError(error instanceof Error ? error.message : '供应商账单核对失败'); }
    finally { productionRefreshInFlight.current.delete(id); setProductionRefreshingIds(current => current.filter(item => item !== id)); }
  };
  useEffect(() => {
    setShotProductions(current => {
      let next = current;
      for (const job of productionJobs) {
        if (job.projectId !== projectId || job.status !== 'completed' || !job.materialId) continue;
        const key = `${job.assemblyId}:${job.shotId}`;
        const shot = next[key];
        if (!shot || shot.candidates.some(item => item.jobId === job.id)) continue;
        next = { ...next, [key]: { ...shot, candidates: [...shot.candidates, { id: `job-${job.id}`, materialId: job.materialId, source: 'avatar', fingerprint: job.fingerprint, jobId: job.id, createdAt: job.updatedAt }] } };
      }
      return next;
    });
    const pending = automaticAvatarRefreshes(productionJobs, projectId || '');
    if (!pending.length) return;
    const timer = window.setTimeout(() => { void Promise.all(pending.map(job => refreshProductionJob(job.id))); }, 10000);
    return () => window.clearTimeout(timer);
  }, [productionJobs, projectId]);
  useEffect(() => {
    setShotProductions(current => {
      let next = current;
      for (const execution of productionExecutions) {
        if (execution.projectId !== projectId || execution.tool === 'heygen' || execution.state !== 'completed' || !execution.materialId) continue;
        const key = `${execution.assemblyId}:${execution.shotId}`; const shot = next[key];
        if (!shot || shot.candidates.some(item => item.jobId === execution.id)) continue;
        next = { ...next, [key]: { ...shot, candidates: [...shot.candidates, { id: `execution-${execution.id}`, materialId: execution.materialId, source: 'avatar', fingerprint: execution.fingerprint, jobId: execution.id, createdAt: execution.updatedAt }] } };
      }
      return next;
    });
  }, [productionExecutions, projectId]);
  useEffect(() => {
    const jobIds = [...new Set(productionExecutions.filter(item => item.projectId === projectId && item.provider.startsWith('sentence_first_frame')).map(item => item.jobId).filter(Boolean))];
    const missing = jobIds.filter(id => !productionSentenceResults[id]);
    if (!missing.length) return;
    let cancelled = false;
    void Promise.all(missing.map(async id => [id, await productionApi.sentenceReplicationJob(id)] as const)).then(entries => {
      if (!cancelled) setProductionSentenceResults(current => ({ ...current, ...Object.fromEntries(entries) }));
    }).catch(error => { if (!cancelled) setProductionError(error instanceof Error ? error.message : '逐镜质检记录读取失败'); });
    return () => { cancelled = true; };
  }, [productionExecutions, projectId, productionSentenceResults]);

  const generateProductionAvatar = async () => {
    const slot = storyboardSlots.find(item => item.id === productionEditorId);
    if (!slot || productionBusy) return;
    const shot = productionFor(slot);
    if (shot.narration !== storyboardSlotScript(slot.detail).voice) { setProductionError('请先将新台词应用到脚本，再提交生成。'); return; }
    const presenter = productionDefaults.presenters.find(item => item.id === shot.presenterId);
    if (!presenter) { setProductionError('请先绑定已授权的人物和声音资产'); return; }
    if (savingProj || autosaveInFlightRef.current || sourceDraftCheckPending || existingSourceDraftPrompt) { setProductionError('草稿仍在恢复或保存，请稍后重试'); return; }
    setProductionBusy(true); setProductionError(''); autosaveInFlightRef.current = true;
    try {
      const fingerprint = productionFingerprint(slot, shot);
      const saved = await studioApi.saveProject({ id: projectId || undefined, title: projectTitle, status: 'draft', spec: collectSpec() });
      if (!saved.ok || !saved.project?.id) throw new Error('草稿保存失败，未发起生成');
      projectRevisionRef.current = saved.project.updatedAt;
      setProjectId(saved.project.id);
      const savedProductionPlan = await productionApi.savePlan({ projectId: saved.project.id, assemblyId: activeAssemblyId,
        shotId: shootingSlots.find(item => item.slotId === slot.id)!.id, fingerprint: productionFingerprint(slot, shot) });
      if (!savedProductionPlan.executable) throw new Error(savedProductionPlan.reasons.join('；') || '当前分镜制作方案不可执行');
      setProductionPlans(current => [savedProductionPlan, ...current.filter(item => item.id !== savedProductionPlan.id)]);
      const existingJobs = await productionApi.jobs(saved.project.id); const existingExecutions = await productionApi.executions(saved.project.id);
      const unresolved = existingJobs.find(job => job.assemblyId === activeAssemblyId && job.shotId === shootingSlots.find(item => item.slotId === slot.id)?.id
        && job.fingerprint === productionFingerprint(slot, shot) && ['submitting', 'pending', 'uncertain'].includes(job.status));
      const unresolvedExecution = existingExecutions.find(item => item.assemblyId === activeAssemblyId && item.shotId === shootingSlots.find(candidate => candidate.slotId === slot.id)?.id
        && item.fingerprint === productionFingerprint(slot, shot) && ['submitting', 'pending', 'uncertain'].includes(item.state));
      if (unresolved || unresolvedExecution) { setProductionJobs(existingJobs); setProductionExecutions(existingExecutions); throw new Error('该镜头已有未结束任务，请先刷新原任务，不重复提交计费。'); }
      const requestKey = `${saved.project.id}:${productionKey(slot.id)}:${productionFingerprint(slot, shot)}`;
      const requestId = productionRequestIds.current.get(requestKey) || crypto.randomUUID();
      productionRequestIds.current.set(requestKey, requestId);
      if (savedProductionPlan.provider !== 'heygen') {
        const execution = await productionApi.submitReference({ projectId: saved.project.id, assemblyId: activeAssemblyId, shotId: shootingSlots.find(item => item.slotId === slot.id)!.id,
          fingerprint: productionFingerprint(slot, shot), requestId, confirmed: true });
        productionRequestIds.current.delete(requestKey);
        setProductionExecutions(current => [execution, ...current.filter(item => item.id !== execution.id)]);
        return;
      }
      const job = await productionApi.submit({ projectId: saved.project.id, assemblyId: activeAssemblyId, shotId: shootingSlots.find(item => item.slotId === slot.id)!.id,
        shot, presenter, ratio, fingerprint: productionFingerprint(slot, shot), requestId, confirmed: true });
      productionRequestIds.current.delete(requestKey);
      setProductionExecutions(await productionApi.executions(saved.project.id));
      setProductionJobs(current => [job, ...current.filter(item => item.id !== job.id)]);
    } catch (error) { setProductionError(error instanceof Error ? error.message : '提交失败'); }
    finally { autosaveInFlightRef.current = false; setProductionBusy(false); }
  };

  const saveProductionPlan = async () => {
    const slot = storyboardSlots.find(item => item.id === productionEditorId);
    if (!slot || productionBusy) return;
    const shot = productionFor(slot); const persistedShot = shootingSlots.find(item => item.slotId === slot.id);
    if (!persistedShot) { setProductionError('当前分镜尚未建立制作时间段，请先保存分镜脚本'); return; }
    if (savingProj || autosaveInFlightRef.current || sourceDraftCheckPending || existingSourceDraftPrompt) { setProductionError('草稿仍在恢复或保存，请稍后重试'); return; }
    setProductionBusy(true); setProductionError(''); autosaveInFlightRef.current = true;
    try {
      const saved = await studioApi.saveProject({ id: projectId || undefined, title: projectTitle, status: 'draft', spec: collectSpec() });
      if (!saved.ok || !saved.project?.id) throw new Error('草稿保存失败，制作方案未保存');
      projectRevisionRef.current = saved.project.updatedAt; setProjectId(saved.project.id);
      const record = await productionApi.savePlan({ projectId: saved.project.id, assemblyId: activeAssemblyId, shotId: persistedShot.id, fingerprint: productionFingerprint(slot, shot) });
      setProductionPlans(current => [record, ...current.filter(item => item.id !== record.id && !(item.assemblyId === record.assemblyId && item.shotId === record.shotId && item.fingerprint === record.fingerprint))]);
      setDigitalHumanNotice(record.state === 'ready' ? '当前分镜制作方案已保存，可以生成候选。' : `当前分镜制作方案已保存：${record.reasons.join('；') || '等待后续能力接入'}`);
    } catch (error) { setProductionError(error instanceof Error ? error.message : '制作方案保存失败'); }
    finally { autosaveInFlightRef.current = false; setProductionBusy(false); }
  };

  const prepareProductionSentenceFrames = async () => {
    const slot = storyboardSlots.find(item => item.id === productionEditorId); if (!slot || productionBusy) return;
    const shot = productionFor(slot); const persistedShot = shootingSlots.find(item => item.slotId === slot.id);
    if (!persistedShot) { setProductionError('当前分镜尚未建立制作时间段，请先保存分镜脚本'); return; }
    setProductionBusy(true); setProductionError(''); autosaveInFlightRef.current = true;
    try {
      const saved = await studioApi.saveProject({ id: projectId || undefined, title: projectTitle, status: 'draft', spec: collectSpec() });
      if (!saved.ok || !saved.project?.id) throw new Error('草稿保存失败，未提取逐句首帧');
      projectRevisionRef.current = saved.project.updatedAt; setProjectId(saved.project.id);
      const result = await productionApi.prepareSentenceFirstFrames({ projectId: saved.project.id, assemblyId: activeAssemblyId, shotId: persistedShot.id, fingerprint: productionFingerprint(slot, shot) });
      setShotProductions(current => {
        const key = productionKey(slot.id); const currentShot = current[key] || shot; if (!currentShot.digitalHuman?.reference) return current;
        return { ...current, [key]: { ...currentShot, digitalHuman: { ...currentShot.digitalHuman, contentConfirmed: false,
          reference: { ...currentShot.digitalHuman.reference, cues: result.cues } }, revision: currentShot.revision + 1 } };
      });
      await refreshMaterials(); setDigitalHumanNotice(`已提取 ${result.cues.length} 个逐句首帧。请检查后生成目标人物首帧。`);
    } catch (error) { setProductionError(error instanceof Error ? error.message : '逐句首帧提取失败'); }
    finally { autosaveInFlightRef.current = false; setProductionBusy(false); }
  };

  const runProductionSentenceReplication = async () => {
    const slot = storyboardSlots.find(item => item.id === productionEditorId); if (!slot || productionBusy) return;
    const shot = productionFor(slot); const persistedShot = shootingSlots.find(item => item.slotId === slot.id);
    if (!persistedShot) { setProductionError('当前分镜尚未建立制作时间段，请先保存分镜脚本'); return; }
    setProductionBusy(true); setProductionError(''); autosaveInFlightRef.current = true;
    try {
      const fingerprint = productionFingerprint(slot, shot);
      const saved = await studioApi.saveProject({ id: projectId || undefined, title: projectTitle, status: 'draft', spec: collectSpec() });
      if (!saved.ok || !saved.project?.id) throw new Error('草稿保存失败，未启动逐句生成');
      projectRevisionRef.current = saved.project.updatedAt; setProjectId(saved.project.id);
      const result = await productionApi.runSentenceReplication({ projectId: saved.project.id, assemblyId: activeAssemblyId, shotId: persistedShot.id,
        fingerprint, requestId: crypto.randomUUID(), confirmed: true });
      if (result.sentenceJobId) setProductionSentenceResults(current => ({ ...current, [result.sentenceJobId!]: result }));
      await refreshMaterials(); setProductionExecutions(await productionApi.executions(saved.project.id));
      setShotProductions(current => { const key = productionKey(slot.id); const currentShot = current[key] || shot; if (!currentShot.digitalHuman?.reference) return current;
        const nextShot = { ...currentShot, digitalHuman: { ...currentShot.digitalHuman, contentConfirmed: false, reference: { ...currentShot.digitalHuman.reference, cues: result.cues } }, revision: currentShot.revision + 1 };
        return { ...current, [key]: { ...nextShot, candidates: [...currentShot.candidates, { id: `sentence-${crypto.randomUUID()}`, materialId: result.materialId, source: 'avatar', fingerprint, jobId: result.executionId, createdAt: new Date().toISOString() }] } }; });
      setDigitalHumanNotice(`已完成 ${result.cues.length} 句目标人物视频并拼接为候选，请预览和验收。`);
    } catch (error) { setProductionError(error instanceof Error ? error.message : '逐句爆款复刻失败'); }
    finally { autosaveInFlightRef.current = false; setProductionBusy(false); }
  };

  const generateProductionSentenceDrafts=async()=>{const slot=storyboardSlots.find(item=>item.id===productionEditorId);if(!slot||productionBusy)return;const shot=productionFor(slot);const persistedShot=shootingSlots.find(item=>item.slotId===slot.id);if(!persistedShot){setProductionError('当前分镜尚未建立制作时间段，请先保存分镜脚本');return;}setProductionBusy(true);setProductionError('');autosaveInFlightRef.current=true;try{const fingerprint=productionFingerprint(slot,shot);const saved=await studioApi.saveProject({id:projectId||undefined,title:projectTitle,status:'draft',spec:collectSpec()});if(!saved.ok||!saved.project?.id)throw new Error('草稿保存失败，未启动千问首帧草稿');projectRevisionRef.current=saved.project.updatedAt;setProjectId(saved.project.id);const result=await productionApi.generateSentenceFirstFrameDrafts({projectId:saved.project.id,assemblyId:activeAssemblyId,shotId:persistedShot.id,fingerprint,requestId:crypto.randomUUID(),confirmed:true});setShotProductions(current=>{const key=productionKey(slot.id);const currentShot=current[key]||shot;if(!currentShot.digitalHuman?.reference)return current;return{...current,[key]:{...currentShot,digitalHuman:{...currentShot.digitalHuman,contentConfirmed:false,reference:{...currentShot.digitalHuman.reference,cues:result.cues}},revision:currentShot.revision+1}};});await refreshMaterials();setDigitalHumanNotice(`已生成 ${result.operationIds.length} 张千问构图草稿，预计费用 ¥${result.estimatedCostCny.toFixed(2)}。草稿不会直接交给 Seedance。`);}catch(error){setProductionError(error instanceof Error?error.message:'千问首帧草稿生成失败');}finally{autosaveInFlightRef.current=false;setProductionBusy(false);}};

  const reviewProductionSentenceCue = async (cueId:string, decisionsByKey:Record<string,boolean>, evidence:string) => {
    const slot=storyboardSlots.find(item=>item.id===productionEditorId); if(!slot||productionBusy)return; const shot=productionFor(slot); const persistedShot=shootingSlots.find(item=>item.slotId===slot.id); if(!persistedShot)return;
    const execution=productionExecutions.filter(item=>item.assemblyId===activeAssemblyId&&item.shotId===persistedShot.id&&item.fingerprint===productionFingerprint(slot,shot)&&item.provider.startsWith('sentence_first_frame')).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
    const result=execution?productionSentenceResults[execution.jobId]:undefined; const cue=result?.cueQuality?.find(item=>item.cueId===cueId); if(!execution||!result||!cue){setProductionError('当前逐镜质检记录不存在');return;}
    const pending=cue.checks.filter(check=>check.status==='pending'); if(!pending.length||pending.some(check=>decisionsByKey[check.key]===undefined)||!evidence.trim()){setProductionError('请完成该镜头全部待验收项目并填写证据');return;}
    setProductionBusy(true);setProductionError(''); try{const decisions=Object.fromEntries(pending.map(check=>[check.key,{passed:decisionsByKey[check.key],evidence:evidence.trim()}]));const reviewed=await productionApi.reviewSentenceCueQuality(execution.jobId,{[cueId]:decisions});setProductionSentenceResults(current=>({...current,[execution.jobId]:reviewed}));setDigitalHumanNotice(`镜头 ${cueId} 的逐项验收已保存。`);}catch(error){setProductionError(error instanceof Error?error.message:'逐镜验收保存失败');}finally{setProductionBusy(false);}
  };

  const retryProductionFailedSentenceCues = async () => {
    const slot=storyboardSlots.find(item=>item.id===productionEditorId);if(!slot||productionBusy)return;const shot=productionFor(slot);const persistedShot=shootingSlots.find(item=>item.slotId===slot.id);if(!persistedShot)return;const fingerprint=productionFingerprint(slot,shot);
    const execution=productionExecutions.filter(item=>item.assemblyId===activeAssemblyId&&item.shotId===persistedShot.id&&item.fingerprint===fingerprint&&item.provider.startsWith('sentence_first_frame')).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];const previous=execution?productionSentenceResults[execution.jobId]:undefined;if(!execution||!previous?.failedCueIds?.length){setProductionError('当前没有已确认的失败镜头');return;}
    setProductionBusy(true);setProductionError('');try{const result=await productionApi.retryFailedSentenceCues(execution.jobId,crypto.randomUUID(),true);if(result.sentenceJobId)setProductionSentenceResults(current=>({...current,[result.sentenceJobId!]:result}));await refreshMaterials();if(projectId)setProductionExecutions(await productionApi.executions(projectId));setShotProductions(current=>{const key=productionKey(slot.id);const currentShot=current[key]||shot;if(!currentShot.digitalHuman?.reference)return current;const nextShot={...currentShot,digitalHuman:{...currentShot.digitalHuman,contentConfirmed:false,reference:{...currentShot.digitalHuman.reference,cues:result.cues}},revision:currentShot.revision+1};return{...current,[key]:{...nextShot,candidates:[...currentShot.candidates,{id:`sentence-repair-${crypto.randomUUID()}`,materialId:result.materialId,source:'avatar',fingerprint,jobId:result.executionId,createdAt:new Date().toISOString()}]}};});setDigitalHumanNotice(`已只重做 ${previous.failedCueIds.length} 个失败镜头，其余已验收镜头沿用。请验收新的候选。`);}catch(error){setProductionError(error instanceof Error?error.message:'失败镜头局部重做失败');}finally{setProductionBusy(false);}
  };

  const applyProductionNarration = () => {
    const slot = storyboardSlots.find(item => item.id === productionEditorId);
    if (!slot || productionFor(slot).locked) return;
    const narration = productionFor(slot).narration;
    const labels = '环境|景别|运镜|镜头功能|画面|Visual|人物说|台词|Voiceover|VO|口播|字幕|Caption|配乐|真实性要求|可见事实|表达意图|未展示因果|Omni提示词|Omni禁止项';
    const pattern = new RegExp(`(?:人物说|台词|Voiceover|VO|口播)\\s*[：:]\\s*.*?(?=\\s+(?:${labels})\\s*[：:]|$)`, 'i');
    const detail = pattern.test(slot.detail) ? slot.detail.replace(pattern, `口播：${narration || '无'}`) : `${slot.detail} 口播：${narration || '无'}`;
    shootingSlotsRef.current = shootingSlotsRef.current.map(item => item.slotId === slot.id ? { ...item, detail } : item);
    const nextScript = storyboardSlots.map(item => `[${item.time}]\n${item.id === slot.id ? detail : item.detail}`).join('\n\n');
    setScript(nextScript); setVoiceoverLines(extractVoiceoverText(nextScript));
    setModeScripts(current => current.map(item => item.id === activeModeScriptId ? manualScriptDraft(item, nextScript) : item));
    setVoiceDrafts({ [activeVoiceLang || lang]: extractVoiceoverText(nextScript) });
    setVoiceDraftStaleLangs(voiceLangs); setVoiceoverAudios({}); setVoiceoverUrl(null); setVoiceoverDur(0); setAlignedCuesByLang({});
    setRendered(false); setProductionError(''); setModeNotice('台词已同步到脚本；旧配音、字幕对齐和成片需更新。其他镜头画面保留。');
  };

  const adoptProductionCandidate = async (candidateId: string) => {
    const slot = storyboardSlots.find(item => item.id === productionEditorId); if (!slot) return;
    const shot = productionFor(slot); const candidate = shot.candidates.find(item => item.id === candidateId);
    if (!candidate || shot.locked || candidate.fingerprint !== productionFingerprint(slot, shot)) return;
    const currentPresenterVersion = Math.max(1, productionDefaults.presenters.find(item => item.id === shot.presenterId)?.assetVersion || 1);
    const execution = productionExecutions.find(item => (item.id === candidate.jobId || item.jobId === candidate.jobId) && item.presenterAssetVersion === currentPresenterVersion);
    const taskReady = execution ? execution.state === 'completed' && execution.materialId === candidate.materialId && execution.fingerprint === candidate.fingerprint
      : avatarCandidateReady(candidate, productionJobs.filter(job => job.projectId === projectId && `${job.assemblyId}:${job.shotId}` === productionKey(slot.id)));
    if (!taskReady) {
      setProductionError('数字人任务未完成或仍待核验，请刷新原任务；不能采用未验证的候选'); return;
    }
    const acceptedExecution = execution?.quality.state === 'accepted' ? execution : productionExecutions.find(item => item.jobId === candidate.jobId && item.presenterAssetVersion === currentPresenterVersion && item.quality.state === 'accepted');
    const qualityAccepted = Boolean(acceptedExecution);
    if (candidate.source === 'avatar' && !qualityAccepted) {
      setProductionError('请先完成当前数字人候选的人物、口播和口型人工验收'); return;
    }
    const clip = materialById.get(candidate.materialId); if (!clip) { setProductionError('候选素材未就绪，请刷新任务或素材库'); return; }
    if (candidate.source === 'avatar') {
      if (!acceptedExecution || savingProj || autosaveInFlightRef.current) { setProductionError('草稿正在保存或执行记录尚未就绪，请稍后再采用'); return; }
      setProductionBusy(true); setProductionError(''); autosaveInFlightRef.current = true;
      try {
        const saved = await studioApi.saveProject({ id: projectId || undefined, title: projectTitle, status: 'draft', spec: collectSpec() });
        if (!saved.ok || !saved.project?.id) throw new Error('草稿保存失败，候选尚未填入分镜');
        projectRevisionRef.current = saved.project.updatedAt; setProjectId(saved.project.id);
        const adoptedExecution = await productionApi.adoptExecution(acceptedExecution.id, { candidateId, materialId: candidate.materialId });
        setProductionExecutions(current => [adoptedExecution, ...current.filter(item => item.id !== adoptedExecution.id)]);
      } catch (error) {
        setProductionError(error instanceof Error ? error.message : '候选填入分镜失败'); return;
      } finally { autosaveInFlightRef.current = false; setProductionBusy(false); }
    }
    setShotProductions(current => ({ ...current, [productionKey(slot.id)]: { ...shot, adoptedId: candidateId } }));
    setStoryboardAssignments(current => ({ ...current, [slot.id]: clip.id }));
    setClipEdits(current => ({ ...current, [slotClipEditKey(slot.id, clip.id)]: candidate.source === 'avatar' || shot.sound === 'source'
      ? { ...defaultEditForSlot(clip, slot), trimStart: 0, trimEnd: clip.duration, speed: 1, targetDuration: clip.duration, targetDurationEdited: true }
      : defaultEditForSlot(clip, slot) }));
    setSelected(current => [...new Set([...current, clip.id])]); setRendered(false);
  };

  const createBoundShootingTask = async (brief: string) => {
    if (shootingBusy) return;
    const slot = shootingSlots.find(item => item.slotId === shootingSlotId);
    if (!slot) { setShootingError('分镜已变化，请关闭后重新选择。'); return; }
    const storyboardSlot = storyboardSlots.find(item => item.id === slot.slotId)!;
    if (productionFor(storyboardSlot).sound === 'source' && productionFor(storyboardSlot).narration !== storyboardSlotScript(storyboardSlot.detail).voice) { setShootingError('请先将口播台词应用到脚本，再安排拍摄'); return; }
    if (voiceDraftLoading || ttsLoading || savingProj || autosaveInFlightRef.current || sourceDraftCheckPending || existingSourceDraftPrompt) {
      setShootingError('草稿正在恢复或保存，或配音仍在生成，请稍后重试。'); return;
    }
    setShootingBusy(true);
    setSavingProj(true);
    setShootingError('');
    autosaveInFlightRef.current = true;
    try {
      const saved = await studioApi.saveProject({ id: projectId || undefined, title: projectTitle.trim() || '未命名草稿', status: 'draft', spec: collectSpec(), thumbSeed: cover });
      if (!saved.ok || !saved.project?.id) throw new Error('草稿保存失败，未创建待拍任务。');
      projectRevisionRef.current = saved.project.updatedAt;
      setProjectId(saved.project.id);
      const task = await createScriptGapTask({
        title: `分镜 ${storyboardSlots.findIndex(item => item.id === slot.slotId) + 1} 补拍`,
        productLabel: activeProductLabel || '当前产品', themeTitle: activeVideoTheme.title,
        shotBrief: brief, suggestedDurationSec: slot.duration, sourceProjectId: saved.project.id,
        sourceStoryboardSlotId: slot.slotId, sourceShotId: slot.id, sourceAssemblyId: activeAssemblyId,
        requirements: slot.requirements, soundMode: productionFor(storyboardSlots.find(item => item.id === slot.slotId)!).sound,
        expectedNarration: productionFor(storyboardSlots.find(item => item.id === slot.slotId)!).narration,
      });
      setShootingTasks(current => [task, ...current.filter(item => item.id !== task.id)]);
      setShootingSlotId('');
      setModeNotice('已保存草稿并创建待拍任务。前往灵感大屏 → 待拍摄素材上传；返回本草稿后自动检查补位。');
    } catch (error) { setShootingError(error instanceof Error ? error.message : '创建失败，请重试'); }
    finally { autosaveInFlightRef.current = false; setShootingBusy(false); setSavingProj(false); }
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      void autosaveSnapshotRef.current();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const openProjects = async () => {
    setShowProjects(true);
    const [nextProjects, nextBatches] = await Promise.all([studioApi.listProjects(), studioApi.listVariationBatches()]);
    if (workflowContext?.entityId && !workflowContext.runId && !workflowContext.taskId) {
      setProjects(nextProjects); setVariationBatches(nextBatches);
      const project = nextProjects.find(item => item.id === workflowContext.entityId);
      if (project) { loadProject(project); setShowProjects(false); }
      else setModeNotice('该作品已不存在或当前账号无权查看，请从作品列表重新选择。');
      return;
    }
    if (workflowContext?.runId && workflowContext?.taskId) {
      const entry = resolveStudioWorkflowProjectEntry(nextProjects, workflowContext);
      setProjects(entry.projects);
      setVariationBatches([]);
      if (entry.project) {
        setWorkflowProjectSelectionPending(false);
        loadProject(entry.project);
        setShowProjects(false);
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
    if (!agentProduction.active && (workflowContext?.runId && workflowContext?.taskId || workflowContext?.entityId)) void openProjects().catch(error => setModeNotice(error.message));
  }, [workflowContext?.runId, workflowContext?.taskId, workflowContext?.entityId]);
  useEffect(() => {
    if (!openProjectsSignal || openProjectsSignal <= handledOpenProjectsSignalRef.current) return;
    handledOpenProjectsSignalRef.current = openProjectsSignal;
    window.dispatchEvent(new CustomEvent('lingshu:content-view-changed', { detail: { entry: 'works' } }));
    void openProjects();
  }, [openProjectsSignal, workflowContext?.entityId, workflowContext?.runId, workflowContext?.taskId]);
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
    applySpec(saved.project.spec);
    setScript(''); setVoiceoverLines(''); setVoiceDrafts({}); setModeScripts([]); setActiveModeScriptId('');
    setSelected([]); setScriptRecommendedMaterialIds([]); setStoryboardAssignments({}); setStoryboardSourcePlans({});
    setVoiceoverUrl(null); setVoiceoverAudios({}); setAlignedCuesByLang({}); setLanguageRenderOutputs({});
    setBgm(''); setCover(''); setCoverUrl(null); setCapturedCoverFrameUrl(''); setCoverTimelineCaptureMode(false); setCaption(''); setClipEdits({}); setRendered(false); setPreviewIdx(null);
    setPosterDraft(null); setLeadContentPackage(null); setPosterJsonText(''); setPosterImageUrl('');
    setProjectId(saved.project.id); setProjectTitle(nextTitle); setProjects(current => [saved.project, ...current.filter(item => item.id !== saved.project.id)]);
    setStepIdx(0); setShowProjects(false); setSavedTick(true); window.setTimeout(() => setSavedTick(false), 1800);
  };

  const loadProject = (p: StudioProject) => {
    applySpec(p.status === 'template' ? withoutStudioWorkflowContext(p.spec) : p.spec);
    setProjectId(p.status === 'template' ? null : p.id);
    setProjectTitle(p.status === 'template' ? `${p.title} · 副本` : p.title);
    setWorkflowProjectSelectionPending(false);
    autoGen.current = true; // 载入已有脚本，别再自动覆盖
    setShowProjects(false);
    setPublished(false);
  };

  useEffect(() => {
    const taskId = socialContentTaskId?.trim();
    if (!taskId) {
      setSocialTaskProjectLookupDone(true);
      return;
    }
    let disposed = false;
    setSocialTaskProjectLookupDone(false);
    void studioApi.listProjects().then(list => {
      if (disposed) return;
      setProjects(list);
      const project = list.find(item => item.status !== 'template' && item.spec?.socialContentTaskId === taskId);
      if (!project) return;
      loadProject(project);
      setCanvasView('creation');
      setModeNotice(`已恢复任务“${project.title}”的上次制作进度。`);
    }).catch(() => {
      if (!disposed) setModeNotice('上次制作进度读取失败，已重新载入任务资料。');
    }).finally(() => {
      if (!disposed) setSocialTaskProjectLookupDone(true);
    });
    return () => { disposed = true; };
  }, [socialContentTaskId]);

  useEffect(() => {
    if (!agentProduction.active) return;
    let disposed = false;
    const refresh = async () => {
      const target = window.__agentProductionTarget;
      if (!target?.projectId) return;
      const list = await studioApi.listProjects();
      if (disposed) return;
      const project = list.find(item => item.id === target.projectId);
      if (!project) { setModeNotice('关联的生产项目暂不可访问'); return; }
      loadProject(project);
      const stage = target.stage;
      const stepId = stage === 'script' ? (project.spec.script ? 'script' : 'mode') : stage === 'material_match' ? 'material' : ['voice_subtitles', 'heygen'].includes(stage || '') ? 'script' : ['render', 'quality', 'completed'].includes(stage || '') ? 'preview' : undefined;
      if (stepId) { const index = STEPS.findIndex(item => item.id === stepId); if (index >= 0) setStepIdx(index); }
      if (stage === 'voice_subtitles') setScriptStageTab('audio');
    };
    const update = () => { void refresh().catch(error => setModeNotice(error.message)); };
    update();
    window.addEventListener('lingshu:agent-business-refresh', update);
    return () => { disposed = true; window.removeEventListener('lingshu:agent-business-refresh', update); };
  }, [agentProduction.active]);

  useEffect(() => {
    if (workflowContext || socialContentTaskId) {
      try { localStorage.removeItem(STUDIO_OPEN_PROJECT_KEY); } catch { /* ignore */ }
      return;
    }
    let disposed = false;
    let raw = '';
    try {
      raw = localStorage.getItem(STUDIO_OPEN_PROJECT_KEY) || '';
      if (raw) localStorage.removeItem(STUDIO_OPEN_PROJECT_KEY);
    } catch { return; }
    if (!raw) {
      const id = new URLSearchParams(location.search).get('project');
      if (id) raw = JSON.stringify({ at: Date.now(), projectId: id });
    }
    if (!raw) return;
    try {
      const state = JSON.parse(raw) as { at?: number; projectId?: string };
      if (!state.at || Date.now() - state.at > 10 * 60 * 1000 || !state.projectId) return;
      void studioApi.listProjects().then(list => {
        if (disposed) return;
        setProjects(list);
        const project = list.find(item => item.id === state.projectId && item.status === 'draft');
        if (!project) {
          setModeNotice('未找到该历史创作草稿。');
          return;
        }
        applySpec(project.spec);
        setProjectId(project.id);
        setProjectTitle(project.title);
        autoGen.current = true;
        setShowProjects(false);
        setPublished(false);
        setModeNotice(`已恢复历史创作草稿“${project.title}”。`);
      }).catch(() => setModeNotice('历史创作草稿读取失败，请稍后重试。'));
    } catch {
      // Ignore malformed navigation payloads from older local builds.
    }
    return () => { disposed = true; };
  }, [workflowContext?.runId, workflowContext?.taskId, workflowContext?.entityId]);

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
              {socialContentTaskId ? (
                <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs font-bold text-text-primary">
                  {contentMode === 'video' ? '视频内容' : '图文内容'} · 已从任务带入
                </div>
              ) : (
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
              )}
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-text-muted">制作设置</p>
            {socialContentTaskId ? (
              <div className="mb-5 mt-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-3">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white"><Check size={14} /></span>
                  <div className="min-w-0">
                    <p className="text-xs font-black text-emerald-950">任务资料已带入统一制作工作台</p>
                    <p className="mt-1 text-[10px] leading-4 text-emerald-800">主题、产品和素材沿用已确认任务；这里直接继续脚本、素材匹配和成片制作，不再选择旧制作路线。</p>
                  </div>
                </div>
              </div>
            ) : (
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
            )}
            <p className="mb-2 text-[10px] font-black uppercase tracking-[0.12em] text-text-muted">内容信息</p>
            <div className="space-y-4">
              {socialContentTaskId ? (
                <div className="rounded-xl border border-border bg-surface-2 p-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.12em] text-text-muted">任务产品</p>
                  <p className="mt-1 text-xs font-bold text-text-primary">{selectedProductOptions.map(option => option.label).join('、') || productInfo || '任务暂未绑定产品'}</p>
                  <p className="mt-2 text-[10px] leading-4 text-text-muted">产品绑定沿用已确认任务；我的素材仍可在下一生产节点逐镜查看和匹配。</p>
                </div>
              ) : (
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
                              onClick={() => setSelectedProductIds(current => productSelectMode === 'single' && !socialContentTaskId
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
              )}
              {socialViralTask && referenceProducts.length > 0 && <section aria-label="原片产品位映射" className="rounded-xl border border-border bg-surface p-3">
                <p className="text-xs font-black text-text-primary">原片产品位映射 · {referenceProducts.length} 个</p>
                <p className="mt-1 text-[11px] text-text-muted">按原片出场顺序选择同样数量的企业产品；每个产品位只替换对应口播词和分镜素材。</p>
                {selectedProductOptions.length !== referenceProducts.length && <p role="status" className={`mt-2 text-[11px] font-bold ${localGateBypass ? 'text-sky-700' : 'text-amber-700'}`}>{localGateBypass ? `已选 ${selectedProductOptions.length} 款；本地测试已放行，可跳过产品位映射。` : `已选 ${selectedProductOptions.length} 款，还需选满 ${referenceProducts.length} 款后逐项映射。`}</p>}
                <div className="mt-3 space-y-2">{referenceProducts.map((slot, index) => <div key={slot.shotId} className="grid gap-2 rounded-lg border border-border bg-white p-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div><p className="text-[11px] font-bold text-text-primary">{index + 1}. {slot.time} · {slot.sourceLabel}</p><label className="mt-1 block text-[10px] text-text-muted">原口播中的产品词<input aria-label={`原片产品 ${index + 1} 的口播词`} value={referenceProductTerms[slot.shotId] ?? slot.sourceLabel} onChange={event => setReferenceProductTerms(current => ({ ...current, [slot.shotId]: event.target.value }))} className="mt-1 h-8 w-full rounded-md border border-border px-2 text-xs text-text-primary" /></label></div>
                  <label className="block text-[10px] text-text-muted">替换为企业产品<select aria-label={`原片产品 ${index + 1} 对应企业产品`} value={referenceProductAssignments[slot.shotId] || ''} onChange={event => setReferenceProductAssignments(current => ({ ...current, [slot.shotId]: event.target.value }))} className="mt-1 h-8 w-full rounded-md border border-border bg-white px-2 text-xs text-text-primary"><option value="">请选择</option>{selectedProductOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
                </div>)}</div>
              </section>}
              {socialViralTask && (
                <section aria-label="爆款口播方案" className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div><p className="text-xs font-black text-emerald-950">原片逐句口播</p><p className="mt-1 text-[10px] text-emerald-800">只替换交接物已识别的品牌、产品等关键词；分镜按原片画面切点生成。</p></div>
                    <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[10px] font-black text-emerald-800">{referenceSpeechPlan.lines.length} 句</span>
                  </div>
                  {referenceSpeechPlan.error && <p role="status" className={`mt-3 rounded-lg bg-white p-3 text-[11px] ${localGateBypass ? 'text-sky-800' : 'text-amber-800'}`}>{localGateBypass && referenceSpeechPlan.lines.length ? `${referenceSpeechPlan.error.replace('；请核对产品词后再生成配音。', '。')} 本地测试已放行，可以继续生成配音。` : referenceSpeechPlan.error}</p>}
                  {referenceSpeechPlan.lines.length > 0 && (
                    <ol className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                      {referenceSpeechPlan.lines.map((line, index) => <li key={line.id} className="rounded-lg border border-emerald-100 bg-white p-2.5 text-[11px] leading-5">
                        <p className="font-black text-emerald-900">{String(index + 1).padStart(2, '0')} · {line.time}</p>
                        <p className="mt-1 text-text-muted">原句：{line.source}</p>
                        <p className="text-text-primary">新口播：{line.draft}</p>
                        {line.visuals.length > 0 && <p className="mt-1 text-[10px] text-emerald-800">对应原片分镜：{line.visuals.map(item => `${item.time} ${item.label}`).join('；')}</p>}
                      </li>)}
                    </ol>
                  )}
                </section>
              )}
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
                      onChange={event => { studioSettingsEditedRef.current = true; setAudience(event.target.value); }}
                      placeholder={activeVideoTheme.painPoint}
                      className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none transition focus:border-accent"
                    />
                  </label>
                  {mode === 'product' && (
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold text-text-secondary">内容目标</span>
                      <select value={productContentGoal} onChange={event => setProductContentGoal(event.target.value as 'reach' | 'leads')}
                        className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary">
                        <option value="reach">观看与互动</option>
                        <option value="leads">获取询盘</option>
                      </select>
                    </label>
                  )}
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold text-text-secondary">{effectiveContentGoal === 'reach' ? '行动引导（可选）' : '主 CTA'}</span>
                    <input
                      value={effectivePrimaryCta || (effectiveContentGoal === 'reach' ? '' : DEFAULT_VIDEO_CONVERSION_GOAL)}
                      onChange={event => {
                        if (effectiveContentGoal === 'reach') setReachCta(event.target.value);
                        else { setEnterprisePrimaryCta(event.target.value); setPrimaryCta(event.target.value); }
                      }}
                      placeholder={effectiveContentGoal === 'reach' ? '留空则自然收尾，也可填写希望观众讨论的问题' : DEFAULT_VIDEO_CONVERSION_GOAL}
                      className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none transition focus:border-accent"
                    />
                  </label>
                  <fieldset className="md:col-span-2">
                    <legend className="mb-1.5 block text-xs font-semibold text-text-secondary">成片方式</legend>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { id: 'material', label: '纯素材剪辑', description: '画面使用已授权素材，不生成数字人' },
                        { id: 'avatar', label: '纯数字人口播', description: '全片数字人出镜，配完整口播和字幕' },
                        { id: 'heygen', label: '数字人 + 素材混剪', description: '在分镜表逐镜选择数字人或具体素材' },
                      ] as const).map(option => {
                        const selectedMode = presentationMode === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            role="radio"
                            aria-checked={selectedMode}
                            onClick={() => {
                              setPresentationMode(option.id); setPresenterMode(option.id === 'material' ? 'real' : 'digital'); setRendered(false); setRenderOutputPath(null); setRenderOutputPreviewUrl(null);
                              if (option.id !== 'material') setActiveFolder('presenter');
                              if (script.trim()) setModeNotice(`出镜方式已切换为“${option.label}”，请重新确认分镜与人物素材。`);
                            }}
                            className={`flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-accent/30 ${selectedMode ? 'border-accent bg-accent-glow shadow-[0_0_0_1px_var(--color-accent)]' : 'border-border bg-surface-2 hover:border-accent/50'}`}
                          >
                            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${selectedMode ? 'border-accent' : 'border-border-bright'}`}>
                              {selectedMode && <span className="h-2 w-2 rounded-full bg-accent" />}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-xs font-black text-text-primary">{option.label}</span>
                              <span className="mt-0.5 block truncate text-[10px] text-text-muted">{option.description}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
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
                      <button type="button" onClick={() => setHookMaterialId(current => selectedVisualClips.some(item => item.id === current) ? current : selectedVisualClips[0]!.id)} className={`rounded-lg border px-2 py-2 text-[10px] font-bold ${hookMaterialId ? 'border-emerald-400 bg-white text-emerald-700' : 'border-border bg-white text-text-muted'}`}>
                        指定开场钩子
                        <span className="mt-0.5 block font-normal">指定 1 个开场素材，其余用于后续分镜匹配</span>
                      </button>
                    </div>
                    {hookMaterialId && <p className="mt-2 text-[10px] font-semibold text-emerald-700">已指定 1 个开场钩子；点击下方素材可切换，其他已选素材仍作为后续候选。</p>}
                  </div>
                )}
                {selectedVisualClips.length > 0 && (
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    {selectedVisualClips.map(clip => {
                      const isHook = hookMaterialId === clip.id;
                      return <div key={clip.id} className={`group relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border bg-surface-2 ${isHook ? 'border-emerald-500 ring-2 ring-emerald-500/20' : 'border-border'}`}>
                        <button
                          type="button"
                          title={hookMaterialId ? (isHook ? '当前开场钩子' : '设为开场钩子') : `移除${clip.name}`}
                          aria-label={hookMaterialId ? (isHook ? `${clip.name}，当前开场钩子` : `将${clip.name}设为开场钩子`) : `移除${clip.name}`}
                          onClick={() => hookMaterialId ? setHookMaterialId(clip.id) : removeSelectedVisualClip(clip.id)}
                          className="relative h-full w-full overflow-hidden"
                        >
                          {clip.poster || clip.type === 'image' ? <img src={clip.poster || clip.url} alt={clip.name} className="h-full w-full object-cover" /> : <Film size={16} className="absolute inset-0 m-auto text-text-muted" />}
                          {isHook
                            ? <span className="absolute bottom-0 left-0 right-0 bg-emerald-600/95 py-0.5 text-center text-[8px] font-black text-white">开场钩子</span>
                            : hookMaterialId && <span className="absolute inset-0 hidden items-center justify-center bg-black/55 text-[9px] font-bold text-white group-hover:flex">设为钩子</span>}
                        </button>
                        <button type="button" title={`移除${clip.name}`} aria-label={`移除${clip.name}`} onClick={() => removeSelectedVisualClip(clip.id)} className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/65 text-white"><X size={10} /></button>
                      </div>;
                    })}
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
                            const isHook = hookMaterialId === clip.id;
                            return <div key={clip.id} className={`relative overflow-hidden rounded-xl border text-left transition ${isHook ? 'border-emerald-500 ring-2 ring-emerald-500/20' : checked ? 'border-accent ring-2 ring-accent/15' : 'border-border hover:border-accent/40'}`}>
                              <button type="button" onClick={() => checked ? removeSelectedVisualClip(clip.id) : setSelected(current => [...current, clip.id])} className="block w-full text-left">
                                <span className="relative block aspect-video bg-slate-900">{clip.poster || clip.type === 'image' ? <img src={clip.poster || clip.url} alt="" className="h-full w-full object-cover" /> : <Film size={20} className="absolute inset-0 m-auto text-white/55" />}{checked && <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white"><Check size={14} /></span>}</span>
                                <span className="block truncate px-3 py-2 text-[11px] font-bold text-text-primary">{clip.name}</span>
                              </button>
                              {checked && hookMaterialId && <button type="button" onClick={() => setHookMaterialId(clip.id)} className={`absolute left-2 top-2 rounded-full px-2 py-1 text-[9px] font-black shadow-sm ${isHook ? 'bg-emerald-600 text-white' : 'bg-white/90 text-emerald-700 hover:bg-white'}`}>{isHook ? '开场钩子' : '设为钩子'}</button>}
                            </div>;
                          })}
                        </div>
                      ) : <div className="py-16 text-center text-xs text-text-muted">暂无可用素材，请先上传视频或图片。</div>}
                    </div>
                    <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-4"><p className="text-xs font-bold text-text-secondary">已选择 {selectedVisualClips.length} 项 · 已即时保存</p><button type="button" onClick={() => setShowSetupMaterialPicker(false)} disabled={!localGateBypass && mode === 'material' && !selectedVisualClips.length} className="rounded-xl bg-accent px-5 py-2.5 text-xs font-black text-white disabled:opacity-40">{selectedVisualClips.length ? '完成选择' : '暂不选择'}</button></footer>
                  </div>
                </div>
              )}
              <section aria-label="输出语言与配乐说明" className="space-y-2 border-t border-border px-4 py-3">
                <p className="text-xs font-black text-text-primary">输出语言与配乐</p>
                <label className="block text-[11px] font-bold text-text-secondary">原文语言
                  <select aria-label="原文语言" value={socialViralTask && referenceSourceLanguage ? referenceSourceLanguage : voiceLangs[0] || lang} disabled={Boolean(script.trim()) || Boolean(socialViralTask && referenceSourceLanguage)} onChange={event => { const code = event.target.value; setVoiceLangs(current => [code, ...current.slice(1).filter(item => item !== code)]); setLang(code); setActiveVoiceLang(code); }} className="mt-1 w-full rounded-lg border border-border bg-white p-2 text-xs disabled:opacity-60">
                    {LANGS.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}
                  </select>
                </label>
                <p className="text-[11px] leading-5 text-text-secondary">原文语言：{LANGS.find(item => item.code === (socialViralTask && referenceSourceLanguage ? referenceSourceLanguage : voiceLangs[0] || lang))?.label || lang}。{socialViralTask ? '按原片 ASR 口播自动识别。' : '在下一步“脚本与声音”添加翻译语种，分别生成配音、字幕和成片。'}</p>
                <p className="text-[11px] leading-5 text-text-secondary">在“脚本与声音 → 配乐”选择音乐和音量；未选音乐时，导出不会自动添加配乐。</p>
                {selectedVisualClips.filter(clip => clip.type === 'video').length > 0 && selectedVisualClips.filter(clip => clip.type === 'video').length < 3 && <p role="status" className="rounded-lg bg-amber-50 p-2 text-[11px] leading-5 text-amber-800">当前只有 {selectedVisualClips.filter(clip => clip.type === 'video').length} 段视频。不同截取时间不代表不同画面；自动选材不会循环使用同一视频。需要更多分镜时，请补充不同角度、动作或场景的素材。</p>}
              </section>
              <div className="overflow-hidden border-y border-border bg-surface">
                <button
                  type="button"
                  onClick={() => setShowAdvancedSetup(open => !open)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface-2/60"
                >
                  <span>
                    <span className="block text-xs font-black text-text-primary">高级设置</span>
                    <span className="mt-0.5 block text-[10px] text-text-muted">{ratio} · {duration}s · {provider === 'qwen' ? '千问' : 'Gemini'}</span>
                  </span>
                  <ChevronDown size={15} className={`text-text-muted transition ${showAdvancedSetup ? 'rotate-180' : ''}`} />
                </button>
                {showAdvancedSetup && (
                  <div className="grid grid-cols-1 gap-3 border-t border-border bg-surface-2/40 p-4">
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
                        <button key={value} type="button" disabled={!localGateBypass && risky}
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
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${posterLoading ? 'bg-amber-50 text-amber-700' : posterGenerationIsVerified ? 'bg-emerald-50 text-emerald-700' : posterJsonText ? 'bg-amber-50 text-amber-800' : 'bg-surface-2 text-text-muted'}`}>
                    {posterLoading ? '生成中' : posterGenerationIsVerified ? 'AI 生成 · 已校验' : posterDraft?.provenance === 'manual_draft' ? '手动草稿 · 待复核' : posterJsonText ? '草稿 · 待确认' : '待生成'}
                  </span>
                </div>
                {modeNotice && (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                    {modeNotice}
                  </div>
                )}
                <textarea
                  value={posterJsonText}
                  onChange={event => markPosterJsonAsManualDraft(event.target.value)}
                  rows={posterJsonText ? 12 : 6}
                  placeholder={videoKickoff?.video?.contentFormat === 'image'
                    ? '生成后这里会出现三组内容 JSON：买家注意、合作能力、供应商信任，以及每组轮播结构、配文、CTA 和私信开场。'
                    : '生成后这里会出现海报文案 JSON：标题、副标题、认证徽章、流程六步、产品分类卡、底部卖点和 CTA。'}
                  className="mt-3 w-full rounded-xl border border-border bg-surface-2 p-3 font-mono text-xs leading-relaxed text-text-secondary outline-none focus:border-accent"
                />
                {posterJsonText && !posterGenerationIsVerified && (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                    当前图文不是“已核实可提交”成品。{posterDraft?.fieldsToConfirm?.length
                      ? `仍需确认：${posterDraft.fieldsToConfirm.join('、')}。`
                      : '需重新生成并通过企业资料事实校验。'}系统不会自动提交或交付此草稿。
                  </div>
                )}
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
                            <MaterialAnalysisStatus material={c} onRefresh={refreshMaterials} />
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
          const nextSlot = storyboardSlots.slice(currentIndex + 1).find(item => !storyboardAssignments[item.id]);
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
        const createMatchedAssembly = () => {
          const allVisuals = materials.filter(item => item.type !== 'audio');
          if (!storyboardSlots.length) {
            setModeNotice('请先生成分镜脚本，再创建不同的素材组合版本。');
            return;
          }
          if (!allVisuals.length) {
            setModeNotice('素材库暂无可匹配的视频或图片，请先上传素材。');
            return;
          }
          const current = currentAssemblySnapshot();
          const savedPlans = storyboardAssemblies.map(item => item.id === activeAssemblyId ? current : item);
          const previousAssignments = savedPlans.map(item => item.assignments).filter(item => Object.keys(item).length > 0);
          const nextNumber = savedPlans.reduce((max, item) => {
            const match = item.name.match(/^视频(\d+)$/);
            return Math.max(max, match ? Number(match[1]) : 0);
          }, 0) + 1;
          const nextId = `video-${Date.now()}`;
          const hookClip = hookMaterialId ? allVisuals.find(item => item.id === hookMaterialId) : undefined;
          const hookSlot = hookClip ? storyboardSlots[0] : undefined;
          const slotsToMatch = hookSlot ? storyboardSlots.slice(1) : storyboardSlots;
          const matchPool = hookClip && allVisuals.length > 1 ? allVisuals.filter(item => item.id !== hookClip.id) : allVisuals;
          const candidateAssignments = matchMaterialsToStoryboardLocally(
            matchPool,
            slotsToMatch,
            selected.filter(id => id !== hookMaterialId),
            { variantIndex: savedPlans.length, previousAssignments, targetRatio: ratio },
          );
          const nextAssignments: Record<string, string> = hookSlot && hookClip ? { [hookSlot.id]: hookClip.id } : {};
          const nextSourcePlans: Record<string, StoryboardSourcePlan> = {};
          if (hookSlot && hookClip) {
            const detectedSource = clipSourceMode(hookClip);
            nextSourcePlans[hookSlot.id] = {
              mode: detectedSource,
              decided: true,
              confirmed: true,
              critical: isCriticalStoryboardSlot(hookSlot),
              generatedClipId: detectedSource === 'ai' ? hookClip.id : undefined,
              error: '',
              matchScore: 100,
              matchReason: '用户指定的开场钩子',
              matchDifference: '各素材组合版本共用已锁定的开场钩子',
              matchLevel: 'direct',
            };
          }
          Object.entries(candidateAssignments).forEach(([slotId, clipId]) => {
            const slot = storyboardSlots.find(item => item.id === slotId);
            const clip = materialById.get(clipId);
            if (!slot || !clip) return;
            const assessment = assessMaterialMatch(slot, clip, ratio);
            if (assessment.score < 60) return;
            const detectedSource = clipSourceMode(clip);
            nextAssignments[slotId] = clipId;
            nextSourcePlans[slotId] = {
              mode: detectedSource,
              decided: true,
              confirmed: false,
              critical: isCriticalStoryboardSlot(slot),
              generatedClipId: detectedSource === 'ai' ? clip.id : undefined,
              error: '',
              matchScore: assessment.score,
              matchReason: assessment.reason,
              matchDifference: assessment.difference,
              matchLevel: assessment.level,
            };
          });
          const orderedIds = storyboardSlots.map(slot => nextAssignments[slot.id]).filter((id): id is string => Boolean(id));
          const next: StoryboardAssembly = {
            id: nextId,
            name: `视频${nextNumber}`,
            assignments: nextAssignments,
            sourcePlans: nextSourcePlans,
            selected: [...new Set(orderedIds)],
          };
          const previousMaterialIds = new Set(previousAssignments.flatMap(item => Object.values(item)));
          const freshCount = new Set(orderedIds.filter(id => !previousMaterialIds.has(id))).size;
          const nextEdits: Record<string, ClipEdit> = {};
          storyboardSlots.forEach(slot => {
            const clip = materialById.get(nextAssignments[slot.id] || '');
            if (clip) nextEdits[slotClipEditKey(slot.id, clip.id)] = defaultEditForSlot(clip, slot);
          });
          setStoryboardAssemblies([...savedPlans, next]);
          setActiveAssemblyId(next.id);
          setAssemblyName(next.name);
          setStoryboardAssignments(next.assignments);
          setStoryboardSourcePlans(next.sourcePlans);
          setSelected(next.selected);
          setClipEdits(currentEdits => ({ ...currentEdits, ...nextEdits }));
          setActiveFolder('recommend');
          setActiveStoryboardSlotId(storyboardSlots.find(slot => !nextAssignments[slot.id])?.id || storyboardSlots[0]?.id || '');
          setModeNotice(`已生成“${next.name}”：匹配 ${orderedIds.length}/${storyboardSlots.length} 个分镜${freshCount ? `，其中 ${freshCount} 个素材未在其他版本使用` : '；素材池不足时会调整同一批素材的分镜组合'}。`);
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
          || storyboardSlots.find(slot => !storyboardAssignments[slot.id])
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
	                {activeFolder === 'presenter' && presenterMode === 'digital' && (
	                  <div className="mb-4 rounded-2xl border border-border bg-surface p-4">
	                    <div className="flex flex-wrap items-start justify-between gap-3">
	                      <div className="min-w-0">
	                        <p className="text-sm font-black text-text-primary">HeyGen 数字人口播生成</p><label className="block text-xs">HeyGen 人物<select value={heygenAvatarId} onChange={event => {
                          const id = event.target.value; setHeygenAvatarId(id); setDigitalHumanConsent(false);
                          const gender = heygenAvatars.find(item => item.id === id)?.gender;
                          const nextVoice = gender === 'male' ? 'v2' : gender === 'female' ? 'v1' : '';
                          if (nextVoice && nextVoice !== voice && voiceoverMode !== 'upload') {
                            setVoice(nextVoice);
                            setVoiceoverStaleLangs(prev => [...new Set([...prev, activeVoiceLang, ...Object.keys(voiceoverAudios)])]);
                            setDigitalHumanNotice('已匹配人物音色，请重新生成配音并试听，旧音频不能继续使用。');
                          }
                        }} className="mt-2 w-full rounded border p-2"><option value="">请选择人物</option>{heygenAvatars.map(avatar => <option key={avatar.id} value={avatar.id}>{avatar.name}</option>)}</select></label>
	                        <p className="mt-1 text-xs text-text-muted">选择 HeyGen 人物并使用已确认音频生成，完成后需预览确认人物、声音和口型。</p>
	                        <div className="mt-3 flex flex-wrap gap-2">
	                          {(['quality'] as const).map(item => (
	                            <button key={item} type="button" onClick={() => setDigitalHumanMode(item)}
	                              className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-bold ${digitalHumanMode === item ? 'border-accent bg-accent-glow text-accent' : 'border-border text-text-secondary'}`}>
	                              HeyGen 标准生成
	                            </button>
	                          ))}
	                        </div>
	                      </div>
	                      <button
	                        onClick={() => void generateDigitalHumanPresenter()}
	                        disabled={digitalHumanLoading || !heygenAvatarId || digitalHumanCapabilities?.available === false}
	                        className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
	                      >
	                        {digitalHumanLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
	                        {digitalHumanLoading ? '正在生成…' : '生成表情数字人'}
	                      </button>
	                    </div>
	                    <label className="mt-3 flex cursor-pointer items-start gap-2 text-[11px] leading-5 text-text-secondary">
	                      <input type="checkbox" checked={digitalHumanConsent} onChange={event => setDigitalHumanConsent(event.target.checked)} className="mt-1 accent-[var(--color-accent)]" />
	                      <span>我确认已取得该出镜人物的肖像、声音及商业使用授权，并对上传与生成内容负责。</span>
	                    </label>
	                    {digitalHumanCapabilities?.available === false && (
	                      <p className="mt-2 text-[11px] font-semibold text-amber-600">{digitalHumanCapabilities.unavailableReason}</p>
	                    )}
	                    {digitalHumanJob?.status === 'review' && <div className="my-3 space-y-2">{digitalHumanJob.outputUrl && <video src={digitalHumanJob.outputUrl} controls className="max-h-80 w-full" />}<button type="button" className="rounded border p-2 text-xs" onClick={async () => { const result = await studioApi.approveDigitalHumanJob(digitalHumanJob.id); if (result.job) { setDigitalHumanJob(result.job); await refreshMaterials(); setDigitalHumanNotice('已确认数字人成片，可继续合成'); } }}>已预览，确认人物、口型和声音</button></div>}
                    {digitalHumanJob && (
	                      <div className="mt-3 rounded-xl bg-surface-2 p-3">
	                        <div className="flex items-center justify-between text-[11px] font-semibold"><span>{digitalHumanJob.stage}</span><span>{digitalHumanJob.progress}% · V{digitalHumanJob.versionNumber}</span></div>
	                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${digitalHumanJob.progress}%` }} /></div>
	                        {digitalHumanJob.qualityReport && (
	                          <div className="mt-2 text-[10px] text-text-muted">
	                            <p>口型 {digitalHumanJob.qualityReport.lipSyncScore ?? '需预览确认'} · 身份保持 {digitalHumanJob.qualityReport.identityScore ?? '需预览确认'} · 音画偏移 {digitalHumanJob.qualityReport.avOffsetFrames ?? '需预览确认'}</p>
	                            {digitalHumanJob.qualityReport.gateVersion ? <p className="mt-1">门禁 {digitalHumanJob.qualityReport.gateVersion}{digitalHumanJob.qualityReport.gateFailures?.length ? ` · ${digitalHumanJob.qualityReport.gateFailures.join('；')}` : ' · 已通过'}</p> : null}
	                            {digitalHumanJob.qualityReport.notes?.length ? <p className="mt-1">{digitalHumanJob.qualityReport.notes.join(' · ')}</p> : null}
	                          </div>
	                        )}
	                        <div className="mt-2 flex gap-2">
	                          {['failed', 'review', 'cancelled'].includes(digitalHumanJob.status) && <button type="button" className="rounded-lg border border-border px-2 py-1 text-[10px] font-bold" onClick={async () => {
	                            setDigitalHumanLoading(true); const result = await studioApi.retryDigitalHumanJob(digitalHumanJob.id);
	                            if (result.job) { setDigitalHumanJob(result.job); setDigitalHumanNotice('已创建新的重试版本。'); } else { setDigitalHumanLoading(false); setDigitalHumanNotice(result.error || '重试失败'); }
	                          }}>重试生成</button>}
	                          {['queued', 'submitting', 'processing', 'quality_check'].includes(digitalHumanJob.status) && <button type="button" className="rounded-lg border border-border px-2 py-1 text-[10px] font-bold text-text-secondary" onClick={async () => {
	                            const result = await studioApi.cancelDigitalHumanJob(digitalHumanJob.id);
	                            if (result.job) { setDigitalHumanJob(result.job); setDigitalHumanLoading(false); setDigitalHumanNotice('任务已取消。'); }
	                          }}>取消任务</button>}
	                        </div>
	                      </div>
	                    )}
	                  </div>
	                )}
	                <MaterialLibraryStatus onRetry={refreshMaterials} />
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
                            <MaterialAnalysisStatus material={c} onRefresh={refreshMaterials} />
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
	                          <p className="text-[11px] text-text-muted">上传后可在此页面生成数字人口播素材。</p>
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
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">分镜匹配 · 素材组合版本</p>
                    <p className="mt-0.5 text-[10px] text-text-muted">每个版本独立保存素材组合；新组合会优先使用前面版本未出现的素材。</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button type="button" onClick={createAssembly}
                      className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold text-text-secondary hover:bg-surface-2">
                      + 空白版本
                    </button>
                    <button type="button" onClick={createMatchedAssembly} disabled={!storyboardSlots.length || !materials.some(item => item.type !== 'audio')}
                      className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-black text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40">
                      <Sparkles size={11} />生成新组合
                    </button>
                  </div>
                </div>
                <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
                  {storyboardAssemblies.map((item, itemIndex) => {
                    const active = item.id === activeAssemblyId;
                    const itemAssignments = active ? storyboardAssignments : item.assignments;
                    const matched = storyboardSlots.filter(slot => Boolean(itemAssignments[slot.id])).length;
                    const baseItem = storyboardAssemblies[0];
                    const baseAssignments = baseItem?.id === activeAssemblyId ? storyboardAssignments : baseItem?.assignments || {};
                    const differentSlots = itemIndex === 0 ? 0 : storyboardSlots.filter(slot => itemAssignments[slot.id] !== baseAssignments[slot.id]).length;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => switchAssembly(item.id)}
                        className={`flex flex-shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-left transition ${active ? 'border-accent bg-accent/5 text-accent shadow-sm' : 'border-border bg-white text-text-secondary hover:border-accent/40'}`}
                      >
                        <span className="text-xs font-black">{active ? assemblyName : item.name}</span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${active ? 'bg-accent/10 text-accent' : 'bg-surface-2 text-text-muted'}`}>{storyboardSlots.length ? `${matched}/${storyboardSlots.length}` : '暂无'}</span>
                        <span className="text-[9px] font-semibold text-text-muted">{itemIndex === 0 ? '基准' : `${differentSlots} 镜不同`}</span>
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
                {storyboardSlots.length > 0 && <div className="mt-3 rounded-xl border p-3">
                  <button type="button" disabled={evidenceBusy || savingProj} className="text-xs font-bold" onClick={async () => {
                    if (!projectId) { setModeNotice('请先保存草稿，再检查素材依据。'); return; }
                    setEvidenceBusy(true);
                    try {
                      if (!await saveProject('draft')) return;
                      const response = await fetch(`/api/overseas/studio/projects/${encodeURIComponent(projectId)}/evidence`, { headers: authHeader() });
                      const result = await response.json();
                      if (!response.ok) throw new Error(result.error || '素材检查失败');
                      if (currentProjectRef.current === projectId) setEvidenceGaps(result.gaps);
                    } catch (error) { setModeNotice(error instanceof Error ? error.message : '素材检查失败'); }
                    finally { setEvidenceBusy(false); }
                  }}>{evidenceBusy ? '正在核对已保存草稿…' : '检查素材依据与缺口'}</button>
                  {evidenceGaps && <p className="mt-2 text-xs">{evidenceGaps.length ? `${evidenceGaps.length} 个镜头需处理` : '素材范围与动作文本校验通过，仍需视觉核验'}</p>}
                  {evidenceGaps?.map(gap => <div key={gap.shotId} className="mt-2 text-xs">
                    分镜 {gap.index}：{gap.message}
                    {gap.canShoot && <button type="button" className="ml-2 underline" onClick={() => { setShootingError(''); setShootingSlotId(gap.slotId); }}>安排拍摄</button>}
                  </div>)}
                </div>}
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
                      disabled={materialSelectLoading || !materials.some(item => item.type !== 'audio')}
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
                    <Check size={14} /> 所有分镜已放入视频；素材依据、声音与画质仍需核验
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
	                  const clip = slot.id ? materialById.get(storyboardAssignments[slot.id] || '') : undefined;
	                  const slotEdit = clip ? editForSlot(clip, slot) : null;
	                  const shotGenerating = Boolean(storyboardGenerating[slot.id]);
                  const slotVersions = storyboardVideoVersions[slot.id] || [];
                  const slotScript = storyboardSlotScript(slot.detail);
                  return (
                    <div
                      key={slot.id}
                      role="group"
                      aria-label={`分镜 ${index + 1}`}
                      tabIndex={0}
                      onClick={() => setActiveStoryboardSlotId(slot.id)}
                      onKeyDown={event => {
                        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setActiveStoryboardSlotId(slot.id); }
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
                      <div className="flex items-start gap-3">
                        <div className="relative h-16 w-20 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                          {clip ? <RealThumb clip={clip} onSourceError={() => { void refreshMaterialSource(clip.id); }} /> : <span className="flex h-full items-center justify-center text-[10px] text-text-muted">待选画面</span>}
                          {shotGenerating && <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-[10px] text-white">生成中…</span>}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-bold text-accent">分镜 {index + 1} · {(slot.end - slot.start).toFixed(1)} 秒</p>
                          <p className="mt-1 line-clamp-3 text-xs leading-5 text-text-primary">{slotScript.voice || '无台词'}</p>
                        </div>
                      </div>
                      <div className="mt-2 flex gap-3 text-[11px] font-bold text-accent">
                        <button type="button" onClick={event => { event.stopPropagation(); openProduction(slot); }}>换画面</button>
                        <button type="button" onClick={event => { event.stopPropagation(); openProduction(slot); }}>改台词</button>
                      </div>
                      <details className="mt-2 text-xs" onClick={event => event.stopPropagation()}>
                        <summary className="cursor-pointer text-[11px] font-bold text-text-muted">更多</summary>
                        <div className="mt-2 space-y-2">
                          <p className="whitespace-pre-wrap text-[11px] leading-5 text-text-secondary">{slot.detail}</p>
                          <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => { setShootingError(''); setShootingSlotId(slot.id); }} className="rounded-lg border px-2 py-1.5">安排拍摄</button>
                            <button type="button" onClick={() => openProduction(slot)} className="rounded-lg border px-2 py-1.5">人物 / 背景 / 产品 / 版本</button>
                            {clip && <button type="button" onClick={() => removeSlotClip(slot.id)} className="rounded-lg border px-2 py-1.5 text-red-600">移除画面</button>}
                          </div>
                          {shootingTasks.filter(task => task.sourceProjectId === projectId && task.sourceAssemblyId === activeAssemblyId && task.sourceShotId === shootingSlots.find(item => item.slotId === slot.id)?.id).map(task => <p key={task.id} className="text-[10px] text-amber-700">
                            待拍：{task.uploadedMaterialIds.length ? `${task.uploadedMaterialIds.length} 条候选` : '等待上传'}
                            {task.uploadedMaterialIds.length > 0 && ` · ${shootingRefillTarget(task, { projectId: projectId || '', assemblyId: activeAssemblyId, slots: shootingSlots, assignments: storyboardAssignments, confirmed: Object.fromEntries(Object.entries(storyboardSourcePlans).map(([id, plan]) => [id, plan.confirmed])) }).reason || '等待时长、方向与旁白配置检查'}`}
                          </p>)}
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
                            if (productionFor(slot).locked) { setModeNotice('镜头已锁定，请先解锁'); return; }
                            openProduction(slot);
                            setProductionError('请在候选面板采用与当前要求匹配的版本；历史素材可从素材库重新核验后选择。');
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
                      </details>
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
        const referenceSpeechLines = (videoKickoff?.referenceAnalysis?.details || []).flatMap((detail, detailIndex) => {
          if (detail.speechLines?.length) return detail.speechLines.map((line, lineIndex) => ({
            key: `${detailIndex}-${lineIndex}`,
            time: `${line.sourceStartSeconds.toFixed(2)}–${line.sourceEndSeconds.toFixed(2)}s`,
            text: line.referenceText,
            draft: line.draftText || '',
            precision: line.sourcePrecision || 'coarse',
          }));
          if (!detail.dialogue || isNonSpeechSfx(detail.dialogue)) return [];
          return [{ key: `${detailIndex}`, time: detail.time, text: detail.dialogue, draft: '', precision: 'coarse' }];
        });
        const draftSpeechLines = parseTimestampedVoiceover(voiceDrafts[activeVoiceLang] || voiceoverLines || extractVoiceoverText(script));
        const measuredVoiceAlignment = isMeasuredVoiceAlignment(voiceoverAudios[activeVoiceLang]?.alignmentSource);
        const measuredVoiceCues = measuredVoiceAlignment
          ? (alignedCuesByLang[activeVoiceLang] || voiceoverAudios[activeVoiceLang]?.cues || [])
          : [];
        const languageConfigurationRequired = !enterpriseScriptLanguage
          && modeNotice.includes('企业中心尚未配置首选输出语言或主要业务语言');
        const detectedVoiceLang = detectScriptLanguageCode(voiceoverLines || extractVoiceoverText(script));
        const updatePrimaryScriptContent = (value: string) => {
          const spoken = extractVoiceoverText(value);
          const sourceLanguage = detectScriptLanguageCode(spoken || value);
          setScript(value);
          setVoiceoverLines(spoken);
          setScriptView('timestamp');
          setModeScripts(current => current.map(item => {
            if (item.id !== activeModeScriptId) return item;
            return manualScriptDraft(item, value);
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
              <p className="text-xs text-text-muted">分镜生成模型：千问（固定）；不影响视频分析与配音服务。</p>
            </div>

            {mode === 'clone' && (
              <section aria-label="爆款复刻口播生产链路" className="mb-4 rounded-2xl border border-border bg-surface p-4">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-black text-text-primary">爆款复刻口播生产链路</p>
                    <p className="mt-1 text-xs text-text-muted">原片粗时间码用于提取话术；新草稿替换品牌、产品等关键词；AI 配音的实测时间码用于成片分镜。</p>
                  </div>
                  <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[10px] font-bold text-text-secondary">{referenceSpeechLines.length} 段原片口播</span>
                </div>
                <div className="grid gap-2 lg:grid-cols-3">
                  <div className="min-w-0 rounded-xl border border-border bg-surface-2 p-3">
                    <p className="text-xs font-black text-text-primary">1 · 原片口播 · 粗时间码</p>
                    <div className="mt-2 max-h-52 space-y-2 overflow-y-auto">
                      {referenceSpeechLines.length ? referenceSpeechLines.map(line => (
                        <p key={line.key} className="text-[11px] leading-5 text-text-secondary"><span className="font-mono font-bold text-text-muted">{line.time}</span> {line.text}</p>
                      )) : <p className="text-[11px] text-text-muted">等待编导自动提取原片口播。</p>}
                    </div>
                  </div>
                  <div className="min-w-0 rounded-xl border border-border bg-surface-2 p-3">
                    <p className="text-xs font-black text-text-primary">2 · 新创作草稿 · 关键词替换</p>
                    <div className="mt-2 max-h-52 space-y-2 overflow-y-auto">
                      {draftSpeechLines.length ? draftSpeechLines.map((line, index) => (
                        <p key={`${line.time}-${index}`} className="text-[11px] leading-5 text-text-secondary"><span className="font-mono font-bold text-text-muted">{line.time}</span> {line.text}</p>
                      )) : referenceSpeechLines.some(line => line.draft) ? referenceSpeechLines.filter(line => line.draft).map(line => (
                        <p key={line.key} className="text-[11px] leading-5 text-text-secondary"><span className="font-mono font-bold text-text-muted">{line.time}</span> {line.draft}</p>
                      )) : <p className="text-[11px] text-text-muted">生成分镜脚本后，系统沿用原片口播并替换企业关键词。</p>}
                    </div>
                  </div>
                  <div className="min-w-0 rounded-xl border border-border bg-surface-2 p-3">
                    <p className="text-xs font-black text-text-primary">3 · AI 配音 · 实测时间码与分镜</p>
                    <p className="mt-1 text-[10px] text-text-muted">{measuredVoiceCues.length ? `已取得 ${measuredVoiceCues.length} 条实测口播时间码` : voiceoverAudios[activeVoiceLang]?.url ? '配音已生成，句级实测对齐待完成' : '等待 AI 配音；原片粗时间码不会冒充成片时间码'}</p>
                    <div className="mt-2 max-h-44 space-y-2 overflow-y-auto">
                      {measuredVoiceCues.map((cue, index) => {
                        const matched = storyboardSlots.filter(slot => slot.start < cue.end && slot.end > cue.start);
                        return <p key={`${cue.start}-${index}`} className="text-[11px] leading-5 text-text-secondary"><span className="font-mono font-bold text-text-muted">{cue.start.toFixed(2)}–{cue.end.toFixed(2)}s</span> {cue.text}<span className="block text-[10px] text-accent">{matched.length ? `匹配分镜：${matched.map(slot => slot.title || slot.id).join('、')}` : '待匹配分镜'}</span></p>;
                      })}
                    </div>
                  </div>
                </div>
              </section>
            )}

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
            {videoKickoff?.source === 'inspiration_person_replace' && (
              <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50 p-4 text-xs">
                <p className="font-bold">爆款裂变 · 分镜人物制作</p>
                <p className="mt-2">原片分析已带入。请在具体分镜的「选择数字人」中核对原句、人物、动作与场景，再确认制作要求。</p>
                <p className="mt-1 text-text-muted">参考人物制作当前仅支持方案预览；人物口播沿用已接通的生成能力。</p>
              </div>
            )}
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
                      onClick={() => onNavigate?.('socialInspiration')}
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
                            : voiceDraftStaleLangs.includes(code) && <span className="ml-1 text-amber-600">待同步</span>}
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
                      setVoiceDrafts(drafts => ({ ...drafts, [activeVoiceLang]: nextValue }));
                      if (nextValue.trim()) {
                        setVoiceDraftFailedLangs(current => current.filter(code => code !== activeVoiceLang));
                        setVoiceDraftStaleLangs(current => current.filter(code => code !== activeVoiceLang));
                      }
                      setVoiceoverAudios(current => { const next = { ...current }; delete next[activeVoiceLang]; return next; });
                      setAlignedCuesByLang(current => { const next = { ...current }; delete next[activeVoiceLang]; return next; });
                      if (activeVoiceLang === 'zh') setVoiceDraftStaleLangs(current => [...new Set([...current, ...voiceLangs.filter(code => code !== 'zh')])]);
                    }}
                    rows={6}
                    dir={activeVoiceLang === 'ar' ? 'rtl' : 'ltr'}
                    className="w-full rounded-xl border border-border bg-surface-2 p-3 font-mono text-sm leading-7 text-text-secondary outline-none focus:border-accent resize-none"
                  />
                  {voiceDraftStaleLangs.includes(activeVoiceLang) && (
                    <p className="text-xs font-semibold text-amber-700">主脚本已更新，此语言版本尚未同步。点击上方“提取口播并翻译”会重新本地化。</p>
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
                    {productionAudioUrl && <button type="button" disabled={ttsLoading} onClick={() => void refreshQwenAsr()} className="rounded-xl border px-3 py-2 text-xs font-bold disabled:opacity-50">千问转写/刷新（已有结果免费复用）</button>}
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
                      下方展示<strong>新口播音轨的句级时间</strong>，与原片粗时间码分开保存。配音成功后以实测时间码匹配分镜；尚未实测对齐的时间只供预览，不作为成片生产依据。
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
                          <button type="button" className="mt-1 text-[10px] underline" onClick={event => {
                            const field = event.currentTarget.parentElement?.querySelector('textarea');
                            const at = field?.selectionStart || Math.floor(cue.text.length / 2);
                            if (at <= 0 || at >= cue.text.length) return;
                            const middle = (cue.start + cue.end) / 2;
                            setAlignedCuesByLang(current => {
                              const next = [...(current[activeVoiceLang] || cues)];
                              next.splice(i, 1, { text: cue.text.slice(0, at), start: cue.start, end: middle }, { text: cue.text.slice(at), start: middle, end: cue.end });
                              return { ...current, [activeVoiceLang]: next };
                            });
                            setVoiceoverAudios(current => current[activeVoiceLang] ? { ...current, [activeVoiceLang]: { ...current[activeVoiceLang], alignmentSource: 'manual_pending' } } : current);
                            setTtsNotice('已按文字光标拆句；中间时间只是占位估算，请试听后调整并重新确认。');
                          }}>在文字光标处拆句（时间需试听校准）</button>
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
          materialCount: timelineForAssembly(plan).length,
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
                                : voiceoverMode === 'none' ? '脚本已就绪 · 不配音 · 尚未配乐' : '脚本与配音已生成 · 尚未配乐'}</span>
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
                      onClick={previewPlaying ? stopPreview : () => { void startPreview(); }}
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

            <div className="mt-4 rounded-xl border border-border bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div><p className="text-xs font-black text-text-primary">视频特效</p><p className="mt-0.5 text-[10px] text-text-muted">白名单运镜、调色、转场与装饰层</p></div>
                <span className="rounded-full bg-surface-2 px-2 py-1 text-[9px] font-bold text-text-muted">EffectPlan v1</span>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-1">
                {([
                  ['natural', '自然'], ['dynamic', '动感'], ['tech', '科技'], ['cinematic', '电影'],
                ] as Array<[EffectPresetId, string]>).map(([value, label]) => <button key={value} type="button" onClick={() => { setEffectPreset(value); setRendered(false); }} className={`rounded-lg px-1.5 py-2 text-[10px] font-bold ${effectPreset === value ? 'bg-accent text-white' : 'bg-surface-2 text-text-muted'}`}>{label}</button>)}
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1">
                {([['关闭', 0], ['弱', 1], ['中', 2], ['强', 3]] as Array<[string, EffectIntensity]>).map(([label, value]) => <button key={value} type="button" onClick={() => { setEffectIntensity(value); setRendered(false); }} className={`rounded-lg border px-1.5 py-1.5 text-[10px] font-bold ${effectIntensity === value ? 'border-accent bg-accent/5 text-accent' : 'border-border text-text-muted'}`}>{label}</button>)}
              </div>
              {effectIntensity > 0 && renderTimeline.length > 0 && <div className="mt-3 max-h-28 space-y-1 overflow-y-auto border-t border-border pt-2">
                {renderTimeline.map((item, index) => {
                  const id = String(item.clipId || index);
                  const enabled = !disabledEffectSceneIds.includes(id);
                  return <label key={`${id}-${index}`} className="flex items-center justify-between gap-2 text-[10px] text-text-secondary"><span className="truncate">镜头 {index + 1} · {item.name}</span><input type="checkbox" checked={enabled} onChange={() => { setDisabledEffectSceneIds(current => enabled ? [...current, id] : current.filter(value => value !== id)); setRendered(false); }} className="accent-emerald-600" /></label>;
                })}
              </div>}
            </div>

            <div className="mt-4 rounded-xl bg-surface-2 px-3 py-2.5">
              <p className="truncate text-xs font-bold text-text-primary">{selectedBgmTrack?.name || '当前未选择配乐'}</p>
              <p className="mt-1 text-[10px] text-text-muted">
                {bgm ? `配乐最终混音音量 ${bgmVol}%` : '选择一首音乐即可试听混剪效果'}
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
          const timeline = timelineForAssembly(plan);
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
        const frameCandidatesForPlan = (plan: StoryboardAssembly) => {
          const ids = timelineForAssembly(plan).map(item => item.clipId).filter(Boolean) as string[];
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
        const activeCoverFrameCandidates = activeCoverVersion ? frameCandidatesForPlan(activeCoverVersion.plan) : frameCandidates;
        const switchCoverMaterialVersion = (version: typeof coverMaterialVersions[number]) => {
          activateContentPlan(version.plan.id);
          previewLanguageVersion(version.code, false);
          const saved = materialVersionCovers[version.key];
          const candidates = frameCandidatesForPlan(version.plan);
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
              const candidates = frameCandidatesForPlan(version.plan);
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
              const first = frameCandidatesForPlan(version.plan)[0]?.id || '';
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
                    <span className="rounded-md bg-accent-glow px-2 py-1 text-[10px] font-black text-accent">{coverMaterialVersions.filter(item => Boolean(materialVersionCovers[item.key])).length}/{coverMaterialVersions.length} 已配置</span>
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
                    const candidates = frameCandidatesForPlan(item.plan);
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
        const outputVersions = buildRenderableVideoVersions().map(({ key, code, plan, planIndex, languageIndex, bgmId, script: versionScript, timeline: planTimeline }) => ({
            id: key, key, code, plan, bgmId,
            name: `${plan.name || `视频${planIndex + 1}`} * ${langZh(code) || `语种${languageIndex + 1}`}`,
            language: LANGS.find(item => item.code === code)?.label || code.toUpperCase(),
            script: versionScript,
            materials: planTimeline.map(item => item.name),
            bgm: bgms.find(item => item.id === bgmId)?.name || '无配乐',
            output: languageRenderOutputs[key],
            generations: languageRenderVersions[key] || [],
          }));
        const fallbackActiveKey = renderCombinationKey(activeAssemblyId, activeVoiceLang, bgm);
        const activeOutputVersion = outputVersions.find(item => item.key === activeRenderCombinationKey)
          || outputVersions.find(item => item.key === fallbackActiveKey)
          || outputVersions[0];
        // Never borrow another combination's output when the selected one has
        // not rendered. A formal preview must represent this exact version.
        const formalPreviewUrl = activeOutputVersion?.output?.status === 'done'
          ? activeOutputVersion.output.previewUrl
          : undefined;
        const activeFormalPreviewUrl = formalPreviewUrl;
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
                  {formalPreviewUrl ? (
                    <RenderedVideoPlayer key={formalPreviewUrl} src={formalPreviewUrl} onActivate={stopPreview} />
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
                {!formalPreviewUrl && previewIdx !== null && activePreviewCue && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-[7%] z-20 px-4 text-center">
                    <p className="inline-block max-w-full rounded-md bg-black/35 px-2 py-1 text-[17px] font-black leading-tight text-white"
                      style={{ textShadow: '0 2px 4px rgba(0,0,0,0.9)' }}>
                      {activePreviewCue.text}
                    </p>
                  </div>
                )}
                {!formalPreviewUrl && previewIdx === null && (
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
                      <button onClick={() => { void startPreview(); }}
                        className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg active:scale-95 transition-transform">
                        <Play size={22} className="text-text-primary ml-0.5" fill="currentColor" />
                      </button>
                    )}
                  </div>
                )}
                <audio ref={previewBgmAudioRef} src={selectedBgmTrack?.url || undefined} preload="auto" />
                <audio ref={previewVoiceAudioRef} src={activeVoiceoverUrl || undefined} preload="auto" />
                {!formalPreviewUrl && previewIdx !== null && (
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
                      <p className="mt-0.5 text-xs text-text-muted">每种已生成的语言对应独立成片。请核对语言与配乐；未选音乐的版本将无背景配乐。</p>
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
                              selectOutputVersion(version);
                              setLanguageRenderOutputs(prev => ({ ...prev, [version.key]: { status: generation.status, path: generation.path, previewUrl: generation.previewUrl, error: generation.error } }));
                              setRenderOutputPath(generation.status === 'done' ? generation.path || null : null);
                              setRenderOutputPreviewUrl(generation.status === 'done' ? generation.previewUrl || null : null);
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
                  onClick={() => void downloadMp4(activeOutputVersion?.output?.status === 'done' ? activeOutputVersion.output.path || null : null)}
                  disabled={rendering}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-white px-5 py-3.5 text-sm font-black text-text-primary shadow-sm transition hover:border-accent/50 hover:bg-surface-2 disabled:opacity-50 active:scale-[0.99]"
                >
                  {rendering ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                  {rendering ? (renderPct >= 90 ? `正在写入 MP4 ${renderPct}%` : `正在生成本地成片 ${renderPct}%`) : renderOutputPath ? '下载成片' : '生成并下载成片'}
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

  const socialViralTask = Boolean(socialContentTaskId && mode === 'clone' && contentMode === 'video');
  const shotRouteFor = (slot: StoryboardSlot) =>
    serverShotRoutes.projectId === projectId && serverShotRoutes.routes[slot.id]
      ? serverShotRoutes.routes[slot.id]! : visualShotRoute(slot);
  const referenceSpeechPlan = useMemo(() => buildReferenceSpeechPlan(videoKickoff, referenceProductMappings), [videoKickoff, referenceProductMappings]);
  const referenceSourceLanguage = useMemo(() => referenceSpeechPlan.lines.length
    ? detectSourceSpeechLanguageCode(referenceSpeechPlan.lines.map(line => line.source).join(' '))
    : '', [referenceSpeechPlan]);
  useEffect(() => {
    if (!socialViralTask || !referenceSourceLanguage || script.trim()) return;
    setVoiceLangs(current => current[0] === referenceSourceLanguage
      ? current : [referenceSourceLanguage, ...current.filter(code => code !== referenceSourceLanguage)]);
    setLang(referenceSourceLanguage);
    setActiveVoiceLang(referenceSourceLanguage);
  }, [socialViralTask, referenceSourceLanguage, script]);
  useEffect(() => {
    if (!socialViralTask || !storyboardSlots.length) return;
    setShotProductions(current => {
      let next = current;
      for (const slot of storyboardSlots) {
        const voice = storyboardSlotScript(slot.detail).voice;
        if (shotRouteFor(slot) !== 'presenter' || isNonSpeechSfx(voice)) continue;
        const key = productionKey(slot.id);
        if (next[key]) continue; // A user's explicit route remains authoritative.
        const base = newProductionFor(slot);
        next = { ...next, [key]: { ...base, source: 'avatar', sound: 'source' } };
      }
      return next;
    });
  }, [socialViralTask, storyboardSlots, activeAssemblyId, productionDefaults, serverShotRoutes]);
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
    contentGoal: effectiveContentGoal,
    cooperationRoute,
    sellingPoints: sellingPoints.trim(),
    tone,
    videoThemeId,
    themePainPoint: themePainPoint.trim(),
    themeConversionGoal: themeConversionGoal.trim(),
    selectedMaterialIds: selectedVisualClips.map(item => item.id).sort(),
    hookMaterialId,
    referenceId: videoKickoff?.generatedVideo?.id || videoKickoff?.video?.videoUrl || videoKickoff?.video?.sourceUrl || '',
  }), [mode, contentMode, platform, ratio, duration, selectedProductIds, activeProductInfo, audience, effectivePrimaryCta, effectiveContentGoal, cooperationRoute, sellingPoints, tone, videoThemeId, themePainPoint, themeConversionGoal, selectedVisualClips, hookMaterialId, videoKickoff]);
  useEffect(() => {
    if (hasTimestampScript && !lastGeneratedSetupSignature) setLastGeneratedSetupSignature(setupSignature);
  }, [hasTimestampScript, lastGeneratedSetupSignature, setupSignature]);
  const setupChangedSinceGeneration = hasTimestampScript && Boolean(lastGeneratedSetupSignature) && lastGeneratedSetupSignature !== setupSignature;
  const primaryGeneratesSetupScript = contentMode === 'video' && step === 'mode' && (socialViralTask || !hasTimestampScript || setupChangedSinceGeneration);
  const primaryReturnsToExistingScript = contentMode === 'video' && step === 'mode' && !socialViralTask && hasTimestampScript && !setupChangedSinceGeneration;
  const primaryGeneratesStoryboard = contentMode === 'video' && step === 'script' && scriptStageTab === 'theme' && !hasTimestampScript;
  const socialPosterArtifactReady = posterGenerationIsVerified
    && Boolean(projectId)
    && isSocialArtifactMediaSourceEligible({ source: posterImageUrl, contentMode: 'poster' });
  const primaryGeneratesPoster = contentMode === 'poster' && step === 'poster' && !(socialContentTaskId && socialPosterArtifactReady);
  const primaryGeneratesCopy = contentMode === 'video' && step === 'script' && scriptStageTab === 'voiceover' && !hasRequestedVoiceDrafts;
  const primaryGeneratesVoice = contentMode === 'video' && step === 'script' && scriptStageTab === 'audio' && voiceoverMode === 'ai' && !hasRequestedVoiceovers;
  const primaryGeneratesSubtitles = contentMode === 'video' && step === 'script' && scriptStageTab === 'subtitle' && !hasRequestedSubtitles;
  const storyboardGenerationBlocked = modeActionLoading || (mode === 'clone' && !socialViralTask && hasIncompleteReferenceAnalysis(videoKickoff));
  const workbenchStageIndex = stageIdx;
  const workbenchStageId = workbenchStageIndex === 0 ? 'settings' : workbenchStageIndex === 1 ? 'script' : 'production';
  const workbenchSteps: StudioWorkbenchStep[] = contentMode === 'poster'
    ? [
      { id: 'settings', label: '创作设置', status: stageIdx > 0 ? 'complete' : 'active' },
      { id: 'script', label: '素材准备', status: stageIdx > 1 ? 'complete' : stageIdx === 1 ? 'active' : 'upcoming' },
      { id: 'production', label: '图文制作', status: stageIdx === 2 ? 'active' : 'upcoming' },
    ]
    : [
      { id: 'settings', label: '创作设置', status: workbenchStageIndex > 0 ? 'complete' : 'active' },
      { id: 'script', label: '脚本与声音', status: workbenchStageIndex > 1 ? 'complete' : workbenchStageIndex === 1 ? 'active' : 'upcoming' },
      { id: 'production', label: '成片制作', status: workbenchStageIndex === 2 ? 'active' : 'upcoming' },
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
        title: videoKickoff ? (hasIncompleteReferenceAnalysis(videoKickoff) ? '参考逐镜结构待复核' : '参考结构已准备') : '缺少参考视频',
        detail: videoKickoff && hasIncompleteReferenceAnalysis(videoKickoff)
          ? `已带入 ${(videoKickoff.referenceAnalysis?.details || []).length} 段分析线索；请到灵感中心核对分镜、逐句口播及交接证据。`
          : selectedVisualClips.length
            ? `参考结构 + ${selectedVisualClips.length} 项企业素材；将优先使用真实画面。`
            : '可先生成脚本，成片前再从当前账号素材库匹配画面。',
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
      const assigned = materialById.get(storyboardAssignments[slot.id] || '');
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
  }, [materialById, ratio, selectedVisualClips, storyboardAssignments, storyboardSlots]);
  const activeWorkbenchSlot = storyboardSlots.find(item => item.id === activeStoryboardSlotId) || storyboardSlots[0];
  const activeWorkbenchClip = activeWorkbenchSlot
    ? materialById.get(storyboardAssignments[activeWorkbenchSlot.id] || '')
    : previewClip || selectedClips[0];
  const activeMaterialPlan = activeWorkbenchSlot ? sourcePlanFor(activeWorkbenchSlot) : null;
  const activeMaterialAssessment = activeWorkbenchSlot && activeWorkbenchClip
    ? assessMaterialMatch(activeWorkbenchSlot, activeWorkbenchClip, ratio)
    : null;
  const activeMaterialCandidates = useMemo(() => {
    if (!activeWorkbenchSlot) return [] as Array<{ clip: Clip; assessment: MaterialMatchAssessment }>;
    return materials
      .filter(clip => clip.type === 'video' || clip.type === 'image')
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
    const nextSlot = storyboardSlots.slice(currentIndex + 1).find(item => !storyboardAssignments[item.id]);
    if (nextSlot) setActiveStoryboardSlotId(nextSlot.id);
    setModeNotice(`已为分镜 ${currentIndex + 1} 选择“${clip.name}”，将从素材第一帧起按分镜时长自动裁切。`);
  };
  const workbenchFormalPreviewUrl = languageRenderOutputs[activeRenderCombinationKey]?.previewUrl
    || renderOutputPreviewUrl
    || Object.values(languageRenderOutputs).find(output => output?.status === 'done' && output.previewUrl)?.previewUrl
    || '';
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
    const formalPreview = step === 'preview' && Boolean(workbenchFormalPreviewUrl);
    if (!video || workbenchPlaying || (!formalPreview && activeWorkbenchClip?.type !== 'video')) return;
    const requestedTime = resolveWorkbenchSeekTime(formalPreview, workbenchTimelineTime, workbenchSeekTime);
    const seek = () => {
      const maxTime = Number.isFinite(video.duration) && video.duration > 0
        ? Math.max(0, video.duration - 0.05)
        : requestedTime;
      try {
        video.pause();
        video.currentTime = Math.min(requestedTime, maxTime);
      } catch { /* 等待媒体元数据后由 loadedmetadata 再定位 */ }
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener('loadedmetadata', seek, { once: true });
    return () => video.removeEventListener('loadedmetadata', seek);
    // Seeking is tied to a selected shot, not the running playback clock.
    // `timeupdate` changes workbenchTimelineTime many times per second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkbenchClip?.id, activeWorkbenchClip?.type, activeWorkbenchSlot?.id, step, workbenchFormalPreviewUrl, workbenchPlaying]);
  const playableWorkbenchSlots = storyboardSlots.filter(slot => {
    const clip = materialById.get(storyboardAssignments[slot.id] || '');
    return Boolean(clip?.url && (clip.type === 'video' || clip.type === 'image'));
  });
  const advanceWorkbenchPlayback = () => {
    if (!workbenchPlaying || !activeWorkbenchSlot || workbenchAdvanceLockRef.current) return;
    workbenchAdvanceLockRef.current = true;
    const next = playableWorkbenchSlots.find(slot => slot.start > activeWorkbenchSlot.start);
    workbenchLoopOffsetRef.current = 0;
    if (!next) {
      setWorkbenchPlaying(false);
      setWorkbenchTimelineTime(workbenchTimelineDuration);
      return;
    }
    setActiveStoryboardSlotId(next.id);
    setWorkbenchTimelineTime(next.start);
  };
  const toggleWorkbenchPlayback = () => {
    if (workbenchPlaying) {
      workbenchVideoRef.current?.pause();
      setWorkbenchPlaying(false);
      return;
    }
    const first = playableWorkbenchSlots[0];
    if (!first) { setWorkbenchPlaybackError('当前没有可播放的分镜素材。'); return; }
    setWorkbenchPlaybackError('');
    workbenchLoopOffsetRef.current = 0;
    workbenchAdvanceLockRef.current = false;
    setCanvasView('creation');
    setActiveStoryboardSlotId(first.id);
    setWorkbenchTimelineTime(first.start);
    setWorkbenchPlaying(true);
    if (activeWorkbenchSlot?.id === first.id && activeWorkbenchClip?.type === 'video') {
      const video = workbenchVideoRef.current;
      if (video) {
        try { video.currentTime = editForSlot(activeWorkbenchClip, first).trimStart; } catch { /* metadata will seek */ }
        void video.play().catch(error => setWorkbenchPlaybackError(`素材播放失败：${error instanceof Error ? error.message : String(error)}`));
      }
    }
  };
  useEffect(() => {
    if (workbenchImageTimerRef.current !== null) window.clearTimeout(workbenchImageTimerRef.current);
    workbenchImageTimerRef.current = null;
    workbenchAdvanceLockRef.current = false;
    if (!workbenchPlaying || !activeWorkbenchSlot || canvasView === 'reference' || step === 'preview' && workbenchFormalPreviewUrl) return;
    if (activeWorkbenchClip?.type === 'image') {
      workbenchImageTimerRef.current = window.setTimeout(advanceWorkbenchPlayback, Math.max(0.1, activeWorkbenchSlot.end - activeWorkbenchSlot.start) * 1000);
    } else if (activeWorkbenchClip?.type === 'video') {
      const video = workbenchVideoRef.current;
      if (video) {
        const edit = editForSlot(activeWorkbenchClip, activeWorkbenchSlot);
        const start = () => {
          try { video.currentTime = edit.trimStart; video.playbackRate = Math.max(0.25, Math.min(4, edit.speed || 1)); } catch { /* wait for metadata */ }
          void video.play().catch(error => { setWorkbenchPlaying(false); setWorkbenchPlaybackError(`素材播放失败：${error instanceof Error ? error.message : String(error)}`); });
        };
        if (video.readyState >= 1) start();
        else video.addEventListener('loadedmetadata', start, { once: true });
        return () => { video.removeEventListener('loadedmetadata', start); };
      }
    }
    return () => { if (workbenchImageTimerRef.current !== null) window.clearTimeout(workbenchImageTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workbenchPlaying, activeWorkbenchSlot?.id, activeWorkbenchClip?.id, canvasView, step, workbenchFormalPreviewUrl]);
  const focusWorkbenchStoryboardSlot = (slotId: string) => {
    const nextSlot = storyboardSlots.find(item => item.id === slotId);
    if (!nextSlot) return;
    setWorkbenchPlaying(false);
    workbenchVideoRef.current?.pause();
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
    setWorkbenchPlaying(false);
    workbenchVideoRef.current?.pause();
    const safeTime = Math.max(0, Math.min(workbenchTimelineDuration, nextTime));
    const nextSlot = storyboardSlots.find(slot => safeTime >= slot.start && safeTime < slot.end)
      || storyboardSlots[storyboardSlots.length - 1];
    setWorkbenchTimelineTime(safeTime);
    if (!nextSlot) return;
    setActiveStoryboardSlotId(nextSlot.id);
    setCanvasView('creation');
    if (step === 'cover') setCoverTimelineCaptureMode(true);
    window.requestAnimationFrame(() => {
      const video = workbenchVideoRef.current;
      const formalPreview = step === 'preview' && Boolean(workbenchFormalPreviewUrl);
      const clip = materialById.get(storyboardAssignments[nextSlot.id] || '');
      if (formalPreview && video) {
        const applyFormalSeek = () => {
          const maxTime = Number.isFinite(video.duration) && video.duration > 0 ? Math.max(0, video.duration - 0.05) : safeTime;
          try { video.pause(); video.currentTime = Math.min(safeTime, maxTime); } catch { /* wait for metadata */ }
        };
        if (video.readyState >= 1) applyFormalSeek();
        else video.addEventListener('loadedmetadata', applyFormalSeek, { once: true });
        return;
      }
      if (!video || clip?.type !== 'video') return;
      const edit = editForSlot(clip, nextSlot);
      const localOffset = Math.max(0, Math.min(nextSlot.end - nextSlot.start, safeTime - nextSlot.start));
      const seekTo = edit.trimStart + localOffset * Math.max(0.1, edit.speed || 1);
      const applySeek = () => {
        const maxTime = Number.isFinite(video.duration) && video.duration > 0 ? Math.max(0, video.duration - 0.05) : seekTo;
        try { video.currentTime = Math.min(seekTo, maxTime); } catch { /* wait for metadata */ }
      };
      if (video.readyState >= 1) applySeek();
      else video.addEventListener('loadedmetadata', applySeek, { once: true });
    });
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
    const material = materialById.get(storyboardAssignments[slot.id] || '');
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
                      ? { status: 'warning' as const, label: `单项匹配 ${materialAssessment.score} 分` }
          : material ? { status: 'warning' as const, label: `低匹配 ${materialAssessment?.score || 0} 分` } : { status: 'idle' as const, label: '待匹配' };
    return {
      id: slot.id,
      index: index + 1,
      title: `${slot.title || `分镜 ${index + 1}`}${personContinuityBySlot[slot.id] ? ` · 同一人物 ${personContinuityBySlot[slot.id]}` : ''}`,
      thumbnailUrl: material?.poster || (material?.type === 'image' ? material.url : undefined),
      duration: `${Math.max(0.1, slot.end - slot.start).toFixed(1)}s`,
      voiceover: slotScript.voice || slotScript.visual || slotScript.fallback,
      status: working ? 'working' as const : warning ? 'warning' as const : stageStatus.status,
      statusLabel: working ? '处理中' : warning ? '需检查' : stageStatus.label,
    };
  });
  const referenceStoryboardItems = (videoKickoff?.referenceAnalysis?.details || []).flatMap((detail, index) => {
    const range = parseCueRange(detail.time);
    if (!range) return [];
    const productShot = index > 0 && range.end - range.start <= 2.5
      && /mask|marks|cream|foundation|essence|oil|shampoo|面膜|修护|美白|粉底|精华|按摩|洗发/i.test(detail.subtitle || '')
      && !/实验服|工人|灌装|传送带|试剂|设备|实验台|生产线/.test((detail.visual || '').slice(0, 45));
    return [{
      id: detail.shotId || `reference-shot-${index + 1}`,
      index: index + 1,
      title: index === 0 ? '前三秒钩子' : productShot ? '产品实拍' : detail.purpose === 'hook' || detail.purpose === 'd_to_c' ? 'D to C' : detail.purpose || `爆款分镜 ${index + 1}`,
      duration: `${range.start.toFixed(1)}–${range.end.toFixed(1)}s`,
      voiceover: productShot ? `${detail.visual}${detail.dialogue ? ` · 口播：${detail.dialogue}` : ''}` : detail.dialogue || detail.visual || detail.subtitle,
      status: 'ready' as const,
      statusLabel: '原片分镜',
      start: range.start,
      end: range.end,
    }];
  });
  const selectedReferenceShot = referenceStoryboardItems.find(item => referenceTimelineTime >= item.start && referenceTimelineTime < item.end)
    || referenceStoryboardItems[0];
  const referenceTimelineDuration = Math.max(0.1, videoKickoff?.video?.duration || 0, ...referenceStoryboardItems.map(item => item.end));
  const seekReferenceTimeline = (seconds: number) => {
    const safeSeconds = Math.max(0, Math.min(referenceTimelineDuration, seconds));
    setReferenceTimelineTime(safeSeconds);
    setReferenceSeekRequest({ seconds: safeSeconds, requestId: Date.now() + Math.random() });
  };
  const focusReferenceStoryboardShot = (shotId: string) => {
    const shot = referenceStoryboardItems.find(item => item.id === shotId);
    if (!shot) return;
    seekReferenceTimeline(shot.start);
  };
  const workbenchHasFormalVideo = Boolean(
    renderOutputPath || Object.values(languageRenderOutputs).some(output => output.status === 'done' && output.path),
  );
  const socialVideoMediaReady = isSocialArtifactMediaSourceEligible({ source: workbenchFormalPreviewUrl, contentMode: 'video' });
  const socialVideoArtifactReady = activeScriptGenerationIsVerified
    && Boolean(projectId)
    && socialVideoMediaReady;
  const primaryGeneratesVideo = contentMode === 'video' && step === 'preview' && (!workbenchHasFormalVideo || Boolean(socialContentTaskId && !socialVideoMediaReady));
  const workbenchRenderableVersionCount = primaryGeneratesVideo ? buildRenderableVideoVersions().length : 0;
  const { ready: primarySubmitsSocialArtifact, submitting: socialArtifactSubmitting, submit: submitCurrentSocialArtifact } = useStudioSocialArtifactSubmission({
    enabled: Boolean(socialContentTaskId && (contentMode === 'poster' ? step === 'poster' && socialPosterArtifactReady : step === 'preview' && socialVideoArtifactReady)),
    taskId: socialContentTaskId,
    snapshot: {
      sourceKey: `studio_${projectId || generationSessionId.current}`.replace(/[^a-z0-9:_-]/gi, '_').slice(0, 200),
      title: projectTitle, contentMode, platform,
      language: contentMode === 'video' ? activeVoiceLang : lang, aspectRatio: ratio, durationSeconds: contentMode === 'video' ? duration : null,
      body: contentMode === 'poster' ? caption.trim() || posterJsonText.trim() : caption.trim() || voiceDrafts[activeVoiceLang]?.trim() || activeSpokenScript || script,
      coverTitle, projectId, outputUrl: contentMode === 'poster' ? posterImageUrl : workbenchFormalPreviewUrl,
      generationKind: contentMode === 'poster' ? 'poster' : 'script',
      generationProvenance: contentMode === 'poster'
        ? String(posterDraft?.provenance || posterDraft?.source || '')
        : currentPublishGeneration().generationProvenance,
      qualityStatus: contentMode === 'poster'
        ? String(posterDraft?.qualityStatus || 'unreviewed')
        : currentPublishGeneration().qualityStatus,
      publishable: contentMode === 'poster' ? posterGenerationIsVerified : activeScriptGenerationIsVerified,
      generationRecordId: contentMode === 'poster' ? 'poster-current' : currentPublishGeneration().generationRecordId,
    },
    onSubmitted: () => { setSavedTick(true); setAutosaveStatus('saved'); setLastAutosavedAt(new Date()); window.setTimeout(() => setSavedTick(false), 1_800); },
    onNotice: setModeNotice,
  });
  const generateSetupScriptAndContinue = async () => {
    if (socialViralTask) {
      if (!localGateBypass && (!selectedProductOptions.length || !activeProductLabel)) {
        setProductSelectorOpen(true);
        setModeNotice('请先从企业中心选择本次复刻的产品。');
        return;
      }
      if (!localGateBypass && referenceProducts.length && (selectedProductOptions.length !== referenceProducts.length
        || referenceProductMappings.some(mapping => !mapping.productId || !mapping.sourceTerm.trim())
        || new Set(referenceProductMappings.map(mapping => mapping.productId)).size !== referenceProducts.length)) {
        setProductSelectorOpen(true);
        setModeNotice(`原片有 ${referenceProducts.length} 个产品位，请选择同样数量的企业产品，并逐一完成不重复的映射。`);
        return;
      }
      setModeActionLoading(true);
      try {
        setModeActionStatus('正在读取并保存产品方案…');
        const task = await socialContentApi.getTask(socialContentTaskId!);
        const selectedProductLabel = selectedProductOptions[0]?.label || activeProductLabel || task.brief.productRef || '本地测试产品';
        const updated = await socialContentApi.updateTask(task.taskId, {
          expectedVersion: task.version,
          changes: { productId: null, productRef: selectedProductLabel },
        });
        const nextKickoff = socialTaskReferenceKickoff(updated);
        const plan = buildReferenceSpeechPlan(nextKickoff, referenceProductMappings);
        setVideoKickoff(nextKickoff);
        setSocialTaskProductReference(selectedProductLabel);
        if (plan.error && !(localGateBypass && plan.lines.length > 0)) { setModeNotice(plan.error); return; }
        applyTimestampScript(plan.script);
        setModeNotice('口播方案已生成，正在生成 AI 配音并测量逐句时间码…');
        const spoken = plan.lines.map(line => line.draft).join(' ').trim();
        const language = detectSourceSpeechLanguageCode(plan.lines.map(line => line.source).join(' ')) || detectScriptLanguageCode(spoken);
        const settings = ttsLanguageSettings[language] || DEFAULT_TTS_SETTINGS;
        setModeActionStatus(`正在生成 ${plan.lines.length} 句配音并检查音频质量，请稍候…`);
        const audio = await studioApi.tts({ text: spoken, sentenceLines: plan.lines.map(line => line.draft), voice: settings.voiceId || voice, language, style: {
          preset: settings.preset, emotion: settings.emotion, emotionIntensity: settings.emotionIntensity,
          speed: settings.speed, pauseStyle: settings.pauseStyle,
          pronunciations: parsePronunciationRules(settings.pronunciationText),
        } });
        if (!audio.ok || !audio.url || !(audio.duration && audio.duration > 0)) throw new Error(audio.error || '配音未生成，无法进入分镜匹配。');
        let cues = productionVoiceCues(audio.cues, audio.alignmentSource, audio.duration);
        let alignmentSource: string | undefined = audio.alignmentSource;
        if (!cues.length) {
          setModeActionStatus('配音已生成，正在对齐逐句时间码…');
          const aligned = await studioApi.alignTts({ text: spoken, url: audio.url, duration: audio.duration });
          cues = productionVoiceCues(aligned.cues, aligned.source, audio.duration);
          alignmentSource = aligned.source;
        }
        if (!cues.length) throw new Error('配音已生成，但未取得实测时间码；请重试对齐后再匹配分镜。');
        setModeActionStatus('正在按配音时长建立分镜…');
        const grouped = mapNarrationCues(plan.lines.map(line => line.draft), cues, audio.duration, alignmentSource);
        if (grouped.length !== plan.lines.length || grouped.some(item => !item)) throw new Error('实测时间码无法完整对应逐句口播，请修正口播后重试。');
        const sentenceCues: SubCue[] = grouped.map((item, index) => ({ start: item!.start, end: item!.end, text: plan.lines[index]!.draft }));
        setVoiceoverMode('ai');
        setVoiceoverAudios(current => ({ ...current, [language]: { url: audio.url!, duration: audio.duration!, cues: sentenceCues, text: spoken, alignmentSource } }));
        setAlignedCuesByLang(current => ({ ...current, [language]: sentenceCues }));
        setVoiceoverStaleLangs(current => current.filter(code => code !== language));
        setVoiceoverUrl(audio.url);
        setVoiceoverDur(audio.duration);
        setActiveVoiceLang(language);
        setLang(language);
        setLastGeneratedSetupSignature(setupSignature);
        const materialIndex = activeSteps.findIndex(item => item.id === 'material');
        if (materialIndex >= 0) setStepIdx(materialIndex);
        setActiveStoryboardSlotId('slot-1');
        setCanvasView('creation');
        setModeNotice(`已生成 ${plan.lines.length} 句口播配音并取得实测时间码；现在按配音时长逐镜匹配素材。`);
      } catch (error) {
        setModeNotice(error instanceof Error ? error.message : '企业产品与口播方案更新失败，请重试。');
      } finally {
        setModeActionLoading(false);
        setModeActionStatus('');
      }
      return;
    }
    if (!localGateBypass && mode === 'material' && !selectedVisualClips.length) {
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
  const runBatchShotJobs = async () => {
    if (!socialViralTask || batchShotBusy || !storyboardSlots.length) return;
    if (!voiceoverAudios[activeVoiceLang]?.url || voiceoverStaleLangs.includes(activeVoiceLang)
      || !productionVoiceCues(voiceoverAudios[activeVoiceLang]?.cues, voiceoverAudios[activeVoiceLang]?.alignmentSource, voiceoverAudios[activeVoiceLang]?.duration || 0).length) {
      setModeNotice('请先生成口播配音并取得实测逐句时间码，再生成分镜素材。');
      return;
    }
    if (savingProj || autosaveInFlightRef.current || sourceDraftCheckPending || existingSourceDraftPrompt) {
      setModeNotice('草稿仍在保存，请稍后再启动逐镜制作。');
      return;
    }
    setBatchShotBusy(true);
    setBatchShotSummary(null);
    setBatchShotResults([]);
    autosaveInFlightRef.current = true;
    try {
      const matched = await smartSelectMaterialsFast();
      const spec = collectSpec();
      const batchSpec = matched ? {
        ...spec,
        ...matched,
        materialSnapshots: [...new Map([
          ...spec.materialSnapshots,
          ...materials.filter(item => matched.selected.includes(item.id)),
        ].map(item => [item.id, item])).values()],
        storyboardAssemblies: spec.storyboardAssemblies.map(item => item.id === activeAssemblyId
          ? { ...item, assignments: matched.storyboardAssignments, sourcePlans: matched.storyboardSourcePlans, selected: matched.selected }
          : item),
      } : spec;
      const saved = await studioApi.saveProject({ id: projectId || undefined, title: projectTitle, status: 'draft', spec: batchSpec });
      if (!saved.ok || !saved.project?.id) throw new Error('草稿未能保存，未启动逐镜生成。');
      projectRevisionRef.current = saved.project.updatedAt;
      setProjectId(saved.project.id);
      const signature = `${saved.project.id}:${productionSignature}:${JSON.stringify(batchSpec.storyboardAssignments)}`;
      if (batchShotRequestRef.current?.signature !== signature) {
        batchShotRequestRef.current = { signature, batchId: crypto.randomUUID() };
      }
      const result = await productionApi.batchShotJobs({
        projectId: saved.project.id,
        batchId: batchShotRequestRef.current.batchId,
        confirmed: true,
      });
      setBatchShotSummary(result.counts);
      setBatchShotResults(result.results);
      void productionApi.batchShotRoutes(saved.project.id).then(plannedRoutes => {
        setServerShotRoutes({ projectId: saved.project.id, routes: Object.fromEntries(plannedRoutes.routes.map(item => [item.slotId,
          item.route === 'digital_human' ? 'presenter' : item.route === 'seedance_action' ? 'motion' : 'material'])) });
      }).catch(() => {});
      setModeNotice(`逐镜制作：${result.counts.submitted} 镜已提交数字人任务，${result.counts.matched} 镜复用已关联素材，${result.counts.needsMaterial} 镜待补素材，${result.counts.blocked} 镜因执行器或资产条件未满足而阻塞。提交不等于成片完成。`);
      setProductionJobs(await productionApi.jobs(saved.project.id));
      setProductionExecutions(await productionApi.executions(saved.project.id));
    } catch (error) {
      setModeNotice(error instanceof Error ? error.message : '批量逐镜制作失败；没有确认成功的镜头不会标为完成。');
    } finally {
      autosaveInFlightRef.current = false;
      setBatchShotBusy(false);
    }
  };
  const runPrimaryAction = () => {
    if (!localGateBypass && step === 'script' && scriptStageTab !== 'theme' && !hasTimestampScript) {
      setScriptStageTab('theme');
      setModeNotice('请先生成并确认分镜脚本，再继续口播、翻译和配音。');
      return;
    }
    if (primarySubmitsSocialArtifact) return void submitCurrentSocialArtifact();
    if (step === 'preview' && workbenchHasFormalVideo && !primaryGeneratesVideo) {
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
      void renderSelectedLanguageVersion(undefined, Boolean(socialContentTaskId));
      return;
    }
    next();
  };

  const primaryActionLabel = primarySubmitsSocialArtifact ? '提交确认' : primaryGeneratesPoster
    ? posterJsonText ? '重新生成图文' : '生成图文'
    : primaryGeneratesSetupScript
      ? socialViralTask ? '生成口播配音并进入分镜制作' : hasTimestampScript ? '更新脚本' : '生成脚本'
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
          ? socialContentTaskId && workbenchHasFormalVideo ? '生成可提交成片' : '生成成片'
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
              ? '请先选择声音策略'
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
  const primaryActionBlockedReason = localGateBypass ? undefined : primaryGeneratesSetupScript && mode === 'material' && !selectedVisualClips.length
    ? '先选择本次创作素材，脚本才会按真实画面生成。'
    : primaryGeneratesSetupScript && socialViralTask && referenceSpeechPlan.error
    ? referenceSpeechPlan.error
    : (primaryGeneratesSetupScript || primaryGeneratesStoryboard) && mode === 'clone' && !socialViralTask && hasIncompleteReferenceAnalysis(videoKickoff)
    ? referenceRecoveryMessage || '参考视频时间线仍有缺口，请等待编导 Agent 自动补齐镜头证据。'
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
      : step === 'script' && activeScriptQualityBlocked
        ? `分镜脚本未通过质量校验：${activeScriptQualityItem?.validationIssues?.[0] || '请返回分镜脚本修复后再继续。'}`
      : step === 'script' && !canNext && !primaryGeneratesStoryboard
        ? voiceoverMode === 'unselected' ? '请选择 AI 配音、上传口播或无口播。' : '至少完成一种语言的有效口播，或明确选择无口播。'
        : undefined;
  const primaryActionLoading = primarySubmitsSocialArtifact ? socialArtifactSubmitting : primaryGeneratesPoster ? posterLoading : primaryGeneratesSetupScript || primaryGeneratesStoryboard ? modeActionLoading : primaryGeneratesCopy ? voiceDraftLoading : primaryGeneratesSubtitles ? subtitleGenerating : ttsLoading || rendering || batchRenderingLangs;
  const primaryActionDisabled = localGateBypass ? primaryActionLoading : primarySubmitsSocialArtifact ? socialArtifactSubmitting : primaryGeneratesPoster
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
  const sourceWorkflowContext = agentProduction.active ? workflowContext : projectWorkflowContext;
  const agentSourceContext = sourceWorkflowContext?.taskId
    ? `${sourceWorkflowContext.preview ? '制作方案预览' : '灵小图'} · ${workflowTaskLabel[sourceWorkflowContext.taskKey || 'content_production'] || '内容制作'}`
    : studioAgentSourceLabel(videoKickoff?.actionContext?.source || videoKickoff?.source);
  const focusProductContext = activeProductLabel || '待选择企业产品';
  const productionEditorSlot = storyboardSlots.find(item => item.id === productionEditorId);
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
          const isSource = code === workflowSourceLanguage;
          return (
            <div key={code} className={`flex items-center overflow-hidden rounded-lg border transition ${selectedLanguage ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : failed ? 'border-red-200 bg-red-50 text-red-600' : 'border-border bg-white text-text-secondary'}`}>
              <button type="button" onClick={() => { setActiveVoiceLang(code); setLang(code); }} className="px-2.5 py-1.5 text-[10px] font-bold hover:bg-black/[0.03]">
                {LANGS.find(item => item.code === code)?.label || code}{isSource ? ' · 原文' : ''}
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

  const invalidateMusicRender = () => {
    setRendered(false); setRenderOutputPath(null); setRenderOutputPreviewUrl(null);
    setLanguageRenderOutputs({});
  };
  const applyWorkbenchBgm = (trackId: string) => {
    invalidateMusicRender();
    setBgm(trackId);
    setAssemblyBgms(current => ({ ...current, [activeAssemblyId]: trackId }));
    setMaterialVersionBgms(current => ({ ...current, [materialVersionKey(activeAssemblyId, activeVoiceLang)]: trackId }));
    setPreviewBgmOn(Boolean(trackId));
  };
  const workbenchProductionPanel = (step === 'bgm' || (step === 'script' && scriptStageTab === 'bgm')) ? (
    <section ref={bgmLibraryRef} className="space-y-3">
      <input ref={bgmInputRef} type="file" accept="audio/*" className="hidden" onChange={event => { void handleBgmUpload(event.target.files); event.target.value = ''; }} />
      <div className="rounded-xl border border-border bg-surface-2 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><p className="text-xs font-black text-text-primary">当前配乐</p><p className="mt-1 truncate text-[10px] text-text-muted">{selectedBgmTrack?.name || '不配乐，仅保留素材原声和口播'}</p></div>
          {selectedBgmTrack && <button type="button" onClick={() => togglePlay(selectedBgmTrack)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-white text-text-secondary">{playingBgm === selectedBgmTrack.id ? <Pause size={13} /> : <Play size={13} />}</button>}
        </div>
        <label className="mt-3 block text-[10px] font-bold text-text-secondary">配乐音量 · {bgmVol}%<input type="range" min="0" max="100" value={bgmVol} disabled={!bgm} onChange={event => { setBgmVol(Number(event.target.value)); invalidateMusicRender(); }} className="mt-2 w-full accent-emerald-600 disabled:opacity-35" /></label>
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
      <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[10px] leading-4 text-text-muted">数字员工默认自动匹配配乐。可在这里试听、换曲或调整音量；修改后重新生成成片，听取口播与配乐的最终混音效果。</p>
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
      <div className="space-y-2 rounded-xl border border-border bg-white p-3 text-[10px]">
        <div className="flex justify-between gap-3"><span className="text-text-muted">内容版本</span><span className="truncate font-bold text-text-primary">{assemblyName}</span></div>
        <div className="flex justify-between gap-3"><span className="text-text-muted">语言</span><span className="truncate font-bold text-text-primary">{activeLanguageLabel}</span></div>
        <div className="flex justify-between gap-3"><span className="text-text-muted">配乐</span><span className="truncate font-bold text-text-primary">{selectedBgmTrack?.name || '不配乐'}</span></div>
        <div className="flex justify-between gap-3"><span className="text-text-muted">封面</span><span className="truncate font-bold text-text-primary">{coverClip?.name || '沿用首帧'}</span></div>
      </div>
      <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[10px] leading-4 text-text-muted">此处不再重复放置播放器，所有预览统一在中间区域完成。</p>
    </section>
  ) : null;

  const linkedProductionContext = !agentProduction.active
    ? workflowContext?.runId && workflowContext.taskId
      ? workflowContext
      : projectWorkflowContext?.runId && projectWorkflowContext.taskId
        ? projectWorkflowContext
        : null
    : null;

  return (
    <div className="flex flex-col h-full relative" onPointerDownCapture={() => { studioSettingsEditedRef.current = true; }}>
      {linkedProductionContext && <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4"><ProductionTaskScene key={`${linkedProductionContext.runId}:${linkedProductionContext.taskId}`} runId={linkedProductionContext.runId!} taskId={linkedProductionContext.taskId!} directorContext={linkedProductionContext} /></div>}
      {localGateBypass && <div role="status" className="shrink-0 border-b border-sky-200 bg-sky-50 px-4 py-2 text-xs font-semibold text-sky-900">本地演示模式：内容制作门禁已放行；内容 Agent 会优先考虑最近上传素材，并从本地素材库选择不同素材补齐分镜。</div>}
      {referenceRecoveryMessage && <div role="alert" className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"><span>{referenceRecoveryMessage}</span>{!referenceNeedsDirectorReview && <button type="button" disabled={retryingReference} onClick={() => void retryReference()} className="ml-3 font-bold underline disabled:opacity-50">{retryingReference ? '正在重试…' : '重试参考分析'}</button>}<button type="button" onClick={() => onNavigate?.('socialInspiration')} className="ml-3 font-bold underline">{referenceNeedsDirectorReview ? '前往编导复核' : '更换参考视频'}</button></div>}
      {!socialContentTaskId && !linkedProductionContext && !agentProduction.active && <DirectorTaskContext page="smartAssets" runtimeContext={workflowContext || projectWorkflowContext || undefined} />}
      {!socialContentTaskId && !linkedProductionContext && !agentProduction.active && !workflowContext?.runId && !projectWorkflowContext?.runId && projectId && <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">当前作品未关联智能员工任务，这是手动创作工作台。<button type="button" onClick={() => onNavigate?.('agentMonitor')} className="ml-3 font-semibold text-emerald-700">前往员工监控查看真实任务 →</button></div>}
      {!linkedProductionContext && modeNotice && <div role="status" className="flex shrink-0 items-start gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs leading-5 text-amber-950"><span className="min-w-0 flex-1">{modeNotice}</span><button type="button" aria-label="关闭创作提示" onClick={() => setModeNotice('')} className="shrink-0 underline">关闭</button></div>}
      {!linkedProductionContext && managedProductionProjectRef.current && <div role="status" className="flex shrink-0 items-center justify-between gap-3 border-b border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-900">
        <span>自动生产项目 · 请使用“生产现场：修改配置并继续原任务”保存配音、素材、字幕等修改。</span>
        <button type="button" className="shrink-0 font-semibold underline" onClick={requestProductionBack}>返回上一页</button>
      </div>}
      {!linkedProductionContext && managedProductionProjectRef.current && projectId && ((workflowContext?.taskKey || projectWorkflowContext?.taskKey) === 'content_quality_gate'
        ? <section className="mx-4 mt-3 shrink-0 rounded border bg-white p-3"><h3 className="font-bold">生产现场：修改配置并继续原任务</h3><ProductionRevisionPanel projectId={projectId}/></section>
        : <details className="mx-4 mt-3 shrink-0 rounded border bg-white p-3"><summary className="cursor-pointer font-bold">生产现场：修改配置并继续原任务</summary><ProductionRevisionPanel projectId={projectId}/></details>)}
      {/* BGM 试听用的隐藏音频元素 */}
      <audio ref={audioRef} onEnded={() => setPlayingBgm(null)} className="hidden" />

      <div className={showProjects || linkedProductionContext ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}>
      <StudioWorkbenchFrame
        className="h-full min-h-0 rounded-none border-0 shadow-none lg:h-full lg:min-h-0"
        projectTitle={projectTitle}
        projectSubtitle={`${contentMode === 'video' ? '视频' : '图文'} · ${platform} · ${ratio}`}
        onProjectTitleChange={title => { setProjectTitle(title); setAutosaveStatus('idle'); }}
        onSave={!agentProduction.active && !managedProductionProjectRef.current ? () => void saveProject('draft').catch(error => setModeNotice(error.message)) : undefined}
        saveStatus={{
          state: savingProj ? 'saving' : autosaveStatus,
          savedAt: lastAutosavedAt?.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
          onRetry: () => void saveProject('draft').catch(error => setModeNotice(error.message)),
        }}
        steps={workbenchSteps}
        activeStepId={workbenchStageId}
        allowForwardStepNavigation={localGateBypass}
        onStepChange={targetId => {
          const targetStageIndex = targetId === 'settings' ? 0 : targetId === 'script' ? 1 : 2;
          if (!localGateBypass && targetStageIndex > stageIdx) return;
          const anchor = activeSteps.findIndex(item => activeStages[targetStageIndex]?.steps.includes(item.id));
          if (anchor >= 0) setStepIdx(anchor);
        }}
        objectTitle={canvasView === 'reference' && mode === 'clone' ? '爆款视频分镜' : contentMode === 'video' && storyboardSlots.length ? '新建视频分镜' : '创作输入'}
        objectDescription={canvasView === 'reference' && mode === 'clone' ? `${referenceStoryboardItems.length} 个原片分镜 · 点击定位爆款视频` : contentMode === 'video' && storyboardSlots.length ? `${storyboardSlots.length} 个新片分镜 · 向下滚动选择，点击逐镜更换素材` : '生成前确认关键输入'}
        objectPanel={(
          canvasView === 'reference' && mode === 'clone' ? (
            <div className="flex h-full min-h-0 flex-col">
              {socialContentTaskId && videoKickoff?.video?.referenceRecordId && <button type="button" onClick={() => void refreshReferenceShots()} disabled={refreshingReferenceShots} className="m-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 disabled:opacity-50">{refreshingReferenceShots ? '正在重新分析产品分镜…' : '重新提取原片分镜'}</button>}
              {referenceRecoveryMessage && <p role="status" className="px-3 pb-2 text-xs text-emerald-800">{referenceRecoveryMessage}</p>}
              <StudioStoryboardList items={referenceStoryboardItems} selectedId={selectedReferenceShot?.id} onSelect={focusReferenceStoryboardShot} />
            </div>
          ) : contentMode === 'video' && storyboardSlots.length ? (
            <StudioStoryboardList items={workbenchStoryboardItems} selectedId={activeWorkbenchSlot?.id} onSelect={focusWorkbenchStoryboardSlot} />
          ) : (
            <StudioInputSummary
              title="已确认内容"
              description="只显示会影响本次生成的输入"
              items={[
                { id: 'agent-source', label: '内容来源', value: agentSourceContext },
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
            <button type="button" aria-pressed={canvasView === 'reference'} onClick={() => setCanvasView('reference')} className={`rounded-md px-2 py-1 text-[10px] font-bold ${canvasView === 'reference' ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted'}`}>爆款视频预览</button>
            <button type="button" aria-pressed={canvasView === 'creation'} onClick={() => setCanvasView('creation')} className={`rounded-md px-2 py-1 text-[10px] font-bold ${canvasView === 'creation' ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted'}`}>新建视频预览</button>
          </div>
        ) : undefined}
        propertyTitle={workbenchPropertyTitle}
        propertyDescription={workbenchPropertyDescription}
        propertyPanel={(
          <div className="space-y-4">
            {step === 'material' && <details className="rounded-xl border border-border bg-white p-3 text-[10px]"><summary className="cursor-pointer font-bold text-text-primary">本地视频分析状态 · {materials.filter(clip => clip.type === 'video' && clip.usage !== 'reference_only' && clip.segmentAnalysisStatus === 'completed').length}/{materials.filter(clip => clip.type === 'video' && clip.usage !== 'reference_only').length} 完成</summary><div className="mt-2 max-h-64 space-y-2 overflow-y-auto">{materials.filter(clip => clip.type === 'video' && clip.usage !== 'reference_only').map(clip => <div key={clip.id} className="rounded border border-border p-2"><p className="truncate font-bold">{clip.name}</p><MaterialAnalysisStatus material={clip} onRefresh={refreshMaterials} /></div>)}</div></details>}
            {socialViralTask && step === 'material' && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
                <div><p className="text-xs font-black text-emerald-950">逐镜制作</p><p className="mt-1 text-[10px] leading-4 text-emerald-800">工厂、产品、会议和背景人物按视觉主题或表达目的匹配本地素材，双项命中优先；仅正面承接口播的销售人物使用数字人，动作镜头按动作路线制作。同一人物跨镜须保持同一身份；连续短镜可合并为一段数字人口播再按原切点裁切，不自动删掉独立口播或动作。</p></div>
                {mode === 'clone' && videoKickoff?.referenceAnalysis?.details?.length && !Object.keys(personContinuityBySlot).length && <p className="mt-2 text-[10px] font-bold text-amber-800">这份历史参考分析没有跨镜人物身份标注。需重新分析对标视频，才能自动检查人物连续性。</p>}
                {Object.keys(personContinuityBySlot).length > 1 && <p className="mt-2 text-[10px] font-bold text-emerald-900">同一人物连续组已锁定；若相邻短镜需要数字人口播，建议一次生成连续表演，再按原口播时间与画面切点裁开。无独立口播、动作和表达目的的短镜才可考虑合并或删去。</p>}
                {personContinuityConflicts.length > 0 && <p role="alert" className="mt-2 text-[10px] font-bold text-rose-700">{personContinuityConflicts.join('；')}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void smartSelectMaterialsFast()} disabled={materialSelectLoading || batchShotBusy}
                    className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-[10px] font-black text-emerald-800 disabled:opacity-50">
                    {materialSelectLoading ? '匹配中…' : '一键匹配素材'}
                  </button>
                  <button type="button" onClick={() => void runBatchShotJobs()} disabled={batchShotBusy || materialSelectLoading}
                    className="rounded-lg bg-emerald-700 px-3 py-2 text-[10px] font-black text-white disabled:opacity-50">
                    {batchShotBusy ? '逐镜提交中…' : '一键生成所有分镜素材'}
                  </button>
                </div>
                {batchShotSummary && <p role="status" className="mt-2 text-[10px] leading-4 text-emerald-950">已提交 {batchShotSummary.submitted} · 复用素材 {batchShotSummary.matched} · 待补素材 {batchShotSummary.needsMaterial} · 阻塞 {batchShotSummary.blocked}。已提交的数字人任务需等待候选生成和验收。</p>}
                {batchShotResults.length > 0 && <ol aria-label="逐镜批量制作结果" className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                  {batchShotResults.map((item, index) => <li key={`${item.shotId}-${index}`} className="rounded-lg border border-emerald-100 bg-white px-2.5 py-2 text-[10px] leading-4">
                    <button type="button" onClick={() => focusWorkbenchStoryboardSlot(item.slotId)} className="w-full text-left">
                      <span className="font-black text-text-primary">分镜 {storyboardSlots.findIndex(slot => slot.id === item.slotId) + 1 || index + 1}</span>
                      <span className={`ml-2 font-black ${item.state === 'blocked' ? 'text-red-700' : item.state === 'needs_material' ? 'text-amber-700' : 'text-emerald-700'}`}>{item.state === 'submitted' ? '已提交数字人' : item.state === 'matched' ? '已关联本地素材' : item.state === 'needs_material' ? '待补素材' : '阻塞'}</span>
                      <span className="mt-1 block break-words text-text-secondary">{item.reason || '未提供原因'}</span>
                    </button>
                  </li>)}
                </ol>}
              </div>
            )}
            {socialViralTask && step === 'material' && (
              <section aria-label="数字人制作" className="rounded-xl border border-emerald-200 bg-white p-3">
                <p className="text-xs font-black text-text-primary">数字人制作</p>
                <p className="mt-1 text-[10px] leading-4 text-text-muted">正面承接口播的分镜使用数字人；背景人物和非口播镜头仍可匹配素材。</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {storyboardSlots.filter(slot => shotRouteFor(slot) === 'presenter').map(slot => (
                    <button key={slot.id} type="button" onClick={() => focusWorkbenchStoryboardSlot(slot.id)}
                      className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-bold ${activeWorkbenchSlot?.id === slot.id ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-border text-text-secondary hover:border-emerald-300'}`}>
                      分镜 {storyboardSlots.indexOf(slot) + 1}
                    </button>
                  ))}
                  {!storyboardSlots.some(slot => shotRouteFor(slot) === 'presenter') && <span className="text-[10px] text-text-muted">当前没有待制作的数字人口播分镜</span>}
                </div>
                {activeWorkbenchSlot && shotRouteFor(activeWorkbenchSlot) !== 'presenter' && storyboardSlots.some(slot => shotRouteFor(slot) === 'presenter') &&
                  <p className="mt-2 text-[10px] text-text-muted">点击上方分镜，在下方选择人物和声音。</p>}
              </section>
            )}
            <section aria-label="本次创作信息" className="rounded-xl border border-sky-100 bg-sky-50/60 p-3">
              <p className="text-[10px] font-black uppercase tracking-[0.1em] text-sky-700">本次创作信息</p>
              <dl className="mt-2 space-y-1.5 text-[10px] leading-4">
                <div className="flex gap-2"><dt className="shrink-0 text-text-muted">创作方式</dt><dd className="min-w-0 break-words font-bold text-text-primary">{agentSourceContext}</dd></div>
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
                {mode === 'clone' && setupReadiness.status === 'blocked' && <button type="button" onClick={() => onNavigate?.('socialInspiration')} className="mt-2 text-[10px] font-black text-amber-800 underline">前往灵感中心复核原片 →</button>}
              </section>
            )}
            {contentMode === 'video' && stageIdx === 2 && (
              <section className="border-b border-border pb-3" aria-label="成片制作任务">
                <p className="px-1 pb-2 text-[10px] font-bold text-text-muted">成片制作任务</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {([
                    { id: 'material', label: '素材匹配', done: storyboardSlots.length > 0 && assignedCount === storyboardSlots.length },
                    { id: 'bgm', label: '配乐', done: Boolean(bgm) },
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
                  const unavailable = !localGateBypass && item.id !== 'theme' && (!hasTimestampScript
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
                    {presentationMode === 'heygen' && <label className="block text-xs font-bold">本镜画面来源<select className="mt-1 w-full rounded border p-2" value={presentationSources[activeWorkbenchSlot.id] || (storyboardSlots.indexOf(activeWorkbenchSlot) === 0 || storyboardSlots.indexOf(activeWorkbenchSlot) === storyboardSlots.length - 1 ? 'avatar' : 'material')} onChange={event => { setPresentationSources(prev => ({ ...prev, [activeWorkbenchSlot.id]: event.target.value as 'avatar' | 'material' })); setRendered(false); setRenderOutputPath(null); setRenderOutputPreviewUrl(null); }}><option value="avatar">数字人</option><option value="material">指定素材（在素材匹配中选择）</option></select></label>}
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
                ) : <div className="rounded-xl border border-dashed border-border bg-surface-2 px-4 py-8 text-center text-xs text-text-muted">{referenceRecoveryMessage || '尚未生成分镜。参考分析完成后，可在当前工作台继续生成脚本与口播。'}</div>}
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
                  {voiceDraftNotice && <div className={`rounded-lg border px-3 py-2 text-[10px] leading-4 ${voiceDraftFailedLangs.length ? 'border-red-200 bg-red-50 text-red-700' : 'border-border bg-surface-2 text-text-muted'}`}><p>{voiceDraftNotice}</p>{voiceDraftFailedLangs.includes(activeVoiceLang) && <button type="button" onClick={() => void retryVoiceDraft(activeVoiceLang)} className="mt-2 rounded-md border border-red-200 bg-white px-2 py-1 font-bold">重试当前语言</button>}</div>}
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
                    <div className={`rounded-lg border px-3 py-2 text-[10px] leading-4 ${/欠费|额度|余额|鉴权|失败|不可用/.test(ttsNotice) ? 'border-red-200 bg-red-50 text-red-700' : 'border-border bg-surface-2 text-text-muted'}`}>
                      <p>{uploadedVoiceName ? `已上传：${uploadedVoiceName}。` : ''}{ttsNotice ? publicVoiceFailureReason(ttsNotice) : ''}</p>
                      {/欠费|额度|余额|鉴权|失败|不可用/.test(ttsNotice) && <button type="button" onClick={() => voiceoverInputRef.current?.click()} className="mt-2 rounded-md border border-red-200 bg-white px-2 py-1 font-bold">改用上传口播</button>}
                    </div>
                  )}
                  {voiceoverMode === 'ai' && <div className="border-t border-border pt-3">
                    <button type="button" onClick={() => setShowVoiceAdvanced(value => !value)} className="flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-left text-[10px] font-black text-text-secondary"><span>高级设置 · 当前语言</span><ChevronDown size={13} className={`transition ${showVoiceAdvanced ? 'rotate-180' : ''}`} /></button>
                    {showVoiceAdvanced && <div className="mt-2 space-y-3 rounded-xl border border-border bg-surface-2 p-3">
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-[10px] font-bold text-text-secondary">音色<select value={activeTtsSettings.voiceId || voice} onChange={event => { patchActiveTtsSettings({ voiceId: event.target.value }); if (voiceoverAudios[activeVoiceLang]?.url) setVoiceoverStaleLangs(current => [...new Set([...current, activeVoiceLang])]); }} className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-2 text-[10px]">{voiceCandidates.map(item => <option key={item} value={item}>{VOICES.find(option => option.id === item)?.name || item}</option>)}</select></label>
                        <label className="text-[10px] font-bold text-text-secondary">风格<select value={ttsPreset} onChange={event => { setTtsPreset(event.target.value as TtsStyleOptions['preset']); if (voiceoverAudios[activeVoiceLang]?.url) setVoiceoverStaleLangs(current => [...new Set([...current, activeVoiceLang])]); }} className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-2 text-[10px]">{TTS_PRESETS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                        <label className="col-span-2 text-[10px] font-bold text-text-secondary">情绪<select value={ttsEmotion} onChange={event => { setTtsEmotion(event.target.value); if (voiceoverAudios[activeVoiceLang]?.url) setVoiceoverStaleLangs(current => [...new Set([...current, activeVoiceLang])]); }} className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-2 text-[10px]">{[...new Set(TTS_PRESETS.map(item => item.emotion))].map(item => <option key={item} value={item}>{item}</option>)}</select></label>
                      </div>
                      <label className="block text-[10px] font-bold text-text-secondary">语速 · {ttsSpeed.toFixed(1)}x<input type="range" min="0.7" max="1.3" step="0.05" value={ttsSpeed} onChange={event => { setTtsSpeed(Number(event.target.value)); if (voiceoverAudios[activeVoiceLang]?.url) setVoiceoverStaleLangs(current => [...new Set([...current, activeVoiceLang])]); }} className="mt-2 w-full accent-emerald-600" /></label>
                      <label className="block text-[10px] font-bold text-text-secondary">试听音量 · {Math.round((activeTtsSettings.volume ?? voiceVol / 100) * 100)}%<input type="range" min="0" max="1" step="0.05" value={activeTtsSettings.volume ?? voiceVol / 100} onChange={event => patchActiveTtsSettings({ volume: Number(event.target.value) })} className="mt-2 w-full accent-emerald-600" /></label>
                      {voiceoverAudios[activeVoiceLang]?.url && <button type="button" onClick={() => playTtsForLang(activeVoiceLang)} className="rounded-lg border border-border bg-white px-3 py-2 text-[10px] font-bold text-text-secondary">{ttsPlaying ? '暂停试听' : '试听当前语言'}</button>}
                    </div>}
                  </div>}
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
                {shotRouteFor(activeWorkbenchSlot) === 'presenter' && <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black text-emerald-900">数字人镜头</p>
                      <p className="mt-1 text-[9px] leading-4 text-emerald-800">选择已授权人物、声音和画面布局，再为当前分镜生成候选。</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (productionFor(activeWorkbenchSlot).locked) { setModeNotice('镜头已锁定，请先解锁'); return; }
                        openProduction(activeWorkbenchSlot);
                        const key = productionKey(activeWorkbenchSlot.id);
                        setShotProductions(current => ({
                          ...current,
                          [key]: { ...(current[key] || productionFor(activeWorkbenchSlot)), source: 'avatar', sound: 'source' },
                        }));
                        if (!productionCapability.configured) setDigitalHumanNotice(productionCapability.reason || '数字人服务尚未接入');
                      }}
                      className="flex-shrink-0 rounded-lg bg-emerald-700 px-3 py-2 text-[10px] font-black text-white hover:bg-emerald-800"
                    >选择数字人</button>
                  </div>
                  <div className="mt-3 space-y-2 border-t border-emerald-200 pt-3">
                    {productionDefaults.presenters.length > 0 && (
                      <div>
                        <p className="mb-1.5 text-[9px] font-black text-emerald-900">已绑定企业人物</p>
                        <div className="flex flex-wrap gap-1.5">
                          {productionDefaults.presenters.map(presenter => {
                            const active = productionFor(activeWorkbenchSlot).source === 'avatar' && productionFor(activeWorkbenchSlot).presenterId === presenter.id;
                            return <button key={presenter.id} type="button" onClick={() => {
                              if (productionFor(activeWorkbenchSlot).locked) { setModeNotice('镜头已锁定，请先解锁'); return; }
                              const key = productionKey(activeWorkbenchSlot.id);
                              setShotProductions(current => ({ ...current, [key]: patchShot(current[key] || productionFor(activeWorkbenchSlot), { source: 'avatar', contentType: 'enterprise_presenter', presenterId: presenter.id, sound: 'source' }) }));
                              setDigitalHumanNotice(`已为当前分镜选择“${presenter.name}”。`);
                            }} className={`rounded-lg border px-2 py-1.5 text-[9px] font-bold ${active ? 'border-emerald-600 bg-emerald-700 text-white' : 'border-emerald-200 bg-white text-emerald-800'}`}>{presenter.name}</button>;
                          })}
                        </div>
                      </div>
                    )}
                    <label className="block text-[9px] font-black text-emerald-900">HeyGen 账号资产
                      <select value={heygenAvatarId} onChange={event => {
                        const id = event.target.value;
                        setHeygenAvatarId(id); setDigitalHumanConsent(false);
                        const bound = productionDefaults.presenters.find(item => (item.toolMappings?.heygen?.avatarId || item.avatarId) === id);
                        setHeygenAvatarOrientation(bound?.nativeOrientation || 'unknown');
                      }} className="mt-1 w-full rounded-lg border border-emerald-200 bg-white px-2 py-2 text-[10px] text-text-primary outline-none focus:border-emerald-500">
                        <option value="">请选择数字人资产</option>
                        {heygenAvatars.map(avatar => <option key={avatar.id} value={avatar.id}>{avatar.ownership === 'private' ? '账号资产' : '公共人物'} · {avatar.name}</option>)}
                      </select>
                    </label>
                    <label className="block text-[9px] font-black text-emerald-900">原生画幅
                      <select value={heygenAvatarOrientation} onChange={event => setHeygenAvatarOrientation(event.target.value as typeof heygenAvatarOrientation)} className="mt-1 w-full rounded-lg border border-emerald-200 bg-white px-2 py-2 text-[10px] text-text-primary outline-none focus:border-emerald-500">
                        <option value="unknown">未核验</option><option value="portrait">竖屏</option><option value="landscape">横屏</option><option value="square">方形</option>
                      </select>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2 text-[9px] leading-4 text-emerald-900">
                      <input type="checkbox" checked={digitalHumanConsent} onChange={event => setDigitalHumanConsent(event.target.checked)} className="mt-0.5 accent-emerald-700" />
                      <span>我确认已取得该成年出镜人物的肖像、声音和商业使用授权，并对本次生成负责。</span>
                    </label>
                    <button type="button" onClick={() => void bindHeygenAvatarToShot(activeWorkbenchSlot)} disabled={heygenAvatarBinding || !heygenAvatarId} className="w-full rounded-lg border border-emerald-700 bg-white px-3 py-2 text-[10px] font-black text-emerald-800 disabled:opacity-50">{heygenAvatarBinding ? '正在绑定…' : '绑定账号资产到当前分镜'}</button>
                    {!heygenAvatars.length && <p className="text-[9px] leading-4 text-amber-700">暂未读取到 HeyGen 数字人资产，请检查测试服 Key 与服务开关。</p>}
                    {digitalHumanNotice && <p className="text-[9px] leading-4 text-emerald-900">{digitalHumanNotice}</p>}
                  </div>
                  {!productionCapability.configured && <p className="mt-2 text-[9px] leading-4 text-amber-700">{productionCapability.reason || '数字人服务尚未配置，可先完成人物资产绑定。'}</p>}
                </div>}
                {shotRouteFor(activeWorkbenchSlot) === 'motion' && <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-[10px] leading-4 text-sky-900">
                  <p className="font-black">动作镜头 · Seedance 路线</p>
                  <p className="mt-1">保留原镜动作与构图要求，先核对参考帧和人物资产，再生成动作候选。</p>
                  <button type="button" onClick={() => {
                    if (productionFor(activeWorkbenchSlot).locked) { setModeNotice('镜头已锁定，请先解锁'); return; }
                    openProduction(activeWorkbenchSlot);
                    const key = productionKey(activeWorkbenchSlot.id);
                    setShotProductions(current => ({ ...current, [key]: { ...(current[key] || productionFor(activeWorkbenchSlot)), source: 'ai' } }));
                  }} className="mt-2 rounded-lg bg-sky-700 px-3 py-2 font-black text-white">查看动作制作要求</button>
                </div>}
                <div className="flex gap-2">
                  <button type="button" onClick={() => void smartSelectMaterialsFast()} disabled={materialSelectLoading || !activeMaterialCandidates.length} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-[10px] font-black text-text-secondary disabled:opacity-50">{materialSelectLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}自动匹配空分镜</button>
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-[10px] font-black text-text-secondary"><Upload size={12} />添加素材</button>
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between"><p className="text-[10px] font-black text-text-primary">推荐素材</p><span className="text-[9px] text-text-muted">按分镜语义排序</span></div>
                  <div className="space-y-2">
                    {activeMaterialCandidates.map(({ clip, assessment }) => {
                      const active = activeWorkbenchClip?.id === clip.id;
                      return <button key={clip.id} type="button" onClick={() => assignWorkbenchMaterial(clip)} className={`flex w-full items-center gap-2 rounded-lg border p-2 text-left transition ${active ? 'border-emerald-300 bg-emerald-50' : 'border-border bg-white hover:border-emerald-200'}`}>
                        <div className="h-11 w-14 flex-shrink-0 overflow-hidden rounded-md bg-slate-950">{clip.url ? <RealThumb clip={clip} onSourceError={() => { void refreshMaterialSource(clip.id); }} /> : <Thumb seed={clip.id} src={clip.poster} label={clip.type === 'image' ? 'IMG' : fmtDur(clip.duration)} />}</div>
                        <div className="min-w-0 flex-1"><p className="truncate text-[10px] font-black text-text-primary">{clip.name}</p><p className="mt-1 truncate text-[9px] text-text-muted">{assessment.reason}</p></div>
                        <span className={`text-[10px] font-black ${assessment.level === 'direct' ? 'text-emerald-700' : assessment.level === 'review' ? 'text-amber-700' : 'text-text-muted'}`}>{assessment.score}</span>
                      </button>;
                    })}
                    {!activeMaterialCandidates.length && <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[10px] text-text-muted">暂无可用素材，可先上传视频或图片。</div>}
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
        timelineTitle={canvasView === 'reference' && mode === 'clone' ? '爆款视频时间轴' : '新建视频时间轴'}
        timelineDescription={canvasView === 'reference' && mode === 'clone' ? `${referenceStoryboardItems.length} 个原片分镜 · 可点击定位原片` : storyboardSlots.length ? `${storyboardSlots.length} 个新片分镜 · 可拖动定位画面` : undefined}
        timelineToolbar={canvasView === 'reference' && mode === 'clone'
          ? <span className="text-[10px] font-black tabular-nums text-text-secondary">{referenceTimelineTime.toFixed(1)}s / {referenceTimelineDuration.toFixed(1)}s</span>
          : storyboardSlots.length ? <div className="flex items-center gap-2"><span className="text-[10px] font-black tabular-nums text-text-secondary">{workbenchTimelineTime.toFixed(1)}s / {workbenchTimelineDuration.toFixed(1)}s</span>{step === 'cover' && <button type="button" onClick={captureWorkbenchCoverFrame} className="rounded-md border border-border bg-white px-2 py-1 text-[9px] font-bold text-text-secondary">截取为封面</button>}</div> : undefined}
        timelinePanel={canvasView === 'reference' && mode === 'clone' ? referenceStoryboardItems.length ? (
          <div className="relative h-full min-w-[560px]">
            <div className="flex h-11 overflow-hidden rounded-lg border border-border bg-surface-2">
              {referenceStoryboardItems.map(item => <button key={item.id} type="button" onClick={() => focusReferenceStoryboardShot(item.id)} style={{ width: `${Math.max(4, ((item.end - item.start) / referenceTimelineDuration) * 100)}%` }} className={`relative min-w-[42px] border-r border-white/70 bg-slate-700 px-1.5 text-left text-[9px] font-black text-white last:border-r-0 ${selectedReferenceShot?.id === item.id ? 'ring-2 ring-inset ring-emerald-500' : ''}`}>{item.index}</button>)}
            </div>
            <input aria-label="爆款视频时间轴" type="range" min="0" max={referenceTimelineDuration} step="0.05" value={Math.min(referenceTimelineTime, referenceTimelineDuration)} onChange={event => seekReferenceTimeline(Number(event.target.value))} className="mt-2 h-2 w-full cursor-ew-resize accent-emerald-600" />
          </div>
        ) : <div role="status" className="rounded-lg border border-dashed border-border px-4 py-3 text-xs text-text-muted">爆款视频分镜分析中，完成后在这里显示原片时间轴。</div> : storyboardSlots.length ? (
          <div className="relative h-full min-w-[560px]">
            <div className="flex h-11 overflow-hidden rounded-lg border border-border bg-surface-2">
              {storyboardSlots.map((slot, index) => {
                const clip = materialById.get(storyboardAssignments[slot.id] || '');
                const width = Math.max(4, ((slot.end - slot.start) / workbenchTimelineDuration) * 100);
                return <button key={slot.id} type="button" onClick={() => seekWorkbenchTimeline(slot.start)} style={{ width: `${width}%` }} className={`relative min-w-[42px] overflow-hidden border-r border-white/70 text-left last:border-r-0 ${activeWorkbenchSlot?.id === slot.id ? 'ring-2 ring-inset ring-emerald-500' : ''}`}>
                  {clip?.poster || clip?.type === 'image' ? <img src={clip.poster || clip.url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-55" /> : <span className="absolute inset-0 bg-slate-700" />}
                  <span className="relative z-10 flex h-full items-end bg-gradient-to-t from-slate-950/80 to-transparent px-1.5 pb-1 text-[8px] font-black text-white">{index + 1}</span>
                </button>;
              })}
            </div>
            <input aria-label="整片时间轴" type="range" min="0" max={workbenchTimelineDuration} step="0.05" value={Math.min(workbenchTimelineTime, workbenchTimelineDuration)} onChange={event => seekWorkbenchTimeline(Number(event.target.value))} className="mt-2 h-2 w-full cursor-ew-resize accent-emerald-600" />
          </div>
        ) : socialContentTaskId ? <div role="status" className="rounded-lg border border-dashed border-border px-4 py-3 text-xs text-text-muted">00:00 · 等待参考分析与分镜脚本，完成后在这里显示逐镜时间戳。</div> : undefined}
        previousAction={{ label: '上一步', onClick: prev, disabled: stepIdx === 0 }}
        previewAction={{
          label: '预览',
          onClick: () => {
            const previewIndex = activeSteps.findIndex(item => item.id === (contentMode === 'poster' ? 'poster' : 'preview'));
            if (previewIndex >= 0) setStepIdx(previewIndex);
          },
          disabled: localGateBypass ? false : contentMode === 'video'
            ? !storyboardSlots.length || !(voiceoverMode === 'none' || (voiceoverMode === 'upload' && Boolean(voiceoverUrl)) || (voiceoverMode === 'ai' && hasAnyVoiceover))
            : !posterJsonText,
        }}
        primaryAction={{
          label: agentProduction.action?.label || primaryActionLabel,
          onClick: agentProduction.active ? () => void agentProduction.execute().catch(error => setModeNotice(error.message)) : runPrimaryAction,
          disabled: agentProduction.active ? !agentProduction.action || agentProduction.busy || Boolean(window.__agentProductionTarget?.projectId && projectId !== window.__agentProductionTarget.projectId) : primaryActionDisabled,
          loading: agentProduction.busy || primaryActionLoading,
          loadingLabel: socialArtifactSubmitting ? '正在提交成品' : modeActionStatus || (rendering ? `正在生成 ${renderPct}%` : undefined),
          blockReason: agentProduction.active ? undefined : primaryActionBlockedReason,
          icon: primarySubmitsSocialArtifact || step === 'preview' && workbenchHasFormalVideo && !primaryGeneratesVideo ? <Send size={15} /> : <ChevronRight size={15} />,
        }}
      >
        <div className={`relative flex h-full min-h-[360px] w-full items-center justify-center overflow-hidden ${canvasView === 'reference' && mode === 'clone' && videoKickoff ? 'bg-black' : 'rounded-lg border border-slate-300/70 bg-[#e7e9ec] p-3 shadow-inner'}`}>
          {canvasView !== 'reference' && step !== 'preview' && storyboardSlots.length > 0 && <div className="absolute right-4 top-4 z-30 flex items-center gap-2">
            {workbenchPlaybackError && <span role="alert" className="max-w-56 rounded-md bg-rose-950/90 px-2 py-1 text-[10px] text-white">{workbenchPlaybackError}</span>}
            <button type="button" onClick={toggleWorkbenchPlayback} disabled={!playableWorkbenchSlots.length} className="rounded-lg bg-emerald-800 px-3 py-2 text-[11px] font-bold text-white shadow-lg disabled:opacity-50">
              {workbenchPlaying ? '暂停联播' : `联播素材（${playableWorkbenchSlots.length}）`}
            </button>
            <button type="button" aria-pressed={workbenchSourceAudioOn} onClick={() => setWorkbenchSourceAudioOn(value => !value)} className="rounded-lg bg-slate-900 px-3 py-2 text-[11px] font-bold text-white shadow-lg">
              {workbenchSourceAudioOn ? '试听素材原声：开' : '试听素材原声：关'}
            </button>
          </div>}
          {canvasView === 'reference' && mode === 'clone' && videoKickoff ? (
            <BenchmarkVideoPreview kickoff={videoKickoff} embedded seekRequest={referenceSeekRequest} onTimeUpdate={setReferenceTimelineTime} />
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
                ref={workbenchVideoRef}
                key={workbenchFormalPreviewUrl}
                src={workbenchFormalPreviewUrl}
                controls
                playsInline
                preload="metadata"
                onLoadedMetadata={event => {
                  const video = event.currentTarget;
                  const maxTime = Number.isFinite(video.duration) && video.duration > 0 ? Math.max(0, video.duration - 0.05) : workbenchTimelineTime;
                  try { video.currentTime = Math.min(Math.max(0, workbenchTimelineTime), maxTime); } catch { /* ignore media seek edge cases */ }
                }}
                onTimeUpdate={event => setWorkbenchTimelineTime(Math.min(workbenchTimelineDuration, Math.max(0, event.currentTarget.currentTime)))}
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
                muted={!workbenchSourceAudioOn}
                preload="metadata"
                onPlay={() => { if (!workbenchPlaying) setWorkbenchPlaying(true); }}
                onPause={event => { if (event.currentTarget.isConnected && !event.currentTarget.ended && !workbenchAdvanceLockRef.current && workbenchPlaying) setWorkbenchPlaying(false); }}
                onLoadedMetadata={event => {
                  const video = event.currentTarget;
                  const maxTime = Number.isFinite(video.duration) && video.duration > 0 ? Math.max(0, video.duration - 0.05) : workbenchSeekTime;
                  try { video.currentTime = Math.min(Math.max(0, workbenchSeekTime), maxTime); } catch { /* ignore media seek edge cases */ }
                }}
                onTimeUpdate={event => {
                  if (!activeWorkbenchSlot) return;
                  const edit = editForSlot(activeWorkbenchClip, activeWorkbenchSlot);
                  const elapsed = workbenchLoopOffsetRef.current + Math.max(0, (event.currentTarget.currentTime - edit.trimStart) / Math.max(0.1, edit.speed || 1));
                  setWorkbenchTimelineTime(Math.min(activeWorkbenchSlot.end, activeWorkbenchSlot.start + elapsed));
                  if (workbenchPlaying && elapsed >= activeWorkbenchSlot.end - activeWorkbenchSlot.start - 0.04) advanceWorkbenchPlayback();
                }}
                onEnded={event => {
                  if (!workbenchPlaying || !activeWorkbenchSlot) return;
                  const edit = editForSlot(activeWorkbenchClip, activeWorkbenchSlot);
                  const sourceEnd = Math.min(event.currentTarget.duration || edit.trimEnd, edit.trimEnd);
                  const played = Math.max(0, (sourceEnd - edit.trimStart) / Math.max(0.1, edit.speed || 1));
                  if (played < 0.1) { advanceWorkbenchPlayback(); return; }
                  workbenchLoopOffsetRef.current += played;
                  if (workbenchLoopOffsetRef.current >= activeWorkbenchSlot.end - activeWorkbenchSlot.start - 0.04) { advanceWorkbenchPlayback(); return; }
                  event.currentTarget.currentTime = edit.trimStart;
                  void event.currentTarget.play().catch(error => { setWorkbenchPlaying(false); setWorkbenchPlaybackError(`素材播放失败：${error instanceof Error ? error.message : String(error)}`); });
                }}
                onError={() => { setWorkbenchPlaying(false); setWorkbenchPlaybackError('当前素材无法播放，请检查素材文件或重新选择。'); }}
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
      <DigitalHumanProductionOverview
        shots={storyboardSlots.flatMap((slot, index) => {
          const shot = productionFor(slot); if (shot.source !== 'avatar') return [];
          const persistedShotId = shootingSlots.find(item => item.slotId === slot.id)?.id || slot.id;
          const fingerprint = productionFingerprint(slot, shot);
          const presenterVersion = Math.max(1, productionDefaults.presenters.find(item => item.id === shot.presenterId)?.assetVersion || 1);
          return [{ shotId: slot.id, title: `分镜 ${index + 1} · ${slot.title}`, plan: productionPlans.find(item => item.projectId === projectId && item.assemblyId === activeAssemblyId && item.shotId === persistedShotId && item.fingerprint === fingerprint && item.presenterAssetVersion === presenterVersion),
            executions: productionExecutions.filter(item => item.projectId === projectId && item.assemblyId === activeAssemblyId && item.shotId === persistedShotId && item.fingerprint === fingerprint && item.presenterAssetVersion === presenterVersion) }];
        })}
        onOpenShot={shotId => { setProductionEditorId(shotId); setProductionError(''); }}
      />
      {productionEditorSlot && (
        <ShotProductionPanel
          shot={productionFor(productionEditorSlot)}
          shotId={shootingSlots.find(item => item.slotId === productionEditorSlot.id)?.id || productionEditorSlot.id}
          scriptNarration={storyboardSlotScript(productionEditorSlot.detail).voice}
          shotDuration={Math.max(0.001, productionEditorSlot.end - productionEditorSlot.start)}
          keyframeCues={shotKeyframeCues({ shotStart: productionEditorSlot.start, shotEnd: productionEditorSlot.end,
            cues: alignedCuesByLang[activeVoiceLang] || voiceoverAudios[activeVoiceLang]?.cues || [],
            fallbackText: productionFor(productionEditorSlot).narration })}
          context={shotProductionContext}
          title={`分镜 ${storyboardSlots.findIndex(item => item.id === productionEditorSlot.id) + 1}`}
          defaults={productionDefaults}
          materials={materials}
          products={selectedProductOptions.map(item => ({ id: item.id, label: item.label }))}
          jobs={productionJobs.filter(job => job.projectId === projectId && `${job.assemblyId}:${job.shotId}` === productionKey(productionEditorSlot.id))}
          savedPlan={productionPlans.find(item => item.projectId === projectId && `${item.assemblyId}:${item.shotId}` === productionKey(productionEditorSlot.id)
            && item.fingerprint === productionFingerprint(productionEditorSlot)
            && item.presenterAssetVersion === Math.max(1, productionDefaults.presenters.find(presenter => presenter.id === productionFor(productionEditorSlot).presenterId)?.assetVersion || 1))}
          sourcePlan={socialDigitalHumanPlans.find(item => item.shotId === productionEditorSlot.id)
            ?? socialDigitalHumanPlans.find(item => item.shotIndex === storyboardSlots.findIndex(candidate => candidate.id === productionEditorSlot.id))}
          executions={productionExecutions.filter(item => `${item.assemblyId}:${item.shotId}` === productionKey(productionEditorSlot.id)
            && item.fingerprint === productionFingerprint(productionEditorSlot)
            && item.presenterAssetVersion === Math.max(1, productionDefaults.presenters.find(presenter => presenter.id === productionFor(productionEditorSlot).presenterId)?.assetVersion || 1))}
          sentenceResult={productionSentenceResults[productionExecutions.filter(item => `${item.assemblyId}:${item.shotId}` === productionKey(productionEditorSlot.id)
            && item.fingerprint === productionFingerprint(productionEditorSlot)
            && item.provider.startsWith('sentence_first_frame')).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0]?.jobId || '']}
          refreshingJobIds={productionRefreshingIds}
          preview={materialById.get(storyboardAssignments[productionEditorSlot.id] || '')}
          reason={recommendShot({ detail: productionEditorSlot.detail, preference: appearancePreference || productionDefaults.preference, locked: productionFor(productionEditorSlot).locked, hasMaterial: Boolean(storyboardAssignments[productionEditorSlot.id]), hasPresenter: productionDefaults.presenters.length > 0 }).reason}
          error={productionError || digitalHumanNotice}
          busy={productionBusy}
          configured={productionCapability.configured}
          capabilityReason={productionCapability.reason}
          toolCapabilities={productionCapability.tools}
          costPerSecond={productionCapability.costPerSecond}
          maxAttemptsPerShot={productionCapability.maxAttemptsPerShot}
          onChange={patch => {
            try {
              const key = productionKey(productionEditorSlot.id);
              setShotProductions(current => ({ ...current, [key]: patchShot(current[key] || productionFor(productionEditorSlot), patch) }));
              setProductionError('');
            } catch (error) { setProductionError(error instanceof Error ? error.message : '镜头设置更新失败'); }
          }}
          onClose={() => { setProductionEditorId(''); setProductionError(''); setDigitalHumanNotice(''); }}
          onNarration={applyProductionNarration}
          onDefaults={async value => { const saved = await productionApi.saveDefaults(value); setProductionDefaults(saved); }}
          onCreatePresenter={async input => {
            const uploaded=await studioApi.uploadMaterialFile(input.file,{folder:'presenter',type:'image',sourceType:'presenter-inline-upload'});
            if(!uploaded.ok||!uploaded.material?.id)throw new Error(uploaded.error||'人物图片上传失败');
            const presenterId=crypto.randomUUID();const now=new Date().toISOString();
            const presenter:import('../lib/shotProduction').PresenterAsset={id:presenterId,name:input.name.trim(),avatarId:'',voiceId:'',authorized:true,supportsAlpha:false,referenceMaterialIds:[uploaded.material.id],rightsEvidence:{authorizationRef:input.authorizationRef.trim(),consentRef:input.consentRef.trim(),grantedAt:now,subjectAdultConfirmed:input.subjectAdultConfirmed,permittedProviders:['volcengine_ark'],permittedUses:['digital_presenter','person_replacement']},arkCertification:{projectName:'default',assetUri:input.arkAssetUri||'',assetType:input.arkAssetUri?'image':'',status:input.arkActiveConfirmed?'active':'ark_pending',materialId:uploaded.material.id,...(input.arkActiveConfirmed?{syncedAt:now,verificationSource:'manual_console' as const}:{})}};
            const saved=await productionApi.saveDefaults({...productionDefaults,presenters:[...productionDefaults.presenters,presenter],defaultPresenterId:productionDefaults.defaultPresenterId||presenterId});
            setProductionDefaults(saved);await refreshMaterials();const created=saved.presenters.find(item=>item.id===presenterId);if(!created)throw new Error('人物已上传，但企业人物回填失败，请刷新后检查原任务');return created;
          }}
          onApplyDefaultsToUnlocked={() => {
            setShotProductions(current => applyDefaultsToUnlockedAvatarShots(current, activeAssemblyId, productionDefaults));
            setDigitalHumanNotice('已将企业默认人物、声音和布局应用到当前视频全部未锁定数字人分镜；人物变化的镜头需要重新确认内容。');
          }}
          onSavePlan={() => void saveProductionPlan()}
          onPrepareSentenceFrames={() => void prepareProductionSentenceFrames()}
          onGenerateSentenceDrafts={()=>void generateProductionSentenceDrafts()}
          onRunSentenceReplication={() => void runProductionSentenceReplication()}
          onReviewSentenceCue={(cueId,decisions,evidence)=>void reviewProductionSentenceCue(cueId,decisions,evidence)}
          onRetryFailedSentenceCues={()=>void retryProductionFailedSentenceCues()}
          onGenerate={() => void generateProductionAvatar()}
          onAi={() => { setProductionEditorId(''); void generateStoryboardShot(productionEditorSlot, { ...sourcePlanFor(productionEditorSlot), mode: 'ai', decided: true, confirmed: false }); }}
          onShoot={() => { setProductionEditorId(''); setShootingError(''); setShootingSlotId(productionEditorSlot.id); }}
          onMaterial={() => setProductionEditorId('')}
          onAdopt={id => void adoptProductionCandidate(id)}
          onRefresh={id => void refreshProductionJob(id)}
          onRefreshExecution={id => void refreshReferenceProduction(id)}
          onCancelExecution={id => void cancelReferenceProduction(id)}
          onReconcileExecutionCost={id => void reconcileProductionCost(id)}
          onReviewExecution={async (id, decisionsByKey, feedback = '') => {
            try {
              const execution = productionExecutions.find(item => item.id === id);
              if (!execution) return;
              const pending = execution.quality.checks.filter(check => check.mode === 'manual' && check.status === 'pending');
              if (!pending.length || pending.some(check => decisionsByKey[check.key] === undefined)) throw new Error('请逐项完成全部人工验收');
              if (pending.some(check => decisionsByKey[check.key] === false) && !feedback.trim()) throw new Error('存在未通过项目时必须填写具体修改意见');
              const decisions = Object.fromEntries(pending.map(check => [check.key, {
                passed: decisionsByKey[check.key],
                evidence: decisionsByKey[check.key] ? `用户在分镜候选预览中逐项确认通过${feedback.trim() ? `：${feedback.trim()}` : ''}` : `用户修改意见：${feedback.trim()}`,
              }]));
              const reviewed = await productionApi.reviewExecutionQuality(id, decisions, feedback);
              setProductionExecutions(current => [reviewed, ...current.filter(item => item.id !== reviewed.id)]);
            } catch (error) { setProductionError(error instanceof Error ? error.message : '人工验收保存失败'); }
          }}
        />
      )}
      </div>

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
              ref={existingSourceDraftDialogRef}
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
                    data-modal-initial-focus
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
            workflowContext={['content_production', 'content_quality_gate'].includes(workflowContext?.taskKey || '') ? workflowContext : undefined}
            onClose={() => setShowProjects(false)}
            onPublish={draft => { setShowProjects(false); onGoPublish?.(draft); }}
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
function ProjectsOverlay({ projects, batches, materials, currentId, workflowContext, onClose, onLoad, onDelete, onReview, onReuseProject, onReuse, onPublish }: {
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
  onPublish: (draft: any) => void;
}) {
  const [collection, setCollection] = useState<'projects' | 'finished'>('projects');
  const dialogRef = useModalFocus<HTMLDivElement>({ open: true, onClose });
  const drafts = projects.filter(p => p.status === 'draft');
  const works = projects.filter(p => p.status === 'ready_for_approval' || p.status === 'published');

  const Section = ({ title, items }: { title: string; items: StudioProject[] }) => (
    <div className="mb-5">
      <p className="text-xs font-semibold text-text-secondary mb-2">{title} · {items.length}</p>
      {items.length === 0 ? (
        <p className="text-xs text-text-muted py-3 text-center">暂无</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
                {productionSummary(p.spec || {}) && <p className="mt-1 text-[10px] text-amber-700">{productionSummary(p.spec || {})}</p>}
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
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="projects-overlay-title"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex bg-surface">
      <motion.div
        initial={{ scale: 0.96, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 10 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320 }}
        className="h-full w-full flex flex-col bg-surface overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <FolderOpen size={15} style={{ color: TRAFFIC_GREEN }} />
            <div>
              <span id="projects-overlay-title" className="text-sm font-bold text-text-primary">{workflowContext ? '当前任务的内容项目' : '我的创作'}</span>
              {workflowContext && <p className="mt-0.5 text-[10px] text-text-muted">仅显示本次运行与任务关联的项目</p>}
            </div>
          </div>
          <button type="button" data-modal-initial-focus onClick={onClose} aria-label="关闭我的创作" title="关闭" className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary">
            返回创作
          </button>
        </div>
        <div className="flex shrink-0 gap-6 border-b border-border px-6" role="tablist" aria-label="我的创作分类">
          {(['projects', 'finished'] as const).filter(tab => !workflowContext || tab === 'projects').map(tab => <button key={tab} role="tab" aria-selected={collection === tab} onClick={() => setCollection(tab)} className={`border-b-2 py-4 text-sm font-semibold ${collection === tab ? 'border-accent text-accent' : 'border-transparent text-text-muted'}`}>{tab === 'projects' ? '草稿与项目' : '已完成成片'}</button>)}
        </div>
        {collection === 'finished' && <div className="min-h-0 flex-1"><ContentLibrary onPublish={onPublish} /></div>}
        <div className={collection === 'projects' ? "flex-1 overflow-y-auto p-6" : "hidden"}>
          {drafts.length === 0 && works.length === 0 && batches.length === 0 ? (
            <div className="text-center py-12">
              <FolderOpen size={28} className="mx-auto text-text-muted mb-3 opacity-30" />
              <p className="text-sm text-text-muted">{workflowContext ? '当前任务尚未创建内容项目' : '还没有保存任何草稿或作品'}</p>
              <p className="text-xs text-text-muted mt-1">{workflowContext ? '请返回执行中心查看任务状态或重试任务' : '开始创作后会自动保存，也可在顶部手动保存'}</p>
            </div>
          ) : (
            <>
              <Section title="继续创作" items={drafts} />
              <Section title="已完成项目 · 可继续编辑" items={works} />
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
