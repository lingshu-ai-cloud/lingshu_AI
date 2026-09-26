import { gzipSync, gunzipSync } from 'node:zlib';
import type { VideoAiAnalysis } from '../types/index.js';

function parseJsonRecord<T>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object') return value as T;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
const textPresent = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;
const objectRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function parseAnalysisTimeRange(value: string): { start: number; end: number } | null {
  const numbers = String(value || '').match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
  return numbers.length ? { start: numbers[0], end: numbers[1] ?? numbers[0] + 3 } : null;
}
export function videoAnalysisOf(record: Record<string, unknown>): Record<string, unknown> {
  const parsed = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {}); const compressed = typeof parsed.imageEvidenceGzip === 'string' ? parsed.imageEvidenceGzip : '';
  if (!parsed.imageEvidence && compressed) try { parsed.imageEvidence = JSON.parse(gunzipSync(Buffer.from(compressed, 'base64')).toString('utf8')); } catch { /* explicitly unavailable */ }
  delete parsed.imageEvidenceGzip; delete parsed.imageEvidenceEncoding; return parsed;
}
export function serializeImagePostAnalysis(analysis: Record<string, unknown>): string {
  const clean = analysis.contentFormat === 'image' ? { ...analysis, gemini: undefined } : analysis; const plain = JSON.stringify(clean);
  if (Buffer.byteLength(plain, 'utf8') <= 4_500 || !clean.imageEvidence) return plain;
  return JSON.stringify({ ...clean, imageEvidence: undefined, imageEvidenceEncoding: 'gzip-base64', imageEvidenceGzip: gzipSync(JSON.stringify(clean.imageEvidence)).toString('base64') });
}
export function hasCompleteVideoGeminiAnalysis(gemini: unknown, duration = 0): boolean {
  const analysis = objectRecord(gemini); if (!Object.keys(analysis).length) return false; const firstTen = objectRecord(analysis.firstTenSeconds);
  const firstTenCount = ['atmosphere', 'audioVisual', 'camera', 'visuals', 'voiceMusic'].filter(key => textPresent(firstTen[key])).length;
  const coarseStructure = Array.isArray(analysis.coarseStructure) ? analysis.coarseStructure.filter(item => { const frame = objectRecord(item); return textPresent(frame.description || frame.desc || frame.frame); }) : [];
  const scriptDetails = Array.isArray(analysis.scriptDetails15s) ? analysis.scriptDetails15s.filter(item => { const detail = objectRecord(item); return textPresent(detail.visual) || textPresent(detail.subtitle); }) : [];
  const analyzedUntil = scriptDetails.reduce((max, item) => { const detail = objectRecord(item); const values = String(detail.time || detail.timestamp || '').match(/\d+(?:\.\d+)?/g)?.map(Number) || []; return Math.max(max, values[1] ?? values[0] ?? 0); }, 0);
  const tolerance = duration > 0 ? Math.max(1, Math.min(3, duration * 0.03)) : 0;
  return textPresent(analysis.theme) && firstTenCount >= 3 && coarseStructure.length >= 1 && scriptDetails.length >= 1 && (duration <= 0 || analyzedUntil + tolerance >= duration);
}
export function analysisTimelineQualityError(analysis: VideoAiAnalysis, duration: number, mode: 'strategy' | 'exact'): string | null {
  const details = (analysis.scriptDetails15s || []).map(detail => ({ detail, range: parseAnalysisTimeRange(String(detail.time || detail.timestamp || '')) }))
    .filter((item): item is { detail: NonNullable<VideoAiAnalysis['scriptDetails15s']>[number]; range: { start: number; end: number } } => Boolean(item.range)).sort((a, b) => a.range.start - b.range.start);
  if (!details.length) return 'no_valid_storyboard_segments'; const effectiveDuration = duration > 0 ? duration : details.at(-1)!.range.end;
  const requiredSegments = effectiveDuration > 5 ? Math.max(2, Math.ceil(effectiveDuration / 5)) : 1; if (details.length < requiredSegments) return `insufficient_segment_density_${details.length}_of_${requiredSegments}`;
  const boundaryTolerance = mode === 'exact' ? 0.75 : 1.25; const maxSegmentSeconds = mode === 'exact' ? 5.5 : 6.25;
  if (details[0].range.start > boundaryTolerance) return `timeline_starts_at_${details[0].range.start.toFixed(2)}s`;
  for (let index = 0; index < details.length; index += 1) { const { start, end } = details[index].range; if (end <= start) return `invalid_segment_${index + 1}`; if (end - start > maxSegmentSeconds) return `segment_${index + 1}_too_long_${(end - start).toFixed(2)}s`; if (index > 0) { const previousEnd = details[index - 1].range.end; if (start - previousEnd > boundaryTolerance) return `timeline_gap_at_${previousEnd.toFixed(2)}s`; if (previousEnd - start > boundaryTolerance) return `timeline_overlap_at_${start.toFixed(2)}s`; } }
  const analyzedUntil = details.at(-1)!.range.end; return duration > 0 && analyzedUntil + boundaryTolerance < duration ? `timeline_ends_at_${analyzedUntil.toFixed(2)}s_of_${duration.toFixed(2)}s` : null;
}
export function canPromoteExistingAnalysisToExact(gemini: unknown, duration = 0): boolean {
  if (!hasCompleteVideoGeminiAnalysis(gemini, 0)) return false; const analysis = objectRecord(gemini); const details = Array.isArray(analysis.scriptDetails15s) ? analysis.scriptDetails15s : [];
  const analyzedUntil = details.reduce((max, item) => { const detail = objectRecord(item); const values = String(detail.time || detail.timestamp || '').match(/\d+(?:\.\d+)?/g)?.map(Number) || []; return Math.max(max, values[1] ?? values[0] ?? 0); }, 0);
  const requiredSegments = duration > 0 ? Math.max(2, Math.ceil(duration / 5)) : 3; const tolerance = duration > 0 ? Math.max(1.5, Math.min(3, duration * 0.1)) : 0;
  return details.length >= requiredSegments && (duration <= 0 || analyzedUntil + tolerance >= duration);
}
export function isAutoSeededVideo(record: Record<string, unknown>): boolean {
  const analysis = videoAnalysisOf(record);
  return Boolean(analysis.seededFromRecordId || analysis.analysisSource === 'demo-local-video' || String(analysis.crawlRule || '').includes('演示素材'));
}
export function isVideoLevelAnalysis(analysis: Record<string, unknown>): boolean {
  const geminiStatus = String(analysis.geminiStatus || ''); const downloadStatus = String(analysis.downloadStatus || '');
  const videoFetchStatus = String(analysis.videoFetchStatus || ''); const analysisSource = String(analysis.analysisSource || '');
  if (analysis.analysisQuality !== 'video' || !analysis.gemini) return false;
  if (analysisSource === 'metadata-fallback' || geminiStatus === 'metadata_fallback' || downloadStatus === 'metadata_only') return false;
  return (!geminiStatus || geminiStatus === 'analyzed') && (!downloadStatus || downloadStatus === 'analyzed' || videoFetchStatus === 'direct_url' || videoFetchStatus === 'fetched');
}
