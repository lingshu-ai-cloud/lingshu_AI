import { Modal } from 'antd';
import { Pause, Play } from 'lucide-react';
import type { Page } from '../../App';
import type { AssistantDecisionDeepLink, AssistantDecisionFeed } from '../../lib/assistantDecisionApi';
import type { AssistantProductionContext } from '../../lib/assistantProductionDecision';
import type { AssistantRunControl, AssistantTaskCard } from '../../stores/assistantStore';
import AssistantDecisionCenter, { type AssistantDecisionActionResult } from './AssistantDecisionCenter';

export type AssistantDecisionDialog =
  | { kind: 'feed' }
  | { kind: 'task'; taskId: string }
  | null;

export function taskStatusLabel(card: AssistantTaskCard) {
  if (card.status === 'needs_input') return '待补信息';
  if (card.status === 'approval') return '待确认';
  if (card.status === 'ready') return '可开始';
  if (card.status === 'running') return '执行中';
  if (card.status === 'paused') return '已暂停';
  if (card.status === 'failed') return '需要处理';
  return '已完成';
}

interface Props {
  decisionDialog: AssistantDecisionDialog;
  dialogTaskCard: AssistantTaskCard | null;
  focusedRunControl: AssistantRunControl | null;
  page: Page;
  goalId?: string;
  productionDecisionContext: AssistantProductionContext | null;
  persistenceScopeKey: string;
  loading: boolean;
  closeDecisionDialog: () => void;
  restoreDecisionDialogFocus: () => void;
  closeDecisionDialogForNavigation: (link?: AssistantDecisionDeepLink) => void;
  handleDecisionDialogFeedChange: (feed: AssistantDecisionFeed) => void;
  handleDecisionActionResult: (result: AssistantDecisionActionResult) => void;
  toggleTaskPaused: () => Promise<void>;
  handleTaskCardAction: (card: AssistantTaskCard, action: NonNullable<AssistantTaskCard['primaryAction']>) => Promise<void>;
}

export default function AssistantDecisionDialog({
  decisionDialog, dialogTaskCard, focusedRunControl, page, goalId,
  productionDecisionContext, persistenceScopeKey, loading,
  closeDecisionDialog, restoreDecisionDialogFocus, closeDecisionDialogForNavigation,
  handleDecisionDialogFeedChange, handleDecisionActionResult, toggleTaskPaused, handleTaskCardAction,
}: Props) {
  return (
      <Modal
        open={Boolean(decisionDialog)}
        title={decisionDialog?.kind === 'task' ? (dialogTaskCard?.title || '任务详情') : '待你决定'}
        footer={null}
        width={640}
        centered
        destroyOnHidden
        getContainer={() => document.body}
        onCancel={closeDecisionDialog}
        afterClose={restoreDecisionDialogFocus}
        focusTriggerAfterClose={false}
        mask={{ closable: false }}
        className="ls-assistant-decision-dialog"
        styles={{ body: { maxHeight: 'min(70dvh, 680px)', overflowY: 'auto' } }}
      >
        <div
          data-global-assistant="decision-dialog"
          data-assistant-detail-kind={decisionDialog?.kind || undefined}
          data-assistant-surface="decision"
        >
          {decisionDialog?.kind === 'feed' ? (
            <AssistantDecisionCenter
              page={page}
              goalId={goalId}
              productionContext={productionDecisionContext}
              key={`${persistenceScopeKey}:${page}:${goalId || 'latest'}:dialog`}
              active
              onOpenChat={closeDecisionDialog}
              onNavigate={closeDecisionDialogForNavigation}
              onFeedChange={handleDecisionDialogFeedChange}
              onActionResult={handleDecisionActionResult}
              variant="detail"
              showHeading={false}
            />
          ) : dialogTaskCard ? (
            <article className="assistant-task-dialog-card rounded-lg border border-border bg-surface">
              <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
                <p className="ls-type-label-medium text-accent">灵小枢已整理</p>
                <div className="flex items-center gap-2">
                  <span className="ls-type-label-medium shrink-0 rounded-full border border-border bg-surface-2 px-2 py-1 text-text-secondary">
                    {taskStatusLabel(dialogTaskCard)}
                  </span>
                  {focusedRunControl && (
                    <button
                      type="button"
                      onClick={() => void toggleTaskPaused()}
                      disabled={loading}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-text-secondary hover:border-accent/40 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
                      title={focusedRunControl.actionId === 'resume_task' ? '继续当前任务' : '暂停当前任务'}
                      aria-label={focusedRunControl.actionId === 'resume_task' ? '继续当前任务' : '暂停当前任务'}
                    >
                      {focusedRunControl.actionId === 'resume_task' ? <Play size={15} /> : <Pause size={15} />}
                      <span className="ls-type-label-medium">{focusedRunControl.actionId === 'resume_task' ? '继续' : '暂停'}</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="px-5 py-4">
                <p className="ls-type-body-medium font-semibold text-text-primary">{dialogTaskCard.conclusion}</p>
                {dialogTaskCard.details.length > 0 && (
                  <ul className="mt-3 space-y-2 border-l-2 border-accent/30 pl-3">
                    {dialogTaskCard.details.map(detail => (
                      <li key={detail} className="ls-type-body-small text-text-secondary">{detail}</li>
                    ))}
                  </ul>
                )}

                {dialogTaskCard.items.length > 0 && (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="待调整视频">
                    {dialogTaskCard.items.map(item => (
                      <div key={item.id} className="flex min-w-0 gap-3 rounded-md border border-border bg-surface-2 p-2.5">
                        <div className="h-20 w-14 shrink-0 overflow-hidden rounded bg-surface-3">
                          {item.thumbnailUrl ? (
                            <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                          ) : (
                            <div className="ls-type-label-small flex h-full items-center justify-center px-1 text-center text-text-muted">暂无缩略图</div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="ls-type-label-medium line-clamp-2 text-text-primary">{item.title}</p>
                          {item.accountLabel && <p className="ls-type-body-small mt-1 truncate text-text-muted">{item.accountLabel}</p>}
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {item.transition && <span className="ls-type-label-small rounded bg-accent-glow px-1.5 py-0.5 text-accent">{item.transition}</span>}
                            {item.note && <span className="ls-type-label-small rounded bg-surface px-1.5 py-0.5 text-text-secondary">{item.note}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {(dialogTaskCard.primaryAction || dialogTaskCard.secondaryActions.length > 0 || dialogTaskCard.workspace) && (
                <footer className="assistant-task-dialog-card__actions flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface px-5 py-3">
                  {dialogTaskCard.workspace && (
                    <a
                      href={dialogTaskCard.workspace.href}
                      onClick={() => closeDecisionDialogForNavigation()}
                      className="ls-type-label-medium mr-auto inline-flex min-h-10 items-center rounded-md border border-border bg-surface px-3 text-accent hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {dialogTaskCard.workspace.label}
                    </a>
                  )}
                  {dialogTaskCard.secondaryActions.map(action => (
                    <button
                      key={action.id}
                      type="button"
                      disabled={action.disabled || loading}
                      onClick={() => void handleTaskCardAction(dialogTaskCard, action)}
                      className="ls-type-label-medium min-h-10 rounded-md border border-border bg-surface px-3 text-text-secondary hover:border-accent/40 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {action.label}
                    </button>
                  ))}
                  {dialogTaskCard.primaryAction && (
                    <button
                      type="button"
                      disabled={dialogTaskCard.primaryAction.disabled || loading}
                      onClick={() => void handleTaskCardAction(dialogTaskCard, dialogTaskCard.primaryAction!)}
                      className="btn-primary ls-type-label-large min-h-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                    >
                      {dialogTaskCard.primaryAction.label}
                    </button>
                  )}
                </footer>
              )}
            </article>
          ) : decisionDialog?.kind === 'task' ? (
            <div className="ls-type-body-medium rounded-lg border border-border bg-surface-2 px-4 py-8 text-center text-text-secondary" role="status">
              任务状态已经更新，请关闭后查看最新概要。
            </div>
          ) : null}
        </div>
      </Modal>
  );
}
