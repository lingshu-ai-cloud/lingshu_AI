/**
 * Renderer-agnostic caption and sparse emphasis timeline.
 *
 * This contract describes what deserves emphasis and when. It deliberately
 * contains no animation names, CSS, FFmpeg expressions or profile styling.
 */

export const EMPHASIS_EVENT_TYPES = ['hook', 'key_fact', 'reveal', 'section_label', 'cta'] as const;
export const EMPHASIS_SOURCES = ['transcript', 'vision', 'metadata', 'editor'] as const;
export const EMPHASIS_PROFILES = ['d2c_dialogue', 'talking_head', 'factory_process', 'product_showcase'] as const;
export const EMPHASIS_VISUAL_INTENTS = ['focus_product', 'attention', 'urgency', 'warning', 'cta'] as const;
export const EMPHASIS_ASSET_INTENTS = ['product_marker', 'attention_marker', 'urgency_badge', 'warning_marker', 'cta_marker', 'fact_label', 'section_marker'] as const;
export const EMPHASIS_PRESENTATION_MODES = ['caption_emphasis', 'graphic_only', 'label', 'none'] as const;
export const EMPHASIS_TARGET_RELATIONS = ['surround', 'point_to', 'adjacent', 'none'] as const;
export const EMPHASIS_TIMELINE_SCHEMA_VERSION = 1 as const;

export type EmphasisEventType = typeof EMPHASIS_EVENT_TYPES[number];
export type EmphasisEventSource = typeof EMPHASIS_SOURCES[number];
export type EmphasisProfile = typeof EMPHASIS_PROFILES[number];
export type EmphasisImportance = 1 | 2 | 3;
export type EmphasisVisualIntent = typeof EMPHASIS_VISUAL_INTENTS[number];
export type EmphasisAssetIntent = typeof EMPHASIS_ASSET_INTENTS[number];
export type EmphasisPresentationMode = typeof EMPHASIS_PRESENTATION_MODES[number];
export type EmphasisTargetRelation = typeof EMPHASIS_TARGET_RELATIONS[number];
export type NormalizedPoint = { x: number; y: number };
export type NormalizedBox = { x: number; y: number; width: number; height: number };

export interface CaptionSegment {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  speakerId?: string;
  /** Inline emphasis only. Keywords do not create EmphasisEvents. */
  keywords?: string[];
}

export interface ShotWindow {
  id: string;
  startMs: number;
  endMs: number;
  confidence: number;
  source: 'ffmpeg_scene' | 'storyboard' | 'fallback';
}

export interface CaptionOccupancy {
  id: string;
  startMs: number;
  endMs: number;
  text?: string;
  boxes: NormalizedBox[];
  confidence: number;
  source: 'subtitle' | 'ocr';
  /** Project subtitles can be emphasized in place; OCR text is immutable. */
  editable: boolean;
}

export interface VisualEvidence {
  shotId: string;
  subjectType: 'person' | 'product' | 'machine' | 'process' | 'unknown';
  subjectBox?: NormalizedBox;
  subjectAnchor?: NormalizedPoint;
  safeZones: Array<NormalizedBox & { clarity: number }>;
  captionBoxes: NormalizedBox[];
  confidence: number;
}

export interface EmphasisEvent {
  id: string;
  type: EmphasisEventType;
  startMs: number;
  endMs: number;
  text?: string;
  importance: EmphasisImportance;
  confidence: number;
  source: EmphasisEventSource;
  shotId?: string;
  evidenceStartMs?: number;
  evidenceEndMs?: number;
  presentationMode?: EmphasisPresentationMode;
  targetRelation?: EmphasisTargetRelation;
  /** Subtitle/OCR rectangles the renderer must treat as occupied. */
  occupiedBoxes?: NormalizedBox[];
  /** Semantic/visual subject used to find the best placement window. */
  targetId?: string;
  /** Semantic goal used to choose a suitable asset family; never a filename. */
  visualIntent?: EmphasisVisualIntent;
  /** Abstract asset category. Rendering resolves the concrete approved asset. */
  assetIntent?: EmphasisAssetIntent;
  /** Subject geometry copied only from a trusted matching visual window. */
  subjectAnchor?: NormalizedPoint;
  subjectBox?: NormalizedBox;
  /** Optional renderer hint. Strong events may still be degraded for safety. */
  strength?: 'weak' | 'strong';
  /** Normalized placement selected from trusted visual evidence. */
  anchor?: { x: number; y: number };
  /** False forces the renderer to use its conservative safe position. */
  safeArea?: boolean;
  /** Traceability for an event moved onto a supporting visual window. */
  placementEvidence?: {
    windowId: string;
    targetId?: string;
    clarity: number;
    safe: boolean;
  };
}

export interface EmphasisPlacementWindow {
  id: string;
  startMs: number;
  endMs: number;
  /** IDs of products, facts or process stages visibly supported here. */
  targetIds?: string[];
  /** A transition-only or obstructed window is not safe for a new overlay. */
  safe?: boolean;
  /** Visual legibility/evidence strength, from 0 to 1. */
  clarity?: number;
  /** Safe normalized overlay anchor observed for this visual window. */
  anchor?: { x: number; y: number };
  /** Optional detected subject geometry; accepted only with safe, clear evidence. */
  subjectAnchor?: NormalizedPoint;
  subjectBox?: NormalizedBox;
  /** Provenance required before subject geometry may enter the manifest. */
  evidenceSource?: 'vision' | 'manual_reviewed';
}

export interface EmphasisBudget {
  min: number;
  max: number;
}

export interface EmphasisTimelineV1 {
  schemaVersion: typeof EMPHASIS_TIMELINE_SCHEMA_VERSION;
  captions: CaptionSegment[];
  emphasisEvents: EmphasisEvent[];
}

/** Canonical manifest shape consumed by preview and export renderers. */
export interface EmphasisPlanV1 {
  schemaVersion: typeof EMPHASIS_TIMELINE_SCHEMA_VERSION;
  profile: EmphasisProfile;
  captions: CaptionSegment[];
  events: EmphasisEvent[];
  maxEvents?: number;
}

export interface SelectEmphasisTimelineInput {
  durationMs: number;
  candidates: unknown[];
  placementWindows?: EmphasisPlacementWindow[];
  /** Override only for an editor-authored timeline or an experiment. */
  budget?: Partial<EmphasisBudget>;
  /** Default 1200 ms. Hook -> reveal is allowed to use 500 ms. */
  minimumGapMs?: number;
}

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const finite = (value: unknown, fallback: number): number => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value: unknown, min: number, max: number, fallback: number): number =>
  Math.max(min, Math.min(max, finite(value, fallback)));
const cleanId = (value: unknown, fallback: string): string => {
  const result = String(value || '').trim().replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 96);
  return result || fallback;
};
const cleanText = (value: unknown, max = 160): string => String(value || '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const textKey = (value: string | undefined): string => String(value || '')
  .toLocaleLowerCase().replace(/[\s，。！？；：、,.!?;:'"“”‘’()（）【】\[\]-]/g, '');

export function deriveEmphasisIntent(
  type: EmphasisEventType,
  value: string | undefined,
): { visualIntent: EmphasisVisualIntent; assetIntent: EmphasisAssetIntent } {
  const content = String(value || '');
  if (/警告|注意|避免|禁止|切勿|请勿|风险|warning|caution|avoid/i.test(content)) {
    return { visualIntent: 'warning', assetIntent: 'warning_marker' };
  }
  if (/限时|立即|马上|仅剩|最后\s*\d+|倒计时|urgent|limited time|now/i.test(content)) {
    return { visualIntent: 'urgency', assetIntent: 'urgency_badge' };
  }
  if (type === 'cta') return { visualIntent: 'cta', assetIntent: 'cta_marker' };
  if (type === 'reveal') return { visualIntent: 'focus_product', assetIntent: 'product_marker' };
  if (type === 'section_label') return { visualIntent: 'attention', assetIntent: 'section_marker' };
  if (type === 'key_fact' && /产品|材质|包装|结构|尺寸|规格|面膜|台面|product|material|package/i.test(content)) {
    return { visualIntent: 'focus_product', assetIntent: 'product_marker' };
  }
  return type === 'key_fact'
    ? { visualIntent: 'attention', assetIntent: 'fact_label' }
    : { visualIntent: 'attention', assetIntent: 'attention_marker' };
}

export function emphasisBudgetForDuration(durationMs: number): EmphasisBudget {
  const seconds = Math.max(0, finite(durationMs, 0)) / 1_000;
  if (seconds <= 15) return { min: 2, max: 4 };
  if (seconds <= 30) return { min: 4, max: 8 };
  if (seconds <= 60) return { min: 6, max: 12 };
  // For long-form work, calculate by chapters of roughly 20–30 seconds.
  return { min: Math.ceil(seconds / 30) * 2, max: Math.ceil(seconds / 20) * 4 };
}

export function normalizeCaptionSegments(input: unknown, durationMs: number): CaptionSegment[] {
  const duration = Math.max(0, finite(durationMs, 0));
  return (Array.isArray(input) ? input : []).slice(0, 2_000).map((value, index) => {
    const raw = asRecord(value);
    const startMs = clamp(raw.startMs, 0, duration, 0);
    const endMs = clamp(raw.endMs, startMs, duration, Math.min(duration, startMs + 2_000));
    const text = cleanText(raw.text, 500);
    if (!text || endMs <= startMs) return null;
    const keywords = [...new Set((Array.isArray(raw.keywords) ? raw.keywords : [])
      .map(item => cleanText(item, 40)).filter(Boolean))].filter(item => text.includes(item)).slice(0, 12);
    const speakerId = cleanId(raw.speakerId, '');
    return {
      id: cleanId(raw.id, `caption-${index + 1}`),
      startMs: Math.round(startMs), endMs: Math.round(endMs), text,
      ...(speakerId ? { speakerId } : {}), ...(keywords.length ? { keywords } : {}),
    } satisfies CaptionSegment;
  }).filter((item): item is CaptionSegment => Boolean(item))
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
}

const normalizedBox = (value: unknown): NormalizedBox | undefined => {
  const raw = asRecord(value);
  if (![raw.x, raw.y, raw.width, raw.height].every(item => Number.isFinite(Number(item)))) return undefined;
  const box = { x: Number(raw.x), y: Number(raw.y), width: Number(raw.width), height: Number(raw.height) };
  if (box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0 || box.x + box.width > 1 || box.y + box.height > 1) return undefined;
  return Object.fromEntries(Object.entries(box).map(([key, item]) => [key, Number(item.toFixed(4))])) as NormalizedBox;
};

export function normalizeShotWindows(input: unknown, durationMs: number): ShotWindow[] {
  const duration = Math.max(0, finite(durationMs, 0));
  return (Array.isArray(input) ? input : []).slice(0, 500).map((value, index): ShotWindow | null => {
    const raw = asRecord(value);
    const startMs = Math.round(clamp(raw.startMs, 0, duration, 0));
    const endMs = Math.round(clamp(raw.endMs, startMs, duration, startMs));
    const source = ['ffmpeg_scene', 'storyboard', 'fallback'].includes(String(raw.source))
      ? raw.source as ShotWindow['source'] : null;
    if (!source || endMs <= startMs) return null;
    return { id: cleanId(raw.id, `shot-${index + 1}`), startMs, endMs,
      confidence: Number(clamp(raw.confidence, 0, 1, source === 'fallback' ? .5 : 0).toFixed(4)), source };
  }).filter((item): item is ShotWindow => Boolean(item))
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
}

export function normalizeCaptionOccupancy(input: unknown, durationMs: number): CaptionOccupancy[] {
  const duration = Math.max(0, finite(durationMs, 0));
  return (Array.isArray(input) ? input : []).slice(0, 2_000).map((value, index): CaptionOccupancy | null => {
    const raw = asRecord(value);
    const source = raw.source === 'subtitle' || raw.source === 'ocr' ? raw.source : null;
    const startMs = Math.round(clamp(raw.startMs, 0, duration, 0));
    const endMs = Math.round(clamp(raw.endMs, startMs, duration, startMs));
    if (!source || endMs <= startMs) return null;
    const boxes = (Array.isArray(raw.boxes) ? raw.boxes : []).map(normalizedBox).filter((box): box is NormalizedBox => Boolean(box));
    const occupancyText = cleanText(raw.text, 500);
    return { id: cleanId(raw.id, `occupancy-${index + 1}`), startMs, endMs,
      ...(occupancyText ? { text: occupancyText } : {}), boxes,
      confidence: Number(clamp(raw.confidence, 0, 1, source === 'subtitle' ? 1 : 0).toFixed(4)),
      source, editable: source === 'subtitle' && raw.editable !== false };
  }).filter((item): item is CaptionOccupancy => Boolean(item));
}

export function normalizeVisualEvidence(input: unknown): VisualEvidence[] {
  return (Array.isArray(input) ? input : []).slice(0, 500).map((value): VisualEvidence | null => {
    const raw = asRecord(value);
    const shotId = cleanId(raw.shotId, '');
    const subjectType = ['person', 'product', 'machine', 'process', 'unknown'].includes(String(raw.subjectType))
      ? raw.subjectType as VisualEvidence['subjectType'] : 'unknown';
    const confidence = clamp(raw.confidence, 0, 1, 0);
    if (!shotId || confidence < .68) return null;
    const normalizedSubjectBox = normalizedBox(raw.subjectBox);
    // A nearly full-frame box describes the scene instead of a bindable
    // subject. Preserve the anchor so layout can derive a local proxy.
    const subjectBox = normalizedSubjectBox && normalizedSubjectBox.width * normalizedSubjectBox.height <= .72
      ? normalizedSubjectBox : undefined;
    const point = asRecord(raw.subjectAnchor);
    const subjectAnchor = Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y))
      && Number(point.x) >= 0 && Number(point.x) <= 1 && Number(point.y) >= 0 && Number(point.y) <= 1
      ? { x: Number(Number(point.x).toFixed(4)), y: Number(Number(point.y).toFixed(4)) } : undefined;
    const safeZones = (Array.isArray(raw.safeZones) ? raw.safeZones : []).flatMap(value => {
      const box = normalizedBox(value);
      if (!box) return [];
      return [{ ...box, clarity: Number(clamp(asRecord(value).clarity, 0, 1, 0).toFixed(4)) }];
    });
    const captionBoxes = (Array.isArray(raw.captionBoxes) ? raw.captionBoxes : []).map(normalizedBox).filter((box): box is NormalizedBox => Boolean(box));
    return { shotId, subjectType, ...(subjectBox ? { subjectBox } : {}), ...(subjectAnchor ? { subjectAnchor } : {}),
      safeZones, captionBoxes, confidence: Number(confidence.toFixed(4)) };
  }).filter((item): item is VisualEvidence => Boolean(item));
}

export function normalizeEmphasisCandidates(input: unknown, durationMs: number): EmphasisEvent[] {
  const duration = Math.max(0, finite(durationMs, 0));
  return (Array.isArray(input) ? input : []).slice(0, 500).map((value, index): EmphasisEvent | null => {
    const raw = asRecord(value);
    const type = EMPHASIS_EVENT_TYPES.includes(String(raw.type) as EmphasisEventType)
      ? raw.type as EmphasisEventType : null;
    const source = EMPHASIS_SOURCES.includes(String(raw.source) as EmphasisEventSource)
      ? raw.source as EmphasisEventSource : null;
    if (!type || !source) return null;
    const startMs = clamp(raw.startMs, 0, duration, 0);
    const endMs = clamp(raw.endMs, startMs, duration, Math.min(duration, startMs + 2_000));
    if (endMs <= startMs) return null;
    const text = cleanText(raw.text);
    const targetId = cleanId(raw.targetId, '');
    const shotId = cleanId(raw.shotId, '');
    const evidenceStartMs = Math.round(clamp(raw.evidenceStartMs, 0, duration, startMs));
    const evidenceEndMs = Math.round(clamp(raw.evidenceEndMs, evidenceStartMs, duration, endMs));
    const presentationMode = EMPHASIS_PRESENTATION_MODES.includes(String(raw.presentationMode) as EmphasisPresentationMode)
      ? raw.presentationMode as EmphasisPresentationMode : undefined;
    const targetRelation = EMPHASIS_TARGET_RELATIONS.includes(String(raw.targetRelation) as EmphasisTargetRelation)
      ? raw.targetRelation as EmphasisTargetRelation : undefined;
    const occupiedBoxes = (Array.isArray(raw.occupiedBoxes) ? raw.occupiedBoxes : [])
      .map(normalizedBox).filter((box): box is NormalizedBox => Boolean(box)).slice(0, 24);
    const strength = raw.strength === 'weak' || raw.strength === 'strong' ? raw.strength : undefined;
    const anchor = asRecord(raw.anchor);
    const hasAnchor = Number.isFinite(Number(anchor.x)) && Number.isFinite(Number(anchor.y));
    const placement = asRecord(raw.placementEvidence);
    const placementWindowId = cleanId(placement.windowId, '');
    const derivedIntent = deriveEmphasisIntent(type, text);
    // Intent is derived from event semantics. Callers cannot select arbitrary
    // asset categories by attaching a valid-looking enum to unrelated text.
    const visualIntent = derivedIntent.visualIntent;
    const assetIntent = derivedIntent.assetIntent;
    const confidence = clamp(raw.confidence, 0, 1, 0);
    // Commercial facts must be supported. Editor-authored values already went
    // through human review, while other low-confidence facts fall back to speech.
    if (type === 'key_fact' && source !== 'editor' && confidence < .72) return null;
    return {
      id: cleanId(raw.id, `emphasis-${index + 1}`), type,
      startMs: Math.round(startMs), endMs: Math.round(endMs),
      ...(text ? { text } : {}),
      importance: Math.round(clamp(raw.importance, 1, 3, 1)) as EmphasisImportance,
      confidence: Number(confidence.toFixed(4)), source,
      ...(targetId ? { targetId } : {}),
      ...(shotId ? { shotId } : {}),
      ...(Number.isFinite(Number(raw.evidenceStartMs)) ? { evidenceStartMs } : {}),
      ...(Number.isFinite(Number(raw.evidenceEndMs)) ? { evidenceEndMs } : {}),
      ...(presentationMode ? { presentationMode } : {}),
      ...(targetRelation ? { targetRelation } : {}),
      ...(occupiedBoxes.length ? { occupiedBoxes } : {}),
      visualIntent,
      assetIntent,
      ...(strength ? { strength } : {}),
      ...(hasAnchor ? { anchor: {
        x: Number(clamp(anchor.x, .05, .95, .5).toFixed(4)),
        y: Number(clamp(anchor.y, .05, .95, .2).toFixed(4)),
      } } : {}),
      ...(typeof raw.safeArea === 'boolean' ? { safeArea: raw.safeArea } : {}),
      ...(placementWindowId ? { placementEvidence: {
        windowId: placementWindowId,
        ...(cleanId(placement.targetId, '') ? { targetId: cleanId(placement.targetId, '') } : {}),
        clarity: Number(clamp(placement.clarity, 0, 1, .5).toFixed(4)),
        safe: placement.safe !== false,
      } } : {}),
    } satisfies EmphasisEvent;
  }).filter((item): item is EmphasisEvent => Boolean(item));
}

const TYPE_RANK: Record<EmphasisEventType, number> = {
  hook: 6, key_fact: 5, reveal: 4, section_label: 2, cta: 1,
};

function candidateScore(event: EmphasisEvent): number {
  const sourceBoost = event.source === 'editor' ? 1 : event.source === 'metadata' ? .35 : 0;
  return TYPE_RANK[event.type] * 10 + event.importance * 3 + event.confidence + sourceBoost;
}

function placeOnBestWindow(event: EmphasisEvent, windows: EmphasisPlacementWindow[]): EmphasisEvent {
  if (!event.targetId) return event;
  const matches = windows.filter(window => window.safe !== false
    && window.endMs > window.startMs && window.targetIds?.includes(event.targetId!));
  if (!matches.length) return event;
  const best = matches.sort((left, right) => finite(right.clarity, .5) - finite(left.clarity, .5)
    || (right.endMs - right.startMs) - (left.endMs - left.startMs))[0]!;
  const originalDuration = Math.max(500, event.endMs - event.startMs);
  const startMs = Math.max(0, Math.round(best.startMs));
  const anchor = asRecord(best.anchor);
  const hasAnchor = Number.isFinite(Number(anchor.x)) && Number.isFinite(Number(anchor.y));
  const subjectAnchor = asRecord(best.subjectAnchor);
  const hasSubjectAnchor = Number.isFinite(Number(subjectAnchor.x)) && Number.isFinite(Number(subjectAnchor.y))
    && Number(subjectAnchor.x) >= 0 && Number(subjectAnchor.x) <= 1 && Number(subjectAnchor.y) >= 0 && Number(subjectAnchor.y) <= 1;
  const subjectBox = asRecord(best.subjectBox);
  const hasSubjectBox = Number.isFinite(Number(subjectBox.x)) && Number.isFinite(Number(subjectBox.y))
    && Number.isFinite(Number(subjectBox.width)) && Number.isFinite(Number(subjectBox.height))
    && Number(subjectBox.x) >= 0 && Number(subjectBox.y) >= 0 && Number(subjectBox.width) > 0 && Number(subjectBox.height) > 0
    && Number(subjectBox.x) + Number(subjectBox.width) <= 1 && Number(subjectBox.y) + Number(subjectBox.height) <= 1;
  const trustedSubjectGeometry = best.safe !== false && finite(best.clarity, 0) >= .7
    && (best.evidenceSource === 'vision' || best.evidenceSource === 'manual_reviewed');
  return {
    ...event,
    startMs,
    endMs: Math.min(Math.round(best.endMs), startMs + originalDuration),
    ...(hasAnchor ? { anchor: {
      x: Number(clamp(anchor.x, .05, .95, .5).toFixed(4)),
      y: Number(clamp(anchor.y, .05, .95, .2).toFixed(4)),
    } } : {}),
    ...(trustedSubjectGeometry && hasSubjectAnchor ? { subjectAnchor: {
      x: Number(Number(subjectAnchor.x).toFixed(4)), y: Number(Number(subjectAnchor.y).toFixed(4)),
    } } : {}),
    ...(trustedSubjectGeometry && hasSubjectBox ? { subjectBox: {
      x: Number(Number(subjectBox.x).toFixed(4)), y: Number(Number(subjectBox.y).toFixed(4)),
      width: Number(Number(subjectBox.width).toFixed(4)), height: Number(Number(subjectBox.height).toFixed(4)),
    } } : {}),
    safeArea: best.safe !== false,
    placementEvidence: {
      windowId: cleanId(best.id, 'placement-window'),
      targetId: event.targetId,
      clarity: Number(clamp(best.clarity, 0, 1, .5).toFixed(4)),
      safe: best.safe !== false,
    },
  };
}

/** Selects the sparse, whole-film emphasis layer from a larger candidate set. */
export function selectEmphasisTimeline(input: SelectEmphasisTimelineInput): EmphasisEvent[] {
  const durationMs = Math.max(0, finite(input.durationMs, 0));
  const defaults = emphasisBudgetForDuration(durationMs);
  const max = Math.max(0, Math.round(clamp(input.budget?.max, 0, 500, defaults.max)));
  const minimumGapMs = Math.round(clamp(input.minimumGapMs, 0, 10_000, 1_200));
  const windows = (input.placementWindows || []).filter(window => Number.isFinite(window.startMs) && Number.isFinite(window.endMs));
  const normalized = normalizeEmphasisCandidates(input.candidates, durationMs).map(event => placeOnBestWindow(event, windows));

  // The same semantic claim is emphasized once. Prefer human review, clearer
  // evidence, higher importance, then the earliest complete occurrence.
  const deduplicated = new Map<string, EmphasisEvent>();
  for (const event of normalized) {
    const semantic = event.targetId || textKey(event.text) || event.id;
    const key = `${event.type}:${semantic}`;
    const previous = deduplicated.get(key);
    if (!previous || candidateScore(event) > candidateScore(previous)
      || (candidateScore(event) === candidateScore(previous) && event.startMs < previous.startMs)) {
      deduplicated.set(key, event);
    }
  }

  const ranked = [...deduplicated.values()].sort((left, right) => candidateScore(right) - candidateScore(left)
    || left.startMs - right.startMs);
  const selected: EmphasisEvent[] = [];
  for (const event of ranked) {
    if (selected.length >= max) break;
    const conflicts = selected.some(existing => {
      const overlap = event.startMs < existing.endMs && existing.startMs < event.endMs;
      const gap = Math.max(existing.startMs - event.endMs, event.startMs - existing.endMs);
      const hookRevealPair = (event.type === 'hook' && existing.type === 'reveal')
        || (event.type === 'reveal' && existing.type === 'hook');
      return overlap || gap < (hookRevealPair ? Math.min(500, minimumGapMs) : minimumGapMs);
    });
    if (!conflicts) selected.push(event);
  }
  return selected.sort((left, right) => left.startMs - right.startMs || candidateScore(right) - candidateScore(left));
}

/** Normalizes untrusted persisted/agent output into the complete two-layer model. */
export function normalizeEmphasisTimeline(
  input: unknown,
  durationMs: number,
  placementWindows: EmphasisPlacementWindow[] = [],
): EmphasisTimelineV1 {
  const raw = asRecord(input);
  return {
    schemaVersion: EMPHASIS_TIMELINE_SCHEMA_VERSION,
    captions: normalizeCaptionSegments(raw.captions, durationMs),
    emphasisEvents: selectEmphasisTimeline({
      durationMs,
      candidates: Array.isArray(raw.emphasisEvents) ? raw.emphasisEvents : [],
      placementWindows,
    }),
  };
}

/** Canonical `manifest.emphasisPlan` boundary. */
export function normalizeEmphasisPlan(
  input: unknown,
  durationMs: number,
  placementWindows: EmphasisPlacementWindow[] = [],
): EmphasisPlanV1 {
  const raw = asRecord(input);
  const profile = EMPHASIS_PROFILES.includes(String(raw.profile) as EmphasisProfile)
    ? raw.profile as EmphasisProfile : 'talking_head';
  const defaultBudget = emphasisBudgetForDuration(durationMs);
  const maxEvents = Math.round(clamp(raw.maxEvents, 0, 500, defaultBudget.max));
  return {
    schemaVersion: EMPHASIS_TIMELINE_SCHEMA_VERSION,
    profile,
    captions: normalizeCaptionSegments(raw.captions, durationMs),
    events: selectEmphasisTimeline({
      durationMs,
      candidates: Array.isArray(raw.events) ? raw.events : Array.isArray(raw.emphasisEvents) ? raw.emphasisEvents : [],
      placementWindows,
      budget: { max: maxEvents },
    }),
    maxEvents,
  };
}
