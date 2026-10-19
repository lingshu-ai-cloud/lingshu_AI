import type { EnterpriseProfile } from '../routes/enterprise.js';
import type { WeeklyExecutionTask } from '../../shared/contracts/socialProgram.js';

export interface WeeklyTaskRequirement {
  code: string;
  label: string;
  impact: string;
  action: 'enterprise_company' | 'enterprise_products';
  sourceVersion: string | null;
  diagnosticOnly: true;
}

/** Read-model advice, never an execution gate or a manufactured blocking reason. */
export function weeklyTaskRequirements(task: WeeklyExecutionTask, profile: EnterpriseProfile | null): WeeklyTaskRequirement[] {
  if (!profile || ['succeeded', 'cancelled'].includes(task.status)) return [];
  const step = task.schedule.stepKind;
  const requirements: WeeklyTaskRequirement[] = [];
  const sourceVersion = profile.factVersion?.id ?? null;
  const add = (code: string, label: string, impact: string, action: WeeklyTaskRequirement['action']) => requirements.push({ code, label, impact, action, sourceVersion, diagnosticOnly: true });
  const incomplete = (value: unknown) => !String(value ?? '').trim() || /^(1|待确认|待在实际任务中确认|未填写)$/.test(String(value).trim());
  // A company identity/market is needed when adopting a business proposition or
  // drafting external copy, not to crawl existing product/industry keywords.
  if (['business_schedule', 'script', 'storyboard', 'publishing'].includes(step)) {
    if (incomplete(profile.company?.name) || incomplete(profile.brand?.name)) {
      add('business_identity_incomplete', '企业或品牌名称仍为空或占位值，请补充真实名称', '用于本节点的企业身份和对外文案；不阻止无关的产品词采集、评分或客服 Mock。', 'enterprise_company');
    }
    if (incomplete(profile.strategy?.focusMarkets) && incomplete(profile.company?.mainMarkets)) {
      add('target_market_incomplete', '目标市场尚未明确，请补充本内容面向的市场', '影响选题、语言与市场适配；不将资料诊断当作整周执行门禁。', 'enterprise_company');
    }
  }
  if (['material_preparation', 'material_readiness'].includes(step)) {
    const products = profile.products?.items ?? [];
    const hasLocalMedia = products.some(p => [p.images, p.videos, p.factoryImages, p.packagingImages, p.sceneImages].some(list => Array.isArray(list) && list.length > 0));
    if (products.length > 0 && !hasLocalMedia) {
      add('local_product_media_not_registered', '已有产品文字资料，但货盘尚未登记本地图片或视频', '本节点若采用本地匹配，需补对应产品/工厂/D2C素材及可用权利；不代表生成路线也不可用，不阻塞采集。', 'enterprise_products');
    }
  }
  // Rights are never inferred from a file merely being present. Only surface a
  // rights action when this exact node already has an authoritative rights gap.
  if (['material_preparation', 'material_readiness', 'asset_generation', 'video_generation', 'publishing'].includes(step)
    && task.ownBlockingReasons.some(code => /rights|license|consent/.test(code))) {
    add('current_material_rights_required', '补充本步骤所用素材的来源与使用权证明', '只影响当前素材或发布分支；上传文件不等于已获得商用、人物或发布许可。', 'enterprise_products');
  }
  return requirements;
}
