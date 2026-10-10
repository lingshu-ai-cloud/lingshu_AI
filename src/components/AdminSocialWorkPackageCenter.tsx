import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  Loader2,
  PackageCheck,
  Pencil,
  Plus,
  RefreshCcw,
  Save,
  X,
} from 'lucide-react';
import {
  SOCIAL_WORK_PACKAGE_KINDS,
  type SocialWorkPackageFramework,
  type SocialWorkPackageKind,
  type SocialWorkPackageStatus,
  type SocialWorkPackageVersionDetail,
} from '../../shared/contracts/socialContentWorkflow';
import {
  SOCIAL_WORK_PACKAGE_TRANSITIONS,
  socialWorkPackageActivationMissing,
  socialWorkPackageAdminApi,
} from '../lib/socialWorkPackageAdminApi';

const KIND_LABELS: Record<SocialWorkPackageKind, string> = {
  industry_launch: '行业起航包',
  content_rocket: '内容火箭包',
  task_express: '任务飞车包',
};

const STATUS_LABELS: Record<SocialWorkPackageStatus, string> = {
  draft: '草稿',
  internal_trial: '内部试用',
  active: '正式可用',
  retired: '停用',
};

const STATUS_TONES: Record<SocialWorkPackageStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  internal_trial: 'bg-amber-50 text-amber-700',
  active: 'bg-emerald-50 text-emerald-700',
  retired: 'bg-slate-100 text-slate-500',
};

const STATUS_ACTIONS: Record<SocialWorkPackageStatus, string> = {
  draft: '退回草稿',
  internal_trial: '进入内部试用',
  active: '设为正式可用',
  retired: '停用',
};

const FRAMEWORK_FIELDS: Array<{
  key: keyof SocialWorkPackageFramework;
  label: string;
}> = [
  { key: 'applicability', label: '适用范围' },
  { key: 'requiredInputs', label: '需要资料' },
  { key: 'workOutline', label: '作业步骤' },
  { key: 'deliverables', label: '交付清单' },
  { key: 'userDecisions', label: '客户确认点' },
  { key: 'qualityChecks', label: '质量检查' },
  { key: 'metricRequirements', label: '数据回收要求' },
  { key: 'fallbackPolicy', label: '异常处理' },
];

const EMPTY_FRAMEWORK: SocialWorkPackageFramework = {
  applicability: [],
  requiredInputs: [],
  workOutline: [],
  deliverables: [],
  userDecisions: [],
  qualityChecks: [],
  metricRequirements: [],
  fallbackPolicy: [],
};

type Selection = { packageKey: string; version: string };

type EditorDraft = {
  mode: 'create' | 'edit';
  kind: SocialWorkPackageKind;
  packageKey: string;
  version: string;
  name: string;
  summary: string;
  framework: SocialWorkPackageFramework;
  effectiveFrom: string;
  effectiveUntil: string;
  recordVersion: string | null;
};

function versionIdentity(item: Selection): string {
  return `${item.packageKey}\u0000${item.version}`;
}

function dateInputValue(value: string | null): string {
  if (!value) return '';
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return '';
  const offset = time.getTimezoneOffset() * 60_000;
  return new Date(time.getTime() - offset).toISOString().slice(0, 16);
}

function isoValue(value: string): string | null {
  if (!value) return null;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? null : time.toISOString();
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '更新时间未知'
    : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function frameworkDraft(source?: SocialWorkPackageFramework): SocialWorkPackageFramework {
  return Object.fromEntries(FRAMEWORK_FIELDS.map(field => [field.key, [...(source?.[field.key] || [])]])) as unknown as SocialWorkPackageFramework;
}

function PackageStatus({ status }: { status: SocialWorkPackageStatus }) {
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${STATUS_TONES[status]}`}>{STATUS_LABELS[status]}</span>;
}

function CustomerCardPreview({ item }: { item: SocialWorkPackageVersionDetail }) {
  return (
    <aside aria-label="客户卡片预览" className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-600"><PackageCheck size={17} /></span>
        <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${item.available ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>
          {item.available ? '可选择' : '暂不展示'}
        </span>
      </div>
      <p className="mt-4 text-[10px] font-bold text-emerald-700">客户卡片预览</p>
      <h4 className="mt-1 text-base font-black text-text-primary">{item.name}</h4>
      <p className="mt-1 text-xs text-text-muted">版本 {item.version}</p>
      <div className="mt-4 space-y-3 border-t border-emerald-100 pt-3 text-xs">
        <div><p className="text-[10px] font-bold text-text-muted">适用说明</p><p className="mt-1 leading-5 text-text-secondary">{item.summary || '未填写'}</p></div>
        <div><p className="text-[10px] font-bold text-text-muted">需要资料</p>{item.framework.requiredInputs.length > 0 ? <ul className="mt-1 space-y-1 leading-5 text-text-secondary">{item.framework.requiredInputs.slice(0, 3).map((value, index) => <li key={`${value}:${index}`}>{index + 1}. {value}</li>)}</ul> : <p className="mt-1 text-text-secondary">未填写</p>}</div>
        <div><p className="text-[10px] font-bold text-text-muted">交付内容</p>{item.framework.deliverables.length > 0 ? <ul className="mt-1 space-y-1 leading-5 text-text-secondary">{item.framework.deliverables.slice(0, 3).map((value, index) => <li key={`${value}:${index}`}>{index + 1}. {value}</li>)}</ul> : <p className="mt-1 text-text-secondary">未填写</p>}</div>
      </div>
    </aside>
  );
}

function FrameworkOverview({ framework }: { framework: SocialWorkPackageFramework }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {FRAMEWORK_FIELDS.map(field => (
        <article key={field.key} className="rounded-xl border border-border bg-surface-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-black text-text-secondary">{field.label}</p>
            <span className="text-[10px] font-bold text-text-muted">{framework[field.key].length} 项</span>
          </div>
          {framework[field.key].length > 0 ? (
            <ul className="mt-2 space-y-1 text-[11px] leading-5 text-text-secondary">
              {framework[field.key].slice(0, 3).map((item, index) => <li key={`${item}:${index}`} className="line-clamp-2">{index + 1}. {item}</li>)}
              {framework[field.key].length > 3 && <li className="font-bold text-text-muted">另有 {framework[field.key].length - 3} 项</li>}
            </ul>
          ) : <p className="mt-2 text-[11px] text-text-muted">尚未填写</p>}
        </article>
      ))}
    </div>
  );
}

function EditorDialog({
  draft,
  error,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  draft: EditorDraft;
  error: string;
  saving: boolean;
  onChange: (next: EditorDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const updateFramework = (key: keyof SocialWorkPackageFramework, value: string) => {
    onChange({
      ...draft,
      framework: {
        ...draft.framework,
        [key]: value.split('\n').map(item => item.trim()).filter(Boolean),
      },
    });
  };
  const previewItem: SocialWorkPackageVersionDetail = {
    kind: draft.kind,
    packageKey: draft.packageKey,
    version: draft.version || '—',
    name: draft.name || KIND_LABELS[draft.kind],
    summary: draft.summary || null,
    status: 'draft',
    available: false,
    framework: draft.framework,
    requiredInputs: draft.framework.requiredInputs,
    deliverables: draft.framework.deliverables,
    effectiveFrom: isoValue(draft.effectiveFrom),
    effectiveUntil: isoValue(draft.effectiveUntil),
    recordVersion: draft.recordVersion || 'new',
    updatedAt: new Date().toISOString(),
    builtin: false,
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/35 px-4 py-6">
      <div role="dialog" aria-modal="true" aria-labelledby="social-package-editor-title" className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-border bg-white shadow-2xl">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <p className="text-[11px] font-bold text-emerald-700">{KIND_LABELS[draft.kind]}</p>
            <h3 id="social-package-editor-title" className="mt-1 text-lg font-black text-text-primary">{draft.mode === 'create' ? '创建方案版本' : '编辑方案框架'}</h3>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="关闭" className="rounded-xl border border-border p-2 text-text-muted hover:text-text-primary disabled:opacity-50"><X size={15} /></button>
        </header>

        {error && <p role="alert" className="mx-5 mt-4 shrink-0 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-xs font-bold text-text-secondary">方案名称
                  <input value={draft.name} maxLength={120} onChange={event => onChange({ ...draft, name: event.target.value })} className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm font-normal outline-none focus:border-emerald-500" />
                </label>
                <label className="grid gap-1 text-xs font-bold text-text-secondary">版本编号
                  <input value={draft.version} disabled={draft.mode === 'edit'} maxLength={80} onChange={event => onChange({ ...draft, version: event.target.value.trim() })} placeholder="填写新版本编号" className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm font-normal outline-none focus:border-emerald-500 disabled:text-text-muted" />
                </label>
                <label className="grid gap-1 text-xs font-bold text-text-secondary sm:col-span-2">方案简介
                  <textarea value={draft.summary} maxLength={500} rows={2} onChange={event => onChange({ ...draft, summary: event.target.value })} placeholder="暂未填写" className="resize-none rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm font-normal leading-6 outline-none focus:border-emerald-500" />
                </label>
                <label className="grid gap-1 text-xs font-bold text-text-secondary">开始生效时间
                  <input type="datetime-local" value={draft.effectiveFrom} onChange={event => onChange({ ...draft, effectiveFrom: event.target.value })} className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm font-normal outline-none focus:border-emerald-500" />
                </label>
                <label className="grid gap-1 text-xs font-bold text-text-secondary">结束生效时间
                  <input type="datetime-local" value={draft.effectiveUntil} onChange={event => onChange({ ...draft, effectiveUntil: event.target.value })} className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm font-normal outline-none focus:border-emerald-500" />
                </label>
              </div>

              <div>
                <div className="mb-3"><h4 className="text-sm font-black text-text-primary">方案框架</h4><p className="mt-1 text-[11px] text-text-muted">每行填写一项，空白栏目可以稍后补充。</p></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {FRAMEWORK_FIELDS.map(field => (
                    <label key={field.key} className="grid gap-1 text-xs font-bold text-text-secondary">{field.label}
                      <textarea value={draft.framework[field.key].join('\n')} rows={4} onChange={event => updateFramework(field.key, event.target.value)} placeholder="每行一项" className="resize-y rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm font-normal leading-6 outline-none focus:border-emerald-500" />
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="lg:sticky lg:top-0 lg:self-start">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-black text-text-secondary"><Eye size={13} />预览</div>
              <CustomerCardPreview item={previewItem} />
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-4">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border border-border bg-white px-4 py-2 text-xs font-bold text-text-secondary disabled:opacity-50">取消</button>
          <button type="button" onClick={onSave} disabled={saving || !draft.name.trim() || !draft.version.trim()} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-4 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}{saving ? '保存中' : '保存版本'}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default function AdminSocialWorkPackageCenter() {
  const [items, setItems] = useState<SocialWorkPackageVersionDetail[]>([]);
  const [selectedKind, setSelectedKind] = useState<SocialWorkPackageKind>('industry_launch');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [editor, setEditor] = useState<EditorDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const next = await socialWorkPackageAdminApi.list();
      setItems(next);
      setSelection(current => {
        if (current && next.some(item => versionIdentity(item) === versionIdentity(current))) return current;
        const preferred = next.find(item => item.kind === selectedKind);
        return preferred ? { packageKey: preferred.packageKey, version: preferred.version } : null;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '作业方案读取失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const versions = useMemo(
    () => items.filter(item => item.kind === selectedKind),
    [items, selectedKind],
  );
  const selected = useMemo(() => {
    const exact = selection && items.find(item => versionIdentity(item) === versionIdentity(selection));
    return exact?.kind === selectedKind ? exact : versions[0] || null;
  }, [items, selectedKind, selection, versions]);
  const selectedActivationMissing = useMemo(
    () => selected ? socialWorkPackageActivationMissing(selected) : [],
    [selected],
  );

  const chooseKind = (kind: SocialWorkPackageKind) => {
    setSelectedKind(kind);
    const first = items.find(item => item.kind === kind);
    setSelection(first ? { packageKey: first.packageKey, version: first.version } : null);
  };

  const openCreate = () => {
    setError('');
    setNotice('');
    setEditor({
      mode: 'create',
      kind: selectedKind,
      packageKey: selected?.packageKey || selectedKind,
      version: '',
      name: selected?.name || KIND_LABELS[selectedKind],
      summary: '',
      framework: frameworkDraft(EMPTY_FRAMEWORK),
      effectiveFrom: '',
      effectiveUntil: '',
      recordVersion: null,
    });
  };

  const openEdit = (item: SocialWorkPackageVersionDetail) => {
    if (item.builtin || !['draft', 'internal_trial'].includes(item.status)) return;
    setError('');
    setNotice('');
    setEditor({
      mode: 'edit',
      kind: item.kind,
      packageKey: item.packageKey,
      version: item.version,
      name: item.name,
      summary: item.summary || '',
      framework: frameworkDraft(item.framework),
      effectiveFrom: dateInputValue(item.effectiveFrom),
      effectiveUntil: dateInputValue(item.effectiveUntil),
      recordVersion: item.recordVersion,
    });
  };

  const replaceItem = (next: SocialWorkPackageVersionDetail) => {
    setItems(current => [next, ...current.filter(item => versionIdentity(item) !== versionIdentity(next))]);
    setSelectedKind(next.kind);
    setSelection({ packageKey: next.packageKey, version: next.version });
  };

  const saveEditor = async () => {
    if (!editor || !editor.name.trim() || !editor.version.trim()) return;
    if (!/^[a-z0-9:_-]{1,200}$/i.test(editor.version.trim())) {
      setError('版本编号只能使用字母、数字、冒号、下划线和连字符');
      return;
    }
    if (FRAMEWORK_FIELDS.some(field => (
      editor.framework[field.key].length > 100
      || editor.framework[field.key].some(item => item.length > 500)
    ))) {
      setError('每个框架栏目最多填写 100 项，每项最多 500 个字');
      return;
    }
    const effectiveFrom = isoValue(editor.effectiveFrom);
    const effectiveUntil = isoValue(editor.effectiveUntil);
    if ((editor.effectiveFrom && !effectiveFrom) || (editor.effectiveUntil && !effectiveUntil)) {
      setError('请检查生效时间');
      return;
    }
    if (effectiveFrom && effectiveUntil && Date.parse(effectiveUntil) <= Date.parse(effectiveFrom)) {
      setError('结束时间需要晚于开始时间');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const common = {
        name: editor.name.trim(),
        summary: editor.summary.trim() || null,
        framework: editor.framework,
        effectiveFrom,
        effectiveUntil,
      };
      const saved = editor.mode === 'create'
        ? await socialWorkPackageAdminApi.createVersion({
          kind: editor.kind,
          packageKey: editor.packageKey,
          version: editor.version.trim(),
          ...common,
        })
        : await socialWorkPackageAdminApi.updateVersion(editor.packageKey, editor.version, {
          expectedVersion: editor.recordVersion || '',
          changes: common,
        });
      replaceItem(saved);
      setEditor(null);
      setNotice(editor.mode === 'create' ? '新版本已创建为草稿' : '方案框架已保存');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '方案保存失败');
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (item: SocialWorkPackageVersionDetail, status: SocialWorkPackageStatus) => {
    if (item.builtin) return;
    if (status === 'active') {
      const missing = socialWorkPackageActivationMissing(item);
      if (missing.length > 0) {
        setError(`正式可用前请补充：${missing.join('、')}`);
        return;
      }
    }
    if ((status === 'active' || status === 'retired') && !window.confirm(
      status === 'active' ? '确认将该版本设为正式可用？' : '确认停用该版本？',
    )) return;
    const busyKey = `${versionIdentity(item)}:${status}`;
    setStatusBusy(busyKey);
    setError('');
    setNotice('');
    try {
      const updated = await socialWorkPackageAdminApi.changeStatus(
        item.packageKey,
        item.version,
        item.recordVersion,
        status,
      );
      replaceItem(updated);
      setNotice(`版本已更新为${STATUS_LABELS[updated.status]}`);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : '状态更新失败');
    } finally {
      setStatusBusy('');
    }
  };

  return (
    <section id="social-work-package-center" className="mb-4 rounded-2xl border border-border bg-white p-4 shadow-sm" aria-labelledby="social-work-package-heading">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><PackageCheck size={16} className="text-emerald-700" /><h2 id="social-work-package-heading" className="text-sm font-black text-text-primary">作业方案中心</h2></div>
          <p className="mt-1 text-xs text-text-muted">管理三个标准作业包的框架、版本和可用状态。</p>
        </div>
        <button type="button" onClick={() => void load(true)} disabled={refreshing} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary disabled:opacity-50">
          <RefreshCcw size={13} className={refreshing ? 'animate-spin' : ''} />刷新
        </button>
      </header>

      {notice && <p role="status" className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">{notice}</p>}
      {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}

      <div className="mt-4 grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="标准作业包" className="space-y-2">
          {SOCIAL_WORK_PACKAGE_KINDS.map(kind => {
            const kindItems = items.filter(item => item.kind === kind);
            const active = kindItems.find(item => item.status === 'active' && item.available);
            return (
              <button key={kind} type="button" onClick={() => chooseKind(kind)} aria-current={selectedKind === kind ? 'page' : undefined} className={`w-full rounded-xl border p-3 text-left transition ${selectedKind === kind ? 'border-emerald-200 bg-emerald-50' : 'border-border bg-surface-2 hover:bg-white'}`}>
                <div className="flex items-center justify-between gap-2"><span className="text-xs font-black text-text-primary">{KIND_LABELS[kind]}</span><span className="text-[10px] font-bold text-text-muted">{kindItems.length} 个版本</span></div>
                <p className="mt-1 text-[10px] text-text-muted">{active ? `正式版本 ${active.version}` : '暂无正式版本'}</p>
              </button>
            );
          })}
        </nav>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-[11px] font-bold text-text-muted">当前方案</p><h3 className="mt-0.5 text-base font-black text-text-primary">{KIND_LABELS[selectedKind]}</h3></div>
            <button type="button" onClick={openCreate} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white"><Plus size={13} />创建版本</button>
          </div>

          {loading ? (
            <div className="flex h-40 items-center justify-center text-text-muted"><Loader2 size={18} className="animate-spin" /></div>
          ) : versions.length === 0 ? (
            <div className="mt-3 rounded-xl border border-dashed border-border bg-surface-2 p-6 text-center"><p className="text-xs font-bold text-text-secondary">暂无版本</p><button type="button" onClick={openCreate} className="mt-3 text-xs font-black text-emerald-700">创建第一个版本</button></div>
          ) : (
            <>
              <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
                {versions.map(item => (
                  <button key={versionIdentity(item)} type="button" onClick={() => setSelection({ packageKey: item.packageKey, version: item.version })} className={`min-w-[150px] rounded-xl border px-3 py-2.5 text-left ${selected && versionIdentity(selected) === versionIdentity(item) ? 'border-emerald-300 bg-emerald-50' : 'border-border bg-white hover:bg-surface-2'}`}>
                    <div className="flex items-center justify-between gap-2"><span className="text-xs font-black text-text-primary">{item.version}</span><PackageStatus status={item.status} /></div>
                    <p className="mt-1 text-[10px] text-text-muted">{item.builtin ? '系统初始版本' : formatUpdatedAt(item.updatedAt)}</p>
                  </button>
                ))}
              </div>

              {selected && (
                <div className="mt-3 rounded-2xl border border-border bg-white p-4">
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_230px]">
                    <div className="min-w-0">
                      {!selected.builtin && selected.status === 'internal_trial' && selectedActivationMissing.length > 0 && <p className="mb-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800">正式可用前还需补充：{selectedActivationMissing.join('、')}</p>}
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div><div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-black text-text-primary">{selected.name}</h4><PackageStatus status={selected.status} />{selected.builtin && <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">系统初始版本</span>}</div><p className="mt-1 text-xs text-text-muted">版本 {selected.version}{selected.summary ? ` · ${selected.summary}` : ''}</p></div>
                        <div className="flex flex-wrap gap-2">
                          {!selected.builtin && ['draft', 'internal_trial'].includes(selected.status) && <button type="button" onClick={() => openEdit(selected)} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary"><Pencil size={13} />编辑框架</button>}
                          {selected.builtin && <span className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] font-bold text-blue-700">只读，请创建新版本后编辑</span>}
                          {!selected.builtin && SOCIAL_WORK_PACKAGE_TRANSITIONS[selected.status].map(status => {
                            const busy = statusBusy === `${versionIdentity(selected)}:${status}`;
                            const activationBlocked = status === 'active' && selectedActivationMissing.length > 0;
                            return <button key={status} type="button" title={activationBlocked ? `请先补充${selectedActivationMissing.join('、')}` : undefined} disabled={Boolean(statusBusy) || activationBlocked} onClick={() => void changeStatus(selected, status)} className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black disabled:cursor-not-allowed disabled:opacity-40 ${status === 'active' ? 'bg-blue-600 text-white' : status === 'retired' ? 'border border-red-200 bg-red-50 text-red-700' : 'border border-border bg-surface-2 text-text-secondary'}`}>{busy ? <Loader2 size={13} className="animate-spin" /> : status === 'active' ? <CheckCircle2 size={13} /> : null}{STATUS_ACTIONS[status]}</button>;
                          })}
                        </div>
                      </div>
                      <div className="mt-4"><FrameworkOverview framework={selected.framework} /></div>
                    </div>
                    <CustomerCardPreview item={selected} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {editor && <EditorDialog draft={editor} error={error} saving={saving} onChange={setEditor} onClose={() => !saving && setEditor(null)} onSave={() => void saveEditor()} />}
    </section>
  );
}
