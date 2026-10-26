import { useState } from 'react';
import { Button, Modal } from 'antd';
import { ExternalLink, Play } from 'lucide-react';
import ContentVideoPreview from '../ContentVideoPreview';
import { LsMediaStateFrame } from '../ui/LsExperiencePrimitives';
import { replySourceLabel, replyVideoPreview, trustedReplyUrl, type ReplySource } from '../../lib/assistantSourceLinks';

export default function AssistantSourceLink({ url, label, sources }: { url: string; label?: string; sources?: ReplySource[] }) {
  const [open, setOpen] = useState(false);
  if (!trustedReplyUrl(url, sources)) return <>{label || url}</>;
  const title = label || replySourceLabel(url);
  const preview = replyVideoPreview(url);
  return <span className="inline-flex max-w-full flex-wrap items-center gap-1 align-middle">
    <Button size="small" href={url} target="_blank" rel="noopener noreferrer" icon={<ExternalLink size={13} />}
      aria-label={`打开原文：${title}`} title={url} style={{ maxWidth: '100%', height: 'auto', whiteSpace: 'normal', textAlign: 'left' }}>{title}</Button>
    {preview && <Button size="small" icon={<Play size={13} />} onClick={() => setOpen(true)} aria-label={`预览视频：${title}`}>视频预览</Button>}
    {open && preview && <Modal open title={title} onCancel={() => setOpen(false)} width={800} centered destroyOnHidden
      footer={<Button href={url} target="_blank" rel="noopener noreferrer" icon={<ExternalLink size={14} />}>打开原文</Button>}>
      <LsMediaStateFrame state="ready" className="overflow-hidden rounded-lg bg-surface-2">
        {preview.kind === 'video'
          ? <ContentVideoPreview src={preview.url} className="aspect-video max-h-[65vh] w-full object-contain" />
          : <iframe src={preview.url} title={`视频预览：${title}`} className="aspect-video max-h-[65vh] w-full border-0" allow="fullscreen; picture-in-picture" allowFullScreen referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-presentation" />}
      </LsMediaStateFrame>
      <p className="mt-3 text-xs text-text-muted">部分平台限制站内播放；无法预览时，可打开原文观看。</p>
    </Modal>}
  </span>;
}
