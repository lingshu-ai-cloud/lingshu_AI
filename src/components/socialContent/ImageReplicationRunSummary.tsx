import { Alert, Spin } from 'antd';
import type { SocialImageCreationTask } from '../../../shared/contracts/socialImageCreation';
import SocialImageVersionPreview from './SocialImageVersionPreview';

/** Display the original run's live state without duplicating its executor or claiming a queue receipt. */
export default function ImageReplicationRunSummary({ task, busy, error, notice, imageUrl, caption }: {
  task: SocialImageCreationTask | null; busy: boolean; error: string; notice: string;
  imageUrl: string; caption: string;
}) {
  return <section className="space-y-4 rounded-lg border border-border bg-surface p-4" aria-label="图文复刻任务进度" aria-live="polite">
    <strong className="block text-sm">{task?.status === 'approved' ? '图文已采用' : busy ? '正在制作图文' : imageUrl ? '图文首版待审阅' : '图文任务已保存'}</strong>
    {busy && <div role="status" className="flex items-center gap-2 text-sm"><Spin size="small"/>{notice || '正在核验素材并准备图片与配文'}</div>}
    {!busy && notice && <p className="whitespace-pre-wrap text-sm text-text-secondary">{notice}</p>}
    {error && <Alert type="warning" showIcon title="这一步需要处理" description={error}/>}
    {imageUrl && <SocialImageVersionPreview task={task} fallbackUrl={imageUrl} alt="图文复刻成片" className="h-80"/>}
    {caption && <p dir="auto" className="whitespace-pre-wrap text-sm">{caption}</p>}
  </section>;
}
