import { randomUUID } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import { acquireDurableOperationLease, releaseDurableOperationLease } from '../runtime/durableLease.js';
import { store } from '../storage/index.js';
import { pbCreateStrict, pbDeleteStrict, pbGetStrict, pbListStrict, pbPatchStrict } from '../storage/pb.js';

type Row = Record<string, unknown> & { id: string };

export type InviteActivationEvidence = 'activated' | 'not_activated' | 'unknown';

export function inviteTenantRegistrationEligible(tenant: Record<string, unknown> | null | undefined): boolean {
  const provisioningStatus = String(tenant?.subscriptionStatus || '').trim().toLowerCase();
  return provisioningStatus !== 'provisioning_pending' && provisioningStatus !== 'provisioning_failed';
}

export function classifyInviteActivationEvidence(input: {
  current: Record<string, unknown> | null;
  inviteCode: string;
  email: string;
}): InviteActivationEvidence {
  if (!input.current) return 'unknown';
  const activated = String(input.current.inviteCode || '') === ''
    && String(input.current.registrationInviteCode || '') === input.inviteCode
    && String(input.current.registeredEmail || '').trim().toLowerCase() === input.email.trim().toLowerCase()
    && Boolean(String(input.current.registeredAt || '').trim())
    && String(input.current.subscriptionStatus || '').trim().toLowerCase() === 'active'
    && String(input.current.subscriptionPlan || '').trim().toLowerCase() === 'customer';
  if (activated) return 'activated';
  const untouched = String(input.current.inviteCode || '') === input.inviteCode
    && !String(input.current.registrationInviteCode || '').trim()
    && !String(input.current.registeredEmail || '').trim()
    && !String(input.current.registeredAt || '').trim();
  return untouched ? 'not_activated' : 'unknown';
}

export class InviteRegistrationError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = 'InviteRegistrationError';
  }
}

function pbFilterValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export async function pocketBaseTenantByInvite(
  code: string,
  used = false,
): Promise<Record<string, unknown> | null> {
  const invite = String(code || '').trim();
  if (!invite) return null;
  try {
    const field = used ? 'registrationInviteCode' : 'inviteCode';
    const result = await pbListStrict<Record<string, unknown>>('tenants', {
      perPage: 2,
      filter: `${field} = ${pbFilterValue(invite)}`,
    });
    if (result.totalItems > 1 || result.items.length > 1) {
      throw new InviteRegistrationError('invite_record_integrity_violation', 503);
    }
    const tenant = result.items[0] ?? null;
    return inviteTenantRegistrationEligible(tenant) ? tenant : null;
  } catch (error) {
    if (error instanceof InviteRegistrationError) throw error;
    throw error;
  }
}

export async function consumeInviteRegistration<TLogin>(input: {
  dataStore: DataStore;
  tenantId: string;
  readInvitedTenant: () => Promise<Row | null>;
  createOwner: (tenant: Row) => Promise<Row | null>;
  readExistingOwner?: (tenant: Row) => Promise<Row | null>;
  acceptExistingOwner?: (owner: Row) => boolean;
  loginOwner: () => Promise<TLogin | null>;
  activateTenant: (tenant: Row) => Promise<boolean>;
  readActivationEvidence: (tenant: Row, owner: Row) => Promise<InviteActivationEvidence>;
  deleteOwner: (userId: string) => Promise<boolean>;
}): Promise<{ tenant: Row; user: Row; login: TLogin }> {
  let lease;
  try {
    lease = await acquireDurableOperationLease({
      dataStore: input.dataStore,
      tenantId: input.tenantId,
      scope: 'tenant-invite-registration',
      subjectId: input.tenantId,
      ownerId: `register:${randomUUID()}`,
      leaseDurationMs: 2 * 60_000,
    });
  } catch {
    throw new InviteRegistrationError('invite_registration_unavailable', 503);
  }
  if (!lease) throw new InviteRegistrationError('invite_registration_in_progress', 409);

  let createdUser: Row | null = null;
  let createdThisAttempt = false;
  let ownerRollbackAllowed = true;
  try {
    const tenant = await input.readInvitedTenant();
    if (!tenant || tenant.id !== input.tenantId) {
      throw new InviteRegistrationError('invite_invalid_or_used', 403);
    }
    createdUser = await input.readExistingOwner?.(tenant) ?? null;
    if (createdUser && input.acceptExistingOwner && !input.acceptExistingOwner(createdUser)) {
      throw new InviteRegistrationError('invite_registration_owner_conflict', 409);
    }
    if (!createdUser) {
      createdUser = await input.createOwner(tenant);
      createdThisAttempt = Boolean(createdUser?.id);
    }
    if (!createdUser?.id) throw new InviteRegistrationError('owner_create_failed', 400);
    const login = await input.loginOwner();
    if (!login) throw new InviteRegistrationError('owner_login_failed', 503);
    try {
      if (!await input.activateTenant(tenant)) {
        throw new InviteRegistrationError('invite_activation_failed', 503);
      }
    } catch (activationError) {
      let evidence: InviteActivationEvidence = 'unknown';
      try {
        evidence = await input.readActivationEvidence(tenant, createdUser);
      } catch {
        evidence = 'unknown';
      }
      if (evidence === 'activated') return { tenant, user: createdUser, login };
      if (evidence === 'unknown') {
        ownerRollbackAllowed = false;
        throw new InviteRegistrationError('invite_activation_needs_attention', 503);
      }
      throw activationError;
    }
    return { tenant, user: createdUser, login };
  } catch (error) {
    if (ownerRollbackAllowed && createdThisAttempt && createdUser?.id) {
      try {
        // A strict false means the record is already absent, which is also a
        // complete rollback. Transport/server failures throw instead.
        await input.deleteOwner(createdUser.id);
      } catch {
        throw new InviteRegistrationError('invite_registration_rollback_failed', 503);
      }
    }
    throw error;
  } finally {
    try {
      await releaseDurableOperationLease({ dataStore: input.dataStore, lease });
    } catch (error) {
      // Invite consumption is already authoritative. A stale lease is bounded
      // by its expiry and must not turn a completed registration into a retry.
      console.error('[auth] failed to release invite registration lease', error);
    }
  }
}

export async function registerPocketBaseInviteOwner<TUser extends { id: string }>(input: {
  invitedTenant: Row;
  inviteCode: string;
  email: string;
  password: string;
  readInvitedTenant: () => Promise<Row | null>;
  loginOwner: () => Promise<{ token: string; record: TUser } | null>;
  dataStore?: DataStore;
}) {
  const companyName = String(input.invitedTenant.companyName || input.invitedTenant.name || '').trim();
  const activation = {
    name: companyName || input.email.split('@')[0],
    companyName,
    inviteCode: '',
    registrationInviteCode: input.inviteCode,
    registeredEmail: input.email.trim().toLowerCase(),
    registeredAt: new Date().toISOString(),
    subscriptionStatus: 'active',
    subscriptionPlan: 'customer',
    subscriptionExpiresAt: null,
  };
  const registration = await consumeInviteRegistration({
    dataStore: input.dataStore ?? store,
    tenantId: input.invitedTenant.id,
    readInvitedTenant: input.readInvitedTenant,
    readExistingOwner: async tenant => {
      const result = await pbListStrict<Row>('users', {
        perPage: 2,
        filter: `tenantId = ${pbFilterValue(tenant.id)} && role = "super_admin"`,
      });
      if (result.totalItems > 1 || result.items.length > 1) {
        throw new InviteRegistrationError('invite_registration_owner_integrity_violation', 503);
      }
      return result.items[0] ?? null;
    },
    acceptExistingOwner: owner => String(owner.email || '').trim().toLowerCase() === input.email.trim().toLowerCase(),
    createOwner: async tenant => {
      try {
        return await pbCreateStrict('users', {
          email: input.email,
          password: input.password,
          passwordConfirm: input.password,
          name: companyName,
          tenantId: tenant.id,
          role: 'super_admin',
          emailVisibility: true,
        }) as Row;
      } catch (error) {
        if (error instanceof Error && /\((?:400|409|422)\)/.test(error.message)) return null;
        throw error;
      }
    },
    loginOwner: input.loginOwner,
    activateTenant: tenant => pbPatchStrict('tenants', tenant.id, activation),
    readActivationEvidence: async tenant => {
      const current = await pbGetStrict('tenants', tenant.id) as Row | null;
      return classifyInviteActivationEvidence({
        current,
        inviteCode: input.inviteCode,
        email: input.email,
      });
    },
    deleteOwner: userId => pbDeleteStrict('users', userId),
  });
  return { ...registration, tenant: { ...registration.tenant, ...activation } };
}

export function publicInviteRegistrationError(error: unknown): {
  status: number;
  body: { error: string; message: string };
} {
  const known = error instanceof InviteRegistrationError ? error : null;
  const messages: Record<string, string> = {
    invite_registration_in_progress: '邀请码正在被使用，请稍后重试',
    invite_registration_owner_conflict: '该租户已有待核查的 Owner 账号，请勿重试并联系管理员',
    invite_registration_owner_integrity_violation: '租户 Owner 数据异常，请勿重试并联系管理员核查',
    invite_invalid_or_used: '邀请码无效或已使用，请联系管理员重新生成',
    owner_create_failed: '创建用户失败（邮箱可能已被注册）',
    owner_login_failed: '注册后自动登录失败，已回滚新账号，请重试',
    invite_activation_failed: '激活租户失败，已回滚新账号，请重试',
    invite_activation_needs_attention: '租户激活结果待核查，请勿重试并联系管理员',
    invite_registration_rollback_failed: '注册回滚未能确认完成，请勿重试并联系管理员核查',
  };
  const code = known?.code ?? 'invite_registration_unavailable';
  return {
    status: known?.status ?? 503,
    body: { error: code, message: messages[code] || '注册服务暂时不可用，请稍后重试' },
  };
}
