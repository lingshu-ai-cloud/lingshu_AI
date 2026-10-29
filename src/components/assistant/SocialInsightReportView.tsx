import { useEffect, useState, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { isSocialInsightReport, type SocialInsightJob, type SocialInsightReport, type SocialInsightVideo } from '../../../shared/socialInsightReport';
import { AUTH_TOKEN_CHANGED_EVENT, getToken } from '../../lib/auth';
import { readSocialInsightReport } from '../../lib/socialInsightApi';
import { recommendSocialInsightSamples } from '../../../shared/socialInsightRecommendations';
import { reportPresentationText } from '../../../shared/reportPresentation';
import { evidenceSafeSocialInsightReport } from '../../../shared/socialInsightEvidenceFilter';
import { LsDataChart } from '../ui/LsDataChart';
import { LsMediaStateFrame, LsProgressiveMedia } from '../ui/LsExperiencePrimitives';

/** Only public HTTPS images and original TikTok pages can leave this read-only report. */
export function socialInsightSafeUrl(value: string | null, original = false): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !host.includes('.') || host.includes(':') || /^[\d.]+$/.test(host)
      || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)) return undefined;
    if (original && host !== 'tiktok.com' && !host.endsWith('.tiktok.com')) return undefined;
    return url.href;
  } catch { return undefined; }
}

const date = (value: string, withTime = false) => {
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? '' : instant.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } as const : {}),
  });
};
const metric = (value: number | null) => value === null ? '未提供' : value.toLocaleString('zh-CN');

type MaterialAssignment = NonNullable<SocialInsightReport['materials']>['assignments'][number];

export function SocialInsightVideoEvidence({ video, material }: { video: SocialInsightVideo; material?: MaterialAssignment }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const url = socialInsightSafeUrl(video.url, true);
  const thumbnail = socialInsightSafeUrl(video.thumbnailUrl);
  const reason = material?.confidence === 'low' ? '' : reportPresentationText(material?.reason || '');
  const help = reportPresentationText(material?.merchantHelp || '');
  const angle = reportPresentationText(material?.contentAngle || '');
  const evidence = material?.evidenceNeeded.map(reportPresentationText).filter(Boolean) || [];
  const cover = <div className="w-1/3 min-h-32 bg-surface">
      <LsMediaStateFrame state={thumbnail ? state : 'error'} label={!thumbnail || state === 'error' ? '封面暂不可用，可查看原视频' : undefined} className="min-h-32">
        {thumbnail && <LsProgressiveMedia src={thumbnail} alt={video.title} preview={false} width="100%"
          referrerPolicy="no-referrer" loading="lazy" style={{ height: 'auto', objectFit: 'contain' }}
          onLoad={() => setState('ready')} onError={() => setState('error')}/>}
      </LsMediaStateFrame>
    </div>;
  return <article className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface">
    {url ? <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`打开原视频：${video.title}`} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{cover}</a> : cover}
    <div className="space-y-2 p-3">
      <h4 className="break-words text-sm font-semibold leading-5 text-text-primary">{video.title}</h4>
      {date(video.publishedAt) && <p className="text-xs text-text-muted">发布于 {date(video.publishedAt)}</p>}
      {video.caption && <p className="line-clamp-3 break-words text-xs leading-5 text-text-secondary" title={video.caption}>原配文：{video.caption}</p>}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-text-secondary">
        {([['播放', video.views], ['点赞', video.likes], ['评论', video.comments], ['分享', video.shares]] as const).map(([label, value]) =>
          <div key={label} className="flex min-w-0 justify-between gap-2"><dt>{label}</dt><dd className="tabular-nums">{metric(value)}</dd></div>)}
      </dl>
      {material && (reason || help || angle || evidence.length > 0) && <dl className="space-y-2 border-t border-border pt-2 text-xs leading-5 text-text-secondary">
        {reason && <div><dt className="font-semibold text-text-primary">配文分类依据</dt><dd>{reason}</dd></div>}
        {help && <div><dt className="font-semibold text-text-primary">对当前 B2B 商户的帮助</dt><dd>{help}</dd></div>}
        {angle && <div><dt className="font-semibold text-text-primary">可拍选题</dt><dd>{angle}</dd></div>}
        {evidence.length > 0 && <div><dt className="font-semibold text-text-primary">需要补证的企业资质 / 供应链证据</dt><dd><ul className="list-disc pl-4">{evidence.map((item, index) => <li key={index}>{item}</li>)}</ul></dd></div>}
      </dl>}
      {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        查看原视频<ExternalLink size={12} aria-hidden="true"/>
      </a> : <p className="text-xs text-text-muted">原视频链接未通过校验</p>}
    </div>
  </article>;
}

function evidenceInline(text: string, videos: SocialInsightVideo[]): ReactNode[] {
  const approved = new Set(videos.map(video => socialInsightSafeUrl(video.url, true)).filter(Boolean));
  const result: ReactNode[] = [];
  const links = /\[([^\]]+)\]\(([^\s)]+)\)/g;
  let cursor = 0;
  for (const match of text.matchAll(links)) {
    const index = match.index ?? 0;
    result.push(text.slice(cursor, index));
    const url = socialInsightSafeUrl(match[2], true);
    result.push(url && approved.has(url)
      ? <a key={index} href={url} target="_blank" rel="noopener noreferrer" className="font-medium text-accent underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{match[1]}</a>
      : match[1]);
    cursor = index + match[0].length;
  }
  result.push(text.slice(cursor));
  return result;
}

/** No nested protocol or actions; only links matching the collected video evidence are clickable. */
function Analysis({ text, videos }: { text: string; videos: SocialInsightVideo[] }) {
  return <div className="space-y-2 break-words text-sm leading-relaxed text-text-primary">
    {reportPresentationText(text).split('\n').filter(line => line.trim()).map((line, index) => {
      const heading = line.match(/^#{1,6}\s+(.+)/);
      const content = (heading?.[1] ?? line).replace(/\*\*/g, '').replace(/^[-*]\s+/, '• ');
      return heading ? <h3 key={index} className="pt-2 text-base font-semibold">{evidenceInline(content, videos)}</h3>
        : <p key={index} className="whitespace-pre-wrap">{evidenceInline(content, videos)}</p>;
    })}
  </div>;
}

/** Ranking is calculated from this snapshot's measured plays; missing metrics never become zero. */
export function socialInsightCategorySamples(report: SocialInsightReport, category: 'b2b' | 'b2c') {
  const assignments = report.materials?.assignments.filter(item => item.category === category) ?? [];
  return assignments.flatMap(material => {
    const video = report.videos.find(item => item.id === material.videoId);
    return video ? [{ video, material }] : [];
  }).sort((a, b) => a.video.views === null ? b.video.views === null ? 0 : 1
    : b.video.views === null ? -1 : b.video.views - a.video.views);
}

function MaterialCategory({ report, category }: { report: SocialInsightReport; category: 'b2b' | 'b2c' }) {
  const label = category === 'b2b' ? 'B2B · 企业采购导向' : 'B2C · 消费者导向';
  const samples = socialInsightCategorySamples(report, category);
  const measured = samples.filter(item => item.video.views !== null);
  const originalGroup = report.materials?.groups.find(item => item.category === category);
  const group = originalGroup && { ...originalGroup, summary: reportPresentationText(originalGroup.summary), recommendations: originalGroup.recommendations.map(reportPresentationText).filter(Boolean) };
  return <section className="min-w-0 space-y-3 border-t border-border pt-4" aria-label={`${category.toUpperCase()} 分类样本`}>
    <h3 className="text-base font-semibold text-text-primary">{label}</h3>
    <p className="text-xs leading-5 text-text-muted">近 7 天采集样本 {samples.length} 条 · {date(report.period.from)} — {date(report.period.to)} · 北京时间</p>
    {group?.summary && <p className="text-sm leading-relaxed text-text-secondary">{evidenceInline(group.summary, report.videos)}</p>}
    {!samples.length ? <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-text-muted">本次没有可归入 {category.toUpperCase()} 的有效样本，不补编素材或图表。</p> : <>
      {measured.length ? <LsDataChart title={`${category.toUpperCase()} 样本播放量快照`} kind="bar" unit="次" height={220}
        description={`仅比较本次 ${measured.length} 条提供播放量的同类样本，按采集时播放量降序，不代表全平台排名或增长趋势。`}
        labels={measured.map(item => item.video.title)} series={[{ label: '采集时播放量', values: measured.map(item => item.video.views) }]}/>
        : <p className="text-xs text-text-muted">本类样本未提供播放量，无法生成播放量排行或图表。</p>}
      {samples.length > measured.length && <p className="text-xs text-text-muted">另有 {samples.length - measured.length} 条样本未提供播放量，列于末尾且不参与高表现排序。</p>}
      <p className="text-sm font-semibold text-text-primary">本次分类样本{!measured.length ? ' · 暂无可核验排行' : ''}</p>
      <div className="grid min-w-0 items-start gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }}>
        {samples.map(({ video, material }) => <SocialInsightVideoEvidence key={video.id} video={video} material={material}/>)}
      </div>
    </>}
    {group?.recommendations.length ? <div className="space-y-1"><h4 className="text-sm font-semibold text-text-primary">制作建议</h4><ul className="list-disc space-y-1 pl-4 text-sm leading-relaxed text-text-secondary">{group.recommendations.map((item, index) => <li key={index}>{evidenceInline(item, report.videos)}</li>)}</ul></div> : null}
  </section>;
}

export function SocialInsightReportView({ report: source }: { report: SocialInsightReport }) {
  const safe = evidenceSafeSocialInsightReport(source);
  const report = { ...safe, limitations: safe.limitations.map(reportPresentationText).filter(Boolean) };
  const recommendations = recommendSocialInsightSamples(report);
  return <section className="my-3 min-w-0 space-y-5 rounded-xl border border-border bg-surface p-4" aria-label="社交媒体洞察报告">
    <header className="space-y-2 border-b border-border pb-3">
      <h2 className="text-base font-semibold text-text-primary">{report.keyword} · 社交媒体洞察报告</h2>
      <p className="text-xs leading-5 text-text-secondary">当前商户：B2B{report.merchantContext?.industry ? ` · 行业：${report.merchantContext.industry}` : ''}</p>
      {report.merchantContext?.productCategories.length ? <p className="text-xs leading-5 text-text-secondary">产品方向：{report.merchantContext.productCategories.join('、')}</p> : null}
      <p className="text-xs leading-5 text-text-secondary">TikTok 公开内容 · {date(report.period.from)} — {date(report.period.to)} · 北京时间</p>
      <p className="text-xs leading-5 text-text-muted">有效样本 {report.sampleCount} 条 · 采集于 {date(report.collectedAt, true)}（北京时间）</p>
      <p className="text-xs leading-5 text-text-muted">图表为本次采集样本的快照，不代表全平台排名或增长趋势；缺失指标显示“未提供”。</p>
    </header>
    {!report.materials && <p role="status" className="text-xs leading-5 text-text-muted">部分报告：B2B / B2C 分类尚未完成。以下保留原始样本与已有分析，暂不推断分类。</p>}
    {!report.materials && report.charts.length > 0 && <div className="grid min-w-0 gap-4">
      {report.charts.map(chart => <LsDataChart key={chart.id} title={chart.title} kind={chart.type}
        description={`本次 ${report.sampleCount} 条公开内容样本；指标截至采集时点`} unit={chart.unit}
        labels={chart.data.map(item => item.label)} series={[{ label: chart.title, values: chart.data.map(item => item.value) }]}
        height={220} />)}
    </div>}
    <Analysis text={report.analysisMarkdown} videos={report.videos}/>
    {report.materials && <section aria-label="推荐素材" className="space-y-3 border-t border-border pt-4">
      <h3 className="text-base font-semibold text-text-primary">推荐素材</h3>
      <p className="text-xs leading-5 text-text-muted">最多10条，优先选择6条 B2B 和4条 B2C；B2B不足时由合格 B2C 补位。B2B 需播放不少于1万次；B2C 按已提供的播放量排序。两类均需有较明确的配文分类和内容建议。下方分类样本统计包含全部有效样本，数量可能高于推荐数。</p>
      {recommendations.length ? <div className="grid min-w-0 items-start gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }}>
        {recommendations.map(({video,material,fillsB2bSlot}) => <div key={video.id} className="min-w-0 space-y-1"><p className="text-xs font-medium text-text-secondary">{material.category.toUpperCase()}{fillsB2bSlot ? ' · 补位素材，保留 B2C 分类' : ''}</p><SocialInsightVideoEvidence video={video} material={material}/></div>)}
      </div> : <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-text-muted">本次样本暂无符合条件的推荐素材。</p>}
    </section>}
    {report.materials ? <><MaterialCategory report={report} category="b2b"/><MaterialCategory report={report} category="b2c"/></> : <section className="space-y-3" aria-label="视频样本与原文链接">
      <h3 className="text-sm font-semibold text-text-primary">视频样本与原文链接</h3>
      <div className="grid min-w-0 items-start gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }}>
        {report.videos.map(video => <SocialInsightVideoEvidence key={video.id} video={video}/>)}
      </div>
      {!report.videos.length && <p className="text-xs text-text-muted">本次未取得可展示的视频样本</p>}
    </section>}
    {report.limitations.length > 0 && <aside className="space-y-1 border-t border-border pt-3" aria-label="数据范围与局限">
      <h3 className="text-xs font-semibold text-text-secondary">数据范围与局限</h3>
      <ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-text-muted">{report.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>
    </aside>}
  </section>;
}

export function SocialInsightReportBlock({ raw }: { raw: string }) {
  let report: unknown;
  let reference: string | null = null;
  try {
    report = JSON.parse(raw);
    reference = socialInsightReportReference(report);
    if (!reference && !isSocialInsightReport(report)) report = null;
  } catch { report = null; }
  if (reference) return <SocialInsightReportReference reportId={reference}/>;
  return report ? <SocialInsightReportView report={report as SocialInsightReport}/>
    : <p role="status" className="my-2 text-xs text-text-muted">报告数据尚不完整，暂时无法展示。</p>;
}

export function socialInsightReportReference(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1 && typeof record.reportId === 'string' && /^[a-f0-9]{15}$/.test(record.reportId)
    ? record.reportId : null;
}

type ReferenceState = { id: string; token: string | null; job?: SocialInsightJob; error?: string };
const currentToken = () => typeof window === 'undefined' ? null : getToken();

/** Fetch the existing tenant-owned snapshot only. Viewing history never starts collection or synthesis. */
function SocialInsightReportReference({ reportId }: { reportId: string }) {
  const [state, setState] = useState<ReferenceState | null>(null);
  useEffect(() => {
    let disposed = false;
    let revision = 0;
    let controller: AbortController | undefined;
    const load = () => {
      const turn = ++revision;
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      const token = currentToken();
      setState({ id: reportId, token });
      if (!token) { setState({ id: reportId, token, error: '请登录后查看这份报告。' }); return; }
      void readSocialInsightReport(reportId, signal).then(job => {
        if (!disposed && !signal.aborted && turn === revision && token === currentToken()) {
          setState(job.id === reportId ? { id: reportId, token, job } : { id: reportId, token, error: '返回的报告不匹配，暂时无法展示。' });
        }
      }).catch(error => {
        if (!disposed && !signal.aborted && turn === revision && token === currentToken()) {
          setState({ id: reportId, token, error: error instanceof Error ? error.message : '报告读取失败，请稍后重试。' });
        }
      });
    };
    load();
    const storageChanged = (event: StorageEvent) => { if (event.key === null || event.key === 'overseas_token') load(); };
    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT, load);
    window.addEventListener('storage', storageChanged);
    return () => {
      disposed = true;
      revision++;
      controller?.abort();
      window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT, load);
      window.removeEventListener('storage', storageChanged);
    };
  }, [reportId]);
  const visible = state?.id === reportId && state.token === currentToken() ? state : null;
  if (!visible || !visible.job && !visible.error) return <p role="status" className="my-2 text-xs text-text-muted">正在读取已保存的报告…</p>;
  if (visible.error) return <p role="alert" className="my-2 text-xs text-text-muted">{visible.error}</p>;
  const job = visible.job!;
  return <>
    {job.status === 'partial' && <p role="status" className="my-2 text-xs text-text-muted">本次仅完成部分报告，具体缺失范围请查看下方说明。</p>}
    {job.report && job.error?.message && <p role="alert" className="my-2 text-xs text-text-muted">{job.error.message}</p>}
    {job.report ? <SocialInsightReportView report={job.report}/> : <p role="status" className="my-2 text-xs text-text-muted">{
      job.error?.message || (job.status === 'queued' || job.status === 'running' ? '报告仍在生成中，请稍后重新打开查看。'
        : job.status === 'empty' ? '本次未采集到可用内容，暂无报告。' : '这份报告尚未完成，暂时无法展示。')
    }</p>}
  </>;
}
