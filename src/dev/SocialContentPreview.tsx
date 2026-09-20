import { useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import type { SocialContentTaskDetail, SocialContentTaskSummary, SocialContentThemeId } from '../../shared/contracts/socialContentWorkflow';
import SocialContentLanding from '../components/socialContent/SocialContentLanding';
import SocialProductionProgressPanel from '../components/socialContent/SocialProductionProgressPanel';
import SocialTaskEditorDialog from '../components/socialContent/SocialTaskEditorDialog';

const previewTask = {
  taskId: 'preview-task',
  version: '1',
  status: 'producing',
  mode: 'instant',
  brief: {
    title: '面膜新品使用场景短视频', objective: '新品介绍', productRef: '补水修护面膜', audience: '美妆品牌采购负责人',
    markets: ['中国'], languages: ['简体中文'], platforms: ['douyin'], formats: ['short_video'], aspectRatio: '9:16',
    cadence: null, requestedOutputCount: 1, dueAt: null, brandNotes: null, restrictions: [], callToAction: '咨询打样',
  },
  packageSelection: [], readiness: { complete: true, missing: [] }, runId: 'preview-run',
  sourceCount: 2, knowledgeSourceCount: 1, materialSourceCount: 1, artifactCount: 0, approvedArtifactCount: 0,
  deliveryPackageCount: 0, publicationCount: 0, metricSubmissionCount: 0,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  sources: [], artifacts: [], deliveryPackages: [], publications: [], metricSubmissions: [],
} satisfies SocialContentTaskDetail;

const previewTaskSummary: SocialContentTaskSummary = {
  taskId: previewTask.taskId,
  brief: previewTask.brief,
  status: previewTask.status,
  version: previewTask.version,
  packageSelection: previewTask.packageSelection,
  readiness: previewTask.readiness,
  runId: previewTask.runId,
  sourceCount: previewTask.sourceCount,
  knowledgeSourceCount: previewTask.knowledgeSourceCount,
  materialSourceCount: previewTask.materialSourceCount,
  artifactCount: previewTask.artifactCount,
  approvedArtifactCount: previewTask.approvedArtifactCount,
  deliveryPackageCount: previewTask.deliveryPackageCount,
  publicationCount: previewTask.publicationCount,
  metricSubmissionCount: previewTask.metricSubmissionCount,
  createdAt: previewTask.createdAt,
  updatedAt: previewTask.updatedAt,
  mode: previewTask.mode,
};

const previewTasks: SocialContentTaskSummary[] = [
  previewTaskSummary,
  {
    ...previewTaskSummary,
    taskId: 'preview-review-task',
    status: 'asset_review',
    brief: { ...previewTask.brief, title: '工厂生产实力展示' },
    artifactCount: 2,
    approvedArtifactCount: 0,
    updatedAt: new Date(Date.now() - 15 * 60_000).toISOString(),
  },
  {
    ...previewTaskSummary,
    taskId: 'preview-complete-task',
    status: 'delivered',
    brief: { ...previewTask.brief, title: '面膜使用场景演示' },
    artifactCount: 1,
    approvedArtifactCount: 1,
    deliveryPackageCount: 1,
    updatedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
  },
];

export default function SocialContentPreview() {
  const [themeId, setThemeId] = useState<SocialContentThemeId | ''>('product_value');
  const [open, setOpen] = useState(false);
  const [sessionKey, setSessionKey] = useState('preview:0');

  const start = (nextThemeId: SocialContentThemeId | '') => {
    setThemeId(nextThemeId);
    setSessionKey(`preview:${Date.now()}`);
    setOpen(true);
  };

  return (
    <div className="min-h-screen bg-[#f6f8f5]">
      <main className="mx-auto max-w-[1440px] space-y-5 px-4 py-5 sm:px-8 sm:py-7">
        <SocialContentLanding onStart={start} />
        <SocialProductionProgressPanel task={previewTask} tasks={previewTasks} taskTotalItems={previewTasks.length} busy={false} onRefresh={() => undefined} onSelectTask={() => undefined} onStart={() => undefined} onEdit={() => undefined} onReview={() => undefined} />
        <section className="rounded-xl border border-dashed border-border-bright bg-white px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent"><Sparkles size={18} /></span><div><p className="text-sm font-black text-text-primary">还没有内容任务</p><p className="mt-1 text-xs text-text-muted">从上方选择主题，或从空白任务开始。</p></div></div>
            <button type="button" onClick={() => start('product_value')} className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2.5 text-xs font-black text-text-secondary transition hover:border-border-bright hover:bg-surface-2"><Plus size={14} />从空白创建</button>
          </div>
        </section>
      </main>
      <SocialTaskEditorDialog open={open} sessionKey={sessionKey} task={null} initialThemeId={themeId} initialMode="instant" lockMode catalog={[]} busy={false} onClose={() => setOpen(false)} onSubmit={async () => {}} />
    </div>
  );
}
