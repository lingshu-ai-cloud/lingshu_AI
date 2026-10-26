import { useState } from 'react';
import { Button, Drawer, Empty, Tag } from 'antd';
import { ArrowRight, FileText } from 'lucide-react';
import type { Profile } from './enterpriseProfileTypes';
import type { KnowledgeView } from './enterpriseKnowledgeNavigation';

export function knowledgeReviewItems(profile: Profile): Array<{ id: string; title: string; description: string; view: KnowledgeView }> {
  const items: Array<{ id: string; title: string; description: string; view: KnowledgeView }> = [];
  if (!profile.company.name.trim() || !profile.company.industry.trim() || !profile.company.companyType?.trim()) items.push({ id: 'company', title: '补充基础企业身份', description: '企业名称、行业与企业类型，用于识别企业。', view: 'company' });
  if (!(profile.products.items || []).some(p => p.name.trim())) items.push({ id: 'products', title: '建立第一款产品档案', description: '先确认产品名称与用途，价格和证明按任务需要补充。', view: 'products' });
  const pendingFaq = (profile.faq || []).filter(f => f.question.trim() && !f.approvedForAuto);
  if (pendingFaq.length) items.push({ id: 'faq', title: `${pendingFaq.length} 条问答尚未批准用于自动答复`, description: '逐条核对答案；批准问答不会自动开启客服回复。', view: 'faq' });
  if (profile.agentLearning?.pendingAssumptions?.trim()) items.push({ id: 'assumptions', title: '有待确认的经营推断', description: '查看原记录与依据，再决定是否采用。', view: 'learning' });
  return items;
}
export default function EnterpriseKnowledgeSummary({ profile, onOpen }: { profile: Profile; onOpen: (view: KnowledgeView) => void }) {
  const [open, setOpen] = useState(false);
  const items = knowledgeReviewItems(profile);
  const products = (profile.products.items || []).filter(p => p.name.trim());
  const hasIdentity = Boolean(profile.company.name.trim() && profile.company.industry.trim());
  const savedAt = profile.factVersion?.confirmedAt;
  const hasSavedDate = Boolean(savedAt && Date.parse(savedAt) > 0 && hasIdentity);
  return <>
    <section className="rounded-xl border border-border bg-white px-5 py-4" aria-label="知识资料与待处理">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><div className="flex items-center gap-2"><FileText size={17} className="text-accent"/><h2 className="text-sm font-semibold">企业共享资料</h2><Tag bordered={false}>{products.length} 款产品</Tag></div>
          <p className="mt-2 text-xs leading-5 text-text-secondary">{hasSavedDate ? `最近确认 ${new Date(savedAt || 0).toLocaleDateString('zh-CN')} · ` : ''}新手先建基础档案，任务需要时补充，使用后沉淀经验。</p></div>
        <Button onClick={() => setOpen(true)}>待处理{items.length ? ` · ${items.length}` : ''}<ArrowRight size={13}/></Button>
      </div>
      <div className="mt-4 grid gap-3 border-t border-border pt-4 md:grid-cols-3">
        <div><p className="text-xs font-medium">01　基础建档</p><p className="mt-1 text-xs text-text-muted">{hasIdentity && products.length ? '已填写企业与产品基础资料' : '先确认企业身份和第一款产品'}</p></div>
        <div><p className="text-xs font-medium">02　任务补充</p><p className="mt-1 text-xs text-text-muted">图片、价格、证书与出镜资产按实际任务收集</p></div>
        <div><p className="text-xs font-medium">03　使用中沉淀</p><p className="mt-1 text-xs text-text-muted">问答、表达偏好和经营经验逐步积累</p></div>
      </div>
    </section>
    <Drawer title="资料待处理" open={open} onClose={() => setOpen(false)} width={440}>
      <p className="mb-5 text-xs leading-5 text-text-secondary">这里汇总知识库内可核对的资料；具体任务的阻塞仍在原任务中处理。</p>
      {items.length ? <div className="space-y-3">{items.map(item => <button key={item.id} className="block w-full rounded-lg border border-border p-4 text-left hover:bg-surface-2" onClick={() => { onOpen(item.view); setOpen(false); }}><span className="flex items-center justify-between gap-3 text-sm font-medium">{item.title}<ArrowRight size={14}/></span><span className="mt-2 block text-xs leading-5 text-text-secondary">{item.description}</span></button>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有需要核对的基础资料或候选记录"/>}
      <p className="mt-5 text-xs leading-5 text-text-muted">价格、证书与数字人不要求首次全部录入。缺少当前任务所需信息时，再向你确认。</p>
    </Drawer>
  </>;
}
