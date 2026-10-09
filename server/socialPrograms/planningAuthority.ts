import {selectWeeklyPlanningCoverage,assertWeeklyPlanningCoverage,assertWeeklyDetailedCoverage,type WeeklyDirectorSlotGap} from './weeklyPlanningCoverage.js';
import {SocialContentWorkflowError} from '../starter198/socialContentValidation.js';
import {readWeeklyTemplateStructure} from './weeklyTemplateStructure.js';
import { createCustomerFeedbackTopicService } from './customerFeedbackTopics.js';
import { latestMaterialEvidenceConfiguration } from './materialEvidenceConfiguration.js';
import { classifyMaterialEvidence } from './materialEvidenceClassification.js';
import { createHash, randomUUID } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import type {
  VersionedSocialRef,
  WeeklyAgentPlanningState,
  WeeklyBusinessContentDispatch,
  WeeklyDirectorPlanningAnalysis,
  WeeklyOperatingPackage,
  WeeklyOperatingScheduleSkeleton,
} from '../../shared/contracts/socialProgram.js';
import { listSocialDiscoverySupply } from '../socialDiscovery/supply.js';
import { ownedReferenceSupply } from './ownedReferenceSupply.js';
import { diagnoseOwnedReference,ownedDiagnosisReady } from './ownedReferenceDiagnosis.js';
import { allocateWeeklyReferenceSources } from './weeklyReferenceSources.js';
import { socialJson, socialRequestHash } from '../starter198/socialContentValidation.js';
import type { SocialInspirationHandoff } from '../../shared/contracts/socialContentWorkflow.js';
import { acquireDurableOperationLease, assertDurableOperationLease, releaseDurableOperationLease, DurableOperationLeaseError } from '../runtime/durableLease.js';
import { SocialProgramError } from './service.js';

export const WEEKLY_AGENT_PLANNING = 'social_weekly_agent_planning';

type PlanningRow = {
  id: string;
  tenant_id: string;
  program_id: string;
  package_id: string;
  package_version: number;
  planning_version: number;
  payload: WeeklyAgentPlanningState;
  created_at: string;
};

function stableId(prefix: string, value: unknown): string {
  return `${prefix}_${createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 20)}`;
}

function minutes(value: number): number {
  return Math.max(30, Math.min(24 * 60, Math.round(Number(value) || 180)));
}

export function buildWeeklyOperatingScheduleSkeleton(pkg: WeeklyOperatingPackage): WeeklyOperatingScheduleSkeleton {
  const byMother = new Map<string, typeof pkg.socialContentPackage.publicationTasks>();
  for (const item of pkg.socialContentPackage.publicationTasks) {
    byMother.set(item.motherContentId, [...(byMother.get(item.motherContentId) ?? []), item]);
  }
  const createdAt = pkg.createdAt;
  const sourceAllocation = allocateWeeklyReferenceSources(pkg.socialContentPackage.publicationTasks, pkg.referenceSourcePolicy);
  return {
    skeletonId: stableId('weekly_skeleton', { packageId: pkg.packageId, version: pkg.version }),
    packageId: pkg.packageId,
    packageVersion: pkg.version,
    generatedBy: 'business_agent',
    tokenCost: 0,
    slots: [...byMother.entries()].map(([motherContentId, tasks]) => ({
      ...(pkg.referenceSourcePolicy ? { referenceSource: sourceAllocation.get(motherContentId) as 'owned' | 'external' } : {}),
      slotId: stableId('weekly_slot', { packageId: pkg.packageId, version: pkg.version, motherContentId }),
      motherContentId,
      publicationTaskIds: tasks.map(item => item.publicationTaskId),
      accountIds: [...new Set(tasks.map(item => item.accountId))],
      platforms: [...new Set(tasks.map(item => item.platform))],
      plannedPublishWindows: [...new Set(tasks.map(item => item.publishWindow).filter((value): value is string => Boolean(value)))],
      objective: pkg.objective,
      quantity: tasks.length,
    })),
    createdAt,
  };
}

async function latest(dataStore: DataStore, tenantId: string, programId: string, packageId: string, packageVersion: number): Promise<PlanningRow | null> {
  return (await dataStore.list<PlanningRow>(WEEKLY_AGENT_PLANNING, {
    where: { tenant_id: tenantId, program_id: programId, package_id: packageId, package_version: packageVersion },
    sort: '-planning_version', page: 1, perPage: 1,
  })).items[0] ?? null;
}

async function append(dataStore: DataStore, tenantId: string, state: WeeklyAgentPlanningState): Promise<WeeklyAgentPlanningState> {
  const id = createHash('sha256').update(JSON.stringify([tenantId, state.programId, state.packageId, state.packageVersion, state.version])).digest('hex').slice(0, 15);
  let saved: PlanningRow | null;
  try {
    saved = await dataStore.create<PlanningRow>(WEEKLY_AGENT_PLANNING, {
      id,
      tenant_id: tenantId,
      program_id: state.programId,
      package_id: state.packageId,
      package_version: state.packageVersion,
      planning_version: state.version,
      payload: state,
      created_at: state.updatedAt,
    });
  } catch (error) {
    const winner = await dataStore.getById<PlanningRow>(WEEKLY_AGENT_PLANNING, id);
    if (winner) throw new SocialProgramError('weekly_agent_planning_version_conflict', 409, '本周计划已更新，请刷新后重试；已有计划已保留。');
    throw error;
  }
  if (!saved) {
    const winner = await dataStore.getById<PlanningRow>(WEEKLY_AGENT_PLANNING, id);
    if (winner) throw new SocialProgramError('weekly_agent_planning_version_conflict', 409, '本周计划已更新，请刷新后重试；已有计划已保留。');
    throw new SocialProgramError('weekly_agent_planning_storage_unavailable', 503, 'Agent 计划状态暂时无法保存。');
  }
  return state;
}

function requirePlanningVersion(current: WeeklyAgentPlanningState, expected: number | undefined): void {
  if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 1) {
    throw new SocialProgramError('weekly_agent_planning_version_required', 400, '请提供有效的 Agent 规划版本。');
  }
  if (current.version !== expected) {
    throw new SocialProgramError('weekly_agent_planning_version_conflict', 409, '本周计划已更新，请从后端刷新后重试；已有计划已保留。');
  }
}

function requireEditablePlanning(current: WeeklyAgentPlanningState): void {
  if (current.status === 'confirmed' || current.status === 'dispatched') {
    throw new SocialProgramError('weekly_agent_plan_already_confirmed', 409, '本周计划已确认或已派单，不能重写分析和排期；请创建新的周任务包修订并重新确认。');
  }
}

function unguardedPlanningAuthority(dataStore: DataStore, beforeAppend: () => Promise<void> = async () => undefined) {
  const guardedAppend = async (tenantId: string, state: WeeklyAgentPlanningState) => {
    await beforeAppend();
    return append(dataStore, tenantId, state);
  };
  return {
    async initialize(tenantId: string, pkg: WeeklyOperatingPackage): Promise<WeeklyAgentPlanningState> {
      const existing = await latest(dataStore, tenantId, pkg.programId, pkg.packageId, pkg.version);
      if (existing) return existing.payload;
      const skeleton = buildWeeklyOperatingScheduleSkeleton(pkg);
      const state: WeeklyAgentPlanningState = {
        planningId: stableId('weekly_agent_planning', { packageId: pkg.packageId, version: pkg.version }),
        version: 1,
        programId: pkg.programId,
        packageId: pkg.packageId,
        packageVersion: pkg.version,
        status: 'outline_ready',
        skeleton,
        referenceSourcePolicy: pkg.referenceSourcePolicy ?? null,
        directorAnalyses: [],
        detailedSchedule: null,
        userConfirmation: null,
        dispatch: null,
        createdAt: pkg.createdAt,
        updatedAt: pkg.createdAt,
      };
      return guardedAppend(tenantId, state);
    },

    async get(tenantId: string, programId: string, packageId: string, packageVersion: number): Promise<WeeklyAgentPlanningState> {
      const row = await latest(dataStore, tenantId, programId, packageId, packageVersion);
      if (!row) throw new SocialProgramError('weekly_agent_planning_not_found', 404, 'Agent 计划状态不存在。');
      return row.payload;
    },

    async runDirectorAnalysis(input: {
      tenantId: string;
      programId: string;
      packageId: string;
      packageVersion: number;
      expectedPlanningVersion: number;
      actor: 'director_agent';
      selectedSlotIds?:string[];
      now?: Date;
    }): Promise<WeeklyAgentPlanningState> {
      if (input.actor !== 'director_agent') throw new SocialProgramError('director_analysis_authority_required', 403, '只有编导 Agent 可以写入对标分析。');
      const current = await this.get(input.tenantId, input.programId, input.packageId, input.packageVersion);
      requirePlanningVersion(current, input.expectedPlanningVersion);
      requireEditablePlanning(current);
      const analysisCoverage=selectWeeklyPlanningCoverage(current,input.selectedSlotIds);
      const analysisSlots=current.skeleton.slots.filter(slot=>analysisCoverage.selectedSlotIds.includes(slot.slotId));
      const [videos, accounts] = await Promise.all([
        listSocialDiscoverySupply({ tenantId: input.tenantId, dataStore, filters: { candidateType: 'video', decision: 'accepted', businessModel: 'b2b', sort: 'score', perPage: 100 } }),
        listSocialDiscoverySupply({ tenantId: input.tenantId, dataStore, filters: { candidateType: 'account', decision: 'accepted', businessModel: 'b2b', sort: 'score', perPage: 100 } }),
      ]);
      if (!videos.items.length&&!input.selectedSlotIds) {
        throw new SocialProgramError('qualified_benchmark_supply_required', 409, '详细计划需要已通过服务端评分的 B2B 对标账号和爆款视频。');
      }
      const ownedPairs = await ownedReferenceSupply(dataStore, input.tenantId, input.programId, videos.items, input.now);
      const ownedIds = new Set(ownedPairs.map(pair => pair.video.candidateId));
      const pairs = videos.items.filter(video => !ownedIds.has(video.candidateId)).flatMap(video => {
        const account = accounts.items.find(candidate => Array.isArray(candidate.raw?.evidenceVideoIds) && candidate.raw.evidenceVideoIds.includes(video.candidateId));
        return account ? [{ video, account }] : [];
      });
      const now = (input.now ?? new Date()).toISOString();
      const handoffs = await dataStore.list<any>('starter_social_inspiration_handoff_versions', { where: { tenant_id: input.tenantId }, perPage: 500 });
      if (handoffs.totalItems > handoffs.items.length) throw new SocialProgramError('planning_handoff_scan_truncated', 409, '参考分析版本读取不完整，请补齐读取后再冻结计划。');
      const feedbackPackageRows = await dataStore.list<any>('social_weekly_operating_packages',{where:{tenant_id:input.tenantId,program_id:input.programId,package_id:current.packageId,version:current.packageVersion},perPage:2});
      if(feedbackPackageRows.totalItems>1)throw new SocialProgramError('weekly_feedback_package_ambiguous',409,'客户反馈引用需要唯一的冻结周任务包。');
      const feedbackPackage = feedbackPackageRows.items[0] ? socialJson(feedbackPackageRows.items[0].payload) as WeeklyOperatingPackage : null;
      const outcomes = await Promise.allSettled(analysisSlots.map(async (slot, index) => {
        const own = slot.referenceSource === 'owned' ? ownedPairs.filter(pair => slot.accountIds.includes(pair.account.accountId)) : [];
        if (slot.referenceSource === 'owned' && !own.length) throw new SocialProgramError('owned_reference_account_required', 409, '该母版目标账号缺少已核验的自有参考，需补齐或明确修订配额。');
        if(slot.referenceSource!=='owned'&&!pairs.length)throw new SocialProgramError('benchmark_account_video_link_required',409,'该外部条目缺少可核验的账号与视频关联，暂不能继续。');
        const selected = slot.referenceSource === 'owned' ? own[index % own.length]! : pairs[index % pairs.length]!;
        const feedbackTopics = await Promise.all(slot.publicationTaskIds.flatMap(id => { const publication = feedbackPackage?.socialContentPackage?.publicationTasks?.find(p=>p.publicationTaskId===id); return publication?.customerFeedbackTopicRef ? [{publication,ref:publication.customerFeedbackTopicRef}] : []; }).map(({publication,ref})=>createCustomerFeedbackTopicService(dataStore).verifiedPlanningReference({tenantId:input.tenantId,programId:input.programId,pkg:feedbackPackage!,publicationTaskId:publication.publicationTaskId,ref})));
        const contentTemplateEvidence=await Promise.all(slot.publicationTaskIds.flatMap(id=>{const publication=feedbackPackage?.socialContentPackage?.publicationTasks?.find(p=>p.publicationTaskId===id);return publication?.contentTemplateBindingRef?[{publication,ref:publication.contentTemplateBindingRef}]:[];}).map(async({publication,ref})=>({publicationTaskId:publication.publicationTaskId,bindingRef:ref,structure:await readWeeklyTemplateStructure(dataStore,{tenantId:input.tenantId,programId:input.programId,packageId:current.packageId,packageVersion:current.packageVersion,publicationTaskId:publication.publicationTaskId},ref)})));
        const { video } = selected;
        const frozenHandoff = handoffs.items.filter(row => row.tenant_id === input.tenantId && row.record_hash === socialRequestHash(socialJson(row.payload)))
          .map(row => ({ row, handoff: socialJson(row.payload) as SocialInspirationHandoff }))
          .filter(({ handoff }) => handoff?.inspirationId === video.candidateId && handoff.source?.sourceUrl === video.sourceUrl)
          .sort((a,b) => Number(b.handoff.version ?? b.handoff.analysisVersion) - Number(a.handoff.version ?? a.handoff.analysisVersion))[0];
        const accountTitle = 'evidenceRef' in selected ? selected.account.displayName : selected.account.title;
        const benchmarkVideoRef: VersionedSocialRef = { type: 'social_discovery_video', id: video.candidateId, version: video.evidenceVersion };
        const benchmarkAccountRef: VersionedSocialRef = 'evidenceRef' in selected ? { type: 'owned_social_account', id: selected.account.accountId, version: selected.account.version } : { type: 'social_benchmark_account', id: selected.account.candidateId, version: selected.account.evidenceVersion };
        const handoffRef = frozenHandoff ? { inspirationId: video.candidateId, version: String(frozenHandoff.handoff.version ?? frozenHandoff.handoff.analysisVersion), recordHash: frozenHandoff.row.record_hash } : null;
        const diagnosis = 'evidenceRef' in selected && current.referenceSourcePolicy ? diagnoseOwnedReference({ policy: current.referenceSourcePolicy, performance: selected.historicalPerformance, handoff: frozenHandoff?.handoff, handoffRef, now: input.now ?? new Date() }) : null;
        const materialScope = { packageId: current.packageId, packageVersion: current.packageVersion, slotId: slot.slotId };
        const materialConfiguration = handoffRef ? await latestMaterialEvidenceConfiguration(dataStore,{tenantId:input.tenantId,programId:input.programId,scope:materialScope,handoffRef}) : null;
        const materialEvidenceRequirements = classifyMaterialEvidence({ scope: materialScope, handoff: frozenHandoff?.handoff, handoffRef, configuration:materialConfiguration });
        const inheritedStyle = diagnosis?.tone ? [`开场结构：${diagnosis.tone.hookTypes.join('、')}`, `信息顺序：${diagnosis.tone.revealOrder.join('→')}`, `表达节奏：${diagnosis.tone.pacing}`, `行动引导位置：${diagnosis.tone.ctaPosition}`] : ['自有调性尚待真实分镜分析核验，不默认继承外部风格'];
        return {
          analysisId: stableId('director_analysis', { planningId: current.planningId, planningVersion: current.version + 1, slotId: slot.slotId, benchmarkVideoRef, benchmarkAccountRef }),
          slotId: slot.slotId,
          packageId: current.packageId,
          packageVersion: current.packageVersion,
          analyzedBy: 'director_agent',
          ...(contentTemplateEvidence.length?{contentTemplateEvidence}:{}),
          ...(feedbackTopics.length ? {customerFeedbackTopicRefs:feedbackTopics.map(topic=>({type:'customer_feedback_topic_confirmation',id:topic.confirmation.id,version:topic.confirmation.version})),customerFeedbackTopicEvidence:feedbackTopics.map(topic=>({publicationTaskId:topic.confirmation.target.publicationTaskId,confirmationRef:{type:'customer_feedback_topic_confirmation',id:topic.confirmation.id,version:1},candidateRef:{id:topic.candidate.id,version:1,recordHash:topic.candidate.recordHash},question:topic.candidate.source.question,topicAngle:topic.candidate.topicAngle}))} : {}),
          frozenHandoffRefs: handoffRef ? [handoffRef] : [],
          benchmarkAccountRefs: [benchmarkAccountRef],
          benchmarkVideoRefs: [benchmarkVideoRef],
          historicalPerformance: 'evidenceRef' in selected ? selected.historicalPerformance : null,
          ...(diagnosis ? { ownedReferenceDiagnosis: diagnosis } : {}),
          benchmarkEvidenceRefs: [video.evidenceRef, 'evidenceRef' in selected ? selected.evidenceRef : selected.account.evidenceRef,...feedbackTopics.map(topic=>`customer_feedback_topic:${topic.candidate.id}@${topic.candidate.recordHash}`)],
          contentDirection: (slot.referenceSource === 'owned' ? `以本账号 ${accountTitle} 的历史视频 ${video.title} 为参考，${diagnosis?.toneStatus === 'verified' ? '保留已核验的开场、信息顺序和表达节奏' : '调性尚待核验，不以外部风格替代'}，更新本次产品事实与表达。` : `按 ${accountTitle} 的更新节奏和内容方向，迁移 ${video.title} 的结构；必须替换产品事实、原素材和原台词。`) + (feedbackTopics.length ? `；真实客户问题：${feedbackTopics.map(topic=>topic.candidate.source.question).join('；')}；待验证选题方向：${feedbackTopics.map(topic=>topic.candidate.topicAngle).join('；')}（未形成获客归因）` : ''),
          styleRules: slot.referenceSource === 'owned' ? [...inheritedStyle, '使用企业已确认事实', '历史人物与品牌表达可沿用已核验边界；原画面、音乐和肖像须逐资产确认授权，不凭账号归属直接复用'] : ['保留前三秒信息结构', '使用企业已确认事实', '不得复用原视频画面、音乐或台词'],
          updateRhythm: slot.plannedPublishWindows.length ? slot.plannedPublishWindows.join('、') : '按本周账号配额均匀发布',
          materialRequirements: materialEvidenceRequirements.items.map(item => item.description),
          materialEvidenceRequirements,
          estimatedProductionMinutes: 180,
          createdAt: now,
        };
      }));
      const analyses:WeeklyDirectorPlanningAnalysis[]=[],directorGaps:WeeklyDirectorSlotGap[]=[];
      outcomes.forEach((outcome,index)=>{const slot=analysisSlots[index]!;if(outcome.status==='fulfilled'){analyses.push(outcome.value as WeeklyDirectorPlanningAnalysis);if(slot.referenceSource==='owned'&&!ownedDiagnosisReady(outcome.value as WeeklyDirectorPlanningAnalysis))directorGaps.push({slotId:slot.slotId,referenceSource:'owned',code:'owned_reference_diagnosis_pending',message:'自有播放、赞转评或调性分析尚未齐全，保留该条目缺口。',observedAt:now});}else{const error=outcome.reason;if(!(error instanceof SocialProgramError)&&!(error instanceof SocialContentWorkflowError))throw error;directorGaps.push({slotId:slot.slotId,referenceSource:slot.referenceSource??'unknown',code:error.code,message:error.message,observedAt:now});}});
      if(!analyses.length&&directorGaps.length&&!input.selectedSlotIds){const first=directorGaps[0]!;throw new SocialProgramError(first.referenceSource==='owned'&&!ownedPairs.length?'owned_reference_evidence_required':first.code,409,first.message);}
      analyses.push(...current.directorAnalyses.filter(a=>!analysisCoverage.selectedSlotIds.includes(a.slotId)));
      directorGaps.push(...(current.directorGaps??[]).filter(g=>!analysisCoverage.selectedSlotIds.includes(g.slotId)));
      for(const slot of current.skeleton.slots)if(!analyses.some(a=>a.slotId===slot.slotId)&&!directorGaps.some(g=>g.slotId===slot.slotId))directorGaps.push({slotId:slot.slotId,referenceSource:slot.referenceSource??'unknown',code:'director_slot_analysis_pending',message:'该母版仍需完成其原来源分析，不改为另一来源。',observedAt:now});
      return guardedAppend(input.tenantId, {
        ...current,
        version: current.version + 1,
        status: 'director_analyzing',
        directorAnalyses: analyses,
        directorGaps,
        detailedSchedule: null,
        userConfirmation: null,
        dispatch: null,
        updatedAt: now,
      });
    },

    async mergeDetailedSchedule(input: {
      tenantId: string;
      programId: string;
      package: WeeklyOperatingPackage;
      expectedPlanningVersion: number;
      actor: 'business_agent';
      selectedSlotIds?:string[];
      now?: Date;
    }): Promise<WeeklyAgentPlanningState> {
      if (input.actor !== 'business_agent') throw new SocialProgramError('business_schedule_authority_required', 403, '只有经营 Agent 可以生成详细内容排期。');
      const current = await this.get(input.tenantId, input.programId, input.package.packageId, input.package.version);
      requirePlanningVersion(current, input.expectedPlanningVersion);
      requireEditablePlanning(current);
      const analysisBySlot = new Map(current.directorAnalyses.map(item => [item.slotId, item]));
      const coverage=selectWeeklyPlanningCoverage(current,input.selectedSlotIds);
      const selectedSlots=current.skeleton.slots.filter(slot=>coverage.selectedSlotIds.includes(slot.slotId));
      const missing = selectedSlots.filter(slot => !analysisBySlot.has(slot.slotId)||(slot.referenceSource==='owned'&&!ownedDiagnosisReady(analysisBySlot.get(slot.slotId)!))||current.directorGaps?.some(g=>g.slotId===slot.slotId));
      if (missing.length) throw new SocialProgramError('director_analysis_incomplete', 409, `仍有 ${missing.length} 个内容槽位缺少编导分析。`);
      const now = (input.now ?? new Date()).toISOString();
      const tasksById = new Map(input.package.socialContentPackage.publicationTasks.map(item => [item.publicationTaskId, item]));
      const items = selectedSlots.flatMap(slot => {
        const analysis = analysisBySlot.get(slot.slotId)!;
        return slot.publicationTaskIds.map(publicationTaskId => {
          const publication = tasksById.get(publicationTaskId);
          if (!publication) throw new SocialProgramError('publication_task_lineage_invalid', 409, '内容排期引用了不存在的发布任务。');
          return {
            scheduleItemId: stableId('detailed_schedule_item', { planningId: current.planningId, publicationTaskId }),
            slotId: slot.slotId,
            publicationTaskId,
            accountId: publication.accountId,
            platform: publication.platform,
            topic: analysis.customerFeedbackTopicEvidence?.find(e=>e.publicationTaskId===publicationTaskId&&e.confirmationRef.id===publication.customerFeedbackTopicRef?.id)?.topicAngle || publication.businessProposition || analysis.contentDirection,
            directorAnalysisRef: { type: 'weekly_director_analysis', id: analysis.analysisId, version: 1 },
            benchmarkAccountRefs: analysis.benchmarkAccountRefs,
            benchmarkVideoRefs: analysis.benchmarkVideoRefs,
            ...(publication.contentTemplateBindingRef?{contentTemplateStructure:structuredClone(analysis.contentTemplateEvidence?.find(e=>e.publicationTaskId===publication.publicationTaskId&&e.bindingRef.id===publication.contentTemplateBindingRef?.id)?.structure??(()=>{throw new SocialProgramError('content_template_analysis_required',409,'模板绑定缺少实际新周编导分析。');})())}:{}),
            materialRequirements: analysis.materialRequirements,
            materialEvidenceRequirements: analysis.materialEvidenceRequirements ? structuredClone(analysis.materialEvidenceRequirements) : undefined,
            materialPlan: {
              canStartWithExistingAssets: false,
              fallback: 'premium_aigc' as const,
              optionalShootTaskIds: [],
              note: '素材就绪由实际核验任务确认。必需企业实拍、产品事实和人物授权不能以 AIGC 默认替代；拍摄任务仅在真实创建后关联。',
            },
            publishWindow: publication.publishWindow || input.package.weekEnd,
            qualityTier: 'premium' as const,
            estimatedProductionMinutes: minutes(analysis.estimatedProductionMinutes),
          };
        });
      });
      const nextVersion = current.version + 1;
      return guardedAppend(input.tenantId, {
        ...current,
        version: nextVersion,
        status: 'awaiting_confirmation',
        detailedSchedule: {
          ref: { type: 'weekly_detailed_content_schedule', id: stableId('detailed_schedule', { planningId: current.planningId, version: nextVersion }), version: 1 },
          mergedBy: 'business_agent',
          coverage,
          items,
          createdAt: now,
        },
        userConfirmation: null,
        dispatch: null,
        updatedAt: now,
      });
    },

    async confirm(input: { tenantId: string; programId: string; packageId: string; packageVersion: number; expectedPlanningVersion: number; userId: string; selectedSlotIds?:string[]; now?: Date }): Promise<WeeklyAgentPlanningState> {
      const current = await this.get(input.tenantId, input.programId, input.packageId, input.packageVersion);
      requirePlanningVersion(current, input.expectedPlanningVersion);
      if (!current.detailedSchedule) throw new SocialProgramError('detailed_schedule_required', 409, '详细内容排期尚未生成。');
      assertWeeklyDetailedCoverage(current);
      if(current.detailedSchedule.coverage)assertWeeklyPlanningCoverage(current,current.detailedSchedule.coverage,input.selectedSlotIds);
      if (current.status === 'confirmed' || current.status === 'dispatched') return current;
      const now = (input.now ?? new Date()).toISOString();
      return guardedAppend(input.tenantId, {
        ...current,
        version: current.version + 1,
        status: 'confirmed',
        userConfirmation: { confirmedBy: input.userId, confirmedAt: now,...(current.detailedSchedule.coverage?{selectedSlotIds:current.detailedSchedule.coverage.selectedSlotIds}:{}) },
        updatedAt: now,
      });
    },

    async dispatch(input: { tenantId: string; programId: string; packageId: string; packageVersion: number; expectedPlanningVersion: number; actor: 'business_agent'; selectedSlotIds?:string[]; now?: Date }): Promise<WeeklyAgentPlanningState> {
      if (input.actor !== 'business_agent') throw new SocialProgramError('business_dispatch_authority_required', 403, '只有经营 Agent 可以向内容 Agent 派单。');
      const current = await this.get(input.tenantId, input.programId, input.packageId, input.packageVersion);
      requirePlanningVersion(current, input.expectedPlanningVersion);
      assertWeeklyDetailedCoverage(current);
      if(current.detailedSchedule?.coverage){assertWeeklyPlanningCoverage(current,current.detailedSchedule.coverage,input.selectedSlotIds);if(current.userConfirmation&&JSON.stringify(current.userConfirmation.selectedSlotIds)!==JSON.stringify(current.detailedSchedule.coverage.selectedSlotIds))throw new SocialProgramError('weekly_partial_confirmation_changed',409,'确认的母版范围与详细排期不一致。');}
      if (current.dispatch) return current;
      if (current.status !== 'confirmed' || !current.detailedSchedule || !current.userConfirmation) {
        throw new SocialProgramError('confirmed_detailed_schedule_required', 409, '用户确认详细排期后才能派给内容 Agent。');
      }
      const now = (input.now ?? new Date()).toISOString();
      const dispatch: WeeklyBusinessContentDispatch = {
        dispatchId: `business_dispatch_${randomUUID()}`,
        packageId: current.packageId,
        packageVersion: current.packageVersion,
        issuedBy: 'business_agent',
        assignedTo: 'content_agent',
        detailedScheduleRef: current.detailedSchedule.ref,
        ...(current.detailedSchedule.coverage?{coverage:structuredClone(current.detailedSchedule.coverage)}:{}),
        scheduleItemIds: current.detailedSchedule.items.map(item => item.scheduleItemId),
        scheduleItems: structuredClone(current.detailedSchedule.items),
        issuedAt: now,
      };
      return guardedAppend(input.tenantId, {
        ...current,
        version: current.version + 1,
        status: 'dispatched',
        dispatch,
        updatedAt: now,
      });
    },
  };
}

export const WEEKLY_PLANNING_MUTATION_SCOPE = 'social_weekly_planning_mutation';

/** Database unique lease plus immutable, deterministic version IDs protect independent API processes. */
export function createWeeklyPlanningAuthority(dataStore: DataStore) {
  const reader = unguardedPlanningAuthority(dataStore);
  async function mutate<T>(tenantId: string, programId: string, packageId: string, packageVersion: number, operation: (authority: ReturnType<typeof unguardedPlanningAuthority>) => Promise<T>): Promise<T> {
    const subjectId = createHash('sha256').update(JSON.stringify([programId, packageId, packageVersion])).digest('hex');
    const lease = await acquireDurableOperationLease({ dataStore, tenantId, scope: WEEKLY_PLANNING_MUTATION_SCOPE, subjectId, ownerId: `planning-${randomUUID()}`, leaseDurationMs: 120_000 });
    if (!lease) throw new SocialProgramError('weekly_agent_planning_version_conflict', 409, '本周计划正在被其他请求更新，请刷新后重试；已有计划已保留。');
    try {
      const authority = unguardedPlanningAuthority(dataStore, async () => {
        try { await assertDurableOperationLease({ dataStore, lease, minimumRemainingMs: 5_000 }); }
        catch (error) {
          if (error instanceof DurableOperationLeaseError) throw new SocialProgramError('weekly_agent_planning_lease_lost', 409, '本次规划写入租约已失效，请刷新后重试；已有计划已保留。');
          throw error;
        }
      });
      return await operation(authority);
    } finally { await releaseDurableOperationLease({ dataStore, lease }); }
  }
  return {
    get: reader.get,
    initialize: (tenantId: string, pkg: WeeklyOperatingPackage) => mutate(tenantId, pkg.programId, pkg.packageId, pkg.version, authority => authority.initialize(tenantId, pkg)),
    runDirectorAnalysis: (input: Parameters<typeof reader.runDirectorAnalysis>[0]) => mutate(input.tenantId, input.programId, input.packageId, input.packageVersion, authority => authority.runDirectorAnalysis(input)),
    mergeDetailedSchedule: (input: Parameters<typeof reader.mergeDetailedSchedule>[0]) => mutate(input.tenantId, input.programId, input.package.packageId, input.package.version, authority => authority.mergeDetailedSchedule(input)),
    confirm: (input: Parameters<typeof reader.confirm>[0]) => mutate(input.tenantId, input.programId, input.packageId, input.packageVersion, authority => authority.confirm(input)),
    dispatch: (input: Parameters<typeof reader.dispatch>[0]) => mutate(input.tenantId, input.programId, input.packageId, input.packageVersion, authority => authority.dispatch(input)),
  };
}
