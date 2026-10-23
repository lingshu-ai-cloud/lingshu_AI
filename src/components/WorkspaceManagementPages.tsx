import { useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Drawer, Empty, Input, Select, Spin, Tabs } from 'antd';
import {
  FileText, Search, Sparkles, Clock3, Trash2, Loader2, Play, Copy, ArrowRight,
} from 'lucide-react';
import { authHeader } from '../lib/auth';
import { studioApi, type StudioProject } from '../lib/studioApi';
import { productionSummary } from '../lib/shotProduction';
import {
  CONTENT_ACTION_STORAGE,
  consumeSessionPrefill,
  type ScriptLibraryActionPrefill,
} from '../lib/contentActionNavigation';
import PageShell from './WorkspacePageShell';
type ExactAnalysisDetail = {
  time?: string; timestamp?: string; environment?: string; shot?: string; camera?: string;
  angle?: string; composition?: string; visual?: string; subtitle?: string; dialogue?: string; audio?: string; note?: string; purpose?: string;
  onScreenText?: string; ambientSound?: string; bgm?: string; soundEffects?: string[];
  beats?: Array<{ time?: string; action?: string; dialogue?: string; onScreenText?: string }>;
  persistentState?: string; startState?: string; endState?: string; transitionToNext?: string;
  authenticity?: string; estimatedSpeechDuration?: number; dialogueFits?: boolean; confidence?: number; needsReview?: boolean;
  viralPotential?: { score?: number; mechanisms?: string[]; whyEffective?: string };
};
type AnalysisGlobalSettings = { visualStyle?: string; aspectRatio?: string; lighting?: string; subtitlePolicy?: string; audioPolicy?: string; identityConsistency?: string; productConsistency?: string; negativeConstraints?: string[] };
type FirstTenSeconds = { atmosphere?: string; audioVisual?: string; camera?: string; visuals?: string; voiceMusic?: string };
type CoarseStructure = { time?: string; frame?: string; label?: string; description?: string; desc?: string };

type ExactAnalysis = {
  analysisMode?: string;
  materialUrl?: string;
  materialPoster?: string;
  analyzedAt?: string;
  views?: string; caption?: string; sourceAccount?: string; sourceAccountName?: string;
  publicMetrics?: { likes?: string; comments?: string; shares?: string; plays?: string; observedAt?: string };
  baseRequirements?: string;
  globalSettings?: AnalysisGlobalSettings; firstTenSeconds?: FirstTenSeconds; coarseStructure?: CoarseStructure[]; structure?: string;
  scriptSummary15s?: { visualStyle?: string; coreEmotion?: string; competitors?: string[] };
  scriptDetails15s?: ExactAnalysisDetail[];
  hooks?: string[]; sellingPoints?: string[]; adaptTip?: string; theme?: string; mood?: string;
  gemini?: { baseRequirements?: string; globalSettings?: AnalysisGlobalSettings; firstTenSeconds?: FirstTenSeconds; coarseStructure?: CoarseStructure[]; structure?: string; scriptSummary15s?: { visualStyle?: string; coreEmotion?: string; competitors?: string[] }; scriptDetails15s?: ExactAnalysisDetail[]; hooks?: string[]; sellingPoints?: string[]; adaptTip?: string; theme?: string; mood?: string };
};

type ExactVideoRecord = {
  id: string;
  title?: string; platform?: string; thumbnailUrl?: string; sourceUrl?: string; videoUrl?: string;
  duration?: number; created?: string; updated?: string; crawledAt?: string; aiAnalysis?: ExactAnalysis | string;
};


const parseAnalysis = (value: ExactVideoRecord['aiAnalysis']): ExactAnalysis => {
  let parsed: ExactAnalysis = {};
  if (value && typeof value === 'object') parsed = value;
  else try { parsed = JSON.parse(String(value || '{}')) as ExactAnalysis; } catch { parsed = {}; }
  return {
    ...parsed,
    baseRequirements: parsed.baseRequirements || parsed.gemini?.baseRequirements,
    globalSettings: parsed.globalSettings || parsed.gemini?.globalSettings,
    firstTenSeconds: parsed.firstTenSeconds || parsed.gemini?.firstTenSeconds,
    coarseStructure: parsed.coarseStructure || parsed.gemini?.coarseStructure || [],
    structure: parsed.structure || parsed.gemini?.structure,
    scriptSummary15s: parsed.scriptSummary15s || parsed.gemini?.scriptSummary15s,
    scriptDetails15s: parsed.scriptDetails15s || parsed.gemini?.scriptDetails15s || [],
    hooks: parsed.hooks || parsed.gemini?.hooks || [],
    sellingPoints: parsed.sellingPoints || parsed.gemini?.sellingPoints || [],
    adaptTip: parsed.adaptTip || parsed.gemini?.adaptTip,
    theme: parsed.theme || parsed.gemini?.theme,
    mood: parsed.mood || parsed.gemini?.mood,
  };
};

const structuralDetailText = (detail: ExactAnalysisDetail) => [
  detail.environment ? `环境：${detail.environment}` : '',
  detail.shot ? `景别：${detail.shot}` : '',
  detail.camera ? `运镜：${detail.camera}` : '',
  detail.purpose ? `镜头功能：${detail.purpose}` : '',
  detail.visual ? `画面：${detail.visual}` : '',
  detail.audio ? `配乐/声音：${detail.audio}` : '',
].filter(Boolean).join('；');

async function loadAllExactVideoRecords(): Promise<ExactVideoRecord[]> {
  const loadPage = async (page: number) => {
    const response = await fetch(`/api/overseas/videos?page=${page}&perPage=100&contentFormat=video&crawlRange=all`, { headers: authHeader() });
    if (!response.ok) throw new Error('视频列表读取失败');
    return await response.json() as { items?: ExactVideoRecord[]; totalPages?: number };
  };
  const first = await loadPage(1);
  const totalPages = Math.max(1, Number(first.totalPages || 1));
  const rest = totalPages > 1 ? await Promise.all(Array.from({ length: totalPages - 1 }, (_, index) => loadPage(index + 2))) : [];
  return [first, ...rest].flatMap(result => Array.isArray(result.items) ? result.items : []);
}

const firstDraftMedia = (project: StudioProject) => {
  const snapshots = Array.isArray(project.spec?.materialSnapshots) ? project.spec.materialSnapshots as Array<Record<string, unknown>> : [];
  const kickoff = project.spec?.videoKickoff as { generatedVideo?: { url?: string; poster?: string }; video?: { videoUrl?: string; thumbnail?: string; aiAnalysis?: { materialUrl?: string; materialPoster?: string } } } | undefined;
  const snapshot = snapshots.find(item => item.type === 'video' && (item.url || item.poster)) || snapshots.find(item => item.url || item.poster);
  return {
    url: String(snapshot?.url || kickoff?.generatedVideo?.url || kickoff?.video?.aiAnalysis?.materialUrl || kickoff?.video?.videoUrl || ''),
    poster: String(snapshot?.poster || kickoff?.generatedVideo?.poster || kickoff?.video?.aiAnalysis?.materialPoster || kickoff?.video?.thumbnail || ''),
  };
};

const modeLabel = (mode: unknown) => ({ material: '素材库智能生成', clone: '爆款裂变', product: '产品信息生成' }[String(mode)] || '智能创作');
const formatDate = (value?: string) => value ? new Date(value).toLocaleDateString('zh-CN') : '时间未记录';
const draftProgress = (project: StudioProject) => {
  const spec = project.spec || {};
  const hasVideo = Boolean(spec.posterImageUrl)
    || (spec.storyboardVideoVersions && Object.keys(spec.storyboardVideoVersions as object).length > 0)
    || (Array.isArray(spec.productVideoVersions) && spec.productVideoVersions.length > 0);
  if (hasVideo) return '已生成成片';
  if (spec.cover || spec.coverTitle) return '封面制作';
  if ((Array.isArray(spec.selected) && spec.selected.length) || (spec.storyboardAssignments && Object.keys(spec.storyboardAssignments as object).length)) return '素材编排';
  if (String(spec.script || '').trim()) return '脚本已生成';
  return '已选创作模式';
};

function HoverMedia({ title, poster, url }: { title: string; poster?: string; url?: string }) {
  return <div className="relative aspect-video overflow-hidden bg-slate-100">
    {url ? <video src={url} poster={poster} muted loop playsInline controls aria-label={`${title}视频预览`} preload="metadata" className="h-full w-full object-cover" onMouseEnter={event => void event.currentTarget.play().catch(() => {})} onMouseLeave={event => { event.currentTarget.pause(); event.currentTarget.currentTime = 0; }} />
      : poster ? <img src={poster} alt={title} className="h-full w-full object-cover" />
        : <div className="flex h-full items-center justify-center text-emerald-500"><Play size={28} /></div>}
  </div>;
}

export function ScriptLibraryPage({ socialContentTaskId }: { socialContentTaskId?: string | null } = {}) {
  const { modal } = App.useApp();
  const [tab, setTab] = useState<'inspiration' | 'studio'>('inspiration');
  const [videos, setVideos] = useState<Array<ExactVideoRecord & { analysis: ExactAnalysis }>>([]);
  const [drafts, setDrafts] = useState<StudioProject[]>([]);
  const [query, setQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [videoTimeFilter, setVideoTimeFilter] = useState<'all' | '7d' | '30d'>('all');
  const [creationModeFilter, setCreationModeFilter] = useState('all');
  const [draftTimeFilter, setDraftTimeFilter] = useState<'all' | '7d' | '30d'>('all');
  const [loading, setLoading] = useState(true);
  const [selectedVideo, setSelectedVideo] = useState<(ExactVideoRecord & { analysis: ExactAnalysis }) | null>(null);
  const [selectedDraft, setSelectedDraft] = useState<StudioProject | null>(null);
  const [draftBusyId, setDraftBusyId] = useState('');
  const [actionError, setActionError] = useState('');
  useEffect(() => {
    const prefill = consumeSessionPrefill<ScriptLibraryActionPrefill>(CONTENT_ACTION_STORAGE.scriptLibrary);
    if (prefill?.tab) setTab(prefill.tab);
    else if (prefill?.projectId) setTab('studio');
    else if (prefill?.contentId) setTab('inspiration');
    if (typeof prefill?.query === 'string') setQuery(prefill.query);

    void Promise.all([
      loadAllExactVideoRecords(),
      studioApi.listProjects(),
    ])
      .then(([records, projects]) => {
        const exactVideos = records.map(record => ({ ...record, analysis: parseAnalysis(record.aiAnalysis) })).filter(record => record.analysis.analysisMode === 'exact' && (record.analysis.scriptDetails15s?.length || 0) > 0);
        const draftProjects = projects.filter(project => project.status === 'draft');
        setVideos(exactVideos);
        setDrafts(draftProjects);
        if (prefill?.openDetail && prefill.contentId) {
          const match = exactVideos.find(record => record.id === prefill.contentId);
          if (match) setSelectedVideo(match);
        }
        if (prefill?.openDetail && prefill.projectId) {
          const match = draftProjects.find(project => project.id === prefill.projectId);
          if (match) setSelectedDraft(match);
        }
      })
      .catch(() => { setVideos([]); setDrafts([]); setActionError('脚本库加载失败，请刷新后重试。'); })
      .finally(() => setLoading(false));
  }, []);

  const filteredVideos = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const timeFloor = videoTimeFilter === '7d' ? Date.now() - 7 * 86400000 : videoTimeFilter === '30d' ? Date.now() - 30 * 86400000 : 0;
    return videos.filter(item => {
      if (platformFilter !== 'all' && String(item.platform || '').toLowerCase() !== platformFilter) return false;
      const itemTime = Date.parse(item.crawledAt || item.created || item.updated || '');
      if (timeFloor && (!Number.isFinite(itemTime) || itemTime < timeFloor)) return false;
      if (!keyword) return true;
      return `${item.title || ''} ${item.analysis.baseRequirements || ''} ${item.analysis.scriptDetails15s?.map(detail => `${structuralDetailText(detail)} ${detail.dialogue || ''} ${detail.subtitle || ''}`).join(' ') || ''}`.toLowerCase().includes(keyword);
    });
  }, [videos, query, platformFilter, videoTimeFilter]);
  const filteredDrafts = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const timeFloor = draftTimeFilter === '7d' ? Date.now() - 7 * 86400000 : draftTimeFilter === '30d' ? Date.now() - 30 * 86400000 : 0;
    return drafts.filter(item => {
      const mode = String(item.spec?.mode || '');
      if (creationModeFilter !== 'all' && mode !== creationModeFilter) return false;
      const itemTime = Date.parse(item.updatedAt || item.createdAt || '');
      if (timeFloor && (!Number.isFinite(itemTime) || itemTime < timeFloor)) return false;
      return !keyword || `${item.title} ${String(item.spec?.script || '')}`.toLowerCase().includes(keyword);
    });
  }, [drafts, query, creationModeFilter, draftTimeFilter]);
  const availablePlatforms = useMemo(() => [...new Set(videos.map(item => String(item.platform || '').toLowerCase()).filter(Boolean))].sort(), [videos]);
  const visibleCount = tab === 'inspiration' ? filteredVideos.length : filteredDrafts.length;

  const openSmartAssets = () => window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'smartAssets', view: 'create', socialContentTaskId, socialContentPage: 'smartAssets' } }));
  const startViralClone = (item: ExactVideoRecord & { analysis: ExactAnalysis }) => {
    const analysis = item.analysis;
    localStorage.setItem('ow_video_kickoff', JSON.stringify({
      source: 'inspiration_analysis',
      video: {
        id: item.id, recordId: item.id, platform: item.platform || 'tiktok', title: item.title,
        thumbnail: item.thumbnailUrl || analysis.materialPoster, duration: item.duration || 0,
        sourceUrl: item.sourceUrl, videoUrl: analysis.materialUrl || item.videoUrl,
        status: 'analyzed', contentFormat: 'video',
        aiAnalysis: { ...analysis, gemini: analysis.gemini || { baseRequirements: analysis.baseRequirements, scriptSummary15s: analysis.scriptSummary15s, scriptDetails15s: analysis.scriptDetails15s } },
      },
      scriptType: 'storyboard', language: 'zh',
      referenceAnalysis: {
        title: item.title,
        visualStyle: analysis.scriptSummary15s?.visualStyle || '',
        coreEmotion: analysis.scriptSummary15s?.coreEmotion || '',
        details: analysis.scriptDetails15s || [],
      },
    }));
    setSelectedVideo(null);
    openSmartAssets();
  };
  const continueDraft = (project: StudioProject) => {
    localStorage.setItem('ow_studio_open_project', JSON.stringify({ projectId: project.id, at: Date.now() }));
    setSelectedDraft(null);
    openSmartAssets();
  };
  const copyDraft = async (project: StudioProject) => {
    setDraftBusyId(project.id); setActionError('');
    try {
      const saved = await studioApi.saveProject({ title: `${project.title || '未命名草稿'} · 副本`, status: 'draft', spec: JSON.parse(JSON.stringify(project.spec || {})), thumbSeed: project.thumbSeed });
      if (!saved.ok || !saved.project) throw new Error('复制失败，请稍后重试');
      setDrafts(current => [saved.project, ...current]);
      setSelectedDraft(saved.project);
    } catch (error) { setActionError(error instanceof Error ? error.message : '复制失败，请稍后重试'); }
    finally { setDraftBusyId(''); }
  };
  const deleteDraft = (project: StudioProject) => {
    modal.confirm({
      title: '删除创作草稿？',
      content: `确认删除草稿“${project.title}”吗？此操作无法撤销。`,
      okText: '删除草稿', cancelText: '取消', okButtonProps: { danger: true }, zIndex: 2000,
      onOk: async () => {
        setDraftBusyId(project.id); setActionError('');
        try {
          await studioApi.deleteProject(project.id);
          setDrafts(items => items.filter(item => item.id !== project.id));
          setSelectedDraft(null);
        } catch {
          setActionError('删除失败，请稍后重试');
          throw new Error('删除失败，请稍后重试');
        } finally { setDraftBusyId(''); }
      },
    });
  };

  return (
    <PageShell icon={<FileText size={14} />} title="脚本库" description="管理可直接裂变的爆款视频和全部历史创作草稿，让成熟内容可以持续复用。">
      <Tabs activeKey={tab} onChange={key => { setTab(key as 'inspiration' | 'studio'); setQuery(''); }} items={[{ key: 'inspiration', label: '可裂变爆款' }, { key: 'studio', label: '历史创作' }]} />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Input allowClear prefix={<Search size={16} className="text-text-muted" />} aria-label="搜索脚本库" value={query} onChange={event => setQuery(event.target.value)}
          placeholder={tab === 'inspiration' ? '搜索视频标题或脚本详析' : '搜索草稿标题或脚本'} className="min-w-52 flex-1" />
        {tab === 'inspiration' ? <>
          <Select aria-label="社媒平台" className="min-w-40" value={platformFilter} onChange={setPlatformFilter} options={[{ value: 'all', label: '全部平台' }, ...availablePlatforms.map(platform => ({ value: platform, label: platform }))]} />
          <Select aria-label="入库时间" className="min-w-36" value={videoTimeFilter} onChange={setVideoTimeFilter} options={[{ value: 'all', label: '全部入库时间' }, { value: '7d', label: '近 7 天' }, { value: '30d', label: '近 30 天' }]} />
        </> : <>
          <Select aria-label="创作模式" className="min-w-40" value={creationModeFilter} onChange={setCreationModeFilter} options={[{ value: 'all', label: '全部模式' }, { value: 'material', label: '素材库智能生成' }, { value: 'clone', label: '爆款裂变' }, { value: 'product', label: '产品信息生成' }]} />
          <Select aria-label="更新时间" className="min-w-36" value={draftTimeFilter} onChange={setDraftTimeFilter} options={[{ value: 'all', label: '全部更新时间' }, { value: '7d', label: '近 7 天' }, { value: '30d', label: '近 30 天' }]} />
        </>}
        <span className="text-sm tabular-nums text-text-muted">{visibleCount} 条</span>
      </div>
      {actionError && <Alert className="mb-4" type="error" showIcon title={actionError} closable onClose={() => setActionError('')} />}
      {loading ? (
        <div className="rounded-lg border border-border bg-white p-10 text-center" aria-live="polite"><Spin /><p className="mt-3 text-sm text-text-muted">正在读取脚本库…</p></div>
      ) : tab === 'inspiration' && filteredVideos.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filteredVideos.map(item => {
          const details = item.analysis.scriptDetails15s || [];
          const preview = [
            item.analysis.baseRequirements ? `基础要求：${item.analysis.baseRequirements}` : '',
            ...details.slice(0, 2).map(structuralDetailText),
          ].filter(Boolean).join('；');
          const tags = [...(item.analysis.hooks || []), ...(item.analysis.sellingPoints || [])].filter(Boolean).slice(0, 3);
          return <article key={item.id} className="overflow-hidden rounded-lg border border-border bg-white text-left">
            <HoverMedia title={item.title || '精确分析视频'} poster={item.thumbnailUrl || item.analysis.materialPoster} url={item.analysis.materialUrl || item.videoUrl || item.sourceUrl} />
            <div className="p-4"><div className="flex items-start justify-between gap-3"><h2 className="line-clamp-2 text-sm font-semibold text-text-primary">{item.title || '未命名视频'}</h2><span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">可直接裂变</span></div><p className="mt-2 line-clamp-3 text-sm leading-5 text-text-secondary">{preview || '点击查看完整脚本详析'}</p>{tags.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{tags.map(tag => <span key={tag} className="max-w-full truncate rounded-md bg-surface-2 px-2 py-1 text-xs font-medium text-text-secondary">{tag}</span>)}</div>}<p className="mt-3 text-xs font-medium text-text-muted">{item.platform || '社媒视频'} · {details.length} 个分析分镜 · {formatDate(item.crawledAt || item.created || item.updated)}</p><div className="mt-4 grid grid-cols-2 gap-2"><Button onClick={() => setSelectedVideo(item)}>查看分析</Button><Button onClick={() => startViralClone(item)} type="primary">开始裂变<ArrowRight size={13} /></Button></div></div>
          </article>;
        })}</div>
      ) : tab === 'studio' && filteredDrafts.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filteredDrafts.map(project => {
          const media = firstDraftMedia(project); const script = String(project.spec?.script || '');
          return <article key={project.id} className="overflow-hidden rounded-lg border border-border bg-white text-left">
            <HoverMedia title={project.title} poster={media.poster} url={media.url} />
            {productionSummary(project.spec || {}) && <p className="px-4 pt-3 text-xs text-amber-700">{productionSummary(project.spec || {})}</p>}
            <div className="p-4"><div><div className="flex items-start justify-between gap-3"><h2 className="line-clamp-2 text-sm font-semibold text-text-primary">{project.title || '未命名草稿'}</h2><span className="shrink-0 rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">{draftProgress(project)}</span></div><p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-5 text-text-secondary">{script || '草稿尚未生成脚本内容'}</p><p className="mt-3 flex items-center gap-1 text-xs text-text-muted"><Clock3 size={11} />{modeLabel(project.spec?.mode)} · {formatDate(project.updatedAt || project.createdAt)}</p><Button type="link" className="mt-2 px-0" onClick={() => setSelectedDraft(project)}>查看草稿</Button></div><div className="mt-4 flex gap-2"><Button onClick={() => continueDraft(project)} type="primary" className="flex-1">继续创作<ArrowRight size={13} /></Button><Button disabled={draftBusyId === project.id} title="复制草稿" onClick={() => void copyDraft(project)} aria-label="复制草稿"><Copy size={14} /></Button><Button disabled={draftBusyId === project.id} title="删除草稿" onClick={() => void deleteDraft(project)} danger aria-label="删除草稿">{draftBusyId === project.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}</Button></div></div>
          </article>;
        })}</div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-white p-10">
          <Empty description={<><p className="font-medium text-text-primary">{tab === 'inspiration' ? '暂无可裂变爆款' : '暂无历史创作草稿'}</p><p className="mt-1 text-sm text-text-muted">{tab === 'inspiration' ? '在灵感大屏完成视频的全篇精确分析后，会自动进入这里。' : '在智能素材中保存草稿后，会自动进入这里。'}</p></>} />
        </div>
      )}
      {selectedVideo && <Drawer open size={760} onClose={() => setSelectedVideo(null)} title={selectedVideo.title || '全篇精确分析'}
        footer={<Button block type="primary" onClick={() => startViralClone(selectedVideo)} icon={<Sparkles size={16} />}>开始爆款裂变</Button>}>
          <p className="mb-4 text-sm text-text-muted">{selectedVideo.platform || '社媒视频'} · {selectedVideo.analysis.scriptDetails15s?.length || 0} 个分析分镜</p>
          <div><HoverMedia title={selectedVideo.title || ''} poster={selectedVideo.thumbnailUrl || selectedVideo.analysis.materialPoster} url={selectedVideo.analysis.materialUrl || selectedVideo.videoUrl || selectedVideo.sourceUrl} />
            <section className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{[
              ['平台', selectedVideo.platform || '未记录'],
              ['播放', selectedVideo.analysis.publicMetrics?.plays || selectedVideo.analysis.views || '未记录'],
              ['入库时间', formatDate(selectedVideo.crawledAt || selectedVideo.created)],
              ['分析时间', formatDate(selectedVideo.analysis.analyzedAt)],
            ].map(([label, value]) => <div key={label} className="rounded-lg border border-border bg-surface-2 px-3 py-2"><p className="text-xs font-medium text-text-muted">{label}</p><p className="mt-1 truncate text-xs font-semibold text-text-primary">{value}</p></div>)}</section>
            {(selectedVideo.analysis.theme || selectedVideo.analysis.mood || selectedVideo.analysis.hooks?.length || selectedVideo.analysis.sellingPoints?.length) && <section className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50/60 p-4"><h3 className="text-xs font-semibold text-emerald-800">为什么值得裂变</h3>{selectedVideo.analysis.theme && <p className="mt-2 text-sm leading-5 text-text-secondary"><b>主题：</b>{selectedVideo.analysis.theme}</p>}{selectedVideo.analysis.mood && <p className="mt-1 text-sm leading-5 text-text-secondary"><b>情绪：</b>{selectedVideo.analysis.mood}</p>}{selectedVideo.analysis.hooks?.length ? <p className="mt-1 text-sm leading-5 text-text-secondary"><b>内容钩子：</b>{selectedVideo.analysis.hooks.join('；')}</p> : null}{selectedVideo.analysis.sellingPoints?.length ? <p className="mt-1 text-sm leading-5 text-text-secondary"><b>卖点：</b>{selectedVideo.analysis.sellingPoints.join('；')}</p> : null}</section>}
            {selectedVideo.analysis.firstTenSeconds && Object.values(selectedVideo.analysis.firstTenSeconds).some(Boolean) && <section className="mt-4 rounded-lg border border-border p-4"><h3 className="text-xs font-semibold text-text-primary">前 10 秒五维拆解</h3><div className="mt-3 grid gap-2 sm:grid-cols-2">{[
              ['氛围', selectedVideo.analysis.firstTenSeconds.atmosphere], ['声画配合', selectedVideo.analysis.firstTenSeconds.audioVisual], ['镜头', selectedVideo.analysis.firstTenSeconds.camera], ['画面', selectedVideo.analysis.firstTenSeconds.visuals], ['口播与音乐', selectedVideo.analysis.firstTenSeconds.voiceMusic],
            ].filter(([, value]) => Boolean(value)).map(([label, value]) => <div key={label} className="rounded-lg bg-surface-2 px-3 py-2"><p className="text-xs font-semibold text-emerald-700">{label}</p><p className="mt-1 text-sm leading-5 text-text-secondary">{value}</p></div>)}</div></section>}
            {(selectedVideo.analysis.scriptSummary15s?.visualStyle || selectedVideo.analysis.scriptSummary15s?.coreEmotion || selectedVideo.analysis.scriptSummary15s?.competitors?.length) && <section className="mt-4 rounded-lg border border-border p-4"><h3 className="text-xs font-semibold text-text-primary">内容摘要</h3>{selectedVideo.analysis.scriptSummary15s?.visualStyle && <p className="mt-2 text-sm leading-5 text-text-secondary"><b>视觉风格：</b>{selectedVideo.analysis.scriptSummary15s.visualStyle}</p>}{selectedVideo.analysis.scriptSummary15s?.coreEmotion && <p className="mt-1 text-sm leading-5 text-text-secondary"><b>核心情绪：</b>{selectedVideo.analysis.scriptSummary15s.coreEmotion}</p>}{selectedVideo.analysis.scriptSummary15s?.competitors?.length ? <p className="mt-1 text-sm leading-5 text-text-secondary"><b>参考品牌/竞品：</b>{selectedVideo.analysis.scriptSummary15s.competitors.join('；')}</p> : null}</section>}
            {selectedVideo.analysis.globalSettings && Object.values(selectedVideo.analysis.globalSettings).some(value => Array.isArray(value) ? value.length : Boolean(value)) && <section className="mt-4 rounded-lg border border-border p-4"><h3 className="text-xs font-semibold text-text-primary">全局制作要求</h3><div className="mt-2 space-y-1">{[
              ['视觉风格', selectedVideo.analysis.globalSettings.visualStyle], ['画幅', selectedVideo.analysis.globalSettings.aspectRatio], ['灯光', selectedVideo.analysis.globalSettings.lighting], ['字幕策略', selectedVideo.analysis.globalSettings.subtitlePolicy], ['声音策略', selectedVideo.analysis.globalSettings.audioPolicy], ['人物一致性', selectedVideo.analysis.globalSettings.identityConsistency], ['产品一致性', selectedVideo.analysis.globalSettings.productConsistency], ['避免事项', selectedVideo.analysis.globalSettings.negativeConstraints?.join('；')],
            ].filter(([, value]) => Boolean(value)).map(([label, value]) => <p key={label} className="text-sm leading-5 text-text-secondary"><b>{label}：</b>{value}</p>)}</div></section>}
            {selectedVideo.analysis.coarseStructure?.length ? <section className="mt-4 rounded-lg border border-border p-4"><h3 className="text-xs font-semibold text-text-primary">内容结构</h3><div className="mt-3 space-y-2">{selectedVideo.analysis.coarseStructure.map((step, index) => <div key={`${step.time}-${index}`} className="flex gap-3 rounded-lg bg-surface-2 px-3 py-2"><span className="shrink-0 text-xs font-semibold text-emerald-700">{step.time || `阶段 ${index + 1}`}</span><p className="text-sm leading-5 text-text-secondary"><b>{step.label || step.frame || '内容阶段'}</b>{(step.description || step.desc) ? `：${step.description || step.desc}` : ''}</p></div>)}</div></section> : null}
            {selectedVideo.analysis.baseRequirements && <section className="mt-4 rounded-lg border border-border p-4"><h3 className="text-xs font-semibold text-text-primary">基础要求</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-secondary">{selectedVideo.analysis.baseRequirements}</p></section>}
            <h3 className="mt-5 text-sm font-semibold text-text-primary">分镜脚本详析</h3><div className="mt-3 space-y-3">{(selectedVideo.analysis.scriptDetails15s || []).map((detail, index) => <section key={`${detail.time || detail.timestamp}-${index}`} className="rounded-lg border border-border p-4"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">{detail.time || detail.timestamp || `分镜 ${index + 1}`}</span><strong className="text-xs text-text-primary">{detail.purpose || detail.shot || '脚本分镜'}</strong></div>{typeof detail.confidence === 'number' && <span className="text-xs font-medium text-text-muted">识别置信度 {Math.round(detail.confidence * 100)}%</span>}</div>{detail.environment && <p className="mt-2 text-sm leading-5 text-text-secondary"><b>环境：</b>{detail.environment}</p>}{(detail.shot || detail.camera || detail.angle || detail.composition) && <p className="mt-1 text-sm leading-5 text-text-secondary"><b>镜头设计：</b>{[detail.shot, detail.camera, detail.angle, detail.composition].filter(Boolean).join('；')}</p>}{detail.visual && <p className="mt-1 text-sm leading-5 text-text-secondary"><b>画面：</b>{detail.visual}</p>}{detail.onScreenText && <p className="mt-1 text-sm leading-5 text-text-secondary"><b>屏幕文字：</b>{detail.onScreenText}</p>}{(detail.bgm || detail.audio || detail.ambientSound || detail.soundEffects?.length) && <p className="mt-1 text-sm leading-5 text-text-secondary"><b>声音设计：</b>{[detail.bgm || detail.audio, detail.ambientSound, detail.soundEffects?.join('、')].filter(Boolean).join('；')}</p>}{(detail.startState || detail.endState || detail.transitionToNext || detail.persistentState) && <details className="mt-2 rounded-lg bg-surface-2 px-3 py-2"><summary className="cursor-pointer text-xs font-medium text-text-muted">查看连续性与转场</summary><div className="mt-2 space-y-1 text-sm leading-5 text-text-secondary">{detail.startState && <p><b>开始状态：</b>{detail.startState}</p>}{detail.endState && <p><b>结束状态：</b>{detail.endState}</p>}{detail.persistentState && <p><b>持续状态：</b>{detail.persistentState}</p>}{detail.transitionToNext && <p><b>下镜转场：</b>{detail.transitionToNext}</p>}</div></details>}{detail.beats?.length ? <details className="mt-2 rounded-lg bg-surface-2 px-3 py-2"><summary className="cursor-pointer text-xs font-medium text-text-muted">查看镜头内节拍（{detail.beats.length}）</summary><div className="mt-2 space-y-1">{detail.beats.map((beat, beatIndex) => <p key={beatIndex} className="text-sm leading-5 text-text-secondary">[{beat.time || '镜头内'}] {[beat.action, beat.dialogue ? `口播：${beat.dialogue}` : '', beat.onScreenText ? `字幕：${beat.onScreenText}` : ''].filter(Boolean).join('；')}</p>)}</div></details> : null}{(detail.dialogue || detail.subtitle) && <details className="mt-2 rounded-lg bg-surface-2 px-3 py-2"><summary className="cursor-pointer text-xs font-medium text-text-muted">查看原口播/字幕</summary><p className="mt-2 text-sm leading-5 text-text-secondary">{detail.dialogue || detail.subtitle}</p></details>}{detail.note && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm leading-5 text-amber-700"><b>复核备注：</b>{detail.note}</p>}</section>)}</div>
            {selectedVideo.analysis.adaptTip && <section className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4"><h3 className="text-xs font-semibold text-emerald-800">改编建议</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-secondary">{selectedVideo.analysis.adaptTip}</p></section>}
          </div>
        </Drawer>}
      {selectedDraft && <Drawer open size={640} onClose={() => setSelectedDraft(null)} title={selectedDraft.title || '未命名草稿'}
        footer={<div className="flex flex-wrap gap-2">
          <Button type="primary" className="flex-1" onClick={() => continueDraft(selectedDraft)} icon={<ArrowRight size={15} />}>继续创作</Button>
          <Button disabled={draftBusyId === selectedDraft.id} onClick={() => void copyDraft(selectedDraft)} icon={<Copy size={14} />}>复制</Button>
          <Button danger disabled={draftBusyId === selectedDraft.id} onClick={() => void deleteDraft(selectedDraft)} icon={<Trash2 size={15} />}>删除</Button>
        </div>}>
        <p className="mb-4 text-sm text-text-muted">{modeLabel(selectedDraft.spec?.mode)} · {draftProgress(selectedDraft)} · 更新于 {formatDate(selectedDraft.updatedAt || selectedDraft.createdAt)}</p>
        {actionError && <Alert className="mb-4" type="error" showIcon title={actionError} />}
        <HoverMedia title={selectedDraft.title} {...firstDraftMedia(selectedDraft)} />
        <h3 className="mt-5 text-base font-semibold text-text-primary">草稿脚本</h3>
        <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-surface-2 p-4 text-sm leading-6 text-text-secondary">{String(selectedDraft.spec?.script || '草稿尚未生成脚本内容')}</pre>
      </Drawer>}
    </PageShell>
  );
}
