export const RENDER_AI_DISCLOSURE_PIPELINE_VERSION = 'render-ai-disclosure-v1' as const;
export const RENDER_AI_DISCLOSURE_LABEL = 'AI生成 · 非真人代言' as const;
export const RENDER_AI_DISCLOSURE_PROVIDER = 'lingshu-digital-human' as const;

export interface RenderTimelineProvenance {
  digitalHumanGenerated?: boolean;
  sourceType?: string;
  assetRole?: 'avatar_master' | 'avatar_motion_clip' | 'generated_clip' | 'reference_clip';
  folder?: string;
}

export interface RenderAiDisclosure {
  schemaVersion: typeof RENDER_AI_DISCLOSURE_PIPELINE_VERSION;
  required: true;
  label: typeof RENDER_AI_DISCLOSURE_LABEL;
  containsDigitalHuman: true;
  contentId: string;
  provider: typeof RENDER_AI_DISCLOSURE_PROVIDER;
}

/**
 * Only the final output of the digital-human pipeline triggers disclosure.
 * Generic AI-assisted scripts, covers and ordinary generated B-roll must not be
 * mislabeled as digital-human video.
 */
export function isDigitalHumanGeneratedTimelineItem(item: RenderTimelineProvenance | null | undefined): boolean {
  if (!item) return false;
  return item.digitalHumanGenerated === true
    || item.sourceType === 'digital-human'
    || item.assetRole === 'generated_clip';
}

export function buildRenderAiDisclosure(
  jobId: string,
  timeline: Array<RenderTimelineProvenance | null | undefined>,
): RenderAiDisclosure | undefined {
  if (!timeline.some(isDigitalHumanGeneratedTimelineItem)) return undefined;
  return {
    schemaVersion: RENDER_AI_DISCLOSURE_PIPELINE_VERSION,
    required: true,
    label: RENDER_AI_DISCLOSURE_LABEL,
    containsDigitalHuman: true,
    contentId: `lingshu-render:${String(jobId || 'unknown').trim() || 'unknown'}`,
    provider: RENDER_AI_DISCLOSURE_PROVIDER,
  };
}
