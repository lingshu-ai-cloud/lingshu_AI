import type { WeeklyOperatingPackage } from '../../shared/contracts/socialProgram.js';
import type { DataStore } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import { readStarterPublicationPackage } from './starterPublicationPackage.js';
import { createWeeklyPublishingAdapter } from './weeklyPublishingAdapter.js';
import { executeWeeklyPublication, reconcileWeeklyPublication, PUBLICATION_ASSIGNMENTS, PUBLICATION_ATTEMPTS, type DurablePublicationAttempt, type StoredPublicationAssignment, type WeeklyPublishingProviderAdapter } from './weeklyLineage.js';

type WeeklyPackageRow = { id: string; tenant_id: string; package_id: string; version: number; payload: WeeklyOperatingPackage };
export interface WeeklyPublicationExecutionResult { scanned: number; published: number; pending: number; failed: number; skipped: number; errors: Array<{ tenantId: string; assignmentId: string; code: string }> }

/** Existing ambiguous attempts are reconciled and never submitted again. */
export async function runWeeklyPublicationExecutionScan(input: {
  dataStore?: DataStore;
  limit?: number;
  now?: Date;
  adapterFactory?: (assignment: StoredPublicationAssignment) => Promise<WeeklyPublishingProviderAdapter>;
} = {}): Promise<WeeklyPublicationExecutionResult> {
  const dataStore = input.dataStore ?? store;
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const rows = await dataStore.list<StoredPublicationAssignment>(PUBLICATION_ASSIGNMENTS, { where: { status: 'package_ready' }, sort: 'created_at', page: 1, perPage: limit });
  const result: WeeklyPublicationExecutionResult = { scanned: rows.items.length, published: 0, pending: 0, failed: 0, skipped: 0, errors: [] };
  for (const row of rows.items) {
    try {
      const weeklyRows = await dataStore.list<WeeklyPackageRow>('social_weekly_operating_packages', { where: { tenant_id: row.tenant_id, package_id: row.operating_package_id, version: row.operating_package_version }, page: 1, perPage: 2 });
      if (weeklyRows.totalItems !== 1 || !weeklyRows.items[0]) throw new Error('weekly_operating_package_not_found');
      const publicationPackage = await readStarterPublicationPackage(row.tenant_id, row.package_id, dataStore);
      if (!publicationPackage) throw new Error('publication_package_not_found');
      const adapter = input.adapterFactory ? await input.adapterFactory(row) : await createWeeklyPublishingAdapter({ tenantId: row.tenant_id, accountId: row.account_id, platform: row.platform, dataStore, now: input.now });
      if (adapter.capability !== 'available') { result.errors.push({ tenantId: row.tenant_id, assignmentId: row.assignment_id, code: adapter.unavailableReason || 'publishing_provider_unavailable' }); continue; }
      const attempts = await dataStore.list<DurablePublicationAttempt>(PUBLICATION_ATTEMPTS, { where: { tenant_id: row.tenant_id, assignment_id: row.assignment_id }, page: 1, perPage: 2 });
      const existing = attempts.items[0];
      if (existing?.status === 'published' || existing?.status === 'failed') { result.skipped += 1; continue; }
      const operatingAssignments = await dataStore.list<StoredPublicationAssignment>(PUBLICATION_ASSIGNMENTS, { where: { tenant_id: row.tenant_id, operating_package_id: row.operating_package_id, operating_package_version: row.operating_package_version }, page: 1, perPage: 500 });
      if (operatingAssignments.totalItems > operatingAssignments.items.length) throw new Error('publication_assignment_scan_truncated');
      let existingPublishedCount = 0;
      for (const assigned of operatingAssignments.items) {
        const terminal = await dataStore.list<DurablePublicationAttempt>(PUBLICATION_ATTEMPTS, { where: { tenant_id: row.tenant_id, assignment_id: assigned.assignment_id, status: 'published' }, page: 1, perPage: 1 });
        if (terminal.totalItems) existingPublishedCount += 1;
      }
      const attempt = existing && ['unknown', 'in_flight'].includes(existing.status)
        ? await reconcileWeeklyPublication({ assignment: row.payload, publicationPackage, adapter, now: input.now, dataStore })
        : await executeWeeklyPublication({ assignment: row.payload, publicationPackage, contentPackage: weeklyRows.items[0].payload.socialContentPackage, adapter, existingPublishedCount, now: input.now, dataStore });
      if (attempt.status === 'published') result.published += 1;
      else if (attempt.status === 'failed') result.failed += 1;
      else result.pending += 1;
    } catch (error) {
      result.errors.push({ tenantId: row.tenant_id, assignmentId: row.assignment_id, code: error instanceof Error ? error.message : 'weekly_publication_execution_failed' });
    }
  }
  return result;
}
