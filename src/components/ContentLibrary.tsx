import { useEffect, useRef, useState } from 'react';
import { Download, Film, RefreshCw, X } from 'lucide-react';
import { authHeader } from '../lib/auth';
import { useModalFocus } from '../hooks/useModalFocus';
import ProductionRevisionPanel from './ProductionRevisionPanel';
import ContentVideoPreview from './ContentVideoPreview';

async function request(route: string, body?: unknown) {
  const response = await fetch('/api/overseas/studio/' + route, {
    method: body ? 'POST' : 'GET',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || '请求失败');
  return data;
}

async function download(route: string, name: string) {
  const response = await fetch('/api/overseas/studio/' + route, { headers: authHeader() });
  if (!response.ok) {
    const data = await response.json();
    throw Error(data.error || '下载失败');
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const secondaryButton = 'inline-flex min-h-9 items-center justify-center rounded-md border border-border bg-surface px-3 py-2 text-xs font-bold text-text-secondary transition hover:border-border-bright hover:bg-surface-2 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40';
const primaryButton = 'inline-flex min-h-9 items-center justify-center rounded-md bg-accent px-3 py-2 text-xs font-bold text-white transition hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-40';
const compactField = 'ui-field !min-h-9 !rounded-md !px-3 !py-2 !text-xs';
const compactSelect = `${compactField} ui-select`;

export default function ContentLibrary({ exportsOnly = false, onPublish }: { exportsOnly?: boolean; onPublish?: (draft: any) => void }) {
  const [exportsOpen, setExportsOpen] = useState(false);
  const exportDialog = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState('');
  const [status, setStatus] = useState('');
  const [notice, setNotice] = useState('');
  const [active, setActive] = useState<any>(null);
  const [extras, setExtras] = useState(true);
  const [busy, setBusy] = useState(false);
  const [platform, setPlatform] = useState('');
  const [project, setProject] = useState('');
  const [currentOnly, setCurrentOnly] = useState(false);
  const productionDialogRef = useModalFocus<HTMLDivElement>({
    open: Boolean(active),
    onClose: () => setActive(null),
  });

  useEffect(() => {
    const dialog = exportDialog.current;
    if (!dialog) return;
    if (exportsOpen && !dialog.open) dialog.showModal();
    if (!exportsOpen && dialog.open) dialog.close();
  }, [exportsOpen]);

  const load = async () => {
    try {
      const [library, exports] = await Promise.all([request('library'), request('exports')]);
      setItems(library.items);
      setJobs(exports.items);
    } catch (error) {
      setNotice((error as Error).message);
    }
  };

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, []);

  const shown = items.filter(item =>
    (!query || [item.title, item.product, item.platform, item.taskId].join(' ').toLowerCase().includes(query.toLowerCase()))
    && (!language || item.language === language)
    && (!status || item.reviewStatus === status)
    && (!platform || item.platform === platform)
    && (!project || item.projectId === project)
    && (!currentOnly || item.current));

  const exportItems = async (ids: string[]) => {
    setBusy(true);
    try {
      await request('exports', { ids, includeExtras: extras });
      setNotice('导出任务已创建');
      if (!exportsOnly) setExportsOpen(true);
      await load();
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return <div className="h-full space-y-5 overflow-auto bg-ink p-5 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-accent">Production assets</p>
        <h2 className="mt-1 text-xl font-bold text-text-primary">{exportsOnly ? '导出记录' : '已完成成片'}</h2>
        <p className="mt-1 text-sm text-text-secondary">{exportsOnly ? '压缩包保留 7 天，过期后可重新导出。' : '查看成片、下载文件，或选择作品去发布。'}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={secondaryButton} onClick={() => void load()}><RefreshCw size={14} />刷新</button>
        {!exportsOnly && <button type="button" className={secondaryButton} onClick={() => setExportsOpen(true)}><Download size={14} />导出记录{jobs.some(job => job.status === 'running') && <span className="ml-1 text-accent">处理中</span>}</button>}
      </div>
    </header>

    {notice && <p role="status" className="border-l-2 border-amber bg-amber-dim px-3 py-2 text-sm text-amber">{notice}</p>}

    {!exportsOnly && <>
      <section aria-label="成片筛选" className="space-y-3 border-b border-border pb-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <input aria-label="搜索成片" className={compactField} placeholder="搜索产品、标题、平台或任务" value={query} onChange={event => setQuery(event.target.value)} />
          <select aria-label="成片语言" className={compactSelect} value={language} onChange={event => setLanguage(event.target.value)}>
            <option value="">全部语言</option>
            {[...new Set(items.map(item => item.language))].map(value => <option key={value}>{value}</option>)}
          </select>
          <select aria-label="成片审核状态" className={compactSelect} value={status} onChange={event => setStatus(event.target.value)}>
            <option value="">全部审核状态</option>
            <option value="pending">待审核</option>
            <option value="approved">已批准</option>
          </select>
          <select aria-label="成片平台" className={compactSelect} value={platform} onChange={event => setPlatform(event.target.value)}>
            <option value="">全部平台</option>
            {[...new Set(items.map(item => item.platform).filter(Boolean))].map(value => <option key={value}>{value}</option>)}
          </select>
          <select aria-label="成片项目" className={compactSelect} value={project} onChange={event => setProject(event.target.value)}>
            <option value="">全部项目</option>
            {[...new Map(items.map(item => [item.projectId, item.title])).entries()].map(([id, title]) => <option key={id} value={id}>{title}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="inline-flex items-center gap-2 text-xs font-medium text-text-secondary">
            <input className="accent-accent" type="checkbox" checked={currentOnly} onChange={event => setCurrentOnly(event.target.checked)} />
            只看当前版本
          </label>
          <label className="inline-flex items-center gap-2 text-xs font-medium text-text-secondary">
            <input className="accent-accent" type="checkbox" checked={extras} onChange={event => setExtras(event.target.checked)} />
            附带字幕、文案、封面
          </label>
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            <button type="button" className={secondaryButton} onClick={() => setSelected(shown.filter(item => item.available).map(item => item.id))}>选择当前结果</button>
            <button type="button" className={secondaryButton} onClick={() => setSelected([])}>清空选择</button>
            <button type="button" disabled={!selected.length || busy} className={primaryButton} onClick={() => void exportItems(selected)}>批量导出（{selected.length}）</button>
          </div>
        </div>
      </section>

      {!shown.length && <p className="border-y border-border bg-surface py-12 text-center text-sm text-text-muted"><Film size={28} className="mx-auto mb-3 text-text-muted" />暂无符合条件的成片<span className="mt-2 block text-xs text-text-muted">完成制作后，视频会自动出现在这里。可以调整筛选条件查找其他成片。</span></p>}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shown.map(item => <article key={item.id} className="overflow-hidden rounded-md border border-border bg-surface">
          <div className="flex items-start gap-2 border-b border-border px-4 py-3">
            <input aria-label={'选择' + item.title} className="mt-1 accent-accent" type="checkbox" disabled={!item.available} checked={selected.includes(item.id)} onChange={event => setSelected(event.target.checked ? [...selected, item.id] : selected.filter(id => id !== item.id))} />
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold text-text-primary">{item.title}</h3>
              <p className="mt-1 text-[11px] text-text-muted">{item.language} · {item.platform} · v{item.version} · {item.current ? '当前版本' : '历史版本'} · {item.exportSpec?.resolution}</p>
            </div>
          </div>
          {item.previewUrl && <ContentVideoPreview poster={item.coverUrl || undefined} src={item.previewUrl} className="aspect-video w-full bg-black object-contain" />}
          <div className="px-4 py-3">
            <p className={`border-l-2 pl-2 text-xs ${item.reviewStatus === 'approved' ? 'border-accent text-accent' : 'border-amber text-amber'}`}>{item.reviewStatus === 'approved' ? '已批准' : '待审核'} · {item.published ? '已发布' : '未确认发布'}{!item.available ? ' · 文件不可用' : ''}{!item.metadataComplete ? ' · 旧版字幕与文案未留存' : ''}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={secondaryButton} disabled={!item.available} onClick={() => void download('library/download?id=' + encodeURIComponent(item.id), item.title + '.mp4').catch(error => setNotice(error.message))}>下载MP4</button>
              <button type="button" className={secondaryButton} onClick={() => setActive(item)}>查看与修改</button>
              {onPublish && item.current && <button type="button" className={primaryButton} disabled={!item.available || Boolean(item.runId && item.reviewStatus !== 'approved')} onClick={() => void request('library/publish-draft/' + encodeURIComponent(item.id)).then(onPublish).catch(error => setNotice(error.message))}>去发布</button>}
            </div>
          </div>
        </article>)}
      </div>
    </>}

    {exportsOnly && <section>
      <div className="flex items-end justify-between border-b border-border pb-3">
        <div>
          <h3 className="text-sm font-bold text-text-primary">导出任务</h3>
          <p className="mt-1 text-xs text-text-muted">查看打包进度与失败项</p>
        </div>
        <span className="text-xs text-text-muted">{jobs.length} 条记录</span>
      </div>
      {!jobs.length && <p className="border-b border-border py-8 text-center text-sm text-text-muted">暂无导出记录。在成片库选择视频后即可导出。</p>}
      <div className="divide-y divide-border border-b border-border">
        {jobs.map(job => <article key={job.id} className="py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-text-primary">{new Date(job.createdAt).toLocaleString()} · {job.items.length}条 · {({ running: '处理中', done: '已完成', partial: '部分失败', failed: '失败' } as any)[job.status]}</p>
            <span className="text-xs font-bold text-accent">{job.progress}%</span>
          </div>
          <progress className="mt-3 h-1.5 w-full accent-accent" value={job.progress} max="100" />
          {job.items.filter((item: any) => item.status === 'failed').map((item: any) => <p key={item.id} className="mt-2 border-l-2 border-amber bg-amber-dim px-3 py-2 text-xs text-amber">{item.title}：{item.error}</p>)}
          {job.error && <p className="mt-2 text-xs text-amber">{job.error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {['done', 'partial'].includes(job.status) && <button type="button" className={primaryButton} onClick={() => void download('exports/' + job.id + '/download', '成片导出.zip').catch(error => setNotice(error.message))}>下载压缩包</button>}
            {job.status !== 'running' && <button type="button" className={secondaryButton} onClick={() => void exportItems(job.items.filter((item: any) => job.status === 'partial' ? item.status === 'failed' : true).map((item: any) => item.id))}>重新导出{job.status === 'partial' ? '失败项' : ''}</button>}
          </div>
        </article>)}
      </div>
    </section>}

    <dialog
      ref={exportDialog}
      onCancel={() => setExportsOpen(false)}
      onClose={() => setExportsOpen(false)}
      onClick={event => { if (event.target === event.currentTarget) setExportsOpen(false); }}
      aria-labelledby="export-history-title"
      className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-xl border-l border-border bg-ink p-0 shadow-2xl backdrop:bg-text-primary/35"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-start justify-between border-b border-border bg-surface p-5">
          <div>
            <h3 id="export-history-title" className="font-bold text-text-primary">导出记录</h3>
            <p className="mt-1 text-xs text-text-muted">压缩包保留 7 天，过期后可重新导出。</p>
          </div>
          <button type="button" aria-label="关闭导出记录" onClick={() => setExportsOpen(false)} className="rounded-md p-2 text-text-muted transition hover:bg-surface-2 hover:text-text-primary"><X size={18} /></button>
        </header>
        <section className="flex-1 overflow-y-auto p-5">
          {!jobs.length && <p className="border-y border-dashed border-border py-8 text-center text-sm text-text-muted">暂无导出记录。选择已完成成片后，即可批量导出。</p>}
          <div className="divide-y divide-border border-y border-border">
            {jobs.map(job => <article key={job.id} className="py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-text-primary">{new Date(job.createdAt).toLocaleString()} · {job.items.length}条 · {({ running: '处理中', done: '已完成', partial: '部分失败', failed: '失败' } as any)[job.status]}</p>
                <span className="text-xs font-bold text-accent">{job.progress}%</span>
              </div>
              <progress className="mt-3 h-1.5 w-full accent-accent" value={job.progress} max="100" />
              {job.items.filter((item: any) => item.status === 'failed').map((item: any) => <p key={item.id} className="mt-2 border-l-2 border-amber bg-amber-dim px-3 py-2 text-xs text-amber">{item.title}：{item.error}</p>)}
              {job.error && <p className="mt-2 text-xs text-amber">{job.error}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {['done', 'partial'].includes(job.status) && <button type="button" className={primaryButton} onClick={() => void download('exports/' + job.id + '/download', '成片导出.zip').catch(error => setNotice(error.message))}>下载压缩包</button>}
                {job.status !== 'running' && <button type="button" className={secondaryButton} onClick={() => void exportItems(job.items.filter((item: any) => job.status === 'partial' ? item.status === 'failed' : true).map((item: any) => item.id))}>重新导出{job.status === 'partial' ? '失败项' : ''}</button>}
              </div>
            </article>)}
          </div>
        </section>
      </div>
    </dialog>

    {active && <div ref={productionDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="content-library-production-dialog-title" className="fixed inset-0 z-50 overflow-auto bg-text-primary/45 p-4 backdrop-blur-[2px] sm:p-8">
      <div className="mx-auto max-w-4xl rounded-lg border border-border bg-surface">
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-accent">Production workspace</p>
            <h2 id="content-library-production-dialog-title" className="mt-1 font-bold text-text-primary">{active.title}</h2>
          </div>
          <button type="button" data-modal-initial-focus className={secondaryButton} onClick={() => setActive(null)}>关闭</button>
        </header>
        <div className="space-y-5 p-5">
          {active.previewUrl && <ContentVideoPreview src={items.find(item => item.id === active.id)?.previewUrl || active.previewUrl} className="mx-auto max-h-80 w-full bg-black object-contain" />}
          <ProductionRevisionPanel projectId={active.projectId} onSaved={() => void load()} />
        </div>
      </div>
    </div>}
  </div>;
}
