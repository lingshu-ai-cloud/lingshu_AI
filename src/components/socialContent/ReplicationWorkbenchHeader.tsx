import type { ReactNode } from 'react';
import { Input } from 'antd';
import { PencilLine } from 'lucide-react';

/** Stable draft identity and actions shared by every content-production stage. */
export default function ReplicationWorkbenchHeader({ title, subtitle, actions, compact = false, showTaskIdentity = true, editableTitle = false, onTitleChange, onTitleCommit, titleStatus = 'idle' }: {
  /** Kept for caller compatibility; production-stage navigation belongs in the body/footer. */
  activeStep: number;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  onStepChange?: (step: number) => void;
  navigationDisabled?: boolean;
  stepLabels?: readonly string[];
  compact?: boolean;
  showTaskIdentity?: boolean;
  editableTitle?: boolean;
  onTitleChange?: (title: string) => void;
  onTitleCommit?: () => void;
  titleStatus?: 'idle' | 'saving' | 'saved' | 'error';
}) {
  return <header className={`flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-white px-5 ${compact ? 'min-h-16 py-2' : 'min-h-[72px] py-3'}`}>
    <div className="min-w-0 flex-1">
      {showTaskIdentity && (editableTitle
        ? <div className="max-w-xl">
            <h1 className="sr-only">草稿名称</h1>
            <Input
              aria-label="草稿名称"
              value={title || ''}
              maxLength={120}
              variant="outlined"
              placeholder="请输入草稿名称"
              onChange={event => onTitleChange?.(event.target.value)}
              onBlur={onTitleCommit}
              onPressEnter={event => event.currentTarget.blur()}
              suffix={<PencilLine size={16} aria-hidden="true" className="text-text-muted" />}
              className="ls-replication-draft-title min-h-11 rounded-lg border-border bg-white px-3 text-text-primary"
            />
            {subtitle && <p className="truncate text-[10px] text-text-muted">{subtitle}</p>}
            {titleStatus !== 'idle' && <p aria-live="polite" className={`mt-1 text-[11px] ${titleStatus === 'error' ? 'text-red-600' : 'text-text-muted'}`}>{titleStatus === 'saving' ? '正在保存草稿名称…' : titleStatus === 'saved' ? '草稿名称已保存' : '草稿名称保存失败，请重试'}</p>}
          </div>
        : <div className="max-w-xl"><h1 className="truncate text-xl font-semibold text-text-primary">{title || '未命名草稿'}</h1>{subtitle && <p className="mt-1 truncate text-[10px] text-text-muted">{subtitle}</p>}</div>)}
    </div>
    {actions && <div className="replication-workbench-header-actions flex shrink-0 flex-nowrap items-center gap-2">{actions}</div>}
  </header>;
}
