import { useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import type { SocialContentTaskDetail, SocialContentTaskSummary } from '../../shared/contracts/socialContentWorkflow';
import SocialContentLanding from '../components/socialContent/SocialContentLanding';
import SocialProductionProgressPanel from '../components/socialContent/SocialProductionProgressPanel';

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
  const [message, setMessage] = useState('当前是交互预览，不会创建真实任务或调用模型。');
  const start = () => {
    setMessage('已模拟进入制作：正式工作台会保留任务来源、账号和预算，并打开内容制作默认页。');
    document.getElementById('preview-production-progress')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="min-h-screen bg-[#f6f8f5]">
      <main className="mx-auto max-w-[1440px] space-y-5 px-4 py-5 sm:px-8 sm:py-7">
        <p role="status" className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs font-bold text-sky-800">{message}</p>
        <SocialContentLanding onStart={start} />
        <div id="preview-production-progress"><SocialProductionProgressPanel task={previewTask} tasks={previewTasks} taskTotalItems={previewTasks.length} busy={false} onRefresh={() => setMessage('预览任务状态已刷新。')} onSelectTask={() => setMessage('已切换预览任务。')} onStart={start} onEdit={start} onReview={() => setMessage('已模拟进入成片验收；正式工作台会打开对应交付物。')} /></div>
        <section className="rounded-xl border border-dashed border-border-bright bg-white px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent"><Sparkles size={18} /></span><div><p className="text-sm font-black text-text-primary">还没有内容任务</p><p className="mt-1 text-xs text-text-muted">从上方选择素材加工或爆款裂变；没有素材也能开始。</p></div></div>
            <button type="button" onClick={start} className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2.5 text-xs font-black text-text-secondary transition hover:border-border-bright hover:bg-surface-2"><Plus size={14} />从空白创建</button>
          </div>
        </section>
      </main>
    </div>
  );
}
