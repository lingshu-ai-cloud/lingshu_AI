import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, Compass, Loader2, Play, SlidersHorizontal, X } from 'lucide-react';
import type { SocialCrawlStrategy, SocialDiscoveryMode, SocialDiscoverySummary, SocialInspirationCollectionRun } from '../../../shared/contracts/socialContentWorkflow';
import { socialDiscoveryApi, type SocialDiscoveryScopeInput } from '../../lib/socialDiscoveryApi';

const COMPANY_ROLE_LABEL = { factory: '工厂', brand: '品牌', importer: '进口商', distributor: '经销商', retailer: '零售商' } as const;
const AUDIENCE_ROLE_LABEL = { brand_buyer: '品牌采购', importer: '进口商', distributor: '经销商', retailer: '零售商', consumer: '消费者' } as const;

function inputFromStrategy(strategy: SocialCrawlStrategy): SocialDiscoveryScopeInput {
  const scope = strategy.keywordSet.scope;
  return {
    productRef: scope.productRef,
    productTerms: strategy.keywordSet.graph.discoverySeeds.map(item => item.label),
    market: scope.market,
    language: scope.language,
    companyRole: scope.companyRole,
    audienceRole: scope.audienceRole,
    platforms: strategy.discoveryBrief.platforms,
    discoveryModes: strategy.discoveryBrief.discoveryModes,
    lookbackDays: strategy.discoveryBrief.lookbackDays,
    resultLimit: strategy.discoveryBrief.resultLimit,
    budgetLimitCny: strategy.discoveryBrief.budgetLimitCny,
    productionGap: strategy.discoveryBrief.productionGap,
    benchmarkAccounts: strategy.benchmarkAccounts.map(item => ({ accountRef: item.accountRef, type: item.type, weight: item.weight })),
    modePolicies: strategy.discoveryBrief.modePolicies,
    sceneClusters: strategy.keywordSet.graph.sceneClusters.map(item => ({
      label: item.label,
      productTask: item.productTask,
      demandDimension: item.demandDimension,
      queryVariants: item.queryVariants,
      status: item.status,
    })),
  };
}

const EMPTY_INPUT: SocialDiscoveryScopeInput = {
  productRef: '', productTerms: [], market: '', language: '英语', companyRole: 'brand', audienceRole: 'consumer',
  platforms: ['tiktok', 'instagram', 'youtube', 'facebook'], discoveryModes: ['momentum', 'account', 'innovation'],
  lookbackDays: 7, resultLimit: 30, sceneClusters: [],
};

export default function DiscoveryScopePanel() {
  const [strategy, setStrategy] = useState<SocialCrawlStrategy | null>(null);
  const [editor, setEditor] = useState<SocialDiscoveryScopeInput>(EMPTY_INPUT);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [sceneText, setSceneText] = useState('');
  const [accountText, setAccountText] = useState('');
  const [summary, setSummary] = useState<SocialDiscoverySummary | null>(null);
  const [runs, setRuns] = useState<SocialInspirationCollectionRun[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let active = true;
    void socialDiscoveryApi.getScope().then(result => {
      if (!active) return;
      setStrategy(result.scope);
      setEditor(inputFromStrategy(result.scope));
      setSceneText(result.scope.keywordSet.graph.sceneClusters.map(item => item.label).join('\n'));
      setAccountText(result.scope.benchmarkAccounts.map(item => item.accountRef).join('\n'));
    }).catch(error => {
      if (active) setMessage(error instanceof Error ? error.message : '发现范围尚未建立');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const refreshOperations = async () => {
    const [summaryResult, runResult] = await Promise.all([socialDiscoveryApi.getSummary(), socialDiscoveryApi.listRuns(1, 5)]);
    setSummary(summaryResult.summary);
    setRuns(runResult.items);
  };

  useEffect(() => { void refreshOperations().catch(() => {}); }, [strategy?.keywordSet.version]);

  const scenes = useMemo(() => strategy?.keywordSet.graph.sceneClusters.filter(item => item.status !== 'rejected') ?? [], [strategy]);

  const save = async () => {
    setSaving(true);
    setMessage('');
    try {
      const lines = [...new Set(sceneText.split(/[\n;；]+/).map(value => value.trim()).filter(Boolean))];
      const result = await socialDiscoveryApi.saveScope({
        ...editor,
        productTerms: [...new Set([editor.productRef, ...editor.productTerms].map(value => value.trim()).filter(Boolean))],
        sceneClusters: lines.map(label => ({ label, productTask: editor.productRef, demandDimension: 'scene', queryVariants: [`${editor.productRef} ${label}`], status: 'approved' })),
        benchmarkAccounts: [...new Set(accountText.split(/[\n;；]+/).map(value => value.trim()).filter(Boolean))].map(accountRef => ({ accountRef, type: 'brand' as const })),
      });
      setStrategy(result.scope);
      setEditor(inputFromStrategy(result.scope));
      setOpen(false);
      setMessage('发现范围已更新，后续采集任务会使用这个版本。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    setRunning(true); setMessage('');
    try { await socialDiscoveryApi.run(); await refreshOperations(); setMessage('采集运行已完成，结果和运行记录已刷新。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '运行失败'); }
    finally { setRunning(false); }
  };

  const updateMode = (mode: SocialDiscoveryMode, patch: Record<string, unknown>) => setEditor(current => ({
    ...current,
    modePolicies: { ...current.modePolicies, [mode]: { ...current.modePolicies?.[mode], ...patch } },
  }));

  return <>
    <section className="mb-3 rounded-xl border border-cyan-100 bg-cyan-50/55 px-3.5 py-3" aria-label="当前灵感发现范围">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 rounded-lg bg-cyan-100 p-2 text-cyan-800"><Compass size={16} /></span>
          <div className="min-w-0">
            <p className="text-[10px] font-black tracking-wide text-cyan-900">当前发现范围</p>
            {loading ? <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-bold text-text-muted"><Loader2 size={12} className="animate-spin" />正在读取企业资料与已保存范围</p>
              : strategy ? <>
                <p className="mt-1 text-sm font-black text-text-primary">{strategy.keywordSet.scope.productRef || '未选产品'} · {strategy.keywordSet.scope.market || '未选市场'} · {AUDIENCE_ROLE_LABEL[strategy.keywordSet.scope.audienceRole]}</p>
                <p className="mt-1 text-[10px] leading-4 text-text-muted">{COMPANY_ROLE_LABEL[strategy.keywordSet.scope.companyRole]} · {strategy.keywordSet.scope.language || '未确认语言'} · {strategy.discoveryBrief.platforms.join(' / ')} · {scenes.length} 个场景簇</p>
              </> : <p className="mt-1 text-xs font-bold text-amber-900">尚未确认产品、市场和沟通对象，系统不会凭空使用行业词。</p>}
          </div>
        </div>
        <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-cyan-200 bg-white px-3 text-xs font-black text-cyan-900 hover:border-cyan-400">
          <SlidersHorizontal size={14} />调整发现范围<ChevronRight size={13} />
        </button>
      </div>
      {scenes.length > 0 && <div className="mt-2.5 flex flex-wrap gap-1.5">{scenes.slice(0, 6).map(scene => <span key={scene.sceneId} className="rounded-full bg-white px-2 py-1 text-[9px] font-bold text-cyan-900">{scene.label}</span>)}</div>}
      {message && <p className={`mt-2 text-[10px] font-semibold ${strategy ? 'text-emerald-800' : 'text-amber-900'}`}>{message}</p>}
      {strategy && <div className="mt-3 grid gap-2 border-t border-cyan-100 pt-3 sm:grid-cols-4">
        <div><p className="text-[9px] font-bold text-text-muted">运行次数</p><p className="text-sm font-black text-text-primary">{summary?.runCount ?? '—'}</p></div>
        <div><p className="text-[9px] font-bold text-text-muted">已接纳素材</p><p className="text-sm font-black text-text-primary">{summary?.totals.accepted ?? '—'}</p></div>
        <div><p className="text-[9px] font-bold text-text-muted">已知成本</p><p className="text-sm font-black text-text-primary">{summary ? `¥${summary.totalKnownCostCny.toFixed(2)}${summary.costComplete ? '' : '+'}` : '—'}</p></div>
        <div className="flex items-end justify-between gap-2"><div><p className="text-[9px] font-bold text-text-muted">待经营确认</p><p className="text-sm font-black text-text-primary">{summary?.accountDecisionsPendingBusinessConfirmation ?? '—'}</p></div><button type="button" onClick={() => void runNow()} disabled={running} className="inline-flex min-h-8 items-center gap-1 rounded-lg bg-cyan-900 px-2 text-[10px] font-black text-white disabled:opacity-50">{running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}立即采集</button></div>
      </div>}
      {runs.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5" aria-label="最近采集运行">{runs.map(run => <span key={run.runId} title={run.runId} className="rounded-md border border-cyan-100 bg-white px-2 py-1 text-[9px] font-bold text-text-muted">v{run.discoveryScopeVersion} · {run.triggerType} · {run.status} · {Object.values(run.modeStats).reduce((sum, item) => sum + (item?.accepted || 0), 0)} 条</span>)}</div>}
    </section>

    {open && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="discovery-scope-title" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black text-accent">灵感中心</p><h3 id="discovery-scope-title" className="mt-1 text-lg font-black text-text-primary">调整发现范围</h3><p className="mt-1 text-xs leading-5 text-text-muted">只填写真实业务事实。关键词由系统基于产品、市场、对象和场景生成。</p></div><button type="button" aria-label="关闭" onClick={() => setOpen(false)} disabled={saving} className="rounded-lg p-2 text-text-muted hover:bg-surface-2"><X size={18} /></button></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-bold text-text-secondary">主产品<input value={editor.productRef} onChange={event => setEditor(current => ({ ...current, productRef: event.target.value }))} className="mt-1.5 h-11 w-full rounded-lg border border-border px-3 text-sm text-text-primary outline-none focus:border-accent" placeholder="例如：积雪草修护精华" /></label>
          <label className="text-xs font-bold text-text-secondary">目标市场<input value={editor.market} onChange={event => setEditor(current => ({ ...current, market: event.target.value }))} className="mt-1.5 h-11 w-full rounded-lg border border-border px-3 text-sm text-text-primary outline-none focus:border-accent" placeholder="例如：美国" /></label>
          <label className="text-xs font-bold text-text-secondary">内容语言<input value={editor.language} onChange={event => setEditor(current => ({ ...current, language: event.target.value }))} className="mt-1.5 h-11 w-full rounded-lg border border-border px-3 text-sm text-text-primary outline-none focus:border-accent" /></label>
          <label className="text-xs font-bold text-text-secondary">企业角色<select value={editor.companyRole} onChange={event => setEditor(current => ({ ...current, companyRole: event.target.value as SocialDiscoveryScopeInput['companyRole'] }))} className="mt-1.5 h-11 w-full rounded-lg border border-border px-3 text-sm text-text-primary outline-none focus:border-accent">{Object.entries(COMPANY_ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs font-bold text-text-secondary sm:col-span-2">主要沟通对象<select value={editor.audienceRole} onChange={event => setEditor(current => ({ ...current, audienceRole: event.target.value as SocialDiscoveryScopeInput['audienceRole'] }))} className="mt-1.5 h-11 w-full rounded-lg border border-border px-3 text-sm text-text-primary outline-none focus:border-accent">{Object.entries(AUDIENCE_ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs font-bold text-text-secondary sm:col-span-2">重点场景（每行一个）<textarea value={sceneText} onChange={event => setSceneText(event.target.value)} className="mt-1.5 min-h-28 w-full rounded-lg border border-border p-3 text-sm text-text-primary outline-none focus:border-accent" placeholder={'早八快速护肤\n敏感泛红修护\n上妆前保湿'} /></label>
          <label className="text-xs font-bold text-text-secondary sm:col-span-2">已确认对标账号（每行一个主页 URL）<textarea value={accountText} onChange={event => setAccountText(event.target.value)} className="mt-1.5 min-h-20 w-full rounded-lg border border-border p-3 text-sm text-text-primary outline-none focus:border-accent" placeholder="https://www.facebook.com/brand" /></label>
          <label className="text-xs font-bold text-text-secondary sm:col-span-2">创新参考缺口<input value={editor.productionGap ?? ''} onChange={event => setEditor(current => ({ ...current, productionGap: event.target.value || null }))} className="mt-1.5 h-11 w-full rounded-lg border border-border px-3 text-sm text-text-primary outline-none focus:border-accent" placeholder="例如：缺少可视化质地对比的开场表达" /></label>
          <fieldset className="sm:col-span-2"><legend className="text-xs font-bold text-text-secondary">采集平台</legend><div className="mt-2 flex flex-wrap gap-2">{['tiktok', 'instagram', 'youtube', 'facebook'].map(platform => <label key={platform} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-2 text-xs font-bold"><input type="checkbox" checked={editor.platforms.includes(platform)} onChange={event => setEditor(current => ({ ...current, platforms: event.target.checked ? [...new Set([...current.platforms, platform])] : current.platforms.filter(item => item !== platform) }))} />{platform}</label>)}</div></fieldset>
          <div className="sm:col-span-2 grid gap-2 sm:grid-cols-3">{(['momentum', 'account', 'innovation'] as SocialDiscoveryMode[]).map(mode => { const policy = editor.modePolicies?.[mode]; const modePlatforms = policy?.platforms ?? editor.platforms; return <fieldset key={mode} className="rounded-xl border border-border p-3"><legend className="px-1 text-xs font-black text-text-primary">{{ momentum: '行业起量', account: '确认对标', innovation: '创新参考' }[mode]}</legend><label className="mt-1 flex items-center gap-2 text-[11px] font-bold"><input type="checkbox" checked={policy?.enabled !== false} onChange={event => updateMode(mode, { enabled: event.target.checked })} />启用</label><div className="mt-2 flex flex-wrap gap-1">{editor.platforms.map(platform => <label key={platform} className="inline-flex items-center gap-1 text-[9px] font-bold"><input type="checkbox" checked={modePlatforms.includes(platform)} onChange={event => updateMode(mode, { platforms: event.target.checked ? [...new Set([...modePlatforms, platform])] : modePlatforms.filter(item => item !== platform) })} />{platform}</label>)}</div><label className="mt-2 block text-[10px] font-bold text-text-muted">单轮上限<input type="number" min={1} max={200} value={policy?.resultLimit ?? editor.resultLimit} onChange={event => updateMode(mode, { resultLimit: Number(event.target.value) })} className="mt-1 h-9 w-full rounded-lg border border-border px-2" /></label><label className="mt-2 block text-[10px] font-bold text-text-muted">刷新间隔（分钟）<input type="number" min={15} value={policy?.refreshIntervalMinutes ?? 1440} onChange={event => updateMode(mode, { refreshIntervalMinutes: Number(event.target.value) })} className="mt-1 h-9 w-full rounded-lg border border-border px-2" /></label><label className="mt-2 block text-[10px] font-bold text-text-muted">预算上限（元，可空）<input type="number" min={0} value={policy?.budgetLimitCny ?? ''} onChange={event => updateMode(mode, { budgetLimitCny: event.target.value === '' ? null : Number(event.target.value) })} className="mt-1 h-9 w-full rounded-lg border border-border px-2" /></label></fieldset>; })}</div>
        </div>
        {message && <p className="mt-3 text-xs font-semibold text-amber-900">{message}</p>}
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)} disabled={saving} className="btn-ghost">取消</button><button type="button" onClick={() => void save()} disabled={saving || !editor.productRef.trim() || !editor.market.trim() || !editor.language.trim()} className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-50">{saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}保存并用于后续采集</button></div>
      </section>
    </div>}
  </>;
}
