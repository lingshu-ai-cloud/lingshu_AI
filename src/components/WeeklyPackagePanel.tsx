import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Plus, X, ArrowRight, Trash2, Loader2, Pencil, LayoutGrid, ChartGantt } from 'lucide-react';
import { planConfigForDisplay, digitalEmployeeApi, type DigitalEmployeeOverview, type BusinessDestination, type DigitalEmployeeDeepLink } from '../lib/digitalEmployees';
import { TASK_TEMPLATES, maturityLabels, packageIssues, type WeeklyPackage, type PackageTask, type TemplateId } from '../lib/weeklyPackage';
import { normalizeVideoPlan, videoPlanErrors } from '../lib/videoCreationPlan';
import VideoPlanEditor from './VideoPlanEditor';
import WeeklyMatrixEditor from './WeeklyMatrixEditor';
import WeeklyExecutionNodes, { weeklyExecutionNodes } from './WeeklyExecutionNodes';
import WeeklyPackageGantt from './WeeklyPackageGantt';
import ContentDirectorEditor from './ContentDirectorEditor';
import { defaultDirectorPlan } from '../lib/contentDirector';

const field = 'ui-field w-full !min-h-10 !rounded-md !px-3 !py-2 !text-sm';
const secondary = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-border bg-white px-4 py-2 text-sm font-semibold text-text-secondary transition-colors hover:border-border-bright hover:bg-surface-2 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 disabled:opacity-40';
const primary = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 disabled:opacity-40';

function Drawer({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef(0);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    if (bodyRef.current) bodyRef.current.scrollTop = scrollTopRef.current;
    return () => { dialog.close(); previous?.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={ref} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }} className={`fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full ${wide ? 'max-w-[min(1180px,calc(100vw-40px))]' : 'max-w-2xl'} border-0 border-l border-border bg-white p-0 text-text-primary shadow-[0_16px_48px_rgba(23,61,49,.16)] backdrop:bg-[#173d31]/25`}>
    <div className="flex h-full flex-col"><header className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-6"><h2 className="text-lg font-bold">{title}</h2><button aria-label="关闭" onClick={onClose} className="rounded-md p-2 text-text-secondary hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"><X size={20}/></button></header><div ref={bodyRef} onScroll={e => { scrollTopRef.current = e.currentTarget.scrollTop; }} className="flex-1 overflow-y-auto p-5 sm:p-6">{children}</div></div>
  </dialog>;
}

export default function WeeklyPackagePanel({ data, readOnly, busy, onSave, onApprove, onOpen, onOpenNode, onTask, onLinkProject }: {
  data: DigitalEmployeeOverview; readOnly: boolean; busy: boolean;
  onSave: (pack: WeeklyPackage) => Promise<boolean>;
  onApprove: (revision: number) => Promise<void>;
  onOpen: (page: BusinessDestination, view?: "create" | "publish", businessRef?: Record<string, unknown>) => void;
  onOpenNode: (link: DigitalEmployeeDeepLink) => void;
  onTask: (taskId: string) => void;
  onLinkProject: (taskId: string, projectId: string) => Promise<void>;
}) {
  const saved = data.plan?.businessPackage;
  const [view, setView] = useState<'cards' | 'gantt'>(() => {
    try { return localStorage.getItem('lingshu:weekly-package-view') === 'gantt' ? 'gantt' : 'cards'; } catch { return 'cards'; }
  });
  const changeView = (next: 'cards' | 'gantt') => {
    setView(next);
    try { localStorage.setItem('lingshu:weekly-package-view', next); } catch { /* The toggle works without storage. */ }
  };
  const [drawer, setDrawer] = useState<'templates' | 'task' | 'confirm' | 'recommend' | 'matrix' | 'director' | null>(null);
  const [edit, setEdit] = useState<PackageTask | null>(null);
  const [pack, setPack] = useState<WeeklyPackage | null>(saved || null);
  const [options, setOptions] = useState<Awaited<ReturnType<typeof digitalEmployeeApi.packageOptions>>>({ members: [], projects: [], customers: [] });
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!drawer) setPack(saved || null); }, [saved, drawer]);
  useEffect(() => { let alive = true; digitalEmployeeApi.packageOptions().then(o => { if (alive) setOptions(o); }).catch(e => { if (alive) setError(e.message); }); return () => { alive = false; }; }, []);
  if (!saved || !pack || !data.goal || !data.config) return null;
  const goal = data.goal;
  const config = planConfigForDisplay(data.plan?.configSnapshot, data.config);
  const locked = readOnly || Boolean(data.run);
  const disabled = busy || saving;
  const issues = [...packageIssues(pack, goal.startsAt, goal.endsAt), ...pack.tasks.flatMap(t => (t.videoPlans || []).flatMap(videoPlanErrors))];
  const close = () => { if (!disabled) { setDrawer(null); setEdit(null); setError(''); } };
  const persist = async (next: WeeklyPackage) => {
    setSaving(true); setError('');
    try { const ok = await onSave(next); if (ok) { setPack(next); setDrawer(null); setEdit(null); } return ok; }
    catch (e) { setError(e instanceof Error ? e.message : '保存失败，请重试'); return false; }
    finally { setSaving(false); }
  };
  const create = (id: TemplateId) => {
    const template = TASK_TEMPLATES.find(t => t.id === id)!;
    setEdit({ templateId: id, title: template.title, ownerId: '', ownerName: '', dueAt: goal.endsAt, notes: query, sourceProjectIds: [], ...(id === 'production' ? { videoPlans: [normalizeVideoPlan({ ...config.videoDefaults, productName: config.focusProducts.split(/[、，,;]/)[0], theme: '介绍产品的用途与特点', platform: goal.contentPlatforms[0] })] } : {}) });
    setDrawer('task');
  };
  const openExecution = () => { setPack(structuredClone(saved)); setDrawer('confirm'); };
  const updateEdit = (patch: Partial<PackageTask>) => setEdit(t => t && ({ ...t, ...patch }));
  return <section className="section-panel p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold text-accent">{maturityLabels[saved.maturity]} · {saved.participation === 'team' ? '团队协作' : 'Agent 为主'}</p><h2 className="mt-2 text-xl font-bold text-text-primary">本周经营包</h2></div><div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="经营包视图" className="inline-flex gap-4 border-b border-border">{([{ value: 'cards', label: '卡片', icon: LayoutGrid }, { value: 'gantt', label: '甘特图', icon: ChartGantt }] as const).map(item => <button key={item.value} type="button" aria-pressed={view === item.value} onClick={() => changeView(item.value)} className={`inline-flex items-center gap-1.5 border-b-2 px-0.5 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 ${view === item.value ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary'}`}><item.icon size={14}/>{item.label}</button>)}</div>
      {!locked && <><button className={secondary} disabled={disabled} onClick={() => setDrawer('templates')}><Plus size={16}/>添加任务</button><button className={primary} disabled={disabled || !saved.tasks.length} onClick={openExecution}>执行任务<ArrowRight size={16}/></button></>}
    </div></div>
    {!locked && <p className="mt-3 border-l-2 border-accent bg-surface-2 px-3 py-2 text-sm text-text-secondary">任务包已选定，点击「执行任务」确认范围并启动；启动后可随时查看智能体执行进度。</p>}
    <div className="mb-4 mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted"><span>{weeklyExecutionNodes(data).length} 个节点</span><span>{goal.startsAt} — {goal.endsAt}</span>{saved.tasks.some(t => t.ownerId) && <span>{saved.tasks.filter(t => t.ownerId).length} 项成员负责</span>}</div>
    {!locked && <div className="mb-5 grid gap-3 sm:grid-cols-2"><label className="text-xs text-text-secondary">运营阶段<select className={`${field} mt-1`} value={saved.maturity} disabled={disabled} onChange={e => void persist({ ...saved, maturity: e.target.value as WeeklyPackage['maturity'] })}>{Object.entries(maturityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="text-xs text-text-secondary">协作偏好（具体负责人在任务中设置）<select className={`${field} mt-1`} value={saved.participation} disabled={disabled} onChange={e => void persist({ ...saved, participation: e.target.value as WeeklyPackage['participation'] })}><option value="agent">Agent 为主</option><option value="team">团队协作</option></select></label></div>}
    <div className="mb-5 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-3"><h3 className="text-base font-semibold">本周矩阵安排</h3>{!locked && <button className={secondary} disabled={disabled} onClick={() => { setPack(structuredClone(saved)); setDrawer('matrix'); }}>安排账号与内容</button>}</div>
      <p className="mt-2 text-sm text-text-secondary">{saved.matrixPlan ? '按账号分工制作内容，并按绑定账号发布。' : '为每个账号安排受众、产品与内容，生成对应的本周任务。'}</p>
      {saved.matrixPlan?.map(row => { const review = data.review?.summary.matrixPerformance?.find(item => item.accountId === row.accountId); return <div key={row.accountId} className="mt-3 border-t border-border pt-3 text-sm"><p className="font-semibold">{row.platform} · {config.publishingTargets.find(target => target.accountId === row.accountId)?.accountLabel || row.accountId} · 本周 {row.weeklyCount} 条</p><p className="mt-1 text-text-secondary">{row.productName} · {row.language} · {row.audience}</p><p className="mt-1 text-text-muted">{row.objective} · {row.contentDirection} · {row.cta}</p>{review && <div className="mt-2 text-xs text-text-secondary"><p>已成片 {review.produced} · 已发布 {review.published} · 曝光 {review.views ?? '暂无数据'} · 互动 {review.interactions ?? '暂无数据'} · 询盘 {review.inquiries ?? '暂无数据'}</p><p className="mt-1">下周建议：{review.recommendation}</p></div>}</div>; })}
    </div>
    <div className="mb-5 rounded-lg border border-border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-base font-semibold">内容编导</h3><p className="mt-1 text-sm text-text-secondary">采集、选题、脚本、预算和数量目标在内容生产前统一编排。</p></div>{!locked && <button className={secondary} disabled={disabled} onClick={() => { setPack(structuredClone(saved)); setDrawer('director'); }}>配置编导计划</button>}</div>
      {saved.directorPlan && <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4"><p className="rounded-md bg-surface-2 p-3">生产预算<br/><strong>{saved.directorPlan.currency} {saved.directorPlan.productionBudget}</strong></p><p className="rounded-md bg-surface-2 p-3">剩余可分配<br/><strong>{saved.directorPlan.currency} {Math.max(0, saved.directorPlan.productionBudget - saved.directorPlan.productionSpent - saved.directorPlan.productionReserved)}</strong></p><p className="rounded-md bg-surface-2 p-3">原创 / 平台版本<br/><strong>{saved.directorPlan.originalTarget} / {saved.directorPlan.platformVersionTarget}</strong></p><p className="rounded-md bg-surface-2 p-3">过程记录<br/><strong>{saved.directorPlan.progress.length} 项</strong></p></div>}
      <div className="mt-3 flex flex-wrap gap-4 text-xs font-semibold text-accent"><button type="button" onClick={() => onOpen('socialInspiration')}>查看灵感中心 →</button><button type="button" onClick={() => onOpen('scriptLibrary')}>查看脚本库 →</button><button type="button" onClick={() => onOpen('smartAssets', 'create')}>进入我的创作 →</button></div>
    </div>
    {drawer === 'director' && !locked && <Drawer title="内容编导与预算" onClose={close} wide><fieldset disabled={disabled} className="space-y-5"><ContentDirectorEditor value={pack.directorPlan || defaultDirectorPlan()} onChange={directorPlan => setPack({ ...pack, directorPlan })}/><div className="sticky bottom-0 flex items-center justify-between gap-4 border-t border-border bg-white py-4"><p className="text-xs text-text-muted">保存计划不会启动付费生成、投流或发布。</p><button className={primary} disabled={disabled} onClick={() => void persist(pack)}>{disabled ? '保存中…' : '保存编导计划'}</button></div>{issues.length > 0 && <p className="text-sm text-amber">{issues.join('；')}</p>}</fieldset></Drawer>}
    {drawer === 'matrix' && !locked && <Drawer title="本周矩阵安排" onClose={close} wide><fieldset disabled={disabled} className="space-y-5"><WeeklyMatrixEditor pack={pack} config={config} platforms={goal.contentPlatforms} startsAt={goal.startsAt} dueAt={goal.endsAt} projects={options.projects} onChange={setPack}/><div className="sticky bottom-0 flex items-center justify-between gap-4 border-t border-border bg-white py-4"><p className="text-xs text-text-muted">保存安排不会启动制作或发布。</p><button className={primary} disabled={disabled} onClick={() => void persist({ ...pack, matrixPlan: pack.matrixPlan || [] })}>{disabled ? '保存中…' : '保存矩阵与内容安排'}</button></div>{issues.length > 0 && <p className="text-sm text-amber">{issues.join('；')}</p>}{error && <p role="alert" className="text-sm text-red">{error}</p>}</fieldset></Drawer>}
    {view === 'cards'
      ? <WeeklyExecutionNodes data={data} onOpen={onOpenNode} onDetails={onTask} onConfigure={task => { setPack(saved); setEdit(structuredClone(task)); setDrawer('task'); }}/>
      : <WeeklyPackageGantt data={data} onOpen={onOpenNode} onDetails={onTask} onConfigure={task => { setPack(saved); setEdit(structuredClone(task)); setDrawer('task'); }}/>}
    {!saved.tasks.length && <p className="border-y border-border py-8 text-center text-sm text-text-muted">还没有任务，先从模板添加本周要完成的工作。</p>}
    {!locked && packageIssues(saved, goal.startsAt, goal.endsAt).length > 0 && <div className="mt-4 border-l-2 border-amber bg-amber-dim p-4 text-sm text-amber">{packageIssues(saved, goal.startsAt, goal.endsAt).map(issue => <p key={issue}>{issue}</p>)}</div>}
    {error && <p role="alert" className="mt-4 border-l-2 border-red bg-surface-2 p-3 text-sm text-red">{error}</p>}
    {!locked && <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5"><button className={secondary} disabled={disabled} onClick={async () => { setSaving(true); try { setPack(await digitalEmployeeApi.recommendPackage(goal.id)); setDrawer('recommend'); } catch (e) { setError(e instanceof Error ? e.message : '推荐失败'); } finally { setSaving(false); } }}>按当前阶段重新推荐</button><button className={primary} disabled={disabled || !saved.tasks.length} onClick={openExecution}>执行任务<ArrowRight size={16}/></button></div>}
    {drawer === 'recommend' && <Drawer title="系统推荐的本周安排" onClose={close}><p className="mb-4 text-sm text-text-secondary">采用后将替换当前草案，执行不会自动启动。</p><ul className="mb-5 divide-y divide-border border-y border-border">{pack.tasks.map(t => <li key={t.templateId} className="px-1 py-4 text-text-primary">{t.title} · {t.ownerId ? t.ownerName || '当前成员' : 'Agent'}<p className="mt-2 whitespace-pre-line text-sm text-text-secondary">{t.notes}</p></li>)}</ul><button className={primary} disabled={disabled} onClick={() => void persist(pack)}>采用这份建议</button></Drawer>}
    {drawer === 'templates' && <Drawer title="添加本周任务" onClose={close}>
      <p className="mb-4 text-sm text-text-secondary">选择平台支持的任务，填写具体交付后加入本周经营包。</p><input autoFocus className={field} placeholder="描述想做的事，例如：制作产品视频、跟进客户" value={query} onChange={e => setQuery(e.target.value)}/>
      <div className="mt-4 divide-y divide-border border-y border-border">{TASK_TEMPLATES.filter(t => !query || ({ readiness: /资料|产品信息|账号|连接/, director: /编导|采集|灵感|选题|爆款|脚本|矩阵/, production: /制作|做.*视频|生成.*视频|拍.*视频/, publishing: /发布|发.*视频|排期/, customers: /分层|整理.*客户/, followup: /跟进|唤醒|联系.*客户/, review: /复盘|总结/ }[t.id]).test(query) || `${t.title}${t.description}`.includes(query) || query.split(/[，。\s]+/).some(q => q && `${t.title}${t.description}`.includes(q))).map(t => <div key={t.id} className="px-1 py-4"><h3 className="font-bold text-text-primary">{t.title}</h3><p className="my-2 text-sm text-text-secondary">{t.description}</p><button className={secondary} disabled={saved.tasks.some(task => task.templateId === t.id)} onClick={() => create(t.id)}>{saved.tasks.some(task => task.templateId === t.id) ? '已加入，可在任务中调整' : '配置并加入'}</button></div>)}</div>
    </Drawer>}
    {drawer === 'task' && edit && <Drawer title={locked ? '任务详情与进度' : '调整本周任务'} onClose={close}>
      <div className="space-y-5"><label className="block text-sm">任务名称<input className={`${field} mt-2`} disabled={locked || disabled} value={edit.title} onChange={e => updateEdit({ title: e.target.value })}/></label>
        <div className="grid grid-cols-2 gap-4"><label className="text-sm">负责人<select className={`${field} mt-2`} disabled={locked || disabled} value={edit.ownerId} onChange={e => updateEdit({ ownerId: e.target.value, ownerName: options.members.find(m => m.id === e.target.value)?.name || '' })}><option value="">Agent</option>{options.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label className="text-sm">计划完成日期<input type="date" min={goal.startsAt} max={goal.endsAt} className={`${field} mt-2`} disabled={locked || disabled} value={edit.dueAt} onChange={e => updateEdit({ dueAt: e.target.value })}/></label></div>
        <label className="block text-sm">工作说明<textarea rows={3} className={`${field} mt-2`} disabled={locked || disabled} value={edit.notes} onChange={e => updateEdit({ notes: e.target.value })}/></label>
        {edit.templateId === 'production' && (locked ? <div className="divide-y divide-border border-y border-border">{edit.videoPlans?.map((p, i) => <p key={i} className="px-1 py-3 text-sm text-text-secondary">{p.productName} · {p.theme} · {p.platform} · {p.language}</p>)}</div> : <VideoPlanEditor plans={edit.videoPlans || []} matrixPlan={saved.matrixPlan} config={config} platforms={goal.contentPlatforms} onChange={videoPlans => updateEdit({ videoPlans })}/>)}
        {edit.templateId === 'publishing' && <fieldset className="space-y-2"><legend className="mb-2 text-sm font-bold text-text-primary">使用已有作品（可替代制作任务）</legend>{!options.projects.length && <p className="text-sm text-text-muted">还没有可用成片，请保留制作任务。</p>}{options.projects.map(p => <label key={p.id} className="flex gap-2 text-sm text-text-secondary"><input className="accent-accent" type="checkbox" disabled={locked || disabled} checked={edit.sourceProjectIds.includes(p.id)} onChange={e => updateEdit({ sourceProjectIds: e.target.checked ? [...edit.sourceProjectIds, p.id] : edit.sourceProjectIds.filter(id => id !== p.id) })}/>{p.title}</label>)}</fieldset>}
        {!locked && edit.templateId === 'readiness' && <button className={secondary} onClick={() => onOpen('enterprise')}>前往补齐企业与产品资料<ArrowRight size={16}/></button>}
        <div className="border-l-2 border-accent bg-surface-2 p-4 text-sm text-text-primary">完成标准：{TASK_TEMPLATES.find(t => t.id === edit.templateId)?.outcome}</div>
        <details className="rounded-md border border-border p-4"><summary className="cursor-pointer text-sm font-semibold text-text-primary">执行步骤</summary><div className="mt-3 divide-y divide-border">{data.plan?.tasks?.filter(t => (TASK_TEMPLATES.find(x => x.id === edit.templateId)?.keys as readonly string[] || []).includes(t.key)).map(t => { const runtime = data.tasks.find(r => r.task_key === t.key); return <div key={t.key} className="py-2 text-sm"><p>{t.title}{runtime && ` · ${runtime.status === 'succeeded' ? '已完成' : runtime.status === 'waiting_approval' ? '待审批' : runtime.status === 'pending' ? '未开始' : '执行中或待处理'}`}</p>{runtime && <button className="mt-1 text-accent hover:text-accent-dim" onClick={() => { close(); onTask(runtime.id); }}>查看执行详情 →</button>}</div>; })}</div></details>
        {data.run && !readOnly && ['production', 'publishing'].includes(edit.templateId) && <label className="block text-sm">关联手动完成的作品<select className={`${field} mt-2`} value="" disabled={disabled} onChange={async e => { const projectId = e.target.value; const keys = edit.templateId === 'production' ? ['content_production'] : ['content_release_approval']; const target = data.tasks.find(t => keys.includes(t.task_key) && t.status !== 'succeeded'); if (!target) { setError('本任务已完成，无需重复关联。'); return; } setSaving(true); try { await onLinkProject(target.id, projectId); setDrawer(null); } catch (e) { setError(e instanceof Error ? e.message : '关联失败'); } finally { setSaving(false); } }}><option value="">选择作品，系统核验后更新进度</option>{options.projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>}
        {locked && <button className={secondary} onClick={() => { const template = TASK_TEMPLATES.find(t => t.id === edit.templateId)!; const runtime = data.tasks.find(t => (template.keys as readonly string[]).includes(t.task_key) && !['succeeded', 'skipped'].includes(t.status)); if (runtime) { close(); onTask(runtime.id); } else onOpen(template.page as BusinessDestination, edit.templateId === 'publishing' ? 'publish' : undefined); }}>前往处理或查看成果<ArrowRight size={16}/></button>}
        {!locked && <><p className="text-xs text-text-secondary">删除任务后，依赖它的任务会提示补齐输入；系统不会替你补回已删除的任务。</p><div className="flex flex-wrap justify-between gap-3"><button className={`${secondary} text-red`} disabled={disabled} onClick={() => void persist({ ...saved, tasks: saved.tasks.filter(t => t.templateId !== edit.templateId) })}><Trash2 size={15}/>移除任务</button><button className={primary} disabled={disabled || !edit.title.trim()} onClick={() => void persist({ ...saved, tasks: saved.tasks.some(t => t.templateId === edit.templateId) ? saved.tasks.map(t => t.templateId === edit.templateId ? edit : t) : [...saved.tasks, edit] })}>{disabled ? <Loader2 size={15} className="animate-spin"/> : <Pencil size={15}/>}保存任务</button></div></>}
        {error && <p role="alert" className="border-l-2 border-red bg-surface-2 px-3 py-2 text-sm text-red">{error}</p>}
      </div>
    </Drawer>}
    {drawer === 'confirm' && <Drawer title="确认并执行任务" onClose={close}>
      <div className="space-y-5"><h3 className="text-lg font-bold text-text-primary">{goal.title}</h3><p className="text-sm text-text-secondary">{goal.objective}</p><ul className="divide-y divide-border border-y border-border text-sm">{pack.tasks.map(t => <li key={t.templateId} className="flex justify-between px-1 py-3"><span>{t.title}</span><span className="text-text-secondary">{t.ownerId ? t.ownerName : 'Agent'}</span></li>)}</ul>
        {pack.matrixPlan && <div className="rounded-md border border-border p-3 text-sm"><p className="font-semibold">本周账号交付</p>{pack.matrixPlan.map(row => <p key={row.accountId} className="mt-2 text-text-secondary">{config.publishingTargets.find(target => target.accountId === row.accountId)?.accountLabel || row.accountId} · {row.weeklyCount} 条 · {row.language} · {row.objective}</p>)}</div>}
        <label className="block text-sm font-semibold">对外动作授权<select className={`${field} mt-2`} value={pack.authorization.mode} disabled={disabled} onChange={e => setPack({ ...pack, authorization: { ...pack.authorization, mode: e.target.value as 'bounded' | 'each' } })}><option value="each">发布、跟进前再审批</option><option value="bounded">本次确认范围内自动执行</option></select></label>
        {pack.tasks.some(t => t.templateId === 'publishing') && <fieldset className="space-y-3"><legend className="mb-2 font-semibold">允许发布的账号</legend>{!config.publishingTargets.length && <p className="border-l-2 border-amber bg-amber-dim px-3 py-2 text-sm text-amber">暂无绑定账号，可先启动；执行到发布时再处理。</p>}{config.publishingTargets.map(a => <label key={a.accountId} className="flex gap-2 text-sm text-text-secondary"><input className="accent-accent" type="checkbox" disabled={disabled} checked={pack.authorization.accountIds.includes(a.accountId)} onChange={e => setPack({ ...pack, authorization: { ...pack.authorization, accountIds: e.target.checked ? [...pack.authorization.accountIds, a.accountId] : pack.authorization.accountIds.filter(id => id !== a.accountId) } })}/>{a.platform} · {a.accountLabel}</label>)}<label className="block text-sm">本周期发布动作上限（每条内容发布到一个账号计一次）<input className={`${field} mt-2`} type="number" min={1} max={100} value={pack.authorization.maxPublishItems} onChange={e => setPack({ ...pack, authorization: { ...pack.authorization, maxPublishItems: Number(e.target.value) } })}/></label></fieldset>}
        {pack.tasks.some(t => t.templateId === 'followup') && <fieldset className="space-y-3"><legend className="mb-2 font-semibold text-text-primary">允许跟进的客户</legend><div className="max-h-48 space-y-2 overflow-y-auto">{options.customers.map(c => <label key={c.id} className="flex gap-2 text-sm text-text-secondary"><input className="accent-accent" type="checkbox" checked={pack.authorization.customerIds.includes(c.id)} onChange={e => setPack({ ...pack, authorization: { ...pack.authorization, customerIds: e.target.checked ? [...pack.authorization.customerIds, c.id] : pack.authorization.customerIds.filter(id => id !== c.id) } })}/>{c.name}</label>)}</div><label className="block text-sm">本周期跟进人数上限<input className={`${field} mt-2`} type="number" min={1} max={100} value={pack.authorization.maxCustomerMessages} onChange={e => setPack({ ...pack, authorization: { ...pack.authorization, maxCustomerMessages: Number(e.target.value) } })}/></label></fieldset>}
        {issues.length > 0 && <ul className="space-y-1 border-l-2 border-amber bg-amber-dim p-4 text-sm text-amber">{[...new Set(issues)].map(i => <li key={i}>{i}</li>)}</ul>}
        {error && <p role="alert" className="border-l-2 border-red bg-surface-2 px-3 py-2 text-sm text-red">{error}</p>}
        <button className={`${primary} w-full`} disabled={disabled || issues.length > 0} onClick={async () => { setSaving(true); setError(''); try { if (await onSave(pack)) { setPack({ ...pack, revision: pack.revision + 1 }); await onApprove(pack.revision + 1); setDrawer(null); } } catch (e) { setError(e instanceof Error ? e.message : '启动失败，请重试'); } finally { setSaving(false); } }}>{disabled && <Loader2 size={16} className="animate-spin"/>}{disabled ? '正在启动…' : '确认并执行任务'}</button>
      </div>
    </Drawer>}
  </section>;
}
