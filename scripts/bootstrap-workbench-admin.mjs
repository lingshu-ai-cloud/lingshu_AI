import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * One-shot, retry-safe application administrator bootstrap. PocketBase schema
 * is owned exclusively by pb_migrations; this script only reads and writes
 * tenant/user records after migrations have completed.
 */
export class WorkbenchBootstrapError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'WorkbenchBootstrapError';
    this.status = status;
  }
}

function requiredText(env, key) {
  const value = String(env[key] ?? '').trim();
  if (!value) throw new WorkbenchBootstrapError(`${key} is required`);
  return value;
}

function requiredSecret(env, key) {
  const value = String(env[key] ?? '');
  if (!value) throw new WorkbenchBootstrapError(`${key} is required`);
  return value;
}

function boundedTimeout(env) {
  const value = Number(env.PB_BOOTSTRAP_TIMEOUT_MS ?? env.PB_REQUEST_TIMEOUT_MS ?? 10_000);
  if (!Number.isInteger(value) || value < 1_000 || value > 60_000) {
    throw new WorkbenchBootstrapError('PB_BOOTSTRAP_TIMEOUT_MS must be an integer between 1000 and 60000');
  }
  return value;
}

function pocketBaseUrl(env) {
  const raw = requiredText(env, 'PB_URL').replace(/\/$/, '');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new WorkbenchBootstrapError('PB_URL must be a valid HTTP(S) URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new WorkbenchBootstrapError('PB_URL must be an HTTP(S) origin without credentials, query or fragment');
  }
  return raw;
}

function filterString(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function stableRecordId(kind, email) {
  return createHash('sha256').update(`lingshu-workbench-bootstrap\0${kind}\0${email}`).digest('hex').slice(0, 15);
}

function text(value) {
  return String(value ?? '').trim();
}

function changedFields(record, desired) {
  return Object.fromEntries(Object.entries(desired).filter(([key, value]) => {
    if (typeof value === 'boolean') return Boolean(record[key]) !== value;
    return text(record[key]) !== text(value);
  }));
}

export async function bootstrapWorkbenchAdmin(options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  if (typeof fetchImpl !== 'function') throw new WorkbenchBootstrapError('A Fetch API implementation is required');

  const baseUrl = pocketBaseUrl(env);
  const pbAdminEmail = requiredText(env, 'PB_ADMIN_EMAIL').toLowerCase();
  const pbAdminPassword = requiredSecret(env, 'PB_ADMIN_PASSWORD');
  const adminEmail = requiredText(env, 'WORKBENCH_ADMIN_EMAIL').toLowerCase();
  const adminPassword = String(env.WORKBENCH_ADMIN_PASSWORD ?? '');
  const adminName = requiredText({ value: env.WORKBENCH_ADMIN_NAME || '灵枢管理员' }, 'value');
  const timeoutMs = boundedTimeout(env);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pbAdminEmail) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    throw new WorkbenchBootstrapError('PB_ADMIN_EMAIL and WORKBENCH_ADMIN_EMAIL must be valid email addresses');
  }
  if (pbAdminEmail === adminEmail) {
    throw new WorkbenchBootstrapError('PB_ADMIN_EMAIL and WORKBENCH_ADMIN_EMAIL must identify separate accounts');
  }
  if (adminPassword.length < 12) {
    throw new WorkbenchBootstrapError('WORKBENCH_ADMIN_PASSWORD must contain at least 12 characters');
  }

  async function request(route, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${route}`, { ...init, signal: controller.signal });
      const raw = await response.text();
      let body = {};
      if (raw) {
        try { body = JSON.parse(raw); } catch { body = { message: raw.slice(0, 300) }; }
      }
      if (!response.ok) {
        const detail = text(body?.message || body?.data?.message || raw).slice(0, 300);
        throw new WorkbenchBootstrapError(`PocketBase request failed (${response.status})${detail ? `: ${detail}` : ''}`, response.status);
      }
      return body;
    } catch (error) {
      if (error instanceof WorkbenchBootstrapError) throw error;
      if (error?.name === 'AbortError') throw new WorkbenchBootstrapError(`PocketBase request timed out after ${timeoutMs}ms`);
      throw new WorkbenchBootstrapError(`PocketBase request failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  const auth = await request('/api/collections/_superusers/auth-with-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: pbAdminEmail, password: pbAdminPassword }),
  });
  const token = text(auth?.token);
  if (!token) throw new WorkbenchBootstrapError('PocketBase superuser authentication returned no token');
  const headers = { Authorization: token, 'Content-Type': 'application/json' };

  async function findUnique(collection, field, value) {
    const query = new URLSearchParams({
      page: '1',
      perPage: '2',
      skipTotal: '1',
      filter: `${field} = ${filterString(value)}`,
    });
    const result = await request(`/api/collections/${encodeURIComponent(collection)}/records?${query}`, { headers });
    const items = Array.isArray(result?.items) ? result.items : [];
    if (items.length > 1) throw new WorkbenchBootstrapError(`Refusing ambiguous bootstrap: duplicate ${collection}.${field}`);
    return items[0] ?? null;
  }

  async function createRecord(collection, body, lookupField, lookupValue) {
    try {
      return await request(`/api/collections/${encodeURIComponent(collection)}/records`, {
        method: 'POST', headers, body: JSON.stringify(body),
      });
    } catch (error) {
      // A deterministic id makes concurrent/retried first boots converge. Only
      // a confirmed record lookup may turn a create conflict into success.
      if (!(error instanceof WorkbenchBootstrapError) || ![400, 409].includes(error.status)) throw error;
      const winner = await findUnique(collection, lookupField, lookupValue);
      if (!winner) throw error;
      return winner;
    }
  }

  async function patchIfChanged(collection, record, desired) {
    const patch = changedFields(record, desired);
    if (!Object.keys(patch).length) return record;
    return request(`/api/collections/${encodeURIComponent(collection)}/records/${encodeURIComponent(text(record.id))}`, {
      method: 'PATCH', headers, body: JSON.stringify(patch),
    });
  }

  let [tenant, user] = await Promise.all([
    findUnique('tenants', 'registeredEmail', adminEmail),
    findUnique('users', 'email', adminEmail),
  ]);
  if (user && !tenant) {
    throw new WorkbenchBootstrapError('Refusing to rebind an existing workbench user when its bootstrap tenant is missing');
  }
  if (user && tenant) {
    const existingTenantId = text(user.tenantId);
    const existingRole = text(user.role);
    const bootstrapTenantId = text(tenant.id);
    if (!bootstrapTenantId) throw new WorkbenchBootstrapError('Workbench administrator tenant has no record id');
    if (existingTenantId && existingTenantId !== bootstrapTenantId) {
      throw new WorkbenchBootstrapError('Refusing to move an existing workbench user between tenants');
    }
    if (existingRole && existingRole !== 'super_admin') {
      throw new WorkbenchBootstrapError('Refusing to elevate an existing workbench user with a different role');
    }
  }

  const tenantDesired = {
    name: adminName,
    companyName: adminName,
    registeredEmail: adminEmail,
    subscriptionStatus: 'active',
    subscriptionPlan: 'admin',
    subscriptionExpiresAt: '',
  };
  if (!tenant) {
    tenant = await createRecord('tenants', {
      id: stableRecordId('tenant', adminEmail),
      ...tenantDesired,
      createdAt: now().toISOString(),
    }, 'registeredEmail', adminEmail);
  }
  if (!text(tenant?.id)) throw new WorkbenchBootstrapError('Workbench administrator tenant has no record id');
  tenant = await patchIfChanged('tenants', tenant, tenantDesired);
  const tenantId = text(tenant.id);

  if (user) {
    user = await patchIfChanged('users', user, {
      email: adminEmail,
      emailVisibility: true,
      name: adminName,
      tenantId,
      role: 'super_admin',
    });
  } else {
    user = await createRecord('users', {
      id: stableRecordId('user', adminEmail),
      email: adminEmail,
      emailVisibility: true,
      name: adminName,
      tenantId,
      role: 'super_admin',
      password: adminPassword,
      passwordConfirm: adminPassword,
    }, 'email', adminEmail);
  }
  if (!text(user?.id)
    || text(user.email).toLowerCase() !== adminEmail
    || text(user.tenantId) !== tenantId
    || text(user.role) !== 'super_admin'
    || user.emailVisibility !== true) {
    throw new WorkbenchBootstrapError('Workbench administrator account verification failed');
  }

  return { email: adminEmail, tenantId, userId: text(user.id) };
}

const invokedDirectly = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  bootstrapWorkbenchAdmin().then((result) => {
    console.log(`Workbench administrator ready: ${result.email} (tenant ${result.tenantId})`);
  }).catch((error) => {
    console.error(`Workbench administrator bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
