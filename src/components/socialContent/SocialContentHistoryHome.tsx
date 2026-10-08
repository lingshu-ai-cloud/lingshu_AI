import { useEffect, useMemo, useState } from 'react';
import {
  ListVideo,
  ChevronLeft,
  ChevronRight,
  CirclePlay,
  Clapperboard,
  Clock3,
  Loader2,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import { studioApi, type StudioProject } from '../../lib/studioApi';
import CreationMaterialHistory from './CreationMaterialHistory';
import CreationHistoryCover from './CreationHistoryCover';
import { useModalFocus } from '../../hooks/useModalFocus';

type CreationFilter = 'all' | 'viral_replication' | 'free_creation';

const PAGE_SIZE = 8;
const STUDIO_OPEN_PROJECT_KEY = 'ow_studio_open_project';

function CompletedVideoPreview({ project, onClose }: { project: StudioProject; onClose: () => void }) {
  const dialogRef = useModalFocus<HTMLDivElement>({ open: true, onClose });
  const url = projectPreviewUrl(project);

  return (
    <div className="fixed inset-0 z-[195] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="completed-video-preview-title" className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#071813] text-white shadow-2xl outline-none">
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-300">成片预览</p>
            <h2 id="completed-video-preview-title" className="mt-1 truncate text-lg font-black">{project.title}</h2>
            <p className="mt-1 text-[11px] text-emerald-50/60">{projectCategory(project) === 'viral_replication' ? '爆款复刻模式' : '自由创作模式'} · 已验收成片</p>
          </div>
          <button type="button" aria-label="关闭成片预览" onClick={onClose} className="shrink-0 rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white"><X size={18} /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto bg-black p-3 sm:p-5">
          <video autoPlay controls playsInline preload="auto" src={url} className="mx-auto max-h-[76vh] w-full rounded-xl bg-black object-contain" aria-label={`${project.title}成片预览`}>
            您的浏览器暂不支持视频预览。
          </video>
        </div>
      </div>
    </div>
  );
}

function projectCategory(project: StudioProject): Exclude<CreationFilter, 'all'> {
  const mode = String(project.spec.mode || project.spec.creationMode || '').toLowerCase();
  return mode === 'clone' || mode === 'viral_replication' || /爆款|复刻|裂变/.test(project.title)
    ? 'viral_replication'
    : 'free_creation';
}

function projectPreviewUrl(project: StudioProject): string {
  const outputs = project.spec.languageRenderOutputs;
  if (outputs && typeof outputs === 'object') {
    const done = Object.values(outputs as Record<string, { status?: string; previewUrl?: string }>).find(
      output => output?.status === 'done' && typeof output.previewUrl === 'string' && output.previewUrl,
    );
    if (done?.previewUrl) return done.previewUrl;
  }
  return typeof project.spec.renderOutputPreviewUrl === 'string' ? project.spec.renderOutputPreviewUrl : '';
}

function projectHasAcceptedRender(project: StudioProject): boolean {
  const acceptance = project.spec.renderAcceptance;
  return Boolean(acceptance && typeof acceptance === 'object' && !Array.isArray(acceptance)
    && (acceptance as Record<string, unknown>).accepted === true
    && (acceptance as Record<string, unknown>).renderPath === projectPreviewUrl(project));
}

function statusLabel(project: StudioProject, previewUrl: string): string {
  if (projectHasAcceptedRender(project)) return '已验收成片';
  if (previewUrl) return '待验收成片';
  if (project.status === 'published') return '已发布';
  if (project.status === 'ready_for_approval') return '待验收';
  return '制作中';
}

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function openProject(project: StudioProject) {
  try {
    localStorage.setItem(STUDIO_OPEN_PROJECT_KEY, JSON.stringify({ at: Date.now(), projectId: project.id }));
  } catch { /* optional storage */ }
  const url = new URL(window.location.href);
  url.searchParams.set('project', project.id);
  window.history.replaceState(window.history.state, '', url);
  window.dispatchEvent(new CustomEvent('lingshu:navigate', {
    detail: { page: 'smartAssets', view: 'create', directStudio: true },
  }));
}

export default function SocialContentHistoryHome({ onRequestCreate }: { onRequestCreate: () => void }) {
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [filter, setFilter] = useState<CreationFilter>('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [previewVideoOpen, setPreviewVideoOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void studioApi.listProjects({ throwOnError: true }).then(items => {
      if (!active) return;
      setProjects(items
        .filter(item => item.status !== 'template')
        .sort((left, right) => {
          const outputDifference = Number(Boolean(projectPreviewUrl(right))) - Number(Boolean(projectPreviewUrl(left)));
          return outputDifference || new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
        }));
    }).catch(() => { if (active) setLoadError('创作历史读取失败，请刷新重试。'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => filter === 'all'
    ? projects
    : projects.filter(project => projectCategory(project) === filter), [filter, projects]);
  const featuredProject = [...projects].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0];
  const featuredPreviewUrl = featuredProject ? projectPreviewUrl(featuredProject) : '';
  const openFeatured = () => {
    if (!featuredProject) return;
    if (featuredPreviewUrl) setPreviewVideoOpen(true);
    else openProject(featuredProject);
  };
  const itemCount = filtered.length;
  const pageCount = Math.max(1, Math.ceil(itemCount / PAGE_SIZE));
  const firstProjectIndex = (page - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(firstProjectIndex, firstProjectIndex + PAGE_SIZE);

  const changeFilter = (next: CreationFilter) => {
    setFilter(next);
    setPage(1);
  };

  if (historyOpen) return <CreationMaterialHistory projects={projects} loading={loading} error={loadError} onBack={() => setHistoryOpen(false)} onOpenProject={openProject} />;

  return (
    <div className="space-y-6">
      {featuredProject && <section className="overflow-hidden rounded-3xl border border-emerald-200 bg-[#102d25] text-white shadow-[0_20px_50px_rgba(16,45,37,0.14)]">
          <div className="grid lg:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.35fr)]">
            <div className="flex flex-col justify-center p-6 sm:p-8">
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-400/15 px-3 py-1.5 text-[10px] font-black text-emerald-200"><Sparkles size={12} />{featuredPreviewUrl ? '最新成片' : '最新草稿'}</span>
              <h2 className="mt-5 text-2xl font-black leading-tight sm:text-3xl">{featuredProject.title}</h2>
              <p className="mt-3 max-w-lg text-sm leading-6 text-emerald-50/75">{projectCategory(featuredProject) === 'viral_replication' ? '爆款复刻模式' : '自由创作模式'} · {featuredPreviewUrl ? `${statusLabel(featuredProject, featuredPreviewUrl)}。点击即可预览完整成片。` : '草稿首帧预览，点击继续制作。'}</p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button type="button" onClick={openFeatured} className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-xs font-black text-emerald-950 hover:bg-emerald-300"><CirclePlay size={15} />{featuredPreviewUrl ? '预览成片' : '继续制作'}</button>
                <span className="text-[11px] font-semibold text-emerald-100/65">更新于 {dateLabel(featuredProject.updatedAt)}</span>
              </div>
            </div>
            <div className="relative h-[360px] overflow-hidden bg-black lg:h-[430px]">
              <button type="button" onClick={openFeatured} className="group relative block h-full w-full" aria-label={`${featuredPreviewUrl ? '预览' : '继续制作'}${featuredProject.title}`}>
                <CreationHistoryCover project={featuredProject} fit="contain" className="absolute inset-0 h-full w-full" />
                <span className="absolute inset-0 flex items-center justify-center bg-black/5 transition group-hover:bg-black/20"><span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-emerald-900 shadow-xl transition group-hover:scale-105"><CirclePlay size={34} /></span></span>
              </button>
            </div>
          </div>
      </section>}

      <section>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">创作历史</p>
            <h2 className="mt-1 text-xl font-black text-slate-950">全部内容任务</h2>
            <p className="mt-1 text-xs text-slate-500">先选类型，再点开某一项查看完整制作详情。</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setHistoryOpen(true)} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-xs font-bold text-emerald-800 hover:bg-emerald-50"><ListVideo size={16} />历史素材</button>
          <div className="flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm" role="tablist" aria-label="创作类型筛选">
            {([
              ['all', '全部'],
              ['viral_replication', '爆款复刻'],
              ['free_creation', '自由创作'],
            ] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={filter === id} onClick={() => changeFilter(id)} className={`rounded-lg px-3.5 py-2 text-[11px] font-black transition ${filter === id ? 'bg-[#173d31] text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}>{label}</button>
            ))}
          </div>
          </div>
        </div>

        {loadError && <p role="alert" className="mt-4 text-sm text-red-700">{loadError}</p>}
        {loading ? (
          <div className="mt-5 flex min-h-52 items-center justify-center rounded-3xl border border-slate-200 bg-white text-sm font-bold text-slate-500"><Loader2 size={18} className="mr-2 animate-spin" />正在读取创作历史</div>
        ) : itemCount ? (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {pageItems.map(project => {
              const previewUrl = projectPreviewUrl(project);
              const category = projectCategory(project);
              return (
                <button key={project.id} type="button" onClick={() => openProject(project)} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-lg">
                  <span className="relative flex aspect-[16/10] items-center justify-center overflow-hidden bg-gradient-to-br from-slate-800 via-slate-900 to-emerald-950">
                    <CreationHistoryCover project={project} className="absolute inset-0 h-full w-full" />
                    <span className="absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[9px] font-black text-white backdrop-blur">{category === 'viral_replication' ? '爆款复刻模式' : '自由创作模式'}</span>
                    {previewUrl && <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/20"><CirclePlay size={36} className="text-white opacity-0 drop-shadow transition group-hover:opacity-100" /></span>}
                  </span>
                  <span className="block p-4">
                    <span className="line-clamp-2 min-h-10 text-sm font-black leading-5 text-slate-950">{project.title}</span>
                    <span className="mt-3 flex items-center justify-between gap-3 text-[10px]">
                      <span className={`rounded-full px-2 py-1 font-black ${previewUrl ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>{statusLabel(project, previewUrl)}</span>
                      <span className="flex items-center gap-1 font-black text-emerald-700">进入制作 →</span>
                    </span>
                    <span className="mt-2 flex items-center gap-1 text-[9px] text-slate-400"><Clock3 size={10} />{dateLabel(project.updatedAt)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
            <Clapperboard size={30} className="mx-auto text-slate-300" />
            <p className="mt-3 text-sm font-black text-slate-700">这个分类还没有历史创作</p>
            <button type="button" onClick={onRequestCreate} className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#173d31] px-4 py-2.5 text-xs font-black text-white"><Plus size={14} />创建第一条内容</button>
          </div>
        )}

        {itemCount > PAGE_SIZE && (
          <nav className="mt-6 flex items-center justify-center gap-3" aria-label="创作历史分页">
            <button type="button" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))} className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 disabled:opacity-35"><ChevronLeft size={16} /></button>
            <span className="text-xs font-bold text-slate-500">第 {page} / {pageCount} 页 · 共 {itemCount} 项</span>
            <button type="button" disabled={page >= pageCount} onClick={() => setPage(value => Math.min(pageCount, value + 1))} className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 disabled:opacity-35"><ChevronRight size={16} /></button>
          </nav>
        )}
      </section>

      {previewVideoOpen && featuredProject && <CompletedVideoPreview project={featuredProject} onClose={() => setPreviewVideoOpen(false)} />}
    </div>
  );
}
