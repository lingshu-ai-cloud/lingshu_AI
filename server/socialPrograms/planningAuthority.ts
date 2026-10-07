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
  return {
    skeletonId: stableId('weekly_skeleton', { packageId: pkg.packageId, version: pkg.version }),
    packageId: pkg.packageId,
    packageVersion: pkg.version,
    generatedBy: 'business_agent',
    tokenCost: 0,
    slots: [...byMother.entries()].map(([motherContentId, tasks]) => ({
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
      now?: Date;
    }): Promise<WeeklyAgentPlanningState> {
      if (input.actor !== 'director_agent') throw new SocialProgramError('director_analysis_authority_required', 403, '只有编导 Agent 可以写入对标分析。');
      const current = await this.get(input.tenantId, input.programId, input.packageId, input.packageVersion);
      requirePlanningVersion(current, input.expectedPlanningVersion);
      requireEditablePlanning(current);
      const [videos, accounts] = await Promise.all([
        listSocialDiscoverySupply({ tenantId: input.tenantId, dataStore, filters: { candidateType: 'video', decision: 'accepted', businessModel: 'b2b', sort: 'score', perPage: 100 } }),
        listSocialDiscoverySupply({ tenantId: input.tenantId, dataStore, filters: { candidateType: 'account', decision: 'accepted', businessModel: 'b2b', sort: 'score', perPage: 100 } }),
      ]);
      if (!videos.items.length || !accounts.items.length) {
        throw new SocialProgramError('qualified_benchmark_supply_required', 409, '详细计划需要已通过服务端评分的 B2B 对标账号和爆款视频。');
      }
      const now = (input.now ?? new Date()).toISOString();
      const analyses: WeeklyDirectorPlanningAnalysis[] = current.skeleton.slots.map((slot, index) => {
        const video = videos.items[index % videos.items.length]!;
        const account = accounts.items[index % accounts.items.length]!;
        const benchmarkVideoRef: VersionedSocialRef = { type: 'social_discovery_video', id: video.candidateId, version: video.evidenceVersion };
        const benchmarkAccountRef: VersionedSocialRef = { type: 'social_benchmark_account', id: account.candidateId, version: account.evidenceVersion };
        return {
          analysisId: stableId('director_analysis', { planningId: current.planningId, planningVersion: current.version + 1, slotId: slot.slotId, benchmarkVideoRef, benchmarkAccountRef }),
          slotId: slot.slotId,
          packageId: current.packageId,
          packageVersion: current.packageVersion,
          analyzedBy: 'director_agent',
          benchmarkAccountRefs: [benchmarkAccountRef],
          benchmarkVideoRefs: [benchmarkVideoRef],
          benchmarkEvidenceRefs: [video.evidenceRef, account.evidenceRef],
          contentDirection: `按 ${account.title} 的更新节奏和内容方向，迁移 ${video.title} 的结构；必须替换产品事实、原素材和原台词。`,
          styleRules: ['保留前三秒信息结构', '使用企业已确认事实', '不得复用原视频画面、音乐或台词'],
          updateRhythm: slot.plannedPublishWindows.length ? slot.plannedPublishWindows.join('、') : '按本周账号配额均匀发布',
          materialRequirements: ['企业产品实拍或已确认产品素材', '能够支撑卖点的细节镜头', '不可替代的工厂/产品真实性证据'],
          estimatedProductionMinutes: 180,
          createdAt: now,
        };
      });
      return guardedAppend(input.tenantId, {
        ...current,
        version: current.version + 1,
        status: 'director_analyzing',
        directorAnalyses: analyses,
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
      now?: Date;
    }): Promise<WeeklyAgentPlanningState> {
      if (input.actor !== 'business_agent') throw new SocialProgramError('business_schedule_authority_required', 403, '只有经营 Agent 可以生成详细内容排期。');
      const current = await this.get(input.tenantId, input.programId, input.package.packageId, input.package.version);
      requirePlanningVersion(current, input.expectedPlanningVersion);
      requireEditablePlanning(current);
      const analysisBySlot = new Map(current.directorAnalyses.map(item => [item.slotId, item]));
      const missing = current.skeleton.slots.filter(slot => !analysisBySlot.has(slot.slotId));
      if (missing.length) throw new SocialProgramError('director_analysis_incomplete', 409, `仍有 ${missing.length} 个内容槽位缺少编导分析。`);
      const now = (input.now ?? new Date()).toISOString();
      const tasksById = new Map(input.package.socialContentPackage.publicationTasks.map(item => [item.publicationTaskId, item]));
      const items = current.skeleton.slots.flatMap(slot => {
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
            topic: publication.businessProposition || analysis.contentDirection,
            directorAnalysisRef: { type: 'weekly_director_analysis', id: analysis.analysisId, version: 1 },
            benchmarkAccountRefs: analysis.benchmarkAccountRefs,
            benchmarkVideoRefs: analysis.benchmarkVideoRefs,
            materialRequirements: analysis.materialRequirements,
            materialPlan: {
              canStartWithExistingAssets: true,
              fallback: 'premium_aigc' as const,
              optionalShootTaskIds: analysis.materialRequirements.map((requirement, index) => stableId('optional_shoot_task', { planningId: current.planningId, publicationTaskId, requirement, index })),
              note: '不上传自有素材也可用现有素材与最高档 AIGC 开始制作；用户补拍内容进入下一轮排期，不阻塞本周任务。',
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
          items,
          createdAt: now,
        },
        userConfirmation: null,
        dispatch: null,
        updatedAt: now,
      });
    },

    async confirm(input: { tenantId: string; programId: string; packageId: string; packageVersion: number; expectedPlanningVersion: number; userId: string; now?: Date }): Promise<WeeklyAgentPlanningState> {
      const current = await this.get(input.tenantId, input.programId, input.packageId, input.packageVersion);
      requirePlanningVersion(current, input.expectedPlanningVersion);
      if (!current.detailedSchedule) throw new SocialProgramError('detailed_schedule_required', 409, '详细内容排期尚未生成。');
      if (current.status === 'confirmed' || current.status === 'dispatched') return current;
      const now = (input.now ?? new Date()).toISOString();
      return guardedAppend(input.tenantId, {
        ...current,
        version: current.version + 1,
        status: 'confirmed',
        userConfirmation: { confirmedBy: input.userId, confirmedAt: now },
        updatedAt: now,
      });
    },

    async dispatch(input: { tenantId: string; programId: string; packageId: string; packageVersion: number; expectedPlanningVersion: number; actor: 'business_agent'; now?: Date }): Promise<WeeklyAgentPlanningState> {
      if (input.actor !== 'business_agent') throw new SocialProgramError('business_dispatch_authority_required', 403, '只有经营 Agent 可以向内容 Agent 派单。');
      const current = await this.get(input.tenantId, input.programId, input.packageId, input.packageVersion);
      requirePlanningVersion(current, input.expectedPlanningVersion);
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
