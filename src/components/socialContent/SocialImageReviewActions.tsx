import { Button } from 'antd';
import { CheckCircle2 } from 'lucide-react';
import type { SocialImageCreationTask, SocialImageOutputNode } from '../../../shared/contracts/socialImageCreation';

interface Props {
  task: SocialImageCreationTask | null;
  busy: boolean;
  legacyReadOnly: boolean;
  directorAccepted: boolean;
  hardChecksPassed: boolean;
  reviewCandidate?: SocialImageOutputNode;
  reviewOutputs: SocialImageOutputNode[];
  fieldsToConfirm: string[];
  repairRequest: string;
  imageUrl: string;
  carouselPages: Array<{ unit: { jobId: string; label: string }; output?: SocialImageOutputNode }>;
  onDecision: (candidate: SocialImageOutputNode, decision: 'approved' | 'rejected') => void;
  onSubmitRevision: () => void;
  onHumanAccept: (candidate: SocialImageOutputNode) => void;
  onConfirmFields: () => void;
  onAbandonPlan: () => void;
}

export function SocialImageReviewActions(props: Props) {
  const { task, busy, legacyReadOnly, directorAccepted, hardChecksPassed, reviewCandidate, fieldsToConfirm,
    repairRequest, imageUrl, carouselPages, reviewOutputs } = props;
  const multiOutput = task?.imageType === 'carousel' || task?.imageType === 'gif_poster';
  const adopted = Boolean(task?.approvedArtifact && task.status === 'approved');
  const canDecide = Boolean(!legacyReadOnly && !adopted && reviewCandidate);
  const acceptanceReady = task?.productionRuntime?.nodes.find(node => node.nodeId === 'user_approval')?.status === 'needs_review';
  return <>
    {canDecide && !multiOutput && task?.schemaVersion === 'social-image-creation.v3' && <Button type="primary" block loading={busy}
      disabled={fieldsToConfirm.length > 0 || !reviewCandidate?.contentHash || !['file_decode', 'pixel_dimensions'].every(key =>
        reviewCandidate.qualityChecks.some(check => check.key === key && check.verdict === 'pass' && check.checker === 'deterministic'))}
      onClick={() => props.onHumanAccept(reviewCandidate!)}>人工确认质量并采用</Button>}
    {canDecide && !multiOutput && <Button block className="mt-2" loading={busy} disabled={!repairRequest.trim()}
      onClick={props.onSubmitRevision}>提交一版</Button>}
    {canDecide && directorAccepted && multiOutput && <section className="mt-2 space-y-2" aria-label="逐项验收">
      <p className="text-xs text-text-secondary">已采用 {reviewOutputs.filter(output => output.state === 'approved').length}/{reviewOutputs.length} 项；全部采用后才会生成整包交付。</p>
      {reviewOutputs.map(output => <div key={`${output.id}:${output.version}`} className="rounded-lg border border-border bg-surface-2 p-2">
        <div className="flex items-center justify-between gap-2 text-xs"><span className="font-medium text-text-primary">{output.label}</span>
          <span className={output.state === 'approved' ? 'text-success' : 'text-text-muted'}>{output.state === 'approved' ? '已采用' : '待验收'}</span></div>
        {output.state !== 'approved' && <div className="mt-2 grid grid-cols-2 gap-2">
          <Button size="small" danger loading={busy} onClick={() => props.onDecision(output, 'rejected')}>要求修改</Button>
          <Button size="small" type="primary" loading={busy}
            disabled={fieldsToConfirm.length > 0 || !hardChecksPassed || !output.contentHash || !acceptanceReady}
            onClick={() => props.onDecision(output, 'approved')}>采用此项</Button>
        </div>}
      </div>)}
    </section>}
    {!legacyReadOnly && fieldsToConfirm.length > 0 && !task?.renderPlan && <Button block className="mt-2"
      onClick={props.onConfirmFields}>统一处理待补充信息</Button>}
    {task?.imageType === 'carousel' ? carouselPages.map(({ unit, output }) => adopted && output?.mediaUrl
      ? <Button key={unit.jobId} block className="mt-2" href={output.mediaUrl} target="_blank"
        icon={<CheckCircle2 size={15} />}>下载{unit.label}</Button> : null)
      : adopted && imageUrl ? <Button block className="mt-2" href={imageUrl} target="_blank"
        icon={<CheckCircle2 size={15} />}>下载{task?.imageType === 'gif_poster' ? 'GIF 成片' : '成片'}</Button> : null}
    {!legacyReadOnly && multiOutput && task?.renderPlan && <Button block danger className="mt-3"
      disabled={busy || task.generationJobs.some(job => ['running', 'outcome_unknown'].includes(job.status)
        && !job.outputNodeIds.length)} onClick={props.onAbandonPlan}>废弃计划并重新策划</Button>}
  </>;
}
