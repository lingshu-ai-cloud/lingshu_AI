import { Alert, Button, Spin } from 'antd';
import type { SocialImageCreationTask } from '../../../shared/contracts/socialImageCreation';
import { ReviewImage } from './socialImageWorkbenchPresentation';

/** Display the original run's live state without duplicating its executor or claiming a queue receipt. */
export default function ImageReplicationRunSummary({ task, busy, error, notice, imageUrl, caption, onDetails, onShowCreations }: {
  task: SocialImageCreationTask | null; busy: boolean; error: string; notice: string;
  imageUrl: string; caption: string; onDetails: () => void; onShowCreations: () => void;
}) {
  return <section className="space-y-4 rounded-lg border border-border bg-surface p-4" aria-label="图文复刻任务进度" aria-live="polite">
    <strong className="block text-sm">{task?.status === 'approved' ? '图文已采用' : busy ? '正在制作图文' : imageUrl ? '图文首版待审阅' : '图文任务已保存'}</strong>
    {busy && <div role="status" className="flex items-center gap-2 text-sm"><Spin size="small"/>{notice || '正在核验素材并准备图片与配文'}</div>}
    {!busy && notice && <p className="whitespace-pre-wrap text-sm text-text-secondary">{notice}</p>}
    {error && <Alert type="warning" showIcon title="这一步需要处理" description={error}/>}
    {imageUrl && <div className="h-80 overflow-hidden rounded-lg border border-border"><ReviewImage src={imageUrl} alt="图文复刻首版"/></div>}
    {caption && <p dir="auto" className="whitespace-pre-wrap text-sm">{caption}</p>}
    <div className="flex flex-wrap gap-2"><Button type="primary" disabled={busy} onClick={onDetails}>{imageUrl ? '审阅图片与配文' : '查看任务详情'}</Button>
      <Button onClick={onShowCreations} disabled={busy}>我的创作</Button></div>
  </section>;
}
