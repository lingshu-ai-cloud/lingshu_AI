export const LEGACY_PRODUCT_POINT_PRICE_BOOK_VERSION = 'product-points.2026-10-20.v1';
export const PRODUCT_POINT_PRICE_BOOK_VERSION = 'product-points.2026-10-31.v2';
export const CUSTOMER_PRODUCT_POINT_SCALE = 100;

export type PointRateUnit = 'second' | 'action' | 'item' | 'conversation' | 'document';
export type ProductPointSection =
  | 'business_operations'
  | 'insight_planning'
  | 'content_production'
  | 'traffic_growth'
  | 'customer_service'
  | 'knowledge_assistant';

export type ProductPointSectionDefinition = {
  id: ProductPointSection;
  label: string;
  description: string;
  chargeState: 'active' | 'not_metered';
};

export type ProductPointRate = {
  id: string;
  section: ProductPointSection;
  feature: string;
  description: string;
  unit: PointRateUnit;
  points: number;
  estimated?: boolean;
  current?: boolean;
  billingMode?: 'metered' | 'plan_included' | 'free';
  note: string;
};

export const PRODUCT_POINT_SECTIONS: readonly ProductPointSectionDefinition[] = Object.freeze([
  {
    id: 'business_operations', label: '智能经营', chargeState: 'active',
    description: '按周计划、经营诊断、复盘报告等可交付经营结果结算。',
  },
  {
    id: 'insight_planning', label: '灵感与策划', chargeState: 'active',
    description: '按爆款分析、竞品洞察和选题策划等分析结果结算。',
  },
  {
    id: 'content_production', label: '内容制作', chargeState: 'active',
    description: '按脚本分镜、素材复用、数字人、AI 补镜和统一音色等交付结果结算。',
  },
  {
    id: 'traffic_growth', label: '投流增长', chargeState: 'active',
    description: '按投流方案、投放复盘和优化建议等经营动作结算。',
  },
  {
    id: 'customer_service', label: '客服承接', chargeState: 'active',
    description: '按询盘理解、回复草稿和跟进建议等客户工作结果结算。',
  },
  {
    id: 'knowledge_assistant', label: '知识与助手', chargeState: 'active',
    description: '按知识结构化、知识问答和灵小枢决策建议等结果结算。',
  },
]);

export function pointsForSeconds(rate: Pick<ProductPointRate, 'unit' | 'points'>, seconds: number): number {
  if (rate.unit !== 'second' || !Number.isFinite(seconds) || seconds < 0) throw new Error('invalid_points_duration');
  return pointsForQuantity(rate, seconds);
}

export function pointsForQuantity(rate: Pick<ProductPointRate, 'points'>, quantity: number): number {
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error('invalid_points_quantity');
  if (rate.points === 0 || quantity === 0) return 0;
  return Math.ceil((rate.points * quantity) - Number.EPSILON);
}

/**
 * Customer-facing price book. A product feature keeps the same visible price
 * even when the internal provider, model or route changes.
 */
export const PRODUCT_FEATURE_POINT_RATES: readonly ProductPointRate[] = Object.freeze([
  {
    id: 'weekly-operating-plan', section: 'business_operations', feature: '生成周经营计划',
    description: '结合目标、企业资料与历史执行生成本周经营任务',
    unit: 'action', points: 3_000, estimated: true, current: true, billingMode: 'plan_included', note: '按成功生成并保存的一份周经营计划结算；套餐内固定周任务只记录、不另扣加油包。',
  },
  {
    id: 'business-diagnosis', section: 'business_operations', feature: '经营诊断与下一步建议',
    description: '基于可核验经营数据生成诊断与行动建议',
    unit: 'action', points: 1_200, estimated: true, current: true, note: '按成功返回的一次完整诊断结算；无有效数据时不发起也不结算。',
  },
  {
    id: 'weekly-business-review', section: 'business_operations', feature: '生成周经营复盘',
    description: '汇总本周任务、内容、发布与客户结果形成复盘',
    unit: 'action', points: 1_800, estimated: true, current: true, billingMode: 'plan_included', note: '按成功生成并保存的一份周复盘结算。',
  },
  {
    id: 'reference-video-analysis', section: 'insight_planning', feature: '爆款视频深度分析',
    description: '分析参考视频的结构、镜头、口播与复刻要点',
    unit: 'item', points: 1_200, estimated: true, current: true, note: '按形成可复用完整分析的一条参考内容结算；读取已有分析不重复结算。',
  },
  {
    id: 'competitor-insight', section: 'insight_planning', feature: '竞品内容洞察',
    description: '提炼竞品内容方向、差异点与可执行机会',
    unit: 'item', points: 800, estimated: true, current: true, note: '按成功生成的一条竞品洞察结算。',
  },
  {
    id: 'topic-script-planning', section: 'insight_planning', feature: '选题策划建议',
    description: '把经营目标与内容证据转成可执行选题建议',
    unit: 'item', points: 1_000, estimated: true, current: true, note: '按成功交付的一条完整选题建议结算。',
  },
  {
    id: 'script-storyboard-generation', section: 'content_production', feature: '脚本与分镜生成',
    description: '根据已确认选题生成脚本、分镜与拍摄指令',
    unit: 'item', points: 1_500, estimated: true, current: true, note: '按成功交付的一版可审核脚本与分镜结算；内部校对和结构修复不重复结算。',
  },
  {
    id: 'material-library-reuse', section: 'content_production', feature: '素材库视频复用',
    description: '产品、工厂与场景素材的检索、裁切和编排',
    unit: 'second', points: 0, current: true, billingMode: 'free', note: '复用已入库视频，不产生视频生成积分。',
  },
  {
    id: 'digital-human-video', section: 'content_production', feature: '数字人口播视频',
    description: '本人数字人与背景合成并生成口播画面',
    unit: 'second', points: 5_400, current: true, note: '按成功交付的数字人画面实际秒数结算。',
  },
  {
    id: 'aigc-video-generation', section: 'content_production', feature: 'AI 视频补镜',
    description: '素材库无法覆盖时生成补充镜头',
    unit: 'second', points: 8_000, estimated: true, current: true, note: '生成前按目标秒数预留，按成功交付的可用画面秒数结算。',
  },
  {
    id: 'voice-consistency', section: 'content_production', feature: '统一口播音色',
    description: '为非数字人镜头生成同一人物的口播音轨',
    unit: 'second', points: 200, current: true, note: '仅在独立生成口播音轨时按成功音频秒数结算。',
  },
  {
    id: 'digital-human-enrollment', section: 'content_production', feature: '创建本人数字人',
    description: '录入并创建可用于生产的本人形象',
    unit: 'action', points: 142_400, current: true, note: '人物成功创建并可用后结算一次；失败或未受理不扣积分。',
  },
  {
    id: 'photo-avatar-enrollment', section: 'content_production', feature: '创建图片数字人',
    description: '由授权照片创建可用人物形象',
    unit: 'action', points: 88_300, current: true, note: '人物成功创建并可用后结算一次；失败或未受理不扣积分。',
  },
  {
    id: 'ad-plan-generation', section: 'traffic_growth', feature: '投流方案生成',
    description: '根据内容目标、受众与预算生成可执行投流方案',
    unit: 'action', points: 1_200, estimated: true, current: true, note: '按成功生成并保存的一份投流方案结算；仅编辑已有方案不重复结算。',
  },
  {
    id: 'ad-optimization-insight', section: 'traffic_growth', feature: '投放复盘与优化建议',
    description: '依据真实投放回执生成诊断和下一轮调整建议',
    unit: 'action', points: 800, estimated: true, current: true, note: '按成功返回的一次完整优化建议结算；无真实投放数据时不结算。',
  },
  {
    id: 'customer-intent-analysis', section: 'customer_service', feature: '询盘意图分析',
    description: '识别客户需求、采购阶段、风险与待补信息',
    unit: 'conversation', points: 200, estimated: true, current: true, note: '按一次会话新增内容形成的有效意图分析结算；重复查看不结算。',
  },
  {
    id: 'reply-draft-generation', section: 'customer_service', feature: '客户回复草稿',
    description: '结合企业知识和会话上下文生成待确认回复',
    unit: 'conversation', points: 300, estimated: true, current: true, note: '按成功生成的一轮回复草稿结算；人工修改与确认不另扣积分。',
  },
  {
    id: 'customer-follow-up-suggestion', section: 'customer_service', feature: '客户跟进建议',
    description: '生成下一步跟进动作、待确认问题与销售协同建议',
    unit: 'item', points: 300, estimated: true, current: true, note: '按成功生成的一条可执行跟进建议结算。',
  },
  {
    id: 'knowledge-document-structuring', section: 'knowledge_assistant', feature: '知识资料结构化',
    description: '从企业资料中提取产品事实、FAQ 与可引用知识',
    unit: 'document', points: 1_000, estimated: true, current: true, note: '按成功处理并形成可审核知识的一份文档结算；同一版本重复读取不结算。',
  },
  {
    id: 'knowledge-grounded-answer', section: 'knowledge_assistant', feature: '企业知识问答',
    description: '基于已入库企业知识生成带事实约束的回答',
    unit: 'conversation', points: 200, estimated: true, current: true, note: '按成功返回的一轮有效回答结算；纯检索和打开原文不结算。',
  },
  {
    id: 'assistant-decision-proposal', section: 'knowledge_assistant', feature: '灵小枢决策建议',
    description: '结合当前业务对象生成可审批的判断与操作建议',
    unit: 'action', points: 400, estimated: true, current: true, note: '按成功返回的一项完整建议结算；执行前预览、内部路由与重试不重复结算。',
  },
]);

export const CURRENT_PRODUCT_POINT_RATES = Object.freeze(
  PRODUCT_FEATURE_POINT_RATES.filter(rate => rate.current),
);

export function productPointRate(
  id: string,
  priceBookVersion: string = PRODUCT_POINT_PRICE_BOOK_VERSION,
): ProductPointRate {
  const rate = PRODUCT_FEATURE_POINT_RATES.find(item => item.id === id);
  if (!rate) throw new Error('points_rate_not_found');
  if (priceBookVersion === PRODUCT_POINT_PRICE_BOOK_VERSION) return rate;
  if (priceBookVersion === LEGACY_PRODUCT_POINT_PRICE_BOOK_VERSION) {
    return { ...rate, points: rate.points / CUSTOMER_PRODUCT_POINT_SCALE };
  }
  throw new Error('points_price_book_not_supported');
}
