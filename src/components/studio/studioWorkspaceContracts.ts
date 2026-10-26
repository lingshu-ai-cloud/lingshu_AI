import type { ProductPlacementOverride } from '../../lib/storyboardPlacement';
import type { LayoutGrid, Film } from 'lucide-react';
import type { StudioProject, CoverStyle, TtsStyleOptions, StoryboardQualityResult, StudioScriptQualityStatus, StudioScriptQualityChecks, StudioGenerationProvenance } from '../../lib/studioApi';
import type { StoryboardTopic } from '../../lib/storyboardTopic';
import type { FreeCreationShotType } from '../../../shared/contracts/freeCreationProject';

export type StepId = 'mode' | 'material' | 'script' | 'bgm' | 'cover' | 'preview' | 'poster';

export type StudioStage = {
  id: 'setup' | 'storyboard' | 'deliver';
  label: string;
  icon: typeof LayoutGrid;
  hint: string;
  steps: StepId[];
};

export type VideoThemeId = 'buyer_pain' | 'product_proof' | 'use_case' | 'supplier_capability' | 'customization' | 'comparison' | 'customer_case' | 'trend';

export type PresenterMode = 'real' | 'digital';

export type VideoTheme = {
  id: VideoThemeId;
  title: string;
  description: string;
  /** Legacy metadata; no longer displayed or used to decide CTA. */
  painPoint: string;
  conversionGoal: string;
  requires: Array<'product' | 'material' | 'factory' | 'comparison' | 'case' | 'trend'>;
};

export interface CanvaCoverReturnState {
  at: number;
  stepId: StepId;
  projectId: string | null;
  projectTitle: string;
  coverUrl: string | null;
  spec: Record<string, unknown>;
}

export interface CoverVersionConfig {
  coverId: string;
  title: string;
  style: CoverStyle;
  coverUrl?: string | null;
}

export interface MaterialFolder { id: string; name: string; count: number }

export interface ClipEdit {
  segmentId?: string;
  trimStart: number;
  trimEnd: number;
  trimRangeEdited?: boolean;
  speed: number;
  targetDuration?: number;
  targetDurationEdited?: boolean;
  transition: string;
  note: string;
  cropMode?: 'cover' | 'contain';
  focusX?: number;
  focusY?: number;
  cleanedConfirmed?: boolean;
}

export type StoryboardSourceMode = 'auto' | 'online' | 'local' | 'ai' | 'hybrid';

export type VariationStrategy = 'remix' | 'recreate' | 'hybrid';

export interface StoryboardSourcePlan {
  mode: StoryboardSourceMode;
  decided?: boolean;
  userSource?: 'material' | 'avatar' | 'shoot';
  confirmed: boolean;
  critical: boolean;
  referenceClipId?: string;
  generatedClipId?: string;
  firstFrameMaterialId?: string;
  firstFrameUrl?: string;
  firstFrameConfirmed?: boolean;
  firstFrameFingerprint?: string;
  firstFrameRequestId?: string;
  videoRequestId?: string;
  actionVideoRequestId?: string;
  firstFrameQuality?: StoryboardQualityResult;
  firstFrameIdentityNotice?: string;
  videoResolution?: '480p' | '720p';
  videoResolutionPinned?: boolean;
  sceneType?: 'product' | 'factory' | 'usage' | 'general';
  shotTopic?: StoryboardTopic;
  /** Canonical free-creation classification persisted for downstream rendering. */
  shotType?: FreeCreationShotType;
  productIds?: string[];
  characterMaterialId?: string;
  characterReferenceManual?: boolean;
  characterReferenceDisabled?: boolean;
  environmentMaterialId?: string;
  environmentReferenceManual?: boolean;
  environmentReferenceDisabled?: boolean;
  placementOverride?: ProductPlacementOverride;
  placementPreset?: 'left' | 'center' | 'right' | 'custom';
  actionStartState?: string;
  actionBeats?: string;
  actionEndState?: string;
  actionKeyStates?: string;
  error?: string;
  quality?: StoryboardQualityResult;
  qualityError?: string;
  matchScore?: number;
  matchReason?: string;
  matchDifference?: string;
  matchLevel?: 'direct' | 'review' | 'missing';
}

export interface StoryboardAssembly {
  id: string;
  name: string;
  assignments: Record<string, string>;
  sourcePlans: Record<string, StoryboardSourcePlan>;
  selected: string[];
}

export type StudioPublishPlatform = 'youtube' | 'tiktok' | 'instagram' | 'facebook';

export type StudioPublishItem = {
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

export type StudioPublishPayload = StudioPublishItem & { items?: StudioPublishItem[] };

export type ProjectQualityRecord = {
  id: string; inputFingerprint: string; generationProvenance: 'ai'; qualityStatus: 'passed'; publishable: true;
  createdAt: string; renderPath: string; report: { gateVersion: string; checks: Array<{ id: string; passed: true; detail: string }> };
};

export type LanguageRenderOutput = {
  status: 'pending' | 'rendering' | 'done' | 'failed';
  path?: string;
  previewUrl?: string;
  error?: string;
  inputSignature?: string;
};

export type LanguageRenderGeneration = {
  id: string;
  versionNumber: number;
  status: 'done' | 'failed';
  path?: string;
  previewUrl?: string;
  error?: string;
  inputSignature?: string;
  createdAt: string;
};

export interface Bgm { id: string; name: string; mood: string; duration: number; url?: string; recommended?: boolean; scope?: 'shared' | 'tenant'; uploadedBy?: string }

export interface Voice { id: string; name: string; tag: string }

export type LanguageTtsSettings = {
  voiceId?: string;
  volume?: number;
  preset: TtsStyleOptions['preset'];
  emotion: string;
  emotionIntensity: number;
  speed: number;
  pauseStyle: 'few' | 'natural' | 'dramatic';
  pronunciationText: string;
};

export interface SocialAccount { id: string; platform: string; handle: string; color: string }

export type ModeCard = { id: 'material' | 'clone' | 'product'; icon: typeof Film; title: string; desc: string };

export type StudioScriptGenerationValidation = {
  ok: boolean;
  code?: 'language_required' | 'product_required' | 'material_required' | 'reference_required' | 'duration_invalid';
  message?: string;
};

export interface EnterpriseProfileLite {
  company?: { industry?: string; mainMarkets?: string; primaryLanguages?: string };
  products?: {
    categories?: string;
    priceRange?: string;
    moq?: string;
    certifications?: string;
    highlights?: string;
    items?: Array<{
      id?: string;
      productId?: string;
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
  brand?: { name?: string; tone?: string; usp?: string; preferredLanguages?: string };
  strategy?: { focusProducts?: string; focusMarkets?: string };
  customers?: { targetProfiles?: string };
  socialStrategy?: { enabledRoutes?: Array<'oem_odm' | 'wholesale_distribution' | 'consumer_retail'>; routeStrategies?: Record<string, { targetBuyerRoles?: string[]; primaryCta?: string }> };
}

export type ReferenceVoiceStrength = 'light' | 'balanced' | 'strong';

export interface ExistingSourceDraftPrompt {
  project: StudioProject;
  matchCount: number;
  title: string;
  poster: string;
}

export interface ProductOption {
  id: string;
  /** Persisted enterprise product identity; absent for unlinked kickoff or legacy text products. */
  catalogProductId?: string;
  label: string;
  info: string;
  imageUrls?: string[];
}

export interface ModeScriptOutput {
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

export type EnterpriseProductItem = NonNullable<NonNullable<EnterpriseProfileLite['products']>['items']>[number];
