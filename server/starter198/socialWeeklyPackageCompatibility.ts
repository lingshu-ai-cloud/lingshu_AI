import { createHash } from 'node:crypto';
import type { SocialWeeklyContentPackage as DirectorWeeklyContentPackage } from '../../shared/contracts/socialContentWorkflow.js';
import type { SocialWeeklyContentPackage as OperatingContentPackage, WeeklyOperatingPackage } from '../../shared/contracts/socialProgram.js';

export const WEEKLY_PACKAGE_AUTHORITY = 'social_weekly_operating_packages' as const;
export const LEGACY_WEEKLY_PLAN_COLLECTION = 'starter_social_content_plans' as const;

export interface LegacyWeeklyPlanRecord {
  id: string;
  tenant_id: string;
  plan?: unknown;
  status?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

export interface ReadonlyLegacyWeeklyProjection {
  source: 'legacy_starter198';
  readonly: true;
  package: DirectorWeeklyContentPackage;
  missing: string[];
}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const strings = (value: unknown): string[] => Array.isArray(value) ? value.map(text).filter(Boolean) : [];
const integer = (value: unknown, fallback = 0): number => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;
const money = (value: unknown): number | null => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** The Director contract is a deterministic execution projection, never a second editor. */
export function projectOperatingWeeklyPackage(source: WeeklyOperatingPackage): DirectorWeeklyContentPackage {
  const content: OperatingContentPackage = source.socialContentPackage;
  const platforms = [...new Set(content.publicationTasks.map(item => item.platform))].sort();
  return {
    packageId: source.packageId,
    version: String(source.version),
    businessGoal: source.objective,
    productFocus: null,
    audience: null,
    markets: [],
    languages: [],
    originalContentCount: content.originalContentTarget,
    adaptationVersionCount: content.adaptationVersionTarget,
    publicationTaskCount: content.publicationTaskTarget,
    platforms,
    publicationMatrix: content.publicationTasks.map(item => ({
      platform: item.platform, accountRef: item.accountId || null,
      accountPositioning: item.accountPositioning, publishWindow: item.publishWindow,
    })),
    weeklyBudgetCny: content.weeklyBudgetCny,
    perItemBudgetCny: content.perItemBudgetCny,
    dueAt: source.weekEnd,
    availableAssetRefs: [],
    customerCanShoot: false,
    availableCapabilities: [],
    priorities: ['must_do'],
    successCriteria: [...source.successCriteria],
    metricTargets: [...new Set(content.publicationTasks.flatMap(item => item.metricTargets))].sort(),
    createdBy: 'business_agent',
  };
}

/** Historical Starter198 rows remain readable with explicit unknowns; this function never writes. */
export function readLegacyWeeklyPlan(record: LegacyWeeklyPlanRecord): ReadonlyLegacyWeeklyProjection {
  const plan = object(record.plan);
  const missing: string[] = [];
  const required = (name: string, value: string): string => { if (!value) missing.push(name); return value || 'unknown'; };
  const packageId = required('packageId', text(plan.weeklyPlanId) || text(record.id));
  const objective = required('businessGoal', text(plan.objective));
  const platforms = strings(plan.platforms);
  if (!platforms.length) missing.push('platforms');
  return {
    source: 'legacy_starter198', readonly: true, missing,
    package: {
      packageId, version: text(plan.version) || '1', businessGoal: objective,
      productFocus: text(plan.productRef) || null, audience: text(plan.audience) || null,
      markets: strings(plan.markets), languages: strings(plan.languages),
      originalContentCount: integer(plan.originalContentCount), adaptationVersionCount: integer(plan.adaptationVersionCount),
      publicationTaskCount: integer(plan.publicationTaskCount), platforms, publicationMatrix: [],
      weeklyBudgetCny: money(plan.weeklyBudgetCny), perItemBudgetCny: money(plan.perItemBudgetCny),
      dueAt: text(plan.dueAt) || null, availableAssetRefs: [], customerCanShoot: false,
      availableCapabilities: [], priorities: ['must_do'], successCriteria: strings(plan.successCriteria),
      metricTargets: strings(plan.metricTargets), createdBy: 'business_agent',
    },
  };
}

export interface WeeklyWriteObservation { collection: string; tenantId: string; operationId: string; objectId: string }

export function assertNoWeeklyPackageDualWrite(writes: WeeklyWriteObservation[]): void {
  const operations = new Map<string, Set<string>>();
  for (const write of writes) {
    const key = `${write.tenantId}:${write.operationId}`;
    const collections = operations.get(key) ?? new Set<string>();
    collections.add(write.collection); operations.set(key, collections);
  }
  for (const [key, collections] of operations) {
    if (collections.has(WEEKLY_PACKAGE_AUTHORITY) && collections.has(LEGACY_WEEKLY_PLAN_COLLECTION)) {
      throw new Error(`weekly_package_dual_write_detected:${createHash('sha256').update(key).digest('hex').slice(0, 12)}`);
    }
  }
}

export function assertUnifiedWeeklyWrite(collection: string): void {
  if (collection !== WEEKLY_PACKAGE_AUTHORITY) throw new Error('legacy_weekly_package_write_forbidden');
}
