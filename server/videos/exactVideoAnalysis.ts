import { qwenFrameSeconds, selectFramesForPhysicalCuts, shiftedTimelineLabel } from '../routes/videoAnalysisTimelineProjection.js';
import { completeReferenceWindowFrames } from '../lib/referenceWindowFrames.js';
import { classifyDiscoverySourceFailure } from '../socialDiscovery/sourceFailure.js';
import { executeExactChunks } from '../lib/exactChunkExecution.js';
import { exactQwenScope } from '../agents/exactQwenScope.js';
import { prepareReferenceNarration, readCachedReferenceNarration } from '../lib/referenceNarration.js';
import { lockReferenceSpeechTimeline, type ReferenceSpeechTranscript } from '../lib/referenceSpeechAnalysis.js';
import { joinReferenceWords } from '../lib/referenceWordAlignment.js';
import { analyzeVideoTimelineDetailsWithQwen, type QwenTimelinePlan } from '../agents/qwen.js';
import type { Platform, VideoAiAnalysis } from '../types/index.js';
import { analysisTimelineQualityError, parseAnalysisTimeRange } from '../lib/videoAnalysisCodec.js';
import type { VideoAsrSegment } from './contracts.js';

export function coarseAsrSentences(text: string, start: number, end: number): VideoAsrSegment[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const lines = String(text || '').trim().match(/[^。！？!?\n]+[。！？!?]?/g) || [];
  return lines.map(line => line.trim()).filter(Boolean).map(line => ({
    start, end, text: line, timingPrecision: 'coarse' as const,
    provenance: 'qwen3-asr-flash:inline_audio_window', needsReview: true,
  }));
}

export function lockAsrTimeline(analysis: VideoAiAnalysis, transcript?: ReferenceSpeechTranscript): VideoAiAnalysis {
  return lockReferenceSpeechTimeline(analysis, transcript);
}

export function videoAnalysisTimelineEnd(analysis: VideoAiAnalysis): number {
  return (analysis.scriptDetails15s || []).reduce((max, detail) => {
    const range = parseAnalysisTimeRange(String(detail.time || detail.timestamp || ''));
    return Math.max(max, range?.end || 0);
  }, 0);
}

export function assertFullVideoTimeline(analysis: VideoAiAnalysis, duration: number, source: string): void {
  if (!duration || duration <= 0) return;
  const analyzedUntil = videoAnalysisTimelineEnd(analysis);
  const tolerance = Math.max(1, Math.min(3, duration * 0.03));
  if (!analyzedUntil || analyzedUntil + tolerance < duration) {
    throw new Error(`${source}_incomplete_timeline_${analyzedUntil.toFixed(1)}s_of_${duration.toFixed(1)}s`);
  }
}

export async function analyzeExactLongVideoChunks(input: {
  filePath?: string;
  frames: Array<{ base64: string; mimeType: string; timeLabel: string }>;
  title?: string;
  platform?: Platform;
  duration: number;
  views?: string;
  tags?: string[];
  transcript?: ReferenceSpeechTranscript;
  analysisMode?: 'strategy' | 'exact';
  sceneCuts?: number[];
}): Promise<VideoAiAnalysis> {
  // Keep each VL request small enough to finish reliably. Dense montage clips
  // can contain twenty or more observation boundaries in twelve seconds; that
  // response repeatedly exceeds the provider timeout even after reducing the
  // frame count. Six-second chunks bound both image input and schema output.
  const chunkSeconds = Math.max(4, Math.min(30, Number(process.env.VIDEO_EXACT_CHUNK_SECONDS || 6)));
  const inferredDuration = exactAnalysisDuration(input.duration, input.frames.map(frame => qwenFrameSeconds(frame.timeLabel)));
  const chunks = exactAnalysisChunkRanges(inferredDuration, chunkSeconds);
  const timelinePlanError = (plan: QwenTimelinePlan, duration: number): string | null => {
    const rows = plan.boundaries;
    if (!plan.theme.trim()) return 'missing_theme';
    if (!rows.length) return 'missing_boundaries';
    const ids = new Set<string>();
    let cursor = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (!row.id || ids.has(row.id)) return `duplicate_boundary_${index + 1}`;
      ids.add(row.id);
      if (!Number.isFinite(row.start) || !Number.isFinite(row.end) || row.end <= row.start) return `invalid_boundary_${index + 1}`;
      if (Math.abs(row.start - cursor) > 0.35) return `boundary_gap_or_overlap_${index + 1}`;
      if (row.end - row.start > 5.35) return `boundary_too_long_${index + 1}`;
      cursor = row.end;
    }
    if (Math.abs(cursor - duration) > 0.5) return `boundary_tail_${cursor.toFixed(2)}_of_${duration.toFixed(2)}`;
    return null;
  };
  const analyzeChunk = async (chunk: { start: number; end: number }, frameLimit: number, signal: AbortSignal) => {
    const localDuration = chunk.end - chunk.start;
    let selected = input.frames.filter(frame => {
      const time = qwenFrameSeconds(frame.timeLabel);
      return time >= chunk.start && (time < chunk.end || chunk.end === input.duration);
    });
    if (!selected.length) {
      selected = [input.frames.reduce((nearest, frame) =>
        Math.abs(qwenFrameSeconds(frame.timeLabel) - chunk.start) < Math.abs(qwenFrameSeconds(nearest.timeLabel) - chunk.start) ? frame : nearest
      )];
    }
    selected = selectFramesForPhysicalCuts(selected, input.sceneCuts || [], chunk.start, chunk.end, frameLimit);
    const localFrames = selected.map(frame => ({ ...frame, timeLabel: `${Math.max(0, qwenFrameSeconds(frame.timeLabel) - chunk.start).toFixed(6)}s` }));
    const localSegments = (input.transcript?.segments || [])
      .filter(segment => segment.timingPrecision === 'phrase' && segment.end > chunk.start && segment.start < chunk.end)
      .map(segment => {
        const words = segment.words?.filter(word => word.end > chunk.start && word.start < chunk.end)
          .map(word => ({ ...word, start: Math.max(0, word.start - chunk.start), end: Math.min(localDuration, word.end - chunk.start) }));
        return { ...segment, ...(words?.length ? { words, text: joinReferenceWords(words) } : {}),
          start: Math.max(0, segment.start - chunk.start), end: Math.min(localDuration, segment.end - chunk.start) };
      });
    // Stage 1 is deterministic: lock continuous observation windows to the
    // real video clock. This is not a claim that every boundary is a cut; the
    // model only describes visible content inside each server-owned window.
    const observationSeconds = Math.max(2, Math.min(5, Number(process.env.VIDEO_EXACT_OBSERVATION_SECONDS || 4)));
    const cutPoints = [0, ...(input.sceneCuts || [])
      .filter(value => value > chunk.start + 0.02 && value < chunk.end - 0.02)
      .map(value => +(value - chunk.start).toFixed(6)), localDuration];
    const windows: Array<{ start: number; end: number; reason: string }> = [];
    for (let cutIndex = 0; cutIndex < cutPoints.length - 1; cutIndex += 1) {
      const start = cutPoints[cutIndex]!;
      const end = cutPoints[cutIndex + 1]!;
      const sections = Math.max(1, Math.ceil((end - start) / observationSeconds));
      for (let section = 0; section < sections; section += 1) {
        windows.push({
          start: +(start + (end - start) * section / sections).toFixed(6),
          end: +(start + (end - start) * (section + 1) / sections).toFixed(6),
          reason: section === 0 && cutIndex > 0 ? '检测到视觉切点' : '连续镜头观察段',
        });
      }
    }
    const timeline: QwenTimelinePlan = {
      theme: String(input.title || '真实视频画面分析'),
      identityEntities: [],
      hooks: [], sellingPoints: [], mood: '', structure: '', baseRequirements: '',
      firstTenSeconds: {}, coarseStructure: [], scriptSummary15s: {}, recommendedScriptType: 'storyboard',
      boundaries: windows.map((window, index) => ({
        id: `b${index + 1}`,
        start: window.start,
        end: window.end,
        reason: window.reason,
        evidence: '由真实视频时间轴及 ffmpeg 场景切点锁定，画面内容由关键帧分析填写',
      })),
    };
    const planError = timelinePlanError(timeline, localDuration);
    if (planError) throw new Error(`exact_timeline_quality_failed_${chunk.start.toFixed(0)}_${planError}`);
    console.log(`[videos] exact details ${chunk.start.toFixed(0)}-${chunk.end.toFixed(0)}s started, boundaries=${timeline.boundaries.length}`);
    const result = await analyzeVideoTimelineDetailsWithQwen({
      frames: await completeReferenceWindowFrames({ filePath: input.filePath, frames: localFrames,
        offset: chunk.start, windows: timeline.boundaries }),
      timeline,
      transcript: localSegments.length ? { text: localSegments.map(item => item.text).join(''), segments: localSegments } : undefined,
      signal,
    });
    const localQualityError = analysisTimelineQualityError(result, localDuration, input.analysisMode || 'exact');
    if (localQualityError) throw new Error(`${input.analysisMode || 'exact'}_chunk_quality_failed_${chunk.start.toFixed(0)}_${localQualityError}`);
    const details = (result.scriptDetails15s || []).map(detail => ({ ...detail,
      time: shiftedTimelineLabel(String(detail.time || detail.timestamp || ''), chunk.start, localDuration),
      beats: detail.beats?.map(beat => ({ ...beat,
        time: shiftedTimelineLabel(String(beat.time || ''), chunk.start, localDuration) })),
      tempoPhases: detail.tempoPhases?.map(phase => ({ ...phase,
        time: shiftedTimelineLabel(String(phase.time || ''), chunk.start, localDuration) })),
    }));
    return {
      ...result,
      coarseStructure: (result.coarseStructure || []).map(item => ({ ...item, time: shiftedTimelineLabel(String(item.time || ''), chunk.start, localDuration) })),
      scriptDetails15s: details,
    };
  };
  // A schema-complete director storyboard commonly needs more than one minute
  // even for a short clip. 110s remains bounded, while allowing the smaller
  // retry to finish instead of aborting a healthy generation at 60s.
  const chunkTimeoutMs = Math.max(20_000, Number(process.env.VIDEO_EXACT_CHUNK_TIMEOUT_MS || 150_000));
  const primaryFrameLimit = Math.max(8, Math.min(20, Number(process.env.VIDEO_EXACT_CHUNK_FRAME_LIMIT || 12)));
  const retryFrameLimit = Math.max(6, Math.min(primaryFrameLimit, Number(process.env.VIDEO_EXACT_RETRY_FRAME_LIMIT || 8)));
  const runWithTimeout = async (chunk: { start: number; end: number }, frameLimit: number, attempt: number) => {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutError = `exact_chunk_timeout_${chunk.start.toFixed(0)}_${chunk.end.toFixed(0)}`;
    const timeout = setTimeout(() => controller.abort(), chunkTimeoutMs);
    try {
      console.log(`[videos] exact chunk ${chunk.start.toFixed(0)}-${chunk.end.toFixed(0)}s started, frames=${frameLimit}, attempt=${attempt}`);
      const result = await analyzeChunk(chunk, frameLimit, controller.signal);
      console.log(`[videos] exact chunk ${chunk.start.toFixed(0)}-${chunk.end.toFixed(0)}s completed in ${Date.now() - startedAt}ms, frames=${frameLimit}, attempt=${attempt}`);
      return result;
    } catch (error) {
      const failure = controller.signal.aborted ? new Error(timeoutError) : error;
      console.warn(`[videos] exact chunk ${chunk.start.toFixed(0)}-${chunk.end.toFixed(0)}s failed in ${Date.now() - startedAt}ms, frames=${frameLimit}, attempt=${attempt}:`, failure instanceof Error ? failure.message : failure);
      throw failure;
    } finally {
      clearTimeout(timeout);
    }
  };
  const concurrency = Math.max(1, Math.min(3, Number(process.env.VIDEO_EXACT_CHUNK_CONCURRENCY || 2)));
  const settled = await executeExactChunks(chunks,exactQwenScope()?1:concurrency,(chunk,attempt)=>runWithTimeout(chunk,attempt===1?primaryFrameLimit:retryFrameLimit,attempt),!exactQwenScope());
  const failure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failure) throw new Error(`${classifyDiscoverySourceFailure(failure.reason) === 'model_unavailable' ? 'model_unavailable' : `${input.analysisMode || 'exact'}_analysis_retryable`}: ${failure.reason instanceof Error ? failure.reason.message : String(failure.reason)}`);
  const results = settled.map(result => (result as PromiseFulfilledResult<VideoAiAnalysis>).value);
  const first = results[0];
  const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
  return {
    ...first,
    hooks: unique(results.flatMap(result => result.hooks || [])).slice(0, 6),
    sellingPoints: unique(results.flatMap(result => result.sellingPoints || [])).slice(0, 10),
    structure: unique(results.map(result => result.structure || '')).join(' → '),
    coarseStructure: results.flatMap(result => result.coarseStructure || []),
    scriptDetails15s: results.flatMap(result => result.scriptDetails15s || []),
  };
}

export function exactAnalysisChunkRanges(duration: number, chunkSeconds = 6): Array<{ start: number; end: number }> {
  const boundedDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const boundedChunkSeconds = Math.max(4, Math.min(30, Number.isFinite(chunkSeconds) ? chunkSeconds : 6));
  return Array.from({ length: Math.ceil(boundedDuration / boundedChunkSeconds) }, (_, index) => ({
    start: index * boundedChunkSeconds,
    end: Math.min(boundedDuration, (index + 1) * boundedChunkSeconds),
  }));
}

export function exactAnalysisDuration(duration: number, frameTimes: number[]): number {
  if (Number.isFinite(duration) && duration > 0) return duration;
  return Math.max(...frameTimes.filter(Number.isFinite).map(time => time + 3), 3);
}

export function exactSourceClockDuration(analysis: VideoAiAnalysis, expectedRunId: string): number | undefined {
  const clock = analysis.sourceMediaClock;
  if (!clock || !expectedRunId || clock.analysisRunId !== expectedRunId
    || !/^[a-f0-9]{64}$/i.test(clock.sourceSha256)
    || !Number.isFinite(clock.duration) || clock.duration <= 0) return undefined;
  return clock.duration;
}

export async function referenceNarrationForVideoAnalysis(
  filePath: string,
  duration: number,
  tenantId: string,
  ports: {
    readCached?: typeof readCachedReferenceNarration;
    prepare?: typeof prepareReferenceNarration;
  } = {},
) {
  const readCached = ports.readCached || readCachedReferenceNarration;
  const prepare = ports.prepare || prepareReferenceNarration;
  if (!exactQwenScope()) return prepare(filePath, duration, { tenantId });
  try {
    return readCached(filePath, tenantId) || {
      text: '', segments: [], words: [], alignmentStatus: 'unavailable',
      alignmentError: 'scoped_visual_revision_has_no_asr_authorization',
    };
  } catch {
    return { text: '', segments: [], words: [], alignmentStatus: 'unavailable',
      alignmentError: 'scoped_visual_revision_cached_asr_unavailable' };
  }
}
