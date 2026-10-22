import { Button, Modal } from 'antd';
import { Film, FolderOpen, Plus } from 'lucide-react';

interface ExistingSourceDraftDialogProps {
  title: string;
  matchCount: number;
  poster: string;
  onResume: () => void;
  onCreate: () => void;
}

export default function ExistingSourceDraftDialog({ title, matchCount, poster, onResume, onCreate }: ExistingSourceDraftDialogProps) {
  return <Modal open title="发现已有草稿" width={640} footer={null} mask={{ closable: false }} closable={false} keyboard={false}>
    <ExistingSourceDraftDialogContent title={title} matchCount={matchCount} poster={poster} onResume={onResume} onCreate={onCreate} />
  </Modal>;
}

export function ExistingSourceDraftDialogContent({ title, matchCount, poster, onResume, onCreate }: ExistingSourceDraftDialogProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
      <div className="flex min-w-0 flex-col justify-center p-6">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-accent-glow text-accent">
          <FolderOpen size={20} />
        </div>
        <h2 id="existing-source-draft-title" className="text-base font-semibold text-text-primary">
          基于本素材已经生成过草稿了，是否要新建作品集？
        </h2>
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-text-muted">{title}</p>
        <p className="mt-2 text-[11px] text-text-muted">
          {matchCount > 1
            ? `检测到 ${matchCount} 条历史草稿，将优先继续最近更新的一条。`
            : '可以继续最近的草稿，也可以从当前素材重新创建。'}
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button type="primary" data-modal-initial-focus onClick={onResume}>
            <FolderOpen size={14} />继续编辑已有草稿
          </Button>
          <Button type="default" onClick={onCreate}>
            <Plus size={14} />新建作品集
          </Button>
        </div>
      </div>
      <div className="min-h-[180px] border-t border-border bg-surface-2 sm:min-h-[300px] sm:border-l sm:border-t-0">
        {poster ? (
          <img src={poster} alt="来源视频素材封面" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full min-h-[180px] items-center justify-center text-text-muted sm:min-h-[300px]">
            <Film size={34} className="opacity-35" />
          </div>
        )}
      </div>
    </div>
  );
}
