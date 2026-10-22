import type { Router } from 'express';
import { writeAuditLog } from '../lib/auditLog.js';
import { pbListStrict, pbPatch } from '../storage/pb.js';
import { demoLimits } from '../lib/demo.js';
import { demoCredentialPresentation, demoUsageForTenant, readDemoAccountRegistry, requireAdminUser, upsertDemoAccountRegistry, type DemoCredentialState } from '../lib/demoAccounts.js';
import { createSupportAccessRequest, issueSupportAccessToken, supportAccessDefaultAuthorized } from '../lib/supportAccess.js';
import { getLocalTenant, listLocalTenants, promoteLocalTrialTenant } from '../lib/localTenants.js';
import { localFallbacksEnabled } from '../lib/localFallbackPolicy.js';
import { accountStage, trialDay } from './adminAccountPresentation.js';
import { localAccountId, safePbGet, bodyText } from './adminAlertSupport.js';

export function registerAdminAccountRoutes(router: Router): void {
router.get('/demo-accounts', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  const limits = demoLimits();
  const registry = readDemoAccountRegistry();
  const trialAccounts = await Promise.all(Object.values(registry)
    .sort((a, b) => a.email.localeCompare(b.email))
    .filter(entry => entry.status !== 'admin' && entry.status !== 'customer')
    .map(async entry => {
      const tenant = await safePbGet('tenants', entry.tenantId);
      const expiresAt = String(tenant?.subscriptionExpiresAt ?? entry.expiresAt ?? '') || null;
      const activatedAt = entry.activatedAt ?? null;
      const usage = demoUsageForTenant(entry.tenantId, entry.userId ? [entry.userId] : []);
      const day = trialDay(activatedAt);
      return {
        email: entry.email,
        tenantId: String(entry.tenantId || ''),
        tenantName: String(tenant?.name || entry.email.split('@')[0] || entry.tenantId || ''),
        ...demoCredentialPresentation(entry.credentialState),
        status: accountStage({ ...entry, expiresAt }),
        activatedAt,
        expiresAt,
        trialDay: day,
        trialDays: entry.status === 'admin' ? null : limits.trialDays,
        daysRemaining: expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (24 * 3600 * 1000))) : null,
        tokenUsedToday: usage.todayTokens,
        tokenUsedTotal: usage.totalTokens,
        tokenLimit: entry.status === 'admin' ? null : limits.tokenTotal,
        aiChatToday: usage.aiChat,
        generationToday: usage.generation,
        renderToday: usage.render,
        videoGenerationToday: usage.videoGeneration,
        rotatedAt: entry.rotatedAt ?? null,
      };
    }));
  let customerAccounts: Array<{
    tenantId: string;
    companyName: string;
    contactName: string;
    industry: string;
    emails: string[];
    credentialState: DemoCredentialState; credentialAction: string;
    inviteCode: string;
    subscriptionPlan: string;
    subscriptionStatus: string;
    createdAt: string | null;
    registeredAt: string | null;
    expiresAt: string | null;
    tokenUsedToday: number;
    tokenUsedTotal: number;
    aiChatToday: number;
    generationToday: number;
    renderToday: number;
    videoGenerationToday: number;
  }> = [];
  try {
    const [tenants, users] = await Promise.all([
      pbListStrict<Record<string, unknown>>('tenants', { perPage: 500, sort: '-createdAt' }),
      pbListStrict<Record<string, unknown>>('users', { perPage: 500, sort: 'email' }),
    ]);
    const trialTenantIds = new Set(trialAccounts.map(account => String(registry[account.email]?.tenantId || '')).filter(Boolean));
    customerAccounts = tenants.items
      .map(tenant => {
        const tenantId = String(tenant.id || tenant.tenantId || '');
        const subscriptionPlan = String(tenant.subscriptionPlan || '未设置');
        const subscriptionStatus = String(tenant.subscriptionStatus || '未设置');
        const registeredEmail = String(tenant.registeredEmail || '').trim().toLowerCase();
        const tenantUsers = users.items.filter(user => String(user.tenantId || '') === tenantId);
        const emails = tenantUsers
          .map(user => String(user.email || '').trim().toLowerCase())
          .filter(Boolean);
        if (registeredEmail) emails.unshift(registeredEmail);
        const promotedTrial = Object.values(registry).find(entry => entry.tenantId === tenantId && entry.status === 'customer');
        const usage = demoUsageForTenant(
          tenantId,
          Array.from(new Set([
            ...tenantUsers.map(user => String(user.id || '')).filter(Boolean),
            ...(promotedTrial?.userId ? [promotedTrial.userId] : []),
          ])),
        );
        return {
          tenantId,
          companyName: String(tenant.name || tenant.companyName || tenant.company || tenantId),
          contactName: String(tenant.contactName || tenant.contact || ''),
          industry: String(tenant.industry || ''),
          emails: Array.from(new Set(emails)),
          ...demoCredentialPresentation(promotedTrial?.credentialState
            ?? (emails.length ? 'active_hash_only' : 'password_reset_required')),
          inviteCode: String(tenant.registrationInviteCode || tenant.inviteCode || ''),
          subscriptionPlan,
          subscriptionStatus,
          createdAt: String(tenant.created || tenant.createdAt || '') || null,
          registeredAt: String(tenant.registeredAt || '') || null,
          expiresAt: String(tenant.subscriptionExpiresAt || '') || null,
          tokenUsedToday: usage.todayTokens,
          tokenUsedTotal: usage.totalTokens,
          aiChatToday: usage.aiChat,
          generationToday: usage.generation,
          renderToday: usage.render,
          videoGenerationToday: usage.videoGeneration,
        };
      })
      .filter(account => account.tenantId && !trialTenantIds.has(account.tenantId))
      .filter(account => !['trial', 'local', 'admin'].includes(account.subscriptionPlan.toLowerCase()))
      .sort((a, b) => a.companyName.localeCompare(b.companyName));
  } catch (error) {
    console.warn('[admin] customer account list unavailable:', error instanceof Error ? error.message : error);
  }
  const localCustomerAccounts = listLocalTenants()
    .filter(tenant => tenant.subscriptionStatus === 'active' && tenant.subscriptionPlan === 'customer')
    .map(tenant => {
      const emails = tenant.registeredEmail ? [tenant.registeredEmail] : [];
      const promotedTrial = Object.values(registry).find(entry => entry.tenantId === tenant.id && entry.status === 'customer');
      const userIds = Array.from(new Set([
        ...emails.map(email => `local_user_customer_${localAccountId(email)}`),
        ...(promotedTrial?.userId ? [promotedTrial.userId] : []),
      ]));
      const usage = demoUsageForTenant(tenant.id, userIds);
      return {
        tenantId: tenant.id,
        companyName: tenant.companyName || tenant.name,
        contactName: tenant.contactName,
        industry: tenant.industry,
        emails,
        ...demoCredentialPresentation(promotedTrial?.credentialState
          ?? (emails.length ? 'active_hash_only' : 'password_reset_required')),
        inviteCode: tenant.registrationInviteCode || tenant.inviteCode,
        subscriptionPlan: tenant.subscriptionPlan,
        subscriptionStatus: tenant.subscriptionStatus,
        createdAt: tenant.createdAt || null,
        registeredAt: tenant.registeredAt || null,
        expiresAt: tenant.subscriptionExpiresAt,
        tokenUsedToday: usage.todayTokens,
        tokenUsedTotal: usage.totalTokens,
        aiChatToday: usage.aiChat,
        generationToday: usage.generation,
        renderToday: usage.render,
        videoGenerationToday: usage.videoGeneration,
      };
    });
  const existingCustomerIds = new Set(customerAccounts.map(account => account.tenantId));
  const existingCustomerEmails = new Set(customerAccounts.flatMap(account => account.emails).map(email => email.toLowerCase()));
  customerAccounts.push(...localCustomerAccounts.filter(account =>
    !existingCustomerIds.has(account.tenantId)
    && !account.emails.some(email => existingCustomerEmails.has(email.toLowerCase()))
  ));
  customerAccounts.sort((a, b) => a.companyName.localeCompare(b.companyName));

  res.json({ admin: admin.email, trialAccounts, customerAccounts });
});

router.post('/trial-accounts/:tenantId/promote', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }

  const tenantId = bodyText(req.params.tenantId);
  const registry = readDemoAccountRegistry();
  const entry = Object.values(registry).find(item => item.tenantId === tenantId);
  if (!tenantId || !entry || entry.status === 'admin') {
    res.status(404).json({ error: 'trial_account_not_found' });
    return;
  }

  const existingTenant = await safePbGet('tenants', tenantId);
  const companyName = bodyText(req.body?.companyName)
    || bodyText(existingTenant?.name || existingTenant?.companyName)
    || entry.email.split('@')[0]
    || tenantId;
  const contactName = bodyText(req.body?.contactName || existingTenant?.contactName || existingTenant?.contact);
  const industry = bodyText(req.body?.industry || existingTenant?.industry);
  const registeredAt = bodyText(existingTenant?.registeredAt || entry.activatedAt) || new Date().toISOString();
  const requiresPasswordReset = entry.credentialState === 'expired_locked'
    || entry.credentialState === 'password_reset_required'
    || tenantId.startsWith('local_tenant_trial_');
  const patch = {
    name: companyName,
    companyName,
    contactName,
    contact: contactName,
    industry,
    registeredEmail: entry.email,
    registeredAt,
    subscriptionStatus: 'active',
    subscriptionPlan: 'customer',
    subscriptionExpiresAt: null,
  };

  let tenant: Record<string, any> | null = null;
  if (existingTenant) {
    const updated = await pbPatch('tenants', tenantId, patch);
    if (updated) tenant = { ...existingTenant, ...patch };
  }
  if (!tenant && localFallbacksEnabled()) {
    tenant = promoteLocalTrialTenant({
      tenantId,
      companyName,
      contactName,
      industry,
      email: entry.email,
      registeredAt,
    }) as unknown as Record<string, any>;
  }
  if (!tenant) {
    res.status(500).json({ error: 'trial_promotion_failed' });
    return;
  }

  upsertDemoAccountRegistry(entry.email, {
    status: 'customer',
    tenantId,
    userId: entry.userId,
    credentialState: requiresPasswordReset ? 'password_reset_required' : 'active_hash_only',
    expiresAt: null,
    rotatedAt: null,
  });
  await writeAuditLog({
    tenantId,
    actorUserId: admin.userId,
    action: 'trial_account_promoted',
    targetType: 'tenant',
    targetId: tenantId,
    metadata: { email: entry.email, companyName, source: 'trial_account' },
  });
  res.json({
    ok: true,
    tenantId,
    email: entry.email,
    companyName,
    credentialState: requiresPasswordReset ? 'password_reset_required' : 'active_hash_only',
    message: `试用账号已转为正式客户，原客户空间和历史数据保持不变。${requiresPasswordReset ? '请通过受控渠道完成一次性密码重置后再登录。' : ''}`,
  });
});

router.post('/support-access/session', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  const tenantId = bodyText(req.body?.tenantId);
  if (!tenantId || tenantId === admin.tenantId) {
    res.status(400).json({ error: 'invalid_tenant' });
    return;
  }
  if (!supportAccessDefaultAuthorized(tenantId)) {
    res.status(403).json({ error: 'support_access_disabled' });
    return;
  }

  const registryEntry = Object.values(readDemoAccountRegistry()).find(entry => entry.tenantId === tenantId);
  const localTenant = localFallbacksEnabled() ? getLocalTenant(tenantId) : null;
  const remoteTenant = await safePbGet('tenants', tenantId);
  if (!registryEntry && !localTenant && !remoteTenant) {
    res.status(404).json({ error: 'tenant_not_found' });
    return;
  }

  const tenantName = bodyText(remoteTenant?.name)
    || localTenant?.companyName
    || localTenant?.name
    || bodyText(req.body?.tenantName)
    || registryEntry?.email?.split('@')[0]
    || tenantId;
  const request = createSupportAccessRequest({
    tenantId,
    tenantName,
    requestedByUserId: admin.userId,
    requestedByEmail: admin.email,
  });
  const session = issueSupportAccessToken(request.id, admin.userId);
  if (!session) {
    res.status(403).json({ error: 'support_access_disabled' });
    return;
  }
  await writeAuditLog({
    tenantId,
    actorUserId: admin.userId,
    actorEmail: admin.email,
    action: 'support_session_started',
    targetType: 'tenant',
    targetId: tenantId,
    metadata: { requestId: request.id, tenantName },
  });
  res.json(session);
});
}
