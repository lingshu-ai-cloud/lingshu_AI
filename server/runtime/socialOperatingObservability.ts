import { pbListStrict } from '../storage/pb.js';
import type { ProcessRole } from './processRole.js';
import { processRoleStartsBackgroundJobs } from './processRole.js';
import { backgroundJobRuntimeState, SOCIAL_OPERATING_WORKER_HEARTBEATS, type BackgroundJobRuntimeState } from './workerHeartbeat.js';

export const SOCIAL_OPERATING_REQUIRED_COLLECTIONS = [
  'social_programs',
  'social_weekly_operating_packages',
  'social_business_content_goals',
  'social_operating_decisions',
  'social_candidate_evidence',
  'social_reference_selections',
  'social_discovery_gap_tasks',
  'social_weekly_review_snapshots',
  SOCIAL_OPERATING_WORKER_HEARTBEATS,
] as const;

type GapRow = {
  status?: string;
  stopReason?: string;
  spentCny?: number;
  budgetLimitCny?: number;
  createdAt?: string;
  updatedAt?: string;
};
type PostRow = { stats?: unknown };
type PackageRow = { status?: string; payload?: unknown };
type HeartbeatRow = { state?: string; last_seen_at?: string; instance_id?: string };

export interface SocialOperatingSignals {
  queueBacklog: { count: number; oldestAt: string | null };
  unknownReceipts: { count: number };
  exhaustedBudgets: { count: number };
  invalidAuthorizations: { count: number };
  worker: { ready: boolean; source: 'local' | 'heartbeat'; state: string; lastSeenAt: string | null };
}

function object(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch { return {}; }
  }
  return {};
}

function hasUnknownReceipt(row: PostRow): boolean {
  const stats = object(row.stats);
  if (stats.status === 'needs_attention') return true;
  return Object.values(object(stats.publishResults)).some(value => {
    const status = object(value).status;
    return status === 'unknown' || status === 'in_flight';
  });
}

function invalidAuthorization(row: PackageRow, today: string): boolean {
  const contentPackage = object(object(row.payload).socialContentPackage);
  const authorization = object(contentPackage.authorization);
  if (authorization.revokedAt) return true;
  if (row.status !== 'active') return false;
  return authorization.allowRealPublishing !== true
    || (typeof authorization.weekEnd === 'string' && authorization.weekEnd < today);
}

function workerMaxAgeMs(): number {
  const configured = Number(process.env.WORKER_HEARTBEAT_MAX_AGE_MS || 60_000);
  return Number.isFinite(configured) ? Math.min(Math.max(Math.floor(configured), 10_000), 10 * 60_000) : 60_000;
}

export async function inspectSocialOperatingSignals(input: {
  role: ProcessRole;
  now?: Date;
  localWorker?: BackgroundJobRuntimeState;
}): Promise<SocialOperatingSignals> {
  const now = input.now ?? new Date();
  const [backlog, blocked, posts, packages] = await Promise.all([
    pbListStrict<GapRow>('social_discovery_gap_tasks', { filter: 'status = "collecting"', sort: 'createdAt', page: 1, perPage: 1 }),
    pbListStrict<GapRow>('social_discovery_gap_tasks', { filter: 'status = "blocked"', page: 1, perPage: 200 }),
    pbListStrict<PostRow>('posts', { sort: '-published_at', page: 1, perPage: 200 }),
    pbListStrict<PackageRow>('social_weekly_operating_packages', { sort: '-updated_at', page: 1, perPage: 200 }),
  ]);
  const exhaustedBudgets = blocked.items.filter(row => row.stopReason === 'budget_exhausted'
    || (Number.isFinite(Number(row.budgetLimitCny)) && Number(row.spentCny) >= Number(row.budgetLimitCny))).length;
  const local = input.localWorker ?? backgroundJobRuntimeState();
  let worker: SocialOperatingSignals['worker'];
  if (processRoleStartsBackgroundJobs(input.role)) {
    worker = { ready: local.state === 'ready', source: 'local', state: local.state, lastSeenAt: local.readyAt };
  } else {
    const heartbeats = await pbListStrict<HeartbeatRow>(SOCIAL_OPERATING_WORKER_HEARTBEATS, {
      filter: 'state = "ready"', sort: '-last_seen_at', page: 1, perPage: 1,
    });
    const heartbeat = heartbeats.items[0];
    const lastSeen = typeof heartbeat?.last_seen_at === 'string' ? heartbeat.last_seen_at : null;
    const age = lastSeen ? now.getTime() - Date.parse(lastSeen) : Number.POSITIVE_INFINITY;
    worker = {
      ready: Number.isFinite(age) && age >= 0 && age <= workerMaxAgeMs(),
      source: 'heartbeat', state: heartbeat?.state || 'missing', lastSeenAt: lastSeen,
    };
  }
  return {
    queueBacklog: { count: backlog.totalItems, oldestAt: backlog.items[0]?.createdAt || null },
    unknownReceipts: { count: posts.items.filter(hasUnknownReceipt).length },
    exhaustedBudgets: { count: exhaustedBudgets },
    invalidAuthorizations: { count: packages.items.filter(row => invalidAuthorization(row, now.toISOString().slice(0, 10))).length },
    worker,
  };
}

export async function assertSocialOperatingCollections(): Promise<void> {
  await Promise.all(SOCIAL_OPERATING_REQUIRED_COLLECTIONS.map(collection => (
    pbListStrict(collection, { page: 1, perPage: 1 }).then(() => undefined)
  )));
}
