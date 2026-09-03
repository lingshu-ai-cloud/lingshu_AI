/**
 * Safely orchestrate the P1 trilingual digital-human acceptance project.
 *
 * The default `plan` stage is read-only. Every data mutation additionally
 * requires --apply and a stage-specific acknowledgement. Render authorization
 * is deliberately separate because POST /render consumes quota; this script
 * never invokes the local renderer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  performancePlanFingerprint,
  planDigitalHumanPerformance,
  type AvatarMotionClip,
  type DigitalHumanPerformancePlan,
} from '../src/lib/digitalHumanPerformance.js';
import { DIGITAL_HUMAN_PIPELINE_VERSION } from '../src/lib/digitalHumanPipeline.js';
import {
  resolveShotDigitalHumanSpeechSegment,
  shotDigitalHumanSignature,
  shotDigitalHumanSourceFingerprint,
  type ShotDigitalHumanBinding,
  type ShotDigitalHumanCue,
} from '../src/lib/shotDigitalHuman.js';
import {
  DIGITAL_HUMAN_RENDER_DURATION_SECONDS,
  DIGITAL_HUMAN_TERMINAL_TOLERANCE_SECONDS,
  assertDigitalHumanTtsDuration,
  assertRequestedDigitalHumanProvenance,
  buildDigitalHumanSegmentProvenance,
  freezeDigitalHumanSegments,
  type DigitalHumanSegmentProvenance,
  type FrozenDigitalHumanSegments,
} from '../server/lib/digitalHumanTimelineIntegrity.js';

export const DEFAULT_PROJECT_ID = 'studio_projects_39999d09854248e78a2c6a0822ba37a1';
export const PERFORMANCE_PROFILE_SCHEMA_VERSION = 'digital-human-p1-motion-profile-v1' as const;
export const DEFAULT_PERFORMANCE_PROFILE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'config',
  'digital-human-p1-cta-emphasis-cta.json',
);
export const REQUIRED_LANGUAGES = ['zh', 'en', 'es'] as const;
export const REQUIRED_DIGITAL_SLOTS = ['slot-1', 'slot-2', 'slot-4'] as const;
const TERMINAL_FAILURES = new Set(['failed', 'review', 'cancelled']);
const ACTIVE_STATUSES = new Set(['queued', 'submitting', 'processing', 'quality_check']);

export type Language = typeof REQUIRED_LANGUAGES[number];
export type Stage = 'plan' | 'submit' | 'poll' | 'save' | 'render-plan' | 'authorize-render';

type JsonRecord = Record<string, unknown>;

export interface CliOptions {
  baseUrl: string;
  projectId: string;
  stages: Stage[];
  apply: boolean;
  allowRemote: boolean;
  confirmRights: boolean;
  confirmEditorClosed: boolean;
  confirmRenderQuota: boolean;
  avatarId?: string;
  performanceProfilePath: string;
  authorizationOutput?: string;
  pollIntervalSeconds: number;
  pollTimeoutMinutes: number;
  targetDuration: number;
  performanceRevision: number;
}

export interface StudioProject {
  id: string;
  title: string;
  status: 'draft' | 'published' | 'template';
  spec: JsonRecord;
  thumbSeed?: string;
}

export interface Material {
  id: string;
  name: string;
  folder?: string;
  type: 'video' | 'image' | 'audio';
  duration: number;
  width?: number;
  height?: number;
  url?: string;
  scope?: 'shared' | 'own';
  sourceType?: string;
  assetRole?: 'avatar_master' | 'avatar_motion_clip' | 'generated_clip';
  rightsStatus?: 'internal_test' | 'commercial_cleared' | 'restricted';
  rightsUsageScope?: string[];
  productionReady?: boolean;
  avatarId?: string;
  avatarVersion?: number;
  motionClip?: AvatarMotionClip;
}

export interface DigitalHumanJob {
  id: string;
  batchId?: string;
  projectId?: string;
  storyboardSlotId?: string;
  audioStartSeconds?: number;
  audioEndSeconds?: number;
  inputSignature?: string;
  sourceFingerprint?: string;
  performanceSignature?: string;
  avatarMaterialId: string;
  language: string;
  status: 'queued' | 'submitting' | 'processing' | 'quality_check' | 'review' | 'completed' | 'failed' | 'cancelled';
  outputMaterialId?: string;
  resultSha256?: string;
  qualityReport?: {
    passed?: boolean;
    validationStatus?: string;
    reviewRequired?: boolean;
    outputSha256?: string;
    gateVersion?: string;
    validatorVersion?: string;
    renderTreatmentAudit?: unknown;
    serverValidation?: { passed?: boolean };
    gateFailures?: string[];
  };
  motionClipIds?: string[];
  performancePlan?: AuditedPerformancePlan;
  pipelineVersion?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt?: string;
}

interface VoiceAudio {
  url: string;
  duration: number;
  cues: ShotDigitalHumanCue[];
}

export interface StoryboardSlot {
  id: string;
  start: number;
  end: number;
  title: string;
  detail: string;
}

export interface PreparedVariant {
  key: string;
  slotId: string;
  language: Language;
  avatarMaterialId: string;
  inputSignature: string;
  sourceFingerprint: string;
  performanceSignature: string;
  motionClipIds: string[];
  performanceRevision: number;
  performancePreset: 'commerce';
  motionProfileId: string;
  performanceProfileFingerprint: string;
  beatStrategy: 'single_continuous_clip';
  originalBeatCount: number;
  orchestrationAuditFingerprint: string;
  speech: { text: string; start: number; end: number };
  request: {
    audioStartSeconds: number;
    audioEndSeconds: number;
    inputSignature: string;
    voiceoverUrl: string;
    script: string;
    language: Language;
    performancePlanVersion: 'performance-v1';
    performancePlan: AuditedPerformancePlan;
    motionClipIds: string[];
    pipelineVersion: string;
  };
}

export interface PreparedPlan {
  project: StudioProject;
  avatar: Material;
  performanceProfile: PerformanceProfile;
  slots: StoryboardSlot[];
  materials: Material[];
  variants: PreparedVariant[];
  batches: Array<{
    projectId: string;
    storyboardSlotId: string;
    avatarMaterialId: string;
    mode: 'quality';
    usagePurpose: 'internal_preview';
    consentConfirmed: true;
    variants: PreparedVariant['request'][];
  }>;
}

export type ProfileGesture = Exclude<AvatarMotionClip['gesture'], 'idle'>;

export interface MotionProfileSelection {
  motionProfileId: string;
  gesture: ProfileGesture;
  beatStrategy: 'single_continuous_clip';
  motionClipIds: string[];
}

export interface PerformanceProfile {
  schemaVersion: typeof PERFORMANCE_PROFILE_SCHEMA_VERSION;
  profileId: string;
  avatarMaterialId: string;
  languages: Record<Language, Record<typeof REQUIRED_DIGITAL_SLOTS[number], MotionProfileSelection>>;
  fingerprint: string;
}

export type AuditedPerformancePlan = DigitalHumanPerformancePlan & {
  orchestrationProfile: {
    schemaVersion: typeof PERFORMANCE_PROFILE_SCHEMA_VERSION;
    profileId: string;
    fingerprint: string;
    avatarMaterialId: string;
    language: Language;
    slotId: typeof REQUIRED_DIGITAL_SLOTS[number];
    motionProfileId: string;
    gesture: ProfileGesture;
    beatStrategy: 'single_continuous_clip';
    motionClipIds: string[];
    originalBeatCount: number;
    mergeRule: 'highest_intensity_then_earliest;action_peak=duration_intensity_weighted_mean';
    dominantSourceBeatId: string;
    sourceBeatDecisions: Array<{
      id: string;
      text: string;
      startMs: number;
      endMs: number;
      intent: string;
      emotion: string;
      intensity: number;
      expression: string;
      head: string;
      gaze: string;
      gesture: string;
      actionPeakMs: number;
    }>;
    mergedDecision: {
      expression: string;
      head: string;
      gaze: string;
      gesture: ProfileGesture;
      actionPeakMs: number;
    };
  };
};

export type AuditedShotDigitalHumanBinding = ShotDigitalHumanBinding & {
  performanceProfileId: string;
  performanceProfileFingerprint: string;
  motionProfileId: string;
  beatStrategy: 'single_continuous_clip';
  originalBeatCount: number;
  orchestrationAuditFingerprint: string;
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as JsonRecord;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function exactKeys(record: JsonRecord, expected: readonly string[], label: string): void {
  const actual = Object.keys(record).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new Error(`${label} must contain exactly: ${required.join(', ')}`);
  }
}

const PROFILE_GESTURES = new Set<ProfileGesture>([
  'open_palm', 'emphasis', 'point_left', 'point_right', 'count_one', 'count_two', 'count_three', 'product_hold', 'cta',
]);

export function parsePerformanceProfile(value: unknown): PerformanceProfile {
  const root = plainRecord(value);
  exactKeys(root, ['schemaVersion', 'profileId', 'avatarMaterialId', 'languages'], 'performance profile');
  if (root.schemaVersion !== PERFORMANCE_PROFILE_SCHEMA_VERSION) throw new Error(`Unsupported performance profile schema: ${String(root.schemaVersion || '')}`);
  const profileId = String(root.profileId || '').trim();
  const avatarMaterialId = String(root.avatarMaterialId || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{2,119}$/i.test(profileId)) throw new Error('performance profileId is invalid');
  if (!avatarMaterialId || avatarMaterialId.length > 160) throw new Error('performance avatarMaterialId is invalid');
  const rawLanguages = plainRecord(root.languages);
  exactKeys(rawLanguages, REQUIRED_LANGUAGES, 'performance profile languages');
  const languages = {} as PerformanceProfile['languages'];
  for (const language of REQUIRED_LANGUAGES) {
    const rawSlots = plainRecord(rawLanguages[language]);
    exactKeys(rawSlots, REQUIRED_DIGITAL_SLOTS, `${language} motion slots`);
    const parsedSlots = {} as PerformanceProfile['languages'][Language];
    let previousGesture: ProfileGesture | undefined;
    for (const slotId of REQUIRED_DIGITAL_SLOTS) {
      const rawSelection = plainRecord(rawSlots[slotId]);
      exactKeys(rawSelection, ['motionProfileId', 'gesture', 'beatStrategy', 'motionClipIds'], `${language}/${slotId}`);
      const motionProfileId = String(rawSelection.motionProfileId || '').trim();
      const gesture = String(rawSelection.gesture || '') as ProfileGesture;
      const beatStrategy = String(rawSelection.beatStrategy || '');
      const motionClipIds = Array.isArray(rawSelection.motionClipIds)
        ? rawSelection.motionClipIds.map(item => String(item || '').trim())
        : [];
      if (!/^[a-z0-9][a-z0-9._-]{2,119}$/i.test(motionProfileId)) throw new Error(`${language}/${slotId} motionProfileId is invalid`);
      if (!PROFILE_GESTURES.has(gesture)) throw new Error(`${language}/${slotId} gesture is invalid`);
      if (beatStrategy !== 'single_continuous_clip') throw new Error(`${language}/${slotId} beatStrategy must be single_continuous_clip`);
      if (motionClipIds.length !== 1 || motionClipIds.some(id => !id || id.length > 200)) {
        throw new Error(`${language}/${slotId} single_continuous_clip must explicitly list exactly one motionClipId`);
      }
      if (previousGesture === gesture) throw new Error(`${language} adjacent digital slots cannot repeat gesture ${gesture}`);
      previousGesture = gesture;
      parsedSlots[slotId] = { motionProfileId, gesture, beatStrategy, motionClipIds };
    }
    languages[language] = parsedSlots;
  }
  const normalized = { schemaVersion: PERFORMANCE_PROFILE_SCHEMA_VERSION, profileId, avatarMaterialId, languages };
  const fingerprint = createHash('sha256').update(canonicalJson(normalized)).digest('hex');
  return { ...normalized, fingerprint };
}

export function loadPerformanceProfile(filename: string): PerformanceProfile {
  const resolved = path.resolve(filename);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error(`Performance profile file does not exist: ${resolved}`);
  let parsed: unknown;
  try { parsed = JSON.parse(fs.readFileSync(resolved, 'utf8')); }
  catch (error) { throw new Error(`Performance profile is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  return parsePerformanceProfile(parsed);
}

export interface SingleContinuousBeatAudit {
  originalBeatCount: number;
  mergeRule: 'highest_intensity_then_earliest;action_peak=duration_intensity_weighted_mean';
  dominantSourceBeatId: string;
  sourceBeatDecisions: AuditedPerformancePlan['orchestrationProfile']['sourceBeatDecisions'];
  mergedDecision: AuditedPerformancePlan['orchestrationProfile']['mergedDecision'];
}

/**
 * Convert a semantic multi-beat plan into one executable beat so one source
 * motion video remains continuous for the entire shot. Nothing is silently
 * discarded: every original semantic decision is retained in the audit, and
 * the executable expression/head/gaze come from the deterministic dominant
 * beat (highest intensity, then earliest). The action peak is the
 * duration×intensity-weighted mean of all source peaks.
 */
export function mergePerformancePlanToSingleContinuousClip(
  source: DigitalHumanPerformancePlan,
  selection: MotionProfileSelection,
): { plan: DigitalHumanPerformancePlan; audit: SingleContinuousBeatAudit } {
  if (selection.beatStrategy !== 'single_continuous_clip' || selection.motionClipIds.length !== 1) {
    throw new Error('single_continuous_clip requires exactly one explicitly configured motion clip');
  }
  if (!source.beats.length) throw new Error('Cannot merge an empty semantic performance plan');
  const sourceBeatDecisions = source.beats.map(beat => ({
    id: beat.id,
    text: beat.text,
    startMs: beat.startMs,
    endMs: beat.endMs,
    intent: beat.intent,
    emotion: beat.emotion,
    intensity: beat.intensity,
    expression: beat.expression,
    head: beat.head,
    gaze: beat.gaze,
    gesture: beat.gesture,
    actionPeakMs: beat.actionPeakMs,
  }));
  const dominant = source.beats
    .map((beat, index) => ({ beat, index }))
    .sort((left, right) => right.beat.intensity - left.beat.intensity || left.index - right.index)[0]!.beat;
  const weighted = source.beats.map(beat => ({
    weight: Math.max(1, beat.endMs - beat.startMs) * Math.max(0.01, beat.intensity),
    actionPeakMs: beat.actionPeakMs,
  }));
  const weightTotal = weighted.reduce((sum, item) => sum + item.weight, 0);
  const rawPeak = weighted.reduce((sum, item) => sum + item.actionPeakMs * item.weight, 0) / weightTotal;
  const margin = Math.min(80, source.durationMs * 0.1);
  const actionPeakMs = Math.round(Math.max(margin + 1, Math.min(source.durationMs - margin - 1, rawPeak)));
  const mergedBeat = {
    ...dominant,
    id: 'beat-merged-continuous',
    text: source.beats.map(beat => beat.text).join(' ').trim(),
    startMs: 0,
    endMs: source.durationMs,
    gesture: selection.gesture,
    actionPeakMs,
    motionClipId: selection.motionClipIds[0],
  };
  const mergedDecision = {
    expression: mergedBeat.expression,
    head: mergedBeat.head,
    gaze: mergedBeat.gaze,
    gesture: selection.gesture,
    actionPeakMs,
  };
  return {
    plan: { ...source, beats: [mergedBeat] },
    audit: {
      originalBeatCount: source.beats.length,
      mergeRule: 'highest_intensity_then_earliest;action_peak=duration_intensity_weighted_mean',
      dominantSourceBeatId: dominant.id,
      sourceBeatDecisions,
      mergedDecision,
    },
  };
}

function numericFlag(raw: string | undefined, fallback: number, minimum: number, maximum: number, name: string): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function flagValues(argv: string[]): { values: Map<string, string>; switches: Set<string> } {
  const values = new Map<string, string>();
  const switches = new Set<string>();
  const valueFlags = new Set([
    'base-url', 'project-id', 'stages', 'avatar-id', 'performance-profile', 'authorization-output',
    'poll-interval-seconds', 'poll-timeout-minutes', 'target-duration', 'performance-revision',
  ]);
  const switchFlags = new Set(['apply', 'allow-remote', 'confirm-rights', 'confirm-editor-closed', 'confirm-render-quota', 'help']);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith('--')) throw new Error(`Unexpected positional argument: ${token}`);
    const equalIndex = token.indexOf('=');
    const key = token.slice(2, equalIndex > 0 ? equalIndex : undefined);
    if (switchFlags.has(key)) {
      if (equalIndex > 0) throw new Error(`--${key} does not accept a value`);
      switches.add(key);
      continue;
    }
    if (!valueFlags.has(key)) throw new Error(`Unknown option: --${key}`);
    const value = equalIndex > 0 ? token.slice(equalIndex + 1) : argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`--${key} requires a value`);
    values.set(key, value);
  }
  return { values, switches };
}

function isLoopbackBaseUrl(raw: string): boolean {
  const url = new URL(raw);
  return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
}

export function parseCliOptions(argv: string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  const { values, switches } = flagValues(argv);
  const baseUrl = String(values.get('base-url') || env.LINGSHU_BASE_URL || 'http://127.0.0.1:8788').replace(/\/+$/, '');
  const parsedBase = new URL(baseUrl);
  if (!['http:', 'https:'].includes(parsedBase.protocol) || parsedBase.username || parsedBase.password) {
    throw new Error('--base-url must be an HTTP(S) origin without embedded credentials');
  }
  if (parsedBase.pathname !== '/' || parsedBase.search || parsedBase.hash) throw new Error('--base-url must be an origin without a path, query, or hash');
  const stages = String(values.get('stages') || 'plan').split(',').map(item => item.trim()).filter(Boolean) as Stage[];
  const allowedStages = new Set<Stage>(['plan', 'submit', 'poll', 'save', 'render-plan', 'authorize-render']);
  if (!stages.length || stages.some(stage => !allowedStages.has(stage))) throw new Error('--stages contains an unsupported stage');
  const uniqueStages = [...new Set(stages)];
  const options: CliOptions = {
    baseUrl,
    projectId: values.get('project-id') || DEFAULT_PROJECT_ID,
    stages: uniqueStages,
    apply: switches.has('apply'),
    allowRemote: switches.has('allow-remote'),
    confirmRights: switches.has('confirm-rights'),
    confirmEditorClosed: switches.has('confirm-editor-closed'),
    confirmRenderQuota: switches.has('confirm-render-quota'),
    avatarId: values.get('avatar-id'),
    performanceProfilePath: path.resolve(values.get('performance-profile') || env.LINGSHU_PERFORMANCE_PROFILE || DEFAULT_PERFORMANCE_PROFILE_PATH),
    authorizationOutput: values.get('authorization-output'),
    pollIntervalSeconds: numericFlag(values.get('poll-interval-seconds'), 5, 1, 60, '--poll-interval-seconds'),
    pollTimeoutMinutes: numericFlag(values.get('poll-timeout-minutes'), 90, 1, 720, '--poll-timeout-minutes'),
    targetDuration: numericFlag(values.get('target-duration'), 15, 5, 300, '--target-duration'),
    performanceRevision: Math.floor(numericFlag(values.get('performance-revision'), 0, 0, 10_000, '--performance-revision')),
  };
  validateSafetyOptions(options);
  return options;
}

export function validateSafetyOptions(options: CliOptions): void {
  if (!isLoopbackBaseUrl(options.baseUrl) && !options.allowRemote) {
    throw new Error('Remote base URL refused; add --allow-remote only after verifying the target tenant');
  }
  const mutates = options.stages.some(stage => ['submit', 'save', 'authorize-render'].includes(stage));
  if (mutates && !options.apply) throw new Error('Mutating stages require --apply');
  if (options.stages.includes('submit') && !options.confirmRights) throw new Error('submit requires --confirm-rights');
  if (options.stages.includes('save') && !options.confirmEditorClosed) {
    throw new Error('save requires --confirm-editor-closed to prevent browser autosave from overwriting the result');
  }
  if (options.stages.includes('authorize-render')) {
    if (!options.confirmRenderQuota) throw new Error('authorize-render requires --confirm-render-quota');
    if (!options.stages.includes('render-plan')) throw new Error('authorize-render requires render-plan in the same run');
    if (!options.authorizationOutput) throw new Error('authorize-render requires --authorization-output <new-file>');
  }
}

export class StudioApiClient {
  private token = '';

  constructor(private readonly baseUrl: string, private readonly env: NodeJS.ProcessEnv = process.env) {}

  async authenticate(): Promise<void> {
    if (this.env.LINGSHU_TOKEN?.trim()) {
      this.token = this.env.LINGSHU_TOKEN.trim();
      return;
    }
    const email = this.env.LINGSHU_EMAIL?.trim();
    const password = this.env.LINGSHU_PASSWORD;
    if (!email || !password) throw new Error('Set LINGSHU_TOKEN, or both LINGSHU_EMAIL and LINGSHU_PASSWORD');
    const payload = await this.request<JsonRecord>('/api/overseas/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password }), headers: { 'Content-Type': 'application/json' },
    }, false);
    if (typeof payload.token !== 'string' || !payload.token) throw new Error('Login response did not contain a token');
    this.token = payload.token;
  }

  async get<T>(pathname: string): Promise<T> {
    return this.request<T>(`/api/overseas/studio/${pathname.replace(/^\/+/, '')}`, { method: 'GET' });
  }

  async post<T>(pathname: string, body: unknown): Promise<T> {
    return this.request<T>(`/api/overseas/studio/${pathname.replace(/^\/+/, '')}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  }

  private async request<T>(pathname: string, init: RequestInit, authenticated = true): Promise<T> {
    const response = await fetch(new URL(pathname, this.baseUrl), {
      ...init,
      headers: { ...(init.headers || {}), ...(authenticated ? { Authorization: `Bearer ${this.token}` } : {}) },
    });
    const payload = await response.json().catch(() => ({})) as JsonRecord;
    if (!response.ok) {
      const message = typeof payload.error === 'string' ? payload.error : typeof payload.message === 'string' ? payload.message : `HTTP ${response.status}`;
      const code = typeof payload.code === 'string' ? ` (${payload.code})` : '';
      throw new Error(`${message}${code}`);
    }
    return payload as T;
  }
}

function plainRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function finite(value: unknown, fallback = 0): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

export function parseStoryboardSlots(script: string): StoryboardSlot[] {
  const lines = String(script || '').split(/\r?\n/);
  const slots: StoryboardSlot[] = [];
  let current: { start: number; end: number; lines: string[] } | undefined;
  const push = () => {
    if (!current) return;
    const detail = current.lines.join(' ').replace(/\s+/g, ' ').trim();
    const title = detail.match(/(?:景别|Shot)\s*[：:]\s*([^；;。]+)/i)?.[1]
      || detail.match(/(?:画面|Visual)\s*[：:]\s*([^；;。]+)/i)?.[1]
      || `分镜 ${slots.length + 1}`;
    slots.push({ id: `slot-${slots.length + 1}`, start: current.start, end: current.end, title: title.trim().slice(0, 80), detail });
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const range = line.match(/\[\s*(?:start|开始|\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–—]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*\]/i);
    if (range) {
      push();
      const first = range[0]!.match(/(?:start|开始|\d+(?:\.\d+)?)/i)?.[0] || '0';
      const start = /start|开始/i.test(first) ? 0 : Number(first);
      const end = Number(range[1]);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error(`Invalid storyboard time range: ${range[0]}`);
      current = { start, end, lines: [line.replace(range[0], '').trim()].filter(Boolean) };
    } else if (current) current.lines.push(line);
  }
  push();
  return slots.slice(0, 12);
}

function languageKey(slotId: string, language: string): string {
  return `${language}::${slotId}`;
}

function normalizeCues(value: unknown): ShotDigitalHumanCue[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    const cue = plainRecord(item);
    return { text: String(cue.text || ''), start: finite(cue.start), end: finite(cue.end) };
  }).filter(cue => cue.text.trim() && cue.start >= 0 && cue.end > cue.start);
}

function voiceForLanguage(spec: JsonRecord, language: Language): VoiceAudio {
  const stale = Array.isArray(spec.voiceoverStaleLangs) ? spec.voiceoverStaleLangs.map(String) : [];
  if (stale.includes(language)) throw new Error(`${language} voiceover is marked stale`);
  if (spec.voiceoverMode !== 'ai') throw new Error('P1 trilingual orchestration requires voiceoverMode=ai');
  const audio = plainRecord(plainRecord(spec.voiceoverAudios)[language]);
  const aligned = normalizeCues(plainRecord(spec.alignedCuesByLang)[language]);
  const fallbackCues = normalizeCues(audio.cues);
  const result = {
    url: String(audio.url || ''),
    duration: finite(audio.duration),
    cues: aligned.length ? aligned : fallbackCues,
  };
  if (!result.url || result.duration <= 0 || !result.cues.length) throw new Error(`${language} voiceover URL, duration, or cues are missing`);
  return result;
}

function assertAssetUsage(material: Material, role: string): void {
  if (material.productionReady !== true) throw new Error(`${role} ${material.id} is not production-ready`);
  if (material.rightsStatus !== 'commercial_cleared') throw new Error(`${role} ${material.id} lacks commercial clearance`);
  if (!material.rightsUsageScope?.includes('internal_preview')) throw new Error(`${role} ${material.id} does not allow internal_preview`);
}

function resolveAvatar(materials: Material[], requestedId: string): Material {
  const candidates = materials.filter(item => item.type === 'video' && item.assetRole === 'avatar_master');
  const avatar = candidates.find(item => item.id === requestedId);
  if (!avatar) throw new Error(`Profile avatar ${requestedId} is unavailable; no default avatar fallback is allowed`);
  assertAssetUsage(avatar, 'avatar');
  if (avatar.width !== 1080 || avatar.height !== 1920) throw new Error(`Avatar ${avatar.id} must be 1080x1920 for this acceptance run`);
  return avatar;
}

export function buildPreparedPlan(input: {
  project: StudioProject;
  materials: Material[];
  performanceProfile: PerformanceProfile;
  avatarId?: string;
  performanceRevision?: number;
}): PreparedPlan {
  const { project, materials, performanceProfile } = input;
  if (project.id !== DEFAULT_PROJECT_ID && !project.id.trim()) throw new Error('Project ID is empty');
  const spec = plainRecord(project.spec);
  if (String(spec.ratio || '') !== '9:16') throw new Error('Acceptance project ratio must be 9:16');
  const script = String(spec.script || '');
  const slots = parseStoryboardSlots(script).sort((a, b) => a.start - b.start);
  if (slots.length !== 4 || slots.some((slot, index) => slot.id !== `slot-${index + 1}`)) {
    throw new Error(`Acceptance project must contain exactly four timestamped slots; found ${slots.length}`);
  }
  const lastEnd = slots.at(-1)?.end || 0;
  if (Math.abs(lastEnd - 15) > 0.05) throw new Error(`Storyboard must end at 15 seconds; found ${lastEnd}`);
  const mediaModes = plainRecord(spec.shotMediaModes);
  for (const slotId of REQUIRED_DIGITAL_SLOTS) {
    if (mediaModes[slotId] !== 'digital') throw new Error(`${slotId} must use digital-human media mode`);
  }
  if (mediaModes['slot-3'] === 'digital') throw new Error('slot-3 must remain B-roll');

  if (input.avatarId && input.avatarId !== performanceProfile.avatarMaterialId) {
    throw new Error(`--avatar-id ${input.avatarId} conflicts with profile avatar ${performanceProfile.avatarMaterialId}`);
  }
  const avatar = resolveAvatar(materials, performanceProfile.avatarMaterialId);
  const avatarIdentity = avatar.avatarId || avatar.id;
  const motionMaterials = materials.filter(item => item.assetRole === 'avatar_motion_clip' && item.avatarId === avatarIdentity && item.motionClip);
  if (!motionMaterials.length) throw new Error(`Avatar ${avatar.id} has no motion pack`);
  motionMaterials.forEach(material => assertAssetUsage(material, 'motion clip'));
  const materialByMotionId = new Map<string, Material>();
  motionMaterials.forEach(item => {
    materialByMotionId.set(item.id, item);
    if (item.motionClip?.id) materialByMotionId.set(item.motionClip.id, item);
  });

  const voiceDrafts = plainRecord(spec.voiceDrafts);
  const voiceByLanguage = Object.fromEntries(REQUIRED_LANGUAGES.map(language => [language, voiceForLanguage(spec, language)])) as Record<Language, VoiceAudio>;
  const performanceRevision = Math.max(0, Math.floor(input.performanceRevision || 0));
  const variants: PreparedVariant[] = [];
  for (const slot of slots) {
    if (!REQUIRED_DIGITAL_SLOTS.includes(slot.id as typeof REQUIRED_DIGITAL_SLOTS[number])) continue;
    const slotIndex = slots.findIndex(item => item.id === slot.id);
    for (const language of REQUIRED_LANGUAGES) {
      const voice = voiceByLanguage[language];
      const localizedScript = String(voiceDrafts[language] || '').trim();
      if (!localizedScript) throw new Error(`${language} voice draft is missing`);
      const fallbackScale = voice.duration / lastEnd;
      const speech = resolveShotDigitalHumanSpeechSegment({
        fullScript: localizedScript,
        slotIndex,
        slotCount: slots.length,
        cues: voice.cues,
        fallbackStart: slot.start * fallbackScale,
        fallbackEnd: slot.end * fallbackScale,
      });
      if (!speech.text.trim() || speech.end <= speech.start) throw new Error(`${language}/${slot.id} speech segment is invalid`);
      const generatedPerformancePlan = planDigitalHumanPerformance({
        script: speech.text,
        durationMs: Math.max(1000, Math.round((speech.end - speech.start) * 1000)),
        preset: 'commerce',
        sceneIndex: slotIndex,
        variationSeed: performanceRevision,
      });
      const profileSelection = performanceProfile.languages[language][slot.id as typeof REQUIRED_DIGITAL_SLOTS[number]];
      if (!profileSelection) throw new Error(`${language}/${slot.id} is missing from the explicit performance profile`);
      const motionClipIds = [...profileSelection.motionClipIds];
      for (const motionId of motionClipIds) {
        const motionMaterial = materialByMotionId.get(motionId);
        if (!motionMaterial?.motionClip) throw new Error(`Profile motion ${motionId} has no authorized material; no automatic fallback is allowed`);
        if (motionMaterial.motionClip.gesture !== profileSelection.gesture) {
          throw new Error(`${language}/${slot.id} expects ${profileSelection.gesture}, but ${motionId} is ${motionMaterial.motionClip.gesture}`);
        }
      }
      const merged = mergePerformancePlanToSingleContinuousClip(generatedPerformancePlan, profileSelection);
      const orchestrationProfile: AuditedPerformancePlan['orchestrationProfile'] = {
        schemaVersion: PERFORMANCE_PROFILE_SCHEMA_VERSION,
        profileId: performanceProfile.profileId,
        fingerprint: performanceProfile.fingerprint,
        avatarMaterialId: performanceProfile.avatarMaterialId,
        language,
        slotId: slot.id as typeof REQUIRED_DIGITAL_SLOTS[number],
        motionProfileId: profileSelection.motionProfileId,
        gesture: profileSelection.gesture,
        beatStrategy: profileSelection.beatStrategy,
        motionClipIds,
        ...merged.audit,
      };
      const performancePlan: AuditedPerformancePlan = {
        ...merged.plan,
        orchestrationProfile,
      };
      const orchestrationAuditFingerprint = createHash('sha256').update(canonicalJson(orchestrationProfile)).digest('hex');
      const auditedPlanFingerprint = `${performancePlanFingerprint(performancePlan)}|profile:${performanceProfile.fingerprint}|motion-profile:${profileSelection.motionProfileId}|orchestration:${orchestrationAuditFingerprint}`;
      const sourceInput = {
        slotId: slot.id,
        script: speech.text,
        language,
        voiceoverUrl: voice.url,
        start: speech.start,
        end: speech.end,
        avatarMaterialId: avatar.id,
        avatarVersion: avatar.avatarVersion,
        pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
      };
      const sourceFingerprint = shotDigitalHumanSourceFingerprint(sourceInput);
      const performanceSignature = shotDigitalHumanSignature({
        ...sourceInput,
        performancePlanVersion: 'performance-v1',
        performancePlanFingerprint: auditedPlanFingerprint,
        motionClipIds,
        scenePlanFingerprint: JSON.stringify(performancePlan.scene),
        pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
      });
      const request: PreparedVariant['request'] = {
        audioStartSeconds: speech.start,
        audioEndSeconds: speech.end,
        inputSignature: performanceSignature,
        voiceoverUrl: voice.url,
        script: speech.text,
        language,
        performancePlanVersion: 'performance-v1',
        performancePlan,
        motionClipIds,
        pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
      };
      variants.push({
        key: languageKey(slot.id, language), slotId: slot.id, language, avatarMaterialId: avatar.id,
        inputSignature: performanceSignature, sourceFingerprint, performanceSignature,
        motionClipIds, performanceRevision, performancePreset: 'commerce',
        motionProfileId: profileSelection.motionProfileId,
        performanceProfileFingerprint: performanceProfile.fingerprint,
        beatStrategy: profileSelection.beatStrategy,
        originalBeatCount: merged.audit.originalBeatCount,
        orchestrationAuditFingerprint,
        speech: { text: speech.text, start: speech.start, end: speech.end }, request,
      });
    }
  }
  if (variants.length !== REQUIRED_DIGITAL_SLOTS.length * REQUIRED_LANGUAGES.length) {
    throw new Error(`Expected 9 digital-human variants; found ${variants.length}`);
  }
  const batches = REQUIRED_DIGITAL_SLOTS.map(storyboardSlotId => ({
    projectId: project.id,
    storyboardSlotId,
    avatarMaterialId: avatar.id,
    mode: 'quality' as const,
    usagePurpose: 'internal_preview' as const,
    consentConfirmed: true as const,
    variants: variants.filter(item => item.slotId === storyboardSlotId).map(item => item.request),
  }));
  return { project, avatar, performanceProfile, slots, materials, variants, batches };
}

function orchestrationFingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function latestMatchingJob(jobs: DigitalHumanJob[], variant: PreparedVariant): DigitalHumanJob | undefined {
  const matching = jobs.filter(job => Boolean(job.inputSignature && job.performanceSignature === job.inputSignature));
  return matching
    .filter(job => job.storyboardSlotId === variant.slotId
      && job.language.replace(/_/g, '-').toLowerCase() === variant.language
      && job.avatarMaterialId === variant.avatarMaterialId
      && job.performanceSignature === job.inputSignature
      && job.sourceFingerprint === variant.sourceFingerprint
      && job.pipelineVersion === DIGITAL_HUMAN_PIPELINE_VERSION
      && JSON.stringify(job.motionClipIds || []) === JSON.stringify(variant.motionClipIds)
      && job.performancePlan?.orchestrationProfile?.fingerprint === variant.performanceProfileFingerprint
      && job.performancePlan?.orchestrationProfile?.motionProfileId === variant.motionProfileId
      && job.performancePlan?.orchestrationProfile?.beatStrategy === variant.beatStrategy
      && job.performancePlan?.orchestrationProfile?.originalBeatCount === variant.originalBeatCount
      && job.performancePlan?.beats?.length === 1
      && orchestrationFingerprint(job.performancePlan?.orchestrationProfile) === variant.orchestrationAuditFingerprint)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
}

export function matchDesiredJobs(plan: PreparedPlan, jobs: DigitalHumanJob[]): Map<string, DigitalHumanJob> {
  const matches = new Map<string, DigitalHumanJob>();
  for (const variant of plan.variants) {
    const job = latestMatchingJob(jobs.filter(item => item.projectId === plan.project.id), variant);
    if (job) matches.set(variant.key, job);
  }
  return matches;
}

export interface VerifiedResult {
  variant: PreparedVariant;
  job: DigitalHumanJob;
  material: Material;
  provenance: DigitalHumanSegmentProvenance;
}

function assertJobIdentity(plan: PreparedPlan, variant: PreparedVariant, job: DigitalHumanJob): void {
  if (job.projectId !== plan.project.id
    || job.storyboardSlotId !== variant.slotId
    || job.language.replace(/_/g, '-').toLowerCase() !== variant.language
    || job.avatarMaterialId !== variant.avatarMaterialId
    || !job.inputSignature
    || job.performanceSignature !== job.inputSignature
    || job.sourceFingerprint !== variant.sourceFingerprint) {
    throw new Error(`Job ${job.id} does not exactly match ${variant.key}`);
  }
  if (job.pipelineVersion !== DIGITAL_HUMAN_PIPELINE_VERSION) throw new Error(`Job ${job.id} is not a ${DIGITAL_HUMAN_PIPELINE_VERSION} task`);
  if (JSON.stringify(job.motionClipIds || []) !== JSON.stringify(variant.motionClipIds)) {
    throw new Error(`Job ${job.id} motion selection does not match ${variant.key}`);
  }
  const audit = plainRecord(job.performancePlan?.orchestrationProfile);
  if (audit.profileId !== plan.performanceProfile.profileId
    || audit.fingerprint !== variant.performanceProfileFingerprint
    || audit.avatarMaterialId !== plan.avatar.id
    || audit.language !== variant.language
    || audit.slotId !== variant.slotId
    || audit.motionProfileId !== variant.motionProfileId
    || audit.beatStrategy !== variant.beatStrategy
    || audit.originalBeatCount !== variant.originalBeatCount
    || orchestrationFingerprint(audit) !== variant.orchestrationAuditFingerprint
    || canonicalJson(audit) !== canonicalJson(variant.request.performancePlan.orchestrationProfile)) {
    throw new Error(`Job ${job.id} lacks the exact audited performance profile for ${variant.key}`);
  }
  const executableBeat = job.performancePlan?.beats?.[0];
  const mergedDecision = plainRecord(audit.mergedDecision);
  const sourceDecisions = Array.isArray(audit.sourceBeatDecisions) ? audit.sourceBeatDecisions : [];
  if (!executableBeat || job.performancePlan?.beats.length !== 1
    || sourceDecisions.length !== variant.originalBeatCount
    || mergedDecision.expression !== executableBeat.expression
    || mergedDecision.head !== executableBeat.head
    || mergedDecision.gaze !== executableBeat.gaze
    || mergedDecision.gesture !== executableBeat.gesture
    || mergedDecision.actionPeakMs !== executableBeat.actionPeakMs) {
    throw new Error(`Job ${job.id} continuous-beat audit is incomplete or inconsistent for ${variant.key}`);
  }
}

export function assertCompletedJobResult(
  plan: PreparedPlan,
  variant: PreparedVariant,
  job: DigitalHumanJob,
  material: Material | undefined,
): asserts material is Material {
  assertJobIdentity(plan, variant, job);
  if (job.status !== 'completed') throw new Error(`${variant.key} job ${job.id} is ${job.status}, not completed`);
  if (job.qualityReport?.passed !== true) {
    throw new Error(`${variant.key} failed closed because its server quality report did not pass`);
  }
  if (!job.outputMaterialId || !material || material.id !== job.outputMaterialId) {
    throw new Error(`${variant.key} completed job has no matching output material`);
  }
  if (material.type !== 'video' || finite(material.duration) <= 0 || !material.url) {
    throw new Error(`${variant.key} output material is not a playable non-empty video`);
  }
  if (material.sourceType !== 'digital-human' && material.assetRole !== 'generated_clip') {
    throw new Error(`${variant.key} output material is not server-marked as digital-human generated`);
  }
  const provenance = buildDigitalHumanSegmentProvenance(job);
  if (provenance.outputMaterialId !== material.id
    || Math.abs(provenance.audioStartSeconds - variant.speech.start) > 0.002
    || Math.abs(provenance.audioEndSeconds - variant.speech.end) > 0.002) {
    throw new Error(`${variant.key} Worker proof does not match its verified material or speech cue`);
  }
}

export async function submitBatches(api: StudioApiClient, plan: PreparedPlan): Promise<Map<string, DigitalHumanJob>> {
  const submitted: DigitalHumanJob[] = [];
  // Requests are intentionally sequential. The API persists a queue, and the
  // 8 GB local GPU Worker continues claiming exactly one child job at a time.
  for (const batch of plan.batches) {
    const response = await api.post<{ ok: boolean; jobs?: DigitalHumanJob[] }>('digital-human/job-batches', batch);
    if (!response.ok || !Array.isArray(response.jobs) || response.jobs.length !== REQUIRED_LANGUAGES.length) {
      throw new Error(`${batch.storyboardSlotId} batch did not return all three language jobs`);
    }
    submitted.push(...response.jobs);
  }
  const matches = matchDesiredJobs(plan, submitted);
  if (matches.size !== plan.variants.length) throw new Error(`Submitted response matched ${matches.size}/9 exact variants`);
  return matches;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export async function pollJobs(
  api: StudioApiClient,
  plan: PreparedPlan,
  initial: Map<string, DigitalHumanJob>,
  intervalSeconds: number,
  timeoutMinutes: number,
): Promise<Map<string, DigitalHumanJob>> {
  if (initial.size !== plan.variants.length) throw new Error(`Cannot poll: found ${initial.size}/9 exact jobs`);
  const deadline = Date.now() + timeoutMinutes * 60_000;
  const current = new Map(initial);
  while (Date.now() < deadline) {
    let complete = 0;
    for (const variant of plan.variants) {
      const known = current.get(variant.key);
      if (!known) throw new Error(`Cannot poll missing job ${variant.key}`);
      const detail = await api.get<{ ok: boolean; job?: DigitalHumanJob }>(`digital-human/jobs/${encodeURIComponent(known.id)}`);
      if (!detail.ok || !detail.job) throw new Error(`Job detail missing for ${variant.key}`);
      assertJobIdentity(plan, variant, detail.job);
      current.set(variant.key, detail.job);
      if (detail.job.status === 'completed') complete += 1;
      else if (TERMINAL_FAILURES.has(detail.job.status)) {
        throw new Error(`${variant.key} stopped at ${detail.job.status}: ${detail.job.errorCode || detail.job.errorMessage || 'quality/provider failure'}`);
      } else if (!ACTIVE_STATUSES.has(detail.job.status)) {
        throw new Error(`${variant.key} returned unknown non-terminal status ${detail.job.status}`);
      }
    }
    process.stdout.write(`[poll] ${complete}/${plan.variants.length} completed\n`);
    if (complete === plan.variants.length) return current;
    await delay(intervalSeconds * 1000);
  }
  throw new Error(`Polling timed out after ${timeoutMinutes} minutes; no data was saved`);
}

export async function verifyCompletedJobs(
  api: StudioApiClient,
  plan: PreparedPlan,
  jobs: Map<string, DigitalHumanJob>,
): Promise<Map<string, VerifiedResult>> {
  if (jobs.size !== plan.variants.length) throw new Error(`Cannot verify: found ${jobs.size}/9 exact jobs`);
  const verified = new Map<string, VerifiedResult>();
  for (const variant of plan.variants) {
    const candidate = jobs.get(variant.key);
    if (!candidate) throw new Error(`Missing exact job for ${variant.key}`);
    const detail = await api.get<{ ok: boolean; job?: DigitalHumanJob; outputMaterial?: Material }>(
      `digital-human/jobs/${encodeURIComponent(candidate.id)}`,
    );
    if (!detail.ok || !detail.job) throw new Error(`Job detail missing for ${variant.key}`);
    assertCompletedJobResult(plan, variant, detail.job, detail.outputMaterial);
    verified.set(variant.key, {
      variant,
      job: detail.job,
      material: detail.outputMaterial,
      provenance: buildDigitalHumanSegmentProvenance(detail.job),
    });
  }
  return verified;
}

function activeAssemblyAssignments(spec: JsonRecord): Record<string, string> {
  const assemblies = Array.isArray(spec.storyboardAssemblies) ? spec.storyboardAssemblies.map(plainRecord) : [];
  const activeId = String(spec.activeAssemblyId || '');
  const active = assemblies.find(item => item.id === activeId) || assemblies[0];
  const source = active ? plainRecord(active.assignments) : plainRecord(spec.storyboardAssignments);
  return Object.fromEntries(Object.entries(source).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1])));
}

export function assertProjectInputsUnchanged(freshProject: StudioProject, plan: PreparedPlan): void {
  const revision = plan.variants[0]?.performanceRevision || 0;
  const freshPlan = buildPreparedPlan({
    project: freshProject,
    materials: plan.materials,
    performanceProfile: plan.performanceProfile,
    avatarId: plan.avatar.id,
    performanceRevision: revision,
  });
  const original = new Map(plan.variants.map(item => [item.key, item.inputSignature]));
  for (const variant of freshPlan.variants) {
    if (original.get(variant.key) !== variant.inputSignature) {
      throw new Error(`Project input changed while jobs were running (${variant.key}); refusing stale save/render`);
    }
  }
}

export function mergeVerifiedProject(
  freshProject: StudioProject,
  plan: PreparedPlan,
  verified: Map<string, VerifiedResult>,
): StudioProject {
  if (freshProject.id !== plan.project.id) throw new Error('Fresh project ID changed during save preparation');
  if (verified.size !== plan.variants.length) throw new Error('Refusing partial save: all 9 results must be verified');
  assertProjectInputsUnchanged(freshProject, plan);
  const spec = { ...plainRecord(freshProject.spec) };
  const assignments: Record<string, string> = {
    ...Object.fromEntries(Object.entries(plainRecord(spec.storyboardAssignments)).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
    ...activeAssemblyAssignments(spec),
  };
  const bindings: Record<string, ShotDigitalHumanBinding | AuditedShotDigitalHumanBinding> = {
    ...plainRecord(spec.shotDigitalHumanBindings) as Record<string, ShotDigitalHumanBinding>,
  };
  const preferred = { ...plainRecord(spec.shotPreferredAvatarIds) } as Record<string, string>;
  const mediaModes = { ...plainRecord(spec.shotMediaModes) } as Record<string, string>;
  for (const [key, result] of verified) {
    assignments[key] = result.material.id;
    preferred[result.variant.slotId] = plan.avatar.id;
    mediaModes[result.variant.slotId] = 'digital';
    bindings[key] = {
      jobId: result.job.id,
      avatarMaterialId: plan.avatar.id,
      status: 'completed',
      inputSignature: result.job.inputSignature!,
      sourceFingerprint: result.variant.sourceFingerprint,
      performanceSignature: result.job.performanceSignature,
      outputMaterialId: result.material.id,
      motionClipIds: result.variant.motionClipIds,
      performanceRevision: result.variant.performanceRevision,
      performancePreset: result.variant.performancePreset,
      performanceProfileId: plan.performanceProfile.profileId,
      performanceProfileFingerprint: result.variant.performanceProfileFingerprint,
      motionProfileId: result.variant.motionProfileId,
      beatStrategy: result.variant.beatStrategy,
      originalBeatCount: result.variant.originalBeatCount,
      orchestrationAuditFingerprint: result.variant.orchestrationAuditFingerprint,
    };
  }
  const selected = [...new Set([
    ...(Array.isArray(spec.selected) ? spec.selected.map(String) : []),
    ...Object.values(assignments),
  ])];
  const activeId = String(spec.activeAssemblyId || '');
  const assemblies = (Array.isArray(spec.storyboardAssemblies) ? spec.storyboardAssemblies : []).map(item => {
    const assembly = plainRecord(item);
    if (String(assembly.id || '') !== activeId) return assembly;
    return { ...assembly, assignments: { ...plainRecord(assembly.assignments), ...assignments }, selected };
  });
  if (!assemblies.length || !assemblies.some(item => String(item.id || '') === activeId)) {
    throw new Error('Active storyboard assembly is missing; refusing a save that the UI would overwrite');
  }
  spec.storyboardAssignments = assignments;
  spec.shotDigitalHumanBindings = bindings;
  spec.shotPreferredAvatarIds = preferred;
  spec.shotMediaModes = mediaModes;
  spec.selected = selected;
  spec.storyboardAssemblies = assemblies;
  return { ...freshProject, spec };
}

export function assertSavedRoundTrip(project: StudioProject, plan: PreparedPlan, verified: Map<string, VerifiedResult>): void {
  const spec = plainRecord(project.spec);
  const assignments = activeAssemblyAssignments(spec);
  const topAssignments = plainRecord(spec.storyboardAssignments);
  const bindings = plainRecord(spec.shotDigitalHumanBindings);
  for (const [key, result] of verified) {
    if (assignments[key] !== result.material.id || topAssignments[key] !== result.material.id) {
      throw new Error(`Saved project lost ${key} assignment in top-level or active assembly state`);
    }
    const binding = plainRecord(bindings[key]);
    if (binding.jobId !== result.job.id || binding.outputMaterialId !== result.material.id
      || binding.inputSignature !== result.job.inputSignature
      || binding.sourceFingerprint !== result.variant.sourceFingerprint
      || binding.performanceSignature !== result.job.performanceSignature
      || binding.status !== 'completed'
      || binding.performanceProfileId !== plan.performanceProfile.profileId
      || binding.performanceProfileFingerprint !== result.variant.performanceProfileFingerprint
      || binding.motionProfileId !== result.variant.motionProfileId
      || binding.beatStrategy !== result.variant.beatStrategy
      || binding.originalBeatCount !== result.variant.originalBeatCount
      || binding.orchestrationAuditFingerprint !== result.variant.orchestrationAuditFingerprint) {
      throw new Error(`Saved project lost the verified ${key} binding`);
    }
  }
  if (verified.size !== plan.variants.length) throw new Error('Round-trip verification received a partial result set');
}

export interface RenderRequest {
  materials: string[];
  timeline: Array<{
    clipId: string;
    name: string;
    type: 'video' | 'image';
    trimStart: number;
    trimEnd: number;
    speed: number;
    targetStart: number;
    targetEnd: number;
    targetDuration: number;
    sourceType?: string;
    assetRole?: Material['assetRole'];
    digitalHumanGenerated?: boolean;
    avatarMaterialId?: string;
    performanceProfileFingerprint?: string;
    motionProfileId?: string;
    configuredGesture?: ProfileGesture;
    beatStrategy?: 'single_continuous_clip';
    originalBeatCount?: number;
    orchestrationAuditFingerprint?: string;
    mergedDecision?: AuditedPerformancePlan['orchestrationProfile']['mergedDecision'];
    digitalHumanSegment?: DigitalHumanSegmentProvenance;
  }>;
  script: string;
  voice: string;
  bgm: string;
  bgmVol: number;
  voiceVol: number;
  coverId: string;
  coverTitle: string;
  ratio: '9:16';
  duration: number;
  platform: string;
  language: Language;
  voiceoverUrl: string;
  subtitles: {
    mode: 'off' | 'target';
    style: JsonRecord;
    cues: ShotDigitalHumanCue[];
  };
  orchestrationProfile: {
    schemaVersion: typeof PERFORMANCE_PROFILE_SCHEMA_VERSION;
    profileId: string;
    fingerprint: string;
    avatarMaterialId: string;
    language: Language;
  };
  digitalHumanSegments: FrozenDigitalHumanSegments;
}

function cuesWithoutRetiming(cues: ShotDigitalHumanCue[], targetDuration: number): ShotDigitalHumanCue[] {
  return cues.map((cue, index) => {
    const start = Number(cue.start);
    const rawEnd = Number(cue.end);
    if (!Number.isFinite(start) || !Number.isFinite(rawEnd) || start < 0 || rawEnd <= start) {
      throw new Error(`Subtitle cue ${index} has an invalid absolute speech range`);
    }
    if (start > targetDuration || rawEnd > targetDuration + DIGITAL_HUMAN_TERMINAL_TOLERANCE_SECONDS) {
      throw new Error(`Subtitle cue ${index} extends beyond the allowed final tail tolerance`);
    }
    return {
      text: cue.text,
      start: +start.toFixed(3),
      end: +Math.min(rawEnd, targetDuration).toFixed(3),
    };
  }).filter(cue => cue.text.trim() && cue.end > cue.start);
}

function selectedBgm(spec: JsonRecord, language: Language): string {
  const activeAssemblyId = String(spec.activeAssemblyId || 'video-1');
  const materialVersionKey = `${encodeURIComponent(activeAssemblyId)}::${encodeURIComponent(language)}`;
  const byVersion = plainRecord(spec.materialVersionBgms)[materialVersionKey];
  const byAssembly = plainRecord(spec.assemblyBgms)[activeAssemblyId];
  return String(byVersion || byAssembly || spec.bgm || '');
}

export function buildRenderRequests(input: {
  project: StudioProject;
  plan: PreparedPlan;
  verified: Map<string, VerifiedResult>;
  targetDuration: number;
}): Record<Language, RenderRequest> {
  const { project, plan, verified, targetDuration } = input;
  if (verified.size !== plan.variants.length) throw new Error('Render planning requires all 9 verified outputs');
  if (Math.abs(targetDuration - DIGITAL_HUMAN_RENDER_DURATION_SECONDS) > 0.000_001) {
    throw new Error(`Digital-human final render duration must be exactly ${DIGITAL_HUMAN_RENDER_DURATION_SECONDS}s`);
  }
  const spec = plainRecord(project.spec);
  const assignments = activeAssemblyAssignments(spec);
  const materialById = new Map(plan.materials.map(material => [material.id, material]));
  for (const result of verified.values()) materialById.set(result.material.id, result.material);
  const scripts = plainRecord(spec.voiceDrafts);
  const result = {} as Record<Language, RenderRequest>;
  for (const language of REQUIRED_LANGUAGES) {
    const voice = voiceForLanguage(spec, language);
    assertDigitalHumanTtsDuration(voice.duration);
    const finalCueEnd = Math.max(...voice.cues.map(cue => Number(cue.end)));
    if (!Number.isFinite(finalCueEnd) || finalCueEnd > voice.duration + DIGITAL_HUMAN_TERMINAL_TOLERANCE_SECONDS) {
      throw new Error(`${language} absolute speech cues exceed the measured TTS duration`);
    }
    const localizedScript = String(scripts[language] || '').trim();
    const speechSegments = plan.slots.map((slot, slotIndex) => {
      const prepared = plan.variants.find(item => item.language === language && item.slotId === slot.id);
      const resolved = resolveShotDigitalHumanSpeechSegment({
        fullScript: localizedScript,
        slotIndex,
        slotCount: plan.slots.length,
        cues: voice.cues,
        fallbackStart: slot.start * voice.duration / 15,
        fallbackEnd: slot.end * voice.duration / 15,
      });
      if (prepared && (Math.abs(prepared.speech.start - resolved.start) > 0.002
        || Math.abs(prepared.speech.end - resolved.end) > 0.002)) {
        throw new Error(`${language}/${slot.id} prepared speech range no longer matches the real TTS cue`);
      }
      return prepared?.speech || resolved;
    });
    let cursor = 0;
    const timeline = plan.slots.map((slot, index) => {
      const digital = REQUIRED_DIGITAL_SLOTS.includes(slot.id as typeof REQUIRED_DIGITAL_SLOTS[number]);
      const output = digital ? verified.get(languageKey(slot.id, language)) : undefined;
      const materialId = output?.material.id || String(assignments[slot.id] || '');
      const material = output?.material || materialById.get(materialId);
      if (!material || !materialId || material.type === 'audio' || finite(material.duration) <= 0) {
        throw new Error(`${language}/${slot.id} does not resolve to a usable server-side material ID`);
      }
      if (digital && !output) throw new Error(`${language}/${slot.id} has no verified digital-human output`);
      const speech = speechSegments[index]!;
      const nextSpeech = speechSegments[index + 1];
      let targetStart = digital ? +speech.start.toFixed(3) : +cursor.toFixed(3);
      let targetEnd = digital
        ? +speech.end.toFixed(3)
        : +(nextSpeech ? nextSpeech.start : targetDuration).toFixed(3);
      if (index === plan.slots.length - 1) {
        if (digital && Math.abs(targetEnd - targetDuration) > DIGITAL_HUMAN_TERMINAL_TOLERANCE_SECONDS) {
          throw new Error(`${language}/${slot.id} verified speech end is too far from the 15s final boundary`);
        }
        targetEnd = targetDuration;
      }
      if (Math.abs(targetStart - cursor) > 0.002) {
        throw new Error(`${language}/${slot.id} real speech cues leave a gap or overlap at ${cursor.toFixed(3)}s`);
      }
      targetStart = +cursor.toFixed(3);
      const target = +(targetEnd - targetStart).toFixed(3);
      if (target < 0.5) throw new Error(`${language}/${slot.id} render segment is shorter than the renderer minimum`);
      if (digital && output) {
        const expectedProvenance = buildDigitalHumanSegmentProvenance(output.job);
        assertRequestedDigitalHumanProvenance(output.provenance, expectedProvenance);
        if (Math.abs(expectedProvenance.audioStartSeconds - speech.start) > 0.002
          || Math.abs(expectedProvenance.audioEndSeconds - speech.end) > 0.002) {
          throw new Error(`${language}/${slot.id} Worker audio range no longer matches the real TTS cue`);
        }
        const sourceDuration = expectedProvenance.audioEndSeconds - expectedProvenance.audioStartSeconds;
        if (Math.abs(finite(material.duration) - sourceDuration) > DIGITAL_HUMAN_TERMINAL_TOLERANCE_SECONDS) {
          throw new Error(`${language}/${slot.id} material duration does not match its immutable Worker audio segment`);
        }
      }
      const trimStart = 0;
      const trimEnd = digital && output
        ? +(output.provenance.audioEndSeconds - output.provenance.audioStartSeconds).toFixed(3)
        : +Math.min(finite(material.duration), Math.max(target, 0.5)).toFixed(3);
      cursor = targetEnd;
      return {
        clipId: material.id,
        name: material.name,
        type: material.type as 'video' | 'image',
        trimStart,
        trimEnd,
        speed: digital ? 1 : material.type === 'image' ? 1 : +Math.max(0.25, Math.min(4, (trimEnd - trimStart) / target)).toFixed(4),
        targetStart,
        targetEnd,
        targetDuration: +(targetEnd - targetStart).toFixed(3),
        sourceType: digital ? 'digital-human' : material.sourceType,
        assetRole: material.assetRole,
        digitalHumanGenerated: digital || undefined,
        avatarMaterialId: output?.variant.avatarMaterialId,
        performanceProfileFingerprint: output?.variant.performanceProfileFingerprint,
        motionProfileId: output?.variant.motionProfileId,
        configuredGesture: output?.variant.request.performancePlan.orchestrationProfile.gesture,
        beatStrategy: output?.variant.beatStrategy,
        originalBeatCount: output?.variant.originalBeatCount,
        orchestrationAuditFingerprint: output?.variant.orchestrationAuditFingerprint,
        mergedDecision: output?.variant.request.performancePlan.orchestrationProfile.mergedDecision,
        digitalHumanSegment: output?.provenance,
      };
    });
    const summed = timeline.reduce((sum, item) => sum + item.targetDuration, 0);
    if (Math.abs(summed - targetDuration) > 0.002 || timeline.at(-1)?.targetEnd !== targetDuration) {
      throw new Error(`${language} render timeline is not exactly ${targetDuration}s`);
    }
    const subtitlesOn = spec.subtitlesOn !== false;
    const coverStyle = plainRecord(spec.coverStyle);
    const digitalHumanSegments = freezeDigitalHumanSegments(timeline, targetDuration, language);
    result[language] = {
      materials: timeline.map(item => item.name),
      timeline,
      script: localizedScript,
      voice: String(spec.voice || ''),
      bgm: selectedBgm(spec, language),
      bgmVol: finite(spec.bgmVol, 35),
      voiceVol: finite(spec.voiceVol, 100),
      coverId: String(spec.cover || ''),
      coverTitle: String(spec.coverTitle || ''),
      ratio: '9:16',
      duration: targetDuration,
      platform: String(spec.platform || 'tiktok'),
      language,
      voiceoverUrl: voice.url,
      subtitles: subtitlesOn ? {
        mode: 'target',
        style: {
          font: coverStyle.font,
          color: coverStyle.color,
          weight: coverStyle.weight,
          fontFamily: coverStyle.fontFamily,
        },
        cues: cuesWithoutRetiming(voice.cues, targetDuration),
      } : { mode: 'off', style: {}, cues: [] },
      orchestrationProfile: {
        schemaVersion: PERFORMANCE_PROFILE_SCHEMA_VERSION,
        profileId: plan.performanceProfile.profileId,
        fingerprint: plan.performanceProfile.fingerprint,
        avatarMaterialId: plan.avatar.id,
        language,
      },
      digitalHumanSegments,
    };
  }
  return result;
}

function preflightAuthorizationOutput(filename: string): string {
  const resolved = path.resolve(filename);
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const relativeToRepository = path.relative(repositoryRoot, resolved);
  if (relativeToRepository === '' || (!relativeToRepository.startsWith('..') && !path.isAbsolute(relativeToRepository))) {
    throw new Error('Authorization output must be outside the repository to reduce accidental token commits');
  }
  if (fs.existsSync(resolved)) throw new Error(`Authorization output already exists: ${resolved}`);
  const parent = path.dirname(resolved);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error(`Authorization output parent directory does not exist: ${parent}`);
  }
  return resolved;
}

export async function authorizeRenderRequests(
  api: StudioApiClient,
  requests: Record<Language, RenderRequest>,
  outputFilename: string,
  sourceProjectId: string,
): Promise<string> {
  const resolved = preflightAuthorizationOutput(outputFilename);
  const batchKey = `p1-render:${createHash('sha256').update(canonicalJson({ sourceProjectId, requests })).digest('hex')}`;
  const descriptor = fs.openSync(resolved, 'wx', 0o600);
  try {
    fs.writeSync(descriptor, `${JSON.stringify({
      type: 'header',
      warning: 'Sensitive short-lived render authorizations. Do not commit this file.',
      createdAt: new Date().toISOString(),
    })}\n`, undefined, 'utf8');
    fs.fsyncSync(descriptor);
    const response = await api.post<JsonRecord>('render/authorizations/trilingual', {
      batchKey,
      sourceProjectId,
      renders: REQUIRED_LANGUAGES.map(language => ({ language, spec: requests[language] })),
    });
    const authorizations = Array.isArray(response.authorizations) ? response.authorizations.map(plainRecord) : [];
    if (response.ok !== true || response.batchKey !== batchKey || response.sourceProjectId !== sourceProjectId
      || !/^[a-f0-9]{64}$/.test(String(response.batchFingerprint || '')) || authorizations.length !== 3) {
      throw new Error('Trilingual render authorization response is incomplete');
    }
    const byLanguage = new Map(authorizations.map(item => [String(item.language || ''), item]));
    if (REQUIRED_LANGUAGES.some(language => !byLanguage.has(language))) {
      throw new Error('Trilingual render authorization response languages are incomplete');
    }
    fs.writeSync(descriptor, `${JSON.stringify({
      type: 'batch',
      batchKey,
      batchFingerprint: response.batchFingerprint,
      sourceProjectId,
      reused: response.reused === true,
    })}\n`, undefined, 'utf8');
    for (const language of REQUIRED_LANGUAGES) {
      const item = byLanguage.get(language)!;
      const manifest = plainRecord(item.manifest);
      const spec = plainRecord(manifest.spec);
      if (typeof item.token !== 'string' || !item.token || typeof item.expiresAt !== 'string'
        || typeof manifest.jobId !== 'string' || manifest.sourceProjectId !== sourceProjectId
        || spec.language !== language) {
        throw new Error(`${language} render authorization response is incomplete`);
      }
      fs.writeSync(descriptor, `${JSON.stringify({ type: 'authorization', language, response: item })}\n`, undefined, 'utf8');
    }
    fs.fsyncSync(descriptor);
  } catch (error) {
    fs.writeSync(descriptor, `${JSON.stringify({ type: 'failure', message: error instanceof Error ? error.message : 'unknown failure' })}\n`, undefined, 'utf8');
    fs.fsyncSync(descriptor);
    throw error;
  } finally {
    fs.closeSync(descriptor);
  }
  return resolved;
}

function printPlanSummary(
  plan: PreparedPlan,
  capabilities: JsonRecord,
  matching: Map<string, DigitalHumanJob>,
): void {
  const statuses = Object.fromEntries([...matching.entries()].map(([key, job]) => [key, job.status]));
  const summary = {
    dryRun: true,
    project: { id: plan.project.id, title: plan.project.title, ratio: plan.project.spec.ratio, duration: plan.project.spec.duration },
    pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
    providerAvailable: capabilities.available === true,
    provider: String(capabilities.provider || 'unknown'),
    avatar: { id: plan.avatar.id, name: plan.avatar.name, dimensions: `${plan.avatar.width}x${plan.avatar.height}` },
    performanceProfile: {
      schemaVersion: plan.performanceProfile.schemaVersion,
      profileId: plan.performanceProfile.profileId,
      fingerprint: plan.performanceProfile.fingerprint,
      avatarMaterialId: plan.performanceProfile.avatarMaterialId,
    },
    batches: plan.batches.map(batch => ({
      slotId: batch.storyboardSlotId,
      languages: batch.variants.map(variant => variant.language),
      scenes: batch.variants.map(variant => ({
        language: variant.language,
        camera: variant.performancePlan.scene.camera,
        composition: variant.performancePlan.scene.composition,
        motionClipIds: variant.motionClipIds,
        motionProfileId: variant.performancePlan.orchestrationProfile.motionProfileId,
        configuredGesture: variant.performancePlan.orchestrationProfile.gesture,
        beatStrategy: variant.performancePlan.orchestrationProfile.beatStrategy,
        originalBeatCount: variant.performancePlan.orchestrationProfile.originalBeatCount,
        mergedDecision: variant.performancePlan.orchestrationProfile.mergedDecision,
        orchestrationAuditFingerprint: createHash('sha256').update(canonicalJson(variant.performancePlan.orchestrationProfile)).digest('hex'),
      })),
    })),
    exactExistingJobs: { count: matching.size, statuses },
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

function printRenderPlanSummary(requests: Record<Language, RenderRequest>): void {
  const summary = Object.fromEntries(REQUIRED_LANGUAGES.map(language => {
    const request = requests[language];
    return [language, {
      ratio: request.ratio,
      duration: request.duration,
      voiceoverConfigured: Boolean(request.voiceoverUrl),
      cueCount: request.subtitles.cues.length,
      orchestrationProfile: request.orchestrationProfile,
      timeline: request.timeline.map(item => ({
        clipId: item.clipId,
        targetStart: item.targetStart,
        targetEnd: item.targetEnd,
        targetDuration: item.targetDuration,
        digitalHumanGenerated: Boolean(item.digitalHumanGenerated),
        avatarMaterialId: item.avatarMaterialId,
        performanceProfileFingerprint: item.performanceProfileFingerprint,
        motionProfileId: item.motionProfileId,
        configuredGesture: item.configuredGesture,
        beatStrategy: item.beatStrategy,
        originalBeatCount: item.originalBeatCount,
        orchestrationAuditFingerprint: item.orchestrationAuditFingerprint,
        mergedDecision: item.mergedDecision,
      })),
    }];
  }));
  // URLs, asset tokens, scripts, login data, and authorization tokens are
  // intentionally absent from console output.
  process.stdout.write(`[render-plan] ${JSON.stringify(summary, null, 2)}\n`);
}

export const HELP_TEXT = `Usage:
  npx tsx scripts/orchestrate-digital-human-p1.ts [options]

Safe default (authenticated GET requests only):
  --stages plan

Stages:
  plan, submit, poll, save, render-plan, authorize-render

Safety gates:
  --apply                    required by submit/save/authorize-render
  --confirm-rights           required by submit
  --confirm-editor-closed    required by save; close the browser editor first
  --confirm-render-quota     required by authorize-render
  --authorization-output F   required; F must not exist and must be outside repo
  --allow-remote             required for a non-loopback server

Configuration:
  --base-url URL             default LINGSHU_BASE_URL or http://127.0.0.1:8788
  --project-id ID            default ${DEFAULT_PROJECT_ID}
  --performance-profile F    explicit avatar and zh/en/es per-slot motion JSON
                             default ${DEFAULT_PERFORMANCE_PROFILE_PATH}
  --avatar-id ID             optional assertion; must equal profile avatar
  --performance-revision N   default 0; changes action variation/signatures
  --poll-interval-seconds N  default 5
  --poll-timeout-minutes N   default 90
  --target-duration N        default 15

Credentials are environment-only: LINGSHU_TOKEN, or LINGSHU_EMAIL plus
LINGSHU_PASSWORD. The authorization receipt is sensitive JSON Lines and must
not be committed. This tool obtains render authorization only; it does not
execute the renderer.
`;

export async function run(options: CliOptions, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const performanceProfile = loadPerformanceProfile(options.performanceProfilePath);
  const api = new StudioApiClient(options.baseUrl, env);
  await api.authenticate();
  const [project, materials, avatars, capabilities, listedJobs] = await Promise.all([
    api.get<StudioProject>(`projects/${encodeURIComponent(options.projectId)}`),
    api.get<Material[]>('materials?purpose=all'),
    api.get<{ items?: Material[]; preferredAvatarMaterialId?: string }>('digital-human/avatars?includeUnready=1'),
    api.get<JsonRecord>('digital-human/capabilities'),
    api.get<DigitalHumanJob[]>(`digital-human/jobs?projectId=${encodeURIComponent(options.projectId)}`),
  ]);
  const mergedMaterials = [...materials];
  for (const avatar of avatars.items || []) {
    if (!mergedMaterials.some(item => item.id === avatar.id)) mergedMaterials.push(avatar);
  }
  const plan = buildPreparedPlan({
    project,
    materials: mergedMaterials,
    performanceProfile,
    avatarId: options.avatarId,
    performanceRevision: options.performanceRevision,
  });
  if (String(capabilities.pipelineVersion || '') !== DIGITAL_HUMAN_PIPELINE_VERSION) {
    throw new Error(`Server pipeline ${String(capabilities.pipelineVersion || 'unknown')} does not match ${DIGITAL_HUMAN_PIPELINE_VERSION}`);
  }
  let jobs = matchDesiredJobs(plan, Array.isArray(listedJobs) ? listedJobs : []);
  printPlanSummary(plan, capabilities, jobs);

  if (options.stages.includes('submit')) {
    if (capabilities.available !== true) throw new Error(`Digital-human provider is unavailable: ${String(capabilities.unavailableReason || 'unknown reason')}`);
    jobs = await submitBatches(api, plan);
    process.stdout.write(`[submit] ${jobs.size}/9 exact P1 variants accepted or idempotently reused\n`);
  }
  if (options.stages.includes('poll')) {
    jobs = await pollJobs(api, plan, jobs, options.pollIntervalSeconds, options.pollTimeoutMinutes);
  }

  let verified: Map<string, VerifiedResult> | undefined;
  if (options.stages.some(stage => ['poll', 'save', 'render-plan', 'authorize-render'].includes(stage))) {
    verified = await verifyCompletedJobs(api, plan, jobs);
    process.stdout.write(`[verify] ${verified.size}/9 jobs and output materials passed fail-closed checks\n`);
  }

  let projectForRender = project;
  if (options.stages.includes('save')) {
    if (!verified) throw new Error('Internal error: verified results are unavailable');
    const fresh = await api.get<StudioProject>(`projects/${encodeURIComponent(options.projectId)}`);
    const merged = mergeVerifiedProject(fresh, plan, verified);
    const saved = await api.post<{ ok: boolean; project?: StudioProject }>('projects', {
      id: merged.id,
      title: merged.title,
      status: merged.status,
      spec: merged.spec,
      thumbSeed: merged.thumbSeed,
    });
    if (!saved.ok || saved.project?.id !== merged.id) throw new Error('Project save response did not preserve the target project ID');
    const roundTrip = await api.get<StudioProject>(`projects/${encodeURIComponent(options.projectId)}`);
    assertSavedRoundTrip(roundTrip, plan, verified);
    projectForRender = roundTrip;
    process.stdout.write('[save] all bindings and active-assembly assignments survived an authenticated round trip\n');
  }

  if (options.stages.includes('render-plan')) {
    if (!verified) throw new Error('Internal error: verified results are unavailable');
    if (!options.stages.includes('save')) {
      const fresh = await api.get<StudioProject>(`projects/${encodeURIComponent(options.projectId)}`);
      assertProjectInputsUnchanged(fresh, plan);
      projectForRender = fresh;
    }
    const requests = buildRenderRequests({ project: projectForRender, plan, verified, targetDuration: options.targetDuration });
    printRenderPlanSummary(requests);
    if (options.stages.includes('authorize-render')) {
      const receipt = await authorizeRenderRequests(api, requests, options.authorizationOutput!, projectForRender.id);
      process.stdout.write(`[authorize-render] three authorizations recorded in ${receipt}\n`);
    }
  }
}

const invokedDirectly = Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1]!)).href === import.meta.url;
if (invokedDirectly) {
  if (process.argv.slice(2).includes('--help')) process.stdout.write(HELP_TEXT);
  else run(parseCliOptions(process.argv.slice(2))).catch(error => {
    process.stderr.write(`[digital-human-p1] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
