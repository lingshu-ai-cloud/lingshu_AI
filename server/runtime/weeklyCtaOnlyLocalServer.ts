/** An intentionally separate local HTTP surface for a blocked weekly CTA card.
 * Never import server/index.ts here: that entrypoint owns workers and recovery. */
import express, { type RequestHandler } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import type { AuthProvider, DataStore } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import { bindDataAuthority, dataAuthorityRequestScope } from '../storage/dataAuthority.js';
import { readWeeklyCtaContactCard, saveWeeklyCtaContact } from '../socialPrograms/weeklyCtaContact.js';
import { createWeeklyOperatingPackageService } from '../socialPrograms/weeklyOperatingPackages.js';
import { listWeeklyExecutionTasks } from '../socialPrograms/executionTasks.js';
import { auditWeeklyTasks } from '../socialPrograms/weeklyTaskAudit.js';
import { readWeeklyReviewActor } from '../socialPrograms/weeklyReviewEvidence.js';
import { SocialProgramError } from '../socialPrograms/service.js';
import { DURABLE_OPERATION_LEASE_COLLECTION } from './durableLease.js';
import { WEEKLY_CTA_CONTACTS } from '../socialPrograms/weeklyCtaContact.js';
import { readWeeklyPublicationProductSelectionChoices, issueWeeklyPublicationProductSelections, WEEKLY_PUBLICATION_PRODUCT_SELECTIONS, WEEKLY_PUBLICATION_PRODUCT_SELECTION_ISSUANCES } from '../socialPrograms/weeklyPublicationProductSelection.js';
import { readWeeklySamplePolicyCandidateContext, submitWeeklySamplePolicyCandidate, WEEKLY_SAMPLE_POLICY_CANDIDATES, type SamplePolicyTerms } from '../socialPrograms/weeklySamplePolicyEvidence.js';
import { objectStorageDriver, objectStorageUpload } from '../storage/objectStorage.js';
import { localAccountRecordsFile, readLocalAccountRecords } from '../lib/localAccountStore.js';
import { getLocalTenant } from '../lib/localTenants.js';
import { materialLibraryFile, readLocalMaterials, saveLocalMaterials } from '../lib/materialLibrary.js';
import { createWeeklyTaskCardTokenAuthority } from './weeklyTaskCardToken.js';
import { enterpriseAssetObjectKey } from '../storage/enterpriseAssets.js';
import { normalizeTenantMedia } from '../lib/tenantMediaNormalization.js';
import { currentProductFootageCandidateBytes, productFootageCandidateEvidence } from '../routes/enterpriseProductFootageCandidate.js';
import { weeklyCollectionCredentialIntervention } from './weeklyCollectionCredentialIntervention.js';
import { readWeeklyAccountCollectionPaidBlocker } from '../socialDiscovery/weeklyAccountCollectionPaidGate.js';
import { issueWeeklyAccountCollectionBudgetAuthorization, readCurrentWeeklyAccountCollectionBudget, WEEKLY_ACCOUNT_COLLECTION_BUDGET_AUTHORIZATIONS } from '../socialDiscovery/weeklyAccountCollectionBudget.js';
import {readWeeklyAccountCollectionPublishedCostPreflight} from '../socialDiscovery/weeklyAccountCollectionCostPreflight.js';
import { socialJson, socialObject, socialRequestHash } from '../starter198/socialContentValidation.js';

const base = '/api/overseas/social-programs/:programId/operating-packages/:packageId';
const queryVersion = (value: unknown) => typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const wrap = (handler: RequestHandler): RequestHandler => (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };
const smallSessionJson = express.json({ limit: '1kb', strict: true });
export const weeklyCtaOnlyLoopbackPeerAllowed = (address: string | undefined) =>
  ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? '');

const allowedWrites = new Set([DURABLE_OPERATION_LEASE_COLLECTION, WEEKLY_CTA_CONTACTS, WEEKLY_PUBLICATION_PRODUCT_SELECTIONS, WEEKLY_PUBLICATION_PRODUCT_SELECTION_ISSUANCES, WEEKLY_SAMPLE_POLICY_CANDIDATES, WEEKLY_ACCOUNT_COLLECTION_BUDGET_AUTHORIZATIONS]);
function limitedStore(source: DataStore, allowWrites: boolean): DataStore {
  const write = (collection: string) => {
    if (!allowWrites || !allowedWrites.has(collection))
      throw new Error('weekly_cta_only_write_forbidden');
  };
  return {
    supportsAtomicOperationLease: source.supportsAtomicOperationLease?.bind(source),
    supportsAtomicCompareAndSwap: source.supportsAtomicCompareAndSwap?.bind(source),
    getById: source.getById.bind(source),
    list: source.list.bind(source),
    create: (collection, data) => { write(collection); return source.create(collection, data); },
    update: (collection, id, data) => { write(collection); return source.update(collection, id, data); },
    delete: (collection, id) => { write(collection); return source.delete(collection, id); },
    compareAndSwap: source.compareAndSwap ? (collection, id, expected, data) => { write(collection); return source.compareAndSwap!(collection, id, expected, data); } : undefined,
  };
}
/** Candidate uploads must never fall through to COS or the repository's default media directory. */
export function assertWeeklyCtaOnlyObjectStorage(): void {
  const storeRoot = process.env.LOCAL_STORE_DIR;
  const objectRoot = process.env.LOCAL_OBJECT_STORAGE_ROOT;
  if (process.env.OBJECT_STORAGE_DRIVER !== 'local' || objectStorageDriver() !== 'local'
    || !storeRoot || !objectRoot || !path.isAbsolute(storeRoot) || !path.isAbsolute(objectRoot)
    || !fs.existsSync(storeRoot) || !fs.existsSync(objectRoot)) throw new Error('weekly_cta_only_object_storage_required');
  const storePath = fs.realpathSync(storeRoot), objectPath = fs.realpathSync(objectRoot);
  if (objectPath === storePath || !objectPath.startsWith(`${storePath}${path.sep}`))
    throw new Error('weekly_cta_only_object_storage_scope_invalid');
}

function samplePolicyPdf(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length > 28 * 1024 * 1024)
    throw new SocialProgramError('weekly_sample_policy_source_invalid', 400, '样品政策 PDF 无效。');
  const match = /^data:application\/pdf;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[1]!.length % 4 !== 0) throw new SocialProgramError('weekly_sample_policy_source_invalid', 400, '样品政策 PDF 无效。');
  const bytes = Buffer.from(match[1]!, 'base64');
  if (bytes.length < 5 || bytes.length > 20 * 1024 * 1024 || bytes.toString('base64') !== match[1]
    || bytes.subarray(0, 5).toString('ascii') !== '%PDF-')
    throw new SocialProgramError('weekly_sample_policy_source_invalid', 400, '样品政策 PDF 无效。');
  return bytes;
}

function sampleError(error: unknown): never {
  if (error instanceof Error && /^weekly_sample_policy_[a-z_]+$/.test(error.message)) {
    const status = error.message === 'weekly_sample_policy_package_missing' ? 404
      : error.message === 'weekly_sample_policy_actor_invalid' ? 403
      : ['weekly_sample_policy_source_invalid', 'weekly_sample_policy_terms_invalid', 'weekly_sample_policy_context_hash_invalid'].includes(error.message) ? 400 : 409;
    throw new SocialProgramError(error.message, status, error.message);
  }
  throw error;
}

export function createWeeklyCtaOnlyLocalApp(dataStore: DataStore = store, tokenAuth?: AuthProvider, options: { port?: number; tenantId?: string; userId?: string; programId?: string; packageId?: string; packageVersion?: number;costPreflightReader?:typeof readWeeklyAccountCollectionPublishedCostPreflight } = {}) {
  const app = express();
  const reader = limitedStore(dataStore, false);
  const writer = limitedStore(dataStore, true);
  app.disable('x-powered-by');
  app.use(dataAuthorityRequestScope);
  const port = options.port ?? Number(process.env.WEEKLY_CTA_ONLY_PORT);
  const cardProgramId = options.programId ?? process.env.WEEKLY_CTA_ONLY_PROGRAM_ID;
  const cardPackageId = options.packageId ?? process.env.WEEKLY_CTA_ONLY_PACKAGE_ID;
  const cardVersion = options.packageVersion ?? queryVersion(process.env.WEEKLY_CTA_ONLY_PACKAGE_VERSION);
  const cardTenantId = options.tenantId ?? process.env.WEEKLY_CTA_ONLY_TENANT_ID;
  const cardUserId = options.userId ?? process.env.WEEKLY_CTA_ONLY_USER_ID;
  if (!cardProgramId || !cardPackageId || !cardVersion || !cardTenantId || !cardUserId) throw new Error('weekly_cta_card_scope_required');
  const cardTokens = createWeeklyTaskCardTokenAuthority({ tenantId: cardTenantId, userId: cardUserId,
    programId: cardProgramId, packageId: cardPackageId, packageVersion: cardVersion });
  const registeredCardActor = () => {
    const matches = readLocalAccountRecords(localAccountRecordsFile())
      .filter(account => account.userId === cardUserId && account.tenantId === cardTenantId);
    return matches.length === 1 && matches[0]!.accountType === 'customer'
      && ['admin', 'super_admin', 'social_operator'].includes(String(matches[0]!.role))
      && !!getLocalTenant(cardTenantId);
  };
  const cardAuth: AuthProvider = tokenAuth ?? { async verifyToken(header) {
    if (!cardTokens.verify(header) || !registeredCardActor()) return null;
    bindDataAuthority('local');
    return { tenantId: cardTenantId, userId: cardUserId, dataAuthority: 'local' };
  } };
  const expectedHost = `127.0.0.1:${port}`;
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'POST') { res.status(404).json({ error: 'Not Found' }); return; }
    if (!weeklyCtaOnlyLoopbackPeerAllowed(req.socket.remoteAddress)) { res.status(403).json({ error: 'weekly_cta_local_peer_rejected' }); return; }
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535 || req.headers.host !== expectedHost) { res.status(403).json({ error: 'weekly_cta_local_host_rejected' }); return; }
    if (req.headers.origin && req.headers.origin !== `http://${expectedHost}`) { res.status(403).json({ error: 'weekly_cta_local_origin_rejected' }); return; }
    if (req.method === 'POST' && req.headers.origin !== `http://${expectedHost}`) { res.status(403).json({ error: 'weekly_cta_local_origin_required' }); return; }
    next();
  });
  // An explicit opt-in for the already registered preview customer, never a
  // fixed token or a new account. The token is short lived and verification
  // still rechecks both authoritative local registries on every API request.
  app.post('/api/overseas/auth/local-task-session', smallSessionJson, wrap(async (req, res) => {
    if (process.env.WEEKLY_CTA_ONLY_SESSION_ISSUER !== '1') { res.status(404).json({ error: 'Not Found' }); return; }
    if (req.headers['content-type'] !== 'application/json' || !req.body || typeof req.body !== 'object'
      || Array.isArray(req.body) || Object.keys(req.body).length !== 0) { res.status(400).json({ error: 'weekly_cta_session_input_invalid' }); return; }
    if (!registeredCardActor()) { res.status(403).json({ error: 'weekly_cta_session_identity_forbidden' }); return; }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ token: cardTokens.issue() });
  }));
  app.get('/api/overseas/auth/me', wrap(async (req, res) => {
    const header = req.headers.authorization;
    if (!header || !/^Bearer [^\s]+$/.test(header)) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const identity = await cardAuth.verifyToken(header);
    const tenantId = options.tenantId ?? process.env.WEEKLY_CTA_ONLY_TENANT_ID;
    const userId = options.userId ?? process.env.WEEKLY_CTA_ONLY_USER_ID;
    if (!identity || identity.dataAuthority !== 'local' || identity.supportAccess || identity.tenantId !== tenantId || identity.userId !== userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ user: { id: identity.userId, tenantId: identity.tenantId } });
  }));
  // Only a previously issued, currently valid local customer Bearer token is
  // accepted. No preview-account creation, asset cookie or browser-read token.
  const requireLocal = wrap(async (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !/^Bearer [^\s]+$/.test(header)) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const identity = await cardAuth.verifyToken(header);
    const tenantId = options.tenantId ?? process.env.WEEKLY_CTA_ONLY_TENANT_ID;
    const userId = options.userId ?? process.env.WEEKLY_CTA_ONLY_USER_ID;
    if (!identity || identity.dataAuthority !== 'local' || identity.supportAccess || identity.userId !== userId || identity.tenantId !== tenantId) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }
    Object.assign(res.locals, { tenantId: identity.tenantId, userId: identity.userId });
    next();
  });
  const requireCardScope: RequestHandler = (req, res, next) => {
    if (req.params.programId !== cardProgramId || req.params.packageId !== cardPackageId) {
      res.status(404).json({ error: 'Not Found' }); return;
    }
    if (req.method === 'POST' && req.headers['content-type'] !== 'application/json') { next(); return; }
    const requestedVersion = req.method === 'GET' ? queryVersion(req.query.version)
      : Number.isSafeInteger(req.body?.expectedPackageVersion) && req.body.expectedPackageVersion > 0
        ? req.body.expectedPackageVersion as number : null;
    if (requestedVersion !== cardVersion) {
      res.status(409).json({ error: 'weekly_cta_card_package_version_conflict' }); return;
    }
    next();
  };
  const readCollectionBudgetContext = async (tenantId: string) => {
    const rows = await reader.list<{id?: string; record_hash?: string; payload?: unknown}>('social_weekly_preproduction_jobs',
      { where: { tenant_id: tenantId, program_id: cardProgramId, package_id: cardPackageId, package_version: cardVersion }, perPage: 100 });
    if (rows.totalItems !== rows.items.length) throw new SocialProgramError('weekly_collection_budget_context_unverified', 409, '采集任务范围暂无法核验。');
    const discovery = rows.items.map(row => ({ row, job: socialObject(socialJson(row.payload)) }))
      .filter((item): item is {row: typeof item.row; job: Record<string, unknown>} => item.job?.kind === 'discovery');
    if (!discovery.length) throw new SocialProgramError('weekly_collection_budget_context_unverified', 409, '采集任务尚未就绪。');
    const identities = discovery.map(({ row, job }) => {
      const authority = socialObject(job.authority);
      const requestedModes = authority?.requestedModes;
      if (!row.id || job.tenantId !== tenantId || job.programId !== cardProgramId || job.packageId !== cardPackageId
        || job.packageVersion !== cardVersion || job.recordHash !== row.record_hash
        || job.recordHash !== socialRequestHash({ ...job, recordHash: '' }) || !authority?.scopeId
        || !authority.scopeVersion || !authority.scopeHash || !Array.isArray(requestedModes)
        || !requestedModes.includes('account') || new Set(requestedModes).size !== requestedModes.length) return null;
      return [authority.scopeId, authority.scopeVersion, authority.scopeHash] as const;
    });
    if (identities.includes(null) || new Set(identities.map(value => JSON.stringify(value))).size !== 1)
      throw new SocialProgramError('weekly_collection_budget_context_unverified', 409, '采集任务范围暂无法核验。');
    const [scopeId, scopeVersion, scopeHash] = identities[0]!;
    const scope = await reader.getById<{tenant_id?: string; version?: number; status?: string; payload?: unknown}>('social_discovery_scopes', String(scopeId));
    const payload = socialObject(socialJson(scope?.payload));
    const approval = socialObject(payload?.approval), revision = socialObject(payload?.weeklyAccountRevision);
    if (!payload || !revision || !approval || scope?.tenant_id !== tenantId || scope.version !== scopeVersion
      || scope.status !== 'active' || socialRequestHash(payload) !== scopeHash || approval.status !== 'approved'
      || approval.scopeVersion !== scopeVersion || revision.targetCount !== 5 || typeof revision.accountUrl !== 'string')
      throw new SocialProgramError('weekly_collection_budget_context_unverified', 409, '五条账号采集范围暂无法核验。');
    const actorId = process.env.APIFY_TIKTOK_ACTOR?.trim() || 'clockworks/tiktok-scraper';
    const scopeIdentity = { tenantId, programId: cardProgramId!, packageId: cardPackageId!, packageVersion: cardVersion!,
      scopeId: String(scopeId), scopeVersion: Number(scopeVersion), scopeHash: String(scopeHash), accountUrl: revision.accountUrl, actorId };
    return { ...scopeIdentity, contextHash: socialRequestHash({ ...scopeIdentity,
      jobs: discovery.map(({ row, job }) => [row.id, job.recordHash]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) }) };
  };
  app.get('/api/overseas/weekly-task-card-scope', requireLocal, wrap(async (_req, res) => {
    const programId = cardProgramId;
    const packageId = cardPackageId;
    const packageVersion = cardVersion;
    const { tenantId, userId } = res.locals as { tenantId: string; userId: string };
    const actor = await readWeeklyReviewActor(reader, tenantId, userId);
    if (!actor || actor.tenantId !== tenantId || actor.disabled === true || actor.active === false
      || ['disabled', 'suspended'].includes(String(actor.status))
      || !['admin', 'super_admin', 'social_operator'].includes(String(actor.role))) {
      res.status(403).json({ error: 'weekly_cta_card_actor_forbidden' }); return;
    }
    const pkg = await createWeeklyOperatingPackageService(reader).get(tenantId, programId, packageId);
    if (pkg.version !== packageVersion) { res.status(409).json({ error: 'weekly_cta_card_package_version_conflict' }); return; }
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ item: { programId, packageId, packageVersion } });
  }));
  app.get(`${base}/collection-runtime`, requireLocal, requireCardScope, wrap(async (_req, res) => {
    const {tenantId}=res.locals as {tenantId:string};
    const rows=await reader.list<{record_hash?:string;payload?:unknown}>('social_weekly_preproduction_jobs',{where:{tenant_id:tenantId,program_id:cardProgramId,package_id:cardPackageId,package_version:cardVersion},perPage:100});
    const discovery=rows.items.map(row=>({row,job:socialObject(socialJson(row.payload))})).filter((item):item is {row:typeof item.row;job:Record<string,unknown>}=>item.job?.kind==='discovery');
    const keys=new Set(discovery.map(({row,job})=>{
      const authority=socialObject(job.authority);
      if(job.tenantId!==tenantId||job.programId!==cardProgramId||job.packageId!==cardPackageId||job.packageVersion!==cardVersion||job.recordHash!==row.record_hash||job.recordHash!==socialRequestHash({...job,recordHash:''})||!authority?.scopeId||!authority.scopeVersion||!authority.scopeHash)return '';
      return JSON.stringify([authority.scopeId,authority.scopeVersion,authority.scopeHash]);
    }));
    let paidBlocker='weekly_preproduction_collection_budget_authorization_unverified';
    let publicCostPreflight:Awaited<ReturnType<typeof readWeeklyAccountCollectionPublishedCostPreflight>>=null;
    if(rows.totalItems===rows.items.length&&discovery.length>0&&keys.size===1&&!keys.has('')){
      const authority=socialObject(discovery[0]!.job.authority);
      const scope=await reader.getById<{tenant_id?:string;version?:number;status?:string;payload?:unknown} >('social_discovery_scopes',String(authority?.scopeId));
      const payload=socialObject(socialJson(scope?.payload));
      const revision=socialObject(payload?.weeklyAccountRevision);
      if(payload&&revision&&authority&&scope?.tenant_id===tenantId&&scope.version===authority.scopeVersion&&scope.status==='active'&&socialRequestHash(payload)===authority.scopeHash&&revision.targetCount===5&&typeof revision.accountUrl==='string'){
        const budgetContext={tenantId,programId:cardProgramId,packageId:cardPackageId,packageVersion:cardVersion!,scopeId:String(authority.scopeId),scopeVersion:Number(authority.scopeVersion),scopeHash:String(authority.scopeHash),accountUrl:String(revision.accountUrl)};
        paidBlocker=await readWeeklyAccountCollectionPaidBlocker({store:reader,...budgetContext});
        if(paidBlocker==='weekly_preproduction_collection_cost_ceiling_unverified'){
          try{const authorization=await readCurrentWeeklyAccountCollectionBudget(reader,budgetContext);publicCostPreflight=await (options.costPreflightReader??readWeeklyAccountCollectionPublishedCostPreflight)({authorization});}catch{/* Public diagnostics never alter the durable blocker. */}
        }
      }
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ item: weeklyCollectionCredentialIntervention(process.env,paidBlocker,publicCostPreflight) });
  }));
  app.get(`${base}/collection-budget`, requireLocal, requireCardScope, wrap(async (_req, res) => {
    const { tenantId } = res.locals as {tenantId: string};
    const context = await readCollectionBudgetContext(tenantId);
    const paidBlocker = await readWeeklyAccountCollectionPaidBlocker({ store: reader, ...context });
    let authorization: { authorizationId: string; totalLimitCny: number; perRunLimitCny: number; expiresAt: string } | null = null;
    if (paidBlocker === 'weekly_preproduction_collection_cost_ceiling_unverified') {
      const current = await readCurrentWeeklyAccountCollectionBudget(reader, context);
      authorization = { authorizationId: current.authorizationId, totalLimitCny: current.totalLimitCny,
        perRunLimitCny: current.perRunLimitCny, expiresAt: current.expiresAt };
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ item: { accountUrl: context.accountUrl, targetCount: 5, contextHash: context.contextHash,
      authorization, paidBlocker, permitsPaidCollection: false } });
  }));
  app.post(`${base}/collection-budget`, requireLocal, express.json({ limit: '2kb', strict: true }), requireCardScope, wrap(async (req, res) => {
    if (req.headers['content-type'] !== 'application/json') throw new SocialProgramError('weekly_collection_budget_content_type_invalid', 415, '只接受 JSON。');
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).sort().join(',') !== ['expectedPackageVersion', 'expectedContextHash', 'totalLimitCny', 'perRunLimitCny'].sort().join(',')
      || typeof body.expectedContextHash !== 'string' || typeof body.totalLimitCny !== 'number'
      || typeof body.perRunLimitCny !== 'number')
      throw new SocialProgramError('weekly_collection_budget_input_invalid', 400, '人民币预算参数无效。');
    const { tenantId, userId } = res.locals as {tenantId: string; userId: string};
    const context = await readCollectionBudgetContext(tenantId);
    if (body.expectedContextHash !== context.contextHash) throw new SocialProgramError('weekly_collection_budget_context_changed', 409, '采集范围已变化，请重新读取任务卡。');
    let authorization;
    try {
      authorization = await issueWeeklyAccountCollectionBudgetAuthorization({ store: writer, tenantId, actorUserId: userId,
        programId: context.programId, packageId: context.packageId, packageVersion: context.packageVersion,
        scopeId: context.scopeId, scopeVersion: context.scopeVersion, scopeHash: context.scopeHash, actorId: context.actorId,
        totalLimitCny: body.totalLimitCny, perRunLimitCny: body.perRunLimitCny,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'weekly_account_collection_budget_unavailable';
      if (code.startsWith('weekly_account_collection_budget_')) throw new SocialProgramError(code,
        code.endsWith('actor_invalid') ? 403 : code.endsWith('approval_input_invalid') ? 400
          : code.endsWith('authorization_write_unknown') ? 503 : 409, '预算未签发，请重新读取当前回执和采集范围。');
      throw error;
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(201).json({ item: { authorizationId: authorization.authorizationId,
      totalLimitCny: authorization.totalLimitCny, perRunLimitCny: authorization.perRunLimitCny,
      expiresAt: authorization.expiresAt, permitsPaidCollection: false,
      paidBlocker: 'weekly_preproduction_collection_cost_ceiling_unverified' } });
  }));
  const smallJson = express.json({ limit: '64kb', strict: true });
  const pdfJson = express.json({ limit: '28mb', strict: true });
  const footageJson = express.json({ limit: '42mb', strict: true });
  app.get(`${base}/cta-contact`, requireLocal, requireCardScope, wrap(async (req, res) => {
    const version = queryVersion(req.query.version);
    if (!version) throw new SocialProgramError('weekly_cta_version_invalid', 400, '请指定当前周包版本。');
    const { tenantId } = res.locals as { tenantId: string };
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ item: await readWeeklyCtaContactCard(reader, { tenantId, programId: req.params.programId, packageId: req.params.packageId, packageVersion: version }) });
  }));
  app.post(`${base}/cta-contact`, requireLocal, smallJson, requireCardScope, wrap(async (req, res) => {
    if (req.headers['content-type'] !== 'application/json') throw new SocialProgramError('weekly_cta_contact_content_type_invalid', 415, '只接受 JSON。');
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !['expectedPackageVersion', 'contactChannel', 'contactValue', 'expectedContextHash', 'expectedReceiptId'].includes(key))
      || !Number.isSafeInteger(body.expectedPackageVersion) || body.expectedPackageVersion < 1
      || body.contactChannel !== 'whatsapp' || typeof body.contactValue !== 'string'
      || typeof body.expectedContextHash !== 'string'
      || !Object.hasOwn(body, 'expectedReceiptId')
      || (body.expectedReceiptId !== null && typeof body.expectedReceiptId !== 'string'))
      throw new SocialProgramError('weekly_cta_contact_input_invalid', 400, '联系信息参数无效。');
    const { tenantId, userId } = res.locals as { tenantId: string; userId: string };
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ item: await saveWeeklyCtaContact(writer,
      { tenantId, programId: req.params.programId, packageId: req.params.packageId, packageVersion: body.expectedPackageVersion },
      userId, { contactChannel: 'whatsapp', contactValue: body.contactValue, expectedContextHash: body.expectedContextHash, expectedReceiptId: body.expectedReceiptId }) });
  }));
  app.get(`${base}/product-selection`, requireLocal, requireCardScope, wrap(async (req, res) => {
    const version = queryVersion(req.query.version);
    if (!version) throw new SocialProgramError('weekly_product_selection_input_invalid', 400, '请指定当前周包版本。');
    const { tenantId } = res.locals as { tenantId: string };
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ item: await readWeeklyPublicationProductSelectionChoices(reader, { tenantId, programId: req.params.programId, packageId: req.params.packageId, packageVersion: version }) });
  }));
  app.post(`${base}/product-selection`, requireLocal, smallJson, requireCardScope, wrap(async (req, res) => {
    if (req.headers['content-type'] !== 'application/json') throw new SocialProgramError('weekly_product_selection_content_type_invalid', 415, '只接受 JSON。');
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b)
      || Object.keys(b).some(key => !['expectedPackageVersion', 'expectedContextHash', 'productId', 'publicationTaskIds'].includes(key))
      || !Number.isSafeInteger(b.expectedPackageVersion) || b.expectedPackageVersion < 1
      || typeof b.expectedContextHash !== 'string' || typeof b.productId !== 'string'
      || !Array.isArray(b.publicationTaskIds) || b.publicationTaskIds.some((id: unknown) => typeof id !== 'string'))
      throw new SocialProgramError('weekly_product_selection_input_invalid', 400, '选品参数无效。');
    const { tenantId, userId } = res.locals as { tenantId: string; userId: string };
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ item: await issueWeeklyPublicationProductSelections(writer,
      { tenantId, programId: req.params.programId, packageId: req.params.packageId, packageVersion: b.expectedPackageVersion },
      userId, { expectedContextHash: b.expectedContextHash, productId: b.productId, publicationTaskIds: b.publicationTaskIds }) });
  }));
  app.get(`${base}/product-footage`, requireLocal, requireCardScope, wrap(async (req, res) => {
    const version = queryVersion(req.query.version);
    if (!version) throw new SocialProgramError('weekly_product_footage_scope_invalid', 400, '请指定当前周包版本。');
    const { tenantId } = res.locals as { tenantId: string };
    const choices = await readWeeklyPublicationProductSelectionChoices(reader,
      { tenantId, programId: req.params.programId, packageId: req.params.packageId, packageVersion: version });
    const selected = [...new Set(choices.publications.map(publication => publication.selectedProductId))];
    const productId = choices.selectionState === 'consistent' && selected.length === 1 ? selected[0] : null;
    const product = productId ? choices.products.find(item => item.id === productId) : null;
    const candidates = productId ? readLocalMaterials().filter(material =>
      String(material.tenantId || material.tenant_id || '') === tenantId
      && String(material.productId || '') === productId && material.type === 'video'
      && (material.provenance as Record<string, unknown> | undefined)?.footageCandidate) : [];
    res.setHeader('Cache-Control', 'private, no-store');
    const current = await Promise.all(candidates.map(async item => ({ id: item.id, name: item.name,
      sha256: item.contentSha256, status: 'pending_independent_review' as const,
      bytesCurrent: await currentProductFootageCandidateBytes({ material: item, tenantId, productId: productId! }).catch(() => false) })));
    res.json({ item: { product: product ? { id: product.id, name: product.name } : null,
      status: 'material_intervention_required', candidateCount: candidates.length, candidates: current } });
  }));
  app.post(`${base}/product-footage`, requireLocal, footageJson, requireCardScope, wrap(async (req, res) => {
    const { tenantId, userId } = res.locals as { tenantId: string; userId: string };
    const body = req.body as Record<string, unknown> | undefined;
    if (req.headers['content-type'] !== 'application/json' || !body || Array.isArray(body)
      || Object.keys(body).some(key => !['expectedPackageVersion', 'productId', 'name', 'dataUrl',
        'productIdentityEvidenceRef', 'rightsEvidenceRef'].includes(key)))
      throw new SocialProgramError('weekly_product_footage_input_invalid', 400, '视频候选参数无效。');
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const productId = typeof body.productId === 'string' ? body.productId.trim() : '';
    const evidence = productFootageCandidateEvidence({ productId, mediaType: 'video/mp4',
      identityEvidenceRef: body.productIdentityEvidenceRef, rightsEvidenceRef: body.rightsEvidenceRef });
    const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : '';
    const match = /^data:video\/(?:mp4|quicktime|webm);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
    if (!name || name.length > 160 || !evidence || !match || match[1]!.length % 4 !== 0)
      throw new SocialProgramError('weekly_product_footage_input_invalid', 400, '请提供视频及身份、权利来源。');
    const choices = await readWeeklyPublicationProductSelectionChoices(reader,
      { tenantId, programId: req.params.programId, packageId: req.params.packageId,
        packageVersion: Number(body.expectedPackageVersion) });
    const selected = [...new Set(choices.publications.map(publication => publication.selectedProductId))];
    if (choices.selectionState !== 'consistent' || selected.length !== 1 || selected[0] !== productId
      || !choices.products.some(item => item.id === productId))
      throw new SocialProgramError('weekly_product_footage_selection_changed', 409, '当前选品已变化，请刷新任务卡。');
    const root = process.env.LOCAL_STORE_DIR, file = materialLibraryFile();
    if (!root || !path.isAbsolute(root) || !process.env.MATERIAL_LIBRARY_FILE
      || fs.realpathSync(path.dirname(file)) !== fs.realpathSync(root)
      || (fs.existsSync(file) && path.dirname(fs.realpathSync(file)) !== fs.realpathSync(root)))
      throw new SocialProgramError('weekly_product_footage_storage_unavailable', 503, '素材目录暂不可写入。');
    assertWeeklyCtaOnlyObjectStorage();
    const bytes = Buffer.from(match[1]!, 'base64');
    if (!bytes.length || bytes.length > 30 * 1024 * 1024 || bytes.toString('base64') !== match[1])
      throw new SocialProgramError('weekly_product_footage_source_invalid', 400, '视频文件无效或超过 30 MB。');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-product-footage-'));
    try {
      const normalized = await normalizeTenantMedia({ buffer: bytes, originalName: name,
        declaredMimeType: dataUrl.slice(5, dataUrl.indexOf(';')), kind: 'video', temporaryDirectory: tempDir });
      const digest = createHash('sha256').update(normalized.buffer).digest('hex');
      if (digest !== normalized.sha256 || normalized.buffer.length > 30 * 1024 * 1024
        || normalized.duration <= 0 || normalized.width <= 0 || normalized.height <= 0)
        throw new SocialProgramError('weekly_product_footage_source_invalid', 400, '视频解码或时长无效。');
      const inventory = readLocalMaterials();
      const existing = inventory.find(item => String(item.tenantId || item.tenant_id || '') === tenantId
        && String(item.contentSha256 || '').toLowerCase() === digest);
      if (existing) {
        if (existing.type !== 'video' || String(existing.productId || '') !== productId
          || !existing.provenance?.footageCandidate
          || !await currentProductFootageCandidateBytes({ material: existing, tenantId, productId }).catch(() => false))
          throw new SocialProgramError('weekly_product_footage_hash_conflict', 409, '文件已关联其他资产。');
        res.setHeader('Cache-Control', 'private, no-store');
        res.json({ item: { id: existing.id, name: existing.name, sha256: digest,
          status: 'pending_independent_review' }, reused: true }); return;
      }
      const filename = `${Date.now()}-${randomUUID()}.mp4`;
      const objectKey = enterpriseAssetObjectKey(tenantId, filename);
      await objectStorageUpload({ key: objectKey,
        body: normalized.buffer, contentType: 'video/mp4' });
      const now = new Date().toISOString();
      const record = { id: `enterprise-${randomUUID()}`, tenantId, name, title: name,
        folder: 'enterprise-upload', type: 'video', duration: normalized.duration,
        width: normalized.width, height: normalized.height, sizeBytes: normalized.buffer.length,
        contentSha256: digest, sha256: digest, scope: 'own', usage: 'editable',
        sourceType: 'enterprise_upload', sourceProvider: 'tenant', productId, objectKey,
        sourceUrl: `/api/overseas/enterprise/assets/${filename}`,
        url: `/api/overseas/enterprise/assets/${filename}`,
        provenance: { uploadMethod: 'weekly_task_card', uploadedByUserId: userId, originalName: name,
          receivedAt: now, normalization: normalized.normalization,
          footageCandidate: { ...evidence, status: 'pending_independent_review' } },
        commercialUseApproved: false, rightsStatus: 'unverified', createdAt: now, updatedAt: now };
      saveLocalMaterials([...inventory, record]);
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ item: { id: record.id, name, sha256: digest,
        status: 'pending_independent_review' }, reused: false });
    } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
  }));
  app.get(`${base}/sample-policy-candidates`, requireLocal, requireCardScope, wrap(async (req, res) => {
    const version = queryVersion(req.query.version), publicationTaskId = req.query.publicationTaskId;
    if (!version || typeof publicationTaskId !== 'string' || !publicationTaskId.trim() || publicationTaskId.length > 160
      || Object.keys(req.query).some(key => !['version', 'publicationTaskId'].includes(key)))
      throw new SocialProgramError('weekly_sample_policy_scope_invalid', 400, '请指定当前周包版本与发布任务。');
    const { tenantId } = res.locals as { tenantId: string };
    res.setHeader('Cache-Control', 'private, no-store');
    try { res.json({ item: await readWeeklySamplePolicyCandidateContext(reader,
      { tenantId, programId: req.params.programId, packageId: req.params.packageId, packageVersion: version, publicationTaskId }) }); }
    catch (error) { sampleError(error); }
  }));
  app.post(`${base}/sample-policy-candidates`, requireLocal, pdfJson, requireCardScope, wrap(async (req, res) => {
    if (req.headers['content-type'] !== 'application/json') throw new SocialProgramError('weekly_sample_policy_content_type_invalid', 415, '只接受 JSON。');
    assertWeeklyCtaOnlyObjectStorage();
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b)
      || Object.keys(b).some(key => !['expectedPackageVersion', 'publicationTaskId', 'expectedContextHash', 'terms', 'pdfDataUrl'].includes(key))
      || !Number.isSafeInteger(b.expectedPackageVersion) || b.expectedPackageVersion < 1
      || typeof b.publicationTaskId !== 'string' || !b.publicationTaskId.trim() || b.publicationTaskId.length > 160
      || typeof b.expectedContextHash !== 'string' || !/^[a-f0-9]{64}$/.test(b.expectedContextHash)
      || !b.terms || typeof b.terms !== 'object' || Array.isArray(b.terms))
      throw new SocialProgramError('weekly_sample_policy_input_invalid', 400, '样品政策候选参数无效。');
    const { tenantId, userId } = res.locals as { tenantId: string; userId: string };
    const scope = { tenantId, programId: req.params.programId, packageId: req.params.packageId,
      packageVersion: b.expectedPackageVersion, publicationTaskId: b.publicationTaskId };
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const candidate = await submitWeeklySamplePolicyCandidate({ store: writer, scope, actorUserId: userId,
        expectedContextHash: b.expectedContextHash, terms: b.terms as SamplePolicyTerms, pdfBytes: samplePolicyPdf(b.pdfDataUrl) });
      res.status(201).json({ item: { candidateId: candidate.candidateId, publicationTaskId: scope.publicationTaskId,
        sourceSha256: candidate.sourceSha256, sourceSize: candidate.sourceSize, submittedAt: candidate.submittedAt,
        terms: candidate.terms, reviewStatus: candidate.reviewStatus, policyStatus: 'candidate_only', authorizesProduction: false } });
    } catch (error) { sampleError(error); }
  }));
  app.get(`${base}/execution-pipeline/task-audit`, requireLocal, requireCardScope, wrap(async (req, res) => {
    const version = queryVersion(req.query.version);
    if (!version) throw new SocialProgramError('weekly_pipeline_input_invalid', 400, '请指定当前周包版本。');
    const { tenantId, userId } = res.locals as { tenantId: string; userId: string };
    const actor = await readWeeklyReviewActor(reader, tenantId, userId);
    if (!actor || actor.tenantId !== tenantId || actor.disabled === true || actor.active === false || ['disabled', 'suspended'].includes(String(actor.status)) || !['admin', 'super_admin', 'social_operator'].includes(String(actor.role)))
      throw new SocialProgramError('weekly_pipeline_actor_forbidden', 403, '当前成员无周任务执行权限。');
    const pkg = await createWeeklyOperatingPackageService(reader).get(tenantId, req.params.programId, req.params.packageId);
    if (pkg.version !== version) throw new SocialProgramError('weekly_pipeline_version_conflict', 409, '周包已更新，请刷新后使用当前版本。');
    const tasks = await listWeeklyExecutionTasks(reader, tenantId, req.params.programId, req.params.packageId, version);
    if (!tasks.length || tasks.some(task => task.tenantId !== tenantId)) throw new SocialProgramError('weekly_pipeline_graph_invalid', 409, '缺少完整真实执行任务图。');
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ item: await auditWeeklyTasks(reader, tasks) });
  }));
  const uiDirectory = process.env.WEEKLY_CTA_ONLY_UI_DIR;
  if (uiDirectory && path.isAbsolute(uiDirectory) && fs.existsSync(path.join(uiDirectory, 'weekly-task-card.html'))) {
    app.get('/weekly-task-card', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
      res.sendFile(path.join(uiDirectory, 'weekly-task-card.html'));
    });
    app.use('/weekly-task-card/assets', express.static(path.join(uiDirectory, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }));
  }
  app.use((_req, res) => { res.status(404).json({ error: 'Not Found' }); });
  app.use(((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof SocialProgramError) { res.status(error.status).json({ error: error.code, message: error.message }); return; }
    if ((error as { type?: string } | null)?.type === 'entity.too.large') { res.status(413).json({ error: 'weekly_cta_local_body_too_large' }); return; }
    res.status(503).json({ error: 'weekly_cta_local_unavailable' });
  }) as express.ErrorRequestHandler);
  return app;
}

