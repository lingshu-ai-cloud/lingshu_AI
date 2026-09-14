/* 混剪工作台 AI 接口封装 */
import { authHeader } from './auth';
async function post<T>(path: string, body: unknown, fallback: T, signal?: AbortSignal): Promise<T & { source?: string }> {
  const retryablePaths = new Set(['script', 'translate', 'translate/batch', 'tts', 'tts/batch']);
  const maxAttempts = path === 'script' ? 4 : retryablePaths.has(path) ? 2 : 1;
  let lastError = 'request_failed';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const r = await fetch(`/api/overseas/studio/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(body),
        signal,
      });
      if (r.status === 402 || r.status === 429) {
        const j = await r.json().catch(() => ({}));
        throw new Error(formatDemoQuotaError(j));
      }
      if (!r.ok) {
        const payload = await r.json().catch(() => ({})) as Record<string, unknown> & { error?: string; source?: string };
        // Script quality rejections are a valid, structured product response.
        // Preserve their diagnostics so the studio can explain the block instead
        // of degrading it into an apparently unresponsive empty result.
        if (path === 'script' && r.status === 422) {
          return { ...fallback, ...payload, source: payload.source || 'ai_rejected' } as T & { source?: string };
        }
        const message = payload.error || `HTTP ${r.status}`;
        if ([502, 503, 504].includes(r.status) && attempt < maxAttempts) {
          await new Promise(resolve => window.setTimeout(resolve, [0, 2000, 5000, 10000][attempt] || 10000));
          continue;
        }
        throw new Error(message);
      }
      return (await r.json()) as T & { source?: string };
    } catch (err: any) {
      const message = String(err?.message || '');
      if (message.includes('Demo') || message.includes('试用') || message.includes('额度') || message.includes('到期')) throw err;
      if (signal?.aborted) throw err;
      lastError = message || 'request_failed';
      const transientNetworkError = /fetch|network|failed|load|eof|502|503|504/i.test(lastError);
      if (retryablePaths.has(path) && transientNetworkError && attempt < maxAttempts) {
        await new Promise(resolve => window.setTimeout(resolve, [0, 2000, 5000, 10000][attempt] || 10000));
        continue;
      }
      break;
    }
  }
  return { ...fallback, source: 'local', error: lastError };
}
export type StudioScriptQualityStatus =
  | 'passed'
  | 'passed_with_warnings'
  | 'warning'
  | 'needs_material'
  | 'rejected'
  // Legacy statuses remain readable while old drafts/backends are in flight.
  | 'repaired'
  | 'recovered'
  | 'fallback'
  | 'failed';
export interface StudioScriptQualityChecks {
  materialGrounded?: boolean;
  timelineGrounded?: boolean;
  productGrounded?: boolean;
  dialogueFits?: boolean;
  structurallyComplete?: boolean;
  ctaComplete?: boolean;
  materialCoverage?: number | StudioScriptMaterialCoverage;
  materialCoveragePercent?: number;
  [key: string]: boolean | number | string | StudioScriptMaterialCoverage | undefined;
}
export interface StudioScriptMaterialCoverage {
  covered?: number;
  total?: number;
  selectedMaterials?: number;
  storyboardScenes?: number;
  boundScenes?: number;
  pendingScenes?: number;
  coverageRatio?: number;
  ratio?: number;
  percent?: number;
  percentage?: number;
  missing?: string[];
  missingShots?: string[];
}
export interface StudioScriptResult {
  script: string;
  source?: 'ai' | 'fallback' | 'local' | 'ai_failed' | 'ai_rejected' | string;
  qualityStatus?: StudioScriptQualityStatus;
  qualityChecks?: StudioScriptQualityChecks;
  validationWarnings?: string[];
  validationIssues?: string[];
  materialCoverage?: number | StudioScriptMaterialCoverage;
  missingMaterials?: string[];
  fallbackReason?: string;
  error?: string;
  code?: string;
}

function formatDemoQuotaError(j: any): string {
  if (j?.error === 'demo_expired') return '试用已到期，请联系服务顾问开通或延长试用。';
  if (j?.error === 'demo_token_quota_exceeded') return '今日 Token 额度已用完，请明天再试或联系服务顾问开通更多额度。';
  if (j?.quota === 'generation') return '今日普通生成额度已用完，脚本/封面/配音等 AI 生成请明天再试或联系服务顾问开通更多额度。';
  if (j?.quota === 'render') return '今日成片预览额度已用完，请明天再试或联系服务顾问开通更多额度。';
  if (j?.quota === 'videoGeneration') return '今日视频生成额度已用完，请明天再试或联系服务顾问开通更多额度。';
  return '今日试用额度已用完，请明天再试或联系服务顾问开通更多额度。';
}

async function get<T>(path: string, fallback: T): Promise<T & { source?: string }> {
  try {
    const r = await fetch(`/api/overseas/studio/${path}`, { headers: authHeader() });
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as T & { source?: string };
  } catch {
    return { ...fallback, source: 'local' };
  }
}

async function postSeedanceVideo(body: unknown): Promise<SeedanceVideoResult> {
  try {
    const r = await fetch('/api/overseas/studio/seedance-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(body),
    });
    if (r.status === 402 || r.status === 429) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error === 'demo_expired' ? '试用已到期，请联系服务顾问开通或延长试用。' : '今日试用额度已用完，请明天再试或联系服务顾问开通更多额度。');
    }
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as SeedanceVideoResult;
  } catch (err: any) {
    if (String(err?.message || '').includes('Demo')) throw err;
    return { ok: false, source: 'seedance', error: String(err?.message || err || 'Seedance video request failed') };
  }
}

export interface SelectInput { materials: { id: string; name: string; type: string; duration: number }[]; duration: number }

// 字幕 cue：start/end 为相对成片起点的秒数；zh 为可选中文译文（双语字幕）
export interface SubCue { start: number; end: number; text: string; zh?: string; words?: Array<{ text: string; start: number; end: number }> }
export interface TtsStyleOptions {
  preset: 'tiktok_excited' | 'authentic_review' | 'professional_b2b' | 'warm_story' | 'urgent_cta';
  emotion: string;
  emotionIntensity: number;
  speed: number;
  targetDuration: number;
  pauseStyle: 'few' | 'natural' | 'dramatic';
  pronunciations: Array<{ word: string; pronunciation: string }>;
}
export interface TtsAudioResult {
  ok: boolean;
  source?: string;
  url?: string;
  duration?: number;
  error?: string;
  text?: string;
  adjusted?: boolean;
  targetDuration?: number;
  cues?: SubCue[];
  alignmentSource?: 'audio_ai' | 'proportional' | 'minimax_native';
  customVoiceStatus?: 'activated';
}
export interface StudioAudioCapabilities {
  ok: boolean;
  customVoice: {
    upload: boolean;
    synthesis: boolean;
    engines: { minimax: boolean; xtts: boolean };
    message: string;
  };
  minimax?: {
    configured: boolean;
    baseUrl: string;
    model: string;
    diagnosticAvailable: boolean;
  };
  subtitles: {
    automatic: boolean;
    audioTranscription: boolean;
    wordAlignment: boolean;
    fallback: 'proportional';
  };
}
export interface SubtitleSpec {
  mode: 'off' | 'target' | 'bilingual';
  cues: SubCue[];
  style: Partial<CoverStyle>;     // 沿用封面样式体系（字体 / 颜色 / 粗细）
}

export interface RenderSpec {
  materials: string[];
  timeline?: {
    name: string;
    url?: string;
    type?: 'video' | 'image' | 'audio';
    poster?: string;
    trimStart?: number;
    trimEnd?: number;
    speed?: number;
    targetStart?: number;
    targetEnd?: number;
    targetDuration?: number;
  }[];
  script: string;
  voice: string;
  bgm: string;
  bgmVol: number;
  voiceVol: number;
  coverId: string;
  coverTitle: string;
  ratio: string;
  duration: number;
  platform: string;
  language: string;
  voiceoverUrl?: string;
  coverUrl?: string;
  subtitles?: SubtitleSpec;       // 字幕轨（桌面端 ffmpeg 烧录）
}

export interface RenderManifest {
  jobId: string;
  spec: { ratio: string; duration: number; platform: string; language: string; bgmVol: number; voiceVol: number };
  script: string;
  timeline: {
    index: number;
    name: string;
    url: string | null;
    trimStart?: number;
    trimEnd?: number;
    speed?: number;
    targetStart?: number;
    targetEnd?: number;
    targetDuration?: number;
  }[];
  voiceover: { voice: string | null; url: string | null };
  cover: { id: string | null; title: string; url: string | null };
  bgm: { id: string | null; url: string | null };
  subtitles?: SubtitleSpec;
}

export interface RenderAuthorization {
  token: string | null;        // 短期签名令牌；离线兜底为 null
  expiresAt: string | null;
  manifest: RenderManifest;
}

/* 桌面客户端（Electron）注入的本机 ffmpeg 合成桥；纯网页里为 undefined */
export interface DesktopRenderBridge {
  available: boolean;
  render: (manifest: RenderManifest) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
  showItemInFolder?: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
  onProgress: (cb: (pct: number) => void) => () => void; // 返回取消订阅函数
}

declare global {
  interface Window { desktopRender?: DesktopRenderBridge }
}

/** 取桌面端本机合成桥（仅 Electron 客户端有） */
export function getDesktopRender(): DesktopRenderBridge | undefined {
  return typeof window !== 'undefined' ? window.desktopRender : undefined;
}

/** 离线 / 未授权时的本地兜底 manifest，桥接服务端 buildManifest 的结构 */
function localManifest(spec: RenderSpec): RenderManifest {
  return {
    jobId: `local-${Date.now()}`,
    spec: {
      ratio: spec.ratio || '9:16',
      duration: spec.duration ?? 20,
      platform: spec.platform || 'tiktok',
      language: spec.language || 'en',
      bgmVol: spec.bgmVol ?? 35,
      voiceVol: spec.voiceVol ?? 100,
    },
    script: spec.script ?? '',
    timeline: (spec.timeline?.length ? spec.timeline : (spec.materials ?? []).map(name => ({ name })))
      .map((item, index) => {
        const candidateUrl = Reflect.get(item, 'url');
        return { index, ...item, url: typeof candidateUrl === 'string' ? candidateUrl : null };
      }),
    voiceover: { voice: spec.voice ?? null, url: spec.voiceoverUrl ?? null },
    cover: { id: spec.coverId ?? null, title: spec.coverTitle ?? '', url: spec.coverUrl ?? null },
    bgm: { id: spec.bgm ?? null, url: null },
    subtitles: spec.subtitles,
  };
}

export interface StudioProject {
  id: string;
  title: string;
  status: 'draft' | 'ready_for_approval' | 'published' | 'template';
  spec: Record<string, unknown>;
  thumbSeed?: string;
  createdAt: string;
  updatedAt: string;
}
export interface VariationBatch {
  id: string;
  title: string;
  status: 'queued' | 'running' | 'review' | 'completed' | 'paused';
  estimatedCostCny: number;
  plan?: {
    platform?: string; ratio?: string; contentMode?: string; mode?: string; strategy?: string;
    duration?: number; maxItems?: number; dimensions?: Record<string, string[]>;
    productInfo?: string; productSelectMode?: string; selectedProductIds?: string[];
    audience?: string; sellingPoints?: string; tone?: string; language?: string; provider?: string;
  };
  items: { id: string; variables: Record<string, string>; status: string; qualityScore?: number; note?: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface SeedanceVideoResult {
  ok: boolean;
  source?: string;
  id?: string;
  taskId?: string;
  title?: string;
  url?: string;
  poster?: string;
  duration?: number;
  model?: string;
  material?: Material;
  version?: VideoGenerationVersion;
  error?: string;
  createdAt?: string;
}

export interface StoryboardQualityResult {
  score: number;
  passed: boolean;
  issues: string[];
  strengths: string[];
  recommendation: string;
  checks: Record<string, number>;
  checkedAt: string;
}

export interface FbPosterBrief {
  headline: string;
  subheadline: string;
  originBadge: string;
  trustBadges: string[];
  sellingPoints: string[];
  process: string[];
  categories: { name: string; description: string }[];
  bottomBar: string[];
  cta: string;
}

export interface FbPosterResult {
  ok: boolean;
  source?: 'ai' | 'fallback' | 'local';
  layoutModules?: {
    module: string;
    referencePattern: string;
    localAssetRole: string;
    replacementInstruction: string;
  }[];
  poster: FbPosterBrief;
  caption: string;
  hashtags: string[];
  commentCta: string;
  dmOpening: string;
  fieldsToConfirm: string[];
  imagePrompt: string;
  error?: string;
}

export interface FbPosterRenderResult {
  ok: boolean;
  source?: 'gemini' | 'seedream' | 'local';
  model?: string;
  url?: string;
  material?: Material;
  references?: number;
  error?: string;
}

export interface LeadContentPackageResult {
  ok: boolean;
  source?: 'ai';
  provider?: 'qwen' | 'gemini';
  strategySummary: string;
  referenceModulesUsed: Array<{ module: string; evidence: string; application: string }>;
  items: Array<{
    role: 'buyer_attention' | 'capability_explanation' | 'supplier_trust';
    title: string;
    objective: string;
    slides: Array<{ index: number; role: string; headline: string; body: string; assetRole: string }>;
    caption: string;
    hashtags: string[];
    cta: string;
    dmOpening: string;
    imagePrompt: string;
  }>;
  fieldsToConfirm: string[];
  error?: string;
}

function productCategoryFromInfo(productInfo?: string): string {
  const text = String(productInfo || '');
  const match = text.match(/(?:产品类目|所属类目|产品名称|主推产品|category|product)[：:]\s*([^\n]+)/i);
  return String(match?.[1] || 'Private Label Product').trim().slice(0, 60) || 'Private Label Product';
}

function localPosterFallback(input: {
  productInfo?: string;
  ratio?: string;
  posterStyle?: string;
}): FbPosterResult {
  const category = productCategoryFromInfo(input.productInfo);
  const poster: FbPosterBrief = {
    headline: `OEM/ODM ${category}`,
    subheadline: 'Private label solution for overseas brands',
    originBadge: 'Global export support',
    trustBadges: ['GMP', 'ISO', 'FDA-ready'],
    sellingPoints: ['Custom Formula', 'Premium Packaging', 'Factory Support', 'Global Export'],
    process: ['Consultation', 'Formula Development', 'Packaging Design', 'Production', 'Quality Control', 'Delivery'],
    categories: [
      { name: category, description: 'Customizable product line for brand owners and distributors' },
      { name: 'Private Label', description: 'Logo, packaging and formula support for market testing' },
      { name: 'OEM/ODM', description: 'One-stop manufacturing service from sample to bulk order' },
    ],
    bottomBar: ['Low MOQ', 'Custom Formula', 'Premium Packaging', 'Fast Turnaround', 'Dedicated Support'],
    cta: 'Comment "CATALOG" or DM us for sample details',
  };
  return {
    ok: true,
    source: 'local',
    layoutModules: [
      {
        module: 'headline zone',
        referencePattern: 'Use a strong OEM/ODM value hook or clone-mode viral opening structure.',
        localAssetRole: 'none',
        replacementInstruction: 'Rewrite with verified product category and buyer pain point.',
      },
      {
        module: 'product hero',
        referencePattern: 'Premium central product display with clean catalog composition.',
        localAssetRole: 'product photo',
        replacementInstruction: 'Replace competitor/product placeholder with selected local product images.',
      },
      {
        module: 'proof modules',
        referencePattern: 'Factory proof, badges, process row, category cards, and CTA bar.',
        localAssetRole: 'factory image / certificate image / packaging image / scene image',
        replacementInstruction: 'Map local assets to each proof module and keep commercial claims verified.',
      },
    ],
    poster,
    caption: `Looking to launch your own ${category} brand?\n\nWe support OEM/ODM, private label packaging, product customization, and export-ready supply for overseas buyers.\n\nComment "CATALOG" or DM us to get product options and sample details.`,
    hashtags: ['OEM', 'ODM', 'PrivateLabel', 'B2B', 'Wholesale', 'FactoryDirect'],
    commentCta: 'Comment "CATALOG" to get the product list and sample details.',
    dmOpening: 'Hi, thanks for your interest. May I know your target market, product type, expected MOQ, and whether you need private label packaging?',
    fieldsToConfirm: ['MOQ', 'certifications', 'lead time', 'price range', 'export countries', 'factory qualifications'],
    imagePrompt: `Create a high-end B2B OEM/ODM social media poster for ${category}. Ratio ${String(input.ratio || '1:1')}. Style ${String(input.posterStyle || 'oem-factory')}. Include the exact poster text from the JSON brief, product hero area, factory proof area, trust badges, process row, product category cards, and bottom CTA bar. Premium catalog quality, clean layout, no unreadable tiny text.`,
  };
}

async function del(path: string): Promise<{ ok: boolean }> {
  try {
    const r = await fetch(`/api/overseas/studio/${path}`, { method: 'DELETE', headers: authHeader() });
    return { ok: r.ok };
  } catch {
    return { ok: false };
  }
}

export const studioApi = {
  script: (b: {
    materials: string[];
    productInfo?: string;
    language: string;
    platform: string;
    duration: number;
    scriptType?: 'voiceover' | 'storyboard';
    generationMode?: 'material' | 'product' | 'clone';
    cooperationRoute?: string;
    voiceoverMode?: 'none' | 'ai' | 'upload';
    materialInfos?: Array<{ name: string; type: string; folder: string; duration: number; effectiveDuration?: number; role?: string; targetStart?: number; targetEnd?: number; industry?: string; shotFunction?: string; tags?: string; observations?: string[] }>;
    provider?: 'gemini' | 'qwen';
    audience?: string;
    sellingPoints?: string;
    tone?: string;
    videoTheme?: { id: string; title: string; painPoint: string; conversionGoal: string; primaryCta?: string; contentGoal?: 'reach' | 'leads' };
    referenceTitle?: string;
    referenceAnalysis?: string;
    referenceHighlights?: string[];
    existingScripts?: string[];
    variantSeed?: number;
  }, fb: string, options?: { signal?: AbortSignal }) =>
    post<StudioScriptResult>('script', { ...b, provider: 'qwen' }, { script: '' }, options?.signal),

  covers: (b: { script?: string; productInfo?: string; language: string; provider?: 'gemini' | 'qwen'; tone?: string }, fb: string[]) =>
    post<{ covers: string[] }>('covers', b, { covers: fb }),

  caption: (b: {
    script?: string;
    productInfo?: string;
    platform: string;
    language: string;
    provider?: 'gemini' | 'qwen';
    audience?: string;
    sellingPoints?: string;
    tone?: string;
  }, fb: { caption: string; hashtags: string[] }) =>
    post<{ caption: string; hashtags: string[] }>('caption', b, fb),

  fbPoster: (b: {
    mode: 'material' | 'clone' | 'product';
    productInfo?: string;
    platform: string;
    ratio: string;
    posterStyle: string;
    language: string;
    provider?: 'gemini' | 'qwen';
    materials?: Array<{ id?: string; name: string; type?: string; folder?: string; role?: string }>;
    referenceNotes?: string;
  }) =>
    post<FbPosterResult>('fb-poster', b, localPosterFallback(b)),

  leadContentPackage: (b: { productInfo: string; platform: string; language: string; ratio: string; referenceTitle: string; referenceEvidence: unknown }) =>
    post<LeadContentPackageResult>('lead-content-package', b, { ok: false, strategySummary: '', referenceModulesUsed: [], items: [], fieldsToConfirm: [], error: '获客内容包生成失败' }),

  fbPosterRender: (b: {
    poster: FbPosterBrief;
    caption?: string;
    imagePrompt?: string;
    ratio: string;
    materialIds?: string[];
  }) =>
    post<FbPosterRenderResult>('fb-poster/render', b, { ok: false }),

  select: (b: SelectInput, fb: string[]) =>
    post<{ selectedIds: string[]; reason: string }>('select', b, { selectedIds: fb, reason: '本地按视频优先选取' }),

  // 配音 TTS
  tts: (b: { script?: string; text?: string; voice: string; language: string; style?: Partial<TtsStyleOptions> }) =>
    post<TtsAudioResult>('tts', b, { ok: false }),
  ttsBatch: (b: { voice: string; items: { code: string; text: string; language?: string }[]; style?: Partial<TtsStyleOptions> }) =>
    post<{ ok: boolean; audios: Record<string, TtsAudioResult>; error?: string }>('tts/batch', b, { ok: false, audios: {} }),
  alignTts: (b: { text: string; url: string; duration: number }) =>
    post<{ ok: boolean; cues: SubCue[]; source?: 'audio_ai' | 'proportional' | 'qwen_asr'; error?: string }>('tts/align', b, { ok: false, cues: [] }),
  qwenAsr: (b: { text?: string; url: string; duration: number; confirmed?: boolean }) =>
    post<{ ok: boolean; id?: string; taskId?: string; status?: string; text?: string; cues?: SubCue[]; matches?: boolean; source?: 'qwen_asr'; error?: string }>('tts/asr', b, { ok: false }),
  transcribeMaterial: (id: string) => post<{ ok: boolean; text?: string; error?: string }>(`materials/${encodeURIComponent(id)}/transcribe`, {}, { ok: false }),
  transcribeVoiceover: (b: { url: string; duration: number; language?: string; transcriptHint?: string }) =>
    post<{ ok: boolean; text: string; cues: SubCue[]; matches?: boolean; status?: string; source?: 'audio_ai' | 'proportional' | 'qwen_asr'; error?: string }>('tts/transcribe', b, { ok: false, text: '', cues: [] }),
  audioCapabilities: async () => {
    try {
      const r = await fetch('/api/overseas/studio/tts/capabilities', { headers: authHeader() });
      if (!r.ok) throw new Error(String(r.status));
      return await r.json() as StudioAudioCapabilities;
    } catch {
      return {
        ok: false,
        customVoice: { upload: true, synthesis: false, engines: { minimax: false, xtts: false }, message: '暂时无法读取真人音色引擎状态。' },
        subtitles: { automatic: true, audioTranscription: false, wordAlignment: false, fallback: 'proportional' },
      } as StudioAudioCapabilities;
    }
  },
  diagnoseMinimax: () =>
    post<{ ok: boolean; configured: boolean; latencyMs?: number; model?: string; clonedVoices?: number; message?: string; error?: string }>(
      'tts/minimax/diagnose', {}, { ok: false, configured: false, error: 'MiniMax 诊断请求失败' },
    ),
  uploadVoiceSample: (b: { name: string; dataBase64: string; mimeType?: string; duration?: number; replacesVoiceId?: string }) =>
    post<{ ok: boolean; id?: string; voiceId?: string; name?: string; url?: string; duration?: number; synthesisReady?: boolean; engine?: 'minimax' | 'xtts'; warning?: string; error?: string }>('voice-samples', b, { ok: false }),
  listVoiceSamples: async (): Promise<Array<{ voiceId: string; name: string; url: string; duration: number; createdAt: string }>> => {
    try {
      const r = await fetch('/api/overseas/studio/voice-samples', { headers: authHeader() });
      return r.ok ? await r.json() : [];
    } catch { return []; }
  },
  uploadVoiceover: (b: { name: string; dataBase64: string; mimeType?: string; duration?: number }) =>
    post<{ ok: boolean; url?: string; duration?: number; error?: string }>('voiceover', b, { ok: false }),

  // 封面 SVG
  cover: (b: { title: string; ratio: string; accent: string; bgImageUrl?: string } & Partial<CoverStyle>) =>
    post<{ ok: boolean; url?: string }>('cover', b, { ok: false }),

  // 文本翻译（默认译成简体中文，供用户确认外语文案）
  translate: (b: { text: string; target?: string; source?: string }, options?: { signal?: AbortSignal }) =>
    post<{ ok: boolean; text: string; error?: string }>('translate', b, { ok: false, text: '' }, options?.signal),
  translateBatch: (b: { text: string; targets: string[]; source?: string }, options?: { signal?: AbortSignal }) =>
    post<{ ok: boolean; translations: Record<string, string>; error?: string }>('translate/batch', b, { ok: false, translations: {} }, options?.signal),

  // Seedance 视频生成
  seedanceVideo: (b: {
    script: string;
    productInfo?: string;
    language: string;
    ratio?: string;
    duration?: number;
    resolution?: string;
    title?: string;
    referenceImageUrl?: string;
    generationGroupKey?: string;
    generationContext?: Record<string, unknown>;
    parentVersionId?: string;
  }) =>
    postSeedanceVideo(b),

  listVideoVersions: async (groupKey: string): Promise<VideoGenerationVersion[]> => {
    try {
      const r = await fetch(`/api/overseas/studio/video-versions?groupKey=${encodeURIComponent(groupKey)}`, { headers: authHeader() });
      return r.ok ? await r.json() as VideoGenerationVersion[] : [];
    } catch { return []; }
  },
  selectVideoVersion: async (id: string) => {
    try {
      const r = await fetch(`/api/overseas/studio/video-versions/${encodeURIComponent(id)}/select`, { method: 'PATCH', headers: authHeader() });
      return await r.json() as { ok: boolean; version?: VideoGenerationVersion };
    } catch { return { ok: false }; }
  },

  storyboardQualityCheck: (b: { materialId: string; storyboard: string; productInfo?: string; critical?: boolean }) =>
    post<{ ok: boolean; quality?: StoryboardQualityResult; error?: string }>('storyboard-quality-check', b, { ok: false }),

  // 数据看板 AI 结论
  insight: (b: { scope: string; metrics: Record<string, unknown> }) =>
    post<{ ok: boolean; summary: string; actions: string[] }>('insight', b, { ok: false, summary: '', actions: [] }),

  // ⑥ 渲染授权：服务器下发原料 manifest + 短期令牌，合成交给客户端本机 ffmpeg
  render: async (spec: RenderSpec): Promise<RenderAuthorization & { source?: string }> => {
    try {
      const r = await fetch('/api/overseas/studio/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(spec),
      });
      if (r.status === 402 || r.status === 429) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error === 'demo_expired' ? '试用已到期，请联系服务顾问开通或延长试用。' : '今日视频预览额度已用完，请明天再试或联系服务顾问开通更多额度。');
      }
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as RenderAuthorization;
    } catch (err: any) {
      if (String(err?.message || '').includes('Demo')) throw err;
      return { source: 'local', token: null, expiresAt: null, manifest: localManifest(spec) };
    }
  },

  renderLocal: async (manifest: RenderManifest): Promise<{ ok: boolean; outputPath?: string; previewUrl?: string; error?: string }> => {
    try {
      const r = await fetch('/api/overseas/studio/render/local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(manifest),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || String(r.status));
      return data as { ok: boolean; outputPath?: string; previewUrl?: string; error?: string };
    } catch (err: any) {
      return { ok: false, error: err?.message || '本地 MP4 导出失败' };
    }
  },

  openRenderOutput: async (path: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const r = await fetch('/api/overseas/studio/render/open-output', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ path }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, error: data?.error || `打开本地文件夹失败（${r.status}）` };
      return data as { ok: boolean; error?: string };
    } catch (err: any) {
      return { ok: false, error: err?.message || '打开本地文件夹失败' };
    }
  },

  // 草稿 / 作品
  listProjects: async (): Promise<StudioProject[]> => {
    try {
      const r = await fetch('/api/overseas/studio/projects', { headers: authHeader() });
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      return Array.isArray(data) ? (data as StudioProject[]) : [];
    } catch {
      return [];
    }
  },
  saveProject: (b: { id?: string; title: string; status: 'draft' | 'ready_for_approval' | 'published' | 'template'; spec: Record<string, unknown>; thumbSeed?: string }) =>
    post<{ ok: boolean; project: StudioProject }>('projects', b, { ok: false, project: null as unknown as StudioProject }),
  deleteProject: (id: string) => del(`projects/${id}`),
  createVariationBatch: (b: { title: string; templateProjectId?: string; duration: number; maxItems: number; dimensions: Record<string, string[]>; plan?: VariationBatch['plan'] }) =>
    post<{ ok: boolean; batch: VariationBatch }>('variation-batches', b, { ok: false, batch: null as unknown as VariationBatch }),
  listVariationBatches: async (): Promise<VariationBatch[]> => {
    try { const r = await fetch('/api/overseas/studio/variation-batches', { headers: authHeader() }); return r.ok ? await r.json() as VariationBatch[] : []; } catch { return []; }
  },
  updateVariationItem: async (batchId: string, itemId: string, body: { status: string; note?: string }) => {
    try {
      const r = await fetch(`/api/overseas/studio/variation-batches/${batchId}/items/${itemId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify(body) });
      return await r.json() as { ok: boolean; batch?: VariationBatch };
    } catch { return { ok: false }; }
  },

  // 素材库
  listMaterialLibrary: fetchMaterialLibrary,
  listMaterials: async (): Promise<Material[]> => (await fetchMaterialLibrary()).items,
  uploadMaterial: (b: { name: string; folder?: string; type: 'video' | 'image' | 'audio'; duration?: number; width?: number; height?: number; dataBase64: string; mimeType?: string; sourceType?: string }) =>
    post<{ ok: boolean; material: Material }>('materials', b, { ok: false, material: null as unknown as Material }),
  uploadMaterialFile: async (
    file: File,
    metadata: { folder?: string; type: 'video' | 'image' | 'audio'; duration?: number; width?: number; height?: number; sourceType?: string },
  ): Promise<{ ok: boolean; material: Material; error?: string }> => {
    const maxBytes = 110 * 1024 * 1024;
    if (!file.size) return { ok: false, material: null as unknown as Material, error: '素材文件为空' };
    if (file.size > maxBytes) return { ok: false, material: null as unknown as Material, error: '单个素材不能超过 110 MB' };
    const query = new URLSearchParams({
      name: file.name,
      folder: metadata.folder || 'upload',
      type: metadata.type,
      duration: String(metadata.duration || 0),
      width: String(metadata.width || 0),
      height: String(metadata.height || 0),
      mimeType: file.type || 'application/octet-stream',
      sourceType: metadata.sourceType || '',
    });
    try {
      const response = await fetch(`/api/overseas/studio/materials/file?${query.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', ...authHeader() },
        body: file,
      });
      const payload = await response.json().catch(() => ({})) as { ok?: boolean; material?: Material; error?: string };
      if (!response.ok || !payload.ok || !payload.material) {
        return { ok: false, material: null as unknown as Material, error: payload.error || `上传失败（HTTP ${response.status}）` };
      }
      return { ok: true, material: payload.material };
    } catch (error) {
      return {
        ok: false,
        material: null as unknown as Material,
        error: error instanceof Error ? error.message : '素材上传失败',
      };
    }
  },
  startMaterialAnalysis: (id: string, retry = false) => post<{ ok: boolean; status?: string; error?: string }>(`materials/${encodeURIComponent(id)}/analysis`, { retry }, { ok: false }),
  analyzeMaterialSegments: (id: string) =>
    post<{ ok: boolean; material?: Material; segments?: MaterialSegment[]; error?: string }>(`materials/${id}/analyze-segments`, {}, { ok: false, error: '片段分析失败' }),
  classifyMaterial: (id: string) =>
    post<{ ok: boolean; material?: Material; error?: string }>(`materials/${id}/classify`, {}, { ok: false, error: '智能分类失败' }),
  updateMaterialSegment: async (materialId: string, segmentId: string, patch: Partial<MaterialSegment>) => {
    try {
      const response = await fetch(`/api/overseas/studio/materials/${materialId}/segments/${segmentId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify(patch),
      });
      return await response.json() as { ok: boolean; material?: Material; segment?: MaterialSegment; error?: string };
    } catch { return { ok: false, error: '片段更新失败' }; }
  },
  materialProducts: () => get<{items:Array<{id:string;name:string}>}>('material-products', {items:[]}),
  updateMaterial: async (id: string, changes: { name: string; tags?: string; productId?: string }): Promise<{ ok: boolean; material?: Material; error?: string }> => {
    try {
      const response = await fetch(`/api/overseas/studio/materials/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(changes),
      });
      return await response.json();
    } catch {
      return { ok: false, error: '素材编辑失败' };
    }
  },
  deleteMaterial: (id: string) => del(`materials/${id}`),

  digitalHumanAvatars: () => get<{ items: Array<{ id: string; name: string }> }>('digital-human/avatars', { items: [] }),
  approveDigitalHumanJob: (id: string) => post<{ ok: boolean; job?: DigitalHumanJob }>(`digital-human/jobs/${encodeURIComponent(id)}/approve`, { reviewed: true }, { ok: false }),
  digitalHumanCapabilities: () => get<DigitalHumanCapabilities>('digital-human/capabilities', {
    available: false, provider: 'unconfigured', modes: [{ id: 'fast', label: '极速模式' }, { id: 'quality', label: '高质量模式' }],
    output: { ratio: '9:16', container: 'mp4' }, qualityGateRequired: true, maxConcurrentJobs: 2,
    unavailableReason: '无法连接数字人服务',
  }),
  createDigitalHumanJob: (body: { projectId?: string; avatarMaterialId?: string; heygenAvatarId?: string; voiceoverUrl: string; script: string; language: string; mode: 'fast' | 'quality'; consentConfirmed: boolean }) =>
    post<{ ok: boolean; job?: DigitalHumanJob; error?: string; code?: string }>('digital-human/jobs', body, { ok: false, error: '数字人任务提交失败' }),
  getDigitalHumanJob: (id: string) =>
    get<{ ok: boolean; job?: DigitalHumanJob; outputMaterial?: Material; error?: string }>(`digital-human/jobs/${encodeURIComponent(id)}`, { ok: false, error: '数字人任务查询失败' }),
  listDigitalHumanJobs: async (projectId?: string): Promise<DigitalHumanJob[]> => {
    try {
      const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
      const response = await fetch(`/api/overseas/studio/digital-human/jobs${query}`, { headers: authHeader(), cache: 'no-store' });
      if (!response.ok) return [];
      const payload = await response.json();
      return Array.isArray(payload) ? payload as DigitalHumanJob[] : [];
    } catch { return []; }
  },
  retryDigitalHumanJob: (id: string) =>
    post<{ ok: boolean; job?: DigitalHumanJob; error?: string }>(`digital-human/jobs/${encodeURIComponent(id)}/retry`, {}, { ok: false, error: '数字人任务重试失败' }),
  cancelDigitalHumanJob: (id: string) =>
    post<{ ok: boolean; job?: DigitalHumanJob; error?: string }>(`digital-human/jobs/${encodeURIComponent(id)}/cancel`, {}, { ok: false, error: '数字人任务取消失败' }),
  assessTransformation: (body: TransformationAssessmentInput) =>
    post<{ ok: boolean; assessment?: TransformationAssessment; error?: string }>('transformations/assess', body, { ok: false, error: '替换兼容性评估失败' }),

  // BGM 曲库
  listBgm: async (): Promise<BgmTrack[]> => {
    try {
      const r = await fetch('/api/overseas/studio/bgm', { headers: authHeader() });
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      return Array.isArray(data) ? (data as BgmTrack[]) : [];
    } catch {
      return [];
    }
  },
  uploadBgm: (b: { name: string; mood?: string; duration?: number; dataBase64: string; mimeType?: string }) =>
    post<{ ok: boolean; track: BgmTrack }>('bgm', b, { ok: false, track: null as unknown as BgmTrack }),
  deleteBgm: (id: string) => del(`bgm/${id}`),
};

export interface BgmTrack {
  id: string;
  name: string;
  mood: string;
  duration: number;
  url: string;
  recommended?: boolean;
  builtin?: boolean;
  scope?: 'shared' | 'tenant';
  uploadedBy?: string;
}

// 封面标题样式（同时驱动网页预览与服务端 SVG 生成）
export type CoverFont = 'sans' | 'impact' | 'serif' | 'rounded' | 'mono';
export interface CoverStyle {
  color: string;                        // 标题颜色 hex
  size: 'S' | 'M' | 'L';                // 字号档位
  position: 'top' | 'center' | 'bottom';// 垂直位置
  verticalPosition?: number;             // 标题中心纵坐标（0-100%），拖动时精确定位
  align: 'left' | 'center';             // 水平对齐
  font: CoverFont;                      // 字体（系统字体栈，预览与 SVG 一致）
  weight?: 'regular' | 'bold' | 'heavy';// 粗细档位（缺省 bold）
  fontFamily?: string;                  // 自定义导入字体的 family（覆盖 font 字体栈）
  artPreset?: 'clean' | 'outline' | 'highlight' | 'magazine' | 'neon' | 'sticker'; // 艺术字效果
}

export interface Material {
  transcript?: string;
  transcriptCues?: SubCue[];
  id: string;
  name: string;
  folder: string;
  type: 'video' | 'image' | 'audio';
  duration: number;
  width?: number;
  height?: number;
  aspectRatio?: number;
  size: string;
  file: string;
  url: string;
  poster?: string;
  scope?: 'shared' | 'own';
  usage?: 'editable' | 'reference_only';
  canManage?: boolean;
  sourceType?: string;
  sourceUrl?: string;
  pinned?: boolean;
  industry?: string;
  shotFunction?: string;
  applicability?: string;
  tags?: string;
  productId?: string;
  productName?: string;
  segmentAnalysisStatus?: 'pending' | 'analyzing' | 'completed' | 'failed';
  segmentAnalysisError?: string;
  segments?: MaterialSegment[];
  visualObservations?: string[];
  createdAt: string;
}

export interface VideoGenerationVersion {
  id: string;
  groupKey: string;
  versionNumber: number;
  parentVersionId?: string;
  materialId?: string;
  taskId?: string;
  title: string;
  url?: string;
  poster?: string;
  duration: number;
  source: string;
  model?: string;
  promptSnapshot: { script: string; productInfo: string; language: string; ratio: string; resolution: string };
  context?: Record<string, unknown>;
  isSelected: boolean;
  createdAt: string;
}

export interface MaterialSegment {
  id: string;
  start: number;
  end: number;
  duration: number;
  poster?: string;
  subject: string[];
  action: string;
  productVisible: boolean;
  productClarity: 'none' | 'low' | 'medium' | 'high';
  shot: string;
  angle: string;
  composition: string;
  camera: string;
  environment: string;
  quality: number;
  ocrText: string;
  hasPerson: boolean;
  hasLogo: boolean;
  logoText: string[];
  recommendedFunctions: string[];
  authenticity: string;
  confidence: number;
  needsReview: boolean;
  manualConfirmed?: boolean;
}

export interface DigitalHumanCapabilities {
  available: boolean;
  provider: string;
  features?: Array<'lip_sync' | 'expression' | 'head_motion' | 'source_motion' | 'neck_shoulder_preservation'>;
  modes: Array<{ id: 'fast' | 'quality'; label: string }>;
  output: { ratio: '9:16'; container: 'mp4' };
  qualityGateRequired: boolean;
  maxConcurrentJobs: number;
  unavailableReason?: string;
}

export interface DigitalHumanQualityReport {
  passed: boolean;
  lipSyncScore?: number;
  avOffsetFrames?: number;
  identityScore?: number;
  freezeSegments?: number;
  durationSeconds?: number;
  faceDetectionRate?: number;
  mouthJumpP95?: number;
  gateVersion?: string;
  gateFailures?: string[];
  notes?: string[];
}

export type TransformationMode = 'talking_avatar' | 'face_swap' | 'head_swap' | 'person_replace' | 'product_replace' | 'structure_remake';
export interface TransformationAssessmentInput {
  mode: TransformationMode;
  rights: {
    referenceVideo: 'cleared' | 'unknown' | 'not_required';
    sourcePerson: 'cleared' | 'unknown' | 'not_required';
    targetPerson: 'cleared' | 'unknown' | 'not_required';
    voice: 'cleared' | 'unknown' | 'not_required';
    productBrand: 'cleared' | 'unknown' | 'not_required';
  };
  source: {
    personCount?: number; continuousShot?: boolean; durationSeconds?: number; faceForwardRatio?: number;
    maximumOcclusionRatio?: number; productVisibleRatio?: number; productCount?: number;
    productCategory?: string; targetProductCategory?: string; gripSimilarity?: number; transparentOrReflective?: boolean;
  };
}
export interface TransformationAssessment {
  status: 'compatible' | 'review' | 'blocked';
  blockers: string[];
  warnings: string[];
  requiredQa: string[];
  recommendedMode: TransformationMode;
}

export interface DigitalHumanJob {
  voiceoverUrl: string;
  subtitleCues?: Array<{ start: number; end: number; text: string }>;
  id: string;
  projectId?: string;
  avatarMaterialId: string;
  avatarName: string;
  scriptSnapshot: string;
  language: string;
  mode: 'fast' | 'quality';
  provider: string;
  status: 'queued' | 'submitting' | 'processing' | 'quality_check' | 'review' | 'completed' | 'failed' | 'cancelled';
  stage: string;
  progress: number;
  outputMaterialId?: string;
  outputUrl?: string;
  qualityReport?: DigitalHumanQualityReport;
  errorCode?: string;
  errorMessage?: string;
  versionNumber: number;
  parentJobId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export type MaterialLibraryState = { items?: Material[]; status: 'ready' | 'partial' | 'unavailable'; sources: Array<{ source: string; state: string; message: string }> };
let latestMaterialLibraryState: MaterialLibraryState | null = null;
export const getMaterialLibraryState = () => latestMaterialLibraryState;
function publishMaterialLibraryState(state: MaterialLibraryState) { latestMaterialLibraryState = state; window.dispatchEvent(new CustomEvent('lingshu:material-library-status', { detail: state })); }
export async function fetchMaterialLibrary(): Promise<MaterialLibraryState & { items: Material[] }> {
  try {
    const response = await fetch('/api/overseas/studio/materials?envelope=1', { headers: authHeader(), cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (response.status === 401) throw Error('登录已失效，请重新登录后读取素材');
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.items)) throw Error(data.error || '素材库暂时无法读取，请重试');
    publishMaterialLibraryState(data);
    return data;
  } catch (error) {
    const message = error instanceof Error ? error.message : '素材库读取失败';
    publishMaterialLibraryState({ status: 'unavailable', sources: [{ source: 'server', state: 'unavailable', message: /timeout|abort|fetch|network/i.test(message) ? '素材库连接中断或超时，请重试' : message }] });
    throw error;
  }
}

/** Wait only for explicitly selected assets; server deduplicates repeated requests. */
export async function ensureMaterialAnalysis(ids: string[], isCurrent: () => boolean, progress: (message: string) => void): Promise<Material[]> {
  for (const id of [...new Set(ids)]) {
    if (!isCurrent()) throw Error('本次生成已取消');
    const result = await studioApi.startMaterialAnalysis(id);
    if (!result.ok) throw Error(result.error || '素材分析无法启动');
  }
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    if (!isCurrent()) throw Error('本次生成已取消');
    const inventory = await fetchMaterialLibrary();
    const records = ids.map(id => inventory.items.find(item => item.id === id));
    if (records.some(item => !item)) throw Error('所选素材暂不可读取，请检查素材库连接');
    const failed = records.find(item => item?.segmentAnalysisStatus === 'failed');
    if (failed) throw Error(`「${failed.name}」分析失败：${failed.segmentAnalysisError || '请在素材库重试分析'}`);
    const completed = records.filter(item => item?.segmentAnalysisStatus === 'completed').length;
    progress(`正在分析所选素材 ${completed}/${ids.length}，完成后生成分镜…`);
    if (completed === ids.length) {
      const unconfirmed = records.find(item => item?.type === 'video' && !item.segments?.some(segment => !segment.needsReview && Number(segment.confidence) >= .65));
      if (unconfirmed) throw Error(`「${unconfirmed.name}」暂没有可信的可用片段，请在素材库查看分析结果并复核`);
      return records as Material[];
    }
    await new Promise(resolve => window.setTimeout(resolve, 3000));
  }
  throw Error('素材分析仍在后台进行，请稍后从素材库查看进度，再继续生成');
}
