import {
  DIGITAL_HUMAN_PIPELINE_VERSION,
  parseDigitalHumanPipelineVersion,
} from '../../src/lib/digitalHumanPipeline.js';

export interface DigitalHumanPayloadMotionClip {
  id: string;
  videoUrl: string;
  beatIds?: string[];
}

export interface DigitalHumanPayloadJob {
  id: string;
  provider: string;
  mode: 'fast' | 'quality';
  scriptSnapshot: string;
  language: string;
  usagePurpose: 'internal_preview' | 'customer_delivery' | 'paid_media' | 'organic_social';
  performancePlanVersion?: 'performance-v1';
  performancePlan?: Record<string, unknown>;
  motionClipIds?: string[];
  pipelineVersion?: string;
  storyboardSlotId?: string;
  audioStartSeconds?: number;
  audioEndSeconds?: number;
  inputSignature?: string;
}

export interface DigitalHumanProviderJobPayload {
  externalJobId: string;
  provider: string;
  avatarVideoUrl: string;
  audioUrl: string;
  script: string;
  language: string;
  usagePurpose: 'internal_preview' | 'customer_delivery' | 'paid_media' | 'organic_social';
  mode: 'fast' | 'quality';
  performancePlanVersion?: 'performance-v1';
  performancePlan?: Record<string, unknown>;
  motionClipIds?: string[];
  motionClips: DigitalHumanPayloadMotionClip[];
  pipelineVersion?: string;
  storyboardSlotId?: string;
  audioSegment?: { startSeconds?: number; endSeconds?: number };
  inputSignature?: string;
  output: { ratio: '9:16'; container: 'mp4' };
}

export function buildDigitalHumanProviderJobPayload(
  job: DigitalHumanPayloadJob,
  assets: { avatarVideoUrl: string; audioUrl: string; motionClips: DigitalHumanPayloadMotionClip[] },
): DigitalHumanProviderJobPayload {
  const motionClipIds = Array.isArray(job.motionClipIds) ? job.motionClipIds.map(String) : [];
  if (!assets.avatarVideoUrl || !assets.audioUrl) throw new Error('digital human input URLs are required');
  if (motionClipIds.length !== assets.motionClips.length) throw new Error('digital human motion clips do not match requested IDs');
  if (assets.motionClips.some(item => !item.id || !item.videoUrl)) throw new Error('digital human motion clip payload is incomplete');
  const pipelineVersion = parseDigitalHumanPipelineVersion(job.pipelineVersion);
  if (!pipelineVersion) throw new Error(`unsupported digital human pipeline version; expected ${DIGITAL_HUMAN_PIPELINE_VERSION}`);

  return {
    externalJobId: job.id,
    provider: job.provider,
    avatarVideoUrl: assets.avatarVideoUrl,
    audioUrl: assets.audioUrl,
    script: job.scriptSnapshot,
    language: job.language,
    usagePurpose: job.usagePurpose,
    mode: job.mode,
    performancePlanVersion: job.performancePlanVersion,
    performancePlan: job.performancePlan,
    motionClipIds: motionClipIds.length ? motionClipIds : undefined,
    motionClips: assets.motionClips,
    pipelineVersion,
    ...(job.storyboardSlotId ? {
      storyboardSlotId: job.storyboardSlotId,
      audioSegment: { startSeconds: job.audioStartSeconds, endSeconds: job.audioEndSeconds },
      inputSignature: job.inputSignature,
    } : {}),
    output: { ratio: '9:16', container: 'mp4' },
  };
}
