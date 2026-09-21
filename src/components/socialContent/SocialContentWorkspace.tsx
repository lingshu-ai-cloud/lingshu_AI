import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, RefreshCcw } from 'lucide-react';
import type { Page } from '../../App';
import type {
  RegisterSocialPublicationInput,
  SocialContentArtifact,
  SocialContentTaskDetail,
  SocialContentTaskMode,
  SocialContentThemeId,
  SubmitSocialMetricsInput,
} from '../../../shared/contracts/socialContentWorkflow';
import { attachSocialContentNavigationState } from '../../lib/socialContentContext';
import { socialContentCanRegisterPublication } from '../../lib/socialContentModel';
import { ArtifactBatchChangesDialog, ArtifactChangesDialog, MetricsDialog, PublicationDialog } from './SocialTaskActionDialogs';
import SocialTaskEditorDialog from './SocialTaskEditorDialog';
import SocialTaskOverview from './SocialTaskOverview';
import { useSocialContentWorkspace, type SocialContentSaveTarget } from './useSocialContentWorkspace';

interface EditorSession {
  task: SocialContentTaskDetail | null;
  target: SocialContentSaveTarget;
  initialThemeId?: SocialContentThemeId | '';
  initialMode?: SocialContentTaskMode;
  lockMode?: boolean;
}

export interface SocialContentCreateRequest {
  requestId: number;
  themeId: SocialContentThemeId | '';
  mode?: SocialContentTaskMode;
}

function editorAttemptId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `socialedit:${crypto.randomUUID()}`
    : `socialedit:${Date.now()}`;
}

export default function SocialContentWorkspace({
  onNavigate,
  onNavigateWithTask,
  defaultCreateMode,
  createRequest,
}: {
  onNavigate: (page: Page) => void;
  onNavigateWithTask?: (page: Page, taskId: string) => void;
  defaultCreateMode?: SocialContentTaskMode;
  createRequest?: SocialContentCreateRequest | null;
}) {
  const state = useSocialContentWorkspace();
  const [editor, setEditor] = useState<EditorSession | null>(null);
  const [publicationOpen, setPublicationOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [changeArtifact, setChangeArtifact] = useState<SocialContentArtifact | null>(null);
  const [batchChangesOpen, setBatchChangesOpen] = useState(false);
  const task = state.workspace?.currentTask || null;

  const openNewTask = useCallback((themeId?: SocialContentThemeId | '') => {
    setEditor({
      task: null,
      target: { mode: 'new', taskId: null, expectedVersion: null, attemptId: editorAttemptId() },
      initialThemeId: themeId,
      initialMode: defaultCreateMode,
      lockMode: Boolean(defaultCreateMode),
    });
  }, [defaultCreateMode]);

  useEffect(() => {
    if (!createRequest) return;
    setEditor({
      task: null,
      target: { mode: 'new', taskId: null, expectedVersion: null, attemptId: editorAttemptId() },
      initialThemeId: createRequest.themeId,
      initialMode: createRequest.mode || defaultCreateMode,
      lockMode: Boolean(createRequest.mode || defaultCreateMode),
    });
  }, [createRequest, defaultCreateMode]);

  const navigateWithTask = useCallback((page: Page, explicitTaskId?: string) => {
    const taskId = explicitTaskId || task?.taskId;
    if (taskId && onNavigateWithTask) {
      onNavigateWithTask(page, taskId);
      return;
    }
    onNavigate(page);
    if (taskId) attachSocialContentNavigationState(taskId, page);
  }, [onNavigate, onNavigateWithTask, task]);

  if (state.loading && !state.workspace) {
    return (
      <section className="rounded-2xl border border-border bg-white p-8 shadow-sm" aria-label="社媒内容任务">
        <div className="flex items-center justify-center gap-2 text-sm font-semibold text-text-muted"><Loader2 size={18} className="animate-spin text-emerald-600" />正在读取内容任务</div>
      </section>
    );
  }

  if (!state.workspace) {
    return (
      <section className="rounded-2xl border border-border bg-white p-6 shadow-sm" aria-label="社媒内容任务">
        <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><AlertCircle size={19} /></span><div><h2 className="text-sm font-black text-text-primary">内容任务暂时无法读取</h2><p className="mt-1 text-xs text-text-muted">请稍后重新加载。</p></div></div><button type="button" onClick={() => void state.refresh()} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold text-text-secondary hover:bg-surface-2"><RefreshCcw size={14} />重新加载</button></div>
      </section>
    );
  }

  const submitTask = async (draft: Parameters<typeof state.saveDraft>[0], files: File[], start: boolean) => {
    if (!editor) return;
    let progressBoardOpened = false;
    await state.saveDraft(draft, files, start, editor.target, nextTask => {
      if (start) {
        // The task exists from this point onward. Move to its progress board
        // while sources upload and queueing continue so a slow network request
        // never leaves the confirmation dialog looking frozen.
        if (!progressBoardOpened) {
          progressBoardOpened = true;
          setEditor(null);
        }
        return;
      }
      setEditor({
        task: nextTask,
        target: { mode: 'edit', taskId: nextTask.taskId, expectedVersion: nextTask.version, attemptId: editor.target.attemptId },
      });
    });
    setEditor(null);
    // Keep the user on the task after it starts. Script adaptation, voice-over,
    // subtitles and editing continue as one automated job; users return only
    // for task input or result review.
  };
  const submitPublication = async (input: RegisterSocialPublicationInput) => {
    await state.registerPublication(input);
    setPublicationOpen(false);
  };
  const submitMetrics = async (publicationId: string, input: SubmitSocialMetricsInput, files: File[]) => {
    await state.submitMetrics(publicationId, input, files);
    setMetricsOpen(false);
  };

  return (
    <section aria-labelledby="social-content-workspace-title">
      {(state.error || state.notice) && <div role={state.error ? 'alert' : 'status'} className={`mb-4 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs font-semibold ${state.error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}><span className="flex items-center gap-2">{state.error ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}{state.error || state.notice}</span>{state.notice && <button type="button" onClick={state.dismissNotice} className="text-[10px] font-bold">关闭</button>}</div>}

      <h1 id="social-content-workspace-title" className="sr-only">社媒内容任务</h1>

      <SocialTaskOverview
        task={task}
        tasks={state.workspace.tasks}
        taskTotalItems={state.workspace.taskList.totalItems}
        hasMoreTasks={state.workspace.taskList.page < state.workspace.taskList.totalPages}
        loadingMoreTasks={state.loadingMoreTasks}
        busy={state.busy}
        onSelectTask={state.selectTask}
        onLoadMoreTasks={() => void state.loadMoreTasks()}
        createMode={defaultCreateMode}
        onCreate={() => openNewTask()}
        onEdit={() => task && setEditor({ task, target: { mode: 'edit', taskId: task.taskId, expectedVersion: task.version, attemptId: editorAttemptId() }, initialMode: task.mode ?? defaultCreateMode, lockMode: true })}
        onStart={() => void state.startTask().catch(() => {})}
        onDownload={() => void state.downloadLatest().catch(() => {})}
        onOpenPublication={() => { if (task && socialContentCanRegisterPublication(task)) setPublicationOpen(true); }}
        onOpenMetrics={() => setMetricsOpen(true)}
        onArtifactDecision={(artifact, decision) => {
          if (decision === 'changes_requested') { setChangeArtifact(artifact); return; }
          void state.decideArtifact(artifact, decision).catch(() => {});
        }}
        onBatchDecision={decision => {
          if (decision === 'changes_requested') { setBatchChangesOpen(true); return; }
          void state.decideArtifactBatch('approved').catch(() => {});
        }}
        onCreateDeliveryPackage={() => void state.createDeliveryPackage().catch(() => {})}
        onRefresh={() => void state.refresh()}
        onNavigate={navigateWithTask}
      />

      <SocialTaskEditorDialog
        open={Boolean(editor)}
        sessionKey={editor?.target.attemptId || ''}
        task={editor?.task || null}
        initialThemeId={editor?.initialThemeId}
        initialMode={editor?.initialMode}
        lockMode={editor?.lockMode}
        catalog={state.workspace.catalog}
        busy={state.busy}
        onClose={() => { if (!state.busy) setEditor(null); }}
        onSubmit={submitTask}
      />
      {publicationOpen && task && socialContentCanRegisterPublication(task) && <PublicationDialog task={task} busy={state.busy} onClose={() => { if (!state.busy) setPublicationOpen(false); }} onSubmit={submitPublication} />}
      {metricsOpen && task && <MetricsDialog task={task} busy={state.busy} onClose={() => { if (!state.busy) setMetricsOpen(false); }} onSubmit={submitMetrics} />}
      {changeArtifact && <ArtifactChangesDialog artifact={changeArtifact} busy={state.busy} onClose={() => { if (!state.busy) setChangeArtifact(null); }} onSubmit={async note => { await state.decideArtifact(changeArtifact, 'changes_requested', note); setChangeArtifact(null); }} />}
      {batchChangesOpen && task && <ArtifactBatchChangesDialog count={task.artifacts.filter(artifact => artifact.status === 'review_required').length} busy={state.busy} onClose={() => { if (!state.busy) setBatchChangesOpen(false); }} onSubmit={async note => { await state.decideArtifactBatch('changes_requested', note); setBatchChangesOpen(false); }} />}
    </section>
  );
}
