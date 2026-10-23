import { type StudioScriptResult, type StudioScriptQualityStatus } from '../../lib/studioApi';
import type { ModeScriptOutput } from './studioWorkspaceContracts.js';

export const compact = (value?: string) => String(value || '').trim();

export const PLACEHOLDER_PRODUCT_RE = /^(主推产品|this product|企业产品组合)$/i;

export const modeScriptNumber = (item: ModeScriptOutput, fallbackIndex = 0): number => {
  const match = item.title.match(/脚本\s*(\d+)/);
  return match ? Number(match[1]) || fallbackIndex + 1 : fallbackIndex + 1;
};

export function normalizedCoveragePercent(response: StudioScriptResult): number | undefined {
  const coverage = response.materialCoverage;
  let value: number | undefined;
  if (typeof coverage === 'number') value = coverage;
  else if (coverage && typeof coverage === 'object') {
    value = coverage.coverageRatio ?? coverage.percent ?? coverage.percentage ?? coverage.ratio;
    if (value === undefined && Number(coverage.total) > 0 && Number.isFinite(Number(coverage.covered))) {
      value = Number(coverage.covered) / Number(coverage.total);
    }
  }
  if (value === undefined) {
    const checkCoverage = response.qualityChecks?.materialCoverage;
    value = typeof checkCoverage === 'number'
      ? checkCoverage
      : checkCoverage?.coverageRatio ?? checkCoverage?.percent ?? checkCoverage?.percentage ?? checkCoverage?.ratio;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(100, value <= 1 ? value * 100 : value));
}

export function pendingMaterialSceneCount(response: StudioScriptResult): number | undefined {
  const coverage = response.qualityChecks?.materialCoverage;
  const pending = typeof coverage === 'object' ? coverage.pendingScenes : undefined;
  return typeof pending === 'number' && Number.isFinite(pending) ? Math.max(0, Math.round(pending)) : undefined;
}

export function missingMaterialLabels(response: StudioScriptResult): string[] {
  const coverage = response.materialCoverage;
  const nested = coverage && typeof coverage === 'object'
    ? [...(coverage.missing || []), ...(coverage.missingShots || [])]
    : [];
  return Array.from(new Set([...(response.missingMaterials || []), ...nested].map(item => String(item).trim()).filter(Boolean)));
}

export function normalizedScriptQualityStatus(response: StudioScriptResult): StudioScriptQualityStatus | undefined {
  if (response.ok === false && response.source !== 'ai_rejected') return 'failed';
  if (['fallback', 'local', 'template', 'ai_failed'].includes(String(response.source || '').toLowerCase())) return 'failed';
  if (response.qualityStatus) return response.qualityStatus;
  if (response.source === 'ai_rejected') return 'rejected';
  if (response.source === 'ai_failed') return 'failed';
  // Legacy responses without an explicit quality verdict remain drafts. A
  // non-empty string alone must never be upgraded to "passed".
  return response.script?.trim() ? 'warning' : undefined;
}

export function scriptQualityWarnings(response: StudioScriptResult): string[] {
  const status = normalizedScriptQualityStatus(response);
  const warnings = response.validationWarnings?.length
    ? response.validationWarnings
    : status !== 'rejected' && status !== 'failed'
      ? response.validationIssues || []
      : [];
  return Array.from(new Set(warnings.map(item => String(item).trim()).filter(Boolean)));
}

export function scriptQualityFailure(response: StudioScriptResult, fallback: string, retainRejectedDraft = false): string | null {
  const status = normalizedScriptQualityStatus(response);
  const scriptAvailable = Boolean(response.script?.trim());
  const source = String(response.source || '').toLowerCase();
  if (response.ok === false && source !== 'ai_rejected') return response.error || fallback;
  if (['fallback', 'local', 'template', 'ai_failed'].includes(source)) {
    return response.error || 'AI 生成失败；本地或历史内容未被当作本次 AI 结果。';
  }
  if (scriptAvailable && status !== 'rejected' && status !== 'failed') return null;
  if (scriptAvailable && status === 'rejected' && retainRejectedDraft) return null;
  const reasons = response.validationIssues?.length
    ? response.validationIssues
    : response.validationWarnings?.length
      ? response.validationWarnings
      : [];
  const reason = reasons.map(item => String(item).trim()).filter(Boolean).map((issue, issueIndex) => `${issueIndex + 1}. ${issue}`).join('；')
    || response.error
    || response.fallbackReason
    || fallback;
  return status === 'rejected'
    ? `生成已停止（质量校验未通过）：${reason}`
    : reason;
}

export const REJECTED_STORYBOARD_ASSISTANT_MESSAGE = '当前测试账号素材太少啦，换个创作模式再试试！';

export function announceRejectedStoryboard(response: StudioScriptResult): void {
  const status = normalizedScriptQualityStatus(response);
  if (status !== 'rejected' && status !== 'failed') return;
  window.dispatchEvent(new CustomEvent('lingshu-assistant-say', {
    detail: { message: REJECTED_STORYBOARD_ASSISTANT_MESSAGE, durationMs: 7_000 },
  }));
}

export function qualityFields(response: StudioScriptResult): Pick<ModeScriptOutput, 'generationSource' | 'generationProvenance' | 'publishable' | 'qualityStatus' | 'qualityChecks' | 'validationWarnings' | 'validationIssues' | 'materialCoveragePercent' | 'pendingMaterialScenes' | 'missingMaterials'> {
  return {
    generationSource: response.source,
    generationProvenance: response.provenance || (response.source === 'ai' ? 'ai' : response.source),
    publishable: response.publishable,
    qualityStatus: normalizedScriptQualityStatus(response),
    qualityChecks: response.qualityChecks,
    validationWarnings: scriptQualityWarnings(response),
    validationIssues: response.validationIssues || [],
    materialCoveragePercent: normalizedCoveragePercent(response),
    pendingMaterialScenes: pendingMaterialSceneCount(response),
    missingMaterials: missingMaterialLabels(response),
  };
}

export function qualitySuccessNotice(response: StudioScriptResult, defaultMessage: string): string {
  const status = normalizedScriptQualityStatus(response);
  const coverage = normalizedCoveragePercent(response);
  const warnings = scriptQualityWarnings(response);
  const missing = missingMaterialLabels(response);
  const pendingScenes = pendingMaterialSceneCount(response);
  if (status === 'rejected') {
    const issueCount = response.validationIssues?.length || 1;
    return `草稿已生成，待人工审核；当前有 ${issueCount} 项内容需要确认。`;
  }
  if (status === 'needs_material') {
    const missingLabel = pendingScenes !== undefined
      ? `${pendingScenes} 个镜头`
      : missing.length
        ? `${missing.length} 个镜头`
        : '未覆盖镜头';
    return `脚本已生成并写入结果区${coverage === undefined ? '' : `，素材覆盖率 ${Math.round(coverage)}%`}；${missingLabel}已标记为待匹配素材，可继续编辑，补齐后再进入成片。`;
  }
  if (status === 'passed_with_warnings' || status === 'warning' || warnings.length) {
    return `脚本已生成并写入结果区；保留 ${warnings.length || 1} 项质量提示，请确认后继续。`;
  }
  return defaultMessage;
}

export function manualScriptDraft(item: ModeScriptOutput, script: string): ModeScriptOutput {
  const previousReviewNotes = [
    ...(item.validationIssues || []),
    ...(item.validationWarnings || []),
  ].map(note => String(note).trim()).filter(Boolean);
  return {
    ...item,
    script,
    generationSource: 'manual_draft',
    generationProvenance: 'manual_draft',
    publishable: false,
    qualityStatus: 'unreviewed',
    qualityChecks: undefined,
    validationWarnings: Array.from(new Set([
      '内容已手动修改，等待基于企业中心资料重新审核。',
      ...previousReviewNotes,
    ])),
    validationIssues: [],
    materialCoveragePercent: undefined,
    pendingMaterialScenes: undefined,
    missingMaterials: [],
  };
}
