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
  fieldsToConfirm: string[];
  repairRequest: string;
  imageUrl: string;
  qualityNeedsRepair: boolean;
  carouselPages: Array<{ unit: { jobId: string; label: string }; output?: SocialImageOutputNode }>;
  onDirectorReview: () => void;
  onDecision: (decision: 'approved' | 'rejected') => void;
  onLayerRepair: () => void;
  onConfirmFields: () => void;
  onTargetedRepair: () => void;
  onAbandonPlan: () => void;
}

export function SocialImageReviewActions(props: Props) {
  const { task, busy, legacyReadOnly, directorAccepted, hardChecksPassed, reviewCandidate, fieldsToConfirm,
    repairRequest, imageUrl, qualityNeedsRepair, carouselPages } = props;
  const multiOutput = task?.imageType === 'carousel' || task?.imageType === 'gif_poster';
  const adopted = Boolean(task?.approvedArtifact && task.status === 'approved');
  const canDecide = Boolean(!legacyReadOnly && !adopted && reviewCandidate);
  const directorReady = task?.productionRuntime?.nodes.find(node => node.nodeId === 'director_review')?.status === 'needs_review';
  const acceptanceReady = task?.productionRuntime?.nodes.find(node => node.nodeId === 'user_approval')?.status === 'needs_review';
  return <>
    {canDecide && !directorAccepted && <Button type="primary" block loading={busy}
      disabled={!hardChecksPassed || !directorReady} onClick={props.onDirectorReview}>提交编导复核</Button>}
    {canDecide && directorAccepted && <Button type="primary" block loading={busy}
      disabled={fieldsToConfirm.length > 0 || !hardChecksPassed || !reviewCandidate?.contentHash || !acceptanceReady}
      onClick={() => props.onDecision('approved')}>采用{multiOutput ? '整组作品' : '此版本'}</Button>}
    {canDecide && <Button block danger className="mt-2" loading={busy}
      onClick={() => props.onDecision('rejected')}>要求修改{multiOutput ? '整组作品' : ''}</Button>}
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
