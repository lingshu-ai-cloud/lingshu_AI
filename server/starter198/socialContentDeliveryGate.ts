import { socialText } from './socialContentValidation.js';

const internalCopy = /只呈现(?:已确认内容|真实画面和已确认资料)|企业已确认资料显示|本片(?:仅使用|使用用户明确关联)|用户关联素材|不推断画面事实|不扩展未经确认的产品事实|具体信息，请以已确认企业资料为准|Verified information is shown|This video uses material the user explicitly linked/i;

/** A request for a duration is a delivery constraint, not permission to pad footage. */
export function requestedVideoDurationSeconds(requirements: string | null | undefined): number | null {
  const match = socialText(requirements).match(/(?:约|大约|制作|时长|duration|about|approximately)?\s*(\d+(?:\.\d+)?)\s*(?:秒|seconds?|sec\b)/i);
  const value = Number(match?.[1]);
  return Number.isFinite(value) && value >= 2 && value <= 180 ? value : null;
}

export function assertSocialDeliveryCopyAndDuration(input: {
  narration: string;
  requirements?: string | null;
  plannedMaximumSeconds: number;
  renderedSeconds?: number;
}): void {
  if (internalCopy.test(input.narration)) {
    throw new Error('director_revision_required:口播含内部来源或质检占位语，编导须改写为有画面证据的对外文案');
  }
  const requested = requestedVideoDurationSeconds(input.requirements);
  if (requested === null) return;
  const tolerance = Math.max(0.5, requested * 0.05);
  if (input.plannedMaximumSeconds < requested - tolerance) {
    throw new Error(`director_revision_required:用户要求约 ${requested} 秒，但已锁定画面最多支持 ${input.plannedMaximumSeconds.toFixed(2)} 秒`);
  }
  if (input.renderedSeconds !== undefined && Math.abs(input.renderedSeconds - requested) > tolerance) {
    throw new Error(`director_revision_required:用户要求约 ${requested} 秒，实际成片 ${input.renderedSeconds.toFixed(2)} 秒`);
  }
}
