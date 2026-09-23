import { authHeader } from '../../../src/lib/auth';

const BASE_PATH = '/api/overseas/account-hub';

export const ACCOUNT_HUB_PROVIDERS = ['codex', 'claude'] as const;
export type AccountHubProvider = typeof ACCOUNT_HUB_PROVIDERS[number];

export const ACCOUNT_HUB_ACCOUNT_STATUSES = [
  'pending',
  'ready',
  'busy',
  'reauthorization_required',
  'unavailable',
  'disabled',
] as const;
export type AccountHubAccountStatus = typeof ACCOUNT_HUB_ACCOUNT_STATUSES[number];

export type AccountHubAccount = {
  id: string;
  provider: AccountHubProvider;
  label: string;
  memberId: string;
  memberName: string | null;
  status: AccountHubAccountStatus;
  enabled: boolean;
  plan: string | null;
  statusDetail: string | null;
  lastCheckedAt: string | null;
  lastUsedAt: string | null;
  holderMemberId: string | null;
  deviceLabel: string | null;
  acquiredAt: string | null;
  renewedAt: string | null;
  expiresAt: string | null;
  localState: AccountHubLocalState | null;
  legacyManagedProfilePresent: boolean;
  transferEligible: boolean;
  transferBlockedReasons: AccountHubTransferBlock[];
  createdAt: string;
};

export type AccountHubTransferBlock = {
  code: string;
  message: string | null;
};

export const ACCOUNT_HUB_LOCAL_AUTH_STATES = [
  'authenticated',
  'unauthenticated',
  'unavailable',
  'unknown',
] as const;
export type AccountHubLocalAuthState = typeof ACCOUNT_HUB_LOCAL_AUTH_STATES[number];

export type AccountHubUsageWindow = {
  remainingPercent: number;
  resetsAt: string | null;
};

export type AccountHubUsage = {
  available: boolean;
  primary: AccountHubUsageWindow | null;
  secondary: AccountHubUsageWindow | null;
  creditsRemaining: number | null;
  checkedAt: string | null;
};

export type AccountHubLocalState = {
  state: AccountHubLocalAuthState;
  reportedAt: string;
  deviceId: string | null;
  deviceLabel: string | null;
  email: string | null;
  plan: string | null;
  authMode: string | null;
  usage: AccountHubUsage | null;
};

export type TeamUsageRange = '1d' | '7d' | '30d';

export type TeamMember = {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
};

export type TokenTotals = {
  eventCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};

export type TeamUsageMember = TeamMember & TokenTotals & { online: boolean };

export type TeamUsageEvent = {
  id: string;
  memberId: string;
  eventAt: string;
  receivedAt: string;
  conversationHash: string | null;
  model: string | null;
  source: string | null;
  clientVersion: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};

export type TeamUsageSummary = {
  range: TeamUsageRange;
  generatedAt: string;
  freshness: 'near_realtime';
  accounting: 'telemetry_estimate';
  totals: TokenTotals;
  members: TeamUsageMember[];
  timeline: Array<{
    date: string;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }>;
  recent: TeamUsageEvent[];
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`账号中心数据缺少 ${field}`);
  return value.trim();
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberValue(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`团队用量数据中的 ${field} 无效`);
  return value;
}

function nullableNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  return numberValue(value, field);
}

function enumValue<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new Error(`账号中心数据中的 ${field} 无效`);
  return value as T;
}

function timestamp(value: unknown, required = false): string | null {
  const text = nullableText(value);
  if (!text) {
    if (required) throw new Error('账号中心数据缺少时间');
    return null;
  }
  if (!Number.isFinite(Date.parse(text))) throw new Error('账号中心数据包含无效时间');
  return text;
}

function normalizeUsageWindow(value: unknown): AccountHubUsageWindow | null {
  if (value === undefined || value === null) return null;
  const source = record(value);
  const remainingPercent = numberValue(source.remainingPercent, '剩余百分比');
  if (remainingPercent > 100) throw new Error('账号用量中的剩余百分比无效');
  return { remainingPercent, resetsAt: timestamp(source.resetsAt) };
}

export function normalizeAccountHubUsage(value: unknown): AccountHubUsage {
  const source = record(value);
  const limit = Array.isArray(source.limits) ? record(source.limits[0]) : source;
  const available = booleanValue(source.available, false);
  return {
    available,
    primary: available ? normalizeUsageWindow(limit.primary) : null,
    secondary: available ? normalizeUsageWindow(limit.secondary) : null,
    creditsRemaining: nullableNumber(source.creditsRemaining, '剩余 Credits'),
    checkedAt: timestamp(source.fetchedAt ?? source.checkedAt),
  };
}

function normalizeAccountHubLocalState(value: unknown): AccountHubLocalState | null {
  if (value === undefined || value === null) return null;
  const source = record(value);
  return {
    state: enumValue(source.state, ACCOUNT_HUB_LOCAL_AUTH_STATES, '本机认证状态'),
    reportedAt: timestamp(source.reportedAt, true) as string,
    deviceId: nullableText(source.deviceId),
    deviceLabel: nullableText(source.deviceLabel),
    email: nullableText(source.email),
    plan: nullableText(source.plan),
    authMode: nullableText(source.authMode),
    usage: source.usage === undefined || source.usage === null ? null : normalizeAccountHubUsage(source.usage),
  };
}

function normalizeTransferBlock(value: unknown): AccountHubTransferBlock | null {
  if (typeof value === 'string' && value.trim()) return { code: value.trim(), message: null };
  const source = record(value);
  const code = nullableText(source.code ?? source.reason);
  if (!code) return null;
  return { code, message: nullableText(source.message) };
}

function normalizeTransferBlocks(source: Record<string, unknown>): AccountHubTransferBlock[] {
  const raw = source.transferBlockedReasons ?? source.transferBlockedReason ?? source.transferBlocked;
  const values = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  return values.map(normalizeTransferBlock).filter((value): value is AccountHubTransferBlock => Boolean(value));
}

export function normalizeAccountHubAccount(value: unknown): AccountHubAccount {
  const source = record(value);
  const enabled = booleanValue(source.enabled, true);
  const rawStatus = source.status ?? (enabled ? 'pending' : 'disabled');
  return {
    id: requiredText(source.id, '账号 ID'),
    provider: enumValue(source.provider, ACCOUNT_HUB_PROVIDERS, 'Provider'),
    label: requiredText(source.label, '账号名称'),
    memberId: requiredText(source.memberId, '绑定成员'),
    memberName: nullableText(source.memberName),
    status: enumValue(rawStatus, ACCOUNT_HUB_ACCOUNT_STATUSES, '账号状态'),
    enabled,
    plan: nullableText(source.plan),
    statusDetail: nullableText(source.statusDetail),
    lastCheckedAt: timestamp(source.lastCheckedAt),
    lastUsedAt: timestamp(source.lastUsedAt),
    holderMemberId: nullableText(source.holderMemberId),
    deviceLabel: nullableText(source.deviceLabel),
    acquiredAt: timestamp(source.acquiredAt),
    renewedAt: timestamp(source.renewedAt),
    expiresAt: timestamp(source.expiresAt),
    localState: normalizeAccountHubLocalState(source.localState),
    legacyManagedProfilePresent: booleanValue(source.legacyManagedProfilePresent, false),
    transferEligible: booleanValue(source.transferEligible, false),
    transferBlockedReasons: normalizeTransferBlocks(source),
    createdAt: timestamp(source.createdAt, true) as string,
  };
}

export function normalizeTeamMember(value: unknown): TeamMember {
  const source = record(value);
  return {
    id: requiredText(source.id, '成员 ID'),
    name: requiredText(source.name, '成员姓名'),
    enabled: booleanValue(source.enabled, true),
    createdAt: timestamp(source.createdAt, true) as string,
    updatedAt: timestamp(source.updatedAt, true) as string,
    lastSeenAt: timestamp(source.lastSeenAt),
  };
}

function normalizeTokenTotals(value: unknown): TokenTotals {
  const source = record(value);
  return {
    eventCount: numberValue(source.eventCount, '事件数'),
    inputTokens: numberValue(source.inputTokens, '输入 Token'),
    cachedInputTokens: numberValue(source.cachedInputTokens, '缓存 Token'),
    cacheWriteInputTokens: numberValue(source.cacheWriteInputTokens, '缓存写入 Token'),
    outputTokens: numberValue(source.outputTokens, '输出 Token'),
    reasoningOutputTokens: numberValue(source.reasoningOutputTokens, '推理 Token'),
    totalTokens: numberValue(source.totalTokens, '总 Token'),
  };
}

function normalizeTeamUsageEvent(value: unknown): TeamUsageEvent {
  const source = record(value);
  return {
    id: requiredText(source.id, '事件 ID'),
    memberId: requiredText(source.memberId, '成员 ID'),
    eventAt: timestamp(source.eventAt, true) as string,
    receivedAt: timestamp(source.receivedAt, true) as string,
    conversationHash: nullableText(source.conversationHash),
    model: nullableText(source.model),
    source: nullableText(source.source),
    clientVersion: nullableText(source.clientVersion),
    ...normalizeTokenTotals({ ...source, eventCount: 1 }),
  };
}

export function normalizeTeamUsageSummary(value: unknown): TeamUsageSummary {
  const source = record(value);
  const range = enumValue(source.range, ['1d', '7d', '30d'] as const, '统计范围');
  const members = Array.isArray(source.members) ? source.members : [];
  const timeline = Array.isArray(source.timeline) ? source.timeline : [];
  const recent = Array.isArray(source.recent) ? source.recent : [];
  return {
    range,
    generatedAt: timestamp(source.generatedAt, true) as string,
    freshness: enumValue(source.freshness, ['near_realtime'] as const, '刷新类型'),
    accounting: enumValue(source.accounting, ['telemetry_estimate'] as const, '统计口径'),
    totals: normalizeTokenTotals(source.totals),
    members: members.map(value => {
      const memberSource = record(value);
      return {
        ...normalizeTeamMember(memberSource),
        ...normalizeTokenTotals(memberSource),
        online: booleanValue(memberSource.online, false),
      };
    }),
    timeline: timeline.map(value => {
      const item = record(value);
      return {
        date: requiredText(item.date, '日期'),
        inputTokens: numberValue(item.inputTokens, '输入 Token'),
        cachedInputTokens: numberValue(item.cachedInputTokens, '缓存 Token'),
        outputTokens: numberValue(item.outputTokens, '输出 Token'),
        totalTokens: numberValue(item.totalTokens, '总 Token'),
      };
    }),
    recent: recent.map(normalizeTeamUsageEvent),
  };
}

function friendlyFailure(status: number, code: string): string {
  if (code === 'member_not_found') return '成员不存在或已被移除';
  if (code === 'member_name_exists') return '已有同名成员，请换一个成员名称';
  if (code === 'member_disabled') return '该成员已停用，请先恢复成员状态';
  if (code === 'account_not_found') return '账号不存在或已被移除';
  if (code === 'account_disabled') return '账号已禁用，请先启用后再操作';
  if (code === 'account_busy' || code === 'account_in_use') return '账号当前有有效占用锁，请先从原设备仅退出本地';
  if (code === 'member_provider_account_exists') return '该成员已经绑定了同一服务商账号';
  if (code === 'target_provider_account_exists') return '目标成员已经绑定了同一服务商账号';
  if (code === 'provider_account_already_bound') return '这个服务商账号已经绑定给其他成员，不能重复接入';
  if (code === 'account_owner_immutable') return '账号归属绑定后不可更改';
  if (code === 'account_transfer_blocked' || code === 'account_transfer_not_eligible') return '当前账号暂不满足切换或转交条件，请查看阻止原因';
  if (code === 'local_logout_required') return '成员本机仍登录旧 Provider 身份，请先退出旧账号并上报“未登录”快照';
  if (code === 'fresh_local_logout_required') return '本机快照缺失或已过期，请先运行连接器上报最新的“未登录”状态';
  if (code === 'legacy_managed_profile_cleanup_required') return '服务端仍有遗留托管凭据，请先人工迁移清理';
  if (code === 'account_not_pending') return '账号尚未进入等待本机登录状态，请刷新后重试';
  if (code === 'account_assignment_changed') return '账号归属刚刚发生变化，请刷新后重新选择';
  if (code === 'account_hub_local_only') return '账号管理只能在服务所在机器本地访问';
  if (code === 'account_lease_held') return '该账号已被其他设备独占使用，请等待租约释放或到期';
  if (code === 'account_lease_not_owned') return '只能从取得使用权的原设备退出本地';
  if (code === 'account_member_mismatch') return '该账号未绑定到当前成员';
  if (status === 400 || status === 422) return '请检查填写内容后重试';
  if (status === 401) return '登录状态已失效，请重新登录';
  if (status === 403) return '你没有管理账号中心的权限';
  if (status === 404) return '请求的账号或资源不存在';
  if (status === 409) return '当前状态已变化，请刷新后重试';
  if (status === 429) return '操作过于频繁，请稍后重试';
  if (status >= 500) return '账号中心暂时不可用，请稍后重试';
  return '操作未完成，请重试';
}

export class AccountHubRequestError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(friendlyFailure(status, code));
    this.name = 'AccountHubRequestError';
  }
}

function mutationKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `account-hub-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function requestJson(path: string, options?: RequestInit): Promise<Record<string, unknown>> {
  const mutating = Boolean(options?.method && options.method !== 'GET');
  let response: Response;
  try {
    response = await fetch(`${BASE_PATH}${path}`, {
      ...options,
      cache: 'no-store',
      headers: {
        ...authHeader(),
        Accept: 'application/json',
        ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(mutating ? { 'Idempotency-Key': mutationKey() } : {}),
        ...(options?.headers || {}),
      },
    });
  } catch {
    throw new Error('无法连接账号中心，请检查网络后重试');
  }
  const payload = record(await response.json().catch(() => ({})));
  if (!response.ok) {
    throw new AccountHubRequestError(response.status, typeof payload.error === 'string' ? payload.error : '');
  }
  return payload;
}

function accountFromPayload(payload: Record<string, unknown>): AccountHubAccount {
  return normalizeAccountHubAccount(payload.account);
}

export const accountHubApi = {
  listTeamMembers: async (): Promise<TeamMember[]> => {
    const payload = await requestJson('/team/members');
    if (!Array.isArray(payload.members)) throw new Error('团队用量服务返回了无效的成员列表');
    return payload.members.map(normalizeTeamMember);
  },

  createTeamMember: async (name: string): Promise<{
    member: TeamMember;
    ingestToken: string;
    connectorToken: string;
  }> => {
    const payload = await requestJson('/team/members', { method: 'POST', body: JSON.stringify({ name }) });
    return {
      member: normalizeTeamMember(payload.member),
      ingestToken: requiredText(payload.ingestToken, '遥测令牌'),
      connectorToken: requiredText(payload.connectorToken, '连接器令牌'),
    };
  },

  updateTeamMember: async (memberId: string, enabled: boolean): Promise<TeamMember> => {
    const payload = await requestJson(`/team/members/${encodeURIComponent(memberId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
    return normalizeTeamMember(payload.member);
  },

  rotateTeamMemberToken: async (memberId: string): Promise<{
    member: TeamMember;
    ingestToken: string;
    connectorToken: string;
  }> => {
    const payload = await requestJson(`/team/members/${encodeURIComponent(memberId)}/rotate-token`, { method: 'POST' });
    return {
      member: normalizeTeamMember(payload.member),
      ingestToken: requiredText(payload.ingestToken, '遥测令牌'),
      connectorToken: requiredText(payload.connectorToken, '连接器令牌'),
    };
  },

  teamUsage: async (range: TeamUsageRange): Promise<TeamUsageSummary> => {
    const payload = await requestJson(`/team/usage?range=${encodeURIComponent(range)}`);
    return normalizeTeamUsageSummary(payload.summary);
  },

  listAccounts: async (): Promise<AccountHubAccount[]> => {
    const payload = await requestJson('/accounts');
    const items = payload.accounts ?? payload.items;
    if (!Array.isArray(items)) throw new Error('账号中心返回了无效的账号列表');
    return items.map(normalizeAccountHubAccount);
  },

  createAccount: async (input: { provider: AccountHubProvider; label: string; memberId: string }): Promise<AccountHubAccount> => (
    accountFromPayload(await requestJson('/accounts', { method: 'POST', body: JSON.stringify(input) }))
  ),

  updateAccount: async (accountId: string, enabled: boolean): Promise<AccountHubAccount> => (
    accountFromPayload(await requestJson(`/accounts/${encodeURIComponent(accountId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }))
  ),

  assignAccountOwner: async (accountId: string, memberId: string): Promise<AccountHubAccount> => (
    accountFromPayload(await requestJson(`/accounts/${encodeURIComponent(accountId)}/assign-owner`, {
      method: 'POST',
      body: JSON.stringify({ memberId }),
    }))
  ),

  reassignAccountOwner: async (accountId: string, memberId: string): Promise<AccountHubAccount> => (
    accountFromPayload(await requestJson(`/accounts/${encodeURIComponent(accountId)}/reassign-owner`, {
      method: 'POST',
      body: JSON.stringify({ memberId }),
    }))
  ),

};
