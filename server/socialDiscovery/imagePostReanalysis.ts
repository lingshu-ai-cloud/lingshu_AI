import { createHash, randomUUID } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import type { VideoStatus } from '../types/index.js';
import type { ImagePostEvidenceAnalysis } from '../agents/qwenContracts.js';
import { serializeImagePostAnalysis, videoAnalysisOf } from '../lib/videoAnalysisCodec.js';
import type { CrawledImagePost } from './imagePostEvidenceAnalysis.js';
import type { PreviewAiAudit } from '../../scripts/customer-preview-ai-scope.mjs';

type EvidenceResult = {
  status: 'analyzed' | 'failed';
  analysis?: ImagePostEvidenceAnalysis;
  error?: string;
  provider?: 'qwen' | 'gemini';
  providerAttempted?: boolean;
  providerRejected?: boolean;
  providerAudit?: PreviewAiAudit[];
};

function tagsOf(value: unknown): string[] {
  try {
    const tags = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : [];
  } catch { return []; }
}

function mergeSelectedEvidence(previous: unknown, next: ImagePostEvidenceAnalysis, imageIndex: number): ImagePostEvidenceAnalysis {
  const old = previous as ImagePostEvidenceAnalysis | undefined;
  if (old?.version !== 2 || old.status !== 'analyzed') return next;
  const merge = <T extends { imageIndex: number }>(prior: T[] | undefined, current: T[] | undefined): T[] =>
    [...(Array.isArray(prior) ? prior.filter(item => item.imageIndex !== imageIndex) : []), ...(current || [])]
      .sort((a, b) => a.imageIndex - b.imageIndex);
  return { ...next, observedFacts: merge(old.observedFacts, next.observedFacts),
    carouselFlow: merge(old.carouselFlow, next.carouselFlow),
    productionLabels: merge(old.productionLabels, next.productionLabels),
    layerBlueprints: merge(old.layerBlueprints, next.layerBlueprints) };
}

export function imagePostSourceHash(record: Record<string, unknown>): string {
  const analysis = videoAnalysisOf(record);
  return createHash('sha256').update(JSON.stringify({
    tenantId: record.tenantId, id: record.id, sourceUrl: record.sourceUrl,
    thumbnailUrl: record.thumbnailUrl, caption: analysis.caption,
    imageUrls: analysis.imageUrls, imageObjectKeys: analysis.imageObjectKeys,
  })).digest('hex');
}

/** A visible attempt marker is durable before calling the existing analyzer. */
export async function reanalyzeStoredImagePost(input: {
  store: DataStore;
  collection: string;
  tenantId: string;
  record: Record<string, unknown>;
  analyze(item: CrawledImagePost, keyword: string): Promise<EvidenceResult>;
  imageIndex?: number;
  replacementAuthorization?: { expectedAttemptId: string; authorizedAt: string; reason: string };
}): Promise<EvidenceResult> {
  const { record } = input;
  const recordId = String(record.id || '');
  if (!recordId || record.tenantId !== input.tenantId) throw Error('image_post_tenant_mismatch');
  const current = videoAnalysisOf(record);
  if (current.contentFormat !== 'image' && record.contentFormat !== 'image') throw Error('image_post_format_mismatch');
  const imageCount = Array.isArray(current.imageUrls) ? current.imageUrls.length : 1;
  if (input.imageIndex !== undefined && (!Number.isInteger(input.imageIndex) || input.imageIndex < 1
    || input.imageIndex > Math.min(10, imageCount))) throw Error('image_post_analysis_selection_invalid');
  const replacement = input.replacementAuthorization;
  const authorizedReplacement = Boolean(replacement && current.imageAnalysisQueueState === 'unknown'
    && current.imageAnalysisAttemptId === replacement.expectedAttemptId && replacement.reason.trim()
    && Number.isFinite(Date.parse(replacement.authorizedAt)));
  if (replacement && !authorizedReplacement) throw Error('image_post_replacement_authorization_mismatch');
  if (['queued', 'processing', 'unknown'].includes(String(current.imageAnalysisQueueState || '')) && !authorizedReplacement) {
    throw Error('image_post_queue_requires_reconciliation');
  }
  if (current.imageAnalysisStatus === 'pending' && current.imageAnalysisAttemptId) {
    throw Error('image_post_analysis_attempt_requires_reconciliation');
  }
  const initialSourceHash = imagePostSourceHash(record);
  const item: CrawledImagePost = {
    tenantId: input.tenantId,
    platform: String(record.platform || 'instagram') as CrawledImagePost['platform'],
    title: String(record.title || ''), sourceUrl: String(record.sourceUrl || ''),
    thumbnailUrl: String(record.thumbnailUrl || ''),
    caption: String(current.caption || record.title || ''),
    imageUrls: Array.isArray(current.imageUrls) ? current.imageUrls.map(String) : [String(record.thumbnailUrl || '')],
    analysisImageIndex: input.imageIndex,
    views: String(current.views || ''), tags: tagsOf(record.tags),
    uploadedAt: String(current.uploadedAt || ''), author: String(current.author || ''),
  };
  const attemptId = randomUUID();
  if (!await input.store.update(input.collection, recordId, {
    status: 'pending' as VideoStatus,
    aiAnalysis: serializeImagePostAnalysis({ ...current,
      imageAnalysisStatus: 'pending', imageAnalysisAttemptId: attemptId,
      imageAnalysisQueueState: 'processing',
      imageAnalysisStartedAt: new Date().toISOString(), imageAnalysisError: undefined,
      ...(current.imageAnalysisAttemptId ? { imageAnalysisPriorAttempts: [
        ...(Array.isArray(current.imageAnalysisPriorAttempts) ? current.imageAnalysisPriorAttempts : []),
        { attemptId: current.imageAnalysisAttemptId, status: current.imageAnalysisStatus,
          queueState: current.imageAnalysisQueueState, startedAt: current.imageAnalysisStartedAt,
          error: current.imageAnalysisError, providerAudit: current.imageAnalysisProviderAudit,
          ...(authorizedReplacement ? { replacementAuthorization: replacement } : {}),
          supersededAt: new Date().toISOString() },
      ] } : {}),
    }),
  })) throw Error('image_post_analysis_attempt_persistence_failed');
  const output = await input.analyze(item, String(current.keyword || ''));
  const latest = await input.store.getById<Record<string, unknown>>(input.collection, recordId);
  if (!latest || latest.tenantId !== input.tenantId) throw Error('image_post_record_disappeared_after_analysis');
  const latestAnalysis = videoAnalysisOf(latest);
  if (latestAnalysis.imageAnalysisAttemptId !== attemptId) throw Error('image_post_analysis_superseded');
  if (imagePostSourceHash(latest) !== initialSourceHash) throw Error('image_post_analysis_source_changed');
  if (output.status === 'failed' && output.providerAttempted && !output.providerRejected) {
    const unknown = serializeImagePostAnalysis({ ...latestAnalysis,
      imageAnalysisStatus: 'unknown', imageAnalysisQueueState: 'unknown', imageAnalysisError: output.error,
      imageAnalysisProviderAudit: output.providerAudit,
    });
    if (!await input.store.update(input.collection, recordId, { aiAnalysis: unknown, status: 'pending' as VideoStatus })) {
      throw Error('image_post_analysis_result_persistence_failed');
    }
    throw Error('image_post_analysis_provider_result_unknown');
  }
  const finalAnalysis = serializeImagePostAnalysis({ ...latestAnalysis,
    imageEvidence: output.analysis && input.imageIndex
      ? mergeSelectedEvidence(latestAnalysis.imageEvidence, output.analysis, input.imageIndex)
      : output.analysis || latestAnalysis.imageEvidence,
    imageAnalysisStatus: output.status,
    imageAnalysisQueueState: output.status === 'analyzed' ? 'completed' : 'failed',
    imageAnalysisError: output.error,
    imageAnalysisProviderAudit: output.providerAudit,
    analysisSource: output.status === 'analyzed' ? `${output.provider || 'qwen'}-image-evidence-v2` : 'image-metadata',
    analysisQuality: output.status === 'analyzed' ? 'image' : 'metadata',
    analyzedAt: new Date().toISOString(),
  });
  if (!await input.store.update(input.collection, recordId, {
    aiAnalysis: finalAnalysis, status: output.status as VideoStatus,
  })) throw Error('image_post_analysis_result_persistence_failed');
  return output;
}
