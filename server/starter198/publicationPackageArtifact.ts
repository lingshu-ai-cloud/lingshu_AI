import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  type BuildStarterPublicationPackageInput,
  type PublicationCopy,
  type PublicationPackageAsset,
  type StarterPublishingPlatform,
} from '../publishing/starterPublicationPackage.js';
import type { DataStore } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import type { StarterRecord } from './repository.js';

const CONTENT_SUBJECT_SCHEMA = 'starter-198.content-subject.v1' as const;
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi']);

export const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const version = (value: unknown): string => typeof value === 'number' && Number.isFinite(value)
  ? String(value)
  : text(value);

export function object(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function array(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try { return array(JSON.parse(value)); } catch { return []; }
}

export function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const input = createReadStream(file);
    input.on('data', chunk => hash.update(chunk));
    input.on('error', reject);
    input.on('end', resolve);
  });
  return hash.digest('hex');
}

function normalizedHashtags(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\s,，]+/)
      : [];
  return [...new Set(values.map(item => text(item).replace(/^#+/, '')).filter(Boolean))].slice(0, 30);
}

function normalizedCopy(value: PublicationCopy): PublicationCopy {
  return {
    title: text(value.title).slice(0, 300),
    body: text(value.body).slice(0, 10_000),
    hashtags: normalizedHashtags(value.hashtags),
    ...(text(value.firstComment) ? { firstComment: text(value.firstComment).slice(0, 2_000) } : {}),
    ...(text(value.altText) ? { altText: text(value.altText).slice(0, 2_000) } : {}),
  };
}

export interface StarterContentSubjectV1 {
  type: 'starter_content_subject';
  schemaVersion: typeof CONTENT_SUBJECT_SCHEMA;
  tenantId: string;
  runId: string;
  contentId: string;
  contentVersion: string;
  sourceContentHash: string;
  platform: StarterPublishingPlatform;
  copy: PublicationCopy;
  assets: Array<Pick<PublicationPackageAsset, 'kind' | 'fileName' | 'contentHash'>>;
  inquiryUrl?: string;
  contentHash: string;
}

type CanonicalPublicationInput = Omit<BuildStarterPublicationPackageInput, 'idempotencyKey' | 'now'>;

export interface CanonicalStarterContentArtifact {
  subject: StarterContentSubjectV1;
  publication: CanonicalPublicationInput;
}

export class StarterPublicationPackageWorkerError extends Error {
  constructor(readonly code: string, readonly retryable = false) {
    super(code);
    this.name = 'StarterPublicationPackageWorkerError';
  }
}

function subjectBusinessValue(subject: Omit<StarterContentSubjectV1, 'contentHash'>): Record<string, unknown> {
  return {
    type: subject.type,
    schemaVersion: subject.schemaVersion,
    tenantId: subject.tenantId,
    runId: subject.runId,
    contentId: subject.contentId,
    contentVersion: subject.contentVersion,
    sourceContentHash: subject.sourceContentHash,
    platform: subject.platform,
    copy: normalizedCopy(subject.copy),
    assets: subject.assets.map(asset => ({
      kind: asset.kind,
      fileName: text(asset.fileName),
      contentHash: text(asset.contentHash).toLowerCase(),
    })),
    ...(text(subject.inquiryUrl) ? { inquiryUrl: text(subject.inquiryUrl) } : {}),
  };
}

export function starterContentSubjectHash(subject: Omit<StarterContentSubjectV1, 'contentHash'>): string {
  return sha256Json(subjectBusinessValue(subject));
}

function tenantPublishingDirectory(root: string, tenantId: string): string {
  return path.resolve(root, tenantId.replace(/[^\w.-]+/g, '-'));
}

function publicationPlatform(spec: Record<string, unknown>, automation: Record<string, unknown>): StarterPublishingPlatform | null {
  const order = object(spec.contentOrder) ?? {};
  const routePlan = object(automation.routePlan) ?? {};
  const candidate = [spec.platform, order.platform, routePlan.platform]
    .map(value => text(value).toLowerCase())
    .find(Boolean);
  return candidate && ['facebook', 'instagram', 'tiktok', 'youtube'].includes(candidate)
    ? candidate as StarterPublishingPlatform
    : null;
}

/**
 * Rebuild the approved subject from the tenant's canonical studio project.
 * Queue payloads and approval snapshots never supply copy, URLs, or file bytes
 * to the package creator; they only identify the frozen subject to compare.
 */
export async function readCanonicalStarterContentArtifact(input: {
  tenantId: string;
  runId: string;
  contentId: string;
  dataStore?: DataStore;
  publishingRoot?: string;
}): Promise<CanonicalStarterContentArtifact> {
  const dataStore = input.dataStore ?? store;
  const tenantId = text(input.tenantId);
  const runId = text(input.runId);
  const contentId = text(input.contentId);
  if (!tenantId || !runId || !contentId) {
    throw new StarterPublicationPackageWorkerError('starter_publication_content_identity_required');
  }
  const project = await dataStore.getById<StarterRecord>('studio_projects', contentId);
  if (!project || text(project.id) !== contentId || text(project.tenant_id) !== tenantId) {
    throw new StarterPublicationPackageWorkerError('starter_publication_content_not_found');
  }
  const spec = object(project.spec);
  const automation = object(spec?.automation);
  const quality = object(automation?.quality);
  if (!spec || !automation || text(spec.workflowRunId) !== runId) {
    throw new StarterPublicationPackageWorkerError('starter_publication_content_run_mismatch');
  }
  if (text(automation.managedBy) !== 'digital_employee'
    || text(automation.stage) !== 'completed'
    || quality?.passed !== true
    || !['ready_for_approval', 'completed'].includes(text(project.status))) {
    throw new StarterPublicationPackageWorkerError('starter_publication_content_not_canonical');
  }
  const contentVersion = version(automation.contentVersion);
  const script = text(spec.script);
  const sourceContentHash = text(automation.contentHash).toLowerCase();
  if (!contentVersion || !script || !/^[a-f0-9]{64}$/.test(sourceContentHash)
    || sourceContentHash !== sha256Json(script)) {
    throw new StarterPublicationPackageWorkerError('starter_publication_content_version_invalid');
  }
  const platform = publicationPlatform(spec, automation);
  if (!platform) throw new StarterPublicationPackageWorkerError('starter_publication_platform_missing');

  const outputPath = text(automation.renderOutputPath) || text(spec.renderOutputPath);
  const extension = path.extname(outputPath).toLowerCase();
  if (!outputPath || !VIDEO_EXTENSIONS.has(extension)) {
    throw new StarterPublicationPackageWorkerError('starter_publication_asset_invalid');
  }
  const publishingRoot = input.publishingRoot ?? path.resolve(process.cwd(), 'data', 'publishing-uploads');
  const expectedDirectory = tenantPublishingDirectory(publishingRoot, tenantId);
  let canonicalDirectory: string;
  let canonicalFile: string;
  try {
    [canonicalDirectory, canonicalFile] = await Promise.all([realpath(expectedDirectory), realpath(outputPath)]);
    const metadata = await stat(canonicalFile);
    if (!metadata.isFile() || metadata.size <= 0 || path.dirname(canonicalFile) !== canonicalDirectory) {
      throw new Error('not a direct tenant file');
    }
  } catch {
    throw new StarterPublicationPackageWorkerError('starter_publication_asset_unavailable');
  }
  const fileName = path.basename(canonicalFile);
  const assetHash = await sha256File(canonicalFile);
  const copy = normalizedCopy({
    title: text(project.title) || `内容作品 ${contentId}`,
    body: text(spec.caption) || text(spec.description) || script,
    hashtags: normalizedHashtags(spec.hashtags ?? spec.tags),
    ...(text(spec.firstComment) ? { firstComment: text(spec.firstComment) } : {}),
    ...(text(spec.altText) ? { altText: text(spec.altText) } : {}),
  });
  if (!copy.title && !copy.body) {
    throw new StarterPublicationPackageWorkerError('starter_publication_copy_missing');
  }
  const assets: StarterContentSubjectV1['assets'] = [{ kind: 'video', fileName, contentHash: assetHash }];
  const inquiryUrl = text(spec.inquiryUrl);
  const businessSubject: Omit<StarterContentSubjectV1, 'contentHash'> = {
    type: 'starter_content_subject',
    schemaVersion: CONTENT_SUBJECT_SCHEMA,
    tenantId,
    runId,
    contentId,
    contentVersion,
    sourceContentHash,
    platform,
    copy,
    assets,
    ...(inquiryUrl ? { inquiryUrl } : {}),
  };
  const subject: StarterContentSubjectV1 = {
    ...businessSubject,
    contentHash: starterContentSubjectHash(businessSubject),
  };
  return {
    subject,
    publication: {
      tenantId,
      contentId,
      contentVersion,
      contentHash: subject.contentHash,
      platform,
      copy,
      assets: [{
        ...assets[0],
        downloadUrl: `/api/overseas/publishing/local-videos/${encodeURIComponent(fileName)}`,
      }],
      ...(inquiryUrl ? { inquiryUrl } : {}),
    },
  };
}

export function contentSubjectFromApproval(approval: StarterRecord): StarterContentSubjectV1 {
  const subjects = array(approval.evidence)
    .map(object)
    .filter((item): item is Record<string, unknown> => item?.type === 'starter_content_subject');
  if (subjects.length !== 1) {
    throw new StarterPublicationPackageWorkerError('starter_publication_subject_missing');
  }
  const source = subjects[0];
  const copySource = object(source.copy);
  const assets = array(source.assets).map(object).filter((item): item is Record<string, unknown> => Boolean(item));
  const parsed: StarterContentSubjectV1 = {
    type: 'starter_content_subject',
    schemaVersion: source.schemaVersion as typeof CONTENT_SUBJECT_SCHEMA,
    tenantId: text(source.tenantId),
    runId: text(source.runId),
    contentId: text(source.contentId),
    contentVersion: version(source.contentVersion),
    sourceContentHash: text(source.sourceContentHash).toLowerCase(),
    platform: text(source.platform).toLowerCase() as StarterPublishingPlatform,
    copy: normalizedCopy({
      title: text(copySource?.title),
      body: text(copySource?.body),
      hashtags: normalizedHashtags(copySource?.hashtags),
      ...(text(copySource?.firstComment) ? { firstComment: text(copySource?.firstComment) } : {}),
      ...(text(copySource?.altText) ? { altText: text(copySource?.altText) } : {}),
    }),
    assets: assets.map(asset => ({
      kind: text(asset.kind) as PublicationPackageAsset['kind'],
      fileName: text(asset.fileName),
      contentHash: text(asset.contentHash).toLowerCase(),
    })),
    ...(text(source.inquiryUrl) ? { inquiryUrl: text(source.inquiryUrl) } : {}),
    contentHash: text(source.contentHash).toLowerCase(),
  };
  if (parsed.schemaVersion !== CONTENT_SUBJECT_SCHEMA
    || !parsed.tenantId || !parsed.runId || !parsed.contentId || !parsed.contentVersion
    || !/^[a-f0-9]{64}$/.test(parsed.sourceContentHash)
    || !['facebook', 'instagram', 'tiktok', 'youtube'].includes(parsed.platform)
    || parsed.assets.length !== 1
    || parsed.assets[0].kind !== 'video'
    || !parsed.assets[0].fileName
    || !/^[a-f0-9]{64}$/.test(parsed.assets[0].contentHash)
    || !/^[a-f0-9]{64}$/.test(parsed.contentHash)
    || starterContentSubjectHash({ ...parsed, contentHash: undefined } as Omit<StarterContentSubjectV1, 'contentHash'>) !== parsed.contentHash) {
    throw new StarterPublicationPackageWorkerError('starter_publication_subject_invalid');
  }
  return parsed;
}
