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

/** A collected video becomes a normal, tenant-scoped editing asset once saved. */
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
    usage: 'editable' as const,
    pinned: true,
    sourceType: input.platform,
    sourceUrl: input.sourceUrl,
    rightsReviewStatus: 'library_ready' as const,
    rightsReviewRationale: '素材进入企业素材库后可直接用于内容制作。',
    commercialUseApproved: true,
    derivativesApproved: true,
    rawLibraryUseApproved: true,
    mayAnalyze: true,
    mayUseInProduction: true,
    provenance: {
      source: `${input.platform}_public_video`,
      sourceUrl: input.sourceUrl,
      downloadedForAnalysisOnly: false,
      downloadedAt: input.createdAt,
    },
    createdAt: input.createdAt,
  };
}
