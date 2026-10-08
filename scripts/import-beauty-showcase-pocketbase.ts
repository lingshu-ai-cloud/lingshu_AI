import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createCloudMaterial } from '../server/lib/cloudMaterials.js';

type JsonRecord = Record<string, any>;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureFile = path.join(root, 'fixtures', 'beauty-showcase', 'account-data.json');
const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8')) as {
  account: JsonRecord;
  tenant: JsonRecord;
  collections: Record<string, JsonRecord[]>;
  materials: JsonRecord[];
};

const oldTenantId = String(fixture.tenant.id || '');
const oldUserId = String(fixture.account.userId || '');
const email = String(fixture.account.email || '').trim().toLowerCase();
const password = String(process.env.BEAUTY_SHOWCASE_PASSWORD || '');
const dataOnly = process.env.BEAUTY_SHOWCASE_DATA_ONLY === 'true';
const pbUrl = String(process.env.PB_URL || 'http://pocketbase:8090').replace(/\/$/, '');
const appUrl = String(process.env.BEAUTY_SHOWCASE_APP_URL || 'http://app:8788').replace(/\/$/, '');

if (!oldTenantId || !oldUserId || !email) throw new Error('Beauty showcase fixture identity is incomplete');
if (!dataOnly && password.length < 10) throw new Error('BEAUTY_SHOWCASE_PASSWORD must contain at least 10 characters');

function pbValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function rawRequest(url: string, init: RequestInit = {}): Promise<{ response: Response; data: any; text: string }> {
  const response = await fetch(url, init);
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  return { response, data, text };
}

async function authenticateAdmin(): Promise<string> {
  const identity = String(process.env.PB_ADMIN_EMAIL || '').trim();
  const adminPassword = String(process.env.PB_ADMIN_PASSWORD || '');
  if (!identity || !adminPassword) throw new Error('PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD are required');
  for (const endpoint of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const { response, data } = await rawRequest(`${pbUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity, password: adminPassword }),
    });
    if (response.ok && data.token) return String(data.token);
  }
  throw new Error('PocketBase administrator authentication failed');
}

async function pbRequest<T = any>(token: string, endpoint: string, init: RequestInit = {}): Promise<T> {
  const { response, data, text } = await rawRequest(`${pbUrl}${endpoint}`, {
    ...init,
    headers: { Authorization: token, ...(init.headers || {}) },
  });
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${endpoint}: ${response.status} ${text}`);
  return data as T;
}

async function findOne(token: string, collection: string, filter: string): Promise<JsonRecord | null> {
  const query = new URLSearchParams({ page: '1', perPage: '1', filter });
  const result = await pbRequest<{ items?: JsonRecord[] }>(token, `/api/collections/${collection}/records?${query}`);
  return result.items?.[0] || null;
}

async function listAll(token: string, collection: string, filter: string): Promise<JsonRecord[]> {
  const records: JsonRecord[] = [];
  let page = 1;
  while (true) {
    const query = new URLSearchParams({ page: String(page), perPage: '200', filter });
    const result = await pbRequest<{ items?: JsonRecord[]; totalPages?: number }>(token, `/api/collections/${collection}/records?${query}`);
    records.push(...(result.items || []));
    if (page >= Number(result.totalPages || 1)) return records;
    page += 1;
  }
}

async function tenantExists(token: string, tenantId: string): Promise<boolean> {
  if (!tenantId) return false;
  const { response } = await rawRequest(`${pbUrl}/api/collections/tenants/records/${encodeURIComponent(tenantId)}`, {
    headers: { Authorization: token },
  });
  return response.ok;
}

async function ensureTenantAndUser(token: string): Promise<{ tenantId: string; userId: string }> {
  const existingUser = await findOne(token, 'users', `email = ${pbValue(email)}`);
  let tenantId = String(existingUser?.tenantId || '');
  if (!(await tenantExists(token, tenantId))) {
    const existingTenant = await findOne(token, 'tenants', `registeredEmail = ${pbValue(email)}`);
    tenantId = String(existingTenant?.id || '');
  }

  const tenantBody = {
    name: String(fixture.tenant.name || fixture.tenant.companyName || 'Aurelia 澄光美研有限公司'),
    companyName: String(fixture.tenant.companyName || fixture.tenant.name || 'Aurelia 澄光美研有限公司'),
    contactName: String(fixture.tenant.contactName || ''),
    contact: String(fixture.tenant.contact || email),
    industry: String(fixture.tenant.industry || ''),
    notes: String(fixture.tenant.notes || ''),
    subscriptionStatus: 'active',
    subscriptionPlan: 'customer',
    registeredEmail: email,
    registeredAt: String(fixture.tenant.registeredAt || new Date().toISOString()),
  };

  if (tenantId) {
    await pbRequest(token, `/api/collections/tenants/records/${tenantId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tenantBody),
    });
  } else {
    const created = await pbRequest<JsonRecord>(token, '/api/collections/tenants/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...tenantBody, createdAt: String(fixture.tenant.createdAt || new Date().toISOString()) }),
    });
    tenantId = String(created.id || '');
  }
  if (!tenantId) throw new Error('Failed to provision the beauty showcase tenant');

  const userBody = {
    email,
    password,
    passwordConfirm: password,
    name: String(fixture.account.name || 'Aurelia 美妆试用账号'),
    tenantId,
    role: 'admin',
    emailVisibility: true,
    verified: true,
  };
  const user = existingUser?.id
    ? await pbRequest<JsonRecord>(token, `/api/collections/users/records/${existingUser.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(userBody),
      })
    : await pbRequest<JsonRecord>(token, '/api/collections/users/records', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(userBody),
      });
  const userId = String(user.id || existingUser?.id || '');
  if (!userId) throw new Error('Failed to provision the beauty showcase user');
  return { tenantId, userId };
}

function remapIdentity(value: unknown, tenantId: string, userId: string): unknown {
  if (Array.isArray(value)) return value.map(item => remapIdentity(item, tenantId, userId));
  if (!value || typeof value !== 'object') {
    if (value === oldTenantId) return tenantId;
    if (value === oldUserId) return userId;
    return value;
  }
  return Object.fromEntries(Object.entries(value as JsonRecord).map(([key, nested]) => [key, remapIdentity(nested, tenantId, userId)]));
}

async function collectionFieldNames(token: string, collection: string): Promise<Set<string>> {
  const definition = await pbRequest<JsonRecord>(token, `/api/collections/${collection}`);
  const fields = Array.isArray(definition.fields) ? definition.fields : Array.isArray(definition.schema) ? definition.schema : [];
  return new Set(fields.map((field: JsonRecord) => String(field.name || '')).filter(Boolean));
}

function writableRecord(record: JsonRecord, allowed: Set<string>, tenantId: string, userId: string): JsonRecord {
  const systemFields = new Set(['id', 'created', 'updated', 'collectionId', 'collectionName', 'expand']);
  const remapped = remapIdentity(record, tenantId, userId) as JsonRecord;
  return Object.fromEntries(Object.entries(remapped).filter(([key]) => allowed.has(key) && !systemFields.has(key)));
}

async function replaceFixtureCollection(
  token: string,
  collection: string,
  records: JsonRecord[],
  tenantId: string,
  userId: string,
): Promise<number> {
  const allowed = await collectionFieldNames(token, collection);
  const tenantField = allowed.has('tenantId') ? 'tenantId' : allowed.has('tenant_id') ? 'tenant_id' : '';
  if (!tenantField) throw new Error(`${collection} has no tenant field`);
  const existing = await listAll(
    token,
    collection,
    `${tenantField} = ${pbValue(tenantId)} || ${tenantField} = ${pbValue(oldTenantId)}`,
  );
  for (const record of existing) {
    await pbRequest(token, `/api/collections/${collection}/records/${record.id}`, { method: 'DELETE' });
  }
  for (const record of records) {
    const body = writableRecord(record, allowed, tenantId, userId);
    await pbRequest(token, `/api/collections/${collection}/records`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  }
  return records.length;
}

function materialPath(value: unknown): string {
  const relative = String(value || '').replace(/^\/media\//, '').replace(/^\/+/, '');
  return path.join(root, 'data', 'media', relative);
}

function materialContentType(file: string, type: string): string {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.mov') return 'video/quicktime';
  if (extension === '.webm') return 'video/webm';
  if (extension === '.mp3') return 'audio/mpeg';
  if (extension === '.wav') return 'audio/wav';
  return type === 'image' ? 'image/jpeg' : type === 'audio' ? 'audio/mpeg' : 'video/mp4';
}

async function importMaterials(token: string, tenantId: string): Promise<number> {
  const materials = fixture.materials;
  const existing = await listAll(
    token,
    'materials',
    `tenantId = ${pbValue(tenantId)} || tenantId = ${pbValue(oldTenantId)}`,
  );
  for (const record of existing) {
    await pbRequest(token, `/api/collections/materials/records/${record.id}`, { method: 'DELETE' });
  }
  for (const material of materials) {
    const mediaPath = materialPath(material.file || material.url);
    if (!fs.existsSync(mediaPath) || !fs.statSync(mediaPath).isFile()) {
      const allowed = await collectionFieldNames(token, 'materials');
      const body = {
        ...writableRecord(material, allowed, tenantId, ''),
        tenantId,
        title: String(material.title || material.name || '未命名素材'),
        sha256: String(material.sha256 || material.contentSha256 || ''),
      };
      await pbRequest(token, '/api/collections/materials/records', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      continue;
    }
    const type = ['image', 'audio'].includes(String(material.type)) ? String(material.type) as 'image' | 'audio' : 'video';
    const bytes = fs.readFileSync(mediaPath);
    const posterPath = materialPath(material.poster);
    const poster = fs.existsSync(posterPath) && fs.statSync(posterPath).isFile() && fs.statSync(posterPath).size <= 5 * 1024 * 1024
      ? { name: path.basename(posterPath), path: posterPath, contentType: materialContentType(posterPath, 'image') }
      : undefined;
    await createCloudMaterial({
      tenantId,
      title: String(material.name || material.title || path.basename(mediaPath)),
      folder: String(material.folder || 'upload'),
      type,
      duration: Number(material.duration || 0),
      width: Number(material.width || 0),
      height: Number(material.height || 0),
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      scope: material.scope === 'shared' ? 'shared' : 'own',
      usage: material.usage === 'reference_only' ? 'reference_only' : 'editable',
      sourceType: String(material.sourceType || 'tenant_upload'),
      sourceName: String(material.sourceName || material.name || ''),
      sourceProvider: String(material.sourceProvider || ''),
      sourceCreator: String(material.sourceCreator || ''),
      sourceUrl: String(material.sourceUrl || ''),
      productId: String(material.productId || ''),
      tags: String(material.tags || ''),
      industry: String(material.industry || ''),
      shotFunction: String(material.shotFunction || ''),
      applicability: String(material.applicability || ''),
      licenseEvidence: String(material.licenseEvidence || ''),
      licenseName: String(material.licenseName || ''),
      licenseUrl: String(material.licenseUrl || ''),
      attributionText: String(material.attributionText || ''),
      commercialUseApproved: material.commercialUseApproved === true,
      derivativesApproved: material.derivativesApproved === true,
      rawLibraryUseApproved: material.rawLibraryUseApproved === true,
      provenance: material.provenance && typeof material.provenance === 'object' ? material.provenance : {},
      media: { name: path.basename(mediaPath), path: mediaPath, contentType: materialContentType(mediaPath, type) },
      poster,
    });
  }
  return materials.length;
}

async function verifyLoginAndData(token: string, tenantId: string): Promise<void> {
  if (!dataOnly) {
    const login = await rawRequest(`${appUrl}/api/overseas/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!login.response.ok || !login.data.token) {
      throw new Error(`Application login verification failed (${login.response.status}): ${login.text}`);
    }
    if (String(login.data.record?.tenantId || login.data.user?.tenantId || login.data.tenant?.id || '') !== tenantId) {
      throw new Error('Application login returned the wrong tenant');
    }
  }

  const profiles = await listAll(token, 'tenant_profiles', `tenant_id = ${pbValue(tenantId)}`);
  const products = profiles[0]?.profile?.products?.items;
  const expected = {
    materials: fixture.materials.length,
    trendVideos: fixture.collections.trend_videos?.length || 0,
    competitorAccounts: fixture.collections.competitor_accounts?.length || 0,
    weeklyPlans: fixture.collections.weekly_plans?.length || 0,
    contentTasks: fixture.collections.starter_social_content_tasks?.length || 0,
  };
  const counts = {
    enterpriseProfile: profiles.length,
    products: Array.isArray(products) ? products.length : 0,
    productImages: Array.isArray(products) ? products.filter((item: JsonRecord) => item?.imageUrl).length : 0,
    materials: (await listAll(token, 'materials', `tenantId = ${pbValue(tenantId)}`)).length,
    trendVideos: (await listAll(token, 'trend_videos', `tenantId = ${pbValue(tenantId)}`)).length,
    competitorAccounts: (await listAll(token, 'competitor_accounts', `tenantId = ${pbValue(tenantId)}`)).length,
    weeklyPlans: (await listAll(token, 'weekly_plans', `tenant_id = ${pbValue(tenantId)}`)).length,
    contentTasks: (await listAll(token, 'starter_social_content_tasks', `tenant_id = ${pbValue(tenantId)}`)).length,
  };
  const valid = counts.enterpriseProfile >= 1
    && counts.products === 41
    && counts.productImages === 40
    && counts.materials === expected.materials
    && counts.trendVideos === expected.trendVideos
    && counts.competitorAccounts === expected.competitorAccounts
    && counts.weeklyPlans === expected.weeklyPlans
    && counts.contentTasks === expected.contentTasks;
  console.log(JSON.stringify({ ok: valid, email, tenantId, expected, counts }, null, 2));
  if (!valid) throw new Error('Beauty showcase PocketBase count verification failed');
}

async function main(): Promise<void> {
  const token = await authenticateAdmin();
  const identity = dataOnly
    ? await findOne(token, 'users', `email = ${pbValue(email)}`).then(user => {
        const tenantId = String(user?.tenantId || '');
        const userId = String(user?.id || '');
        if (!tenantId || !userId) throw new Error('Beauty showcase PocketBase user is missing');
        return { tenantId, userId };
      })
    : await ensureTenantAndUser(token);
  const { tenantId, userId } = identity;
  if (process.env.BEAUTY_SHOWCASE_ACCOUNT_ONLY === 'true') {
    console.log(`BEAUTY_SHOWCASE_ACCOUNT_OK email=${email} tenantId=${tenantId} userId=${userId}`);
    return;
  }
  const orderedCollections = [
    'tenant_profiles',
    'competitor_accounts',
    'trend_videos',
    'crawl_jobs',
    'digital_employee_config_versions',
    'digital_employee_configs',
    'social_discovery_scopes',
    'social_programs',
    'weekly_goals',
    'weekly_plans',
    'workflow_runs',
    'workflow_tasks',
    'starter_social_content_tasks',
    'starter_social_content_files',
    'starter_social_content_operations',
    'starter_social_content_artifacts',
    'starter_social_director_plan_versions',
    'starter_social_task_sources',
    'studio_projects',
    'studio_digital_human_plans',
    'studio_shooting_tasks',
    'scheduled_tasks',
  ];
  for (const collection of orderedCollections) {
    try {
      const count = await replaceFixtureCollection(token, collection, fixture.collections[collection] || [], tenantId, userId);
      console.log(`IMPORTED ${collection}=${count}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes(`/api/collections/${collection}: 404`)) {
        console.log(`SKIPPED ${collection}=collection_not_available`);
        continue;
      }
      throw error;
    }
  }
  console.log(`IMPORTED materials=${await importMaterials(token, tenantId)}`);
  await verifyLoginAndData(token, tenantId);
  console.log('BEAUTY_SHOWCASE_POCKETBASE_OK');
}

await main();
