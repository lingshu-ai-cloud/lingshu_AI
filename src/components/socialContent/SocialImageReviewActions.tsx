import { Alert, Button } from 'antd';
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
  qualityNeedsRepair: boolean;
  carouselPages: Array<{ unit: { jobId: string; label: string }; output?: SocialImageOutputNode }>;
  onDirectorReview: () => void;
  onDecision: (candidate: SocialImageOutputNode, decision: 'approved' | 'rejected') => void;
  onLayerRepair: () => void;
  onConfirmFields: () => void;
  onTargetedRepair: () => void;
  onAbandonPlan: () => void;
}

export function SocialImageReviewActions(props: Props) {
  const { task, busy, legacyReadOnly, directorAccepted, hardChecksPassed, reviewCandidate, fieldsToConfirm,
    repairRequest, imageUrl, qualityNeedsRepair, carouselPages, reviewOutputs } = props;
  const multiOutput = task?.imageType === 'carousel' || task?.imageType === 'gif_poster';
  const adopted = Boolean(task?.approvedArtifact && task.status === 'approved');
  const canDecide = Boolean(!legacyReadOnly && !adopted && reviewCandidate);
  const directorReady = task?.productionRuntime?.nodes.find(node => node.nodeId === 'director_review')?.status === 'needs_review';
  const acceptanceReady = task?.productionRuntime?.nodes.find(node => node.nodeId === 'user_approval')?.status === 'needs_review';
  const directorNeedsRepair = Boolean(task?.directorReviewDecision && task.directorReviewDecision.decision !== 'accept_for_user_review');
  return <>
    {canDecide && !directorAccepted && !directorNeedsRepair && <Button type="primary" block loading={busy}
      disabled={!hardChecksPassed || !directorReady} onClick={props.onDirectorReview}>提交编导复核</Button>}
    {canDecide && directorNeedsRepair && <Alert type="warning" showIcon
      message="编导复核要求定点修复"
      description={task?.directorReviewDecision?.repairInstructions.join('；') || '当前候选尚未满足爆点或差异化验收标准。'} />}
    {canDecide && directorAccepted && !multiOutput && <Button type="primary" block loading={busy}
      disabled={fieldsToConfirm.length > 0 || !hardChecksPassed || !reviewCandidate?.contentHash || !acceptanceReady}
      onClick={() => props.onDecision(reviewCandidate!, 'approved')}>采用此版本</Button>}
    {canDecide && !multiOutput && <Button block danger className="mt-2" loading={busy}
      onClick={() => props.onDecision(reviewCandidate!, 'rejected')}>要求修改</Button>}
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
    {!legacyReadOnly && !multiOutput && <Button block className="mt-2" loading={busy}
      disabled={!repairRequest.trim()} onClick={props.onLayerRepair}>按描述修改对应图层</Button>}
    {!legacyReadOnly && fieldsToConfirm.length > 0 && !task?.renderPlan && <Button block className="mt-2"
      onClick={props.onConfirmFields}>统一处理待补充信息</Button>}
    {!legacyReadOnly && !multiOutput && imageUrl && qualityNeedsRepair && <Button block className="mt-2"
      loading={busy} onClick={props.onTargetedRepair}>按检查结果优化一版</Button>}
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
