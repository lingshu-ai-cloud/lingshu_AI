import { DIGITAL_HUMAN_PIPELINE_VERSION } from './digitalHumanPipeline.js';

export type ShotDigitalHumanStatus = 'queued' | 'submitting' | 'processing' | 'quality_check' | 'review' | 'completed' | 'failed' | 'cancelled' | 'stale';

export interface ShotDigitalHumanBinding {
  jobId: string;
  avatarMaterialId: string;
  status: ShotDigitalHumanStatus;
  /** Server-canonical full task signature after the job has been accepted. */
  inputSignature: string;
  /** Business-source fingerprint; deliberately excludes performance planning. */
  sourceFingerprint?: string;
  /** Server-owned full performance-plan/profile signature. */
  performanceSignature?: string;
  outputMaterialId?: string;
  motionClipIds?: string[];
  performanceRevision?: number;
  performancePreset?: 'natural' | 'professional' | 'commerce';
  error?: string;
}

export interface ShotDigitalHumanSourceInput {
  slotId: string;
  script: string;
  language: string;
  voiceoverUrl: string;
  start: number;
  end: number;
  avatarMaterialId: string;
  avatarVersion?: number;
  pipelineVersion?: string;
}

export interface ShotDigitalHumanCue {
  start: number;
  end: number;
  text: string;
}

function stripStoryboardTimestamps(value: string): string {
  return String(value || '').replace(/\[\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—]\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*\]/gi, '');
}

function partitionLocalizedScript(fullScript: string, slotCount: number): string[] {
  if (!Number.isInteger(slotCount) || slotCount < 1) return [];
  const timestampFree = stripStoryboardTimestamps(fullScript);
  const paragraphs = timestampFree
    .split(/\r?\n+/)
    .map(item => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!paragraphs.length) return [];

  // A translated script is authored as one paragraph per storyboard shot. Keep
  // those paragraph boundaries: sentence-count partitioning breaks languages
  // whose translation naturally needs two sentences for a single shot.
  if (paragraphs.length >= slotCount) {
    return Array.from({ length: slotCount }, (_, slotIndex) => {
      const start = Math.floor(slotIndex * paragraphs.length / slotCount);
      const end = Math.max(start + 1, Math.floor((slotIndex + 1) * paragraphs.length / slotCount));
      return paragraphs.slice(start, end).join(' ').trim();
    });
  }

  const clean = paragraphs.join(' ').trim();
  const sentences = clean.split(/(?<=[。！？!?；;.!?])\s*/u).map(item => item.trim()).filter(Boolean);
  if (sentences.length >= slotCount) {
    return Array.from({ length: slotCount }, (_, slotIndex) => {
      const start = Math.floor(slotIndex * sentences.length / slotCount);
      const end = Math.max(start + 1, Math.floor((slotIndex + 1) * sentences.length / slotCount));
      return sentences.slice(start, end).join(' ').trim();
    });
  }

  return Array.from({ length: slotCount }, (_, slotIndex) => {
    const start = Math.floor(slotIndex * clean.length / slotCount);
    const end = Math.max(start + 1, Math.floor((slotIndex + 1) * clean.length / slotCount));
    return clean.slice(start, end).trim();
  });
}

export function localizedDigitalHumanShotText(fullScript: string, slotIndex: number, slotCount: number): string {
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= slotCount) return '';
  return partitionLocalizedScript(fullScript, slotCount)[slotIndex] || '';
}

function comparableSpeech(value: string): string {
  return String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '');
}

/**
 * Resolve both the localized text and the exact audio interval for one shot.
 * When TTS cues still represent the same script, paragraph character boundaries
 * are mapped onto cue boundaries. A safe storyboard-time fallback is retained
 * for uploaded audio or edited/mismatched subtitle cues.
 */
export function resolveShotDigitalHumanSpeechSegment(input: {
  fullScript: string;
  slotIndex: number;
  slotCount: number;
  cues?: ShotDigitalHumanCue[];
  fallbackStart: number;
  fallbackEnd: number;
}): { text: string; start: number; end: number; alignmentSource: 'tts_cues' | 'storyboard_timeline' } {
  const parts = partitionLocalizedScript(input.fullScript, input.slotCount);
  const text = parts[input.slotIndex] || '';
  const fallbackStart = Math.max(0, Number(input.fallbackStart) || 0);
  const fallbackEnd = Math.max(fallbackStart + 0.2, Number(input.fallbackEnd) || 0);
  const cues = (input.cues || []).filter(cue => Number.isFinite(cue.start)
    && Number.isFinite(cue.end)
    && cue.start >= 0
    && cue.end > cue.start
    && comparableSpeech(cue.text).length > 0);
  if (!text || !parts.length || !cues.length) {
    return { text, start: fallbackStart, end: fallbackEnd, alignmentSource: 'storyboard_timeline' };
  }

  const normalizedParts = parts.map(comparableSpeech);
  const normalizedScript = normalizedParts.join('');
  const normalizedCues = cues.map(cue => comparableSpeech(cue.text));
  if (!normalizedScript || normalizedCues.join('') !== normalizedScript) {
    return { text, start: fallbackStart, end: fallbackEnd, alignmentSource: 'storyboard_timeline' };
  }

  const targetStart = normalizedParts.slice(0, input.slotIndex).reduce((sum, item) => sum + item.length, 0);
  const targetEnd = targetStart + normalizedParts[input.slotIndex]!.length;
  let cursor = 0;
  let firstCue = -1;
  let lastCue = -1;
  for (let index = 0; index < cues.length; index += 1) {
    const next = cursor + normalizedCues[index]!.length;
    if (firstCue < 0 && next > targetStart) firstCue = index;
    if (next >= targetEnd) {
      lastCue = index;
      break;
    }
    cursor = next;
  }
  if (firstCue < 0 || lastCue < firstCue) {
    return { text, start: fallbackStart, end: fallbackEnd, alignmentSource: 'storyboard_timeline' };
  }
  return {
    text,
    start: cues[firstCue]!.start,
    end: cues[lastCue]!.end,
    alignmentSource: 'tts_cues',
  };
}

function normalizedSignatureText(value: unknown): string {
  return String(value ?? '').normalize('NFC').replace(/\r\n?/g, '\n').trim();
}

function normalizedSignatureLanguage(value: unknown): string {
  return normalizedSignatureText(value).replace(/_/g, '-').toLowerCase();
}

/**
 * Signed playback URLs are short-lived, while the underlying tenant-scoped
 * audio path is stable. Query/hash rotation must not invalidate a completed
 * render, but a different audio object path must.
 */
export function digitalHumanVoiceoverIdentity(value: unknown): string {
  const raw = normalizedSignatureText(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw, 'http://digital-human.local');
    return parsed.pathname;
  } catch {
    return raw.split(/[?#]/, 1)[0] || '';
  }
}

/**
 * Stable identity for the inputs the editor can actually change. Performance
 * planning is intentionally absent: a saved explicit profile remains current
 * when the product's default planner evolves.
 */
export function shotDigitalHumanSourceFingerprint(input: ShotDigitalHumanSourceInput): string {
  return [
    'digital-human-source-v1',
    normalizedSignatureText(input.slotId),
    normalizedSignatureLanguage(input.language),
    normalizedSignatureText(input.script),
    digitalHumanVoiceoverIdentity(input.voiceoverUrl),
    Number(input.start).toFixed(3),
    Number(input.end).toFixed(3),
    normalizedSignatureText(input.avatarMaterialId),
    Number.isFinite(Number(input.avatarVersion)) ? Math.max(1, Math.round(Number(input.avatarVersion))) : 1,
    normalizedSignatureText(input.pipelineVersion || DIGITAL_HUMAN_PIPELINE_VERSION),
  ].map(value => JSON.stringify(value)).join('|');
}

export function shotDigitalHumanSignature(input: ShotDigitalHumanSourceInput & {
  performancePlanVersion?: string;
  performancePlanFingerprint?: string;
  motionClipIds?: string[];
  scenePlanFingerprint?: string;
}) {
  return [
    shotDigitalHumanSourceFingerprint(input),
    normalizedSignatureText(input.performancePlanVersion || 'performance-v1'),
    normalizedSignatureText(input.performancePlanFingerprint),
    // Motion clips are ordered by performance beat. Reordering two clips changes
    // the on-screen action sequence and must therefore invalidate the result.
    (input.motionClipIds || []).map(normalizedSignatureText).join(','),
    normalizedSignatureText(input.scenePlanFingerprint),
  ].map(value => JSON.stringify(value)).join('|');
}

/** Compatibility identity for project bindings written before sourceFingerprint. */
export function legacyShotDigitalHumanSignature(input: ShotDigitalHumanSourceInput & {
  performancePlanVersion?: string;
  performancePlanFingerprint?: string;
  motionClipIds?: string[];
  scenePlanFingerprint?: string;
}) {
  return [
    input.slotId, input.script.trim(), input.language, input.voiceoverUrl, input.start.toFixed(3), input.end.toFixed(3), input.avatarMaterialId,
    input.avatarVersion ?? 1, input.performancePlanVersion || 'performance-v1', input.performancePlanFingerprint || '',
    (input.motionClipIds || []).join(','), input.scenePlanFingerprint || '', input.pipelineVersion || DIGITAL_HUMAN_PIPELINE_VERSION,
  ].join('|');
}

export function isShotDigitalHumanActive(status: ShotDigitalHumanStatus) {
  return ['queued', 'submitting', 'processing', 'quality_check'].includes(status);
}

export function isShotDigitalHumanCurrent(binding: ShotDigitalHumanBinding | undefined, signature: string) {
  return Boolean(binding && binding.inputSignature === signature && binding.status !== 'stale');
}

/**
 * New bindings are invalidated only by source changes. A legacy binding can be
 * retained only when the caller proves its old full signature still matches;
 * omission is fail-closed.
 */
export function isShotDigitalHumanSourceCurrent(
  binding: ShotDigitalHumanBinding | undefined,
  sourceFingerprint: string,
  legacyCurrentPerformanceSignature?: string,
) {
  if (!binding || binding.status === 'stale') return false;
  if (binding.sourceFingerprint) return binding.sourceFingerprint === sourceFingerprint;
  return Boolean(legacyCurrentPerformanceSignature && binding.inputSignature === legacyCurrentPerformanceSignature);
}

export function resolveShotDigitalHumanResult(input: {
  binding: ShotDigitalHumanBinding;
  currentSignature?: string;
  currentSourceFingerprint?: string;
  jobInputSignature?: string;
  jobSourceFingerprint?: string;
  jobStatus: Exclude<ShotDigitalHumanStatus, 'stale'>;
  outputMaterialId?: string;
  error?: string;
}) {
  const sourceIsCurrent = input.currentSourceFingerprint
    ? isShotDigitalHumanSourceCurrent(input.binding, input.currentSourceFingerprint, input.currentSignature)
      && (input.binding.sourceFingerprint
        ? input.jobSourceFingerprint === input.currentSourceFingerprint
        : (!input.jobSourceFingerprint || input.jobSourceFingerprint === input.currentSourceFingerprint))
      && (input.binding.sourceFingerprint
        ? input.jobInputSignature === input.binding.inputSignature
        : (!input.jobInputSignature || input.jobInputSignature === input.binding.inputSignature))
    : input.binding.inputSignature === input.currentSignature;
  if (!sourceIsCurrent) {
    return { binding: { ...input.binding, status: 'stale' as const, error: '分镜输入已变化，请重新生成。' } };
  }
  const binding: ShotDigitalHumanBinding = {
    ...input.binding,
    status: input.jobStatus,
    outputMaterialId: input.outputMaterialId,
    error: input.error,
  };
  return {
    binding,
    assignmentMaterialId: input.jobStatus === 'completed' ? input.outputMaterialId : undefined,
  };
}
