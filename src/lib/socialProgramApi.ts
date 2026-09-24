import { getToken } from './auth';
import type {
  AccountPlaybook,
  OwnedSocialAccount,
  SocialMonthlyPlan,
  SocialProgram,
  SocialWeeklyPlan,
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
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
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
    return (await request<{ items: SocialProgram[] }>('/')).items;
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
    return (await request<{ items: OwnedSocialAccount[] }>(`/${encodeURIComponent(programId)}/accounts`)).items;
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
};
