import { createHash } from 'node:crypto';
import type { SocialWeeklyContentPackage } from '../../shared/contracts/socialProgram.js';
import type { PublicationAssignment } from '../digitalEmployees/publishingExecution.js';
import type { PublishableProductionResult } from '../digitalEmployees/publishingExecution.js';
import { buildStarterPublicationPackage, createStarterPublicationPackage, type StarterPublicationPackage } from './starterPublicationPackage.js';
import type { DataStore } from '../storage/datastore.js';
import { store } from '../storage/index.js';

export type PublishingCapability = { platform: 'tiktok' | 'facebook' | 'instagram' | 'youtube'; status: 'available' | 'unavailable'; reason?: string };
export type SimulatedReceiptOutcome = 'success' | 'rejected' | 'unknown';
export type PublicationAttemptStatus = 'published' | 'failed' | 'unknown';

export interface PublicationAttempt {
  attemptId: string;
  assignmentId: string;
  status: PublicationAttemptStatus;
  platformPostId?: string;
  providerReceiptId?: string;
  failureCode?: string;
  attemptedAt: string;
}

export interface SimulatedPublicationState { attempts: Record<string, PublicationAttempt> }

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const day = (value: string) => /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0] || '';

export function buildAssignedPublicationPackage(input: {
  assignment: PublicationAssignment;
  productionResult: PublishableProductionResult;
  now?: Date;
}): StarterPublicationPackage {
  if (input.assignment.lineage.productionResultRef.id !== input.productionResult.productionResultId) throw new Error('assignment_production_result_mismatch');
  const manifest = buildStarterPublicationPackage({
    tenantId: input.assignment.tenantId,
    // Starter packages enforce one immutable package per content id. Scope the
    // id to the weekly item so one accepted result can feed several accounts
    // without colliding; the original result id remains in operatingLineage.
    contentId: `${input.productionResult.contentId}:${input.assignment.publicationTaskId}`,
    contentVersion: input.productionResult.contentVersion,
    contentHash: input.productionResult.contentHash,
    platform: input.assignment.platform,
    copy: { title: input.productionResult.title, body: input.productionResult.body, hashtags: input.productionResult.hashtags ?? [] },
    assets: input.productionResult.assets,
    operatingLineage: { assignmentId: input.assignment.assignmentId, assignmentHash: input.assignment.assignmentHash, ...input.assignment.lineage },
    idempotencyKey: input.assignment.packageIdempotencyKey,
    now: input.now,
  });
  if (manifest.packageId !== input.assignment.packageId) throw new Error('assignment_package_identity_mismatch');
  return manifest;
}

export async function createAssignedPublicationPackage(input: {
  assignment: PublicationAssignment;
  productionResult: PublishableProductionResult;
  now?: Date;
}, dataStore: DataStore = store): Promise<{ package: StarterPublicationPackage; created: boolean }> {
  const manifest = buildAssignedPublicationPackage(input);
  return createStarterPublicationPackage({
    tenantId: manifest.tenantId, contentId: manifest.contentId, contentVersion: manifest.contentVersion,
    contentHash: manifest.contentHash, platform: manifest.platform, copy: manifest.copy, assets: manifest.assets,
    operatingLineage: manifest.operatingLineage, idempotencyKey: input.assignment.packageIdempotencyKey,
    now: input.now,
  }, dataStore);
}

export function validateWeeklyAssignmentBoundary(input: {
  assignment: PublicationAssignment;
  contentPackage: SocialWeeklyContentPackage;
  existingPublishedCount: number;
  now: string;
}): string | null {
  const { assignment, contentPackage: pack } = input;
  const authorization = pack.authorization;
  if (!pack.publicationTasks.some(task => task.publicationTaskId === assignment.publicationTaskId
    && task.accountId === assignment.accountId && task.platform === assignment.platform)) return 'assignment_outside_package';
  if (!authorization.allowRealPublishing) return authorization.revokedAt ? 'authorization_revoked' : 'authorization_unavailable';
  if (!authorization.accountIds.includes(assignment.accountId)) return 'assignment_account_outside_package';
  if (authorization.maxPublishItems < 1 || input.existingPublishedCount >= authorization.maxPublishItems) return 'authorization_limit_exceeded';
  const currentDay = day(input.now);
  if (!currentDay || currentDay < authorization.weekStart || currentDay > authorization.weekEnd) return 'authorization_expired';
  return null;
}

/**
 * Deterministic fake provider used for recovery tests. Unknown means that the
 * call may have reached the provider and is never retried until reconciled.
 */
export function simulatePublicationAttempt(input: {
  assignment: PublicationAssignment;
  contentPackage: SocialWeeklyContentPackage;
  outcome: SimulatedReceiptOutcome;
  state: SimulatedPublicationState;
  existingPublishedCount: number;
  now: string;
}): PublicationAttempt {
  const attemptId = `pat_${digest(input.assignment.assignmentId).slice(0, 24)}`;
  const previous = input.state.attempts[attemptId];
  if (previous) return previous;
  const boundaryIssue = validateWeeklyAssignmentBoundary(input);
  if (boundaryIssue) {
    return input.state.attempts[attemptId] = { attemptId, assignmentId: input.assignment.assignmentId, status: 'failed', failureCode: boundaryIssue, attemptedAt: input.now };
  }
  if (input.outcome === 'unknown') {
    return input.state.attempts[attemptId] = { attemptId, assignmentId: input.assignment.assignmentId, status: 'unknown', attemptedAt: input.now };
  }
  if (input.outcome === 'rejected') {
    return input.state.attempts[attemptId] = { attemptId, assignmentId: input.assignment.assignmentId, status: 'failed', failureCode: 'provider_rejected', attemptedAt: input.now };
  }
  return input.state.attempts[attemptId] = {
    attemptId, assignmentId: input.assignment.assignmentId, status: 'published',
    platformPostId: `sim_${digest(`${attemptId}:post`).slice(0, 18)}`,
    providerReceiptId: `simr_${digest(`${attemptId}:receipt`).slice(0, 18)}`, attemptedAt: input.now,
  };
}

export function reconcileSimulatedAttempt(input: { state: SimulatedPublicationState; attemptId: string; platformPostId?: string; providerReceiptId?: string; now: string }): PublicationAttempt {
  const previous = input.state.attempts[input.attemptId];
  if (!previous) throw new Error('publication_attempt_not_found');
  if (previous.status !== 'unknown') return previous;
  if (!input.platformPostId || !input.providerReceiptId) return previous;
  const recovered = { ...previous, status: 'published' as const, platformPostId: input.platformPostId, providerReceiptId: input.providerReceiptId, attemptedAt: input.now };
  input.state.attempts[input.attemptId] = recovered;
  return recovered;
}

export function aggregatePublicationAttempts(attempts: PublicationAttempt[]): 'published' | 'partial' | 'failed' | 'unknown' {
  if (attempts.some(item => item.status === 'unknown')) return 'unknown';
  const successes = attempts.filter(item => item.status === 'published' && item.platformPostId && item.providerReceiptId).length;
  if (successes === attempts.length && attempts.length) return 'published';
  if (successes) return 'partial';
  return 'failed';
}

export function realPublishingCapabilities(connectedPlatforms: string[] = []): PublishingCapability[] {
  const configured = (name: string) => Boolean(process.env[name]?.trim());
  const connected = new Set(connectedPlatforms);
  return [
    { platform: 'youtube', status: configured('GOOGLE_CLIENT_ID') && configured('GOOGLE_CLIENT_SECRET') && connected.has('youtube') ? 'available' : 'unavailable', reason: 'requires_connected_account_and_youtube_upload_scope' },
    { platform: 'facebook', status: configured('META_APP_ID') && configured('META_APP_SECRET') && connected.has('facebook') ? 'available' : 'unavailable', reason: 'requires_connected_page_and_content_publish_scope' },
    { platform: 'instagram', status: configured('META_APP_ID') && configured('META_APP_SECRET') && connected.has('instagram') ? 'available' : 'unavailable', reason: 'requires_connected_business_account_and_content_publish_scope' },
    { platform: 'tiktok', status: configured('TIKTOK_CLIENT_KEY') && configured('TIKTOK_CLIENT_SECRET') && connected.has('tiktok') ? 'available' : 'unavailable', reason: 'requires_connected_account_and_direct_post_scope' },
  ];
}
