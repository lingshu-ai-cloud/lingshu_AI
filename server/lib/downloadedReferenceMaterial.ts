import type { Platform } from '../types/index.js';

export interface DownloadedReferenceMaterialInput {
  id: string;
  tenantId: string;
  name: string;
  platform: Platform;
  sourceUrl: string;
  duration: number;
  size: string;
  file: string;
  poster?: string;
  contentSha256: string;
  createdAt: string;
}

/** A downloaded competitor video is evidence for analysis, never a licensed editing asset. */
export function buildDownloadedReferenceMaterial(input: DownloadedReferenceMaterialInput) {
  return {
    id: input.id,
    tenantId: input.tenantId,
    name: input.name,
    folder: 'hot',
    type: 'video' as const,
    duration: input.duration,
    size: input.size,
    file: input.file,
    url: `/media/${input.file}`,
    poster: input.poster ? `/media/${input.poster}` : undefined,
    contentSha256: input.contentSha256,
    scope: 'own' as const,
    usage: 'reference_only' as const,
    sourceType: input.platform,
    sourceUrl: input.sourceUrl,
    rightsReviewStatus: 'pending_human_review' as const,
    rightsReviewRationale: '外部公开视频只允许分析；尚无原作者媒体的商用、改编和素材库再分发授权。',
    commercialUseApproved: false,
    derivativesApproved: false,
    rawLibraryUseApproved: false,
    mayAnalyze: true,
    mayUseInProduction: false,
    provenance: {
      source: `${input.platform}_public_video`,
      sourceUrl: input.sourceUrl,
      downloadedForAnalysisOnly: true,
      downloadedAt: input.createdAt,
    },
    createdAt: input.createdAt,
  };
}
