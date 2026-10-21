import { createHash } from 'node:crypto';
import { buildEnterpriseContext, readTenantEnterpriseProfile } from '../routes/enterprise.js';
import { store } from '../storage/index.js';
import {
  auditCommercialClaims,
  confirmedEnterpriseContextForProduct,
  hasConfirmedEnterpriseFacts,
  unconfirmedEnterpriseProductFields,
} from '../lib/studioGenerationTruthfulness.js';
import {
  canonicalPlatformCopies,
  platformCopiesAuditText,
  type PlatformCopy,
  type PublishCopyPlatform,
} from './copyAdaptation.js';

export type AuditedCopyAdaptationInput = {
  tenantId: string;
  title: string;
  description: string;
  language: string;
  targetPlatforms: PublishCopyPlatform[];
  currentCopy: Partial<Record<PublishCopyPlatform, PlatformCopy>>;
  requireAlternative: boolean;
  projectId?: string;
};

type AuditedCopyAdaptationDependencies = {
  loadEnterpriseContext(tenantId: string): Promise<string>;
  loadProject(projectId: string): Promise<Record<string, unknown> | null>;
  now(): Date;
};

export type AuditedCopyAdaptationResult = {
  status: number;
  body: Record<string, unknown>;
};

const defaults: AuditedCopyAdaptationDependencies = {
  loadEnterpriseContext: async tenantId => buildEnterpriseContext(await readTenantEnterpriseProfile(tenantId)),
  loadProject: projectId => store.getById<Record<string, unknown>>('studio_projects', projectId),
  now: () => new Date(),
};

function objectValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* invalid persisted project */ }
  }
  return {};
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function enterpriseFactVersionFromContext(context: string): string | null {
  return context.match(/(?:^|\n)企业事实版本：([^\n]+)/)?.[1]?.trim() || null;
}

function rejected(code: string, message: string, fieldsToConfirm: string[] = []): AuditedCopyAdaptationResult {
  return {
    status: 422,
    body: {
      ok: false, source: 'ai_rejected', provenance: 'ai_rejected', qualityStatus: 'rejected', publishable: false,
      error: code, message, fieldsToConfirm,
    },
  };
}

export async function generateAuditedPlatformCopies(
  input: AuditedCopyAdaptationInput,
  dependencies: Partial<AuditedCopyAdaptationDependencies> = {},
): Promise<AuditedCopyAdaptationResult> {
  const deps = { ...defaults, ...dependencies };
  if (!input.title && !input.description) {
    return { status: 400, body: { ok: false, publishable: false, error: 'copy_source_required', message: '请先填写作品标题或发布配文' } };
  }
  let confirmedContext: string;
  try {
    confirmedContext = await deps.loadEnterpriseContext(input.tenantId);
  } catch {
    return { status: 503, body: { ok: false, source: 'ai_failed', provenance: 'ai_failed', qualityStatus: 'failed', publishable: false, error: 'enterprise_facts_unavailable', message: '企业资料暂时无法读取，未生成平台文案。' } };
  }
  let productInfo = '';
  if (input.projectId) {
    let project: Record<string, unknown> | null;
    try { project = await deps.loadProject(input.projectId); }
    catch { return { status: 503, body: { ok: false, source: 'ai_failed', provenance: 'ai_failed', qualityStatus: 'failed', publishable: false, error: 'studio_project_unavailable', message: 'Studio 项目暂时无法验证，未生成平台文案。' } }; }
    if (!project || String(project.tenant_id || '') !== input.tenantId) {
      return { status: 404, body: { ok: false, publishable: false, error: 'studio_project_not_found', message: '当前企业的 Studio 项目不存在。' } };
    }
    productInfo = String(objectValue(project.spec).productInfo || '');
    confirmedContext = confirmedEnterpriseContextForProduct(productInfo, confirmedContext);
    const unconfirmed = unconfirmedEnterpriseProductFields(productInfo, confirmedContext);
    if (unconfirmed.length) return rejected('enterprise_product_facts_unconfirmed', `当前产品资料仍有未确认字段：${unconfirmed.join('、')}`, unconfirmed);
  }
  if (!hasConfirmedEnterpriseFacts(confirmedContext)) {
    return rejected('enterprise_facts_required', '请先在企业中心确认企业或产品资料，再生成平台文案。', ['企业或产品资料']);
  }
  const sourceText = [input.title, input.description, JSON.stringify(input.currentCopy)].filter(Boolean).join('\n');
  const sourceAudit = auditCommercialClaims(sourceText, confirmedContext);
  if (sourceAudit.issues.length) {
    return rejected('copy_source_claims_unconfirmed', sourceAudit.issues.join('；'), sourceAudit.fieldsToConfirm);
  }
  const enterpriseFactsHash = digest(confirmedContext);
  const auditBase = {
    enterpriseFactVersion: enterpriseFactVersionFromContext(confirmedContext),
    enterpriseFactsHash,
    sourceHash: digest(sourceText),
    projectId: input.projectId || null,
    targetPlatforms: input.targetPlatforms,
    checkedAt: deps.now().toISOString(),
  };
  if (input.requireAlternative) {
    return {
      status: 422,
      body: {
        ok: false, source: 'canonical_copy', provenance: 'user_confirmed', qualityStatus: 'rejected', publishable: false,
        error: 'platform_copy_rewrite_disabled', message: '当前使用统一发布文案；请直接修改原稿，系统不会按平台生成不同版本。', audit: auditBase,
      },
    };
  }
  const copy = canonicalPlatformCopies({
    platforms: input.targetPlatforms,
    title: input.title,
    body: input.description,
    currentCopy: input.currentCopy,
  });
  const outputText = platformCopiesAuditText(copy);
  const outputAudit = auditCommercialClaims(outputText, confirmedContext);
  if (outputAudit.issues.length) {
    return {
      ...rejected('canonical_copy_claims_unconfirmed', outputAudit.issues.join('；'), outputAudit.fieldsToConfirm),
      body: {
        ...rejected('canonical_copy_claims_unconfirmed', outputAudit.issues.join('；'), outputAudit.fieldsToConfirm).body,
        audit: auditBase,
      },
    };
  }
  return {
    status: 200,
    body: {
      ok: true, copy, source: 'canonical_copy', provenance: 'user_confirmed', qualityStatus: 'passed', publishable: true,
      audit: { ...auditBase, outputHash: digest(outputText) },
    },
  };
}
