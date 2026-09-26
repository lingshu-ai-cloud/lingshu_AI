import path from 'node:path';
import type { SocialProductionResult } from '../../shared/contracts/socialContentWorkflow.js';
import type { VersionedSocialRef, WeeklyOperatingPackage } from '../../shared/contracts/socialProgram.js';
import { buildPublicationAssignment, type PublishableProductionResult } from '../digitalEmployees/publishingExecution.js';
import { parseSocialContentAuthorityLineage, type SocialContentAuthorityLineage } from '../starter198/socialContentLineage.js';
import type { DataStore } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import {
  createAssignedPublicationPackage,
  markPublicationAssignmentPackageReady,
  persistPublicationAssignment,
} from './weeklyLineage.js';

type ArtifactRow = {
  id: string;
  tenant_id: string;
  task_id: string;
  artifact_id: string;
  version: string;
  status: string;
  content_hash: string;
  resource_ref?: string;
  content?: unknown;
  updated_at?: string;
};

type WeeklyPackageRow = {
  id: string;
  tenant_id: string;
  package_id: string;
  version: number;
  payload: WeeklyOperatingPackage;
};

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => String(value ?? '').trim();
const hash = (value: unknown): string => /^[a-f0-9]{32,128}$/i.test(text(value)) ? text(value).toLowerCase() : '';

function mediaAsset(value: unknown, kind: 'video' | 'cover') {
  const media = object(value);
  const downloadUrl = text(media.url);
  const contentHash = hash(media.sha256);
  if (!downloadUrl || !contentHash) return null;
  let fileName = `${kind}.bin`;
  try { fileName = path.basename(new URL(downloadUrl, 'http://localhost').pathname) || fileName; } catch { /* validated by package builder */ }
  return { kind, fileName, downloadUrl, contentHash } as const;
}

function productionFromArtifact(
  artifact: ArtifactRow,
  lineage: SocialContentAuthorityLineage,
  weekly: WeeklyOperatingPackage,
): PublishableProductionResult {
  const content = object(artifact.content);
  const raw = object(content.productionResult) as unknown as SocialProductionResult;
  if (!text(raw.productionResultId) || raw.productionResultId !== lineage.productionResultRef?.id
    || !text(raw.version) || raw.technicalReview?.approved !== true || raw.creativeReview?.approved !== true
    || raw.status !== 'asset_review') throw new Error('production_result_not_publishable');
  const storage = object(content.mediaStorage);
  const assets = [mediaAsset(storage.video, 'video'), mediaAsset(storage.cover, 'cover')].filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (!assets.length) throw new Error('production_result_media_missing');
  const contentHash = hash(artifact.content_hash) || assets[0]!.contentHash;
  const body = text(content.adaptedScript) || text(object(content.scriptAdaptation).adaptedScript)
    || weekly.objective;
  const sourceRefs: VersionedSocialRef[] = [
    lineage.programRef, lineage.packageRef, lineage.weeklyTaskRef, lineage.publicationTaskRef,
    lineage.businessGoalRef, lineage.enterpriseProfileRef, lineage.referenceSelectionRef,
    ...lineage.enterpriseFactRefs, ...lineage.candidateEvidenceRefs,
    ...lineage.inspirationHandoffRefs, lineage.directorBriefRef,
  ];
  return {
    productionResultId: raw.productionResultId,
    contentId: artifact.artifact_id,
    contentVersion: text(raw.version),
    contentHash,
    title: text(object(content.directorPlan).title) || weekly.objective.slice(0, 300) || `Content ${artifact.artifact_id}`,
    body,
    hashtags: [],
    assets,
    sourceRefs,
    acceptedAt: text(artifact.updated_at) || raw.createdAt,
  };
}

export interface WeeklyPublicationWorkerResult {
  scanned: number;
  createdAssignments: number;
  createdPackages: number;
  skipped: number;
  errors: Array<{ tenantId: string; artifactId: string; code: string }>;
}

/**
 * Turns an approved R4 production artifact plus its authoritative R3 lineage
 * into one immutable assignment/package pair. This worker never publishes.
 */
export async function runWeeklyPublicationPackageScan(input: {
  dataStore?: DataStore;
  limit?: number;
} = {}): Promise<WeeklyPublicationWorkerResult> {
  const dataStore = input.dataStore ?? store;
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const rows = await dataStore.list<ArtifactRow>('starter_social_content_artifacts', {
    where: { status: 'approved' }, sort: 'updated_at', page: 1, perPage: limit,
  });
  const result: WeeklyPublicationWorkerResult = { scanned: rows.items.length, createdAssignments: 0, createdPackages: 0, skipped: 0, errors: [] };
  for (const artifact of rows.items) {
    const tenantId = text(artifact.tenant_id);
    const artifactId = text(artifact.artifact_id);
    try {
      const production = object(object(artifact.content).productionResult);
      const productionResultId = text(production.productionResultId);
      if (!tenantId || !artifactId || !productionResultId) { result.skipped += 1; continue; }
      const lineageRows = await dataStore.list<any>('starter_social_content_lineage', {
        where: { tenant_id: tenantId, production_result_id: productionResultId }, sort: '-created_at', page: 1, perPage: 2,
      });
      if (!lineageRows.items[0]) { result.skipped += 1; continue; }
      if (lineageRows.totalItems > 1 || lineageRows.items.length > 1) throw new Error('production_result_lineage_ambiguous');
      const lineage = parseSocialContentAuthorityLineage(lineageRows.items[0]);
      if (lineage.invalidation.status !== 'valid') throw new Error('production_result_lineage_invalidated');
      const weeklyRows = await dataStore.list<WeeklyPackageRow>('social_weekly_operating_packages', {
        where: { tenant_id: tenantId, package_id: lineage.packageRef.id, version: lineage.packageRef.version }, page: 1, perPage: 2,
      });
      if (weeklyRows.totalItems !== 1 || !weeklyRows.items[0]) throw new Error('weekly_operating_package_not_found');
      const weekly = weeklyRows.items[0].payload;
      if (weekly.version !== lineage.packageRef.version || weekly.packageId !== lineage.packageRef.id) throw new Error('weekly_operating_package_lineage_mismatch');
      const publicationTask = weekly.socialContentPackage.publicationTasks.find(item => item.publicationTaskId === lineage.publicationTaskRef.id);
      if (!publicationTask) throw new Error('weekly_publication_task_not_found');
      const publishable = productionFromArtifact(artifact, lineage, weekly);
      const assignment = buildPublicationAssignment({ tenantId, operatingPackage: weekly, publicationTask, productionResult: publishable });
      const persisted = await persistPublicationAssignment(assignment, dataStore);
      if (persisted.created) result.createdAssignments += 1;
      const packaged = await createAssignedPublicationPackage({ assignment, productionResult: publishable }, dataStore);
      if (packaged.created) result.createdPackages += 1;
      await markPublicationAssignmentPackageReady(tenantId, assignment.assignmentId, dataStore);
    } catch (error) {
      result.errors.push({ tenantId, artifactId, code: error instanceof Error ? error.message : 'weekly_publication_worker_failed' });
    }
  }
  return result;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const result = await runWeeklyPublicationPackageScan();
    if (result.createdAssignments || result.createdPackages || result.errors.length) {
      console.log(`[weekly-publication-worker] scanned=${result.scanned} assignments=${result.createdAssignments} packages=${result.createdPackages} errors=${result.errors.length}`);
    }
  } catch (error) {
    console.error('[weekly-publication-worker] cycle failed:', error instanceof Error ? error.message : error);
  } finally { running = false; }
}

export function initWeeklyPublicationPackageWorker(): void {
  if (process.env.SOCIAL_WEEKLY_PUBLISHING_WORKER_ENABLED !== 'true' || timer) return;
  const configured = Number(process.env.SOCIAL_WEEKLY_PUBLISHING_WORKER_INTERVAL_MS || 30_000);
  const interval = Number.isFinite(configured) ? Math.min(Math.max(configured, 5_000), 10 * 60_000) : 30_000;
  void tick();
  timer = setInterval(() => { void tick(); }, interval);
  timer.unref?.();
  console.log(`[weekly-publication-worker] enabled interval=${interval}ms; package-only, no external publish`);
}
