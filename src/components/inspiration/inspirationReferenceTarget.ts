import type { TrendVideo, VideoAnalysisPayload } from '../../lib/inspirationTypes';
import { hasExactReferenceReview } from '../../lib/exactReferenceReview';

export type InspirationReferenceTarget = {
  referenceId: string;
  sourceUrl: string;
  title: string;
  platform: string;
  thumbnailUrl: string;
  duration: number;
  benchmarkAnalysis?: VideoAnalysisPayload['benchmarkAnalysis'];
};

export function normalizedReferenceText(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function normalizedReferenceUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, '')}${url.pathname}`.replace(/\/$/, '').toLowerCase();
  } catch {
    return value.trim().replace(/^https?:\/\/(?:www\.)?/i, '').replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
  }
}

export function videoMatchesReference(video: TrendVideo, target: InspirationReferenceTarget) {
  const normalizedId = target.referenceId.replace(/^crawl-/, '');
  const targetUrl = normalizedReferenceUrl(target.sourceUrl);
  const videoUrl = normalizedReferenceUrl(video.sourceUrl || '');
  const targetTitle = normalizedReferenceText(target.title);
  const videoTitle = normalizedReferenceText(video.title);
  return video.id === target.referenceId
    || video.recordId === normalizedId
    || Boolean(targetUrl && videoUrl && targetUrl === videoUrl)
    || Boolean(targetTitle && videoTitle && (targetTitle === videoTitle || targetTitle.includes(videoTitle) || videoTitle.includes(targetTitle)));
}

export function parseInspirationReferenceTarget(input: unknown): InspirationReferenceTarget | null {
  if (!input || typeof input !== 'object') return null;
  const detail = input as Record<string, unknown>;
  if (hasExactReferenceReview(detail)) return null;
  const reference = detail.inspirationReference && typeof detail.inspirationReference === 'object'
    ? detail.inspirationReference as Record<string, unknown>
    : {};
  const businessRef = detail.businessRef && typeof detail.businessRef === 'object'
    ? detail.businessRef as Record<string, unknown>
    : {};
  const referenceId = String(reference.referenceId || businessRef.referenceId || '').trim();
  const sourceUrl = String(reference.sourceUrl || '').trim();
  const title = String(reference.title || '').trim();
  const platform = String(reference.platform || '').trim().toLowerCase();
  const thumbnailUrl = String(reference.thumbnailUrl || '').trim();
  const duration = Math.max(0, Number(reference.duration || 0));
  const benchmarkAnalysis = reference.benchmarkAnalysis && typeof reference.benchmarkAnalysis === 'object'
    ? reference.benchmarkAnalysis as VideoAnalysisPayload['benchmarkAnalysis']
    : undefined;
  return referenceId || sourceUrl || title
    ? { referenceId, sourceUrl, title, platform, thumbnailUrl, duration, benchmarkAnalysis }
    : null;
}

export function initialInspirationReferenceTarget(): InspirationReferenceTarget | null {
  if (typeof window === 'undefined') return null;
  return parseInspirationReferenceTarget(window.history.state?.productionDetail);
}
