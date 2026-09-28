import DiscoveryProductPicker from './DiscoveryProductPicker';
import { readProductDiscoveryFile } from '../../lib/productDiscoveryFile';
import { fiveProductKeywords } from '../../../shared/productDiscovery';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, Compass, Loader2, SlidersHorizontal, X } from 'lucide-react';
import type { SocialCrawlStrategy } from '../../../shared/contracts/socialContentWorkflow';
import { socialDiscoveryApi, type SocialDiscoveryScopeInput } from '../../lib/socialDiscoveryApi';
import { authHeader } from '../../lib/auth';

type BenchmarkAccount = { id: string; platform: string; accountName: string; accountUrl: string };

const COMPANY_ROLE_LABEL = { factory: '工厂', brand: '品牌', importer: '进口商', distributor: '经销商', retailer: '零售商' } as const;
const AUDIENCE_ROLE_LABEL = { brand_buyer: '品牌采购', importer: '进口商', distributor: '经销商', retailer: '零售商', consumer: '消费者' } as const;

function inputFromStrategy(strategy: SocialCrawlStrategy): SocialDiscoveryScopeInput {
  const scope = strategy.keywordSet.scope;
  return {
    productRef: scope.productRef,
    keywordRecommendation: strategy.keywordRecommendation,
    productQueries: strategy.keywordSet.graph.discoverySeeds.filter(item => item.enabled).flatMap(item => item.queryVariants),
    productTerms: strategy.keywordSet.graph.discoverySeeds.map(item => item.label),
    market: scope.market,
    language: scope.language || '英语',
    companyRole: scope.companyRole,
    audienceRole: scope.audienceRole,
    platforms: strategy.discoveryBrief.platforms,
    discoveryModes: strategy.discoveryBrief.discoveryModes,
    lookbackDays: strategy.discoveryBrief.lookbackDays,
    resultLimit: strategy.discoveryBrief.resultLimit,
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
  platforms: ['tiktok', 'instagram', 'youtube'], discoveryModes: ['momentum', 'account', 'innovation'],
  lookbackDays: 7, resultLimit: 30, sceneClusters: [],
};

export default function DiscoveryScopePanel({ onAccountsCrawled }: { onAccountsCrawled: () => void }) {
  const [strategy, setStrategy] = useState<SocialCrawlStrategy | null>(null);
  const [editor, setEditor] = useState<SocialDiscoveryScopeInput>(EMPTY_INPUT);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [sceneText, setSceneText] = useState('');
  const [documentText, setDocumentText] = useState('');
  const [sourceMode, setSourceMode] = useState<'upload' | 'knowledge'>('upload');
  const [sourceName, setSourceName] = useState('');
  const [sourceRefs, setSourceRefs] = useState<string[]>([]);
  const [readingFile, setReadingFile] = useState(false);
  const [accounts, setAccounts] = useState<BenchmarkAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountUrl, setAccountUrl] = useState('');
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountBusyId, setAccountBusyId] = useState('');
  const [accountMessage, setAccountMessage] = useState('');
  const loadAccounts = async () => {
    setAccountsLoading(true);
    try {
      const response = await fetch('/api/overseas/competitor-accounts', { headers: authHeader() });
      if (!response.ok) throw new Error('对标账号库读取失败');
      const data = await response.json() as { items?: BenchmarkAccount[] };
      setAccounts(data.items ?? []);
    } catch (error) { setAccountMessage(error instanceof Error ? error.message : '对标账号库读取失败'); }
    finally { setAccountsLoading(false); }
  };
  useEffect(() => { if (open) void loadAccounts(); }, [open]);
  const addAccount = async () => {
    if (!accountUrl.trim()) { setAccountMessage('请填写对标账号主页链接'); return; }
    setAccountSaving(true); setAccountMessage('');
    try {
      const response = await fetch('/api/overseas/competitor-accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ url: accountUrl.trim() }),
      });
      const data = await response.json() as { error?: string; duplicated?: boolean };
      if (!response.ok) throw new Error(data.error || '添加对标账号失败');
      setAccountUrl('');
      setAccountMessage(data.duplicated ? '该账号已在库中' : '已加入对标账号库');
      await loadAccounts();
    } catch (error) { setAccountMessage(error instanceof Error ? error.message : '添加对标账号失败'); }
    finally { setAccountSaving(false); }
  };
  const crawlAccount = async (account: BenchmarkAccount) => {
    setAccountBusyId(account.id); setAccountMessage('');
    try {
      const response = await fetch(`/api/overseas/competitor-accounts/${encodeURIComponent(account.id)}/crawl`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify({ limit: 3 }),
      });
      const data = await response.json() as { error?: string; message?: string; imported?: number };
      if (!response.ok) throw new Error(data.error || '采集失败');
      setAccountMessage(data.message || `已从「${account.accountName}」采集 ${data.imported || 0} 条视频`);
      await loadAccounts(); onAccountsCrawled();
    } catch (error) { setAccountMessage(error instanceof Error ? error.message : '采集失败'); }
    finally { setAccountBusyId(''); }
  };
  const removeAccount = async (account: BenchmarkAccount) => {
    setAccountBusyId(account.id); setAccountMessage('');
    try {
      const response = await fetch(`/api/overseas/competitor-accounts/${encodeURIComponent(account.id)}`, { method: 'DELETE', headers: authHeader() });
      if (!response.ok) throw new Error('移除对标账号失败');
      setAccounts(current => current.filter(item => item.id !== account.id));
    } catch (error) { setAccountMessage(error instanceof Error ? error.message : '移除对标账号失败'); }
    finally { setAccountBusyId(''); }
  };
  const fileVersion = useRef(0);
  const uploadFile = async (file: File) => {
    const version = ++fileVersion.current;
    ++requestVersion.current;
    setRecommending(false);
    setReadingFile(true);
    setRecommendedFor('');
    attempted.current = '';
    setMessage('');
    setDocumentText('');
    setSourceName('');
    setSourceRefs([]);
    setEditor(current => ({ ...current, keywordRecommendation: undefined, productQueries: [] }));
    try {
      const text = await readProductDiscoveryFile(file);
      if (version !== fileVersion.current) return;
      setDocumentText(text);
      setSourceName(file.name);
      setSceneText('');
      setEditor(current => ({ ...current, productRef: file.name.replace(/\.[^.]+$/, ''), keywordRecommendation: undefined, productQueries: [], sceneClusters: [] }));
    } catch (error) { if (version === fileVersion.current) setMessage(error instanceof Error ? error.message : '文件读取失败'); }
    finally { if (version === fileVersion.current) setReadingFile(false); }
  };
  const [recommending, setRecommending] = useState(false);
  const [recommendedFor, setRecommendedFor] = useState('');
  const attempted = useRef('');
  const requestVersion = useRef(0);
  const factsKey = JSON.stringify([editor.productRef, editor.market, editor.language, editor.companyRole, editor.audienceRole, sceneText, documentText, sourceName, sourceRefs]);
  const factsRef = useRef(factsKey);
  factsRef.current = factsKey;
  const recommend = async () => {
    if (!documentText) { setMessage('请上传企业手册、产品手册，或从企业知识库选择资料后再推荐；已保存的5个词仍可查看和修改。'); return; }
    const key = factsKey;
    const version = ++requestVersion.current;
    attempted.current = key;
    setRecommendedFor('');
    setRecommending(true);
    setMessage('');
    try {
      const result = await socialDiscoveryApi.recommendProducts({ ...editor, documentText: documentText || undefined, sourceName: sourceName || undefined, sourceRefs, focus: sceneText });
      if (version !== requestVersion.current || factsRef.current !== key) return;
      setEditor(current => ({ ...current, productTerms: [current.productRef], productQueries: fiveProductKeywords(result), sceneClusters: [], keywordRecommendation: result }));
      setRecommendedFor(key);
    } catch (error) {
      if (version === requestVersion.current && factsRef.current === key) setMessage(error instanceof Error ? error.message : '推荐生成失败');
    } finally { if (version === requestVersion.current) setRecommending(false); }
  };
  useEffect(() => {
    if (!open || readingFile || !sourceName || !editor.productRef.trim() || !editor.market.trim() || !editor.language.trim() || factsKey === recommendedFor || attempted.current === factsKey) return;
    const timer = setTimeout(() => { void recommend(); }, 800);
    return () => clearTimeout(timer);
  }, [open, factsKey, recommendedFor, readingFile, sourceName]);
  const previewKeywords = [...new Set([...(editor.productQueries ?? []), ...editor.sceneClusters.filter(scene => scene.status === 'approved' || scene.status === 'watching').flatMap(scene => scene.queryVariants ?? [])])];

  useEffect(() => {
    let active = true;
    void socialDiscoveryApi.getScope().then(result => {
      if (!active) return;
      setStrategy(result.scope);
      setEditor(inputFromStrategy(result.scope));
      setSceneText('');
      if (result.scope.keywordRecommendation) {
        const value = inputFromStrategy(result.scope);
        setRecommendedFor(JSON.stringify([value.productRef, value.market, value.language, value.companyRole, value.audienceRole, '', '', '', []]));
      }
    }).catch(error => {
      if (active) setMessage(error instanceof Error ? error.message : '发现范围尚未建立');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const scenes = useMemo(() => strategy?.keywordSet.graph.sceneClusters.filter(item => item.status !== 'rejected') ?? [], [strategy]);

  const save = async () => {
    setSaving(true);
    setMessage('');
    try {

      const result = await socialDiscoveryApi.saveScope({
        ...editor,
        productQueries: (editor.productQueries ?? []).map(term => term.trim()).filter(Boolean),
        productTerms: [editor.productRef],
        sceneClusters: [],
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
                <p className="mt-1 text-[10px] leading-4 text-text-muted">{COMPANY_ROLE_LABEL[strategy.keywordSet.scope.companyRole]} · {strategy.keywordSet.scope.language || '未确认语言'} · {strategy.discoveryBrief.platforms.join(' / ')} · {strategy.keywordRecommendation ? '2个大词 · 3个中词' : `${scenes.length} 个场景簇`}</p>
              </> : <p className="mt-1 text-xs font-bold text-amber-900">尚未确认产品、市场和沟通对象，系统不会凭空使用行业词。</p>}
          </div>
        </div>
        <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-cyan-200 bg-white px-3 text-xs font-black text-cyan-900 hover:border-cyan-400">
          <SlidersHorizontal size={14} />调整发现范围<ChevronRight size={13} />
        </button>
      </div>
      {strategy?.keywordRecommendation && <div className="mt-2 flex flex-wrap gap-1.5">{[...strategy.keywordRecommendation.broadTerms, ...strategy.keywordRecommendation.mediumTerms].map(item => <span key={item.term} className="rounded-full bg-white px-2 py-1 text-xs text-emerald-900">{item.term}</span>)}</div>}
      {scenes.length > 0 && <div className="mt-2.5 flex flex-wrap gap-1.5">{scenes.slice(0, 6).map(scene => <span key={scene.sceneId} className="rounded-full bg-white px-2 py-1 text-[9px] font-bold text-cyan-900">{scene.label}</span>)}</div>}
      {message && <p className={`mt-2 text-[10px] font-semibold ${strategy ? 'text-emerald-800' : 'text-amber-900'}`}>{message}</p>}
    </section>

    {open && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="discovery-scope-title" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black text-accent">灵感中心</p><h3 id="discovery-scope-title" className="mt-1 text-lg font-black text-text-primary">调整发现范围</h3><p className="mt-1 text-xs leading-5 text-text-muted">上传产品资料，结合经营模式和企业角色，生成2个大词与3个中词。</p></div><button type="button" aria-label="关闭" onClick={() => setOpen(false)} disabled={saving} className="rounded-lg p-2 text-text-muted hover:bg-surface-2"><X size={18} /></button></div>
        <div className="mt-4 flex gap-2 text-xs"><button type="button" disabled={saving || readingFile} className={`rounded-lg px-3 py-2 ${sourceMode === 'upload' ? 'bg-emerald-100 font-bold text-emerald-900' : 'bg-surface-2'}`} onClick={() => setSourceMode('upload')}>上传产品文件</button><button type="button" disabled={saving || readingFile} className={`rounded-lg px-3 py-2 ${sourceMode === 'knowledge' ? 'bg-emerald-100 font-bold text-emerald-900' : 'bg-surface-2'}`} onClick={() => setSourceMode('knowledge')}>从企业知识库选择</button></div>
        {sourceMode === 'knowledge' && <DiscoveryProductPicker disabled={saving || readingFile || recommending} onReference={(text, name, refs) => {
          ++requestVersion.current;
          attempted.current = '';
          setRecommending(false);
          setDocumentText(text); setSourceName(name); setSourceRefs(refs); setSceneText(''); setMessage(''); setRecommendedFor('');
          setEditor(current => ({ ...current, productRef: '企业知识库所选产品', productQueries: [], sceneClusters: [], keywordRecommendation: undefined }));
        }} />}
        {sourceMode === 'upload' && <label className="mt-4 block rounded-lg border border-dashed border-emerald-300 bg-emerald-50 p-3 text-xs font-bold">上传产品资料（PDF / Excel / CSV / TXT）
          <input type="file" accept=".pdf,.xlsx,.xls,.csv,.txt" disabled={saving} className="mt-2 block w-full text-xs" onChange={event => { const file = event.target.files?.[0]; if (file) void uploadFile(file); event.target.value = ''; }} />
          <span className="mt-2 block font-normal">{readingFile ? '正在读取资料…' : sourceName || editor.keywordRecommendation?.sourceName || '请上传企业或产品手册；PDF最大50MB、100页且需包含文字，其他文件最大10MB。'}</span>
        </label>}
        {sourceName && <p className="mt-2 break-words text-xs text-emerald-900">当前引用：{sourceName}</p>}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-bold text-text-secondary">本次产品范围<input value={editor.productRef} onChange={event => { setEditor(current => ({ ...current, productRef: event.target.value, productTerms: [], productQueries: [], sceneClusters: [] })); setSceneText(''); }} className="mt-1.5 h-11 w-full rounded-lg border border-border px-3 text-sm text-text-primary outline-none focus:border-accent" placeholder="例如：积雪草修护精华" /></label>
          <label className="text-xs font-bold text-text-secondary">目标市场<input value={editor.market} onChange={event => setEditor(current => ({ ...current, market: event.target.value }))} className="mt-1.5 h-11 w-full rounded-lg border border-border px-3 text-sm text-text-primary outline-none focus:border-accent" placeholder="例如：美国" /></label>
          <label className="text-xs font-bold text-text-secondary">内容语言<input value={editor.language} onChange={event => setEditor(current => ({ ...current, language: event.target.value }))} className="mt-1.5 h-11 w-full rounded-lg border border-border px-3 text-sm text-text-primary outline-none focus:border-accent" /></label>
          <label className="text-xs font-bold text-text-secondary">企业角色<select value={editor.companyRole} onChange={event => setEditor(current => ({ ...current, companyRole: event.target.value as SocialDiscoveryScopeInput['companyRole'] }))} className="mt-1.5 h-11 w-full rounded-lg border border-border px-3 text-sm text-text-primary outline-none focus:border-accent">{Object.entries(COMPANY_ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs font-bold text-text-secondary sm:col-span-2">主要沟通对象<select value={editor.audienceRole} onChange={event => setEditor(current => ({ ...current, audienceRole: event.target.value as SocialDiscoveryScopeInput['audienceRole'] }))} className="mt-1.5 h-11 w-full rounded-lg border border-border px-3 text-sm text-text-primary outline-none focus:border-accent">{Object.entries(AUDIENCE_ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs font-bold text-text-secondary sm:col-span-2">本次聚焦方向（选填）<textarea value={sceneText} onChange={event => setSceneText(event.target.value)} className="mt-1.5 min-h-16 w-full rounded-lg border border-border p-3 text-sm text-text-primary outline-none focus:border-accent" placeholder="例如：只采集面膜和面部喷雾；留空则聚焦资料主要品类" /></label>
        </div>
        <label className="mt-4 block text-xs font-bold text-text-secondary">采集关键词（每行一个，建议 2 个大词、3 个中词）
          <textarea aria-label="采集关键词" value={(editor.productQueries ?? []).join('\n')} onChange={event => {
            const terms = event.target.value.split(/\n/);
            setEditor(current => ({ ...current, productQueries: terms, keywordRecommendation: undefined }));
          }} className="mt-1.5 min-h-28 w-full rounded-lg border border-border p-3 text-sm font-medium text-text-primary outline-none focus:border-accent" placeholder="每行输入一个关键词" />
        </label>
        <details className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <summary className="cursor-pointer text-xs font-bold text-emerald-900">AI 智能推荐搜索关键词 · 默认 5 个（3 个中词、2 个大词）</summary>
          <div className="mt-3">
          <div className="flex items-center justify-between"><p className="text-xs font-bold">推荐采集关键词</p><button type="button" onClick={() => void recommend()} disabled={readingFile || recommending || saving || !editor.productRef.trim() || !editor.market.trim() || !editor.language.trim()} className="text-xs font-bold text-accent disabled:opacity-50">{recommending ? '正在生成…' : '重新推荐'}</button></div>
          <p className="mt-1 text-xs text-text-muted">固定5个词：2个大词找经营方向，3个中词找具体产品。保存后用于视频定时采集；生成结果尚未试采验证。</p>
          {factsKey !== recommendedFor ? <p className="mt-2 text-xs text-text-muted">{recommending ? '正在根据产品资料生成5个词…' : message ? '请处理下方提示后重新推荐。' : '点击重新推荐，生成当前范围的5个搜索词。'}</p> : editor.keywordRecommendation && <div className="mt-3 space-y-3">
            <p className="text-xs font-bold">已按{({ factory: '工厂生产', supplier: '供应与批发', consumer: '消费者零售' })[editor.keywordRecommendation.perspective]}方向生成</p>
            {(['broadTerms', 'mediumTerms'] as const).map(group => <div key={group}><p className="text-xs font-bold">{group === 'broadTerms' ? '大词 · 2个' : '中词 · 3个'}</p>{editor.keywordRecommendation![group].map((item, index) => <div key={index} className="mt-2 rounded-lg bg-white p-2">
              <input aria-label={`${group === 'broadTerms' ? '大词' : '中词'}${index + 1}`} value={item.term} onChange={event => setEditor(current => {
                const recommendation = { ...current.keywordRecommendation!, [group]: current.keywordRecommendation![group].map((row, i) => i === index ? { ...row, term: event.target.value } : row) };
                return { ...current, keywordRecommendation: recommendation, productQueries: [...recommendation.broadTerms, ...recommendation.mediumTerms].map(row => row.term) };
              })} className="w-full border-b border-emerald-100 bg-transparent text-sm font-bold text-emerald-900" />
              <p className="mt-1 text-xs text-text-muted">{item.reason}</p><details className="mt-1 text-xs text-text-muted"><summary>产品依据</summary>{item.sourceQuote}</details>
            </div>)}</div>)}
            <p className="text-xs text-text-muted">可直接修改搜索词，保存前会检查数量和重复。</p>
          </div>}

          </div>
        </details>
        <section className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50/40 p-3" aria-label="对标账号库">
          <div><h4 className="text-sm font-bold text-text-primary">对标账号库</h4><p className="mt-1 text-xs text-text-muted">已保存账号常驻此处，可直接采集最新视频。</p></div>
          {accountsLoading ? <p className="mt-3 text-xs text-text-muted">正在读取账号…</p> : accounts.length ? <ul className="mt-3 space-y-1.5">{accounts.map(account => <li key={account.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs"><span className="shrink-0 font-bold text-cyan-900">{account.platform}</span><a href={account.accountUrl} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-text-primary hover:underline">{account.accountName}</a><button type="button" disabled={Boolean(accountBusyId)} onClick={() => void crawlAccount(account)} className="rounded border border-cyan-200 px-2 py-1 font-bold text-cyan-900 disabled:opacity-50">{accountBusyId === account.id ? '处理中…' : '采集最新'}</button><button type="button" disabled={Boolean(accountBusyId)} onClick={() => void removeAccount(account)} className="rounded border border-border px-2 py-1 text-text-muted disabled:opacity-50">移除</button></li>)}</ul> : <p className="mt-3 text-xs text-text-muted">暂无对标账号。</p>}
          <details className="mt-3 border-t border-cyan-100 pt-3"><summary className="cursor-pointer text-xs font-bold text-cyan-900">人工手动添加对标账号</summary><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input aria-label="对标账号主页链接" type="url" value={accountUrl} onChange={event => setAccountUrl(event.target.value)} placeholder="粘贴 YouTube / TikTok / Instagram / Facebook 账号主页链接" className="min-w-0 flex-1 rounded-lg border border-border bg-white px-3 py-2 text-sm" /><button type="button" disabled={accountSaving} onClick={() => void addAccount()} className="rounded-lg bg-cyan-800 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{accountSaving ? '添加中…' : '添加到账号库'}</button></div></details>
          {accountMessage && <p role="status" className="mt-2 text-xs text-cyan-900">{accountMessage}</p>}
        </section>
        {message && <p className="mt-3 text-xs font-semibold text-amber-900">{message}</p>}
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)} disabled={saving} className="btn-ghost">取消</button><button type="button" onClick={() => void save()} disabled={readingFile || saving || recommending || (Boolean(editor.keywordRecommendation) && recommendedFor !== factsKey) || !previewKeywords.some(term => term.trim()) || !editor.productRef.trim() || !editor.market.trim() || !editor.language.trim()} className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-50">{saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}保存并用于后续采集</button></div>
      </section>
    </div>}
  </>;
}
