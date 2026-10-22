import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Alert, App, Button, Drawer, Empty, Input, Modal, Select, Spin, Tabs, Upload as AntUpload } from 'antd';
import {
  BrainCircuit, FileText, Search, Sparkles, ShieldCheck,
  Users, Clock3, Plus, Trash2, Loader2, Play, Copy, ArrowRight,
  MessageCircle, Workflow,
  BarChart3, Target, CircleAlert, RefreshCw, PauseCircle, CheckCircle2,
  RotateCcw, Pencil, Download, Upload, History,
} from 'lucide-react';
import { authHeader } from '../lib/auth';
import { studioApi, type StudioProject } from '../lib/studioApi';
import { productionSummary } from '../lib/shotProduction';
import { ContentOpsExecutionDialog, type ContentOpsExecutionIntent } from './ContentOpsExecutionDialog';
import { HighConfidenceInsights, PlatformTrends } from './ContentOpsDrilldowns';
import { contentOpsOverview, socialMetricsOpsOverview, MOCK_CONTENT_OPS_OVERVIEW, hasContentOpsData } from './workspaceContentOps';
import type { ContentOpsOverview } from './workspaceContentOps';
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

export function AgentMemoryPage({ includeMockCustomers = false, mockCustomerScope = 'admin' }: { includeMockCustomers?: boolean; mockCustomerScope?: string } = {}) {
  type MemoryTab = 'content' | 'style' | 'customer' | 'strategy';
  type MemoryEditor =
    | { kind: 'customer-add'; customerId: string; customerName: string; key: string; value: string; expiresAt: string; existingKeys: string[] }
    | { kind: 'customer-edit'; id: string; key: string; value: string; expiresAt: string }
    | { kind: 'style-edit'; id: string; finalSent: string }
    | { kind: 'strategy-edit'; id: string; adjustment: string };
  type MemoryConfirm = { title: string; description: string; confirmLabel: string; danger?: boolean; action: () => Promise<unknown> | void };
  type ContentMemory = {
    id: string; kind: 'analysis' | 'draft'; title: string; source: string; updated?: string;
    description: string; tags: string[]; poster?: string; evidence: string[]; usage: string;
  };
  const [tab, setTab] = useState<MemoryTab>(includeMockCustomers ? 'style' : 'content');
  const [contentMemories, setContentMemories] = useState<ContentMemory[]>([]);
  const [styleProfile, setStyleProfile] = useState<Record<string, unknown> | null>(null);
  const [customerContexts, setCustomerContexts] = useState<Array<Record<string, unknown>>>([]);
  const [responseStrategies, setResponseStrategies] = useState<Array<Record<string, unknown>>>([]);
  const [styleEvidence, setStyleEvidence] = useState<Array<Record<string, unknown>>>([]);
  const [customerMemories, setCustomerMemories] = useState<Array<Record<string, unknown>>>([]);
  const [memoryAudit, setMemoryAudit] = useState<Array<Record<string, unknown>>>([]);
  const [memoryOverview, setMemoryOverview] = useState<Record<string, any> | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(true);
  const [memoryLoadError, setMemoryLoadError] = useState('');
  const [memoryBusy, setMemoryBusy] = useState('');
  const [memoryNotice, setMemoryNotice] = useState('');
  const [memoryEditor, setMemoryEditor] = useState<MemoryEditor | null>(null);
  const [memoryConfirm, setMemoryConfirm] = useState<MemoryConfirm | null>(null);
  const [opsOverview, setOpsOverview] = useState<ContentOpsOverview | null>(null);
  const [executionIntent, setExecutionIntent] = useState<ContentOpsExecutionIntent | null>(null);
  const [opsLoading, setOpsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ContentMemory | null>(null);
  const tabs: Array<{ id: MemoryTab; label: string; icon: typeof Sparkles }> = [
    { id: 'content', label: '内容运营经验', icon: Sparkles },
    { id: 'style', label: '沟通风格', icon: MessageCircle },
    { id: 'customer', label: '客户上下文', icon: Users },
    { id: 'strategy', label: '响应策略', icon: Workflow },
  ];

  const loadMemoryGovernance = async (silent = false) => {
    if (!silent) setMemoryLoading(true);
    setMemoryLoadError('');
    try {
      const headers = authHeader();
      const [overviewResponse, evidenceResponse, customerMemoryResponse, strategyResponse, auditResponse] = await Promise.all([
        fetch('/api/overseas/agent-memory/overview', { headers }),
        fetch('/api/overseas/agent-memory/style-evidence', { headers }),
        fetch('/api/overseas/agent-memory/customer-memories', { headers }),
        fetch('/api/overseas/agent-memory/strategies', { headers }),
        fetch('/api/overseas/agent-memory/audit', { headers }),
      ]);
      if (!overviewResponse.ok) throw new Error('智能体记忆暂时加载失败，请重试。');
      const [overview, evidence, customerMemory, strategies, audit] = await Promise.all([
        overviewResponse.json(),
        evidenceResponse.ok ? evidenceResponse.json() : { items: [] },
        customerMemoryResponse.ok ? customerMemoryResponse.json() : { items: [] },
        strategyResponse.ok ? strategyResponse.json() : { items: [] },
        auditResponse.ok ? auditResponse.json() : { items: [] },
      ]);
      setMemoryOverview(overview && typeof overview === 'object' ? overview : null);
      setStyleEvidence(Array.isArray(evidence.items) ? evidence.items : []);
      setCustomerMemories(Array.isArray(customerMemory.items) ? customerMemory.items : []);
      setResponseStrategies(Array.isArray(strategies.items) ? strategies.items : []);
      setMemoryAudit(Array.isArray(audit.items) ? audit.items : []);
    } catch (error) {
      const message = error instanceof Error ? error.message : '智能体记忆暂时加载失败，请重试。';
      setMemoryLoadError(message);
      throw error;
    } finally {
      if (!silent) setMemoryLoading(false);
    }
  };

  const memoryMutation = async (busyKey: string, url: string, method: string, body?: Record<string, unknown>, successMessage?: string) => {
    setMemoryBusy(busyKey);
    setMemoryNotice('');
    try {
      const response = await fetch(url, {
        method,
        headers: { ...authHeader(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload.message || payload.error || '操作失败'));
      const latency = Number(payload.latencyMs || payload.latency || 0);
      setMemoryNotice(successMessage || (busyKey === 'model-check'
        ? `模型连接正常${latency > 0 ? `，耗时 ${latency} ms` : ''}。`
        : '操作已保存，并写入审计记录。'));
      await loadMemoryGovernance(true);
      return payload;
    } catch (error) {
      setMemoryNotice(error instanceof Error ? error.message : '操作失败');
      return null;
    } finally {
      setMemoryBusy('');
    }
  };

  const addCustomerMemory = (customer: Record<string, unknown>, existingKeys: string[] = []) => {
    const customerId = String(customer.id || '');
    if (!customerId) return;
    const key = memoryKeyOptions.find(([value]) => !existingKeys.includes(value))?.[0];
    if (!key) return;
    setMemoryNotice('');
    setMemoryEditor({ kind: 'customer-add', customerId, customerName: String(customer.name || '该客户'), key, value: key === 'product_preference' ? String(customer.product || '') : '', expiresAt: '', existingKeys });
  };

  const editCustomerMemory = (memory: Record<string, unknown>) => {
    setMemoryNotice('');
    setMemoryEditor({ kind: 'customer-edit', id: String(memory.id), key: String(memory.key || 'other'), value: String(memory.value || ''), expiresAt: String(memory.expiresAt || '').slice(0, 10) });
  };

  const editStyleEvidence = (evidence: Record<string, unknown>) => {
    setMemoryNotice('');
    setMemoryEditor({ kind: 'style-edit', id: String(evidence.id), finalSent: String(evidence.finalSent || '') });
  };

  const editStrategy = (strategy: Record<string, unknown>) => {
    setMemoryNotice('');
    setMemoryEditor({ kind: 'strategy-edit', id: String(strategy.id), adjustment: String(strategy.adjustment || '') });
  };

  const submitMemoryEditor = async (event: FormEvent) => {
    event.preventDefault();
    if (!memoryEditor || memoryBusy || !memoryOverview?.canManage) return;
    let payload: unknown = null;
    if (memoryEditor.kind === 'customer-add' && memoryEditor.value.trim()) {
      if (memoryEditor.existingKeys.includes(memoryEditor.key)) {
        setMemoryNotice('这类客户记忆已经存在，请直接编辑原记录。');
        return;
      }
      payload = await memoryMutation(`customer-add-${memoryEditor.customerId}`, '/api/overseas/agent-memory/customer-memories', 'POST', {
        customerId: memoryEditor.customerId, key: memoryEditor.key, value: memoryEditor.value.trim(), evidence: '管理员根据客户上下文人工确认', sourceKind: 'human', status: 'confirmed', expiresAt: memoryEditor.expiresAt,
      });
    } else if (memoryEditor.kind === 'customer-edit' && memoryEditor.value.trim()) {
      payload = await memoryMutation(`customer-edit-${memoryEditor.id}`, `/api/overseas/agent-memory/customer-memories/${memoryEditor.id}`, 'PATCH', { value: memoryEditor.value.trim(), expiresAt: memoryEditor.expiresAt });
    } else if (memoryEditor.kind === 'style-edit' && memoryEditor.finalSent.trim()) {
      payload = await memoryMutation(`style-edit-${memoryEditor.id}`, `/api/overseas/agent-memory/style-evidence/${memoryEditor.id}`, 'PATCH', { finalSent: memoryEditor.finalSent.trim() });
    } else if (memoryEditor.kind === 'strategy-edit') {
      payload = await memoryMutation(`strategy-edit-${memoryEditor.id}`, `/api/overseas/agent-memory/strategies/${memoryEditor.id}`, 'PATCH', { adjustment: memoryEditor.adjustment.trim() });
    }
    if (payload) setMemoryEditor(null);
  };

  const exportMemoryBackup = async () => {
    setMemoryBusy('backup');
    setMemoryNotice('');
    try {
      const response = await fetch('/api/overseas/agent-memory/backup', { headers: authHeader() });
      if (!response.ok) throw new Error(String((await response.json().catch(() => ({}))).message || '备份导出失败'));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `agent-memory-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMemoryNotice('租户级记忆备份已导出。恢复时服务端会再次校验企业归属。');
    } catch (error) {
      setMemoryNotice(error instanceof Error ? error.message : '备份导出失败');
    } finally {
      setMemoryBusy('');
    }
  };

  const performRestoreMemoryBackup = async (file: File) => {
    setMemoryBusy('restore');
    setMemoryNotice('');
    try {
      const backup = JSON.parse(await file.text()) as Record<string, unknown>;
      const response = await fetch('/api/overseas/agent-memory/backup/restore', {
        method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' }, body: JSON.stringify(backup),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload.message || payload.error || '备份恢复失败'));
      setMemoryNotice(`备份恢复完成，共处理 ${Number(payload.restored || 0)} 条租户隔离记录。`);
      await loadMemoryGovernance(true);
    } catch (error) {
      setMemoryNotice(error instanceof Error ? error.message : '备份文件无效');
    } finally {
      setMemoryBusy('');
    }
  };

  const restoreMemoryBackup = (file: File) => {
    setMemoryConfirm({
      title: '恢复智能体记忆备份',
      description: '只接受当前企业导出的备份。同 ID 数据会更新，其他企业的数据不会被读取。',
      confirmLabel: '确认恢复',
      action: () => performRestoreMemoryBackup(file),
    });
  };

  useEffect(() => {
    void loadMemoryGovernance().catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([
      loadAllExactVideoRecords(), studioApi.listProjects(),
      fetch('/api/overseas/enterprise/profile', { headers: authHeader() }).then(response => response.ok ? response.json() : {}),
      fetch('/api/overseas/customers', { headers: authHeader() }).then(response => response.ok ? response.json() : { items: [] }),
      fetch('/api/overseas/agent-memory/strategies', { headers: authHeader() }).then(response => response.ok ? response.json() : { items: [] }),
    ])
      .then(async ([records, projects, enterprise, customers, strategies]) => {
        if (!active) return;
        const mockCustomerContexts = includeMockCustomers && import.meta.env.DEV
          ? (await import('../mocks/customerProfiles')).createMockCustomers(mockCustomerScope).map(customer => ({
            id: customer.id,
            name: customer.name,
            product: customer.product,
            countryName: customer.countryName,
            language: customer.language,
            stage: customer.stage,
            summary: customer.summary,
            nextStep: customer.nextStep,
            intentSignals: customer.intentSignals,
            tags: [...customer.tags, '模拟场景'],
          }))
          : [];
        if (!active) return;
        const analyses: ContentMemory[] = records.map(record => ({ record, analysis: parseAnalysis(record.aiAnalysis) }))
          .filter(({ analysis }) => analysis.analysisMode === 'exact' && Boolean(analysis.scriptDetails15s?.length))
          .map(({ record, analysis }) => ({
            id: `analysis-${record.id}`, kind: 'analysis', title: record.title || '未命名精确分析',
            source: `灵感大屏 · ${record.platform || '平台未记录'}`,
            updated: analysis.analyzedAt || record.updated || record.crawledAt,
            description: analysis.baseRequirements || analysis.structure || structuralDetailText(analysis.scriptDetails15s?.[0] || {}) || '已完成全篇精确分析，可用于后续爆款裂变。',
            tags: [...(analysis.hooks || []), ...(analysis.sellingPoints || [])].filter(Boolean).slice(0, 4),
            poster: record.thumbnailUrl || analysis.materialPoster,
            evidence: [
              analysis.scriptDetails15s?.length ? `${analysis.scriptDetails15s.length} 个分析分镜` : '',
              analysis.hooks?.length ? `${analysis.hooks.length} 个内容钩子` : '',
              analysis.sellingPoints?.length ? `${analysis.sellingPoints.length} 个卖点` : '',
            ].filter(Boolean),
            usage: '可在脚本库查看完整分析，并作为爆款裂变的参考视频。',
          }));
        const drafts: ContentMemory[] = projects.filter(project => project.status === 'draft').map(project => {
          const media = firstDraftMedia(project);
          return {
            id: `draft-${project.id}`, kind: 'draft', title: project.title || '未命名创作草稿',
            source: `智能素材 · ${modeLabel(project.spec?.mode)}`,
            updated: project.updatedAt || project.createdAt,
            description: String(project.spec?.script || '').trim().slice(0, 240) || `当前进度：${draftProgress(project)}`,
            tags: [draftProgress(project), modeLabel(project.spec?.mode)], poster: media.poster,
            evidence: [String(project.spec?.script || '').trim() ? '已有创作脚本' : '', media.url || media.poster ? '已有创作素材' : ''].filter(Boolean),
            usage: '来自历史创作草稿，仅作为可继续编辑和复用的创作记录。',
          };
        });
        setContentMemories([...analyses, ...drafts].sort((a, b) => Date.parse(b.updated || '') - Date.parse(a.updated || '')));
        const enterpriseRecord = enterprise as { salesStyleProfile?: Record<string, unknown> };
        setStyleProfile(enterpriseRecord.salesStyleProfile || null);
        const customerPayload = customers as { items?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
        const liveCustomerContexts = Array.isArray(customerPayload) ? customerPayload : Array.isArray(customerPayload.items) ? customerPayload.items : [];
        const liveIds = new Set(liveCustomerContexts.map(customer => String(customer.id || '')));
        setCustomerContexts([...liveCustomerContexts, ...mockCustomerContexts.filter(customer => !liveIds.has(customer.id))]);
        const strategyPayload = strategies as { items?: Array<Record<string, unknown>> };
        setResponseStrategies(Array.isArray(strategyPayload.items) ? strategyPayload.items : []);
      })
      .catch(() => active && setContentMemories([]))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [includeMockCustomers, mockCustomerScope]);

  useEffect(() => {
    let active = true;
    void fetch('/api/overseas/agent-memory/content-overview', { headers: authHeader() })
      .then(async response => {
        if (response.ok) return contentOpsOverview(await response.json());
        const [overviewResponse, trendResponse] = await Promise.all([
          fetch('/api/overseas/social-metrics/overview?days=30', { headers: authHeader() }),
          fetch('/api/overseas/social-metrics/trends?metric=views', { headers: authHeader() }),
        ]);
        if (!overviewResponse.ok) return null;
        const overview = await overviewResponse.json();
        const trend = trendResponse.ok ? await trendResponse.json() : null;
        return socialMetricsOpsOverview(overview, trend);
      })
      .then(result => {
        if (!active) return;
        // Synthetic operating metrics belong only to the explicitly opened
        // simulation workspace. Normal tenant pages must stay empty until a
        // real platform snapshot is available, including during development.
        setOpsOverview(includeMockCustomers && import.meta.env.DEV && !hasContentOpsData(result)
          ? MOCK_CONTENT_OPS_OVERVIEW
          : result);
      })
      .catch(() => {
        if (active) setOpsOverview(includeMockCustomers && import.meta.env.DEV ? MOCK_CONTENT_OPS_OVERVIEW : null);
      })
      .finally(() => { if (active) setOpsLoading(false); });
    return () => { active = false; };
  }, [includeMockCustomers]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return contentMemories;
    return contentMemories.filter(item => `${item.title} ${item.source} ${item.description} ${item.tags.join(' ')}`.toLowerCase().includes(keyword));
  }, [contentMemories, query]);

  const customerStageLabels: Record<string, string> = { lead: '新线索', inquiry: '需求确认', quoted: '已报价', won: '已成交', silent30: '沉默 30 天', silent60: '沉默 60 天' };
  const strategySourceLabels: Record<string, string> = { learned_custom: 'AI 学习 · 人工确认', human: '人工设置', system: '系统策略', mock_seed: '演示策略' };
  const customerMemoryStatusLabels: Record<string, string> = { confirmed: '已确认', pending: '待确认', conflict: '有冲突', paused: '已停用', expired: '已过期' };
  const memoryKeyOptions = [
    ['preferred_language', '常用语言'], ['preferred_tone', '沟通语气'], ['communication_preference', '沟通偏好'],
    ['product_preference', '产品偏好'], ['buying_context', '采购背景'], ['schedule_preference', '时间偏好'], ['other', '其他'],
  ];
  const memoryKeyLabels = Object.fromEntries(memoryKeyOptions) as Record<string, string>;
  const confirmMemoryAction = async () => {
    if (!memoryConfirm) return;
    const action = memoryConfirm.action;
    setMemoryConfirm(null);
    await action();
  };
  return (
    <PageShell icon={<BrainCircuit size={14} />} title="智能体记忆" description="查看智能体从真实业务中沉淀的经验，并明确每条记忆的来源、用途与使用边界。">
      <Tabs activeKey={tab} onChange={key => { setTab(key as MemoryTab); setQuery(''); }} items={tabs.map(({ id, label, icon: Icon }) => ({ key: id, label, icon: <Icon size={15} /> }))} />
      {tab !== 'content' && memoryLoadError && memoryOverview && <Alert className="mb-4" type="warning" showIcon title={memoryLoadError} description="当前仍显示上次成功加载的数据。" action={<Button onClick={() => void loadMemoryGovernance().catch(() => undefined)}>重试</Button>} />}
      {tab !== 'content' && memoryLoading ? <section className="rounded-lg border border-border bg-white p-8 text-center" aria-live="polite"><Spin /><p className="mt-3 text-sm text-text-muted">正在加载该企业的记忆记录…</p></section>
        : tab !== 'content' && memoryLoadError && !memoryOverview ? <Alert type="error" showIcon title="记忆记录没有加载成功" description={memoryLoadError} action={<Button onClick={() => void loadMemoryGovernance().catch(() => undefined)}>重新加载</Button>} />
        : tab === 'content' ? <>
        <section className="mb-4 overflow-hidden rounded-lg border border-border bg-white">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4"><div><div className="flex items-center gap-2"><BarChart3 size={17} className="text-emerald-600" /><h2 className="text-base font-semibold text-text-primary">内容运营监控</h2></div><p className="mt-1 text-sm leading-5 text-text-muted">只根据已授权平台实际返回并已同步的指标生成结论；没有时间序列时不推算趋势。</p></div>{opsOverview?.generatedAt && <span className="text-xs font-semibold text-text-muted">更新于 {formatDate(opsOverview.generatedAt)}</span>}</div>
          {opsLoading ? <div className="p-10 text-center text-xs text-text-muted"><Loader2 size={18} className="mx-auto mb-2 animate-spin text-emerald-600" />正在读取运营指标…</div> : opsOverview && (opsOverview.kpis.length || opsOverview.trends.length || opsOverview.conclusions.length || opsOverview.topContents.length) ? <div className="p-5">
            {opsOverview.periodLabel && <p className="mb-3 text-xs font-medium text-text-muted">统计口径：{opsOverview.periodLabel}</p>}
            {opsOverview.kpis.length > 0 && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{opsOverview.kpis.map(kpi => <div key={kpi.id} className="rounded-lg border border-border p-4"><p className="text-xs font-medium text-text-muted">{kpi.label}</p><div className="mt-2 flex items-end justify-between gap-2"><strong className="text-xl text-text-primary">{kpi.value}</strong>{kpi.change && <span className="text-xs font-semibold text-emerald-700">{kpi.change}</span>}</div>{kpi.note && <p className="mt-2 text-xs leading-4 text-text-muted">{kpi.note}</p>}</div>)}</div>}
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <HighConfidenceInsights conclusions={opsOverview.conclusions} />
              <section className="rounded-lg border border-border p-4"><div className="flex items-center gap-2"><Target size={15} className="text-emerald-600" /><h3 className="text-xs font-semibold text-text-primary">下一步创作方向</h3></div>{opsOverview.recommendations.length ? <ol className="mt-3 space-y-3">{opsOverview.recommendations.map((item, index) => <li key={item.id} className="flex gap-3 rounded-lg bg-surface-2 p-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white">{index + 1}</span><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-text-primary">{item.title}</p><p className="mt-1 text-sm leading-5 text-text-secondary">{item.detail}</p><div className="mt-2 flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-medium text-text-muted">依据 {item.evidenceCount} 条已同步记录</p><Button onClick={() => setExecutionIntent({ kind: 'recommendation', id: item.id, title: item.title, detail: item.detail, evidenceCount: item.evidenceCount })} type="primary">生成创作方案</Button></div></div></li>)}</ol> : <p className="mt-4 text-sm leading-5 text-text-muted">暂不生成创作建议。数据量或置信度不足时，保持空白比给出未经验证的方向更可靠。</p>}</section>
            </div>
            {(opsOverview.trends.length > 0 || opsOverview.topContents.length > 0) && <div className="mt-4 grid gap-4 xl:grid-cols-2">
              {opsOverview.trends.length > 0 && <PlatformTrends trends={opsOverview.trends} />}
              {opsOverview.topContents.length > 0 && <section className="rounded-lg border border-border p-4"><h3 className="text-xs font-semibold text-text-primary">内容表现排行</h3><div className="mt-3 divide-y divide-border">{opsOverview.topContents.slice(0, 5).map((item, index) => <div key={item.id} className="flex items-center gap-3 py-3"><span className="w-5 text-center text-xs font-semibold text-emerald-700">{index + 1}</span>{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" className="h-10 w-16 rounded-lg bg-surface-2 object-cover" /> : <div className="h-10 w-16 rounded-lg bg-surface-2" />}<div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-text-primary">{item.title}</p><p className="mt-1 text-xs text-text-muted">{item.platform}</p></div><div className="shrink-0 text-right"><p className="text-xs font-semibold text-text-primary">{item.metricValue}</p><p className="text-xs text-text-muted">{item.metricLabel}</p><Button onClick={() => setExecutionIntent({ kind: 'top-content', id: item.id, title: item.title, detail: `${item.platform} · ${item.metricLabel} ${item.metricValue}`, platform: item.platform.toLowerCase(), sourceMetric: item.metricLabel })} type="link" size="small" className="mt-1">爆款裂变</Button></div></div>)}</div></section>}
            </div>}
          </div> : <div className="p-6"><div className="flex gap-3 rounded-lg bg-amber-50 p-4"><CircleAlert size={18} className="mt-0.5 shrink-0 text-amber-600" /><div><h3 className="text-xs font-semibold text-amber-900">尚无可用于趋势分析的平台时序数据</h3><p className="mt-1 text-sm leading-5 text-amber-800">完成账号 OAuth 授权后，还需要定时同步至少两个时间点，才能计算真实涨跌。当前页面不会把灵感大屏的公开爆款数据当作企业账号经营结果。</p></div></div>{opsOverview?.coverage.length ? <div className="mt-3 flex flex-wrap gap-2">{opsOverview.coverage.map(item => <span key={item.platform} title={item.note} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.status === 'ready' ? 'bg-emerald-50 text-emerald-700' : item.status === 'unavailable' ? 'bg-rose-50 text-rose-700' : 'bg-surface-2 text-text-muted'}`}>{item.platform} · {item.status === 'ready' ? '数据已就绪' : item.status === 'unavailable' ? '平台不提供' : '等待同步'}</span>)}</div> : null}</div>}
        </section>
        {opsOverview?.learningEvents?.length ? <section className="mb-4 rounded-lg border border-border bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-2"><Clock3 size={16} className="text-emerald-600" /><div><h2 className="text-base font-semibold text-text-primary">最近学习</h2><p className="mt-1 text-sm leading-5 text-text-muted">查看 Agent 最近形成、验证或调整的内容运营经验。</p></div></div><span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-text-muted">{opsOverview.learningEvents.length} 条记录</span></div>
          <div className="relative mt-5 space-y-0 before:absolute before:bottom-3 before:left-[7px] before:top-3 before:w-px before:bg-emerald-100">{opsOverview.learningEvents.slice(0, 6).map(event => { const statusMeta = event.status === 'confirmed' ? ['已确认', 'bg-emerald-50 text-emerald-700'] : event.status === 'adjusted' ? ['已调整', 'bg-blue-50 text-blue-700'] : event.status === 'observing' ? ['观察中', 'bg-amber-50 text-amber-700'] : ['新学习', 'bg-violet-50 text-violet-700']; return <article key={event.id} className="relative flex gap-4 pb-5 last:pb-0"><span className="relative z-10 mt-1.5 h-[15px] w-[15px] shrink-0 rounded-full border-4 border-white bg-emerald-500" /><div className="min-w-0 flex-1 rounded-lg border border-border p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-semibold text-text-primary">{event.title}</p><p className="mt-1 text-xs font-semibold text-text-muted">{formatDate(event.occurredAt)}{event.source ? ` · ${event.source}` : ''}</p></div><span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusMeta[1]}`}>{statusMeta[0]}</span></div><p className="mt-2 text-sm leading-5 text-text-secondary">{event.detail}</p>{typeof event.evidenceCount === 'number' && <p className="mt-2 text-xs font-medium text-text-muted">依据 {event.evidenceCount} 条已同步记录</p>}</div></article>; })}</div>
        </section> : null}
      </> : tab === 'style' ? <>
        <section className="mb-4 rounded-lg border border-border bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><ShieldCheck size={17} className="text-emerald-600" /><h2 className="text-base font-semibold text-text-primary">沟通风格治理</h2></div><p className="mt-1 text-sm leading-5 text-text-muted">员工修改先进入证据池；管理员确认后才参与画像或候选策略。历史业务事实永远不能从风格样本中复用。</p></div>{memoryOverview?.canManage && <div className="flex max-w-full flex-wrap gap-2"><Button disabled={Boolean(memoryBusy)} onClick={() => void memoryMutation('model-check', '/api/overseas/agent-memory/model-check', 'POST')} className="shrink-0">{memoryBusy === 'model-check' ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}模型连通检查</Button><Button disabled={Boolean(memoryBusy)} onClick={() => void memoryMutation('relearn', '/api/overseas/agent-memory/style/relearn', 'POST')} type="primary" className="shrink-0">{memoryBusy === 'relearn' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}重新学习</Button><Button disabled={Boolean(memoryBusy)} onClick={() => void exportMemoryBackup()} className="shrink-0"><Download size={13} />导出备份</Button><AntUpload accept="application/json,.json" showUploadList={false} disabled={Boolean(memoryBusy)} beforeUpload={file => { restoreMemoryBackup(file); return false; }}><Button disabled={Boolean(memoryBusy)} icon={<Upload size={14} />}>恢复备份</Button></AntUpload></div>}</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className="rounded-lg bg-surface-2 p-3"><p className="text-xs font-medium text-text-muted">待确认证据</p><strong className="mt-1 block text-lg text-text-primary">{Number(memoryOverview?.readiness?.pending || 0)}</strong></div><div className="rounded-lg bg-surface-2 p-3"><p className="text-xs font-medium text-text-muted">已确认人工修改</p><strong className="mt-1 block text-lg text-text-primary">{Number(memoryOverview?.readiness?.editedConfirmed || 0)}</strong></div><div className="rounded-lg bg-surface-2 p-3"><p className="text-xs font-medium text-text-muted">覆盖客户</p><strong className="mt-1 block text-lg text-text-primary">已覆盖 {Number(memoryOverview?.readiness?.customerCount || 0)} 位客户</strong><p className="mt-1 text-xs text-text-muted">启用候选策略至少需要 3 位</p></div><div className={`rounded-lg p-3 ${memoryOverview?.model?.configured ? 'bg-emerald-50' : 'bg-amber-50'}`}><p className="text-xs font-medium text-text-muted">生产学习模型</p><strong className={`mt-1 block text-xs ${memoryOverview?.model?.configured ? 'text-emerald-700' : 'text-amber-800'}`}>{memoryOverview?.model?.configured ? `${String(memoryOverview.model.backend)} · ${String(memoryOverview.model.styleModel)}` : '密钥未配置，禁止触发学习'}</strong></div></div>
          {memoryNotice && <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs font-semibold text-text-secondary">{memoryNotice}</p>}
        </section>
        {styleProfile && ['greeting_style', 'quoting_stance', 'followup_rhythm', 'taboo_phrases'].some(key => Boolean(styleProfile[key])) && <><section className="mb-4 rounded-lg border border-border bg-white p-5"><h2 className="text-base font-semibold text-text-primary">当前只读风格画像</h2><p className="mt-1 text-xs text-text-muted">已确认样本聚合后的表达偏好；不作为价格、MOQ、认证、交期或其他企业事实来源。</p></section><div className="mb-4 grid gap-4 md:grid-cols-2">{([['greeting_style', '称呼与开场'], ['quoting_stance', '报价表达'], ['followup_rhythm', '跟进节奏'], ['taboo_phrases', '避免使用的措辞']] as const).map(([key, label]) => { const memory = styleProfile[key] as { value?: string | string[]; evidence?: string; manual?: boolean } | undefined; if (!memory) return null; return <section key={key} className="rounded-lg border border-border bg-white p-5"><div className="flex items-center justify-between gap-2"><h3 className="text-base font-semibold text-text-primary">{label}</h3><span className={`rounded-full px-2 py-1 text-xs font-semibold ${memory.manual ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}`}>{memory.manual ? '人工设置' : '自动提炼'}</span></div><p className="mt-3 text-sm leading-6 text-text-secondary">{Array.isArray(memory.value) ? memory.value.join('、') : memory.value || '尚未形成稳定画像'}</p><p className="mt-3 rounded-lg bg-surface-2 p-3 text-sm leading-5 text-text-muted"><b>聚合佐证：</b>{memory.evidence || '未提供'}</p></section>; })}</div></>}
        <section className="rounded-lg border border-border bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold text-text-primary">原始干预证据</h2><p className="mt-1 text-sm leading-5 text-text-muted">保留 AI 草稿、员工最终回复、客户/节点、结果窗口与来源；展示内容已经脱敏。</p></div><span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-text-muted">{styleEvidence.length} 条</span></div>{styleEvidence.length ? <div className="mt-4 space-y-3">{styleEvidence.slice(0, 80).map(evidence => { const status = String(evidence.status || 'pending'); const busy = memoryBusy.endsWith(String(evidence.id)); return <article key={String(evidence.id)} className="rounded-lg border border-border p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${status === 'confirmed' ? 'bg-emerald-50 text-emerald-700' : status === 'paused' ? 'bg-amber-50 text-amber-700' : 'bg-violet-50 text-violet-700'}`}>{status === 'confirmed' ? '已确认' : status === 'paused' ? '已停用' : '待确认'}</span>{Boolean(evidence.nodeId) && <span className="text-xs font-medium text-text-muted">节点 {String(evidence.nodeId)}</span>}{Boolean(evidence.customerId) && <span className="text-xs font-medium text-text-muted">客户 {String(evidence.customerId).slice(0, 10)}</span>}</div><p className="mt-2 text-sm leading-5 text-text-secondary"><b>客户触发：</b>{String(evidence.triggerMessage || '未记录')}</p></div><span className="text-xs text-text-muted">{formatDate(String(evidence.created || ''))}</span></div><div className="mt-3 grid gap-3 lg:grid-cols-2"><div className="rounded-lg bg-rose-50/60 p-3"><p className="text-xs font-semibold text-rose-700">AI 原始草稿</p><p className="mt-1 text-sm leading-5 text-text-secondary">{String(evidence.draftOriginal || '未记录')}</p></div><div className="rounded-lg bg-emerald-50/60 p-3"><p className="text-xs font-semibold text-emerald-700">员工最终发送</p><p className="mt-1 text-sm leading-5 text-text-secondary">{String(evidence.finalSent || '未记录')}</p></div></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="text-xs leading-4 text-text-muted">来源：{String(evidence.evidenceSource || '历史员工回复')} · 删除仅影响学习证据，不删除原始会话</p>{memoryOverview?.canManage && <div className="flex flex-wrap gap-1.5"><Button disabled={busy} onClick={() => void editStyleEvidence(evidence)} size="small"><Pencil size={11} className="mr-1 inline" />编辑</Button>{status !== 'confirmed' && <Button disabled={busy} onClick={() => void memoryMutation(`style-confirm-${evidence.id}`, `/api/overseas/agent-memory/style-evidence/${evidence.id}`, 'PATCH', { status: 'confirmed' })} type="primary" size="small"><CheckCircle2 size={11} className="mr-1 inline" />确认</Button>}{status !== 'paused' && <Button disabled={busy} onClick={() => setMemoryConfirm({ title: '停用这条学习证据？', description: '停用后它不会继续影响风格学习，原始会话仍会保留。', confirmLabel: '确认停用', action: () => memoryMutation(`style-pause-${evidence.id}`, `/api/overseas/agent-memory/style-evidence/${evidence.id}`, 'PATCH', { status: 'paused' }) })} size="small"><PauseCircle size={11} className="mr-1 inline" />停用</Button>}<Button disabled={busy} onClick={() => setMemoryConfirm({ title: '删除这条学习证据？', description: '只删除学习证据，不会删除原始会话。', confirmLabel: '删除证据', danger: true, action: () => memoryMutation(`style-delete-${evidence.id}`, `/api/overseas/agent-memory/style-evidence/${evidence.id}`, 'DELETE') })} danger size="small"><Trash2 size={11} className="mr-1 inline" />删除证据</Button></div>}</div></article>; })}</div> : <p className="mt-5 text-xs text-text-muted">尚无原始证据。新的 AI 草稿与员工最终回复会先以“待确认”状态进入这里。</p>}</section>
      </> : tab === 'customer' ? <>
        <section className="mb-4 rounded-lg border border-border bg-white p-5"><h2 className="text-base font-semibold text-text-primary">已记录的客户上下文</h2><p className="mt-1 text-sm leading-5 text-text-muted">这仍是客户资料与会话上下文，不宣传为成熟的自动客户记忆；邮箱、电话和 WhatsApp 号码不会展示。管理员可将稳定偏好另行确认为客户私有记忆。</p></section>
        {memoryNotice && <p className="mb-4 rounded-lg bg-surface-2 px-3 py-2 text-xs font-semibold text-text-secondary" role="status">{memoryNotice}</p>}
        {customerContexts.length ? <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{customerContexts.map(customer => { const name = String(customer.name || '未命名客户'); const signals = Array.isArray(customer.intentSignals) ? customer.intentSignals.map(String) : []; const tags = Array.isArray(customer.tags) ? customer.tags.map(String) : []; const existingMemoryKeys = customerMemories.filter(memory => String(memory.customerId || '') === String(customer.id || '')).map(memory => String(memory.key || '')).filter(Boolean); const privateMemoryCount = existingMemoryKeys.length; const canAddMemoryType = memoryKeyOptions.some(([key]) => !existingMemoryKeys.includes(key)); return <section key={String(customer.id || name)} className="rounded-lg border border-border bg-white p-5"><div className="flex items-start justify-between gap-2"><h3 className="text-base font-semibold text-text-primary">{name}</h3>{Boolean(customer.stage) && <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">{customerStageLabels[String(customer.stage)] || String(customer.stage)}</span>}</div><div className="mt-3 space-y-2 text-xs text-text-secondary">{Boolean(customer.product) && <p><b>关注产品：</b>{String(customer.product)}</p>}{Boolean(customer.countryName) && <p><b>市场：</b>{String(customer.countryName)}</p>}{Boolean(customer.language) && <p><b>语言：</b>{String(customer.language)}</p>}{Boolean(customer.summary) && <p className="line-clamp-3 leading-5"><b>客户摘要：</b>{String(customer.summary)}</p>}{Boolean(customer.nextStep) && <p className="line-clamp-2 leading-5"><b>下一步：</b>{String(customer.nextStep)}</p>}</div>{[...signals, ...tags].length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{[...signals, ...tags].slice(0, 5).map(value => <span key={value} className="rounded-md bg-surface-2 px-2 py-1 text-xs font-medium text-text-muted">{value}</span>)}</div>}{memoryOverview?.canManage && <div className="mt-4 space-y-2">{privateMemoryCount > 0 && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-center text-xs font-semibold text-emerald-700">已记录 {privateMemoryCount} 类私有记忆，可在下方编辑</p>}{canAddMemoryType && <Button disabled={Boolean(memoryBusy)} onClick={() => addCustomerMemory(customer, existingMemoryKeys)} className="w-full"><Plus size={12} />{privateMemoryCount > 0 ? '添加另一类记忆' : '确认为客户私有记忆'}</Button>}</div>}</section>; })}</div> : <p className="mb-4 rounded-lg bg-surface-2 p-4 text-xs text-text-muted">尚无客户上下文。</p>}
        <section className="rounded-lg border border-border bg-white p-5">
          <div className="flex items-center justify-between gap-2"><div><h2 className="text-base font-semibold text-text-primary">客户私有记忆治理</h2><p className="mt-1 text-sm leading-5 text-text-muted">仅在同一企业、同一客户的后续回复中使用；人工确认且较新的记录优先，过期记录自动退出检索。</p></div><span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-text-muted">{customerMemories.length} 条</span></div>
          {customerMemories.length ? <div className="mt-4 grid gap-3 md:grid-cols-2">{customerMemories.map(memory => {
            const status = String(memory.status || 'pending');
            const busy = Boolean(memoryBusy);
            return <article key={String(memory.id)} className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-2"><div><p className="text-xs font-semibold text-emerald-700">{String(memory.keyLabel || memoryKeyLabels[String(memory.key || '')] || '客户偏好')}</p><h3 className="mt-1 text-sm font-semibold text-text-primary">{String(memory.value || '')}</h3></div><span className={`rounded-full px-2 py-1 text-xs font-semibold ${status === 'confirmed' ? 'bg-emerald-50 text-emerald-700' : status === 'conflict' ? 'bg-rose-50 text-rose-700' : status === 'paused' ? 'bg-amber-50 text-amber-700' : 'bg-surface-2 text-text-muted'}`}>{customerMemoryStatusLabels[status] || '待确认'}</span></div>
              <p className="mt-2 text-xs leading-4 text-text-muted">客户 {String(memory.customerId || '').slice(0, 12)} · {memory.sourceKind === 'ai_inferred' ? 'AI 推断' : '人工记录'}{memory.expiresAt ? ` · 过期 ${formatDate(String(memory.expiresAt))}` : ''}</p>
              {Boolean(memory.evidence) && <p className="mt-2 rounded-lg bg-surface-2 p-2 text-sm leading-5 text-text-secondary"><b>证据：</b>{String(memory.evidence)}</p>}
              {memoryOverview?.canManage && <div className="mt-3 flex flex-wrap gap-1.5"><Button disabled={busy} onClick={() => editCustomerMemory(memory)} size="small"><Pencil size={11} className="mr-1 inline" />编辑</Button>{status !== 'confirmed' && <Button disabled={busy} onClick={() => void memoryMutation(`customer-confirm-${memory.id}`, `/api/overseas/agent-memory/customer-memories/${memory.id}`, 'PATCH', { status: 'confirmed' })} type="primary" size="small">确认</Button>}{status !== 'paused' && <Button disabled={busy} onClick={() => setMemoryConfirm({ title: '停用这条客户记忆？', description: '停用后 AI 不再引用它，原始聊天不会被删除。', confirmLabel: '确认停用', action: () => memoryMutation(`customer-pause-${memory.id}`, `/api/overseas/agent-memory/customer-memories/${memory.id}`, 'PATCH', { status: 'paused' }) })} size="small">停用</Button>}<Button disabled={busy} onClick={() => setMemoryConfirm({ title: '删除这条客户记忆？', description: '删除后 AI 不再引用它，原始聊天不会被删除。', confirmLabel: '删除记忆', danger: true, action: () => memoryMutation(`customer-delete-${memory.id}`, `/api/overseas/agent-memory/customer-memories/${memory.id}`, 'DELETE') })} danger size="small">删除</Button></div>}
            </article>;
          })}</div> : <p className="mt-5 text-xs text-text-muted">尚无独立客户私有记忆。客户上下文字段不会自动变成长期记忆。</p>}
        </section>
      </> : tab === 'strategy' ? <>
        <section className="mb-4 rounded-lg border border-border bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-text-primary">响应策略观察与治理</h2><p className="mt-1 text-sm leading-5 text-text-muted">候选策略至少需要 5 条证据、3 个客户和 2 个时间段；新启用从 10% 开始，当前比例以策略卡片为准。证据关联不等于成功率或因果贡献。</p></div><span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">成功率暂不展示</span></div>{memoryNotice && <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs font-semibold text-text-secondary">{memoryNotice}</p>}</section>
        {responseStrategies.length ? <div className="grid gap-4 md:grid-cols-2">{responseStrategies.map((strategy, index) => {
          const steps = Array.isArray(strategy.strategySteps) ? strategy.strategySteps.map(String) : [];
          const signals = Array.isArray(strategy.signals) ? strategy.signals.map(String) : [];
          const evidence = Array.isArray(strategy.evidence) ? strategy.evidence as Array<Record<string, unknown>> : [];
          const status = String(strategy.status || 'candidate');
          const busy = Boolean(memoryBusy);
          const rolloutPercent = Number(strategy.rolloutPercent ?? 10);
          return <section key={String(strategy.id || strategy.strategyId || index)} className="rounded-lg border border-border bg-white p-5">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-emerald-700">{strategySourceLabels[String(strategy.source || '')] || '策略记忆'} · v{Number(strategy.version || 1)}</p><h3 className="mt-1 text-sm font-semibold text-text-primary">{String(strategy.scenario || strategy.intent || strategy.strategyId || '未命名响应策略')}</h3></div><span className={`rounded-full px-2 py-1 text-xs font-semibold ${status === 'active' ? 'bg-emerald-50 text-emerald-700' : status === 'paused' ? 'bg-amber-50 text-amber-700' : 'bg-violet-50 text-violet-700'}`}>{status === 'active' ? `已启用 ${rolloutPercent}%` : status === 'paused' ? '已暂停' : '候选策略'}</span></div>
            {Boolean(strategy.adjustment) && <p className="mt-3 text-sm leading-6 text-text-secondary">{String(strategy.adjustment)}</p>}
            {signals.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{signals.slice(0, 5).map(signal => <span key={signal} className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">{signal}</span>)}</div>}
            {steps.length > 0 && <div className="mt-4 rounded-lg bg-surface-2 p-3"><p className="text-xs font-semibold text-text-muted">唯一推进目标下的建议动作</p><ol className="mt-2 space-y-1.5">{steps.map((step, stepIndex) => <li key={`${step}-${stepIndex}`} className="flex gap-2 text-sm leading-5 text-text-secondary"><span className="font-semibold text-emerald-600">{stepIndex + 1}.</span>{step}</li>)}</ol></div>}
            {Boolean(strategy.riskBoundary || strategy.escalate) && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm leading-5 text-amber-800"><b>风险边界：</b>{String(strategy.riskBoundary || strategy.escalate)}</p>}
            <details className="mt-3 rounded-lg border border-border px-3 py-2"><summary className="cursor-pointer text-xs font-semibold text-text-secondary">查看证据样本（展示 {evidence.length} 条 · 共关联 {Number(strategy.evidenceCount || 0)} 条 · 覆盖 {Number(strategy.evidenceCustomerCount || 0)} 位客户）</summary><div className="mt-3 space-y-2">{evidence.length ? evidence.map(item => <div key={String(item.id)} className="rounded-lg bg-surface-2 p-3 text-sm leading-5 text-text-secondary"><p><b>客户：</b>{String(item.buyer || '')}</p><p className="mt-1"><b>AI：</b>{String(item.aiDraft || '')}</p><p className="mt-1"><b>员工：</b>{String(item.humanFinal || '')}</p></div>) : <p className="text-xs text-text-muted">暂无可展示的脱敏证据。</p>}</div></details>
            {memoryOverview?.canManage && <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border pt-3"><Button disabled={busy} onClick={() => editStrategy(strategy)} size="small"><Pencil size={11} className="mr-1 inline" />编辑</Button>{status !== 'active' && <Button disabled={busy} onClick={() => void memoryMutation(`strategy-active-${strategy.id}`, `/api/overseas/agent-memory/strategies/${strategy.id}`, 'PATCH', { status: 'active', rolloutPercent: 10 })} type="primary" size="small"><Play size={11} className="mr-1 inline" />10% 启用</Button>}{status === 'active' && <Button disabled={busy} onClick={() => setMemoryConfirm({ title: '暂停这条响应策略？', description: '暂停后新回复不再分流到该策略，历史证据和审计记录会保留。', confirmLabel: '确认暂停', action: () => memoryMutation(`strategy-pause-${strategy.id}`, `/api/overseas/agent-memory/strategies/${strategy.id}`, 'PATCH', { status: 'paused' }) })} size="small"><PauseCircle size={11} className="mr-1 inline" />暂停</Button>}<Button disabled={busy} onClick={() => setMemoryConfirm({ title: '回滚这条响应策略？', description: '系统会恢复上一版本，并保留本次操作的审计记录。', confirmLabel: '确认回滚', action: () => memoryMutation(`strategy-rollback-${strategy.id}`, `/api/overseas/agent-memory/strategies/${strategy.id}/rollback`, 'POST') })} size="small"><RotateCcw size={11} className="mr-1 inline" />回滚</Button><Button disabled={busy} onClick={() => setMemoryConfirm({ title: '删除这条响应策略？', description: '策略会被删除，关联证据和原始会话仍会保留。', confirmLabel: '删除策略', danger: true, action: () => memoryMutation(`strategy-delete-${strategy.id}`, `/api/overseas/agent-memory/strategies/${strategy.id}`, 'DELETE') })} danger size="small"><Trash2 size={11} className="mr-1 inline" />删除策略</Button></div>}
          </section>;
        })}</div> : <p className="rounded-lg bg-surface-2 p-4 text-xs text-text-muted">尚无响应策略记忆。确认足够证据并主动触发重新学习后，候选策略会出现在这里。</p>}
        <section className="mt-4 rounded-lg border border-border bg-white p-5"><div className="flex items-center gap-2"><History size={16} className="text-emerald-600" /><div><h2 className="text-base font-semibold text-text-primary">最近使用与治理审计</h2><p className="mt-1 text-xs text-text-muted">记录哪条记忆、策略在何时影响了哪次回复，以及谁执行了确认、停用、删除或回滚。</p></div></div>{memoryAudit.length ? <div className="mt-4 divide-y divide-border">{memoryAudit.slice(0, 20).map(item => <div key={String(item.id)} className="flex flex-wrap items-start justify-between gap-2 py-3"><div><p className="text-xs font-semibold text-text-primary">{String(item.action || '审计事件')}</p><p className="mt-1 text-xs text-text-muted">{item.customerId ? `客户 ${String(item.customerId).slice(0, 12)} · ` : ''}{item.nodeId ? `节点 ${String(item.nodeId)} · ` : ''}记忆 {Array.isArray(item.memoryIds) ? item.memoryIds.length : 0} 条 · 策略 {Array.isArray(item.strategyIds) ? item.strategyIds.length : 0} 条</p></div><span className="text-xs text-text-muted">{formatDate(String(item.createdAt || ''))}</span></div>)}</div> : <p className="mt-4 text-xs text-text-muted">尚无审计记录。</p>}</section>
      </> : null}
      <Modal open={Boolean(memoryEditor)} destroyOnHidden width={560}
        title={memoryEditor?.kind === 'customer-add' ? `记录 ${memoryEditor.customerName} 的偏好` : memoryEditor?.kind === 'customer-edit' ? '编辑客户私有记忆' : memoryEditor?.kind === 'style-edit' ? '编辑员工最终回复' : '编辑响应策略'}
        onCancel={() => { if (!memoryBusy) setMemoryEditor(null); }} keyboard={!memoryBusy} closable={!memoryBusy} mask={{ closable: !memoryBusy }}
        footer={<><Button disabled={Boolean(memoryBusy)} onClick={() => setMemoryEditor(null)}>取消</Button><Button type="primary" htmlType="submit" form="agent-memory-editor-form" loading={Boolean(memoryBusy)}>保存</Button></>}>
        {memoryEditor && <form id="agent-memory-editor-form" onSubmit={submitMemoryEditor} className="space-y-4">
          <p className="text-sm leading-6 text-text-muted">{memoryEditor.kind === 'strategy-edit' ? '只记录对话方法，不在这里填写价格、MOQ、证书等企业事实。' : '内容会在服务端再次脱敏，并保留审计记录。'}</p>
          {memoryEditor.kind === 'customer-add' && <label className="block text-sm text-text-secondary">记忆类型<Select aria-label="记忆类型" className="mt-2 w-full" value={memoryEditor.key}
            onChange={key => setMemoryEditor({ ...memoryEditor, key })} disabled={Boolean(memoryBusy)}
            options={memoryKeyOptions.filter(([value]) => !memoryEditor.existingKeys.includes(value)).map(([value, label]) => ({ value, label }))} /></label>}
          {(memoryEditor.kind === 'customer-add' || memoryEditor.kind === 'customer-edit') && <>
            <label className="block text-sm text-text-secondary">记忆内容<Input.TextArea className="mt-2" required rows={4} value={memoryEditor.value} onChange={event => setMemoryEditor({ ...memoryEditor, value: event.target.value })} placeholder="只写这位客户稳定的偏好或采购背景" disabled={Boolean(memoryBusy)} /></label>
            <label className="block text-sm text-text-secondary">有效期（可选）<Input type="date" className="mt-2" value={memoryEditor.expiresAt} onChange={event => setMemoryEditor({ ...memoryEditor, expiresAt: event.target.value })} disabled={Boolean(memoryBusy)} /></label>
          </>}
          {memoryEditor.kind === 'style-edit' && <label className="block text-sm text-text-secondary">员工最终发送内容<Input.TextArea className="mt-2" required rows={5} value={memoryEditor.finalSent} onChange={event => setMemoryEditor({ ...memoryEditor, finalSent: event.target.value })} disabled={Boolean(memoryBusy)} /></label>}
          {memoryEditor.kind === 'strategy-edit' && <label className="block text-sm text-text-secondary">策略调整说明<Input.TextArea className="mt-2" rows={5} value={memoryEditor.adjustment} onChange={event => setMemoryEditor({ ...memoryEditor, adjustment: event.target.value })} disabled={Boolean(memoryBusy)} /></label>}
          {memoryNotice && <Alert type="error" showIcon title={memoryNotice} />}
        </form>}
      </Modal>
      <Modal open={Boolean(memoryConfirm)} title={memoryConfirm?.title} width={440}
        onCancel={() => setMemoryConfirm(null)} onOk={() => void confirmMemoryAction()} okText={memoryConfirm?.confirmLabel} cancelText="取消" okButtonProps={{ danger: memoryConfirm?.danger }}>
        <p className="text-sm leading-6 text-text-secondary">{memoryConfirm?.description}</p>
      </Modal>
      <ContentOpsExecutionDialog intent={executionIntent} onClose={() => setExecutionIntent(null)} />
    </PageShell>
  );
}

export { OrganizationPermissionsPage } from './OrganizationPermissionsPage';
