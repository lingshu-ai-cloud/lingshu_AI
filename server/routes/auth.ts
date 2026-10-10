import { Router } from 'express';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import {
  createPbRequestSignal,
  getPbUrl,
  getPbAdminToken,
  invalidatePbIdentityCache,
  pbCreate,
  pbDelete,
  pbGet,
  pbGetStrict,
  pbList,
  pbPatch,
} from '../storage/pb.js';
import { auth } from '../storage/index.js';
import { getTenantSubscription } from '../middleware/subscription.js';
import { buildDemoStatus, isExpired } from '../lib/demo.js';
import {
  accountGuideState,
  activateTrialAccount,
  adminUserForHttp,
  consumeDemoGuide,
  isAdminEmail,
  isTrialAccount,
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
  ensureLocalIdentityTenant,
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
import { isBrowserReadToken } from '../digitalEmployees/browserReadSession.js';
import { isLocalAccountStoreError, localAccountRecordsFile, readLocalAccountRecords, writeLocalAccountRecords, type LocalStoredAccount } from '../lib/localAccountStore.js';
import { assertStarter198MemberCapacity, Starter198MemberQuotaError } from '../starter198/memberQuota.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { localFallbacksEnabled } from '../lib/localFallbackPolicy.js';
import {
  pocketBaseTenantByInvite,
  publicInviteRegistrationError,
  registerPocketBaseInviteOwner,
} from '../auth/inviteRegistration.js';
import { issueVerifiedLocalIdentityToken, verifyLocalIdentity, type VerifiedLocalIdentity } from '../auth/localIdentity.js';
import { bindDataAuthority, currentDataAuthority } from '../storage/dataAuthority.js';

export const authRouter = Router();
interface PbUser { id: string; email?: string; name?: string; tenantId?: string; role?: OrganizationRole }
type LocalAccount = LocalStoredAccount;
interface LocalLoginResult {
  token: string;
  record: PbUser;
  accountType: 'customer' | 'trial' | 'admin';
  expiresAt?: string | null;
}

const LOCAL_PREVIEW_ORIGINS = new Set([
  'http://127.0.0.1:5177',
  'http://localhost:5177',
  'http://[::1]:5177',
]);

export function isLocalPreviewLoopbackAddress(address: string | undefined): boolean {
  const normalized = String(address || '').trim().toLowerCase();
  return normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '::ffff:127.0.0.1';
}

export function localPreviewRequestRejection(
  origin: string | undefined,
  remoteAddress: string | undefined,
): 'local_preview_origin_required' | 'local_preview_loopback_required' | null {
  if (!LOCAL_PREVIEW_ORIGINS.has(String(origin || ''))) return 'local_preview_origin_required';
  if (!isLocalPreviewLoopbackAddress(remoteAddress)) return 'local_preview_loopback_required';
  return null;
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
  return readLocalAccountRecords(localAccountRecordsFile());
}

function writeLocalAccounts(accounts: LocalAccount[]): void {
  writeLocalAccountRecords(localAccountRecordsFile(), accounts);
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

function parseLocalToken(authHeader: string | undefined): VerifiedLocalIdentity | null {
  return verifyLocalIdentity(authHeader);
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
      signal: createPbRequestSignal(),
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
      signal: createPbRequestSignal(),
    });
    if (!res.ok) return null;
    return (await res.json()) as { token: string; record: PbUser };
  } catch {
    return null;
  }
}

function localLogin(email: string, password: string): LocalLoginResult | null {
  if (!localFallbacksEnabled()) return null;
  const normalizedEmail = String(email).trim().toLowerCase();
  const account = readLocalAccounts().find(item => item.email === normalizedEmail);
  if (account?.accountType === 'customer') {
    if (!localPasswordMatches(account, password)) return null;
    if (!getLocalTenant(account.tenantId)) return null;
    clearLocalTenantRegisteredCredential(account.tenantId, account.email);
    const record: PbUser = {
      id: account.userId,
      email: account.email,
      name: account.name,
      tenantId: account.tenantId,
      role: normalizedRole(account.role),
    };
    return { token: issueVerifiedLocalIdentityToken({ userId: record.id, tenantId: record.tenantId! }), record, accountType: 'customer' };
  }

  const configuredAdminEmail = String(process.env.LOCAL_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const configuredAdminPassword = process.env.LOCAL_ADMIN_PASSWORD;
  const explicitAdmin = Boolean(
    configuredAdminEmail &&
    configuredAdminPassword &&
    normalizedEmail === configuredAdminEmail &&
    password === configuredAdminPassword
  );

  const allowedEmails = String(process.env.LOCAL_AUTH_EMAILS ?? '')
    .split(/[\s,;]+/)
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  const configuredPassword = process.env.LOCAL_AUTH_PASSWORD;
  const sharedCredential = Boolean(configuredPassword && allowedEmails.includes(normalizedEmail) && password === configuredPassword);
  if (!explicitAdmin && !sharedCredential) return null;
  const accountType = explicitAdmin || isAdminEmail(normalizedEmail) ? 'admin' : 'trial';
  const role: OrganizationRole = accountType === 'admin' ? 'super_admin' : 'customer_service';
  const record: PbUser = {
    id: `local_user_${accountType}_${localId(normalizedEmail)}`,
    email: normalizedEmail,
    name: normalizedEmail.split('@')[0],
    tenantId: `local_tenant_${accountType}_${localId(normalizedEmail)}`,
    role,
  };
  const expiresAt = accountType === 'trial' ? trialExpiresAt() : null;
  ensureLocalIdentityTenant({
    tenantId: record.tenantId!,
    name: record.name!,
    accountType,
    email: normalizedEmail,
    expiresAt,
  });
  const accounts = readLocalAccounts();
  const existingIndex = accounts.findIndex(item => item.userId === record.id && item.tenantId === record.tenantId);
  const salt = randomBytes(16).toString('hex');
  const stored: LocalAccount = {
    userId: record.id,
    tenantId: record.tenantId!,
    email: normalizedEmail,
    name: record.name!,
    accountType,
    role,
    salt,
    passwordHash: passwordHash(password, salt).toString('hex'),
    createdAt: existingIndex >= 0 ? accounts[existingIndex].createdAt : new Date().toISOString(),
  };
  if (existingIndex >= 0) accounts[existingIndex] = stored;
  else accounts.push(stored);
  writeLocalAccounts(accounts);
  if (accountType === 'trial') {
    upsertDemoAccountRegistry(normalizedEmail, {
      userId: record.id,
      tenantId: record.tenantId,
      activatedAt: new Date().toISOString(),
      expiresAt,
      status: 'trialing',
      credentialState: 'external_secret',
    });
  }
  return { token: issueVerifiedLocalIdentityToken({ userId: record.id, tenantId: record.tenantId! }), record, accountType, expiresAt };
}

function localPreviewIdentity(): LocalAccount {
  const email = String(process.env.LINGSHU_PREVIEW_AUTH_EMAIL || '').trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@local\.test$/.test(email)) {
    throw new Error('local_preview_identity_not_configured');
  }
  const accounts = readLocalAccounts();
  const existing = accounts.find(account => account.email === email);
  if (existing) {
    if (!getLocalTenant(existing.tenantId)) throw new Error('local_preview_tenant_missing');
    return existing;
  }

  const suffix = localId(email);
  const tenantId = `local_tenant_preview_${suffix}`;
  const userId = `local_user_preview_${suffix}`;
  const name = '灵枢本地预览';
  ensureLocalIdentityTenant({ tenantId, name, accountType: 'customer', email });
  const salt = randomBytes(16).toString('hex');
  const account: LocalAccount = {
    userId,
    tenantId,
    email,
    name,
    accountType: 'customer',
    role: 'admin',
    salt,
    // No usable preview password is generated or exposed. This opaque random
    // verifier only satisfies the fail-closed local account record schema.
    passwordHash: passwordHash(randomBytes(48).toString('base64url'), salt).toString('hex'),
    createdAt: new Date().toISOString(),
  };
  accounts.push(account);
  writeLocalAccounts(accounts);
  return account;
}

function localRegister(email: string, password: string, tenant: LocalTenantRecord):
  | { ok: true; token: string; record: PbUser }
  | { ok: false; error: string }
  | null {
  if (!localFallbacksEnabled()) return null;
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
  return { ok: true, token: issueVerifiedLocalIdentityToken({ userId: record.id, tenantId: record.tenantId! }), record };
}

function deleteLocalRegisteredAccount(userId: string): boolean {
  const accounts = readLocalAccounts();
  const next = accounts.filter(account => account.userId !== userId);
  if (next.length === accounts.length) return true;
  writeLocalAccounts(next);
  return true;
}

function publicUser(r: PbUser) {
  return { id: r.id, email: r.email ?? '', name: r.name ?? '', tenantId: r.tenantId ?? '', role: normalizedRole(r.role) };
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
  let invitedTenant: Record<string, unknown> | LocalTenantRecord | null;
  let authority: 'pocketbase' | 'local';
  try {
    invitedTenant = await pocketBaseTenantByInvite(code);
    authority = 'pocketbase';
    bindDataAuthority(authority);
  } catch {
    if (!localFallbacksEnabled()) {
      res.status(503).json({ valid: false, error: 'invite_lookup_unavailable' });
      return;
    }
    authority = 'local';
    bindDataAuthority(authority);
    invitedTenant = findLocalTenantByInvite(code);
  }
  if (invitedTenant) {
    res.json({
      valid: true,
      companyName: String(invitedTenant.companyName || invitedTenant.name || ''),
    });
    return;
  }
  let usedTenant: Record<string, unknown> | LocalTenantRecord | null;
  try {
    usedTenant = authority === 'local'
      ? findLocalTenantByRegistrationInvite(code)
      : await pocketBaseTenantByInvite(code, true);
  } catch {
    res.status(503).json({ valid: false, error: 'invite_lookup_unavailable' });
    return;
  }
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

  let invitedTenant: Record<string, unknown> | LocalTenantRecord | null;
  let authority: 'pocketbase' | 'local';
  try {
    invitedTenant = await pocketBaseTenantByInvite(code);
    authority = 'pocketbase';
    bindDataAuthority(authority);
  } catch {
    if (!localFallbacksEnabled()) {
      res.status(503).json({ error: 'invite_lookup_unavailable' });
      return;
    }
    authority = 'local';
    bindDataAuthority(authority);
    invitedTenant = findLocalTenantByInvite(code);
  }
  if (!invitedTenant) {
    res.status(403).json({ error: '邀请码无效或已使用，请联系管理员重新生成' });
    return;
  }

  if (authority === 'local') {
    let fallback: ReturnType<typeof localRegister>;
    try {
      fallback = localRegister(String(email), String(password), invitedTenant as LocalTenantRecord);
    } catch (error) {
      if (isLocalAccountStoreError(error)) { localStoreUnavailable(res); return; }
      throw error;
    }
    if (fallback?.ok) {
      let tenant: LocalTenantRecord | null = null;
      try {
        tenant = activateLocalTenantInvite({
          inviteCode: code,
          email: String(email),
        });
      } catch {
        try { deleteLocalRegisteredAccount(String(fallback.record.id)); } catch { /* report uncertain rollback below */ }
        res.status(503).json({ error: 'local_invite_activation_unavailable' });
        return;
      }
      if (!tenant) {
        try { deleteLocalRegisteredAccount(String(fallback.record.id)); } catch { /* fail closed below */ }
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

  try {
    const registration = await registerPocketBaseInviteOwner({
      invitedTenant: invitedTenant as Record<string, unknown> & { id: string },
      inviteCode: code,
      email: String(email),
      password: String(password),
      readInvitedTenant: async () => {
        const current = await pocketBaseTenantByInvite(code);
        return current?.id ? current as Record<string, unknown> & { id: string } : null;
      },
      loginOwner: () => pbLogin(String(email), String(password)),
    });
    res.json({
      token: registration.login.token,
      user: publicUser(registration.login.record),
      tenant: publicTenant(registration.tenant),
    });
  } catch (error) {
    const failure = publicInviteRegistrationError(error);
    res.status(failure.status).json(failure.body);
  }
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
    bindDataAuthority('local');
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
  bindDataAuthority('pocketbase');
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

// The supervised loopback preview must not depend on a developer knowing a
// local account password. Production, ordinary dev servers, and non-loopback
// browser origins cannot reach this token issuer.
authRouter.post('/local-preview-session', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (
    process.env.NODE_ENV === 'production'
    || process.env.LINGSHU_LOCAL_PREVIEW !== '1'
    || !localFallbacksEnabled()
  ) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const requestRejection = localPreviewRequestRejection(req.headers.origin, req.socket.remoteAddress);
  if (requestRejection) {
    res.status(403).json({ error: requestRejection });
    return;
  }
  try {
    const account = localPreviewIdentity();
    bindDataAuthority('local');
    res.json({ token: issueVerifiedLocalIdentityToken(account) });
  } catch (error) {
    if (isLocalAccountStoreError(error)) { localStoreUnavailable(res); return; }
    console.error('[auth/local-preview-session] local preview identity unavailable', {
      errorType: error instanceof Error ? error.message : 'UnknownError',
    });
    res.status(503).json({ error: 'local_preview_auth_unavailable' });
  }
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
  const id = res.locals as AuthLocals;
  try {
    if (isBrowserReadToken(req.headers.authorization)) {
      const tenant = id.dataAuthority === 'local'
        ? getLocalTenant(id.tenantId)
        : await pbGetStrict('tenants', id.tenantId);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ user: { id: id.userId, email: '', name: 'Agent 生产会话', tenantId: id.tenantId, role: id.browserReadRole }, tenant: publicTenant(tenant as Record<string, unknown> | null) });
      return;
    }
    const local = (id.dataAuthority ?? currentDataAuthority()) === 'local'
      ? parseLocalToken(req.headers.authorization)
      : null;
    if (local) {
      const name = local.name || local.email?.split('@')[0] || '本地账号';
      const subscription = await getTenantSubscription(id.tenantId);
      if (subscription.expiresAt && isExpired(subscription.expiresAt)) {
        res.status(402).json({ error: '试用账号已到期，请联系管理员获取其他备用账号。' });
        return;
      }
      const localGuide = accountGuideState(
        local.email || '',
        subscription.expiresAt ? `${id.userId}:${subscription.expiresAt}` : id.userId,
      );
      const demoStatus = subscription.status === 'trialing' || subscription.plan === 'trial' || localGuide.pending
        ? await buildDemoStatus(req, id.tenantId, subscription.expiresAt, id.userId)
        : undefined;
      const demo = demoStatus ? {
        ...demoStatus,
        guideTrigger: localGuide.pending,
        guideScope: localGuide.scope,
      } : undefined;
      const storedTenant = getLocalTenant(id.tenantId);
      const admin = await adminUserForHttp(req, res);
      if (admin === undefined) return;
      res.json({
        user: { id: id.userId, email: local.email || '', name, tenantId: id.tenantId, role: normalizedRole(local.role) },
        tenant: publicTenant({
          id: id.tenantId,
          name: storedTenant?.name || name,
          subscriptionStatus: subscription.status,
          subscriptionPlan: subscription.plan,
          subscriptionExpiresAt: subscription.expiresAt,
        }),
        subscription,
        demo,
        platformAdmin: Boolean(admin),
      });
      return;
    }
    const [user, tenant] = await Promise.all([
      pbGetStrict('users', id.userId),
      pbGetStrict('tenants', id.tenantId),
    ]);
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
    if (subscription.expiresAt && isExpired(subscription.expiresAt)) {
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
    const admin = await adminUserForHttp(req, res);
    if (admin === undefined) return;
    res.json({
      user: user ? publicUser(user as unknown as PbUser) : { id: id.userId, email: '', name: '', tenantId: id.tenantId },
      tenant: publicTenant(tenant),
      subscription,
      platformAdmin: Boolean(admin),
      demo: {
        ...demo,
        guideTrigger: guide.pending,
        guideScope: guide.scope,
      },
    });
  } catch (error) {
    console.error('[auth/me] authority unavailable', { errorType: error instanceof Error ? error.name : 'UnknownError' });
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).json({ error: 'auth_provider_unavailable', message: '账号数据暂时不可用，请稍后重试。' });
  }
});

authRouter.post('/change-password', async (req, res) => {
  const identity = res.locals as AuthLocals;
  if (identity.supportAccess) { res.status(401).json({ error: '登录已失效，请重新登录' }); return; }
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
  invalidatePbIdentityCache();
  syncPasswordChangeCredentialStateBestEffort(user.email, {
    branch: 'provider',
    tenantId: identity.tenantId,
    userId: identity.userId,
  });
  res.json({ ok: true });
});

export async function listTenantEmployees(identity: AuthLocals, authorization: string | undefined) {
  if (identity.supportAccess) throw new Error('登录已失效，请重新登录');
  const local = identity.dataAuthority === 'local' || currentDataAuthority() === 'local'
    ? parseLocalToken(authorization)
    : null;
  if (local) {
    const employees = readLocalAccounts().filter(account => account.tenantId === identity.tenantId).map(account => ({ id: account.userId, email: account.email, name: account.name, role: normalizedRole(account.role), isCurrent: account.userId === identity.userId, created: account.createdAt }));
    if (!employees.some(employee => employee.id === identity.userId)) employees.unshift({ id: identity.userId, email: local.email || '', name: local.name || local.email?.split('@')[0] || '企业管理员', role: normalizedRole(local.role), isCurrent: true, created: '' });
    return employees;
  }
  const result = await pbList<PbUser & Record<string, unknown>>('users', { filter: 'tenantId = ' + JSON.stringify(identity.tenantId), sort: 'created', perPage: 100 });
  return result.items.map(item => ({ id: item.id, email: item.email ?? '', name: item.name ?? '', role: normalizedRole(item.role), isCurrent: item.id === identity.userId, created: String(item.created ?? '') }));
}

authRouter.get('/employees', async (req, res) => {
  try { res.json({ employees: await listTenantEmployees(res.locals as AuthLocals, req.headers.authorization) }); }
  catch (error) {
    if (isLocalAccountStoreError(error)) { localStoreUnavailable(res); return; }
    res.status(401).json({ error: '登录已失效，请重新登录' });
  }
});

authRouter.post('/employees', async (req, res) => {
  const identity = res.locals as AuthLocals;
  if (identity.supportAccess) { res.status(401).json({ error: '登录已失效，请重新登录' }); return; }
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
      countMembers: async () => (await listTenantEmployees(identity, req.headers.authorization)).length,
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
  const identity = res.locals as AuthLocals;
  if (identity.supportAccess) { res.status(401).json({ error: '登录已失效，请重新登录' }); return; }
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
  invalidatePbIdentityCache();
  res.json({ ok: true, role });
});

authRouter.delete('/employees/:employeeId', async (req, res) => {
  const identity = res.locals as AuthLocals;
  if (identity.supportAccess) { res.status(401).json({ error: '登录已失效，请重新登录' }); return; }
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
  invalidatePbIdentityCache();
  res.json({ ok: true });
});

authRouter.post('/guide-seen', async (req, res) => {
  const id = res.locals as AuthLocals;
  if (id.supportAccess) { res.status(403).json({ error: 'support_access_read_only' }); return; }
  const local = parseLocalToken(req.headers.authorization);
  const user = local ? null : await pbGet('users', id.userId);
  const email = String(local?.email ?? user?.email ?? '').trim().toLowerCase();
  if (email) consumeDemoGuide(email);
  res.json({ ok: true });
});
