import { createHash } from 'node:crypto';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { readWeeklyReviewActor } from '../socialPrograms/weeklyReviewEvidence.js';
import { organizationRoleOrNull } from '../lib/organizationRole.js';
import { socialRequestHash } from '../starter198/socialContentValidation.js';
import { frozenLinkedInCompanyActorInput, type LinkedInCompanyCollectionScope } from '../routes/linkedinCompanyPostPaidCollection.js';

export const LINKEDIN_COMPANY_COLLECTION_APPROVALS = 'social_linkedin_company_collection_approvals';
export const LINKEDIN_COMPANY_COLLECTION_REVOCATIONS = 'social_linkedin_company_collection_revocations';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code: string): never => { throw Error(`linkedin_company_collection_approval_${code}`); };
const money = (value: number) => Number.isFinite(value) && value > 0
  && Number.isSafeInteger(Math.round(value * 1_000_000))
  && Math.abs(Math.round(value * 1_000_000) / 1_000_000 - value) < 1e-9;

export interface LinkedInCompanyCollectionApproval {
  schema: 'linkedin-company-collection-approval.v1';
  approvalId: string;
  tenantId: string;
  discoveryRunId: string;
  discoveryScopeId: string;
  discoveryScopeVersion: number;
  discoveryScopeHash: string;
  companyUrl: string;
  limit: number;
  dateFrom: string;
  dateTo: string;
  actorId: string;
  actorInputSha256: string;
  maximumCny: number;
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
  recordHash: string;
}

type ScopeRecord = Record_ & {
  tenant_id: string; status: string; version: number; payload: {
    approval?: { status?: string; scopeVersion?: number };
    discoveryBrief?: { budgetLimitCny?: number | null; competitorAccounts?: string[];
      modePolicies?: { account?: { enabled?: boolean } } };
  };
};

function approvalId(scope: LinkedInCompanyCollectionScope): string {
  return digest(['linkedin-company-collection-approval.v1', scope.tenantId, scope.runId, scope.companyUrl]).slice(0, 15);
}

function scopeFromApproval(approval: LinkedInCompanyCollectionApproval): LinkedInCompanyCollectionScope {
  return { tenantId: approval.tenantId, runId: approval.discoveryRunId,
    companyUrl: approval.companyUrl, limit: approval.limit,
    dateFrom: approval.dateFrom, dateTo: approval.dateTo };
}

async function assertActor(store: DataStore, tenantId: string, userId: string): Promise<void> {
  const actor = await readWeeklyReviewActor(store, tenantId, userId);
  if (!actor || actor.tenantId !== tenantId || !['admin', 'super_admin', 'social_operator']
    .includes(organizationRoleOrNull(actor.role) ?? '') || actor.active === false
    || actor.disabled === true || ['disabled', 'suspended'].includes(String(actor.status))) fail('actor_invalid');
}

async function assertSourceCurrent(store: DataStore, input: {
  scope: LinkedInCompanyCollectionScope;
  discoveryScopeId: string;
  discoveryScopeVersion: number;
  discoveryScopeHash: string;
  maximumCny: number;
}): Promise<void> {
  const row = await store.getById<ScopeRecord>('social_discovery_scopes', input.discoveryScopeId);
  const brief = row?.payload?.discoveryBrief;
  if (!row || row.tenant_id !== input.scope.tenantId || row.status !== 'active'
    || row.version !== input.discoveryScopeVersion || socialRequestHash(row.payload) !== input.discoveryScopeHash
    || row.payload.approval?.status !== 'approved'
    || row.payload.approval.scopeVersion !== input.discoveryScopeVersion
    || brief?.modePolicies?.account?.enabled !== true
    || !brief.competitorAccounts?.includes(input.scope.companyUrl)
    || !money(Number(brief.budgetLimitCny)) || input.maximumCny > Number(brief.budgetLimitCny)) {
    fail('discovery_scope_changed');
  }
  const accounts = await store.list<{ platform: string; accountUrl: string }>('competitor_accounts', {
    where: { tenantId: input.scope.tenantId }, perPage: 200,
  });
  if (accounts.totalItems !== accounts.items.length || !accounts.items.some(account =>
    account.platform === 'linkedin' && account.accountUrl === input.scope.companyUrl)) fail('account_library_changed');
}

export async function approveLinkedInCompanyCollection(input: {
  store: DataStore;
  scope: LinkedInCompanyCollectionScope;
  discoveryScopeId: string;
  discoveryScopeVersion: number;
  discoveryScopeHash: string;
  actorId: string;
  maximumCny: number;
  approvedBy: string;
  expiresAt: string;
  now?: () => number;
}): Promise<LinkedInCompanyCollectionApproval> {
  const now = input.now?.() ?? Date.now();
  await assertActor(input.store, input.scope.tenantId, input.approvedBy);
  const actorInput = frozenLinkedInCompanyActorInput(input.scope);
  const companyUrl = (actorInput.startUrls as Array<{ url: string }>)[0]!.url;
  if (companyUrl !== input.scope.companyUrl || !input.discoveryScopeId
    || !Number.isSafeInteger(input.discoveryScopeVersion) || input.discoveryScopeVersion < 1
    || !/^[a-f0-9]{64}$/.test(input.discoveryScopeHash) || !money(input.maximumCny)
    || input.maximumCny > 15 || input.actorId !== (process.env.APIFY_LINKEDIN_ACTOR?.trim()
      || 'logical_scrapers/linkedin-company-posts-scraper')
    || !Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= now
    || Date.parse(input.expiresAt) > now + 31 * 86_400_000) fail('input_invalid');
  await assertSourceCurrent(input.store, { scope: input.scope,
    discoveryScopeId: input.discoveryScopeId, discoveryScopeVersion: input.discoveryScopeVersion,
    discoveryScopeHash: input.discoveryScopeHash, maximumCny: input.maximumCny });
  const id = approvalId(input.scope);
  if (await input.store.getById(LINKEDIN_COMPANY_COLLECTION_APPROVALS, id)) fail('already_exists');
  const item: LinkedInCompanyCollectionApproval = {
    schema: 'linkedin-company-collection-approval.v1', approvalId: id,
    tenantId: input.scope.tenantId, discoveryRunId: input.scope.runId,
    discoveryScopeId: input.discoveryScopeId, discoveryScopeVersion: input.discoveryScopeVersion,
    discoveryScopeHash: input.discoveryScopeHash, companyUrl, limit: input.scope.limit,
    dateFrom: input.scope.dateFrom, dateTo: input.scope.dateTo,
    actorId: input.actorId, actorInputSha256: digest(actorInput), maximumCny: input.maximumCny,
    approvedBy: input.approvedBy, approvedAt: new Date(now).toISOString(),
    expiresAt: input.expiresAt, recordHash: '',
  };
  item.recordHash = socialRequestHash({ ...item, recordHash: '' });
  if (!await input.store.create(LINKEDIN_COMPANY_COLLECTION_APPROVALS, {
    id, tenant_id: item.tenantId, run_id: item.discoveryRunId, company_url: companyUrl,
    record_hash: item.recordHash, payload: item,
  })) fail('write_unknown');
  return item;
}

export async function readCurrentLinkedInCompanyCollectionApproval(input: {
  store: DataStore;
  scope: LinkedInCompanyCollectionScope;
  discoveryScopeId: string;
  discoveryScopeVersion: number;
  discoveryScopeHash: string;
  now?: number;
}): Promise<LinkedInCompanyCollectionApproval> {
  const id = approvalId(input.scope);
  const row = await input.store.getById<Record_>(LINKEDIN_COMPANY_COLLECTION_APPROVALS, id);
  const item = row?.payload as LinkedInCompanyCollectionApproval | undefined;
  if (!row || !item) throw Error('linkedin_company_collection_approval_changed_or_expired');
  const actorInput = frozenLinkedInCompanyActorInput(input.scope);
  const storedScope = scopeFromApproval(item);
  if (row.id !== id || row.tenant_id !== item.tenantId || row.run_id !== item.discoveryRunId
    || row.company_url !== item.companyUrl || row.record_hash !== item.recordHash
    || item.schema !== 'linkedin-company-collection-approval.v1'
    || item.approvalId !== id || item.recordHash !== socialRequestHash({ ...item, recordHash: '' })
    || (Object.keys(input.scope) as Array<keyof LinkedInCompanyCollectionScope>)
      .some(key => storedScope[key] !== input.scope[key])
    || item.discoveryScopeId !== input.discoveryScopeId
    || item.discoveryScopeVersion !== input.discoveryScopeVersion
    || item.discoveryScopeHash !== input.discoveryScopeHash
    || item.actorId !== (process.env.APIFY_LINKEDIN_ACTOR?.trim()
      || 'logical_scrapers/linkedin-company-posts-scraper')
    || item.actorInputSha256 !== digest(actorInput) || !money(item.maximumCny)
    || item.maximumCny > 15 || Date.parse(item.expiresAt) <= (input.now ?? Date.now())) fail('changed_or_expired');
  await assertSourceCurrent(input.store, { scope: input.scope,
    discoveryScopeId: input.discoveryScopeId, discoveryScopeVersion: input.discoveryScopeVersion,
    discoveryScopeHash: input.discoveryScopeHash, maximumCny: item.maximumCny });
  const revocationId = digest(['linkedin-company-collection-revocation.v1', id]).slice(0, 15);
  if (await input.store.getById(LINKEDIN_COMPANY_COLLECTION_REVOCATIONS, revocationId)) fail('revoked');
  return item;
}

/** A live, store-backed approval check for a future trusted budget issuer.
 * This does not issue a paid permit or reserve money. */
export function createLinkedInCompanyApprovalAssertion(input: {
  store: DataStore;
  approval: LinkedInCompanyCollectionApproval;
  now?: () => number;
}): (scope: LinkedInCompanyCollectionScope, actorInputSha256: string) => Promise<void> {
  return async (scope, actorInputSha256) => {
    if (actorInputSha256 !== input.approval.actorInputSha256
      || (Object.keys(scope) as Array<keyof LinkedInCompanyCollectionScope>)
        .some(key => scopeFromApproval(input.approval)[key] !== scope[key])) fail('permit_scope_changed');
    const current = await readCurrentLinkedInCompanyCollectionApproval({
      store: input.store, scope,
      discoveryScopeId: input.approval.discoveryScopeId,
      discoveryScopeVersion: input.approval.discoveryScopeVersion,
      discoveryScopeHash: input.approval.discoveryScopeHash,
      now: input.now?.(),
    });
    if (current.recordHash !== input.approval.recordHash) fail('permit_approval_changed');
  };
}

export async function revokeLinkedInCompanyCollection(input: {
  store: DataStore; approval: LinkedInCompanyCollectionApproval;
  actorUserId: string; reason: string; now?: () => number;
}): Promise<void> {
  await assertActor(input.store, input.approval.tenantId, input.actorUserId);
  if (!input.reason.trim() || input.reason.length > 1000) fail('revocation_invalid');
  const current = await readCurrentLinkedInCompanyCollectionApproval({ store: input.store,
    scope: scopeFromApproval(input.approval), discoveryScopeId: input.approval.discoveryScopeId,
    discoveryScopeVersion: input.approval.discoveryScopeVersion,
    discoveryScopeHash: input.approval.discoveryScopeHash, now: input.now?.() });
  if (current.recordHash !== input.approval.recordHash) fail('revocation_invalid');
  const id = digest(['linkedin-company-collection-revocation.v1', input.approval.approvalId]).slice(0, 15);
  const item = { schema: 'linkedin-company-collection-revocation.v1', revocationId: id,
    approvalId: input.approval.approvalId, approvalHash: input.approval.recordHash,
    tenantId: input.approval.tenantId, revokedBy: input.actorUserId,
    revokedAt: new Date(input.now?.() ?? Date.now()).toISOString(), reason: input.reason.trim() };
  if (!await input.store.create(LINKEDIN_COMPANY_COLLECTION_REVOCATIONS, {
    id, tenant_id: item.tenantId, approval_id: item.approvalId,
    record_hash: socialRequestHash(item), payload: item,
  })) fail('revocation_write_unknown');
}
