import { Plus, Trash2 } from 'lucide-react';
import { defaultDirectorPlan, type ContentDirectorPlan, type DirectorProgressItem } from '../lib/contentDirector';

const field = 'ui-field mt-1 w-full !min-h-9 !rounded-md !px-3 !py-2 !text-sm';
const statuses: Array<[DirectorProgressItem['status'], string]> = [['collecting', '采集中'], ['candidate', '候选'], ['script_draft', '脚本草稿'], ['script_approved', '脚本已确认'], ['in_production', '制作中'], ['review', '编导审片'], ['approved', '已通过'], ['blocked', '有阻塞']];

export default function ContentDirectorEditor({ value, onChange }: { value?: ContentDirectorPlan; onChange: (value: ContentDirectorPlan) => void }) {
  const plan = value || defaultDirectorPlan();
  const patch = (next: Partial<ContentDirectorPlan>) => onChange({ ...plan, ...next });
  const update = (id: string, next: Partial<DirectorProgressItem>) => patch({ progress: plan.progress.map(item => item.id === id ? { ...item, ...next, updatedAt: new Date().toISOString() } : item) });
  const remaining = Math.max(0, plan.productionBudget - plan.productionSpent - plan.productionReserved);
  return <div className="space-y-6">
    <section className="rounded-lg border border-border p-4"><h3 className="font-semibold text-text-primary">预算与产出目标</h3><p className="mt-1 text-xs text-text-muted">经营 Agent 划分生产与投流额度；编导和内容制作共用生产额度。</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-semibold text-text-secondary">币种<select className={field} value={plan.currency} onChange={e => patch({ currency: e.target.value as ContentDirectorPlan['currency'] })}><option>CNY</option><option>USD</option></select></label>
        <label className="text-xs font-semibold text-text-secondary">内容生产预算<input className={field} type="number" min="0" step="0.01" value={plan.productionBudget} onChange={e => patch({ productionBudget: Number(e.target.value) })}/></label>
        <label className="text-xs font-semibold text-text-secondary">投流预算<input className={field} type="number" min="0" step="0.01" value={plan.paidMediaBudget} onChange={e => patch({ paidMediaBudget: Number(e.target.value) })}/></label>
        <label className="text-xs font-semibold text-text-secondary">生产已用<input className={field} type="number" min="0" step="0.01" value={plan.productionSpent} onChange={e => patch({ productionSpent: Number(e.target.value) })}/></label>
        <label className="text-xs font-semibold text-text-secondary">执行中预占<input className={field} type="number" min="0" step="0.01" value={plan.productionReserved} onChange={e => patch({ productionReserved: Number(e.target.value) })}/></label>
        <div className="rounded-md bg-surface-2 px-3 py-2 text-xs text-text-secondary"><span className="block font-semibold">剩余可分配</span><strong className="mt-2 block text-base text-accent">{plan.currency} {remaining.toLocaleString()}</strong></div>
        <label className="text-xs font-semibold text-text-secondary">原创内容目标<input className={field} type="number" min="0" max="100" value={plan.originalTarget} onChange={e => patch({ originalTarget: Number(e.target.value) })}/></label>
        <label className="text-xs font-semibold text-text-secondary">平台版本目标<input className={field} type="number" min="0" max="100" value={plan.platformVersionTarget} onChange={e => patch({ platformVersionTarget: Number(e.target.value) })}/></label>
        <label className="text-xs font-semibold text-text-secondary">成功发布目标<input className={field} type="number" min="0" max="100" value={plan.publishTarget} onChange={e => patch({ publishTarget: Number(e.target.value) })}/></label>
      </div>
    </section>
    <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-text-secondary">采集与选题要求<textarea className={field} rows={4} value={plan.collectionBrief} onChange={e => patch({ collectionBrief: e.target.value })}/></label><label className="text-sm font-semibold text-text-secondary">脚本与成片质量标准<textarea className={field} rows={4} value={plan.qualityStandard} onChange={e => patch({ qualityStandard: e.target.value })}/></label></div>
    <section><div className="flex items-center justify-between"><div><h3 className="font-semibold text-text-primary">编导与生产过程</h3><p className="mt-1 text-xs text-text-muted">记录可审阅的依据、结果和下一步。</p></div><button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-accent" onClick={() => patch({ progress: [...plan.progress, { id: crypto.randomUUID(), title: '', status: 'candidate', result: '', nextStep: '', owner: 'director', updatedAt: new Date().toISOString(), estimatedCost: 0, actualCost: 0 }] })}><Plus size={15}/>添加记录</button></div>
      <div className="mt-3 space-y-3">{plan.progress.map(item => <div key={item.id} className="rounded-lg border border-border p-4"><div className="grid gap-3 sm:grid-cols-[1fr_150px_130px_auto]">
        <label className="text-xs text-text-secondary">事项<input className={field} value={item.title} placeholder="例如：筛选美国设备采购热点" onChange={e => update(item.id, { title: e.target.value })}/></label>
        <label className="text-xs text-text-secondary">状态<select className={field} value={item.status} onChange={e => update(item.id, { status: e.target.value as DirectorProgressItem['status'] })}>{statuses.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="text-xs text-text-secondary">处理方<select className={field} value={item.owner} onChange={e => update(item.id, { owner: e.target.value as DirectorProgressItem['owner'] })}><option value="director">编导 Agent</option><option value="content">内容 Agent</option><option value="team">团队成员</option></select></label>
        <button type="button" aria-label="删除过程记录" className="self-end rounded-md p-2 text-red hover:bg-surface-2" onClick={() => patch({ progress: plan.progress.filter(row => row.id !== item.id) })}><Trash2 size={15}/></button></div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs text-text-secondary">已产生结果<textarea className={field} rows={2} value={item.result} onChange={e => update(item.id, { result: e.target.value })}/></label><label className="text-xs text-text-secondary">下一步与阻塞<textarea className={field} rows={2} value={item.nextStep} onChange={e => update(item.id, { nextStep: e.target.value })}/></label></div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs text-text-secondary">预计费用<input className={field} type="number" min="0" step="0.01" value={item.estimatedCost} onChange={e => update(item.id, { estimatedCost: Number(e.target.value) })}/></label><label className="text-xs text-text-secondary">实际费用<input className={field} type="number" min="0" step="0.01" value={item.actualCost} onChange={e => update(item.id, { actualCost: Number(e.target.value) })}/></label></div>
      </div>)}{!plan.progress.length && <p className="mt-3 rounded-lg bg-surface-2 p-4 text-sm text-text-muted">执行后，采集结果、候选选题、脚本版本、制作和审片进度会持续出现。</p>}</div>
    </section>
  </div>;
}
