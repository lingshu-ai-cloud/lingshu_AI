import { createHash } from 'node:crypto';
import type {
  SocialContentAgentWorkflow,
  SocialReplicationEvaluation,
  SocialReplicationScriptVersion,
} from '../../shared/contracts/socialContentWorkflow.js';
import {
  evaluateReplication,
  type AccountProductFitCheck,
  type IdentityReplacementEvidence,
  type ReplicationFactorEvidence,
  type ReplicationEvaluationReport,
  type ReuseRiskEvidence,
} from '../lib/replicationEvaluation.js';

type AdapterEvidence = {
  factorEvidence?: ReplicationFactorEvidence[];
  identityEvidence?: IdentityReplacementEvidence[];
  reuseRiskEvidence?: ReuseRiskEvidence[];
  accountProductFitChecks?: AccountProductFitCheck[];
  referenceVideoPath?: string | null;
  referenceText?: string | null;
  outputText?: string | null;
};

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 20);

function contractStatus(status: ReplicationEvaluationReport['dimensions']['viralFactorFidelity']['status']) {
  if (status === 'pass') return 'passed' as const;
  if (status === 'fail') return 'failed' as const;
  if (status === 'not_applicable') return 'not_applicable' as const;
  return 'review_required' as const;
}

function dimension(
  report: ReplicationEvaluationReport,
  name: keyof ReplicationEvaluationReport['dimensions'],
): SocialReplicationEvaluation['viralFactorFidelity'] {
  const source = report.dimensions[name];
  const relatedIssues = [...report.blockers, ...report.reviewItems].filter(issue => (
    name === 'viralFactorFidelity' ? Boolean(issue.factorId || issue.referenceShotId)
      : name === 'identityReplacement' ? issue.code.includes('identity')
        : name === 'unauthorizedReuseRisk' || name === 'originalityDifference' ? issue.code.includes('reuse')
          : issue.code.includes('account') || issue.code.includes('product') || issue.code.includes('fit')
  ));
  return {
    status: contractStatus(source.status),
    score: source.score,
    blockingFactorIds: [...new Set(relatedIssues.flatMap(issue => issue.factorId ? [issue.factorId] : []))],
    evidenceRefs: [...new Set(relatedIssues.flatMap(issue => issue.evidenceId ? [issue.evidenceId] : []))],
    summary: source.findings.join('；') || `${source.checked}/${source.required} 项已获得可审计证据`,
  };
}

export async function evaluateSocialReplicationResult(input: {
  workflow: SocialContentAgentWorkflow;
  replicationScript: SocialReplicationScriptVersion | null;
  productionResultId: string;
  outputVideoPath: string;
  evidence?: AdapterEvidence;
  now?: Date;
}): Promise<{ evaluation: SocialReplicationEvaluation | null; report: ReplicationEvaluationReport | null }> {
  const job = input.workflow.replicationJob;
  if (!job) return { evaluation: null, report: null };
  const sceneByFactor = new Map<string, string>();
  for (const scene of input.workflow.directorBrief.scenes) {
    for (const factor of scene.replicationFactors ?? []) sceneByFactor.set(factor.factorId, scene.sceneId);
  }
  const factorSpecs = job.factorSpecs.map(factor => ({
    factorId: factor.factorId,
    sceneId: sceneByFactor.get(factor.factorId) || factor.beatId,
    referenceShotId: factor.referenceShotId,
    category: factor.category,
    description: factor.description,
    causalRole: factor.causalRole,
    policy: factor.policy,
    importance: factor.importance,
    expected: factor.target.value,
    tolerance: {
      min: factor.tolerance.minimum ?? undefined,
      max: factor.tolerance.maximum ?? undefined,
      maxAbsoluteDeviation: factor.tolerance.maximumDeviation ?? undefined,
    },
  }));
  const referenceTimeline = (input.replicationScript?.shots ?? []).map(shot => ({
    shotId: shot.referenceShotId || shot.shotId,
    startSeconds: shot.startSeconds,
    endSeconds: shot.endSeconds,
    purpose: shot.purpose,
  }));
  const outputTimeline = input.workflow.directorBrief.scenes.map(scene => ({
    shotId: scene.sceneId,
    referenceShotId: scene.referenceShotId,
    startSeconds: scene.duration.startSeconds,
    endSeconds: scene.duration.endSeconds,
    purpose: scene.purpose,
  }));
  const replacementFactors = job.factorSpecs.filter(factor => factor.policy === 'replace_identity');
  const identityRequirements = replacementFactors.map(factor => ({
    requirementId: factor.factorId,
    identityType: factor.category === 'identity' ? 'other' as const : 'other' as const,
    originalIdentity: String(factor.target.value ?? ''),
    expectedReplacement: job.target.productRef || job.target.accountRef?.id || null,
    sceneIds: [sceneByFactor.get(factor.factorId) || factor.beatId],
    required: factor.importance === 'critical' || factor.importance === 'high',
  }));
  const defaultFitChecks: AccountProductFitCheck[] = [
    {
      checkId: 'fact-source-binding', label: '导演方案绑定企业事实来源',
      outcome: input.workflow.directorBrief.factSourceRefs.length ? 'pass' : 'unknown', required: true,
      evidenceRefs: input.workflow.directorBrief.factSourceRefs,
      explanation: input.workflow.directorBrief.factSourceRefs.length ? '已绑定版本化事实来源' : '未发现事实来源引用',
    },
    {
      checkId: 'account-playbook-binding', label: '成片绑定目标账号 Playbook',
      outcome: job.target.accountPlaybookRef ? 'pass' : 'unknown', required: true,
      evidenceRefs: job.target.accountPlaybookRef ? [`account_playbook:${job.target.accountPlaybookRef.id}:${job.target.accountPlaybookRef.version}`] : [],
      explanation: job.target.accountPlaybookRef ? '使用冻结的账号规则版本' : '即时任务未绑定账号规则',
    },
  ];
  const report = await evaluateReplication({
    referenceTimeline,
    outputTimeline,
    factors: factorSpecs,
    factorEvidence: input.evidence?.factorEvidence ?? [],
    identityRequirements,
    identityEvidence: input.evidence?.identityEvidence ?? [],
    reuseRiskEvidence: input.evidence?.reuseRiskEvidence ?? [],
    accountProductFitChecks: input.evidence?.accountProductFitChecks ?? defaultFitChecks,
    media: {
      referenceVideoPath: input.evidence?.referenceVideoPath ?? null,
      outputVideoPath: input.outputVideoPath,
      referenceText: input.evidence?.referenceText ?? null,
      outputText: input.evidence?.outputText ?? null,
    },
  });
  const generatedAt = (input.now ?? new Date()).toISOString();
  const evaluationId = `replication_evaluation_${hash({ job: job.replicationJobId, result: input.productionResultId, generatedAt })}`;
  const status: SocialReplicationEvaluation['status'] = report.releaseDecision === 'pass'
    ? 'passed'
    : report.releaseDecision === 'blocked' ? 'failed' : 'review_required';
  const evaluation: SocialReplicationEvaluation = {
    evaluationId,
    version: '1',
    replicationJobId: job.replicationJobId,
    replicationJobVersion: job.version,
    factorSpecVersion: job.factorSpecVersion,
    productionResultId: input.productionResultId,
    attemptId: `attempt_${hash({ evaluationId, outputVideoPath: input.outputVideoPath })}`,
    status,
    viralFactorFidelity: dimension(report, 'viralFactorFidelity'),
    identityReplacement: dimension(report, 'identityReplacement'),
    originalityDifference: dimension(report, 'originalityDifference'),
    unauthorizedReuseRisk: dimension(report, 'unauthorizedReuseRisk'),
    accountAndFactFit: dimension(report, 'accountProductFit'),
    sceneResults: report.shotResults.map(shot => ({
      sceneId: shot.sceneId,
      factorResults: shot.issues.map(issue => ({
        factorId: issue.factorId || `timeline:${issue.code}`,
        status: issue.severity === 'blocker' ? 'failed' : 'review_required',
        measuredValue: null,
        evidenceRefs: issue.evidenceId ? [issue.evidenceId] : [],
        repairAction: issue.message,
      })),
    })),
    generatedBy: 'media_evaluation_worker',
    generatedAt,
    directorDecision: {
      status: 'pending', reviewedBy: 'director_agent', failedCriteria: report.blockers.map(issue => issue.message), reviewedAt: null,
    },
  };
  return { evaluation, report };
}
