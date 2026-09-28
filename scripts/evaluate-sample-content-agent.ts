/** Read-only trial of the real Content Agent planner against a saved Director review packet. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createSocialAssetSupplyPlan } from '../shared/socialContentAssetSupply.js';
import type { SocialContentTaskBrief, SocialReferenceVideoAnalysis, SocialShotFunction } from '../shared/contracts/socialContentWorkflow.js';
import { buildSocialAgentWorkflow } from '../server/starter198/socialContentAgentWorkflow.js';
import type { SocialReferenceReviewHandoff } from '../server/starter198/socialReferenceReviewHandoff.js';

const sourcePath = 'data/analysis-output/tiktok_7648939405557697806/review-handoff-snapshot.json';
const handoff = JSON.parse(readFileSync(sourcePath, 'utf8')) as SocialReferenceReviewHandoff;
const sourceShots = handoff.shots.filter(shot => shot.startSeconds !== null && shot.endSeconds !== null
  && shot.endSeconds - shot.startSeconds >= 0.2);
const purpose = (shot: typeof sourceShots[number]): SocialShotFunction => {
  if (shot.startSeconds! < 3) return 'hook';
  if (shot.startSeconds! >= 49.77) return 'call_to_action';
  if (/工厂|生产|检验|资质|合作|证据|信任/.test(`${shot.content} ${shot.purpose}`)) return 'proof';
  if (/涂抹|上妆|灌装|演示|展示/.test(`${shot.content} ${shot.purpose}`)) return 'demonstration';
  return 'value';
};
const referenceAnalysis: SocialReferenceVideoAnalysis = {
  analysisId: `sample-review-${handoff.versionHash}`,
  version: handoff.versionHash,
  referenceSourceId: handoff.referenceRecordId,
  referenceRecordId: handoff.referenceRecordId,
  status: 'blocked',
  durationSeconds: 63.72,
  coverage: { fullDurationSeconds: 63.72, precisionIntervals: [], gaps: [], overallConfidence: null, fullTimelineCovered: false },
  shots: sourceShots.map(shot => ({
    shotId: shot.shotId, startSeconds: shot.startSeconds!, endSeconds: shot.endSeconds!,
    visualDescription: shot.content, semanticLabel: { content: shot.content, intent: shot.purpose },
    spokenText: shot.originalSpeech, captionText: null, audioDescription: null, rhythmDescription: '',
    purpose: purpose(shot), fidelityPoints: [], mustDifferPoints: [],
    tags: { sceneTypes: [], subjects: [], subjectRelations: [], cameraLanguage: [], contentFunctions: [], soundTypes: [], onScreenInformation: [], truthRequirements: ['none'], suggestedProductionMethods: [] },
    materialEvidence: { sourceVideoRef: shot.evidence.sourceVideoRef, clipRef: shot.evidence.clipRef,
      firstFrameRef: shot.evidence.firstFrameRef, firstFrameSeconds: shot.startSeconds!,
      extractionStatus: shot.evidence.extractionStatus === 'ready' ? 'ready' : 'unavailable' },
  })),
  hookAnalysis: null,
  rightsNotice: 'reference_only',
  createdAt: new Date().toISOString(),
};
const brief: SocialContentTaskBrief = {
  title: '粉底液爆款复刻样片规划试验', objective: '评估内容 Agent 逐镜选路', productRef: null,
  audience: '美妆采购商', markets: ['US'], languages: ['en'], platforms: ['tiktok'], formats: ['short_video'],
  aspectRatio: '9:16', cadence: null, requestedOutputCount: 1, weeklyBudgetCny: 100,
  perItemBudgetCny: 100, retryReserveCny: 20, planningMode: 'auto_adjust', shootingWindowMinutes: 0,
  specialRequirements: null, dueAt: null, brandNotes: '', restrictions: [], callToAction: '咨询报价',
  creationMode: 'viral_replication', assetAvailability: 'none', managementMode: 'one_click_managed', productionMode: 'social_ready',
};
const assetSupplyPlan = createSocialAssetSupplyPlan({
  creationMode: 'viral_replication', planVersion: handoff.versionHash, confirmedFactRefs: [],
  shots: referenceAnalysis.shots.map(shot => ({ shotId: shot.shotId, function: shot.purpose,
    requestedDescription: `${shot.semanticLabel?.content}；表达目的：${shot.semanticLabel?.intent}` })),
});
const workflow = buildSocialAgentWorkflow({
  taskId: 'sample-content-agent-trial', taskVersion: handoff.versionHash, taskStatus: 'plan_review',
  mode: 'instant', weeklyPlanId: null, brief, sources: [], factSourceRefs: [],
  assetSupplyPlan, referenceAnalysis, replicationScript: null,
  referenceReviewHandoff: { productionExecutionAllowed: handoff.productionExecutionAllowed, versionHash: handoff.versionHash },
  materialCandidates: [],
});
const result = {
  schemaVersion: 'sample-content-agent-trial/1', sourceHandoffVersionHash: handoff.versionHash,
  sourceStatus: handoff.status, sourceIssueCount: handoff.issues.length,
  planStatus: workflow.executionPlan.status, planApproved: workflow.executionPlanReview.approved,
  failedCriteria: workflow.executionPlanReview.failedCriteria,
  scenes: workflow.executionPlan.scenes.map(scene => ({
    sceneId: scene.sceneId, routeDecision: scene.routeDecision, selectedSourceStrategy: scene.selectedSourceStrategy,
    recommendedCandidateIds: scene.recommendedCandidateIds, feasibility: scene.feasibility,
    candidates: scene.candidates.map(candidate => ({ candidateId: candidate.candidateId,
      kind: candidate.kind, sourceStrategy: candidate.sourceStrategy, label: candidate.label })),
  })),
};
const outputPath = 'docs/样片内容Agent规划实测.json';
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, sourceStatus: result.sourceStatus,
  planApproved: result.planApproved, sceneCount: result.scenes.length,
  withoutRecommendedCandidate: result.scenes.filter(scene => !scene.recommendedCandidateIds.length).length }));
