import { useCallback, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, RefreshCcw } from 'lucide-react';
import type { Page } from '../../App';
import type {
  RegisterSocialPublicationInput,
  SocialContentArtifact,
  SocialContentThemeId,
  SubmitSocialMetricsInput,
} from '../../../shared/contracts/socialContentWorkflow';
import { attachSocialContentNavigationState } from '../../lib/socialContentContext';
import { socialContentCanRegisterPublication, type SocialContentCreationPath, type SocialContentDraft, type SocialContentMaterialInput } from '../../lib/socialContentModel';
import { ArtifactBatchChangesDialog, ArtifactChangesDialog, MetricsDialog, PublicationDialog } from './SocialTaskActionDialogs';
import SocialTaskOverview from './SocialTaskOverview';
import SocialManagedExecutionNotice from './SocialManagedExecutionNotice';
import { useSocialContentWorkspace } from './useSocialContentWorkspace';

export interface SocialContentSourceContext {
  originLabel: string;
  referenceTitle: string;
  referenceThumbnail?: string;
  referenceMediaUrl?: string;
  referenceContentType?: 'video' | 'image';
  referenceShots?: Array<{ time: string; dialogue?: string; subtitle?: string; visual?: string; firstFrameRef?: string; firstFrameSeconds?: number }>;
}

export interface SocialContentCreateRequest {
  requestId: number;
  themeId: SocialContentThemeId | '';
  mode?: 'instant' | 'weekly';
  creationPath?: SocialContentCreationPath;
  materialInput?: SocialContentMaterialInput;
  managedMode?: 'one_click_managed';
  prefill?: Partial<Pick<SocialContentDraft, 'title' | 'topic' | 'productId' | 'productName' | 'referenceLinks' | 'platforms'>>;
  sourceContext?: SocialContentSourceContext;
  continueTaskId?: string;
  continueProjectId?: string;
  replicationStep?: 1 | 2 | 3;
  confirmedSpeech?: Array<{ source: string; draft: string; time: string }>;
  presenterAssetId?: string;
  specialRequirements?: string;
  identityMappings?: {
    selectedProductIds?: string[];
    selectedProductNames?: string[];
    products: Array<{ sourceTerm: string; productId: string; productName: string }>;
    brand?: { sourceTerm: string; brandName: string };
  };
}

export default function SocialContentWorkspace({
  onNavigate,
  onNavigateWithTask,
  onRequestCreate,
}: {
  onNavigate: (page: Page) => void;
  onNavigateWithTask?: (page: Page, taskId: string) => void;
  onRequestCreate?: () => void;
}) {
  const state = useSocialContentWorkspace();
  const [publicationOpen, setPublicationOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [changeArtifact, setChangeArtifact] = useState<SocialContentArtifact | null>(null);
  const [batchChangesOpen, setBatchChangesOpen] = useState(false);
  const task = state.workspace?.currentTask || null;
  const reviewBlocked = state.errorCode === 'social_content_execution_director_review_required';
  const factsBlocked = state.errorCode === 'social_content_execution_facts_required';

  const openDirectorReview = useCallback(() => {
    const panel = document.querySelector<HTMLElement>('[data-social-agent-workflow]');
    panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    panel?.querySelector<HTMLDetailsElement>('details')?.setAttribute('open', '');
  }, []);

  const openNewTask = useCallback(() => {
    if (onRequestCreate) {
      onRequestCreate();
      return;
    }
    window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: {
      page: 'smartAssets', view: 'create', studioEntry: true,
      contentCreationRequest: { requestId: Date.now(), themeId: 'product_value', mode: 'instant', creationPath: 'material_processing', materialInput: 'none', managedMode: 'one_click_managed' } satisfies SocialContentCreateRequest,
    } }));
  }, [onRequestCreate]);

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
      {(state.error || state.notice) && <div role={state.error ? 'alert' : 'status'} className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs font-semibold ${state.error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}><span className="flex items-center gap-2">{state.error ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}{state.error || state.notice}</span><span className="flex items-center gap-2">{reviewBlocked && <button type="button" onClick={openDirectorReview} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[10px] font-black text-amber-900">查看编导待修改项</button>}{factsBlocked && <button type="button" onClick={() => onNavigate('enterprise')} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[10px] font-black text-amber-900">补充企业与产品事实</button>}{state.notice && <button type="button" onClick={state.dismissNotice} className="text-[10px] font-bold">关闭</button>}</span></div>}

      <h1 id="social-content-workspace-title" className="mb-4 text-lg font-bold text-text-primary">{task?.brief.title || '社媒内容任务'}</h1>

      <SocialManagedExecutionNotice task={task} />

      <SocialTaskOverview
        task={task}
        tasks={state.workspace.tasks}
        taskTotalItems={state.workspace.taskList.totalItems}
        hasMoreTasks={state.workspace.taskList.page < state.workspace.taskList.totalPages}
        loadingMoreTasks={state.loadingMoreTasks}
        busy={state.busy}
        onSelectTask={taskId => navigateWithTask('smartAssets', taskId)}
        onLoadMoreTasks={() => void state.loadMoreTasks()}
        onCreate={() => openNewTask()}
        onEdit={() => task && navigateWithTask('smartAssets', task.taskId)}
        onStart={() => task && navigateWithTask('smartAssets', task.taskId)}
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

      {publicationOpen && task && socialContentCanRegisterPublication(task) && <PublicationDialog task={task} busy={state.busy} onClose={() => { if (!state.busy) setPublicationOpen(false); }} onSubmit={submitPublication} />}
      {metricsOpen && task && <MetricsDialog task={task} busy={state.busy} onClose={() => { if (!state.busy) setMetricsOpen(false); }} onSubmit={submitMetrics} />}
      {changeArtifact && <ArtifactChangesDialog artifact={changeArtifact} busy={state.busy} onClose={() => { if (!state.busy) setChangeArtifact(null); }} onSubmit={async note => { await state.decideArtifact(changeArtifact, 'changes_requested', note); setChangeArtifact(null); }} />}
      {batchChangesOpen && task && <ArtifactBatchChangesDialog count={task.artifacts.filter(artifact => artifact.status === 'review_required').length} busy={state.busy} onClose={() => { if (!state.busy) setBatchChangesOpen(false); }} onSubmit={async note => { await state.decideArtifactBatch('changes_requested', note); setBatchChangesOpen(false); }} />}
    </section>
  );
}
