import type {
  CreateSocialArtifactInput,
  SocialContentArtifact,
  SocialContentTaskDetail,
} from '../../shared/contracts/socialContentWorkflow';
import { socialContentApi } from './socialContentApi';
import {
  prepareSocialArtifactMedia,
  type ManualSocialArtifactMediaSource,
} from './socialContentArtifactMedia';

const SOCIAL_ID = /^[a-z0-9:_-]{1,200}$/i;
const MAX_TEXT_LENGTH = 12_000;

export interface ManualSocialArtifactSnapshot {
  sourceKey: string;
  title: string;
  contentMode: 'video' | 'poster';
  platform?: string | null;
  language?: string | null;
  aspectRatio?: string | null;
  durationSeconds?: number | null;
  body?: string | null;
  coverTitle?: string | null;
  projectId?: string | null;
  outputUrl?: string | null;
  outputMedia?: ManualSocialArtifactMediaSource;
}

export interface ManualSocialArtifactPort {
  getTask(taskId: string): Promise<SocialContentTaskDetail>;
  createArtifact(
    taskId: string,
    input: CreateSocialArtifactInput,
    operationKey?: string,
  ): Promise<{ artifact: SocialContentArtifact; task: SocialContentTaskDetail }>;
  uploadArtifactMedia(
    taskId: string,
    file: Blob,
    name: string,
    operationKey?: string,
  ): Promise<{ fileRef: string; name: string; mimeType: string; size: number; sha256: string }>;
}

export type ManualSocialArtifactResult = {
  artifact: SocialContentArtifact;
  task: SocialContentTaskDetail;
  replayed: boolean;
};

function cleanText(value: unknown, maximum = MAX_TEXT_LENGTH): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function definedRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== '' && item !== null && item !== undefined));
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function fallbackDigest(value: string): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ (code + index), 0x85ebca6b);
  }
  return `${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`;
}

async function contentDigest(value: unknown): Promise<string> {
  const serialized = canonical(value);
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(serialized);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return fallbackDigest(serialized);
}

export function buildManualSocialArtifact(snapshot: ManualSocialArtifactSnapshot): CreateSocialArtifactInput {
  const sourceKey = cleanText(snapshot.sourceKey, 200);
  if (!SOCIAL_ID.test(sourceKey)) throw new Error('当前作品无法关联到社媒任务，请重新打开内容创作');

  const content = definedRecord({
    sourceKey,
    title: cleanText(snapshot.title, 300) || '未命名内容',
    body: cleanText(snapshot.body),
    contentType: snapshot.contentMode === 'poster' ? 'image_post' : 'short_video',
    aspectRatio: cleanText(snapshot.aspectRatio, 20),
    durationSeconds: Number.isFinite(snapshot.durationSeconds) && Number(snapshot.durationSeconds) > 0
      ? Math.round(Number(snapshot.durationSeconds) * 10) / 10
      : null,
    coverTitle: cleanText(snapshot.coverTitle, 500),
    projectId: cleanText(snapshot.projectId, 200),
  });

  return {
    kind: snapshot.contentMode === 'poster' ? 'image_post' : 'short_video',
    platform: cleanText(snapshot.platform, 40) || null,
    language: cleanText(snapshot.language, 40) || null,
    origin: 'manual',
    resourceRef: null,
    content,
    parentArtifactId: null,
  };
}

function sourceKeyOf(artifact: SocialContentArtifact): string {
  return cleanText(artifact.content?.sourceKey, 200);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * The workflow service enriches uploaded artifacts with a top-level `media`
 * descriptor after creation. It is not part of the manual submission payload,
 * so exclude that one server-owned field while retaining every authored field
 * (including any content/version markers) in the retry comparison.
 */
function comparableManualContent(value: unknown): Record<string, unknown> | null {
  const content = recordValue(value);
  if (!content) return null;
  return Object.fromEntries(Object.entries(content).filter(([key, item]) => key !== 'media' && item !== undefined));
}

function mediaBindingMatches(
  artifact: SocialContentArtifact,
  input: CreateSocialArtifactInput,
): boolean {
  const submittedContent = recordValue(input.content);
  const storedContent = recordValue(artifact.content);
  if (!submittedContent || !storedContent) return false;

  const submittedHash = cleanText(submittedContent.mediaSha256, 128).toLowerCase();
  const storedHash = cleanText(storedContent.mediaSha256, 128).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(submittedHash) || storedHash !== submittedHash) return false;

  const managedMedia = recordValue(storedContent.media);
  if (!managedMedia) return true;

  const descriptorHash = cleanText(managedMedia.sha256, 128).toLowerCase();
  const descriptorRef = cleanText(managedMedia.fileRef, 500);
  return descriptorHash === submittedHash
    && descriptorRef === artifact.resourceRef;
}

export function manualSocialArtifactMatchesSubmission(
  taskId: string,
  artifact: SocialContentArtifact,
  input: CreateSocialArtifactInput,
): boolean {
  return artifact.taskId === taskId
    && artifact.origin === 'manual'
    && artifact.status !== 'superseded'
    && artifact.status !== 'changes_requested'
    && Boolean(cleanText(artifact.version, 100))
    && /^socialfile:/.test(artifact.resourceRef || '')
    && artifact.kind === input.kind
    && artifact.platform === (input.platform ?? null)
    && artifact.language === (input.language ?? null)
    && canonical(comparableManualContent(artifact.content)) === canonical(comparableManualContent(input.content))
    && mediaBindingMatches(artifact, input);
}

export async function submitManualSocialArtifact(
  taskIdValue: string,
  snapshot: ManualSocialArtifactSnapshot,
  port: ManualSocialArtifactPort = socialContentApi,
): Promise<ManualSocialArtifactResult> {
  const taskId = cleanText(taskIdValue, 200);
  if (!SOCIAL_ID.test(taskId)) throw new Error('当前社媒任务已失效，请返回灵小枢重新进入');

  const task = await port.getTask(taskId);
  if (task.taskId !== taskId) throw new Error('当前社媒任务已更新，请返回灵小枢重新进入');

  const prepared = await prepareSocialArtifactMedia({
    source: snapshot.outputMedia ?? snapshot.outputUrl,
    contentMode: snapshot.contentMode,
  });
  const base = buildManualSocialArtifact(snapshot);
  const baseInput: CreateSocialArtifactInput = {
    ...base,
    content: definedRecord({
      ...(base.content ?? {}),
      mediaSha256: prepared.sha256,
      mediaMimeType: prepared.mimeType,
      mediaSize: prepared.size,
      mediaName: prepared.name,
    }),
  };
  const current = [...task.artifacts].reverse().find(artifact => (
    artifact.origin === 'manual'
    && artifact.status !== 'superseded'
    && sourceKeyOf(artifact) === cleanText(snapshot.sourceKey, 200)
  ));

  if (current && manualSocialArtifactMatchesSubmission(taskId, current, baseInput)) {
    return { artifact: current, task, replayed: true };
  }

  const mediaKey = await contentDigest({
    taskId,
    sourceKey: snapshot.sourceKey,
    sha256: prepared.sha256,
    size: prepared.size,
    mimeType: prepared.mimeType,
  });
  const uploaded = await port.uploadArtifactMedia(taskId, prepared.blob, prepared.name, `socialmanual:media:${mediaKey}`);
  const input: CreateSocialArtifactInput = {
    ...baseInput,
    resourceRef: uploaded.fileRef,
    content: definedRecord({
      ...(baseInput.content ?? {}),
      mediaSha256: uploaded.sha256,
      mediaMimeType: uploaded.mimeType,
      mediaSize: uploaded.size,
      mediaName: uploaded.name,
    }),
    parentArtifactId: current?.artifactId ?? null,
  };
  const digest = await contentDigest({ taskId, input });
  const result = await port.createArtifact(taskId, input, `socialmanual:${digest}`);
  return { ...result, replayed: false };
}
