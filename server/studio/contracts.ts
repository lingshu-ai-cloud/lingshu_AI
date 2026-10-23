import type { RenderSpec } from '../routes/studioRenderManifestProjection.js';

export type StudioRenderJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface StoredStudioRenderJob {
  id: string; tenant_id: string; project_id: string; idempotency_key: string;
  output_key: string; input_signature: string; status: StudioRenderJobStatus;
  spec: RenderSpec; progress: number; attempts: number; output_path?: string;
  preview_url?: string; error?: string; created_at: string; updated_at: string;
}

export interface VideoGenerationVersion {
  id: string;
  tenantId: string;
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
  promptSnapshot: {
    script: string;
    productInfo: string;
    language: string;
    ratio: string;
    resolution: string;
    firstFrameMaterialId?: string;
  };
  context?: Record<string, unknown>;
  isSelected: boolean;
  createdAt: string;
}

export type DigitalHumanJobStatus = 'queued' | 'submitting' | 'processing' | 'quality_check' | 'review' | 'completed' | 'failed' | 'cancelled';

export type DigitalHumanMode = 'fast' | 'quality';

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

export interface DigitalHumanJob {
  subtitleCues?: Array<{ start: number; end: number; text: string }>;
  id: string;
  tenantId: string;
  projectId?: string;
  heygenAvatarId?: string;
  avatarMaterialId: string;
  avatarName: string;
  voiceoverUrl: string;
  scriptSnapshot: string;
  language: string;
  mode: DigitalHumanMode;
  consentConfirmed: boolean;
  commercialRightsStatus: 'cleared';
  provider: string;
  providerTaskId?: string;
  status: DigitalHumanJobStatus;
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

export type PosterReferenceRole = 'exact_product' | 'style' | 'supporting';

export type PosterReferenceDescriptor = { materialId: string; role: PosterReferenceRole; productId: string | null };
