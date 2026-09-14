import { Router } from 'express';
import path from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getPbUrl, getPbAdminToken, pbCreate, pbDelete, pbGet, pbList, pbListStrict, pbPatch } from '../storage/pb.js';
import { auth } from '../storage/index.js';
import { getTenantSubscription } from '../middleware/subscription.js';
import { buildDemoStatus, isExpired } from '../lib/demo.js';
import {
  accountGuideState,
  activateTrialAccount,
  consumeDemoGuide,
  isAdminEmail,
  isTrialAccount,
  requireAdminUser,
  rotateExpiredTrialPassword,
  trialExpiresAt,
  upsertDemoAccountRegistry,
} from '../lib/demoAccounts.js';
import {
  activateLocalTenantInvite,
  clearLocalTenantRegisteredCredential,
  findLocalTenantByInvite,
  findLocalTenantByRegistrationInvite,
  getLocalTenant,
  type LocalTenantRecord,
} from '../lib/localTenants.js';
import { clearAssetSessionCookie } from '../lib/assetAccess.js';
import {
  normalizeOrganizationRole as normalizedRole,
  organizationRoleOrNull,
  requestOrganizationRoleStrict,
  type OrganizationRole,
} from '../lib/organizationRole.js';
import { syncPasswordChangeCredentialStateBestEffort } from '../lib/passwordChangeCredentialState.js';
import { browserReadIdentity, isBrowserReadToken } from '../digitalEmployees/browserReadSession.js';
import { isLocalAccountStoreError, readLocalAccountRecords, writeLocalAccountRecords, type LocalStoredAccount } from '../lib/localAccountStore.js';
import { assertStarter198MemberCapacity, Starter198MemberQuotaError } from '../starter198/memberQuota.js';
import { requireAuth } from '../middleware/auth.js';

export const authRouter = Router();
interface PbUser { id: string; email?: string; name?: string; tenantId?: string; role?: OrganizationRole }
const LOCAL_AUTH_PREFIX = 'local-demo.';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_ACCOUNTS_FILE = process.env.NODE_ENV === 'test' && process.env.LOCAL_AUTH_ACCOUNTS_FILE
  ? path.resolve(process.env.LOCAL_AUTH_ACCOUNTS_FILE)
  : path.join(__dirname, '../../data/local-auth-accounts.json');

interface LocalIdentity {
  userId: string;
  tenantId: string;
  email?: string;
  name?: string;
  accountType?: 'customer' | 'trial' | 'admin';
  role?: OrganizationRole;
}

type LocalAccount = LocalStoredAccount & LocalIdentity;

interface LocalLoginResult {
  token: string;
  record: PbUser;
  accountType: 'customer' | 'trial' | 'admin';
  expiresAt?: string | null;
}

function isLocalDevFallbackEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.DISABLE_LOCAL_AUTH_FALLBACK !== 'true';
}

function localId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'demo';
}

function localUser(email: string, companyName = ''): PbUser {
  const normalizedEmail = String(email).trim().toLowerCase();
  const id = `local_user_${localId(normalizedEmail)}`;
  return {
    id,
    email: normalizedEmail,
    name: companyName || normalizedEmail.split('@')[0] || '本地账号',
    tenantId: `local_tenant_${localId(normalizedEmail)}`,
  };
}

function readLocalAccounts(): LocalAccount[] {
  return readLocalAccountRecords(LOCAL_ACCOUNTS_FILE);
}

function writeLocalAccounts(accounts: LocalAccount[]): void {
  writeLocalAccountRecords(LOCAL_ACCOUNTS_FILE, accounts);
}

function localStoreUnavailable(res: { status(code: number): { json(body: unknown): unknown } }): void {
  res.status(503).json({ error: 'local_auth_store_unavailable', message: '本地认证数据暂时不可用，请联系管理员修复后重试。' });
}

function passwordHash(password: string, salt: string): Buffer {
  return scryptSync(password, salt, 64);
}

function localPasswordMatches(account: LocalAccount, password: string): boolean {
  try {
    const stored = Buffer.from(account.passwordHash, 'hex');
    const candidate = passwordHash(password, account.salt);
    return stored.length === candidate.length && timingSafeEqual(stored, candidate);
  } catch {
    return false;
  }
}

function createLocalToken(user: PbUser, accountType: LocalLoginResult['accountType'] = 'customer'): string {
  const payload = Buffer.from(JSON.stringify({
    userId: user.id,
    tenantId: user.tenantId,
    email: user.email,
    name: user.name,
    accountType,
    role: normalizedRole(user.role),
  }), 'utf8').toString('base64url');
  return `${LOCAL_AUTH_PREFIX}${payload}`;
}

function parseLocalToken(authHeader: string | undefined): LocalIdentity | null {
  if (!isLocalDevFallbackEnabled()) return null;
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token?.startsWith(LOCAL_AUTH_PREFIX)) return null;
  try {
    const data = JSON.parse(Buffer.from(token.slice(LOCAL_AUTH_PREFIX.length), 'base64url').toString('utf8')) as Partial<LocalIdentity>;
    return data.userId && data.tenantId ? {
      userId: data.userId,
      tenantId: data.tenantId,
      email: data.email,
      name: data.name,
      accountType: data.accountType,
      role: data.role,
    } : null;
  } catch {
    return null;
  }
}

async function resolveLoginIdentity(identity: string): Promise<string> {
  const raw = String(identity).trim();
  if (raw.includes('@')) return raw;

  const adminToken = await getPbAdminToken();
  if (!adminToken) return raw;

  const normalized = raw.replace(/\s+/g, ' ');
  const filter = `name = "${normalized.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  try {
    const res = await fetch(`${getPbUrl()}/api/collections/users/records?perPage=1&filter=${encodeURIComponent(filter)}`, {
      headers: { Authorization: adminToken },
    });
    if (!res.ok) return raw;
    const json = (await res.json()) as { items?: PbUser[] };
    return json.items?.[0]?.email || raw;
  } catch {
    return raw;
  }
}

async function pbLogin(identity: string, password: string): Promise<{ token: string; record: PbUser } | null> {
  try {
    const loginIdentity = await resolveLoginIdentity(identity);
    const res = await fetch(`${getPbUrl()}/api/collections/users/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: loginIdentity, password }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { token: string; record: PbUser };
  } catch {
    return null;
  }
}

function localLogin(email: string, password: string): LocalLoginResult | null {
  if (!isLocalDevFallbackEnabled()) return null;
  const normalizedEmail = String(email).trim().toLowerCase();
  const account = readLocalAccounts().find(item => item.email === normalizedEmail);
  if (account) {
    if (!localPasswordMatches(account, password)) return null;
    clearLocalTenantRegisteredCredential(account.tenantId, account.email);
    const record: PbUser = {
      id: account.userId,
      email: account.email,
      name: account.name,
      tenantId: account.tenantId,
      role: normalizedRole(account.role),
    };
    return { token: createLocalToken(record, 'customer'), record, accountType: 'customer' };
  }

  const configuredAdminEmail = String(process.env.LOCAL_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const configuredAdminPassword = process.env.LOCAL_ADMIN_PASSWORD;
  if (
    configuredAdminEmail &&
    configuredAdminPassword &&
    normalizedEmail === configuredAdminEmail &&
    password === configuredAdminPassword
  ) {
    const record: PbUser = {
      id: `local_user_admin_${localId(normalizedEmail)}`,
      email: normalizedEmail,
      name: normalizedEmail.split('@')[0],
      tenantId: `local_tenant_admin_${localId(normalizedEmail)}`,
      role: 'super_admin',
    };
    return { token: createLocalToken(record, 'admin'), record, accountType: 'admin', expiresAt: null };
  }

  const allowedEmails = String(process.env.LOCAL_AUTH_EMAILS ?? '')
    .split(/[\s,;]+/)
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  const configuredPassword = process.env.LOCAL_AUTH_PASSWORD;
  if (!configuredPassword || !allowedEmails.includes(normalizedEmail) || password !== configuredPassword) return null;
  const accountType = isAdminEmail(normalizedEmail) ? 'admin' : 'trial';
  const record: PbUser = {
    id: `local_user_${accountType}_${localId(normalizedEmail)}`,
    email: normalizedEmail,
    name: normalizedEmail.split('@')[0],
    tenantId: `local_tenant_${accountType}_${localId(normalizedEmail)}`,
  };
  if (accountType === 'admin') {
    return { token: createLocalToken(record, accountType), record, accountType, expiresAt: null };
  }
  const expiresAt = trialExpiresAt();
  upsertDemoAccountRegistry(normalizedEmail, {
    userId: record.id,
    tenantId: record.tenantId,
    activatedAt: new Date().toISOString(),
    expiresAt,
    status: 'trialing',
    credentialState: 'external_secret',
  });
  return { token: createLocalToken(record, accountType), record, accountType, expiresAt };
}

function localRegister(email: string, password: string, tenant: LocalTenantRecord):
  | { ok: true; token: string; record: PbUser }
  | { ok: false; error: string }
  | null {
  if (!isLocalDevFallbackEnabled()) return null;
  const normalizedEmail = String(email).trim().toLowerCase();
  const accounts = readLocalAccounts();
  if (accounts.some(item => item.email === normalizedEmail)) {
    return { ok: false, error: '该邮箱已注册，请直接登录' };
  }
  const record: PbUser = {
    id: `local_user_customer_${localId(normalizedEmail)}`,
    email: normalizedEmail,
    name: tenant.companyName || tenant.name || normalizedEmail.split('@')[0],
    tenantId: tenant.id,
    // This is the first account created from a one-use tenant invite, so it is
    // the tenant Owner. All other missing/invalid roles normalize downward.
    role: 'super_admin',
  };
  const salt = randomBytes(16).toString('hex');
  accounts.push({
    userId: String(record.id),
    tenantId: String(record.tenantId),
    email: normalizedEmail,
    name: String(record.name || normalizedEmail.split('@')[0]),
    accountType: 'customer',
    role: 'super_admin',
    salt,
    passwordHash: passwordHash(password, salt).toString('hex'),
    createdAt: new Date().toISOString(),
  });
  writeLocalAccounts(accounts);
  return { ok: true, token: createLocalToken(record, 'customer'), record };
}

function publicUser(r: PbUser) {
  return { id: r.id, email: r.email ?? '', name: r.name ?? '', tenantId: r.tenantId ?? '', role: normalizedRole(r.role) };
}

function pbFilterValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function tenantByInviteCode(code: string): Promise<Record<string, unknown> | null> {
  const invite = String(code || '').trim();
  if (!invite) return null;
  try {
    const result = await pbListStrict<Record<string, unknown>>('tenants', {
      perPage: 1,
      filter: `inviteCode = ${pbFilterValue(invite)}`,
    });
    return result.items[0] ?? null;
  } catch {
    return null;
  }
}

async function tenantByUsedInviteCode(code: string): Promise<Record<string, unknown> | null> {
  const invite = String(code || '').trim();
  if (!invite) return null;
  try {
    const result = await pbListStrict<Record<string, unknown>>('tenants', {
      perPage: 1,
      filter: `registrationInviteCode = ${pbFilterValue(invite)}`,
    });
    return result.items[0] ?? null;
  } catch {
    return null;
  }
}

function publicTenant(t: Record<string, unknown> | null) {
  if (!t) return null;
  return {
    id: t.id,
    name: t.name ?? '',
    subscriptionStatus: t.subscriptionStatus ?? 'none',
    subscriptionPlan: t.subscriptionPlan ?? null,
    subscriptionExpiresAt: t.subscriptionExpiresAt ?? null,
  };
}

// GET /auth/invite/:code
authRouter.get('/invite/:code', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const code = String(req.params.code || '').trim();
  if (!code) {
    res.status(400).json({ error: 'invite_code_required' });
    return;
  }
  const invitedTenant = await tenantByInviteCode(code);
  const localInvitedTenant = invitedTenant ? null : findLocalTenantByInvite(code);
  const tenant = invitedTenant || localInvitedTenant;
  if (tenant) {
    res.json({
      valid: true,
      companyName: String(tenant.companyName || tenant.name || ''),
    });
    return;
  }
  const usedTenant = await tenantByUsedInviteCode(code) || findLocalTenantByRegistrationInvite(code);
  if (!usedTenant) {
    res.status(404).json({ valid: false, error: '邀请码无效或已使用' });
    return;
  }
  res.status(410).json({
    valid: false,
    companyName: String(usedTenant.companyName || usedTenant.name || ''),
    error: '邀请码已使用，请联系管理员重新生成',
  });
});

// POST /auth/register  { email, password, inviteCode }
authRouter.post('/register', async (req, res) => {
  const { email, password, inviteCode } = req.body ?? {};
  if (!email || !password) { res.status(400).json({ error: '邮箱和密码必填' }); return; }
  if (String(password).length < 8) { res.status(400).json({ error: '密码至少 8 位' }); return; }
  const code = String(inviteCode || '').trim();
  if (!code) { res.status(400).json({ error: '请输入管理员提供的邀请码' }); return; }

  const invitedTenant = await tenantByInviteCode(code);
  const localInvitedTenant = invitedTenant ? null : findLocalTenantByInvite(code);
  if (!invitedTenant && !localInvitedTenant) {
    res.status(403).json({ error: '邀请码无效或已使用，请联系管理员重新生成' });
    return;
  }

  if (localInvitedTenant) {
    let fallback: ReturnType<typeof localRegister>;
    try {
      fallback = localRegister(String(email), String(password), localInvitedTenant);
    } catch (error) {
      if (isLocalAccountStoreError(error)) { localStoreUnavailable(res); return; }
      throw error;
    }
    if (fallback?.ok) {
      const tenant = activateLocalTenantInvite({
        inviteCode: code,
        email: String(email),
      });
      if (!tenant) {
        res.status(409).json({ error: '邀请码已被使用，请联系管理员重新生成' });
        return;
      }
      res.json({
        token: fallback.token,
        user: publicUser(fallback.record),
        tenant: publicTenant(tenant as unknown as Record<string, unknown>),
      });
      return;
    }
    if (fallback && !fallback.ok) {
      res.status(409).json({ error: fallback.error });
      return;
    }
    res.status(500).json({ error: '创建账号失败' }); return;
  }

  const invitedCompanyName = String(invitedTenant!.companyName || invitedTenant!.name || '').trim();
  let user: Record<string, unknown> | null = null;
  try {
    user = await pbCreate('users', {
      email, password, passwordConfirm: password,
      name: invitedCompanyName, tenantId: invitedTenant!.id, role: 'super_admin', emailVisibility: true,
    });
  } catch {
    user = null;
  }
  if (!user) {
    res.status(400).json({ error: '创建用户失败（邮箱可能已被注册）' }); return;
  }

  const login = await pbLogin(email, password);
  if (!login) { res.status(500).json({ error: '注册后自动登录失败' }); return; }
  const updatedTenant = await pbPatch('tenants', String(invitedTenant!.id), {
    name: invitedCompanyName || String(email).split('@')[0],
    companyName: invitedCompanyName,
    inviteCode: '',
    registrationInviteCode: code,
    registeredEmail: String(email).trim().toLowerCase(),
    registeredAt: new Date().toISOString(),
    subscriptionStatus: 'active',
    subscriptionPlan: 'customer',
    subscriptionExpiresAt: null,
  });
  if (!updatedTenant) {
    await pbDelete('users', String(user.id));
    res.status(500).json({ error: '租户凭据清理失败，注册已安全回滚，请重试' }); return;
  }
  const tenant = await pbGet('tenants', String(invitedTenant!.id)) || {
    ...invitedTenant,
    inviteCode: '',
    subscriptionStatus: 'active',
    subscriptionPlan: 'customer',
    subscriptionExpiresAt: null,
  };
  res.json({
    token: login.token,
    user: publicUser(login.record),
    tenant: publicTenant(tenant),
  });
});

// POST /auth/login  { email, password }
authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) { res.status(400).json({ error: '邮箱和密码必填' }); return; }
  const login = await pbLogin(email, password);
  if (!login) {
    let fallback: LocalLoginResult | null;
    try {
      fallback = localLogin(email, password);
    } catch (error) {
      if (isLocalAccountStoreError(error)) { localStoreUnavailable(res); return; }
      throw error;
    }
    if (!fallback) { res.status(401).json({ error: '邮箱或密码错误' }); return; }
    const subscription = await getTenantSubscription(String(fallback.record.tenantId || ''));
    const fallbackEmail = String(fallback.record.email ?? email).trim().toLowerCase();
    const fallbackGuide = accountGuideState(
      fallbackEmail,
      fallback.expiresAt ? `${fallback.record.id}:${fallback.expiresAt}` : fallback.record.id,
    );
    const demoStatus = fallback.accountType === 'trial' || fallbackGuide.pending
      ? await buildDemoStatus(req, fallback.record.tenantId, fallback.expiresAt, fallback.record.id)
      : undefined;
    const demo = demoStatus ? {
      ...demoStatus,
      guideTrigger: fallbackGuide.pending,
      guideScope: fallbackGuide.scope,
    } : undefined;
    res.json({
      token: fallback.token,
      user: publicUser(fallback.record),
      tenant: publicTenant({
        id: fallback.record.tenantId,
        name: fallback.record.name,
        subscriptionStatus: subscription.status,
        subscriptionPlan: subscription.plan,
        subscriptionExpiresAt: subscription.expiresAt,
      }),
      subscription,
      demo,
    });
    return;
  }
  let tenant = login.record.tenantId ? await pbGet('tenants', login.record.tenantId) : null;
  let subscription = login.record.tenantId ? await getTenantSubscription(login.record.tenantId) : null;
  const loginEmail = String(login.record.email ?? email).trim().toLowerCase();
  if (isTrialAccount(subscription) && login.record.tenantId && !subscription?.expiresAt) {
    const activated = await activateTrialAccount(login.record.email ?? email, login.record.id, login.record.tenantId);
    tenant = await pbGet('tenants', login.record.tenantId);
    subscription = { status: 'trialing', plan: 'trial', expiresAt: activated.expiresAt };
    const demoStatus = await buildDemoStatus(req, login.record.tenantId, activated.expiresAt, login.record.id);
    const guide = accountGuideState(loginEmail, `${login.record.id}:${activated.expiresAt}`);
    res.json({
      token: login.token,
      user: publicUser(login.record),
      tenant: publicTenant(tenant),
      demo: {
        ...demoStatus,
        guideTrigger: activated.activatedNow || guide.pending,
        guideScope: guide.scope,
      },
    });
    return;
  }
  if (subscription?.expiresAt && isExpired(subscription.expiresAt)) {
    await rotateExpiredTrialPassword(login.record, 'login_trial_expired');
    res.status(402).json({ error: '试用账号已到期，请联系服务顾问开通或延长试用。' });
    return;
  }
  const demoStatus = await buildDemoStatus(req, login.record.tenantId, subscription?.expiresAt, login.record.id);
  const guide = accountGuideState(
    loginEmail,
    subscription?.expiresAt ? `${login.record.id}:${subscription.expiresAt}` : login.record.id,
  );
  res.json({
    token: login.token,
    user: publicUser(login.record),
    tenant: publicTenant(tenant),
    demo: {
      ...demoStatus,
      guideTrigger: guide.pending,
      guideScope: guide.scope,
    },
  });
});

authRouter.post('/logout', (_req, res) => {
  clearAssetSessionCookie(res);
  res.json({ ok: true });
});

// All routes below are authenticated; starter_198 permits only the explicit
// auth paths in its boundary registry, so a future endpoint is denied by default.
authRouter.use(requireAuth);

// GET /auth/me  (Authorization: Bearer <token>)
authRouter.get('/me', async (req, res) => {
  if (isBrowserReadToken(req.headers.authorization)) {
    const identity = browserReadIdentity(req);
    if (!identity) { res.status(403).json({ error: 'agent_browser_read_only' }); return; }
    const tenant = await pbGet('tenants', identity.tenantId).catch(() => null) || getLocalTenant(identity.tenantId);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ user: { id: identity.userId, email: '', name: 'Agent 生产会话', tenantId: identity.tenantId, role: identity.role }, tenant: publicTenant(tenant as Record<string, unknown> | null) });
    return;
  }
  const local = parseLocalToken(req.headers.authorization);
  if (local) {
    const name = local.name || local.email?.split('@')[0] || '本地账号';
    const subscription = await getTenantSubscription(local.tenantId);
    if (subscription.expiresAt && isExpired(subscription.expiresAt)) {
      res.status(402).json({ error: '试用账号已到期，请联系管理员获取其他备用账号。' });
      return;
    }
    const localGuide = accountGuideState(
      local.email || '',
      subscription.expiresAt ? `${local.userId}:${subscription.expiresAt}` : local.userId,
    );
    const demoStatus = subscription.status === 'trialing' || subscription.plan === 'trial' || localGuide.pending
      ? await buildDemoStatus(req, local.tenantId, subscription.expiresAt, local.userId)
      : undefined;
    const demo = demoStatus ? {
      ...demoStatus,
      guideTrigger: localGuide.pending,
      guideScope: localGuide.scope,
    } : undefined;
    const storedTenant = getLocalTenant(local.tenantId);
    res.json({
      user: { id: local.userId, email: local.email || '', name, tenantId: local.tenantId, role: normalizedRole(local.role) },
      tenant: publicTenant({
        id: local.tenantId,
        name: storedTenant?.name || name,
        subscriptionStatus: subscription.status,
        subscriptionPlan: subscription.plan,
        subscriptionExpiresAt: subscription.expiresAt,
      }),
      subscription,
      demo,
      platformAdmin: Boolean(await requireAdminUser(req)),
    });
    return;
  }
  const id = await auth.verifyToken(req.headers.authorization);
  if (!id) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const [user, remoteTenant] = await Promise.all([
    pbGet('users', id.userId).catch(() => null),
    pbGet('tenants', id.tenantId).catch(() => null),
  ]);
  const localTenant = getLocalTenant(id.tenantId);
  const tenant = remoteTenant || (localTenant as unknown as Record<string, unknown> | null);
  const subscription = await getTenantSubscription(id.tenantId);
  if (id.supportAccess) {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      user: user
        ? { ...publicUser(user as unknown as PbUser), tenantId: id.tenantId }
        : { id: id.userId, email: id.supportAccess.adminEmail, name: '灵枢技术支持', tenantId: id.tenantId, role: 'super_admin' },
      tenant: publicTenant(tenant || {
        id: id.tenantId,
        name: id.supportAccess.tenantName,
        subscriptionStatus: subscription.status,
        subscriptionPlan: subscription.plan,
        subscriptionExpiresAt: subscription.expiresAt,
      }),
      subscription,
      supportAccess: id.supportAccess,
    });
    return;
  }
  if (subscription?.expiresAt && isExpired(subscription.expiresAt)) {
    await rotateExpiredTrialPassword(user as unknown as PbUser | null, 'session_trial_expired');
    res.status(402).json({ error: '试用账号已到期，请重新登录或联系服务顾问开通。' });
    return;
  }
  const demo = await buildDemoStatus(req, id.tenantId, subscription.expiresAt, id.userId);
  const userEmail = String(user?.email ?? '').trim().toLowerCase();
  const guide = accountGuideState(
    userEmail,
    subscription.expiresAt ? `${id.userId}:${subscription.expiresAt}` : id.userId,
  );
  res.json({
    user: user ? publicUser(user as unknown as PbUser) : { id: id.userId, email: '', name: '', tenantId: id.tenantId },
    tenant: publicTenant(tenant),
    subscription,
    platformAdmin: Boolean(await requireAdminUser(req)),
    demo: {
      ...demo,
      guideTrigger: guide.pending,
      guideScope: guide.scope,
    },
  });
});

authRouter.post('/change-password', async (req, res) => {
  const identity = await auth.verifyToken(req.headers.authorization);
  if (!identity || identity.supportAccess) { res.status(401).json({ error: '登录已失效，请重新登录' }); return; }
  const { currentPassword, newPassword, passwordConfirm } = req.body ?? {};
  if (!currentPassword || !newPassword || !passwordConfirm) { res.status(400).json({ error: '请完整填写当前密码和新密码' }); return; }
  if (String(newPassword).length < 8) { res.status(400).json({ error: '新密码至少需要 8 位' }); return; }
  if (newPassword !== passwordConfirm) { res.status(400).json({ error: '两次输入的新密码不一致' }); return; }
  if (currentPassword === newPassword) { res.status(400).json({ error: '新密码不能与当前密码相同' }); return; }

  const local = parseLocalToken(req.headers.authorization);
  if (local) {
    let account: LocalAccount;
    try {
      const accounts = readLocalAccounts();
      const index = accounts.findIndex(item => item.userId === local.userId && item.tenantId === local.tenantId);
      if (index < 0 || !localPasswordMatches(accounts[index], String(currentPassword))) { res.status(400).json({ error: '当前密码不正确' }); return; }
      const salt = randomBytes(16).toString('hex');
      accounts[index] = { ...accounts[index], salt, passwordHash: passwordHash(String(newPassword), salt).toString('hex') };
      writeLocalAccounts(accounts);
      account = accounts[index];
    } catch (error) {
      if (isLocalAccountStoreError(error)) { localStoreUnavailable(res); return; }
      throw error;
    }
    syncPasswordChangeCredentialStateBestEffort(account.email, {
      branch: 'local',
      tenantId: local.tenantId,
      userId: local.userId,
    });
    res.json({ ok: true });
    return;
  }

  const user = await pbGet('users', identity.userId) as unknown as PbUser | null;
  if (!user?.email) { res.status(404).json({ error: '未找到当前账号' }); return; }
  const verified = await pbLogin(user.email, String(currentPassword));
  if (!verified || verified.record.id !== identity.userId) { res.status(400).json({ error: '当前密码不正确' }); return; }
  const updated = await pbPatch('users', identity.userId, { password: String(newPassword), passwordConfirm: String(passwordConfirm) });
  if (!updated) { res.status(500).json({ error: '密码更新失败，请稍后重试' }); return; }
  syncPasswordChangeCredentialStateBestEffort(user.email, {
    branch: 'provider',
    tenantId: identity.tenantId,
    userId: identity.userId,
  });
  res.json({ ok: true });
});

export async function listTenantEmployees(authorization: string | undefined) {
  const identity = await auth.verifyToken(authorization);
  if (!identity || identity.supportAccess) throw new Error('登录已失效，请重新登录');
  const local = parseLocalToken(authorization);
  if (local) {
    const employees = readLocalAccounts().filter(account => account.tenantId === identity.tenantId).map(account => ({ id: account.userId, email: account.email, name: account.name, role: normalizedRole(account.role), isCurrent: account.userId === identity.userId, created: account.createdAt }));
    if (!employees.some(employee => employee.id === identity.userId)) employees.unshift({ id: identity.userId, email: local.email || '', name: local.name || local.email?.split('@')[0] || '企业管理员', role: normalizedRole(local.role), isCurrent: true, created: '' });
    return employees;
  }
  const result = await pbList<PbUser & Record<string, unknown>>('users', { filter: 'tenantId = ' + JSON.stringify(identity.tenantId), sort: 'created', perPage: 100 });
  return result.items.map(item => ({ id: item.id, email: item.email ?? '', name: item.name ?? '', role: normalizedRole(item.role), isCurrent: item.id === identity.userId, created: String(item.created ?? '') }));
}

authRouter.get('/employees', async (req, res) => {
  try { res.json({ employees: await listTenantEmployees(req.headers.authorization) }); }
  catch (error) {
    if (isLocalAccountStoreError(error)) { localStoreUnavailable(res); return; }
    res.status(401).json({ error: '登录已失效，请重新登录' });
  }
});

authRouter.post('/employees', async (req, res) => {
  const identity = await auth.verifyToken(req.headers.authorization);
  if (!identity || identity.supportAccess) { res.status(401).json({ error: '登录已失效，请重新登录' }); return; }
  if (await requestOrganizationRoleStrict(req.headers.authorization, identity.userId) !== 'super_admin') { res.status(403).json({ error: '只有超级管理员可以添加成员' }); return; }
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const name = String(req.body?.name ?? '').trim();
  const password = String(req.body?.password ?? '');
  const role = organizationRoleOrNull(req.body?.role);
  if (!role) { res.status(400).json({ error: '无效的员工角色' }); return; }
  if (role === 'super_admin') { res.status(403).json({ error: '不能添加第二个超级管理员' }); return; }
  if (!email || !email.includes('@')) { res.status(400).json({ error: '请输入有效的员工邮箱' }); return; }
  if (password.length < 8) { res.status(400).json({ error: '初始密码至少需要 8 位' }); return; }
  try {
    await assertStarter198MemberCapacity({
      tenantId: identity.tenantId,
      countMembers: async () => (await listTenantEmployees(req.headers.authorization)).length,
    });
  } catch (error) {
    if (error instanceof Starter198MemberQuotaError) { res.status(error.status).json({ error: error.code }); return; }
    throw error;
  }
  if (parseLocalToken(req.headers.authorization)) {
    try {
      const accounts = readLocalAccounts();
      if (accounts.some(account => account.email === email)) { res.status(400).json({ error: '该邮箱已被使用' }); return; }
      const salt = randomBytes(16).toString('hex');
      const employee: LocalAccount = { userId: `local_user_${localId(email)}`, tenantId: identity.tenantId, email, name: name || email.split('@')[0], role, accountType: 'customer', salt, passwordHash: passwordHash(password, salt).toString('hex'), createdAt: new Date().toISOString() };
      accounts.push(employee); writeLocalAccounts(accounts);
      res.status(201).json({ employee: { id: employee.userId, email, name: employee.name, role, isCurrent: false, created: employee.createdAt } }); return;
    } catch (error) {
      if (isLocalAccountStoreError(error)) { localStoreUnavailable(res); return; }
      throw error;
    }
  }
  const created = await pbCreate('users', { email, name, password, passwordConfirm: password, tenantId: identity.tenantId, role, emailVisibility: true });
  if (!created) { res.status(400).json({ error: '员工添加失败，邮箱可能已被使用' }); return; }
  res.status(201).json({ employee: { id: created.id, email, name, role, isCurrent: false, created: created.created ?? '' } });
});

authRouter.patch('/employees/:employeeId/role', async (req, res) => {
  const identity = await auth.verifyToken(req.headers.authorization);
  if (!identity || identity.supportAccess) { res.status(401).json({ error: '登录已失效，请重新登录' }); return; }
  if (await requestOrganizationRoleStrict(req.headers.authorization, identity.userId) !== 'super_admin') { res.status(403).json({ error: '只有超级管理员可以调整角色' }); return; }
  if (req.params.employeeId === identity.userId) { res.status(400).json({ error: '不能修改当前超级管理员的角色' }); return; }
  const role = organizationRoleOrNull(req.body?.role);
  if (!role) { res.status(400).json({ error: '无效的员工角色' }); return; }
  if (role === 'super_admin') { res.status(403).json({ error: '不能分配超级管理员角色' }); return; }
  if (parseLocalToken(req.headers.authorization)) {
    try {
      const accounts = readLocalAccounts();
      const target = accounts.find(account => account.userId === req.params.employeeId && account.tenantId === identity.tenantId);
      if (!target) { res.status(404).json({ error: '未找到该员工' }); return; }
      target.role = role; writeLocalAccounts(accounts); res.json({ ok: true, role }); return;
    } catch (error) {
      if (isLocalAccountStoreError(error)) { localStoreUnavailable(res); return; }
      throw error;
    }
  }
  const employee = await pbGet('users', req.params.employeeId);
  if (!employee || employee.tenantId !== identity.tenantId) { res.status(404).json({ error: '未找到该员工' }); return; }
  if (!await pbPatch('users', req.params.employeeId, { role })) { res.status(500).json({ error: '角色更新失败' }); return; }
  res.json({ ok: true, role });
});

authRouter.delete('/employees/:employeeId', async (req, res) => {
  const identity = await auth.verifyToken(req.headers.authorization);
  if (!identity || identity.supportAccess) { res.status(401).json({ error: '登录已失效，请重新登录' }); return; }
  if (await requestOrganizationRoleStrict(req.headers.authorization, identity.userId) !== 'super_admin') { res.status(403).json({ error: '只有超级管理员可以移除成员' }); return; }
  if (req.params.employeeId === identity.userId) { res.status(400).json({ error: '不能删除当前登录账号' }); return; }
  if (parseLocalToken(req.headers.authorization)) {
    try {
      const accounts = readLocalAccounts();
      const target = accounts.find(account => account.userId === req.params.employeeId && account.tenantId === identity.tenantId);
      if (!target) { res.status(404).json({ error: '未找到该员工' }); return; }
      writeLocalAccounts(accounts.filter(account => account !== target)); res.json({ ok: true }); return;
    } catch (error) {
      if (isLocalAccountStoreError(error)) { localStoreUnavailable(res); return; }
      throw error;
    }
  }
  const employee = await pbGet('users', req.params.employeeId);
  if (!employee || employee.tenantId !== identity.tenantId) { res.status(404).json({ error: '未找到该员工' }); return; }
  if (!await pbDelete('users', req.params.employeeId)) { res.status(500).json({ error: '删除员工失败' }); return; }
  res.json({ ok: true });
});

authRouter.post('/guide-seen', async (req, res) => {
  const id = await auth.verifyToken(req.headers.authorization);
  if (!id) { res.status(401).json({ error: 'Unauthorized' }); return; }
  if (id.supportAccess) { res.status(403).json({ error: 'support_access_read_only' }); return; }
  const local = parseLocalToken(req.headers.authorization);
  const user = local ? null : await pbGet('users', id.userId);
  const email = String(local?.email ?? user?.email ?? '').trim().toLowerCase();
  if (email) consumeDemoGuide(email);
  res.json({ ok: true });
});
