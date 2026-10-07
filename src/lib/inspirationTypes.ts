import type { Material, MaterialSegment } from './studioApi';
import type { SocialBusinessModel, SocialDiscoveryCandidateScore } from '../../shared/contracts/socialContentWorkflow';
export type Platform = 'all' | 'tiktok' | 'instagram' | 'youtube' | 'facebook';
export type ScriptResultProvenance = 'ai' | 'ai_rejected' | 'template';
export type ContentFormat = 'video' | 'image';

export interface TrendVideo {
  id: string;
  recordId?: string;
  platform: Exclude<Platform, 'all'>;
  title: string;
  thumbnail: string;
  duration: number;
  tags: string[];
  views: string;
  trend: 'hot' | 'rising' | 'stable';
  videoUrl?: string;  // 真实视频（有则卡片直接播放）
  sourceUrl?: string; // 外部平台原始链接（如 YouTube watch URL）
  status?: 'pending' | 'analyzed' | 'failed';
  aiAnalysis?: VideoAnalysisPayload;
  crawledAt?: string;
  contentFormat: ContentFormat;
  canManage?: boolean;
}

export interface GeminiVideoAnalysis {
  audioTranscript?: { text: string; segments: Array<{ start: number; end: number; text: string; timingPrecision: 'phrase' | 'coarse'; needsReview?: boolean }> };
  theme?: string;
  hooks?: string[];
  sellingPoints?: string[];
  mood?: string;
  structure?: string;
  baseRequirements?: string;
  globalSettings?: { visualStyle?: string; aspectRatio?: string; lighting?: string; subtitlePolicy?: string; audioPolicy?: string; identityConsistency?: string; productConsistency?: string; negativeConstraints?: string[] };
  spatialContinuity?: { scene?: string; subjectAnchors?: Array<{ subject?: string; position?: string; facing?: string; gazeTarget?: string; orientation?: string }>; background?: string; backgroundPriority?: 'low' | 'medium' | 'high'; depthOfField?: 'shallow' | 'moderate' | 'deep' };
  firstTenSeconds?: {
    atmosphere?: string;
    audioVisual?: string;
    camera?: string;
    visuals?: string;
    voiceMusic?: string;
  };
  coarseStructure?: Array<{
    time?: string;
    frame?: string;
    label?: string;
    description?: string;
    desc?: string;
  }>;
  scriptSummary15s?: {
    visualStyle?: string;
    coreEmotion?: string;
    competitors?: string[];
  };
  scriptDetails15s?: Array<{
    materialType?: import('../../shared/benchmarkAnalysis').BenchmarkMaterialType;
    narrativeRole?: import('../../shared/benchmarkAnalysis').BenchmarkShotRole;
    classificationEvidence?: string;
    time?: string;
    timestamp?: string;
    environment?: string;
    shot?: string;
    camera?: string;
    angle?: string;
    composition?: string;
    visual?: string;
    subtitle?: string;
    audio?: string;
    note?: string;
    purpose?: string; dialogue?: string; onScreenText?: string; ambientSound?: string; bgm?: string;
    soundEffects?: string[]; beats?: Array<{ time?: string; action?: string; dialogue?: string; onScreenText?: string }>;
    persistentState?: string; startState?: string; endState?: string; transitionToNext?: string;
    backgroundPriority?: 'low' | 'medium' | 'high'; depthOfField?: 'shallow' | 'moderate' | 'deep';
    authenticity?: string; estimatedSpeechDuration?: number; dialogueFits?: boolean; confidence?: number; needsReview?: boolean;
    materialEvidence?: { sourceVideoRef?: string; clipRef?: string | null; firstFrameRef?: string | null; firstFrameSeconds?: number; extractionStatus?: 'ready' | 'unavailable' };
    viralPotential?: { score?: number; mechanisms?: string[]; whyEffective?: string };
  }>;
  recommendedScriptType?: 'voiceover' | 'storyboard';
}

export interface VideoAnalysisPayload {
  benchmarkAnalysis?: import('../../shared/benchmarkAnalysis').BenchmarkAnalysis;
  usage?: 'editable' | 'reference_only';
  contentSha256?: string;
  userVisible?: boolean;
  source?: string;
  contentFormat?: ContentFormat;
  views?: string;
  keyword?: string;
  crawlRule?: string;
  sourceAccount?: string;
  sourceAccountName?: string;
  followerCount?: number;
  accountBaselineLevel?: 'low' | 'medium' | 'high';
  relativeViewMultiple?: number;
  dateFrom?: string;
  dateTo?: string;
  materialUrl?: string;
  materialPoster?: string;
  materialId?: string;
  downloadStatus?: string;
  videoFetchStatus?: string;
  geminiStatus?: string;
  downloadError?: string;
  analysisSource?: string;
  analysisQuality?: string;
  analysisReviewReasons?: string[];
  analysisMode?: 'strategy' | 'exact';
  requestedAnalysisMode?: 'strategy' | 'exact';
  analysisError?: string;
  videoLevelFailureStatus?: string;
  manualRequiredReason?: string;
  videoStorage?: string;
  analyzedAt?: string;
  caption?: string;
  imageUrls?: string[];
  imageCount?: number;
  imageEvidence?: {
    version: 2;
    status: 'analyzed';
    observedFacts: Array<{ imageIndex: number; subjects: string[]; scene: string; composition: string; colors: string[]; visibleText: string[]; confidence: number }>;
    carouselFlow: Array<{ imageIndex: number; role: 'attention' | 'product' | 'detail' | 'proof' | 'process' | 'cta' | 'unknown'; evidence: string; confidence: number }>;
    copyEvidence: { hooks: Array<{ text: string; source: 'caption' | 'ocr'; evidence: string }>; sellingPoints: Array<{ text: string; source: 'caption' | 'ocr'; evidence: string }>; cta: string[] };
    reusableModules: Array<{ module: string; evidence: string; preserve: string; replace: string; confidence: number }>;
    uncertainties: string[];
  };
  imageAnalysisStatus?: 'analyzed' | 'failed';
  imageAnalysisError?: string;
  publicMetrics?: { likes?: string; comments?: string; shares?: string; plays?: string; followers?: number; observedAt?: string };
  publicBaseline?: { sampleSize: number; medianWeightedEngagement: number | null; currentWeightedEngagement: number | null; relativeMultiple: number | null; status: 'usable' | 'insufficient_sample'; method: string };
  candidateEvidence?: {
    relevance?: { level?: 'high' | 'medium' | 'low'; reasons?: string[] };
    momentum?: { level?: 'rising' | 'high_performance' | 'unknown'; reasons?: string[]; confidence?: number };
    transferability?: { level?: 'high' | 'medium' | 'low'; mechanisms?: string[]; limitations?: string[] };
  };
  /** Authoritative server score; the client must not recompute filter decisions. */
  discoveryScore?: SocialDiscoveryCandidateScore;
  discoveryBusinessModel?: SocialBusinessModel;
  discoveryOrigins?: Array<{ runId: string; scopeId: string; scopeVersion: number; mode: 'momentum' | 'account' | 'innovation'; queryRef: string; observedAt: string }>;
  publicAdSignals?: { isAd?: boolean; isPaidPartnership?: boolean };
  author?: string;
  crawlerOpsTaskId?: string;
  crawlerOpsStatus?: string;
  crawlerOpsReason?: string;
  crawlerOpsLastError?: string;
  gemini?: GeminiVideoAnalysis;
}

export interface AccountSpecialRecommendation {
  level: '极高' | '高' | '较高';
  baseline: '低基线账号' | '中基线账号' | '高基线账号';
  multiple: number;
  message: string;
}

export interface StructureStep { time: string; label: string; desc: string }
export interface FirstTenSecondInsight { dimension: string; detail: string }
export interface ScriptDetail15s { materialType?: import('../../shared/benchmarkAnalysis').BenchmarkMaterialType; narrativeRole?: import('../../shared/benchmarkAnalysis').BenchmarkShotRole; classificationEvidence?: string; time: string; environment: string; shot: string; camera: string; angle?: string; composition?: string; visual: string; subtitle: string; audio: string; note?: string; purpose?: string; dialogue?: string; onScreenText?: string; ambientSound?: string; bgm?: string; soundEffects?: string[]; beats?: Array<{ time?: string; action?: string; dialogue?: string; onScreenText?: string }>; persistentState?: string; startState?: string; endState?: string; transitionToNext?: string; backgroundPriority?: 'low' | 'medium' | 'high'; depthOfField?: 'shallow' | 'moderate' | 'deep'; authenticity?: string; estimatedSpeechDuration?: number; dialogueFits?: boolean; confidence?: number; needsReview?: boolean; materialEvidence?: { sourceVideoRef?: string; clipRef?: string | null; firstFrameRef?: string | null; firstFrameSeconds?: number; extractionStatus?: 'ready' | 'unavailable' }; viralPotential?: { score?: number; mechanisms?: string[]; whyEffective?: string } }
export interface ScriptSummary15s { visualStyle: string; coreEmotion: string; competitors: string[] }
export interface ScriptAnalysis {
  videoType: string;
  structure: StructureStep[];
  firstTenSeconds: FirstTenSecondInsight[];
  scriptSummary15s: ScriptSummary15s;
  scriptDetails15s: ScriptDetail15s[];
  baseRequirements: string;
  referenceHighlights: string[];
  adaptTip: string;
  emotion: string;
  infoSpeed: string;
}

export interface FrameMaterialMatch {
  detail: ScriptDetail15s;
  material?: Material;
  segment?: MaterialSegment;
  score: number;
  scores?: {
    function: number;
    action: number;
    subject: number;
    composition: number;
    camera: number;
    duration: number;
    quality: number;
    enterpriseFit: number;
  };
  trim?: {
    start: number;
    end: number;
    label: string;
  };
  reason: string;
  risks: string[];
  suggestion: string;
  status: 'high' | 'review' | 'adapt' | 'missing' | 'pending_analysis';
  viralDna: {
    purpose: string;
    mustPreserve: string[];
    replaceable: string[];
    authenticityRequired: boolean;
  };
  viralPotential: {
    score: number;
    whyEffective: string;
    mechanisms: string[];
  };
  replicability: {
    score: number;
    localCoverage: number;
    aiFeasibility: 'high' | 'medium' | 'low';
    recommendedExecution: 'local' | 'local_plus_ai' | 'local_plus_reshoot' | 'ai' | 'reshoot' | 'drop';
    blockers: string[];
  };
  decision: 'copy_now' | 'prioritize_reshoot' | 'ai_generate' | 'supporting_only' | 'drop';
}

export interface ShootingNeed {
  id: string;
  /** Earliest source video's crawl time: when this derived need first appeared. */
  createdAt?: string;
  priority: '高' | '中' | '低';
  title: string;
  suggestion: string;
  count: number;
  sourceVideos: string[];
  platform: Exclude<Platform, 'all'>;
  ratio: '9:16' | '16:9';
  example?: ScriptDetail15s;
}

// ── Platform meta ─────────────────────────────────────────────────────────────
