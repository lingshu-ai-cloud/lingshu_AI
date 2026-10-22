import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BarChart2, Check, ChevronRight, FileText, Film, Flame, Images, Lightbulb, Loader2, ScanFace, Sparkles, TrendingUp, X, Zap } from 'lucide-react';
import { studioApi, type Material } from '../../lib/studioApi';
import { authHeader } from '../../lib/auth';
import { SocialPlatformIcon } from '../SocialPlatformIcon';
import { getPlatformMeta } from './inspirationVideoProjection';
import { matchMaterialsToFrames, shortenText } from './inspirationFrameMatching';
import { cleanAnalysisText, exactAnalysisQuality, getAnalysis, imageAnalysisShell, needsVideoEnhancement, pipelineState, referenceHighlights } from './inspirationAnalysisProjection';
import type { AccountSpecialRecommendation, FrameMaterialMatch, ScriptAnalysis, ScriptDetail15s, TrendVideo } from '../../lib/inspirationTypes';

const AI_FEASIBILITY_LABELS: Record<FrameMaterialMatch['replicability']['aiFeasibility'], string> = {
  high: '高', medium: '中', low: '低',
};
function frameScoreGrade(score: number): '优' | '良' | '弱' {
  return score >= 75 ? '优' : score >= 50 ? '良' : '弱';
}


function conciseLines(text: string, maxLines = 6, maxChars = 34): string[] {
  const clean = String(text || '').replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const parts = clean.split(/\s*(?:。|；|;|，(?=\S{8,})|\. (?=[A-Z0-9]))\s*/).map(s => s.trim()).filter(Boolean);
  const lines: string[] = [];
  for (const part of parts.length ? parts : [clean]) {
    let rest = part;
    while (rest.length > maxChars && lines.length < maxLines) {
      lines.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars).trim();
    }
    if (rest && lines.length < maxLines) lines.push(rest);
    if (lines.length >= maxLines) break;
  }
  return lines.slice(0, maxLines);
}


type ImageInsightTab = 'overview' | 'visual' | 'copy' | 'iterate';

function ImageBreakdownContent({ video, activeTab }: { video: TrendVideo; analysis: ScriptAnalysis; activeTab: ImageInsightTab }) {
  const evidence = video.aiAnalysis?.imageEvidence;
  const metrics = video.aiAnalysis?.publicMetrics;
  const baseline = video.aiAnalysis?.publicBaseline;
  const adSignals = video.aiAnalysis?.publicAdSignals;
  const rawCaption = cleanAnalysisText(video.aiAnalysis?.caption || video.title);
  const isAnalyzed = Boolean(evidence?.status === 'analyzed' && evidence.observedFacts.length);
  const roleLabel: Record<string, string> = { attention: '首图停留', product: '产品展示', detail: '细节说明', proof: '信任证明', process: '流程解释', cta: '行动引导', unknown: '未确定' };

  const EmptyEvidence = ({ title, desc }: { title: string; desc: string }) => (
    <div className="rounded-lg border border-dashed border-border bg-surface-2 px-5 py-8 text-center">
      <Images size={22} className="mx-auto text-text-muted" />
      <p className="mt-3 text-xs font-semibold text-text-primary">{title}</p>
      <p className="mx-auto mt-1.5 max-w-[280px] text-[10px] leading-relaxed text-text-muted">{desc}</p>
    </div>
  );

  const EvidenceCard = ({ label, value }: { label: string; value: string }) => (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-2"><p className="text-[10px] font-semibold text-text-primary">{label}</p><span className="rounded-full bg-surface-2 px-2 py-0.5 text-[9px] text-text-muted">来自 AI 原始结果</span></div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-text-secondary">{value}</p>
    </div>
  );

  if (activeTab === 'overview') return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-surface p-3.5">
        <div className="flex items-center justify-between"><div><p className="text-xs font-semibold text-text-primary">公开表现</p><p className="mt-1 text-[9px] text-text-muted">无公开值就留空，不把播放当曝光、不估算收藏与点击</p></div>{baseline?.status === 'usable' && baseline.relativeMultiple != null && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">账号基线 {baseline.relativeMultiple}×</span>}</div>
        <div className="mt-3 grid grid-cols-4 gap-1.5">{[['点赞', metrics?.likes || '—'], ['评论', metrics?.comments || '—'], ['分享', metrics?.shares || '—'], ['播放', metrics?.plays || '—']].map(([label, value]) => <div key={label} className="rounded-lg bg-surface-2 px-1.5 py-2 text-center"><p className="text-sm font-semibold text-text-primary">{value}</p><p className="text-[9px] text-text-muted">{label}</p></div>)}</div>
        <div className="mt-2 rounded-lg bg-surface-2 p-2 text-[9px] leading-relaxed text-text-secondary">
          <p>账号：{video.aiAnalysis?.author || video.aiAnalysis?.sourceAccountName || '未抓取'} · 粉丝：{metrics?.followers ? metrics.followers.toLocaleString() : '未公开/未抓取'}</p>
          <p className="mt-1">投流信号：{adSignals?.isAd || adSignals?.isPaidPartnership ? '平台公开标记为广告/付费合作' : '未抓到公开标记（不代表未投流）'}</p>
        </div>
        <p className="mt-2 text-[9px] leading-relaxed text-text-muted">{baseline?.status === 'usable' ? `${baseline.sampleSize} 条同账号样本；${baseline.method}` : `同账号样本 ${baseline?.sampleSize || 0} 条，暂不足以确认相对爆款。`}</p>
      </section>
      {!isAnalyzed ? <EmptyEvidence title="图片证据尚未提取" desc={video.aiAnalysis?.imageAnalysisError || '重新分析后，系统会逐图提取可见事实、OCR、轮播角色和可复用模块。'}/> : <section><div className="mb-2 flex items-center justify-between"><p className="text-[11px] font-semibold text-text-primary">可复用模块</p><span className="text-[9px] text-text-muted">{evidence!.observedFacts.length} 张图片 · 仅基于可见证据</span></div><div className="space-y-2">{evidence!.reusableModules.map((item, index) => <div key={`${item.module}-${index}`} className="rounded-lg border border-border bg-white p-3"><div className="flex items-center justify-between"><p className="text-[11px] font-semibold text-text-primary">{item.module}</p><span className="text-[9px] text-text-muted">置信度 {Math.round(item.confidence * 100)}%</span></div><p className="mt-1 text-[10px] text-text-secondary">证据：{item.evidence}</p><div className="mt-2 grid grid-cols-2 gap-2 text-[9px]"><p className="rounded-lg bg-blue-50 p-2 text-blue-800">保留结构：{item.preserve}</p><p className="rounded-lg bg-amber-50 p-2 text-amber-800">替换内容：{item.replace}</p></div></div>)}</div></section>}
    </div>
  );

  if (activeTab === 'visual') return (
    <div className="space-y-3">
      <div><p className="text-[11px] font-semibold text-text-primary">逐图视觉事实</p><p className="mt-1 text-[10px] text-text-muted">主体、场景、构图、颜色和实际可读文字</p></div>
      {!isAnalyzed ? <EmptyEvidence title="尚未返回逐图拆解" desc="当前没有可验证的图片视觉结果。"/> : evidence!.observedFacts.map(fact => { const flow = evidence!.carouselFlow.find(item => item.imageIndex === fact.imageIndex); return <div key={fact.imageIndex} className="rounded-lg border border-border bg-white p-3"><div className="flex items-center justify-between"><p className="text-[11px] font-semibold text-text-primary">第 {fact.imageIndex} 张</p><span className="rounded-full bg-violet-50 px-2 py-0.5 text-[9px] font-bold text-violet-700">{roleLabel[flow?.role || 'unknown']}</span></div><p className="mt-2 text-[10px] text-text-secondary">主体：{fact.subjects.join('、') || '未确认'}</p><p className="mt-1 text-[10px] text-text-secondary">场景：{fact.scene || '未确认'}</p><p className="mt-1 text-[10px] text-text-secondary">构图：{fact.composition || '未确认'}</p><p className="mt-1 text-[10px] text-text-secondary">颜色：{fact.colors.join('、') || '未确认'}</p>{fact.visibleText.length > 0 && <p className="mt-1 rounded-lg bg-surface-2 p-2 text-[10px] text-text-secondary">OCR：{fact.visibleText.join(' / ')}</p>}{flow?.evidence && <p className="mt-2 text-[9px] text-text-muted">轮播作用依据：{flow.evidence}</p>}</div>; })}
    </div>
  );

  if (activeTab === 'copy') return (
    <div className="space-y-3">
      <section className="rounded-lg border border-border bg-white p-3"><div className="flex items-center justify-between"><p className="text-[10px] font-bold text-text-muted">原始帖文</p><span className="rounded-full bg-surface-2 px-2 py-0.5 text-[9px] text-text-muted">抓取原文</span></div><p className="mt-2 text-[11px] font-bold leading-relaxed text-text-primary">{rawCaption || '未抓取到原始帖文'}</p></section>
      {!evidence?.copyEvidence.hooks.length && !evidence?.copyEvidence.sellingPoints.length ? <EmptyEvidence title="没有可确认的文案模块" desc="仅展示原始帖文，不推断未出现的人群、痛点或承诺。"/> : <>{evidence?.copyEvidence.hooks.map((item, index) => <EvidenceCard key={`copy-hook-${index}`} label={`钩子 ${index + 1} · ${item.source}`} value={`${item.text}｜证据：${item.evidence}`}/>)}{evidence?.copyEvidence.sellingPoints.map((item, index) => <EvidenceCard key={`copy-point-${index}`} label={`卖点 ${index + 1} · ${item.source}`} value={`${item.text}｜证据：${item.evidence}`}/>)}</>}
    </div>
  );

  return (
    <div className="space-y-3">
      <div><p className="text-[11px] font-semibold text-text-primary">套用到企业获客内容</p><p className="mt-1 text-[10px] text-text-muted">生成“吸引—解释—信任”三条连续内容，而不是三张相似测试图。</p></div>
      {!isAnalyzed ? <EmptyEvidence title="暂不能生成内容包" desc="需要先完成逐图证据提取，才能安全复用布局和信息模块。"/> : <div className="space-y-2">{[['吸引目标买家', '复用首图停留结构，替换为企业产品和买家问题。'], ['解释合作能力', '复用产品、细节和流程模块，映射企业 MOQ、定制与交付资料。'], ['建立供应商信任', '复用证明模块，只使用企业真实工厂、认证和案例。']].map(([title, desc], index) => <div key={title} className="flex gap-3 rounded-lg border border-border bg-white p-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[10px] font-semibold text-blue-700">{index + 1}</span><div><p className="text-[11px] font-semibold text-text-primary">{title}</p><p className="mt-1 text-[10px] text-text-secondary">{desc}</p></div></div>)}{evidence!.uncertainties.length > 0 && <div className="rounded-lg bg-amber-50 p-3"><p className="text-[10px] font-semibold text-amber-800">生成前需确认</p>{evidence!.uncertainties.map(item => <p key={item} className="mt-1 text-[9px] text-amber-700">· {item}</p>)}</div>}</div>}
    </div>
  );
}

// ── Analysis Panel ────────────────────────────────────────────────────────────
export function AnalysisPanel({ video, onGenerateScript, onPersonReplace, onRetry, onExactAnalysis, actionNotice, specialRecommendation }: { video: TrendVideo; onGenerateScript: (analysis?: ScriptAnalysis) => void; onPersonReplace: (analysis?: ScriptAnalysis) => void; onRetry?: () => void; onExactAnalysis?: () => void; actionNotice?: string; specialRecommendation?: AccountSpecialRecommendation | null }) {
  const [loaded, setLoaded] = useState(false);
  const [analysis, setAnalysis] = useState<ScriptAnalysis | null>(null);
  const [activeBookmark, setActiveBookmark] = useState<'reason' | 'frames' | 'script' | 'adapt' | ImageInsightTab>(video.contentFormat === 'image' ? 'overview' : 'reason');
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialLoading, setMaterialLoading] = useState(false);
  const [editingAnalysis, setEditingAnalysis] = useState(false);
  const [savingAnalysis, setSavingAnalysis] = useState(false);
  const [reanalyzingImage, setReanalyzingImage] = useState(false);
  const [analysisSaveNotice, setAnalysisSaveNotice] = useState('');
  const analysisKey = JSON.stringify(video.aiAnalysis || {});
  const updateDetail = (index: number, patch: Partial<ScriptDetail15s>) => setAnalysis(current => current ? ({ ...current, scriptDetails15s: current.scriptDetails15s.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }) : current);
  const saveAnalysisCorrections = async () => {
    if (!analysis) return;
    setSavingAnalysis(true); setAnalysisSaveNotice('');
    try {
      const response = await fetch(`/api/overseas/videos/${video.id}/analysis-corrections`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify({ scriptSummary15s: analysis.scriptSummary15s, scriptDetails15s: analysis.scriptDetails15s, confirmed: true }) });
      if (!response.ok) throw new Error(`保存失败（${response.status}）`);
      setEditingAnalysis(false); setAnalysisSaveNotice('修正已保存，后续裂变将使用确认稿');
    } catch (error) { setAnalysisSaveNotice(error instanceof Error ? error.message : '保存失败'); }
    finally { setSavingAnalysis(false); }
  };
  const reanalyzeImage = async () => {
    const id = video.recordId || video.id.replace(/^crawl-/, '');
    setReanalyzingImage(true);
    try {
      const response = await fetch(`/api/overseas/videos/${id}/reanalyze-image`, { method: 'POST', headers: authHeader() });
      if (!response.ok) throw new Error((await response.json().catch(() => ({})))?.error || '图片分析失败');
      window.location.reload();
    } catch (error) {
      setAnalysisSaveNotice(error instanceof Error ? error.message : '图片分析失败');
    } finally { setReanalyzingImage(false); }
  };

  useEffect(() => {
    setLoaded(false);
    setAnalysis(null);
    const t = setTimeout(() => {
      setAnalysis(video.contentFormat === 'image' ? imageAnalysisShell(video) : getAnalysis(video));
      setLoaded(true);
    }, video.aiAnalysis?.gemini ? 250 : 900);
    return () => clearTimeout(t);
  }, [video.id, analysisKey]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      setMaterialLoading(true);
      void studioApi.listMaterials()
        .then(list => {
          if (!cancelled) setMaterials(list.filter(item => item.type === 'video'));
        })
        .catch(() => {
          if (!cancelled) setMaterials([]);
        })
        .finally(() => {
          if (!cancelled) setMaterialLoading(false);
        });
    };
    refresh();
    window.addEventListener('lingshu:materials-updated', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('lingshu:materials-updated', refresh);
    };
  }, [video.id]);

  useEffect(() => {
    setActiveBookmark(video.contentFormat === 'image' ? 'overview' : 'reason');
  }, [video.id, video.contentFormat]);

  if (!loaded) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ background: 'rgba(22,163,74,0.1)' }}>
          <Loader2 size={18} className="text-accent animate-spin" />
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-semibold text-text-primary">{video.contentFormat === 'image' ? 'AI 正在提取图片爆点…' : 'AI 正在分析脚本结构…'}</p>
          <p className="text-xs text-text-muted">{video.contentFormat === 'image' ? '视觉焦点 · 文案钩子 · 迭代变量' : '前 10 秒五维拆解 · 粗略 3 秒结构 · 提取复用爆点'}</p>
        </div>
      </div>
    );
  }

  if (!analysis) {
    const state = pipelineState(video);
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-surface-2 border border-border">
          {state.spinning ? <Loader2 size={18} className="text-accent animate-spin" /> : <X size={18} className={state.failed ? 'text-accent' : 'text-text-muted'} />}
        </div>
        <div className="space-y-1 max-w-xs">
          <p className="text-sm font-semibold text-text-primary">{state.title}</p>
          <p className="text-xs text-text-muted leading-relaxed">
            {state.desc}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {state.failed && onRetry && (
            <button onClick={onRetry}
              className="px-3 py-2 rounded-lg text-xs font-semibold text-white transition-colors"
              style={{ background: 'var(--color-accent)' }}>
              重试
            </button>
          )}
          {video.sourceUrl && (
            <button onClick={() => window.open(video.sourceUrl, '_blank', 'noopener,noreferrer')}
              className="px-3 py-2 rounded-lg border border-border bg-surface-2 text-xs font-semibold text-text-secondary hover:text-text-primary transition-colors">
              打开原视频
            </button>
          )}
        </div>
      </div>
    );
  }

  const frameMatches = matchMaterialsToFrames(analysis.scriptDetails15s, materials);
  const matchedCount = frameMatches.filter(item => item.material).length;

  const confirmMatchedSegment = async (match: FrameMaterialMatch) => {
    if (!match.material || !match.segment) return;
    const result = await studioApi.updateMaterialSegment(match.material.id, match.segment.id, { manualConfirmed: true, needsReview: false });
    if (result.ok && result.material) setMaterials(current => current.map(item => item.id === result.material!.id ? result.material! : item));
  };

  const bookmarkTabs = video.contentFormat === 'image' ? [
    { id: 'overview' as const, icon: <Zap size={12} />, label: '表现与模块' },
    { id: 'visual' as const, icon: <Images size={12} />, label: '逐图拆解' },
    { id: 'copy' as const, icon: <FileText size={12} />, label: '文案证据' },
    { id: 'iterate' as const, icon: <Sparkles size={12} />, label: '获客套用' },
  ] : [
    { id: 'reason' as const, icon: <Lightbulb size={12} />, label: '核心原因' },
    { id: 'frames' as const, icon: <Film size={12} />, label: '分镜匹配' },
    { id: 'script' as const, icon: <FileText size={12} />, label: '脚本详析' },
    { id: 'adapt' as const, icon: <Sparkles size={12} />, label: '改编建议' },
  ];
  const imageEvidenceCount = video.aiAnalysis?.imageEvidence?.observedFacts.length || 0;
  const hasTrustedImageAnalysis = video.contentFormat === 'image' && video.aiAnalysis?.imageEvidence?.status === 'analyzed' && imageEvidenceCount > 0;
  const strategyPipelineState = pipelineState(video);
  const showStrategyProgress = video.contentFormat === 'video'
    && needsVideoEnhancement(video)
    && strategyPipelineState.spinning;
  const analysisQuality = exactAnalysisQuality(video);
  const videoGenerationBlocked = video.contentFormat === 'video' && !analysisQuality.ready;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-lingshu-guide="analysis-evidence">
      <div className="flex-shrink-0 border-b border-border bg-surface px-4 py-3">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px] text-text-muted">
          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 font-semibold text-text-secondary">{video.contentFormat === 'image' && <><SocialPlatformIcon platform={video.platform} size={12} /><span className="sr-only">{getPlatformMeta(video.platform).label}</span></>}{video.contentFormat === 'image' ? '图文' : analysis.videoType}</span>
          {video.contentFormat === 'image' ? <><span className="flex items-center gap-1"><BarChart2 size={9} className="text-accent" />{hasTrustedImageAnalysis ? `已提取 ${imageEvidenceCount} 条证据` : '图片分析待完成'}</span><span className="flex items-center gap-1"><Images size={9} />{video.aiAnalysis?.imageCount || video.aiAnalysis?.imageUrls?.length || 1} 张图片</span></> : <><span className="flex items-center gap-1"><BarChart2 size={9} className="text-accent" />信息速度 {analysis.infoSpeed}</span><span className="flex items-center gap-1"><TrendingUp size={9} />{video.views} 播放</span><span>{analysis.emotion}</span></>}
        </div>
        {showStrategyProgress && <div role="status" aria-live="polite" className="mb-3 flex items-start gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-[10px] leading-relaxed text-text-secondary">
          <Loader2 size={12} className="mt-0.5 shrink-0 animate-spin text-accent" />
          <span><strong className="text-text-primary">{strategyPipelineState.title}</strong>：{strategyPipelineState.desc}</span>
        </div>}
        <div className="grid grid-cols-4 border-b border-border">
          {bookmarkTabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveBookmark(tab.id)}
              className={`flex min-h-9 items-center justify-center gap-1 border-b-2 px-1.5 text-[11px] font-bold transition-colors ${
                activeBookmark === tab.id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-muted hover:text-text-secondary'
              }`}
            >
              {tab.icon}
              <span className="truncate">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <AnimatePresence mode="wait">
          {video.contentFormat === 'image' && ['overview', 'visual', 'copy', 'iterate'].includes(activeBookmark) && (
            <motion.div key={activeBookmark} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
              <ImageBreakdownContent video={video} analysis={analysis} activeTab={activeBookmark as ImageInsightTab} />
            </motion.div>
          )}
          {activeBookmark === 'reason' && (
            <motion.div key="reason" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="space-y-3">
              {specialRecommendation && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 shadow-none">
                  <div className="flex items-center gap-1.5"><Flame size={13} className="text-red-600" /><p className="text-[11px] font-semibold text-red-700">特别推荐 · 借鉴价值{specialRecommendation.level}</p></div>
                  <p className="mt-1 text-[10px] leading-relaxed text-red-700">{specialRecommendation.message}</p>
                </div>
              )}
              <div>
                <div className="mb-2 flex items-center gap-1.5">
                  <Lightbulb size={11} className="text-accent" />
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">爆款核心原因 · 前 10 秒五维拆解</p>
                </div>
                <div className="space-y-1.5">
                  {analysis.firstTenSeconds.map((item, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
                      <span className="mt-px flex-shrink-0 text-[11px] font-bold text-accent">{item.dimension}</span>
                      {item.dimension === '画面' ? (
                        <div className="space-y-0.5 text-[11px] leading-snug text-text-secondary">
                          {conciseLines(item.detail, 6, 32).map((line, idx) => <p key={idx}>{line}</p>)}
                        </div>
                      ) : (
                        <p className="text-[11px] leading-snug text-text-secondary">{shortenText(item.detail, 96)}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {activeBookmark === 'frames' && (
            <motion.div key="frames" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Film size={11} className="text-accent" />
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">自动分镜素材匹配</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-text-muted">
                    {materialLoading ? '读取本地素材中...' : `${matchedCount}/${frameMatches.length} 已匹配`}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                {frameMatches.map((match, i) => {
                  const key = `${match.detail.time}-${i}`;
                  const hasMaterial = Boolean(match.material);
                  return (
                    <div key={key} className={`rounded-md border p-3 ${match.decision === 'copy_now' ? 'border-accent/25 bg-accent-glow' : match.decision === 'drop' ? 'border-border bg-surface-2/60' : 'border-amber/25 bg-amber-dim'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[9px] font-bold text-white">{match.detail.time}</span>
                            <span className="text-[11px] font-semibold text-text-primary">{match.viralDna.purpose}</span>
                          </div>
                          <p className="mt-1 text-[10px] text-text-muted">{match.detail.shot} · {match.detail.camera}</p>
                        </div>
                      </div>

                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <div className="rounded-md border border-amber/20 bg-surface px-2.5 py-2">
                          <div className="flex items-center justify-between"><span className="text-[9px] font-bold text-amber">爆款潜力</span><span className="text-sm font-bold text-amber">{frameScoreGrade(match.viralPotential.score)}</span></div>
                          <div className="mt-1 h-1 overflow-hidden rounded-full bg-amber-dim"><div className="h-full rounded-full bg-amber" style={{ width: `${match.viralPotential.score}%` }} /></div>
                        </div>
                        <div className="rounded-md border border-accent/20 bg-surface px-2.5 py-2">
                          <div className="flex items-center justify-between"><span className="text-[9px] font-bold text-accent">可复制性</span><span className="text-sm font-bold text-accent">{frameScoreGrade(match.replicability.score)}</span></div>
                          <div className="mt-1 h-1 overflow-hidden rounded-full bg-accent-glow"><div className="h-full rounded-full bg-accent" style={{ width: `${match.replicability.score}%` }} /></div>
                        </div>
                      </div>

                      <div className="mt-2 rounded-lg border border-border bg-white/90 px-2.5 py-2">
                        <p className="text-[9px] font-semibold text-text-primary">为什么有效</p>
                        <p className="mt-1 text-[10px] leading-relaxed text-text-secondary">{match.viralPotential.whyEffective}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1">{match.viralPotential.mechanisms.map(item => <span key={item} className="rounded bg-amber-dim px-1.5 py-0.5 text-[9px] font-bold text-amber">{item}</span>)}</div>
                      </div>

                      <div className="mt-2 rounded-lg border border-border bg-white/90 px-2.5 py-2">
                        <p className="text-[9px] font-semibold text-text-primary">必须保留</p>
                        <div className="mt-1 space-y-0.5">{match.viralDna.mustPreserve.slice(0, 4).map(item => <p key={item} className="text-[10px] leading-relaxed text-text-secondary">✓ {item}</p>)}</div>
                      </div>

                      <div className="mt-2 rounded-md border border-accent/20 bg-accent-glow px-2.5 py-2">
                        <p className="text-[9px] font-bold text-accent">企业替换与执行</p>
                        <p className="mt-1 text-[10px] leading-relaxed text-text-secondary">{match.viralDna.replaceable.join('；')}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[9px] font-bold">
                          <span className="rounded bg-white px-1.5 py-0.5 text-text-secondary">真实素材覆盖 {match.replicability.localCoverage}%</span>
                          <span className="rounded bg-white px-1.5 py-0.5 text-text-secondary">执行可行性 {AI_FEASIBILITY_LABELS[match.replicability.aiFeasibility]}</span>
                          <span className={`rounded bg-white px-1.5 py-0.5 ${hasMaterial ? 'text-green-700' : 'text-amber-700'}`}>{hasMaterial ? '已有候选片段' : '缺少真实片段'}</span>
                        </div>
                        {match.replicability.blockers.length > 0 && <p className="mt-1.5 text-[10px] leading-relaxed text-amber-700">阻塞：{match.replicability.blockers.join('；')}</p>}
                      </div>

                      <details className="mt-2 rounded-lg border border-border bg-white/80 px-2.5 py-2">
                        <summary className="cursor-pointer text-[10px] font-bold text-text-secondary">查看原分镜与素材匹配详情</summary>
                        <div className="mt-2 space-y-2 border-t border-border pt-2">
                          <p className="text-[10px] leading-relaxed text-text-secondary"><span className="font-bold">原画面：</span>{match.detail.visual}</p>
                          {hasMaterial && match.material ? <>
                            <div className="flex gap-2">
                              <div className="relative h-20 w-14 shrink-0 overflow-hidden rounded-md border border-border bg-surface-2">
                                {match.material.url ? <video src={`${match.material.url}#t=${match.segment?.start ?? 0.1}`} poster={match.segment?.poster || match.material.poster} muted playsInline preload="metadata" className="h-full w-full object-cover" /> : match.material.poster ? <img src={match.material.poster} alt="" className="h-full w-full object-cover" /> : <Film size={14} className="m-auto mt-7 text-text-muted" />}
                              </div>
                              <div className="min-w-0 flex-1"><p className="truncate text-[10px] font-bold text-text-primary">{match.material.name}</p><p className="mt-1 text-[9px] text-text-muted">{match.reason}</p>{match.trim && <p className="mt-1 text-[10px] font-bold text-green-700">{match.trim.label}</p>}</div>
                            </div>
                            {match.scores && <div className="grid grid-cols-4 gap-1 text-center text-[9px] font-semibold text-text-muted">
                              <span className="rounded bg-surface-2 px-1 py-0.5">功能 {match.scores.function}</span><span className="rounded bg-surface-2 px-1 py-0.5">动作 {match.scores.action}</span><span className="rounded bg-surface-2 px-1 py-0.5">主体 {match.scores.subject}</span><span className="rounded bg-surface-2 px-1 py-0.5">构图 {match.scores.composition}</span><span className="rounded bg-surface-2 px-1 py-0.5">运镜 {match.scores.camera}</span><span className="rounded bg-surface-2 px-1 py-0.5">时长 {match.scores.duration}</span><span className="rounded bg-surface-2 px-1 py-0.5">质量 {match.scores.quality}</span><span className="rounded bg-surface-2 px-1 py-0.5">企业适配 {match.scores.enterpriseFit}</span>
                            </div>}
                            {match.segment && !match.segment.manualConfirmed && <button type="button" onClick={() => void confirmMatchedSegment(match)} className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700"><Check size={10} />人工确认片段</button>}
                          </> : <p className="text-[10px] leading-relaxed text-accent-800">{match.suggestion}</p>}
                        </div>
                      </details>

                      {!hasMaterial && match.replicability.recommendedExecution === 'system_route' && <p className="mt-2 rounded-lg bg-white px-2.5 py-2 text-[10px] font-bold text-amber-700">待生产选路：{match.suggestion}。优先复用、合成或生成，实拍仅作为可选补充。</p>}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {activeBookmark === 'script' && (
            <motion.div key="script" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5"><FileText size={11} className="text-accent" /><p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">导演分镜脚本详析</p></div>
                <div className="flex items-center gap-2">
                  {analysisSaveNotice && <span className="text-[10px] text-text-muted">{analysisSaveNotice}</span>}
                  {editingAnalysis ? <><button onClick={() => setEditingAnalysis(false)} className="text-[10px] font-bold text-text-muted">取消</button><button onClick={() => void saveAnalysisCorrections()} disabled={savingAnalysis} className="rounded-lg bg-accent px-2.5 py-1 text-[10px] font-bold text-white disabled:opacity-50">{savingAnalysis ? '保存中…' : '保存修正'}</button></> : <button onClick={() => setEditingAnalysis(true)} className="rounded-lg border border-border bg-white px-2.5 py-1 text-[10px] font-bold text-text-secondary">编辑校对</button>}
                </div>
              </div>
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="space-y-1 border-b border-border bg-surface-2 px-3 py-2.5">
                  <p className="text-[11px] leading-relaxed text-text-secondary"><span className="font-semibold text-text-primary">基础要求：</span>{analysis.baseRequirements}</p>
                  <p className="text-[11px] text-text-secondary"><span className="font-semibold text-text-primary">指定画风：</span>{analysis.scriptSummary15s.visualStyle}</p>
                  <p className="text-[11px] text-text-secondary"><span className="font-semibold text-text-primary">核心情绪：</span>{analysis.scriptSummary15s.coreEmotion}</p>
                  <p className="text-[11px] text-text-secondary">
                    <span className="font-semibold text-text-primary">参考品牌/竞品：</span>
                    {analysis.scriptSummary15s.competitors.length
                      ? analysis.scriptSummary15s.competitors.map(item => `==${item}==`).join('；')
                      : '未提取到可确认品牌/竞品'}
                  </p>
                </div>
                <div className="divide-y divide-border">
                  {analysis.scriptDetails15s.map((item, i) => (
                    <div key={`${item.time}-${i}`} className="px-3 py-2.5">
                      {editingAnalysis ? <div className="grid grid-cols-2 gap-2">
                        <input value={item.time} onChange={event => updateDetail(i, { time: event.target.value })} className="rounded-lg border border-border px-2 py-1.5 text-[10px]" placeholder="时间区间" />
                        <input value={item.purpose || ''} onChange={event => updateDetail(i, { purpose: event.target.value })} className="rounded-lg border border-border px-2 py-1.5 text-[10px]" placeholder="镜头功能" />
                        <textarea value={item.visual} onChange={event => updateDetail(i, { visual: event.target.value })} className="col-span-2 rounded-lg border border-border px-2 py-1.5 text-[10px]" rows={2} placeholder="画面" />
                        <textarea value={item.dialogue || ''} onChange={event => updateDetail(i, { dialogue: event.target.value })} className="rounded-lg border border-border px-2 py-1.5 text-[10px]" rows={2} placeholder="口播" />
                        <textarea value={item.onScreenText || ''} onChange={event => updateDetail(i, { onScreenText: event.target.value })} className="rounded-lg border border-border px-2 py-1.5 text-[10px]" rows={2} placeholder="屏幕文字" />
                        <input value={item.note || ''} onChange={event => updateDetail(i, { note: event.target.value, needsReview: Boolean(event.target.value) })} className="col-span-2 rounded-lg border border-border px-2 py-1.5 text-[10px]" placeholder="人工复核备注；清空表示已确认" />
                      </div> : <p className="text-[11px] leading-relaxed text-text-secondary">
                        <span className="font-mono font-semibold text-accent">[{item.time}]</span>{' '}
                        环境：{item.environment}；景别：{item.shot}；运镜：{item.camera}；{item.purpose ? `镜头功能：${item.purpose}；` : ''}画面：{item.visual}；{(item.dialogue || item.subtitle) ? `口播：“${item.dialogue || item.subtitle}”；` : ''}{item.onScreenText ? `屏幕文字：“${item.onScreenText}”；` : ''}配乐：{item.bgm || item.audio || '按原片节奏卡点'}
                        {item.note ? `（注：${item.note}）` : ''}
                      </p>}
                      {item.beats?.length ? <div className="mt-1.5 space-y-1 border-l-2 border-accent/30 pl-2">{item.beats.map((beat, beatIndex) => <p key={beatIndex} className="text-[10px] text-text-muted">[{beat.time || '镜头内'}] {beat.action}{beat.dialogue ? `；口播：${beat.dialogue}` : ''}{beat.onScreenText ? `；字幕：${beat.onScreenText}` : ''}</p>)}</div> : null}
                      {item.needsReview && <p className="mt-1 text-[10px] font-semibold text-amber-500">需人工复核 · 识别置信度 {Math.round((item.confidence ?? 0) * 100)}%</p>}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {activeBookmark === 'adapt' && (
            <motion.div key="adapt" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="space-y-3">
              <div className="rounded-lg border border-dashed p-3"
                style={{ borderColor: 'rgba(22,163,74,0.3)', background: 'rgba(22,163,74,0.04)' }}>
                <p className="mb-1.5 text-[10px] font-semibold text-accent">改编建议</p>
                <p className="text-[11px] leading-relaxed text-text-secondary">{analysis.adaptTip}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface-2 p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">可复用爆点</p>
                <div className="flex flex-wrap gap-1.5">
                  {referenceHighlights(video, analysis).slice(0, 6).map((item, index) => (
                    <span key={`${item}-${index}`} className="rounded-full border border-border bg-white px-2 py-1 text-[10px] font-semibold text-text-secondary">
                      {shortenText(item, 28)}
                    </span>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex-shrink-0 border-t border-border bg-surface p-4 shadow-[0_-10px_24px_rgba(15,23,42,0.04)]">
        {video.contentFormat !== 'image' && <div className="mb-3 rounded-lg border border-accent/20 bg-accent/5 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold text-text-primary">{analysisQuality.ready ? '全片精确分析版 · 质量校验通过' : video.aiAnalysis?.requestedAnalysisMode === 'exact' ? '全片精确分析排队中' : video.aiAnalysis?.analysisMode === 'exact' ? '全片精确分析未通过校验' : showStrategyProgress ? '自动策略分析处理中' : '全片策略分析版'}</p>
            {!analysisQuality.ready && <button type="button" onClick={onExactAnalysis} disabled={video.aiAnalysis?.requestedAnalysisMode === 'exact'} className="shrink-0 rounded-lg border border-accent bg-white px-2.5 py-1.5 text-[10px] font-semibold text-accent hover:bg-accent/5 disabled:cursor-wait disabled:opacity-50">{video.aiAnalysis?.requestedAnalysisMode === 'exact' ? '精确分析生成中…' : video.aiAnalysis?.analysisMode === 'exact' ? '重试全片精确分析' : '生成全片精确分析'}</button>}
          </div>
          {actionNotice && <p role="status" aria-live="polite" className="mt-2 rounded-lg border border-accent/20 bg-white px-2.5 py-2 text-[10px] font-semibold leading-relaxed text-text-secondary">{actionNotice}</p>}
          {video.aiAnalysis?.videoLevelFailureStatus && !video.aiAnalysis?.requestedAnalysisMode && <p role="status" aria-live="polite" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] font-semibold leading-relaxed text-amber-700">全片精确分析未完成，已保留原分析。可稍后重试，或换用可直接下载的公开素材。</p>}
        </div>}
        {video.contentFormat === 'image' && !hasTrustedImageAnalysis && <button type="button" onClick={() => void reanalyzeImage()} disabled={reanalyzingImage} className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 py-2 text-xs font-semibold text-blue-700 disabled:opacity-50">{reanalyzingImage ? <Loader2 size={13} className="animate-spin"/> : <Images size={13}/>}重新分析完整轮播</button>}
        {analysisSaveNotice && video.contentFormat === 'image' && <p className="mb-2 text-center text-[10px] text-red-500">{analysisSaveNotice}</p>}
        <button onClick={() => onGenerateScript(analysis || undefined)} disabled={(video.contentFormat === 'image' && !hasTrustedImageAnalysis) || videoGenerationBlocked}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-accent py-3 text-sm font-bold text-white transition-colors enabled:hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-50">
          <Sparkles size={16} />
          {video.contentFormat === 'image' ? (hasTrustedImageAnalysis ? '套用企业资料生成获客内容包' : '先完成图片分析') : videoGenerationBlocked ? '先完成合格的全片精确分析' : 'AI一键爆款迭代'}
          <ChevronRight size={15} />
        </button>
        {video.contentFormat !== 'image' && <button type="button" onClick={() => onPersonReplace(analysis || undefined)} disabled={videoGenerationBlocked} className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-violet-300 bg-white py-3 text-sm font-bold text-violet-700 transition-colors enabled:hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50">
          <ScanFace size={16}/>爆款分镜人物替换<ChevronRight size={15}/>
        </button>}
      </div>
    </div>
  );
}
