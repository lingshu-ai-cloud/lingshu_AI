import type { EnterpriseOnboardingDraft } from '../../shared/contracts/enterpriseOnboarding';
import { authHeader } from './auth';

const ENDPOINT = '/api/overseas/enterprise/onboarding-draft';

async function body(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

export class EnterpriseOnboardingDraftError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly latestDraft?: EnterpriseOnboardingDraft,
    readonly latestRevision = 0,
  ) {
    super(message);
    this.name = 'EnterpriseOnboardingDraftError';
  }
}

export type EnterpriseOnboardingDraftSnapshot = {
  draft: EnterpriseOnboardingDraft | null;
  revision: number;
};

export async function readEnterpriseOnboardingDraft(): Promise<EnterpriseOnboardingDraftSnapshot> {
  const response = await fetch(ENDPOINT, { headers: authHeader(), cache: 'no-store' });
  const result = await body(response);
  if (!response.ok) throw new EnterpriseOnboardingDraftError(
    response.status, String(result.error || 'enterprise_onboarding_draft_unavailable'),
    String(result.message || '新手引导草稿暂时无法读取。'),
  );
  return {
    draft: (result.draft || null) as EnterpriseOnboardingDraft | null,
    revision: Math.max(0, Math.floor(Number(result.revision) || 0)),
  };
}

export async function saveEnterpriseOnboardingDraft(
  draft: EnterpriseOnboardingDraft,
  expectedRevision: number,
): Promise<EnterpriseOnboardingDraft> {
  const response = await fetch(ENDPOINT, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ draft, expectedRevision }),
  });
  const result = await body(response);
  if (!response.ok) throw new EnterpriseOnboardingDraftError(
    response.status, String(result.error || 'enterprise_onboarding_draft_unavailable'),
    String(result.message || '新手引导草稿暂时无法保存。'),
    result.draft as EnterpriseOnboardingDraft | undefined,
    Math.max(0, Math.floor(Number(result.revision) || 0)),
  );
  return result.draft as EnterpriseOnboardingDraft;
}
