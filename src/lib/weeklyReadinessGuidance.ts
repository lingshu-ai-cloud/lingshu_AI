import { DigitalEmployeeApiError } from './digitalEmployeeApi';

type Blocker = { code?: string; message?: string };

/** Keep older saved assistant replies readable without changing conversation history. */
export function displayWeeklyReadinessText(content: string): string {
  if (content.startsWith('本周计划还没有开始。') && content.includes('以下视频镜头还缺可用实拍：')) {
    return '本周计划还没有开始。\n\n有视频镜头还缺可用实拍，预览如下。\n\n先补充视频素材。';
  }
  if (content.startsWith('本周生产需要处理：') && content.includes('先补充视频素材。')) {
    return '本周生产需要处理：部分镜头还缺视频素材，预览如下。\n\n先补充视频素材。原任务会保留。';
  }
  if (content.startsWith('本周计划还没有开始。')
    && /计划引用的(?:企业)?资料版本与已确认|本周计划引用的企业资料与当前已确认资料不一致/u.test(content)) {
    return '本周计划还没有开始。\n\n你更新了企业资料，这份计划还没同步到最新内容。\n\n点击“同步周计划”，我会更新这份计划供你重新确认；不会自动开始生产。';
  }
  if (/^本周计划已保存，但还没有进入生产。当前需要补齐 \d+ 项条件。第一步，参考视频需要人物口播。/u.test(content)) {
    return '本周计划还没有开始。\n\n当前需要处理：可用的数字人物与声音。\n\n先录入数字人物与声音。';
  }
  return content;
}

/** Convert structured preflight evidence into one actionable conversational step. */
export function weeklyReadinessGuidance(error: unknown): string | null {
  if (error instanceof DigitalEmployeeApiError && error.code === 'weekly_image_production_not_connected') {
    const count = Number(error.details.imageSlotIds && Array.isArray(error.details.imageSlotIds)
      ? error.details.imageSlotIds.length : 0);
    return `本周计划里有 ${count > 0 ? count : '几'} 张图片安排，但当前还不能从周计划自动开始制图。我已保留计划草稿，没有启动生产，也没有产生图片制作费用。若要先做图片，可以在内容创作中逐条创建图片任务。`;
  }
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
  if (!blockers.length) return '本周计划还没有开始。\n\n制作资料仍需核对。请先确认主推产品和素材。';
  const codes = new Set(blockers.map(item => item.code));
  let next: string;
  if (codes.has('production_preferences_missing')) next = '先确认制作偏好。';
  else if (codes.has('enterprise_facts_mismatch')) next = '先同步周计划。';
  else if (codes.has('company_profile_missing') || codes.has('brand_profile_missing')) next = '先补齐企业与品牌资料。';
  else if (codes.has('product_facts_missing')) next = '先补齐主推产品资料和图片。';
  else if (codes.has('public_contact_missing') || codes.has('primary_cta_missing')) next = '先填写对外联系方式。';
  else if (codes.has('presenter_missing') || codes.has('voice_missing')) next = '先录入数字人物与声音。';
  else if (codes.has('local_material_missing')) next = '先补充视频素材。';
  else next = '请先核对生产资料和素材授权。';
  const currentGap = codes.has('production_preferences_missing') ? '成片语言和画幅'
    : codes.has('enterprise_facts_mismatch') ? '周计划同步到最新企业资料'
      : codes.has('company_profile_missing') || codes.has('brand_profile_missing') ? '企业与品牌资料'
      : codes.has('product_facts_missing') ? '主推产品资料和图片'
        : codes.has('public_contact_missing') || codes.has('primary_cta_missing') ? '对外联系方式和行动引导'
          : codes.has('presenter_missing') || codes.has('voice_missing') ? '可用的数字人物与声音'
            : codes.has('local_material_missing') ? '对应镜头的视频素材' : '制作资料';
  if (codes.has('local_material_missing') && currentGap === '对应镜头的视频素材') {
    const count = structured && Array.isArray(error.details.materialGaps) ? error.details.materialGaps.length : null;
    return `本周计划还没有开始。\n\n有 ${count || '待核对'} 个镜头还缺可用实拍，预览如下。\n\n${next}`;
  }
  return `本周计划还没有开始。\n\n当前需要处理：${currentGap}。\n\n${next}`;
}

export function showWeeklyReadinessGuidance(error: unknown): boolean {
  if (typeof window === 'undefined') return false;
  const assistantText = weeklyReadinessGuidance(error);
  if (!assistantText) return false;
  window.dispatchEvent(new CustomEvent('lingshu-assistant-open', { detail: { assistantText } }));
  return true;
}
