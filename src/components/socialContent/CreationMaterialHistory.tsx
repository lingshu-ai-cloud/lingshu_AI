import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import type { StudioProject } from '../../lib/studioApi';
import { creationHistoryAnalysis } from '../../lib/creationHistoryAnalysis';
import { authHeader } from '../../lib/auth';
import { buildBenchmarkAnalysis, recordOf, MATERIAL_TYPE_LABELS, type BenchmarkAnalysis } from '../../../shared/benchmarkAnalysis';
import CreationHistoryCover from './CreationHistoryCover';
import BenchmarkAnalysisSections from '../inspiration/BenchmarkAnalysisSections';
import { useModalFocus } from '../../hooks/useModalFocus';

function preview(project: StudioProject) {
  const outputs = project.spec.languageRenderOutputs;
  const done = outputs && typeof outputs === 'object' ? Object.values(outputs).find(item => item?.status === 'done' && item.previewUrl) : undefined;
  return String(done?.previewUrl || project.spec.renderOutputPreviewUrl || '');
}
function creationMode(project: StudioProject): 'viral_replication' | 'free_creation' {
  const path = String(project.spec.creationPath || project.spec.creationMode || project.spec.mode || '').toLowerCase();
  return ['viral_replication', 'clone'].includes(path) ? 'viral_replication' : 'free_creation';
}
function creationModeLabel(project: StudioProject) {
  return creationMode(project) === 'viral_replication' ? '爆款复刻模式' : '自由创作模式';
}
function acceptedRender(project: StudioProject) {
  const acceptance = project.spec.renderAcceptance;
  return Boolean(acceptance && typeof acceptance === 'object' && !Array.isArray(acceptance)
    && (acceptance as Record<string, unknown>).accepted === true
    && (acceptance as Record<string, unknown>).renderPath);
}
function structureLabel(analysis: BenchmarkAnalysis, segment: BenchmarkAnalysis['structure'][number]) {
  const indices = segment.shotIds.map(id => analysis.shots.find(shot => shot.shotId === id)?.index).filter((index): index is number => index !== undefined);
  const first = indices[0];
  const last = indices.at(-1);
  const range = first === undefined ? '镜头范围未记录' : first === last ? `第 ${first} 镜` : `第 ${first}–${last} 镜`;
  return `${MATERIAL_TYPE_LABELS[segment.materialType]} · ${range}`;
}
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
function Detail({ project, authoritative, onClose, onOpen }: { project: StudioProject; authoritative?: BenchmarkAnalysis; onClose: () => void; onOpen: () => void }) {
  const ref = useModalFocus<HTMLDivElement>({ open: true, onClose });
  const data = creationHistoryAnalysis(project.spec, authoritative);
  const url = preview(project);
  const hook = data.reference.shots.find(shot => shot.shotId === data.reference.hookShotId);
  return <div className="fixed inset-0 z-[195] flex justify-end bg-slate-950/50" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="creation-material-title" className="flex h-full w-full max-w-3xl flex-col bg-white shadow-xl">
      <header className="flex items-center justify-between border-b p-5"><div><div className="flex flex-wrap items-center gap-2"><h2 id="creation-material-title" className="font-semibold">{project.title}</h2><span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-800">{creationModeLabel(project)}</span></div><p className="mt-1 text-xs text-text-muted">创作于 {date(project.createdAt)}</p></div><button aria-label="关闭素材详情" onClick={onClose}><X size={20} /></button></header>
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {url && <video controls playsInline src={url} className="max-h-80 w-full rounded-lg bg-black" />}
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-xs leading-6"><h3 className="font-bold text-emerald-900">钩子内容</h3><p className="font-semibold">继承的原片钩子</p><p>画面：{hook?.visual || '尚无原片钩子分析'}</p><p>口播：{hook?.dialogue || hook?.onScreenText || '未记录'}</p><p>作用：{hook?.purpose || '未记录'}</p><p className="mt-3 font-semibold">{data.hook.source}</p><p>画面：{data.hook.visual || '未记录'}</p><p>口播：{data.hook.dialogue || '未记录'}</p></section>
        <p className="text-xs text-text-muted">以下为草稿保留的对标视频结构与分析。</p>
        <BenchmarkAnalysisSections analysis={data.reference} renderClip={clip => <video src={clip} controls playsInline className="max-h-64 w-full bg-black" />} />
        <section className="rounded-lg border p-4"><h3 className="text-sm font-bold">本次创作分镜 · {data.slots.length} 镜</h3>{data.slots.length ? data.slots.map((slot, index) => <article key={String(slot.id || index)} className="mt-2 rounded-lg bg-slate-50 p-3 text-xs leading-6"><strong>{index + 1}. {String(slot.time || '')} · {String(slot.title || '分镜')}{index === 0 ? ' · 钩子' : ''}</strong><p className="whitespace-pre-wrap">{String(slot.detail || '')}</p></article>) : <p className="mt-2 text-xs text-text-muted">此历史草稿尚未记录创作分镜。</p>}</section>
      </div><footer className="border-t p-4"><button onClick={onOpen} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white">进入草稿制作</button></footer>
    </div>
  </div>;
}
export default function CreationMaterialHistory({ projects, loading, error, onBack, onOpenProject }: { projects: StudioProject[]; loading: boolean; error: string; onBack: () => void; onOpenProject: (project: StudioProject) => void }) {
  const [selected, setSelected] = useState<StudioProject | null>(null);
  const [query, setQuery] = useState('');
  const [sourceAnalyses, setSourceAnalyses] = useState<Record<string, BenchmarkAnalysis>>({});
  const referenceId = (project: StudioProject) => String(recordOf(recordOf(project.spec.videoKickoff).video).referenceRecordId || '');
  useEffect(() => {
    const controller = new AbortController();
    const ids = [...new Set(projects.map(referenceId).filter(Boolean))];
    void Promise.allSettled(ids.map(async id => {
      const response = await fetch(`/api/overseas/videos/${encodeURIComponent(id)}`, { headers: authHeader(), signal: controller.signal });
      if (!response.ok) return;
      const video = recordOf(await response.json());
      let payload = video.aiAnalysis;
      if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { return; } }
      const raw = recordOf(payload);
      const analysis = (raw.benchmarkAnalysis as BenchmarkAnalysis | undefined) || buildBenchmarkAnalysis({ analysis: raw, videoId: id, duration: Number(video.duration) });
      if (!controller.signal.aborted) setSourceAnalyses(current => ({ ...current, [id]: analysis }));
    }));
    return () => controller.abort();
  }, [projects]);
  const items = useMemo(() => projects.filter(project => project.title.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [projects, query]);
  return <div className="space-y-4"><button onClick={onBack} className="inline-flex items-center gap-2 text-xs font-bold text-emerald-800"><ArrowLeft size={16} />返回我的创作</button><div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold">历史素材</h1><p className="mt-2 text-xs text-text-muted">按创作时间从新到旧 · 共 {items.length} 项 · 保留分镜结构与钩子内容</p></div><input aria-label="搜索历史素材" placeholder="搜索创作标题" value={query} onChange={event => setQuery(event.target.value)} className="rounded-lg border bg-white px-3 py-2 text-sm" /></div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="overflow-x-auto rounded-lg border bg-white"><table aria-label="历史创作素材" aria-busy={loading} className="w-full min-w-[820px] text-left text-xs"><thead className="bg-slate-50 text-text-muted"><tr><th scope="col" className="p-3">素材 / 成片草稿</th><th scope="col" className="p-3">创作模式</th><th scope="col" className="p-3">继承结构</th><th scope="col" className="p-3">钩子</th><th scope="col" className="p-3">创作时间</th><th scope="col" className="p-3">状态</th><th scope="col" className="p-3">操作</th></tr></thead><tbody>{items.map(project => {
      const data = creationHistoryAnalysis(project.spec, sourceAnalyses[referenceId(project)]); const url = preview(project); const hook = data.reference.shots.find(shot => shot.shotId === data.reference.hookShotId);
      return <tr key={project.id} className="border-t hover:bg-emerald-50/40"><td className="p-3"><button onClick={() => setSelected(project)} className="flex max-w-sm items-center gap-3 text-left"><CreationHistoryCover project={project} firstFrameRef={data.reference.shots[0]?.firstFrameRef || undefined} /><span className="line-clamp-2 font-bold">{project.title}</span></button></td><td className="p-3"><span className="whitespace-nowrap rounded-full bg-emerald-100 px-2 py-1 font-semibold text-emerald-800">{creationModeLabel(project)}</span></td><td className="max-w-64 p-3 leading-6">{data.reference.structure.map(segment => structureLabel(data.reference, segment)).join(' → ') || '尚无原片分析'}<p className="text-text-muted">创作分镜 {data.slots.length} 镜</p></td><td className="max-w-48 p-3"><span className="rounded bg-emerald-50 px-2 py-1 text-emerald-800">{data.hook.visual || data.hook.dialogue ? '创作钩子' : hook ? '继承钩子' : '待记录'}</span><p className="mt-2 line-clamp-2">{data.hook.visual || data.hook.dialogue || hook?.dialogue || hook?.visual || '未记录'}</p></td><td className="whitespace-nowrap p-3">{date(project.createdAt)}</td><td className="whitespace-nowrap p-3">{project.status === 'published' ? '已发布' : acceptedRender(project) ? '已验收成片' : url ? '成片草稿' : '制作中'}</td><td className="p-3"><button onClick={() => setSelected(project)} className="whitespace-nowrap font-bold text-emerald-800">查看详情</button></td></tr>;
    })}</tbody></table>{loading ? <p role="status" className="p-10 text-center text-sm text-text-muted">正在读取历史素材…</p> : !items.length && !error && <p className="p-10 text-center text-sm text-text-muted">{query ? '没有匹配的历史创作' : '暂无历史创作'}</p>}</div>
    {selected && <Detail project={selected} authoritative={sourceAnalyses[referenceId(selected)]} onClose={() => setSelected(null)} onOpen={() => { setSelected(null); onOpenProject(selected); }} />}
  </div>;
}
