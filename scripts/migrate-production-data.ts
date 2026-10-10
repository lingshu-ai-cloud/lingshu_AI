/**
 * Migrates local runtime JSON into PocketBase before the Singapore cut-over.
 * Dry-run is the default. Set MIGRATION_APPLY=true to write.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

/**
 * Apply mode is an invocation capability, not configuration. Consume it before
 * loading any dotenv file so a persisted environment file can never turn a
 * default dry run into a mutating migration.
 */
export function consumeMigrationApplyIntent(environment: NodeJS.ProcessEnv): boolean {
  const requested = String(environment.MIGRATION_APPLY || '').trim().toLowerCase() === 'true';
  delete environment.MIGRATION_APPLY;
  return requested;
}

const apply = consumeMigrationApplyIntent(process.env);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(root, '.env') });
dotenv.config({ path: path.join(root, '.env.production'), override: true });

const pbUrl = String(process.env.PB_URL || 'http://127.0.0.1:8090').replace(/\/$/, '');
const adminEmail = String(process.env.PB_ADMIN_EMAIL || '').trim();
const adminPassword = String(process.env.PB_ADMIN_PASSWORD || '').trim();
const dataDir = process.env.NODE_ENV === 'test' && process.env.MIGRATION_DATA_DIR
  ? path.resolve(process.env.MIGRATION_DATA_DIR)
  : path.join(root, 'data');
const passwordResetManifestFile = path.resolve(
  root,
  process.env.MIGRATION_PASSWORD_RESET_MANIFEST || 'data/migration-password-reset-required.json',
);

type JsonRecord = Record<string, any>;
export type LocalTenant = JsonRecord & { id: string; registeredEmail?: string };

export interface LocalTenantMigrationSource {
  file: string;
  tenants: LocalTenant[];
  hadRecoverableCredentials: boolean;
}

let persistenceAuthorized = false;

export interface PasswordResetRequiredAccount {
  email: string;
  oldTenantId: string;
  newTenantId?: string;
  companyName: string;
  reason: 'missing_auth_user' | 'missing_registered_email' | 'duplicate_registered_email';
  requiredAction:
    | 'provision_auth_user_via_one_time_reset'
    | 'repair_registered_email_before_reset'
    | 'resolve_duplicate_tenant_identity';
}

export interface PasswordResetRequiredManifest {
  schemaVersion: 1;
  generatedAt: string;
  applyRequested: boolean;
  releaseBlocked: boolean;
  unresolvedCount: number;
  accounts: PasswordResetRequiredAccount[];
}

const ORGANIZATION_ROLES = new Set(['super_admin', 'admin', 'social_operator', 'customer_service']);

export interface OrganizationRoleMigrationIssue {
  userId: string;
  email: string;
  tenantId: string;
  currentRole: string | null;
  requiredAction: 'assign_explicit_organization_role';
}

export function organizationRoleMigrationIssues(users: JsonRecord[]): OrganizationRoleMigrationIssue[] {
  return users.flatMap(user => {
    const currentRole = typeof user.role === 'string' ? user.role.trim() : '';
    if (ORGANIZATION_ROLES.has(currentRole)) return [];
    return [{
      userId: String(user.id || ''),
      email: String(user.email || '').trim().toLowerCase(),
      tenantId: String(user.tenantId || ''),
      currentRole: currentRole || null,
      requiredAction: 'assign_explicit_organization_role' as const,
    }];
  });
}

export function assertOrganizationRoleMigrationGate(issues: OrganizationRoleMigrationIssue[]): void {
  if (!issues.length) return;
  throw new Error(
    `${issues.length} user(s) have a missing or invalid organization role. Assign an explicit least-privilege role, then rerun the migration.`,
  );
}

export function buildPasswordResetRequiredManifest(
  accounts: PasswordResetRequiredAccount[],
  options: { applyRequested: boolean; generatedAt?: string },
): PasswordResetRequiredManifest {
  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    applyRequested: options.applyRequested,
    releaseBlocked: accounts.length > 0,
    unresolvedCount: accounts.length,
    accounts: accounts.map(account => ({ ...account })),
  };
}

export function assertPasswordResetMigrationGate(manifest: PasswordResetRequiredManifest): void {
  if (!manifest.applyRequested || manifest.unresolvedCount === 0) return;
  throw new Error(
    `${manifest.unresolvedCount} account(s) require an explicit password reset. Review ${passwordResetManifestFile}, provision those authentication users through the controlled reset workflow, then rerun the migration.`,
  );
}

export function migratedSupportDefaultAuthorized(value: unknown): boolean {
  return value === true;
}

function readJson<T>(relative: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, relative), 'utf8')) as T;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return fallback;
    throw new Error(`Cannot read migration source data/${relative}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parseLocalTenantMigrationSource(rawValue: string): LocalTenant[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new Error('local-auth-tenants.json must contain valid JSON');
  }
  if (!Array.isArray(parsed)) throw new Error('local-auth-tenants.json must contain an array');
  for (const [index, value] of parsed.entries()) {
    if (!value || typeof value !== 'object' || !String((value as JsonRecord).id || '').trim()) {
      throw new Error(`local-auth-tenants.json record ${index + 1} must contain a tenant id`);
    }
  }
  return parsed.map((value) => {
    const { registeredPasswordCipher, ...safeTenant } = value as JsonRecord;
    void registeredPasswordCipher;
    return safeTenant as LocalTenant;
  });
}

export function readLocalTenantMigrationSource(
  file = path.join(dataDir, 'local-auth-tenants.json'),
): LocalTenantMigrationSource {
  let rawValue: string;
  try {
    rawValue = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`Required tenant migration source is unavailable at ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const hadRecoverableCredentials = rawValue.includes('"registeredPasswordCipher"');
  const tenants = parseLocalTenantMigrationSource(rawValue);
  return { file, tenants, hadRecoverableCredentials };
}

function writeSecureJson(file: string, value: unknown): void {
  if (!apply || !persistenceAuthorized) {
    throw new Error('Migration persistence attempted before apply-mode validation completed');
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporaryFile = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryFile, file);
  try { fs.chmodSync(file, 0o600); } catch { /* Some platforms ignore POSIX modes. */ }
}

function pbValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function request(token: string, endpoint: string, init: RequestInit = {}): Promise<any> {
  const method = String(init.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && (!apply || !persistenceAuthorized)) {
    throw new Error(`Migration remote write attempted before apply-mode validation completed: ${method} ${endpoint}`);
  }
  const response = await fetch(`${pbUrl}${endpoint}`, {
    ...init,
    headers: { Authorization: token, ...(init.headers || {}) },
  });
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${endpoint}: ${response.status} ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function authenticate(): Promise<string> {
  if (!adminEmail || !adminPassword) throw new Error('PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD are required');
  for (const collection of ['_superusers', 'admins']) {
    const response = await fetch(`${pbUrl}/api/collections/${collection}/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: adminEmail, password: adminPassword }),
    }).catch(() => null);
    if (response?.ok) {
      const body = await response.json() as { token?: string };
      if (body.token) return body.token;
    }
  }
  throw new Error('PocketBase admin authentication failed');
}

async function findOne(token: string, collection: string, filter: string): Promise<JsonRecord | null> {
  const body = await request(token, `/api/collections/${collection}/records?perPage=1&filter=${encodeURIComponent(filter)}`);
  return body.items?.[0] || null;
}

async function listAllUsers(token: string): Promise<JsonRecord[]> {
  const users: JsonRecord[] = [];
  let page = 1;
  while (true) {
    const body = await request(token, `/api/collections/users/records?page=${page}&perPage=200`);
    users.push(...(Array.isArray(body.items) ? body.items : []));
    if (page >= Number(body.totalPages || 1)) return users;
    page += 1;
  }
}

async function preflightPasswordResets(
  token: string,
  tenants: LocalTenant[],
): Promise<{ existingUsers: Map<string, JsonRecord>; resetRequired: PasswordResetRequiredAccount[] }> {
  const existingUsers = new Map<string, JsonRecord>();
  const resetRequired: PasswordResetRequiredAccount[] = [];
  const seen = new Map<string, string>();
  for (const tenant of tenants) {
    const email = String(tenant.registeredEmail || '').trim().toLowerCase();
    const companyName = String(tenant.companyName || tenant.name || tenant.id);
    const requiresAuthUser = Boolean(tenant.registeredAt)
      || String(tenant.subscriptionPlan || '').toLowerCase() === 'customer';
    if (!email) {
      if (requiresAuthUser) {
        resetRequired.push({
          email: '',
          oldTenantId: tenant.id,
          companyName,
          reason: 'missing_registered_email',
          requiredAction: 'repair_registered_email_before_reset',
        });
      }
      continue;
    }
    if (seen.has(email)) {
      resetRequired.push({
        email,
        oldTenantId: tenant.id,
        companyName,
        reason: 'duplicate_registered_email',
        requiredAction: 'resolve_duplicate_tenant_identity',
      });
      continue;
    }
    seen.set(email, tenant.id);
    const existingUser = await findOne(token, 'users', `email = ${pbValue(email)}`);
    if (existingUser) {
      existingUsers.set(email, existingUser);
      continue;
    }
    resetRequired.push({
      email,
      oldTenantId: tenant.id,
      companyName,
      reason: 'missing_auth_user',
      requiredAction: 'provision_auth_user_via_one_time_reset',
    });
  }
  return { existingUsers, resetRequired };
}

async function upsert(
  token: string,
  collection: string,
  filter: string,
  payload: JsonRecord,
): Promise<JsonRecord | null> {
  const existing = await findOne(token, collection, filter);
  if (!apply) return existing || { id: `dry_${collection}` };
  return request(token, `/api/collections/${collection}/records${existing?.id ? `/${existing.id}` : ''}`, {
    method: existing?.id ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function migrateTenant(
  token: string,
  tenant: LocalTenant,
  existingUsers: Map<string, JsonRecord>,
): Promise<{ oldId: string; newId: string }> {
  const email = String(tenant.registeredEmail || '').trim().toLowerCase();
  const invite = String(tenant.registrationInviteCode || tenant.inviteCode || '').trim();
  const lookup = email
    ? `registeredEmail = ${pbValue(email)}`
    : invite
      ? `registrationInviteCode = ${pbValue(invite)}`
      : `name = ${pbValue(String(tenant.companyName || tenant.name || tenant.id))}`;
  const payload = {
    name: String(tenant.name || tenant.companyName || tenant.id),
    companyName: String(tenant.companyName || tenant.name || ''),
    contactName: String(tenant.contactName || ''),
    contact: String(tenant.contact || ''),
    industry: String(tenant.industry || ''),
    notes: String(tenant.notes || ''),
    inviteCode: String(tenant.inviteCode || ''),
    registrationInviteCode: invite,
    registeredEmail: email,
    registeredAt: String(tenant.registeredAt || ''),
    subscriptionStatus: String(tenant.subscriptionStatus || 'active'),
    subscriptionPlan: String(tenant.subscriptionPlan || 'customer'),
    subscriptionExpiresAt: tenant.subscriptionExpiresAt || null,
    createdAt: String(tenant.createdAt || new Date().toISOString()),
  };
  const remote = await upsert(token, 'tenants', lookup, payload);
  const newId = String(remote?.id || '');
  if (!newId) throw new Error(`Tenant migration did not return an id: ${tenant.id}`);

  if (email) {
    const existingUser = existingUsers.get(email);
    if (!existingUser) {
      console.warn(`  ! RESET REQUIRED: ${email} has no authentication user; recorded in ${passwordResetManifestFile}`);
    } else if (apply) {
      await request(token, `/api/collections/users/records/${existingUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: newId }),
      });
    }
  }
  return { oldId: tenant.id, newId };
}

function remap(value: unknown, mapping: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map(item => remap(item, mapping));
  if (!value || typeof value !== 'object') return value;
  const next: JsonRecord = {};
  for (const [key, item] of Object.entries(value as JsonRecord)) {
    if (['tenantId', 'tenant_id'].includes(key) && typeof item === 'string') next[key] = mapping.get(item) || item;
    else if (key === 'config' && item && typeof item === 'object') next[key] = remap(item, mapping);
    else next[key] = remap(item, mapping);
  }
  return next;
}

async function migrateOperationalData(token: string, mapping: Map<string, string>): Promise<void> {
  const tasks = remap(readJson<JsonRecord[]>('tasks.json', []), mapping) as JsonRecord[];
  for (const task of tasks) {
    const tenantId = String(task.tenantId || '');
    if (!tenantId || !task.id) continue;
    await upsert(token, 'scheduled_tasks', `tenant_id = ${pbValue(tenantId)} && task_id = ${pbValue(String(task.id))}`, {
      task_id: task.id, tenant_id: tenantId, name: task.name || task.id,
      category: task.category || '', task_type: task.taskType || 'custom', cron_expr: task.cronExpr || '0 8 * * *',
      cron_label: task.cronLabel || '', enabled: task.enabled !== false, channel_id: task.channelId || '',
      config: task.config || {}, last_run: task.lastRun || '', last_result: task.lastResult || '', created_at: task.createdAt || new Date().toISOString(),
    });
  }

  const customers = remap(readJson<JsonRecord[]>('whatsapp-customers.json', []), mapping) as JsonRecord[];
  for (const customer of customers) {
    if (!customer.tenantId || !customer.id) continue;
    await upsert(token, 'whatsapp_customers', `tenant_id = ${pbValue(customer.tenantId)} && customer_id = ${pbValue(customer.id)}`, {
      tenant_id: customer.tenantId, customer_id: customer.id, wa_number: customer.waNumber || '', name: customer.name || '',
      stage: customer.stage || '', last_active_at: Number(customer.lastActiveAt || 0), payload: customer,
    });
  }

  const interactions = remap(readJson<JsonRecord[]>('whatsapp-interactions.json', []), mapping) as JsonRecord[];
  for (const interaction of interactions) {
    if (!interaction.tenantId || !interaction.id) continue;
    await upsert(token, 'whatsapp_interactions', `tenant_id = ${pbValue(interaction.tenantId)} && interaction_id = ${pbValue(interaction.id)}`, {
      tenant_id: interaction.tenantId, interaction_id: interaction.id, customer_id: interaction.customerId || '',
      wa_number: interaction.waNumber || '', timestamp: Number(interaction.timestamp || 0), payload: interaction,
    });
  }

  const settings = readJson<Record<string, JsonRecord>>('support-access-settings.json', {});
  for (const [oldId, setting] of Object.entries(settings)) {
    const tenantId = mapping.get(oldId) || oldId;
    await upsert(token, 'tenant_support_settings', `tenant_id = ${pbValue(tenantId)}`, {
      tenant_id: tenantId, default_authorized: migratedSupportDefaultAuthorized(setting.defaultAuthorized), updated_by: setting.updatedByUserId || 'migration',
    });
  }

  const requests = remap(readJson<JsonRecord[]>('support-access.json', []), mapping) as JsonRecord[];
  for (const item of requests) {
    if (!item.id || !item.tenantId) continue;
    await upsert(token, 'support_access_requests', `request_id = ${pbValue(item.id)}`, {
      request_id: item.id, tenant_id: item.tenantId, tenant_name: item.tenantName || '', admin_user_id: item.requestedByUserId || 'migration',
      admin_email: item.requestedByEmail || '', status: item.status || 'revoked', requested_at: item.requestedAt || new Date().toISOString(), revoked_at: item.revokedAt || '',
    });
  }
  console.log(`  tasks=${tasks.length}, whatsappCustomers=${customers.length}, whatsappInteractions=${interactions.length}, supportRequests=${requests.length}`);
}

async function remapExistingPocketBaseRows(token: string, mapping: Map<string, string>): Promise<void> {
  for (const collection of ['trend_videos', 'competitor_accounts']) {
    for (const [oldId, newId] of mapping) {
      let page = 1;
      while (true) {
        const body = await request(token, `/api/collections/${collection}/records?page=${page}&perPage=200&filter=${encodeURIComponent(`tenantId = ${pbValue(oldId)}`)}`);
        for (const row of body.items || []) {
          if (apply) await request(token, `/api/collections/${collection}/records/${row.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: newId }),
          });
        }
        if (page >= Number(body.totalPages || 1)) break;
        page += 1;
      }
    }
  }
}

export async function main(): Promise<void> {
  persistenceAuthorized = false;
  console.log(`${apply ? 'APPLY' : 'DRY RUN'} migration against ${pbUrl}`);
  const token = await authenticate();
  const source = readLocalTenantMigrationSource();
  const { tenants } = source;
  const [preflight, existingUsers] = await Promise.all([
    preflightPasswordResets(token, tenants),
    listAllUsers(token),
  ]);
  const roleIssues = organizationRoleMigrationIssues(existingUsers);
  let resetManifest = buildPasswordResetRequiredManifest(preflight.resetRequired, {
    applyRequested: apply,
  });
  console.log(`  migration preflight: ${JSON.stringify({ passwordReset: resetManifest, organizationRoleIssues: roleIssues })}`);
  assertPasswordResetMigrationGate(resetManifest);
  assertOrganizationRoleMigrationGate(roleIssues);
  if (apply) persistenceAuthorized = true;
  const mapping = new Map<string, string>();
  for (const tenant of tenants) {
    const result = await migrateTenant(token, tenant, preflight.existingUsers);
    mapping.set(result.oldId, result.newId);
    console.log(`  tenant ${result.oldId} -> ${result.newId}`);
  }
  resetManifest = {
    ...resetManifest,
    accounts: resetManifest.accounts.map(account => ({
      ...account,
      newTenantId: mapping.get(account.oldTenantId),
    })),
  };
  await migrateOperationalData(token, mapping);
  await remapExistingPocketBaseRows(token, mapping);
  const mapFile = path.join(dataDir, 'migration-tenant-id-map.json');
  if (apply) {
    // Destructive local cleanup is deliberately last: preflight and all remote
    // migration work must succeed before the only recoverable source is changed.
    if (source.hadRecoverableCredentials) writeSecureJson(source.file, tenants);
    writeSecureJson(passwordResetManifestFile, resetManifest);
    writeSecureJson(mapFile, Object.fromEntries(mapping));
  }
  if (resetManifest.unresolvedCount) {
    console.warn(`Migration retains ${resetManifest.unresolvedCount} reset-required account(s); release remains gated by the manifest.`);
  }
  console.log(apply ? `Migration complete. Mapping written to ${mapFile}` : 'Dry run complete. Set MIGRATION_APPLY=true after reviewing output.');
}

const invokedDirectly = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
