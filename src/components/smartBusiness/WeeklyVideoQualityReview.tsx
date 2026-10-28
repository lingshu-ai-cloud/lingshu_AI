import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Tag } from 'antd';
import type { WeeklyTaskWorkspace } from '../../../shared/contracts/weeklyTaskWorkspace';
import { acceptWeeklyUnknownVideoQuality, readWeeklyVideoQualityMedia, type WeeklyTaskWorkspaceScope } from '../../lib/weeklyTaskWorkspaceApi';
import { LsMediaStateFrame, LsProgressiveMedia } from '../ui/LsExperiencePrimitives';

type Subject = { expectedJobId: string; expectedRunId: string; expectedMediaSha256: string };
type MediaSubject = Subject & { expectedQualityInputHash: string };

/** A new inspection subject must remount its pending requests and acceptance state. */
export function weeklyVideoQualityIdentity(workspace: WeeklyTaskWorkspace): string {
  return JSON.stringify([workspace.tenantId, workspace.programId, workspace.packageId, workspace.packageVersion,
    workspace.executionTaskId, workspace.runId, workspace.runtime.recovery.jobId,
    workspace.runtime.videoQuality?.mediaSha256, workspace.runtime.videoQuality?.qualityInputHash,
    workspace.runtime.videoQuality?.subtitleStatus, workspace.runtime.videoQuality?.timelineStatus,
    workspace.runtime.videoQuality?.samples,
    workspace.runtime.checkpoints.find(item => item.key === 'social.video_node_quality')?.inputHash]);
}

function QualityMedia({ scope, subject, frameSha256, label }: {
  scope: WeeklyTaskWorkspaceScope; subject: MediaSubject; frameSha256?: string; label: string;
}) {
  const [url, setUrl] = useState(''), [error, setError] = useState(''), [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); let active = true, objectUrl = '';
    void readWeeklyVideoQualityMedia(scope, { ...subject, ...(frameSha256 ? { frameSha256 } : {}) }, controller.signal)
      .then(blob => { if (!active) return; objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '当前检查媒体无法读取，请刷新重试。'); });
    return () => { active = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [scope.programId, scope.packageId, scope.packageVersion, scope.executionTaskId,
    subject.expectedJobId, subject.expectedRunId, subject.expectedMediaSha256, subject.expectedQualityInputHash, frameSha256]);
  return <div>
    <LsMediaStateFrame state={error ? 'error' : loaded ? 'ready' : 'loading'} label={error ? '当前检查媒体无法读取' : `正在读取${label}`} className="min-h-36 w-full rounded-lg border border-border bg-surface-2">
      {url && (frameSha256
        ? <LsProgressiveMedia src={url} alt={label} width="100%" className="max-h-80 w-full object-contain" preview={false} onLoad={() => setLoaded(true)} onError={() => setError('抽样图片无法显示，请刷新重试。')}/>
        : <video aria-label={label} src={url} controls playsInline preload="metadata" className="max-h-96 w-full object-contain" onLoadedMetadata={() => setLoaded(true)} onError={() => setError('当前成片无法播放，请刷新重试。')}/>)}
    </LsMediaStateFrame>
    {error && <Alert className="mt-2" type="warning" showIcon title={error}/>}
  </div>;
}

export default function WeeklyVideoQualityReview({ workspace }: { workspace: WeeklyTaskWorkspace }) {
  const quality = workspace.runtime.videoQuality;
  const [accepting, setAccepting] = useState(false), [acceptError, setAcceptError] = useState('');
  const [accepted, setAccepted] = useState(false), [preview, setPreview] = useState(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  if (!quality) return null;
  const jobId = workspace.runtime.recovery.jobId;
  const subject = jobId && workspace.runId ? { expectedJobId: jobId, expectedRunId: workspace.runId, expectedMediaSha256: quality.mediaSha256 } : null;
  const mediaSubject = subject && quality.qualityInputHash ? { ...subject, expectedQualityInputHash: quality.qualityInputHash } : null;
  const scope = { programId: workspace.programId, packageId: workspace.packageId, packageVersion: workspace.packageVersion, executionTaskId: workspace.executionTaskId };
  const allowAcceptance = quality.timelineStatus !== 'blocked'
    && (quality.subtitleStatus !== 'passed' || quality.timelineStatus === 'unknown') && subject;
  const observation = (value: boolean | null) => value === null ? '待确认' : value ? '通过' : '未通过';
  return <section aria-label="成片检查证据" className="rounded-lg border border-border p-3">
    <h5 className="text-xs font-semibold">成片检查需要处理</h5>
    <p className="mt-2 text-xs">字幕样式：{quality.subtitleStatus === 'passed' ? '抽检通过' : quality.subtitleStatus === 'blocked' ? '未通过，需要介入' : '证据不足，需要介入'} · 音画同步：{quality.timelineStatus === 'passed' ? '测量通过' : quality.timelineStatus === 'blocked' ? '超出容差，需要修复' : '缺少测量，需要介入'}</p>
    {!preview && mediaSubject && <Button className="mt-2" onClick={() => setPreview(true)}>查看当前成片与抽样</Button>}
    {preview && mediaSubject && <div className="mt-3"><QualityMedia scope={scope} subject={mediaSubject} label="当前待检查成片"/></div>}
    {!mediaSubject && <p className="mt-2 text-xs text-text-secondary">当前缺少可核验的成片预览身份，请刷新任务详情。</p>}
    {quality.samples.length === 0 && <p className="mt-2 text-xs text-text-secondary">当前没有可核验的字幕抽样图片。</p>}
    <div className="mt-2 grid gap-3 sm:grid-cols-2">{quality.samples.map((sample, index) => <div key={`${index}:${sample.atSeconds}`}>
      <p className="text-xs text-text-secondary">抽帧 {index + 1} · {sample.atSeconds.toFixed(2)} 秒 · {sample.subtitlePresent === true ? '有字幕' : sample.subtitlePresent === false ? '无字幕' : '字幕待确认'} · 字体 {observation(sample.font)} · 字号 {observation(sample.fontSize)} · 颜色 {observation(sample.color)}</p>
      {preview && mediaSubject && (sample.frameSha256
        ? <div className="mt-2"><QualityMedia scope={scope} subject={mediaSubject} key={sample.frameSha256} frameSha256={sample.frameSha256} label={`字幕抽样 ${index + 1}，${sample.atSeconds.toFixed(2)} 秒`}/></div>
        : <p className="mt-1 text-xs text-text-secondary">此抽样缺少可读取的图片凭据。</p>)}
    </div>)}</div>
    <p className="mt-2 text-xs text-text-secondary">以上是当前成片的检查记录，不代表用户已验收。</p>
    {quality.subtitleStatus === 'blocked' && quality.timelineStatus !== 'blocked' && <p className="mt-2 text-xs text-text-secondary">请验看当前成片。确认即表示接受当前字幕样式问题；音画同步未测项也需由你验看。</p>}
    {acceptError && <Alert className="mt-2" type="warning" showIcon title={acceptError}/>}
    {accepted && allowAcceptance ? <Tag className="mt-2" color="processing">已接受当前偏差，原任务正在恢复</Tag> : allowAcceptance && <Button className="mt-2" type="primary" loading={accepting} onClick={() => {
      setAccepting(true); setAcceptError('');
      void acceptWeeklyUnknownVideoQuality(scope, { ...subject!, ...(quality.subtitleStatus === 'blocked' ? { confirmSubtitleStyle: true as const } : {}) })
        .then(() => { if (active.current) setAccepted(true); })
        .catch(cause => { if (active.current) setAcceptError(cause instanceof Error ? cause.message : '接受当前偏差失败。'); })
        .finally(() => { if (active.current) setAccepting(false); });
    }}>{quality.subtitleStatus === 'blocked' ? '确认字幕样式偏差并继续' : '接受当前偏差并继续'}</Button>}
  </section>;
}
