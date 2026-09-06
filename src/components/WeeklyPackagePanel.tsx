import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Plus, X, ArrowRight, Trash2, Loader2, Pencil, LayoutGrid, ChartGantt } from 'lucide-react';
import { planConfigForDisplay, digitalEmployeeApi, type DigitalEmployeeOverview, type BusinessDestination, type DigitalEmployeeDeepLink } from '../lib/digitalEmployees';
import { TASK_TEMPLATES, maturityLabels, packageIssues, type WeeklyPackage, type PackageTask, type TemplateId } from '../lib/weeklyPackage';
import { normalizeVideoPlan, videoPlanErrors } from '../lib/videoCreationPlan';
import VideoPlanEditor from './VideoPlanEditor';
import WeeklyExecutionNodes, { weeklyExecutionNodes } from './WeeklyExecutionNodes';
import WeeklyPackageGantt from './WeeklyPackageGantt';

const field = 'w-full rounded-xl border border-slate-200 bg-white p-3 text-sm';
const secondary = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-50 disabled:opacity-40';
const primary = 'inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-40';

function Drawer({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
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
  return <dialog ref={ref} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }} className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-2xl border-0 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/30">
    <div className="flex h-full flex-col"><header className="flex items-center justify-between border-b border-slate-100 px-6 py-5"><h2 className="text-lg font-bold">{title}</h2><button aria-label="关闭" onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100"><X size={20}/></button></header><div ref={bodyRef} onScroll={e => { scrollTopRef.current = e.currentTarget.scrollTop; }} className="flex-1 overflow-y-auto p-6">{children}</div></div>
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
  const [drawer, setDrawer] = useState<'templates' | 'task' | 'confirm' | 'recommend' | null>(null);
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
  return <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold text-emerald-700">{maturityLabels[saved.maturity]} · {saved.participation === 'team' ? '团队协作' : 'Agent 为主'}</p><h2 className="mt-2 text-xl font-bold">本周经营包</h2></div><div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="经营包视图" className="inline-flex rounded-lg bg-slate-100 p-1">{([{ value: 'cards', label: '卡片', icon: LayoutGrid }, { value: 'gantt', label: '甘特图', icon: ChartGantt }] as const).map(item => <button key={item.value} type="button" aria-pressed={view === item.value} onClick={() => changeView(item.value)} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition focus-visible:outline-emerald-600 ${view === item.value ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}><item.icon size={14}/>{item.label}</button>)}</div>
      {!locked && <><button className={secondary} disabled={disabled} onClick={() => setDrawer('templates')}><Plus size={16}/>添加任务</button><button className={primary} disabled={disabled || !saved.tasks.length} onClick={openExecution}>执行任务<ArrowRight size={16}/></button></>}
    </div></div>
    {!locked && <p className="mt-3 text-sm text-emerald-700">任务包已选定，点击「执行任务」确认范围并启动；启动后可随时查看智能体执行进度。</p>}
    <div className="mb-4 mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500"><span>{weeklyExecutionNodes(data).length} 个节点</span><span>{goal.startsAt} — {goal.endsAt}</span>{saved.tasks.some(t => t.ownerId) && <span>{saved.tasks.filter(t => t.ownerId).length} 项成员负责</span>}</div>
    {!locked && <div className="mb-5 grid gap-3 sm:grid-cols-2"><label className="text-xs text-slate-500">运营阶段<select className={`${field} mt-1`} value={saved.maturity} disabled={disabled} onChange={e => void persist({ ...saved, maturity: e.target.value as WeeklyPackage['maturity'] })}>{Object.entries(maturityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="text-xs text-slate-500">协作偏好（具体负责人在任务中设置）<select className={`${field} mt-1`} value={saved.participation} disabled={disabled} onChange={e => void persist({ ...saved, participation: e.target.value as WeeklyPackage['participation'] })}><option value="agent">Agent 为主</option><option value="team">团队协作</option></select></label></div>}
    {view === 'cards'
      ? <WeeklyExecutionNodes data={data} onOpen={onOpenNode} onDetails={onTask} onConfigure={task => { setPack(saved); setEdit(structuredClone(task)); setDrawer('task'); }}/>
      : <WeeklyPackageGantt data={data} onOpen={onOpenNode} onDetails={onTask} onConfigure={task => { setPack(saved); setEdit(structuredClone(task)); setDrawer('task'); }}/>}
    {!saved.tasks.length && <p className="py-8 text-center text-sm text-slate-500">还没有任务，先从模板添加本周要完成的工作。</p>}
    {!locked && packageIssues(saved, goal.startsAt, goal.endsAt).length > 0 && <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{packageIssues(saved, goal.startsAt, goal.endsAt).map(issue => <p key={issue}>{issue}</p>)}</div>}
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {!locked && <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-5"><button className={secondary} disabled={disabled} onClick={async () => { setSaving(true); try { setPack(await digitalEmployeeApi.recommendPackage(goal.id)); setDrawer('recommend'); } catch (e) { setError(e instanceof Error ? e.message : '推荐失败'); } finally { setSaving(false); } }}>按当前阶段重新推荐</button><button className={primary} disabled={disabled || !saved.tasks.length} onClick={openExecution}>执行任务<ArrowRight size={16}/></button></div>}
    {drawer === 'recommend' && <Drawer title="系统推荐的本周安排" onClose={close}><p className="mb-4 text-sm text-slate-500">采用后将替换当前草案，执行不会自动启动。</p><ul className="mb-5 space-y-3">{pack.tasks.map(t => <li key={t.templateId} className="rounded-xl bg-slate-50 p-4">{t.title} · {t.ownerId ? t.ownerName || '当前成员' : 'Agent'}<p className="mt-2 whitespace-pre-line text-sm text-slate-500">{t.notes}</p></li>)}</ul><button className={primary} disabled={disabled} onClick={() => void persist(pack)}>采用这份建议</button></Drawer>}
    {drawer === 'templates' && <Drawer title="添加本周任务" onClose={close}>
      <p className="mb-4 text-sm text-slate-500">选择平台支持的任务，填写具体交付后加入本周经营包。</p><input autoFocus className={field} placeholder="描述想做的事，例如：制作产品视频、跟进客户" value={query} onChange={e => setQuery(e.target.value)}/>
      <div className="mt-4 space-y-3">{TASK_TEMPLATES.filter(t => !query || ({ readiness: /资料|产品信息|账号|连接/, collection: /采集|抓取|行业|对标/, inspiration: /灵感|选题|爆款/, production: /制作|做.*视频|生成.*视频|拍.*视频/, publishing: /发布|发.*视频|排期/, customers: /分层|整理.*客户/, followup: /跟进|唤醒|联系.*客户/, review: /复盘|总结/ }[t.id]).test(query) || `${t.title}${t.description}`.includes(query) || query.split(/[，。\s]+/).some(q => q && `${t.title}${t.description}`.includes(q))).map(t => <div key={t.id} className="rounded-2xl border border-slate-200 p-4"><h3 className="font-bold">{t.title}</h3><p className="my-2 text-sm text-slate-500">{t.description}</p><button className={secondary} disabled={saved.tasks.some(task => task.templateId === t.id)} onClick={() => create(t.id)}>{saved.tasks.some(task => task.templateId === t.id) ? '已加入，可在任务中调整' : '配置并加入'}</button></div>)}</div>
    </Drawer>}
    {drawer === 'task' && edit && <Drawer title={locked ? '任务详情与进度' : '调整本周任务'} onClose={close}>
      <div className="space-y-5"><label className="block text-sm">任务名称<input className={`${field} mt-2`} disabled={locked || disabled} value={edit.title} onChange={e => updateEdit({ title: e.target.value })}/></label>
        <div className="grid grid-cols-2 gap-4"><label className="text-sm">负责人<select className={`${field} mt-2`} disabled={locked || disabled} value={edit.ownerId} onChange={e => updateEdit({ ownerId: e.target.value, ownerName: options.members.find(m => m.id === e.target.value)?.name || '' })}><option value="">Agent</option>{options.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label className="text-sm">计划完成日期<input type="date" min={goal.startsAt} max={goal.endsAt} className={`${field} mt-2`} disabled={locked || disabled} value={edit.dueAt} onChange={e => updateEdit({ dueAt: e.target.value })}/></label></div>
        <label className="block text-sm">工作说明<textarea rows={3} className={`${field} mt-2`} disabled={locked || disabled} value={edit.notes} onChange={e => updateEdit({ notes: e.target.value })}/></label>
        {edit.templateId === 'production' && (locked ? <div className="space-y-2">{edit.videoPlans?.map((p, i) => <p key={i} className="rounded-xl bg-slate-50 p-3 text-sm">{p.productName} · {p.theme} · {p.platform} · {p.language}</p>)}</div> : <VideoPlanEditor plans={edit.videoPlans || []} config={config} platforms={goal.contentPlatforms} onChange={videoPlans => updateEdit({ videoPlans })}/>)}
        {edit.templateId === 'publishing' && <fieldset className="space-y-2"><legend className="mb-2 text-sm font-bold">使用已有作品（可替代制作任务）</legend>{!options.projects.length && <p className="text-sm text-slate-500">还没有可用成片，请保留制作任务。</p>}{options.projects.map(p => <label key={p.id} className="flex gap-2 text-sm"><input type="checkbox" disabled={locked || disabled} checked={edit.sourceProjectIds.includes(p.id)} onChange={e => updateEdit({ sourceProjectIds: e.target.checked ? [...edit.sourceProjectIds, p.id] : edit.sourceProjectIds.filter(id => id !== p.id) })}/>{p.title}</label>)}</fieldset>}
        {!locked && edit.templateId === 'readiness' && <button className={secondary} onClick={() => onOpen('enterprise')}>前往补齐企业与产品资料<ArrowRight size={16}/></button>}
        <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">完成标准：{TASK_TEMPLATES.find(t => t.id === edit.templateId)?.outcome}</div>
        <details className="rounded-xl border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-semibold">执行步骤</summary><div className="mt-3 space-y-2">{data.plan?.tasks.filter(t => (TASK_TEMPLATES.find(x => x.id === edit.templateId)?.keys as readonly string[] || []).includes(t.key)).map(t => { const runtime = data.tasks.find(r => r.task_key === t.key); return <div key={t.key} className="text-sm"><p>{t.title}{runtime && ` · ${runtime.status === 'succeeded' ? '已完成' : runtime.status === 'waiting_approval' ? '待审批' : runtime.status === 'pending' ? '未开始' : '执行中或待处理'}`}</p>{runtime && <button className="mt-1 text-emerald-700" onClick={() => { close(); onTask(runtime.id); }}>查看执行详情 →</button>}</div>; })}</div></details>
        {data.run && !readOnly && ['production', 'publishing'].includes(edit.templateId) && <label className="block text-sm">关联手动完成的作品<select className={`${field} mt-2`} value="" disabled={disabled} onChange={async e => { const projectId = e.target.value; const keys = edit.templateId === 'production' ? ['content_production'] : ['content_release_approval']; const target = data.tasks.find(t => keys.includes(t.task_key) && t.status !== 'succeeded'); if (!target) { setError('本任务已完成，无需重复关联。'); return; } setSaving(true); try { await onLinkProject(target.id, projectId); setDrawer(null); } catch (e) { setError(e instanceof Error ? e.message : '关联失败'); } finally { setSaving(false); } }}><option value="">选择作品，系统核验后更新进度</option>{options.projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>}
        {locked && <button className={secondary} onClick={() => { const template = TASK_TEMPLATES.find(t => t.id === edit.templateId)!; const runtime = data.tasks.find(t => (template.keys as readonly string[]).includes(t.task_key) && !['succeeded', 'skipped'].includes(t.status)); if (runtime) { close(); onTask(runtime.id); } else onOpen(template.page as BusinessDestination, edit.templateId === 'publishing' ? 'publish' : undefined); }}>前往处理或查看成果<ArrowRight size={16}/></button>}
        {!locked && <><p className="text-xs text-slate-500">删除任务后，依赖它的任务会提示补齐输入；系统不会替你补回已删除的任务。</p><div className="flex flex-wrap justify-between gap-3"><button className={`${secondary} text-red-600`} disabled={disabled} onClick={() => void persist({ ...saved, tasks: saved.tasks.filter(t => t.templateId !== edit.templateId) })}><Trash2 size={15}/>移除任务</button><button className={primary} disabled={disabled || !edit.title.trim()} onClick={() => void persist({ ...saved, tasks: saved.tasks.some(t => t.templateId === edit.templateId) ? saved.tasks.map(t => t.templateId === edit.templateId ? edit : t) : [...saved.tasks, edit] })}>{disabled ? <Loader2 size={15} className="animate-spin"/> : <Pencil size={15}/>}保存任务</button></div></>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </div>
    </Drawer>}
    {drawer === 'confirm' && <Drawer title="确认并执行任务" onClose={close}>
      <div className="space-y-5"><h3 className="text-lg font-bold">{goal.title}</h3><p className="text-sm text-slate-500">{goal.objective}</p><ul className="space-y-2 text-sm">{pack.tasks.map(t => <li key={t.templateId} className="flex justify-between rounded-xl bg-slate-50 p-3"><span>{t.title}</span><span className="text-slate-500">{t.ownerId ? t.ownerName : 'Agent'}</span></li>)}</ul>
        <label className="block text-sm font-semibold">对外动作授权<select className={`${field} mt-2`} value={pack.authorization.mode} disabled={disabled} onChange={e => setPack({ ...pack, authorization: { ...pack.authorization, mode: e.target.value as 'bounded' | 'each' } })}><option value="each">发布、跟进前再审批</option><option value="bounded">本次确认范围内自动执行</option></select></label>
        {pack.tasks.some(t => t.templateId === 'publishing') && <fieldset className="space-y-3"><legend className="mb-2 font-semibold">允许发布的账号</legend>{!config.publishingTargets.length && <p className="text-sm text-amber-700">暂无绑定账号，可先启动；执行到发布时再处理。</p>}{config.publishingTargets.map(a => <label key={a.accountId} className="flex gap-2 text-sm"><input type="checkbox" disabled={disabled} checked={pack.authorization.accountIds.includes(a.accountId)} onChange={e => setPack({ ...pack, authorization: { ...pack.authorization, accountIds: e.target.checked ? [...pack.authorization.accountIds, a.accountId] : pack.authorization.accountIds.filter(id => id !== a.accountId) } })}/>{a.platform} · {a.accountLabel}</label>)}<label className="block text-sm">本周期发布项上限（每条作品 × 每个平台计一项）<input className={`${field} mt-2`} type="number" min={1} max={100} value={pack.authorization.maxPublishItems} onChange={e => setPack({ ...pack, authorization: { ...pack.authorization, maxPublishItems: Number(e.target.value) } })}/></label></fieldset>}
        {pack.tasks.some(t => t.templateId === 'followup') && <fieldset className="space-y-3"><legend className="mb-2 font-semibold">允许跟进的客户</legend><div className="max-h-48 space-y-2 overflow-y-auto">{options.customers.map(c => <label key={c.id} className="flex gap-2 text-sm"><input type="checkbox" checked={pack.authorization.customerIds.includes(c.id)} onChange={e => setPack({ ...pack, authorization: { ...pack.authorization, customerIds: e.target.checked ? [...pack.authorization.customerIds, c.id] : pack.authorization.customerIds.filter(id => id !== c.id) } })}/>{c.name}</label>)}</div><label className="block text-sm">本周期跟进人数上限<input className={`${field} mt-2`} type="number" min={1} max={100} value={pack.authorization.maxCustomerMessages} onChange={e => setPack({ ...pack, authorization: { ...pack.authorization, maxCustomerMessages: Number(e.target.value) } })}/></label></fieldset>}
        {issues.length > 0 && <ul className="space-y-1 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{[...new Set(issues)].map(i => <li key={i}>{i}</li>)}</ul>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button className={`${primary} w-full`} disabled={disabled || issues.length > 0} onClick={async () => { setSaving(true); setError(''); try { if (await onSave(pack)) { setPack({ ...pack, revision: pack.revision + 1 }); await onApprove(pack.revision + 1); setDrawer(null); } } catch (e) { setError(e instanceof Error ? e.message : '启动失败，请重试'); } finally { setSaving(false); } }}>{disabled && <Loader2 size={16} className="animate-spin"/>}{disabled ? '正在启动…' : '确认并执行任务'}</button>
      </div>
    </Drawer>}
  </section>;
}
