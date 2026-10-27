import { Button, Drawer, Progress, Tag } from 'antd';
import { ArrowUpRight, Clapperboard, Headphones, Megaphone, Sparkles, UserRound } from 'lucide-react';
import { useState } from 'react';

type WorkItem = {
  id: string; title: string; state: string; next: string; image?: string;
  detail: string; facts: Array<[string, string]>; progress?: { label: string; percent: number };
  customer?: { name: string; lastContact: string; maintained: string };
};

const groups: Array<{ title: string; Icon: typeof Clapperboard; kind: 'content' | 'traffic' | 'customer'; items: WorkItem[] }> = [
  { title: '内容创作', Icon: Clapperboard, kind: 'content', items: [
    { id: 'texture', title: '泡沫卸妆质地测试', state: '待验收', next: '核对成片画面与产品卖点', image: '/demo/feishu-viral-remix-final.jpg', detail: '首帧突出泡沫质地与卸妆前后对比；验收后再进入发布排期。', facts: [['内容规格', '30 秒 · 竖屏'], ['当前节点', '成片验收'], ['计划平台', 'TikTok / Instagram']] },
    { id: 'factory', title: '工厂灌装过程讲解', state: '制作中', next: '完成旁白与镜头合成', image: '/demo/thumbs/7655440791376039182.jpg', detail: '展示灌装、抽检和成品包装三个生产节点，突出供应链透明度。', facts: [['内容规格', '45 秒 · 竖屏'], ['当前节点', '旁白与镜头合成'], ['计划平台', 'Facebook / YouTube']] },
  ] },
  { title: '智能投流', Icon: Megaphone, kind: 'traffic', items: [
    { id: 'meta', title: '品牌采购线索 · Meta', state: '观察中', next: '对比高意向人群点击', image: '/demo/thumbs/7654680467647630605.jpg', detail: '当前重点比较采购意向人群和包装定制兴趣人群，建议先保留高意向组合。', facts: [['曝光', '118,000'], ['点击', '3,260'], ['点击率', '2.76%'], ['消耗', '¥740'], ['询盘', '17']], progress: { label: '观察期第 4 / 7 天', percent: 57 } },
    { id: 'tiktok', title: '产品测试线索 · TikTok', state: '待优化', next: '复核质地类素材组合', image: '/demo/thumbs/7655426562682014989.jpg', detail: '质地特写素材点击较集中，可比较开头 3 秒的两版画面。', facts: [['曝光', '166,000'], ['点击', '3,580'], ['点击率', '2.16%'], ['消耗', '¥940'], ['询盘', '21']], progress: { label: '观察期第 5 / 7 天', percent: 71 } },
  ] },
  { title: '智能客服', Icon: Headphones, kind: 'customer', items: [
    { id: 'avery', title: '北美品牌采购询价', state: '待跟进', next: '核对 MOQ 与报价条件', detail: '客户关注卸妆产品的起订量、交付周期与北美市场包装要求。', customer: { name: 'Avery Chen · Glow North', lastContact: '42 分钟前', maintained: '已维护 3 天' }, facts: [['客户阶段', '已识别采购意向'], ['来源', 'Meta 广告咨询'], ['最近联系', '42 分钟前'], ['维护时长', '3 天'], ['待确认', 'MOQ 与阶梯报价']] },
    { id: 'mia', title: '包装打样咨询', state: '承接中', next: '补充材质与交期说明', detail: '客户正在比较两种包装材质，下一步提供打样周期与起订要求。', customer: { name: 'Mia Rivera · Studio Belle', lastContact: '2 小时前', maintained: '已维护 6 天' }, facts: [['客户阶段', '方案沟通中'], ['来源', 'Instagram 私信'], ['最近联系', '2 小时前'], ['维护时长', '6 天'], ['待确认', '包装材质与打样交期']] },
  ] },
];

export function BusinessOverviewSampleInterpretation() {
  const [open, setOpen] = useState(false);
  return <section className="rounded-xl border border-border bg-surface-2 p-4" aria-label="经营解读">
    <div className="flex flex-wrap items-center gap-2"><Sparkles size={17} className="text-accent" aria-hidden="true"/><h3 className="text-sm font-semibold text-text-primary">经营解读</h3><Tag color="processing">界面预览</Tag></div>
    <p className="mt-2 text-sm leading-6 text-text-primary">近 7 日播放 21.58 万、互动 1.87 万；客户进线 126 位，其中 43 位已报价、9 位已成交。</p>
    <p className="mt-1 text-sm leading-6 text-text-secondary">优先验收质地测试内容，继续比较工厂过程与包装打样两个方向的询盘承接。</p>
    <Button type="link" size="small" className="!mt-2 !px-0" onClick={() => setOpen(true)}>查看分析依据</Button>
    <Drawer open={open} onClose={() => setOpen(false)} title="经营解读依据" width={420} destroyOnHidden>
      <Tag color="processing">界面预览</Tag>
      <p className="mt-3 text-sm leading-6 text-text-secondary">对比内容传播与客户承接两组指标，作为下一步验收和素材测试的参考。</p>
      <dl className="mt-4 divide-y divide-border rounded-xl border border-border px-4">{([['近 7 日播放', '215,800 次'], ['近 7 日互动', '18,746 次'], ['客户进线', '126 位'], ['已报价', '43 位'], ['已成交', '9 位']] as Array<[string, string]>).map(([label, value]) => <div key={label} className="flex justify-between gap-4 py-3 text-sm"><dt className="text-text-secondary">{label}</dt><dd className="font-medium text-text-primary">{value}</dd></div>)}</dl>
    </Drawer>
  </section>;
}

export default function BusinessOverviewSampleWork() {
  const [selected, setSelected] = useState<WorkItem | null>(null);
  return <div className="grid gap-4 lg:grid-cols-3" aria-label="数字员工工作布局预览">
    {groups.map(({ title, Icon, kind, items }) => <section key={title} className="min-w-0 rounded-2xl border border-border bg-surface p-4" aria-label={`${title}工作布局`}>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Icon size={17} className="text-accent" aria-hidden="true"/>{title}<span className="ml-auto text-xs font-normal tabular-nums text-text-secondary">{items.length} 项</span></h3>
      <div className="mt-3 space-y-2">{items.map(item => <article key={item.id} className="min-w-0">
        <button type="button" aria-haspopup="dialog" aria-label={`查看${item.title}详情`} onClick={() => setSelected(item)} className="group w-full rounded-xl border border-border bg-surface-2 p-3 text-left outline-none transition-colors hover:border-accent/40 hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent">
          <div className="flex min-w-0 gap-3">
            {item.image ? <img className={`${kind === 'content' ? 'h-20 w-14' : 'h-16 w-16'} shrink-0 rounded-lg object-cover`} src={item.image} alt={`${item.title}预览图`} loading="lazy"/> : <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-50 text-accent"><UserRound size={22} aria-hidden="true"/></span>}
            <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><strong className="min-w-0 text-sm font-medium text-text-primary">{item.customer?.name || item.title}</strong><ArrowUpRight size={15} className="shrink-0 text-text-muted group-hover:text-accent" aria-hidden="true"/></div>
              {item.customer && <p className="mt-0.5 text-xs text-text-secondary">{item.title}</p>}
              <div className="mt-1 flex flex-wrap items-center gap-1.5"><Tag className="!m-0">{item.state}</Tag>{item.customer && <span className="text-xs text-text-muted">{item.customer.maintained} · 最近联系 {item.customer.lastContact}</span>}</div>
            </div>
          </div>
          {item.progress && <div className="mt-2"><div className="flex justify-between text-xs text-text-secondary"><span>{item.progress.label}</span><span>{item.progress.percent}%</span></div><Progress percent={item.progress.percent} size="small" showInfo={false} className="!mb-0"/></div>}
          {kind === 'traffic' && <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-text-secondary">{item.facts.slice(0, 3).map(([label, value]) => <span key={label}>{label} <strong className="text-text-primary">{value}</strong></span>)}</div>}
          <p className="mt-2 text-xs leading-5 text-text-secondary">下一步：{item.next}</p>
        </button>
      </article>)}</div>
    </section>)}
    <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.title} width={480} destroyOnHidden>
      {selected && <div className="space-y-4">
        <Tag color="processing">界面预览</Tag>
        {selected.image && <img src={selected.image} alt={`${selected.title}预览图`} className="max-h-64 w-full rounded-xl bg-surface-2 object-contain"/>}
        {selected.customer && <p className="text-base font-semibold text-text-primary">{selected.customer.name}</p>}
        <p className="text-sm leading-6 text-text-secondary">{selected.detail}</p>
        {selected.progress && <div><p className="mb-1 text-sm text-text-secondary">{selected.progress.label}</p><Progress percent={selected.progress.percent}/></div>}
        <dl className="divide-y divide-border rounded-xl border border-border px-4">{selected.facts.map(([label, value]) => <div key={label} className="flex justify-between gap-4 py-3 text-sm"><dt className="text-text-secondary">{label}</dt><dd className="text-right font-medium text-text-primary">{value}</dd></div>)}</dl>
        <p className="text-sm text-text-primary"><strong>下一步：</strong>{selected.next}</p>
      </div>}
    </Drawer>
  </div>;
}
