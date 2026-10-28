import { DigitalEmployeeApiError } from './digitalEmployeeApi';

type Blocker = { code?: string; message?: string };

/** Convert structured preflight evidence into one actionable conversational step. */
export function weeklyReadinessGuidance(error: unknown): string | null {
  const structured = error instanceof DigitalEmployeeApiError && error.code === 'production_onboarding_preflight_blocked';
  const persisted = error instanceof Error && error.message.startsWith('任务包准备未通过：');
  if (!structured && !persisted) return null;
  const blockers = structured && Array.isArray(error.details.blockers)
    ? error.details.blockers.filter((item): item is Blocker => Boolean(item && typeof item === 'object'))
    : persisted ? error.message.slice('任务包准备未通过：'.length).split('；').filter(Boolean).map(message => ({
      code: /数字人物|口播/.test(message) ? 'presenter_missing' : /声音/.test(message) ? 'voice_missing'
        : /素材|片段/.test(message) ? 'local_material_missing' : undefined,
      message,
    })) : [];
  if (!blockers.length) return '本周计划已保存，但制作资料还需核对。请先打开企业资料确认主推产品和素材，我会在补齐后继续核验；现在尚未启动生产。';
  const codes = new Set(blockers.map(item => item.code));
  let next: string;
  if (codes.has('production_preferences_missing')) next = '请先确认生产偏好，包括成片语言、画幅和联系人。';
  else if (codes.has('enterprise_facts_mismatch') || codes.has('company_profile_missing') || codes.has('brand_profile_missing')) next = '请先核对并重新确认企业与品牌资料。';
  else if (codes.has('product_facts_missing')) next = '请先补齐主推产品的资料和产品图。';
  else if (codes.has('public_contact_missing') || codes.has('primary_cta_missing')) next = '请先填写对外联系方式和视频中的行动引导。';
  else if (codes.has('presenter_missing') || codes.has('voice_missing')) next = '参考视频需要人物口播。请先授权可用的数字人物，并配置声音；也可以调整为不需要人物口播的内容方案。';
  else if (codes.has('local_material_missing')) next = '请先在企业素材库补充已授权的同类视频片段，供这些镜头制作使用；也可以调整掉对应镜头。';
  else next = '请先核对生产资料和素材授权。';
  return `本周计划已保存，但还没有进入生产。当前需要补齐 ${blockers.length} 项条件。第一步，${next}完成后告诉我“重新核验周计划”，我会继续检查下一项，不会自动重复启动。`;
}

export function showWeeklyReadinessGuidance(error: unknown): boolean {
  if (typeof window === 'undefined') return false;
  const assistantText = weeklyReadinessGuidance(error);
  if (!assistantText) return false;
  window.dispatchEvent(new CustomEvent('lingshu-assistant-open', { detail: { assistantText } }));
  return true;
}
