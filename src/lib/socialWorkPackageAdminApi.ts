import {
  SOCIAL_WORK_PACKAGE_KINDS,
  SOCIAL_WORK_PACKAGE_STATUSES,
  type CreateSocialWorkPackageVersionInput,
  type SocialWorkPackageFramework,
  type SocialWorkPackageKind,
  type SocialWorkPackageStatus,
  type SocialWorkPackageVersionDetail,
  type UpdateSocialWorkPackageVersionInput,
} from '../../shared/contracts/socialContentWorkflow';
import { authHeader } from './auth';

const BASE_PATH = '/api/overseas/starter-198/social-content/internal/work-packages';

export const SOCIAL_WORK_PACKAGE_TRANSITIONS: Record<SocialWorkPackageStatus, readonly SocialWorkPackageStatus[]> = {
  draft: ['internal_trial', 'retired'],
  internal_trial: ['draft', 'active', 'retired'],
  active: ['retired'],
  retired: [],
};

export function socialWorkPackageActivationMissing(item: SocialWorkPackageVersionDetail): string[] {
  const missing: string[] = [];
  if (!item.summary?.trim()) missing.push('适用说明');
  if (item.framework.requiredInputs.length === 0) missing.push('需要资料');
  if (item.framework.deliverables.length === 0) missing.push('交付清单');
  return missing;
}

function mutationKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `social-work-package-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requiredText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('作业方案数据不完整');
  return value.trim();
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nullableTime(value: unknown): string | null {
  const parsed = nullableText(value);
  if (!parsed) return null;
  if (!Number.isFinite(Date.parse(parsed))) throw new Error('作业方案数据不完整');
  return parsed;
}

function requiredTime(value: unknown): string {
  const parsed = nullableTime(value);
  if (!parsed) throw new Error('作业方案数据不完整');
  return parsed;
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error('作业方案数据不完整');
  }
  return value.map(item => item.trim()).filter(Boolean);
}

function normalizeFramework(value: unknown): SocialWorkPackageFramework {
  const source = record(value);
  return {
    applicability: textList(source.applicability),
    requiredInputs: textList(source.requiredInputs),
    workOutline: textList(source.workOutline),
    deliverables: textList(source.deliverables),
    userDecisions: textList(source.userDecisions),
    qualityChecks: textList(source.qualityChecks),
    metricRequirements: textList(source.metricRequirements),
    fallbackPolicy: textList(source.fallbackPolicy),
  };
}

export function normalizeSocialWorkPackageVersion(value: unknown): SocialWorkPackageVersionDetail {
  const source = record(value);
  const kind = source.kind as SocialWorkPackageKind;
  const status = source.status as SocialWorkPackageStatus;
  if (
    !SOCIAL_WORK_PACKAGE_KINDS.includes(kind)
    || !SOCIAL_WORK_PACKAGE_STATUSES.includes(status)
    || typeof source.available !== 'boolean'
    || typeof source.builtin !== 'boolean'
  ) {
    throw new Error('作业方案数据不完整');
  }
  const framework = normalizeFramework(source.framework);
  const requiredInputs = textList(source.requiredInputs);
  const deliverables = textList(source.deliverables);
  if (
    JSON.stringify(requiredInputs) !== JSON.stringify(framework.requiredInputs)
    || JSON.stringify(deliverables) !== JSON.stringify(framework.deliverables)
  ) throw new Error('作业方案数据不完整');
  return {
    kind,
    packageKey: requiredText(source.packageKey),
    version: requiredText(source.version),
    name: requiredText(source.name),
    summary: nullableText(source.summary),
    status,
    available: source.available,
    framework,
    requiredInputs,
    deliverables,
    effectiveFrom: nullableTime(source.effectiveFrom),
    effectiveUntil: nullableTime(source.effectiveUntil),
    recordVersion: requiredText(source.recordVersion),
    updatedAt: requiredTime(source.updatedAt),
    builtin: source.builtin,
  };
}

function friendlyFailure(status: number, code: string): string {
  if (code === 'social_package_version_exists') return '这个版本编号已经存在';
  if (code === 'social_package_activation_incomplete') return '请先补全适用说明、需要资料和交付清单';
  if (code === 'social_package_active_version_exists') return '该作业包已有正式版本，请先停用原版本';
  if (code === 'social_package_builtin_read_only') return '系统初始版本为只读，请创建新版本';
  if (code === 'social_package_status_transition_invalid') return '当前状态不能执行这项变更，请刷新后重试';
  if (status === 400 || status === 422) return '请检查方案信息后重试';
  if (status === 401) return '登录状态已失效，请重新登录';
  if (status === 403) return '仅平台管理员可以管理作业方案';
  if (status === 404) return '该方案版本不存在或已被移除';
  if (status === 409 || status === 412) return '方案版本已有更新，请刷新后重试';
  if (status === 413) return '方案内容过多，请精简后重试';
  if (status >= 500) return '作业方案暂时无法读取，请稍后重试';
  return '操作未完成，请重试';
}

export class SocialWorkPackageAdminRequestError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(friendlyFailure(status, code));
    this.name = 'SocialWorkPackageAdminRequestError';
  }
}

async function requestJson(path: string, options?: RequestInit): Promise<Record<string, unknown>> {
  const mutating = Boolean(options?.method && options.method !== 'GET');
  const response = await fetch(`${BASE_PATH}${path}`, {
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
  const payload = record(await response.json().catch(() => ({})));
  if (!response.ok) throw new SocialWorkPackageAdminRequestError(
    response.status,
    typeof payload.error === 'string' ? payload.error : '',
  );
  return payload;
}

function workPackageFrom(payload: Record<string, unknown>): SocialWorkPackageVersionDetail {
  return normalizeSocialWorkPackageVersion(payload.workPackage);
}

export const socialWorkPackageAdminApi = {
  list: async (): Promise<SocialWorkPackageVersionDetail[]> => {
    const payload = await requestJson('');
    if (!Array.isArray(payload.items)) throw new Error('作业方案数据不完整');
    return payload.items.map(normalizeSocialWorkPackageVersion);
  },
  createVersion: async (input: CreateSocialWorkPackageVersionInput): Promise<SocialWorkPackageVersionDetail> => (
    workPackageFrom(await requestJson('', { method: 'POST', body: JSON.stringify(input) }))
  ),
  updateVersion: async (
    packageKey: string,
    version: string,
    input: UpdateSocialWorkPackageVersionInput,
  ): Promise<SocialWorkPackageVersionDetail> => (
    workPackageFrom(await requestJson(`/${encodeURIComponent(packageKey)}/${encodeURIComponent(version)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }))
  ),
  changeStatus: async (
    packageKey: string,
    version: string,
    expectedVersion: string,
    status: SocialWorkPackageStatus,
  ): Promise<SocialWorkPackageVersionDetail> => (
    workPackageFrom(await requestJson(`/${encodeURIComponent(packageKey)}/${encodeURIComponent(version)}/status`, {
      method: 'POST',
      body: JSON.stringify({ expectedVersion, status }),
    }))
  ),
};
