import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Beaker,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleOff,
  FlaskConical,
  Loader2,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { PAGE_REGISTRY } from '../pageRegistry';
import {
  createContentFormula,
  disableContentFormula,
  listContentFormulas,
  publishContentFormula,
  startContentFormulaTrial,
  type ContentFormula,
  type ContentFormulaNode,
  type ContentFormulaStatus,
  type ContentThemeId,
} from '../lib/contentFormulas';

const THEME_LABELS: Record<ContentThemeId, string> = {
  product_value: '产品与卖点',
  scenario_solution: '场景与解决方案',
  supplier_capability: '企业与供应保障',
  customization_process: '定制与合作流程',
  customer_case: '客户案例与合作成果',
};

const STATUS_LABELS: Record<ContentFormulaStatus, string> = {
  draft: '草稿', internal_trial: '内测', gray: '灰度中', active: '已启用', disabled: '已停用',
};

const STATUS_TONES: Record<ContentFormulaStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  internal_trial: 'bg-violet-100 text-violet-800',
  gray: 'bg-amber-100 text-amber-800',
  active: 'bg-emerald-100 text-emerald-800',
  disabled: 'bg-red-100 text-red-700',
};

type DraftNode = Pick<ContentFormulaNode, 'nodeId' | 'shotFunction' | 'subject' | 'action'>;

const NEW_NODE = (index: number): DraftNode => ({
  nodeId: `shot_${index + 1}`,
  shotFunction: '',
  subject: '',
  action: '',
});

function nextFormulaId(name: string) {
  const seed = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `custom.${seed || `formula-${Date.now().toString(36)}`}`;
}

function statusHint(formula: ContentFormula) {
  if (!formula.recordId) return '系统内置，只读';
  if (formula.status === 'draft') return '可先进入内测，不会影响客户';
  if (formula.status === 'internal_trial') return '内测通过后可灰度或全量发布';
  if (formula.status === 'gray') return `当前仅覆盖 ${formula.rollout.tenantAllowlist.length} 个指定租户`;
  if (formula.status === 'active') return '主题匹配时可被正式选中';
  return '已从匹配池移除';
}

export default function ContentFormulaAdminPage() {
  const [items, setItems] = useState<ContentFormula[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingKey, setActingKey] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [grayTenantInputs, setGrayTenantInputs] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [formulaId, setFormulaId] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [themeId, setThemeId] = useState<ContentThemeId>('product_value');
  const [nodes, setNodes] = useState<DraftNode[]>([NEW_NODE(0), NEW_NODE(1), NEW_NODE(2)]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setItems(await listContentFormulas()); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : '无法读取爆款公式'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => ({
    active: items.filter(item => item.status === 'active').length,
    testing: items.filter(item => item.status === 'internal_trial' || item.status === 'gray').length,
    draft: items.filter(item => item.status === 'draft').length,
  }), [items]);

  const resetEditor = () => {
    setName(''); setFormulaId(''); setVersion('1.0.0'); setThemeId('product_value');
    setNodes([NEW_NODE(0), NEW_NODE(1), NEW_NODE(2)]);
  };

  const submit = async () => {
    const cleanName = name.trim();
    const cleanId = (formulaId.trim() || nextFormulaId(cleanName)).toLowerCase();
    if (!cleanName || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(version.trim())) {
      setError('请填写公式名称，并使用 1.0.0 这样的版本号。'); return;
    }
    if (nodes.some(node => !node.nodeId.trim() || !node.shotFunction.trim() || !node.subject.trim() || !node.action.trim())) {
      setError('每个镜头节点都要写清用途、拍摄对象和动作。'); return;
    }
    setActingKey('create'); setError(''); setNotice('');
    try {
      await createContentFormula({
        formulaId: cleanId,
        name: cleanName,
        version: version.trim(),
        themeId,
        nodes: nodes.map(node => ({
          ...node,
          nodeId: node.nodeId.trim(),
          shotFunction: node.shotFunction.trim(),
          subject: node.subject.trim(),
          action: node.action.trim(),
          environment: null,
          orientation: 'portrait',
          durationSeconds: { minimum: 2, maximum: 8 },
          required: true,
        })),
        note: '由爆款公式库创建',
      });
      setNotice('公式草稿已保存。先内测，再灰度或正式启用。');
      setShowEditor(false); resetEditor(); await load();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : '公式保存失败'); }
    finally { setActingKey(''); }
  };

  const act = async (formula: ContentFormula, action: 'trial' | 'gray' | 'active' | 'disable') => {
    const key = `${formula.formulaId}:${formula.version}:${action}`;
    const formulaKey = `${formula.formulaId}:${formula.version}`;
    const grayTenantAllowlist = action === 'gray'
      ? [...new Set((grayTenantInputs[formulaKey] ?? formula.rollout.tenantAllowlist.join(',')).split(/[,，\s]+/).map(item => item.trim()).filter(Boolean))]
      : [];
    if (action === 'gray' && grayTenantAllowlist.length === 0) {
      setError('灰度发布前，请至少填写一个明确的租户 ID。'); return;
    }
    setActingKey(key); setError(''); setNotice('');
    try {
      if (action === 'trial') await startContentFormulaTrial(formula);
      if (action === 'gray') await publishContentFormula(formula, 'gray', { percentage: 0, tenantAllowlist: grayTenantAllowlist });
      if (action === 'active') await publishContentFormula(formula, 'active');
      if (action === 'disable') await disableContentFormula(formula);
      setNotice(action === 'trial' ? '已进入内测，不影响普通用户。' : action === 'gray' ? `已仅向 ${grayTenantAllowlist.length} 个指定租户开放。` : action === 'active' ? '公式已正式启用。' : '公式已停用。');
      await load();
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : '操作失败'); }
    finally { setActingKey(''); }
  };

  const updateNode = (index: number, key: keyof DraftNode, value: string) => {
    setNodes(current => current.map((node, nodeIndex) => nodeIndex === index ? { ...node, [key]: value } : node));
  };

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-surface-2 p-4 md:p-6">
      <div className="mx-auto flex max-w-[1450px] flex-col gap-5">
        <header className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-bold text-accent">平台管理员专用</p>
            <h1 className="mt-1 text-2xl font-black text-text-primary">{PAGE_REGISTRY.contentFormulaAdmin.canonicalTitle}</h1>
            <p className="mt-1 text-sm text-text-muted">用户只看到主题和拍摄要求；公式名称、版本与灰度策略不会出现在用户账号。</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-border bg-white px-4 py-2 text-sm font-bold text-text-secondary disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} />刷新</button>
            <button type="button" onClick={() => setShowEditor(value => !value)} className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-black text-white"><Plus size={15} />录入公式</button>
          </div>
        </header>

        {(error || notice) && <div role="status" className={`rounded-xl border px-4 py-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{error || notice}</div>}

        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-border bg-white p-4"><p className="text-xs font-bold text-text-muted">正式启用</p><p className="mt-2 text-2xl font-black text-emerald-700">{counts.active}</p></div>
          <div className="rounded-2xl border border-border bg-white p-4"><p className="text-xs font-bold text-text-muted">内测 / 灰度</p><p className="mt-2 text-2xl font-black text-violet-700">{counts.testing}</p></div>
          <div className="rounded-2xl border border-border bg-white p-4"><p className="text-xs font-bold text-text-muted">待验证草稿</p><p className="mt-2 text-2xl font-black text-slate-700">{counts.draft}</p></div>
        </section>

        {showEditor && (
          <section className="rounded-2xl border border-accent/30 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3"><FlaskConical size={20} className="mt-0.5 text-accent" /><div><h2 className="text-base font-black text-text-primary">录入一个新公式草稿</h2><p className="mt-1 text-xs text-text-muted">一个节点对应一种必须拍到的镜头功能。保存后不会直接给客户使用。</p></div></div>
            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="text-xs font-bold text-text-secondary">公式名称<input value={name} onChange={event => { setName(event.target.value); if (!formulaId) setFormulaId(nextFormulaId(event.target.value)); }} placeholder="例如：工厂实力证据链" className="mt-1.5 w-full rounded-xl border border-border px-3 py-2.5 text-sm font-normal outline-none focus:border-accent" /></label>
              <label className="text-xs font-bold text-text-secondary">内部编号<input value={formulaId} onChange={event => setFormulaId(event.target.value)} placeholder="custom.factory-proof" className="mt-1.5 w-full rounded-xl border border-border px-3 py-2.5 text-sm font-normal outline-none focus:border-accent" /></label>
              <label className="text-xs font-bold text-text-secondary">版本<input value={version} onChange={event => setVersion(event.target.value)} className="mt-1.5 w-full rounded-xl border border-border px-3 py-2.5 text-sm font-normal outline-none focus:border-accent" /></label>
              <label className="text-xs font-bold text-text-secondary">匹配主题<select value={themeId} onChange={event => setThemeId(event.target.value as ContentThemeId)} className="mt-1.5 w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-accent">{Object.entries(THEME_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            </div>
            <div className="mt-5 space-y-3">
              {nodes.map((node, index) => <div key={index} className="grid gap-2 rounded-xl border border-border bg-slate-50 p-3 md:grid-cols-[130px_1fr_1fr_1fr_auto]">
                <input value={node.nodeId} onChange={event => updateNode(index, 'nodeId', event.target.value)} aria-label={`节点 ${index + 1} 编号`} placeholder="节点编号" className="rounded-lg border border-border bg-white px-3 py-2 text-xs outline-none focus:border-accent" />
                <input value={node.shotFunction} onChange={event => updateNode(index, 'shotFunction', event.target.value)} aria-label={`节点 ${index + 1} 镜头用途`} placeholder="镜头用途：证明什么" className="rounded-lg border border-border bg-white px-3 py-2 text-xs outline-none focus:border-accent" />
                <input value={node.subject} onChange={event => updateNode(index, 'subject', event.target.value)} aria-label={`节点 ${index + 1} 拍摄对象`} placeholder="拍什么" className="rounded-lg border border-border bg-white px-3 py-2 text-xs outline-none focus:border-accent" />
                <input value={node.action} onChange={event => updateNode(index, 'action', event.target.value)} aria-label={`节点 ${index + 1} 拍摄动作`} placeholder="怎么拍 / 做什么" className="rounded-lg border border-border bg-white px-3 py-2 text-xs outline-none focus:border-accent" />
                <button type="button" aria-label={`删除节点 ${index + 1}`} disabled={nodes.length <= 1} onClick={() => setNodes(current => current.filter((_, nodeIndex) => nodeIndex !== index))} className="rounded-lg border border-border bg-white p-2 text-text-muted disabled:opacity-30"><Trash2 size={15} /></button>
              </div>)}
            </div>
            <div className="mt-4 flex flex-wrap justify-between gap-2"><button type="button" onClick={() => setNodes(current => [...current, NEW_NODE(current.length)])} className="rounded-xl border border-border bg-white px-4 py-2 text-xs font-bold text-text-secondary">+ 增加镜头节点</button><div className="flex gap-2"><button type="button" onClick={() => setShowEditor(false)} className="rounded-xl border border-border bg-white px-4 py-2 text-xs font-bold text-text-secondary">取消</button><button type="button" onClick={() => void submit()} disabled={actingKey === 'create'} className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2 text-xs font-black text-white disabled:opacity-50">{actingKey === 'create' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}保存草稿</button></div></div>
          </section>
        )}

        <section className="space-y-3">
          {loading && !items.length ? <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-white p-16 text-sm text-text-muted"><Loader2 size={18} className="animate-spin" />正在读取公式库</div> : items.map(formula => {
            const key = `${formula.formulaId}:${formula.version}`;
            const open = expanded.includes(key);
            const busy = actingKey.startsWith(`${key}:`);
            return <article key={key} className="overflow-hidden rounded-2xl border border-border bg-white">
              <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-black text-text-primary">{formula.name}</h2><span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${STATUS_TONES[formula.status]}`}>{STATUS_LABELS[formula.status]}</span>{!formula.recordId && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-blue-700"><ShieldCheck size={11} className="mr-1 inline" />系统内置</span>}</div>
                  <p className="mt-1 text-xs text-text-muted">{THEME_LABELS[formula.themeId]} · {formula.formulaId} · v{formula.version} · {formula.nodes.length} 个镜头节点</p>
                  <p className="mt-2 text-xs font-bold text-text-secondary">{statusHint(formula)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {formula.recordId && formula.status === 'draft' && <button type="button" disabled={busy} onClick={() => void act(formula, 'trial')} className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"><Beaker size={13} />进入内测</button>}
                  {formula.recordId && ['internal_trial', 'gray'].includes(formula.status) && <input aria-label={`${formula.name} 灰度租户 ID`} value={grayTenantInputs[key] ?? formula.rollout.tenantAllowlist.join(', ')} onChange={event => setGrayTenantInputs(current => ({ ...current, [key]: event.target.value }))} placeholder="灰度租户 ID，逗号分隔" className="min-w-[220px] rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs outline-none focus:border-amber-500" />}
                  {formula.recordId && ['internal_trial', 'gray'].includes(formula.status) && <button type="button" disabled={busy} onClick={() => void act(formula, 'gray')} className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-xs font-black text-white disabled:opacity-50"><Rocket size={13} />按名单灰度</button>}
                  {formula.recordId && ['internal_trial', 'gray'].includes(formula.status) && <button type="button" disabled={busy} onClick={() => void act(formula, 'active')} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50"><CheckCircle2 size={13} />正式启用</button>}
                  {formula.recordId && formula.status !== 'disabled' && <button type="button" disabled={busy} onClick={() => void act(formula, 'disable')} className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 disabled:opacity-50"><CircleOff size={13} />停用</button>}
                  <button type="button" onClick={() => setExpanded(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key])} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary">查看节点{open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</button>
                </div>
              </div>
              {open && <div className="border-t border-border bg-slate-50 p-5"><div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">{formula.nodes.map((node, index) => <div key={node.nodeId} className="rounded-xl border border-border bg-white p-3"><p className="text-[10px] font-black text-accent">镜头 {index + 1} · {node.required ? '必拍' : '选拍'}</p><p className="mt-1 text-sm font-black text-text-primary">{node.shotFunction}</p><p className="mt-2 text-xs text-text-secondary">对象：{node.subject}</p><p className="mt-1 text-xs text-text-secondary">动作：{node.action}</p></div>)}</div>{formula.audit.length > 0 && <p className="mt-4 text-[11px] text-text-muted">最近记录：{formula.audit.at(-1)?.event} · {formula.audit.at(-1)?.at}</p>}</div>}
            </article>;
          })}
          {!loading && !items.length && <div className="rounded-2xl border border-border bg-white p-14 text-center"><AlertCircle size={30} className="mx-auto text-slate-300" /><p className="mt-3 text-sm font-black text-text-primary">公式库为空</p><p className="mt-1 text-xs text-text-muted">先录入草稿，再经过内测与灰度后启用。</p></div>}
        </section>
      </div>
    </main>
  );
}
