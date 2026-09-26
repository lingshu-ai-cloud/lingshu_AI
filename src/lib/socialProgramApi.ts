import { getToken } from './auth';
import type {
  AccountPlaybook,
  OwnedSocialAccount,
  SocialMonthlyPlan,
  SocialProgram,
  SocialWeeklyPlan,
  WeeklyOperatingPackage,
} from '../../shared/contracts/socialProgram';

export class SocialProgramRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(`/api/overseas/social-programs${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new SocialProgramRequestError(
      response.status,
      'social_program_invalid_response',
      '社媒经营服务尚未正确加载，请刷新服务后重试。',
    );
  }
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new SocialProgramRequestError(
      response.status,
      'social_program_invalid_response',
      '社媒经营服务返回了无法识别的数据。',
    );
  }
  if (!response.ok) {
    throw new SocialProgramRequestError(
      response.status,
      String(payload.error || 'social_program_request_failed'),
      String(payload.message || '社媒经营数据请求失败。'),
    );
  }
  return payload as T;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

export const socialProgramApi = {
  async list(): Promise<SocialProgram[]> {
    const payload = await request<{ items: SocialProgram[] }>('/');
    if (!Array.isArray(payload.items)) throw new SocialProgramRequestError(502, 'social_program_invalid_response', '社媒经营项目列表格式不正确。');
    return payload.items;
  },
  async get(programId: string): Promise<SocialProgram> {
    return (await request<{ item: SocialProgram }>(`/${encodeURIComponent(programId)}`)).item;
  },
  async create(input: Record<string, unknown>): Promise<SocialProgram> {
    return (await request<{ item: SocialProgram }>('/', { method: 'POST', ...json(input) })).item;
  },
  async update(programId: string, input: Record<string, unknown>): Promise<SocialProgram> {
    return (await request<{ item: SocialProgram }>(`/${encodeURIComponent(programId)}`, { method: 'PATCH', ...json(input) })).item;
  },
  async listAccounts(programId: string): Promise<OwnedSocialAccount[]> {
    const payload = await request<{ items: OwnedSocialAccount[] }>(`/${encodeURIComponent(programId)}/accounts`);
    if (!Array.isArray(payload.items)) throw new SocialProgramRequestError(502, 'social_program_invalid_response', '自有账号列表格式不正确。');
    return payload.items;
  },
  async createAccount(programId: string, input: Record<string, unknown>): Promise<OwnedSocialAccount> {
    return (await request<{ item: OwnedSocialAccount }>(`/${encodeURIComponent(programId)}/accounts`, { method: 'POST', ...json(input) })).item;
  },
  async savePlaybook(programId: string, accountId: string, input: Record<string, unknown>): Promise<AccountPlaybook> {
    return (await request<{ item: AccountPlaybook }>(`/${encodeURIComponent(programId)}/accounts/${encodeURIComponent(accountId)}/playbook`, { method: 'PUT', ...json(input) })).item;
  },
  async saveMonthlyPlan(programId: string, input: Record<string, unknown>): Promise<SocialMonthlyPlan> {
    return (await request<{ item: SocialMonthlyPlan }>(`/${encodeURIComponent(programId)}/plans/monthly`, { method: 'POST', ...json(input) })).item;
  },
  async saveWeeklyPlan(programId: string, input: Record<string, unknown>): Promise<SocialWeeklyPlan> {
    return (await request<{ item: SocialWeeklyPlan }>(`/${encodeURIComponent(programId)}/plans/weekly`, { method: 'POST', ...json(input) })).item;
  },
  async listOperatingPackages(programId: string, weekStart?: string): Promise<WeeklyOperatingPackage[]> {
    const query = weekStart ? `?weekStart=${encodeURIComponent(weekStart)}` : '';
    const payload = await request<{ items: WeeklyOperatingPackage[] }>(`/${encodeURIComponent(programId)}/operating-packages${query}`);
    if (!Array.isArray(payload.items)) throw new SocialProgramRequestError(502, 'social_program_invalid_response', '周任务包列表格式不正确。');
    return payload.items;
  },
  async getOperatingPackage(programId: string, packageId: string): Promise<WeeklyOperatingPackage> {
    return (await request<{ item: WeeklyOperatingPackage }>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}`)).item;
  },
  async createOperatingPackage(programId: string, input: Record<string, unknown>): Promise<WeeklyOperatingPackage> {
    return (await request<{ item: WeeklyOperatingPackage }>(`/${encodeURIComponent(programId)}/operating-packages`, { method: 'POST', ...json(input) })).item;
  },
  async reviseOperatingPackage(programId: string, packageId: string, input: Record<string, unknown>): Promise<WeeklyOperatingPackage> {
    return (await request<{ item: WeeklyOperatingPackage }>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}`, { method: 'PUT', ...json(input) })).item;
  },
  async activateOperatingPackage(programId: string, packageId: string, input: Record<string, unknown>): Promise<WeeklyOperatingPackage> {
    return (await request<{ item: WeeklyOperatingPackage }>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/activate`, { method: 'POST', ...json(input) })).item;
  },
  async retireOperatingPackage(programId: string, packageId: string, input: Record<string, unknown>): Promise<WeeklyOperatingPackage> {
    return (await request<{ item: WeeklyOperatingPackage }>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/retire`, { method: 'POST', ...json(input) })).item;
  },
};
