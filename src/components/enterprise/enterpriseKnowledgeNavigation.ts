export type KnowledgeView = 'company' | 'brand' | 'credentials' | 'products' | 'bizRules' | 'cooperation' | 'boundaries' | 'market' | 'buyers' | 'faq' | 'salesStyle' | 'learning' | 'advanced' | 'presenters' | 'presenterRouting' | 'materials';
export type EnterpriseArea = 'facts' | 'products' | 'service' | 'market' | 'experience' | 'appearance' | 'settings';
export const KNOWLEDGE_AREAS = [
  { key: 'facts', label: '企业与品牌', description: '确认企业身份、品牌表达和能力依据。' },
  { key: 'appearance', label: '数字人', description: '录入和管理数字人物、声音及出镜设置。' },
  { key: 'products', label: '产品目录', description: '一款产品一份档案，事实、合作条件与素材统一关联。' },
  { key: 'service', label: '合作与服务', description: '维护公司通用政策，产品特殊条件在产品档案中补充。' },
  { key: 'market', label: '市场与客户', description: '维护长期服务市场和买家画像，本期经营目标留在任务中。' },
  { key: 'experience', label: '经验与问答', description: '从实际工作中沉淀答案和偏好，待确认推断不作为企业事实。' },
] as const;
export const KNOWLEDGE_VIEWS: Record<EnterpriseArea, Array<{ id: KnowledgeView; label: string }>> = {
  facts: [{ id: 'company', label: '企业档案' }, { id: 'brand', label: '品牌表达' }, { id: 'credentials', label: '能力与资质' }],
  products: [{ id: 'products', label: '全部产品' }],
  service: [{ id: 'cooperation', label: '合作方式' }, { id: 'bizRules', label: '交易与交付' }, { id: 'boundaries', label: '对外答复边界' }],
  market: [{ id: 'market', label: '目标市场' }, { id: 'buyers', label: '买家画像' }],
  experience: [{ id: 'faq', label: '常见问答' }, { id: 'salesStyle', label: '沟通偏好' }, { id: 'learning', label: '经营经验' }],
  appearance: [{ id: 'presenters', label: '已有出镜资产' }],
  settings: [{ id: 'advanced', label: '客服执行设置' }],
};
export function enterpriseAreaForView(view: KnowledgeView): EnterpriseArea {
  if (view === 'products' || view === 'materials') return 'products';
  if (view === 'presenters' || view === 'presenterRouting') return 'appearance';
  if (view === 'advanced') return 'settings';
  if (['cooperation', 'bizRules', 'boundaries'].includes(view)) return 'service';
  if (['market', 'buyers'].includes(view)) return 'market';
  if (['faq', 'salesStyle', 'learning'].includes(view)) return 'experience';
  return 'facts';
}
export function normalizeKnowledgeView(value: string | null): KnowledgeView {
  if (value === 'materials') return 'products';
  if (value === 'presenterRouting') return 'presenters';
  if (value === 'socialStrategy' || value === 'language-settings') return 'market';
  return Object.values(KNOWLEDGE_VIEWS).flat().find(item => item.id === value)?.id || 'company';
}
