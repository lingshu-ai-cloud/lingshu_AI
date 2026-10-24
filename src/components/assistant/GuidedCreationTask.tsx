import { useEffect, useState } from 'react';
import { Alert, Button, Select, Spin } from 'antd';
import { socialContentApi } from '../../lib/socialContentApi';
import { socialContentStatusLabel } from '../../lib/socialContentModel';
import { productionNavigationIdentity } from '../../lib/productionNavigation';
import { useAssistantStore } from '../../stores/assistantStore';
import type { SocialContentTaskDetail } from '../../../shared/contracts/socialContentWorkflow';

/** Reads the original persistent task and its authenticated artifacts. Does not advance a task or synthesize progress. */
export default function GuidedCreationTask({ taskId, fingerprint }: { taskId: string; fingerprint: string }) {
  const [task, setTask] = useState<SocialContentTaskDetail | null>(null);
  const [error, setError] = useState('');
  const [artifactId, setArtifactId] = useState<string>();
  const [url, setUrl] = useState('');
  const [mediaError, setMediaError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); const identity = productionNavigationIdentity(); let timer: number;
    const current = () => !abort.signal.aborted && identity === productionNavigationIdentity() && useAssistantStore.getState().threads.business.creationDraft?.guided?.taskId === taskId;
    const poll = async () => {
      try {
        const value = await socialContentApi.getTask(taskId, abort.signal);
        if (!current()) return;
        if (value.brief.creationDialoguePlan?.guided?.fingerprint !== fingerprint) throw new Error('生产任务与当前创作方案不一致，未加载其他项目的成片。');
        setTask(value); setError('');
      } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : '任务状态暂不可读。'); }
      finally { if (current()) timer = window.setTimeout(poll, 5000); }
    };
    void poll();
    return () => { abort.abort(); window.clearTimeout(timer); };
  }, [taskId, fingerprint, revision]);
  const artifacts = task?.artifacts.filter(value => ['video', 'short_video'].includes(value.kind) && value.status !== 'superseded' && value.resourceRef?.startsWith('socialfile:')) || [];
  const selected = artifacts.find(value => value.artifactId === artifactId) || artifacts[0];
  useEffect(() => {
    if (!selected) return;
    const abort = new AbortController(); let objectUrl = ''; const identity = productionNavigationIdentity();
    setUrl(''); setMediaError('');
    void socialContentApi.fetchArtifactMedia(taskId, selected.artifactId, abort.signal).then(result => {
      if (abort.signal.aborted || identity !== productionNavigationIdentity() || useAssistantStore.getState().threads.business.creationDraft?.guided?.taskId !== taskId) return;
      if (!result.blob.type.startsWith('video/')) throw new Error('产物不是可播放视频。');
      objectUrl = URL.createObjectURL(result.blob); setUrl(objectUrl);
    }).catch(cause => { if (!abort.signal.aborted) setMediaError(cause instanceof Error ? cause.message : '真实成片暂时无法读取。'); });
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [taskId, selected?.artifactId, selected?.version]);
  return <section aria-label="自由创作生产任务" className="guided-creation__review">
    <strong>{task ? socialContentStatusLabel(task.status) : '读取真实任务状态'}</strong><small>任务：{taskId}</small>
    {error && <Alert type="warning" title={error} action={<Button onClick={() => setRevision(value => value + 1)}>重试查询</Button>}/>}
    {!task && !error && <Spin size="small"/>}
    {!selected && <p>预计完成时间：暂无法准确估时，等待真实排队和执行进度。完成后成片会显示在这里，也可在内容创作历史作品中查看。</p>}
    {task?.readiness.missing.length ? <Alert type="warning" title="原生产链路返回待补项" description={task.readiness.missing.join('；')}/> : null}
    {selected && <><Select aria-label="选择成片语言" value={selected.artifactId} options={artifacts.map(value => ({ value: value.artifactId, label: `${value.language || '默认语言'} · ${value.status === 'approved' ? '已验收' : '待验收'}` }))} onChange={setArtifactId}/>
      {url ? <video controls playsInline src={url} aria-label="本方案真实成片" className="w-full max-h-96"/> : <p>{mediaError || '正在校验并读取真实成片…'}</p>}
      {url && <a href={url} download={`自由创作-${selected.language || 'video'}.mp4`}>下载当前语言成片</a>}
    </>}
  </section>;
}
