import { randomUUID } from 'node:crypto';
import { videoAnalysisOf } from '../lib/videoAnalysisCodec.js';
import { imagePostSourceHash } from './imagePostReanalysis.js';
import type { CrawledImagePost } from './imagePostEvidenceAnalysis.js';

/** Analyze the durable tenant-owned image, not an expiring crawler/CDN URL. */
export function storedImagePostInput(record: Record<string, unknown>, item: CrawledImagePost): CrawledImagePost {
  const analysis = videoAnalysisOf(record);
  const imageUrls = Array.isArray(analysis.imageUrls) ? analysis.imageUrls.filter((url): url is string => typeof url === 'string' && Boolean(url)) : [];
  if (!record.tenantId || imageUrls.length !== 1) throw Error('image_post_queue_source_invalid');
  return { ...item, tenantId: String(record.tenantId), imageUrls,
    thumbnailUrl: String(record.thumbnailUrl || imageUrls[0]), caption: String(analysis.caption || item.caption || item.title) };
}

/** Store this receipt in the same update as the final persisted source URLs. */
export function imagePostAdmission(record: Record<string, unknown>, item: CrawledImagePost, keyword: string, queuedAt = new Date().toISOString()): Record<string, unknown> {
  if (!record.id || !record.tenantId || record.sourceUrl !== item.sourceUrl || record.contentFormat !== 'image') throw Error('image_post_queue_source_invalid');
  const analysis = videoAnalysisOf(record);
  if (['processing', 'unknown'].includes(String(analysis.imageAnalysisQueueState || ''))) throw Error('image_post_queue_requires_reconciliation');
  return { ...analysis, imageAnalysisStatus: 'queued', imageAnalysisQueueState: 'queued',
    imageAnalysisQueueInput: { item: storedImagePostInput(record, item), keyword, sourceHash: imagePostSourceHash(record) },
    imageAnalysisQueuedAt: queuedAt, imageAnalysisError: undefined };
}

export function inlineImagePostAttempt(analysis: Record<string, unknown>): Record<string, unknown> {
  return { ...analysis, imageAnalysisStatus: 'processing', imageAnalysisQueueState: 'processing',
    imageAnalysisAttemptId: randomUUID(), imageAnalysisStartedAt: new Date().toISOString(), imageAnalysisError: undefined };
}

export function unknownImagePostAttempt(analysis: Record<string, unknown>): Record<string, unknown> {
  return { ...analysis, imageAnalysisStatus: 'unknown', imageAnalysisQueueState: 'unknown', imageAnalysisError: 'image_post_queue_result_unknown' };
}
