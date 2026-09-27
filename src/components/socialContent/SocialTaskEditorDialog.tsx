import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, PackageCheck, Sparkles, X } from 'lucide-react';
import type {
  SocialContentTaskDetail,
  SocialContentTaskMode,
  SocialContentThemeId,
  SocialWorkPackageCard,
} from '../../../shared/contracts/socialContentWorkflow';
import {
  SOCIAL_CONTENT_CREATION_PATH_LABEL,
  type SocialContentCreationPath,
  type SocialContentDraft,
  type SocialContentMaterialInput,
} from '../../lib/socialContentModel';
import { studioApi } from '../../lib/studioApi';
import { taskToDraft } from './socialContentUi';

const INPUT_CLASS = 'mt-1.5 h-11 w-full rounded-lg border border-border bg-white px-3 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10';

interface SocialTaskEditorDialogProps {
  open: boolean;
  sessionKey: string;
  task: SocialContentTaskDetail | null;
  initialThemeId?: SocialContentThemeId | '';
  initialMode?: SocialContentTaskMode;
  initialCreationPath?: SocialContentCreationPath;
  initialMaterialInput?: SocialContentMaterialInput;
  initialManagedMode?: 'one_click_managed';
  initialDraftPatch?: Partial<Pick<SocialContentDraft, 'title' | 'topic' | 'productId' | 'productName' | 'referenceLinks' | 'platforms'>>;
  sourceContext?: { originLabel: string; referenceTitle: string; referenceThumbnail?: string };
  lockMode?: boolean;
  catalog: SocialWorkPackageCard[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (draft: SocialContentDraft, files: File[], start: boolean) => Promise<void>;
}

interface EnterpriseProductOption {
  id: string;
  name: string;
}

function defaultTaskTitle(draft: SocialContentDraft): string {
  const entry = SOCIAL_CONTENT_CREATION_PATH_LABEL[draft.creationPath];
  return draft.mode === 'weekly' ? '本周内容计划' : `${entry}内容`;
}

export default function SocialTaskEditorDialog({
  open,
  sessionKey,
  task,
  initialThemeId,
  initialMode,
  initialCreationPath,
  initialMaterialInput,
  initialManagedMode,
  initialDraftPatch,
  sourceContext,
  catalog,
  busy,
  onClose,
  onSubmit,
}: SocialTaskEditorDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(() => taskToDraft(task, catalog));
  const [products, setProducts] = useState<EnterpriseProductOption[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsUnavailable, setProductsUnavailable] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const next = taskToDraft(task, catalog);
    if (!task && initialThemeId !== undefined) next.themeId = initialThemeId;
    if (!task && initialCreationPath) next.creationPath = initialCreationPath;
    if (!task && initialMaterialInput) next.materialInput = initialMaterialInput;
    if (!task && initialManagedMode) next.managedMode = initialManagedMode;
    if (!task && initialDraftPatch) Object.assign(next, initialDraftPatch);
    if (!task && initialMode) {
      next.mode = initialMode;
      if (initialMode === 'instant') next.quantity = 1;
    }
    next.title = next.title.trim() || defaultTaskTitle(next);
    next.primaryGoal = next.primaryGoal.trim() || '由系统根据企业中心与参考内容自动制定';
    setDraft(next);
    setError('');
    window.setTimeout(() => dialogRef.current?.focus(), 0);
  }, [open, sessionKey]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setProductsLoading(true);
    setProductsUnavailable(false);
    void studioApi.materialProducts()
      .then(result => {
        if (!active) return;
        const items = (Array.isArray(result.items) ? result.items : [])
          .filter(item => item && typeof item.id === 'string' && typeof item.name === 'string');
        setProducts(items);
        setDraft(current => {
          const savedRef = current.productId.trim() || current.productName.trim();
          if (!savedRef) return { ...current, productId: '', productName: '' };
          const matched = items.find(item => item.id === savedRef || item.name === savedRef);
          return matched
            ? { ...current, productId: matched.id, productName: matched.name }
            : { ...current, productId: '', productName: '' };
        });
      })
      .catch(() => {
        if (!active) return;
        setProducts([]);
        setProductsUnavailable(true);
        setDraft(current => ({ ...current, productId: '', productName: '' }));
      })
      .finally(() => { if (active) setProductsLoading(false); });
    return () => { active = false; };
  }, [open, sessionKey]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onClose]);

  const selectedProductId = useMemo(() => (
    products.some(item => item.id === draft.productId) ? draft.productId : ''
  ), [draft.productId, products]);

  const selectProduct = (productId: string) => {
    const selected = products.find(item => item.id === productId);
    setDraft(current => ({
      ...current,
      productId: selected?.id || '',
      productName: selected?.name || '',
    }));
    setError('');
  };

  const submit = async () => {
    setError('');
    try {
      await onSubmit(draft, [], false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '操作未完成，请重试');
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-950/45 p-0 backdrop-blur-sm sm:p-5" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="social-task-editor-title" className="flex h-full w-full max-w-2xl flex-col overflow-hidden bg-[#f6f8f5] shadow-2xl outline-none sm:h-auto sm:max-h-[92vh] sm:rounded-xl sm:border sm:border-border">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border bg-white px-5 py-4 sm:px-6">
          <div>
            <p className="text-[10px] font-black tracking-[0.1em] text-accent">内容制作</p>
            <h2 id="social-task-editor-title" className="mt-1 text-lg font-black text-text-primary">
              {task ? '调整本次宣传产品' : '选择本次宣传产品'}
            </h2>
          </div>
          <button type="button" aria-label="关闭" disabled={busy} onClick={onClose} className="rounded-lg p-2 text-text-muted hover:bg-surface-2 disabled:opacity-50"><X size={19} /></button>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
          {sourceContext && <div className="mb-5 flex items-center gap-3 rounded-xl border border-violet-100 bg-violet-50/70 p-3">
            {sourceContext.referenceThumbnail
              ? <img src={sourceContext.referenceThumbnail} alt="" className="h-14 w-11 shrink-0 rounded-lg object-cover" />
              : <span className="flex h-14 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-violet-700"><Sparkles size={17} /></span>}
            <div className="min-w-0">
              <p className="text-[10px] font-black text-violet-700">{sourceContext.originLabel} · 已带入复刻任务</p>
              <p className="mt-1 truncate text-xs font-bold text-text-primary">{sourceContext.referenceTitle}</p>
              <p className="mt-0.5 text-[10px] text-text-muted">参考视频、逐句口播与前三秒精细分析会自动带入。</p>
            </div>
          </div>}

          <section className="rounded-xl border border-border bg-white p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-emerald-50 p-2.5 text-emerald-700"><PackageCheck size={20} /></span>
              <div>
                <h3 className="text-base font-black text-text-primary">只需选择产品</h3>
                <p className="mt-1 text-xs leading-5 text-text-muted">企业、品牌、产品表与素材均由系统从企业中心自动读取。</p>
              </div>
            </div>
            <label className="mt-5 block text-xs font-bold text-text-secondary">
              本次宣传产品
              <select value={selectedProductId} disabled={productsLoading} onChange={event => selectProduct(event.target.value)} className={INPUT_CLASS}>
                <option value="">交给系统自动选择</option>
                {products.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <p className="mt-2 text-[11px] leading-5 text-text-muted">
              {productsLoading ? '正在读取企业中心产品…'
                : productsUnavailable ? '暂时无法读取企业中心产品，可先交给系统自动选择。'
                  : products.length ? '不选择时，系统会根据现有产品与素材自动决定。' : '企业中心暂无产品，系统会使用企业通用素材继续。'}
            </p>
            <div className="mt-5 rounded-xl border border-emerald-100 bg-emerald-50/70 px-4 py-3 text-xs leading-5 text-emerald-900">
              无需填写卖点、企业事实、目标客户、市场或产品自由文本。保存后系统会自动完成分析、逐句素材匹配并给出制作方案。
            </div>
          </section>

          {error && <div role="alert" className="mt-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</div>}
        </main>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-white px-5 py-4 sm:px-6">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-border bg-white px-4 py-2.5 text-xs font-bold text-text-secondary hover:bg-surface-2 disabled:opacity-50">取消</button>
          <button type="button" disabled={busy || productsLoading} onClick={() => void submit()} className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-xs font-black text-white hover:bg-accent-dim disabled:opacity-50">
            {busy && <Loader2 size={14} className="animate-spin" />}保存并查看制作方案
          </button>
        </footer>
      </div>
    </div>
  );
}
