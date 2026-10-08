import { digitalHumanDecisionIssues, enterpriseMaterialIssue } from '../../shared/contracts/smartStoryboardAdmission.js';
import { recognizePresenterShot, salesPresenterRecognition, confirmedSalesPresenterRoute } from '../../shared/contracts/presenterShotRecognition.js';
import { createHash } from 'node:crypto';
import type { ShotProduction } from '../../src/lib/shotProduction.js';

export function batchShotRequestId(input: {
  projectId: string; batchId: string; assemblyId: string; shotId: string; fingerprint: string;
}): string {
  return `batch:${createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 40)}`;
}

export function uniqueAuthorizedSalesPresenter<T extends { id: string; name: string; authorized: boolean }>(presenters: T[]): T | null {
  const sales = presenters.filter(item => item.authorized && item.name.trim() === '销售');
  return sales.length === 1 ? sales[0]! : null;
}

export interface StudioBatchShotRoute {
  shotId: string;
  slotId: string;
  order: number;
  visualTopic: 'presenter' | 'factory' | 'product' | 'usage_scene' | 'other';
  expressionPurpose: string;
  route: 'digital_human' | 'local_material' | 'seedance_action' | 'aigc_first_frame' | 'unresolved';
  status: 'matched' | 'needs_material' | 'needs_plan' | 'blocked';
  matchedMaterialId: string | null;
  matchedSegmentId: string | null;
  trimStart: number | null;
  trimEnd: number | null;
  reason: string;
  /** This is a planning result, never evidence that a provider job completed. */
  generated: false;
}

interface BatchShotSpec {
  mode?: string;
  activeAssemblyId?: string;
  ratio?: string;
  shootingSlots?: Array<{ id?: string; slotId?: string; detail?: string; duration?: number; requirements?: string; observedPresenterRole?: import('../../shared/contracts/presenterShotRecognition.js').ObservedPresenterRole; personContinuityId?: string; salesPresenterConfirmed?: boolean }>;
  shotProductions?: Record<string, ShotProduction>;
  storyboardAssignments?: Record<string, string>;
  storyboardSourcePlans?: Record<string, { userSource?: string; mode?: string; shotTopic?: 'presenter' | 'factory' | 'product' | 'consumer_demo' | 'general'; sceneType?: 'product' | 'factory' | 'usage' | 'general'; confirmed?: boolean; firstFrameMaterialId?: string; firstFrameConfirmed?: boolean; generatedClipId?: string; videoResolution?: '480p' | '720p'; videoResolutionPinned?: boolean }>;
  clipEdits?: Record<string, { segmentId?: string; trimStart?: number; trimEnd?: number }>;
  materialSnapshots?: Array<{ id?: string; usage?: string; name?: string; type?: string; url?: string; duration?: number; width?: number; height?: number; aspectRatio?: number; transcript?: string }>;
}

/** Read-only planning for the workbench. Actual provider work must go through
 * the existing per-shot production plan and job endpoints. */
export function planStudioBatchShotRoutes(spec: BatchShotSpec, options: {
  talkingExecutorReady: boolean;
  actionExecutorReady: boolean;
  authorizedPresenterIds: string[];
  defaultSalesPresenterId?: string | null;
}): StudioBatchShotRoute[] {
  const slots = Array.isArray(spec.shootingSlots) ? spec.shootingSlots : [];
  const production = spec.shotProductions ?? {};
  const assignments = spec.storyboardAssignments ?? {};
  const snapshots = new Map((spec.materialSnapshots ?? []).map(item => [item.id, item]));
  const assemblyId = String(spec.activeAssemblyId || '');
  return slots.map((slot, index): StudioBatchShotRoute => {
    const shotId = String(slot.id || '');
    const slotId = String(slot.slotId || shotId);
    const shot = production[`${assemblyId}:${shotId}`];
    // `requirements` is a JSON snapshot that often contains the entire
    // product profile. `shot.source=avatar` may be an imported placeholder for
    // every reference cut. Neither is reliable evidence of what is on screen.
    const description = String(slot.detail || '').split('镜头功能：')[0] || String(slot.detail || '');
    const purpose = String(slot.detail || '').match(/镜头功能：([^\s]+)/)?.[1] || String(slot.requirements || '').slice(0, 120);
    const explicitScene = spec.storyboardSourcePlans?.[slotId]?.sceneType;
    const recognition = confirmedSalesPresenterRoute(slot);
    const selectedTopic = spec.storyboardSourcePlans?.[slotId]?.shotTopic;
    const factoryScene = selectedTopic === 'factory' || (!selectedTopic && recognition !== 'presenter' && (explicitScene === 'factory' || /工厂|车间|生产线|流水线|灌装|工人|factory|manufactur/i.test(description)));
    const spokenOnScreen = !factoryScene && (recognition === 'presenter' || spec.storyboardSourcePlans?.[slotId]?.userSource === 'avatar');
    const action = !factoryScene && recognition === 'motion';
    const visualTopic: StudioBatchShotRoute['visualTopic'] = factoryScene ? 'factory' : action || spokenOnScreen ? 'presenter'
      : explicitScene === 'general' ? 'other'
        : selectedTopic === 'consumer_demo' || explicitScene === 'usage' || /消费者|顾客|用户|使用|试用|安装|操作|涂抹|喷涂|上脸|妆效|粉底覆盖|使用前后|consumer|usage/i.test(description) ? 'usage_scene'
          : explicitScene === 'product' || /产品|包装|瓶身|质地|粉底液|product/i.test(description) ? 'product' : 'other';
    const assignedId = String(assignments[slotId] || '').trim();
    const assigned = assignedId && snapshots.has(assignedId) && snapshots.get(assignedId)?.usage !== 'reference_only' ? assignedId : null;
    const edit = assigned ? spec.clipEdits?.[`${slotId}:${assigned}`] : undefined;
    const trimStart = Number(edit?.trimStart);
    const trimEnd = Number(edit?.trimEnd);
    const base = { shotId, slotId, order: index + 1, visualTopic, expressionPurpose: purpose,
      matchedMaterialId: assigned, matchedSegmentId: assigned ? String(edit?.segmentId || '') || null : null,
      trimStart: assigned && Number.isFinite(trimStart) ? trimStart : null,
      trimEnd: assigned && Number.isFinite(trimEnd) && trimEnd > trimStart ? trimEnd : null,
      generated: false as const };
    const choice = spec.storyboardSourcePlans?.[slotId]?.userSource;
    const sourcePlan = spec.storyboardSourcePlans?.[slotId];
    if (!['material', 'shoot'].includes(choice || '') && slot.personContinuityId && salesPresenterRecognition(slot) === 'confirmed') {
      const identityAssets = new Set(slots.filter(peer => peer.personContinuityId === slot.personContinuityId && salesPresenterRecognition(peer) === 'confirmed'
        && !['material', 'shoot'].includes(spec.storyboardSourcePlans?.[String(peer.slotId || peer.id || '')]?.userSource || ''))
        .map(peer => production[`${assemblyId}:${peer.id}`]?.presenterId).filter(Boolean));
      if (identityAssets.size > 1) return { ...base, route: 'digital_human', status: 'blocked', reason: '同一销售主讲人的分镜必须使用同一个企业人物资产' };
    }

    const materialIssue = enterpriseMaterialIssue({ material: assigned ? snapshots.get(assigned) : undefined, duration: Number(slot.duration) || 0, ratio: spec.ratio, sound: (choice === 'material' || choice === 'shoot') && shot?.source === 'avatar' ? 'voiceover' : shot?.sound, narration: shot?.narration });
    if (shot?.locked) return { ...base, route: assigned ? 'local_material' : 'unresolved',
      status: assigned ? (materialIssue ? 'needs_material' : 'matched') : 'blocked',
      reason: assigned ? materialIssue || '镜头已锁定，保留已绑定素材' : '镜头已锁定，未提交智能生成' };
    if (choice === 'material' || choice === 'shoot') return { ...base, route: 'local_material', status: assigned && !materialIssue ? 'matched' : 'needs_material', reason: materialIssue || (assigned ? '采用用户选择的企业素材' : choice === 'shoot' ? '待拍任务尚未上传回填' : '请选择企业素材') };
    // An assigned image may be a generation reference. It is not a finished
    // matched clip when the user explicitly chose the intelligent route.
    if (choice !== 'avatar' && !spokenOnScreen && !action
      && (sourcePlan?.mode === 'ai' || sourcePlan?.mode === 'hybrid' || shot?.source === 'ai')) {
      if (sourcePlan?.generatedClipId && sourcePlan.confirmed && assignedId === sourcePlan.generatedClipId) {
        return { ...base, route: 'local_material', status: 'matched', reason: '采用已确认的 AIGC 分镜候选' };
      }
      return { ...base, route: 'aigc_first_frame', status: 'needs_plan', reason: sourcePlan?.firstFrameConfirmed && sourcePlan.firstFrameMaterialId
        ? '目标首帧已确认，等待生成视频候选并逐镜验收'
        : '需要先生成并确认目标首帧；批量入口不得跳过确认直接提交视频' };
    }
    // An unusable association is not a reason to make the user choose between
    // shooting and AIGC. Only an explicitly selected material/shooting route
    // keeps the material task open; otherwise non-presenter shots generate.
    if ((shot?.source !== 'avatar' || spec.storyboardSourcePlans?.[slotId]?.confirmed) && assigned && !materialIssue)
      return { ...base, route: 'local_material', status: 'matched', reason: '采用已绑定的企业素材' };
    if (visualTopic === 'presenter' || choice === 'avatar') {
      const missing = digitalHumanDecisionIssues(shot?.digitalHuman);
      if (!shot?.presenterId) missing.unshift('请选择企业人物');
      if (!shot?.digitalHuman?.presenterMode && (!shot?.digitalHuman?.replacementScope || !shot?.digitalHuman?.targetEffect)) {
        if (!missing.length) missing.push('请选择数字人替换范围和生成效果');
      }
      if (missing.length) return { ...base, route: 'digital_human', status: 'blocked', reason: missing.join('；') };
    }
    if (choice !== 'avatar' && salesPresenterRecognition(slot) === 'candidate') return { ...base, route: 'unresolved', status: 'blocked', reason: '系统人物识别复核尚未完成，暂不提交数字人生成' };
    if (visualTopic === 'presenter' && action) {
      return { ...base, route: 'seedance_action', status: 'blocked', reason: options.actionExecutorReady
        ? '动作镜头需建立逐镜首帧重建计划与授权后再提交现有执行接口'
        : '人物动作复刻执行器尚未接通，不能当作普通数字人口播生成' };
    }
    if (visualTopic === 'presenter') {
      if (shot?.digitalHuman && shot.digitalHuman.method !== 'talking')
        return { ...base, route: 'seedance_action', status: 'needs_plan', reason: '已选择场景重建方案，请在数字人工作面板完成首帧和模型预检；批量制作保留该选择，不改用 HeyGen' };
      if (!options.talkingExecutorReady) return { ...base, route: 'digital_human', status: 'blocked', reason: '数字人口播执行器不可用' };
      const presenterId = shot?.presenterId;
      if (!presenterId || !options.authorizedPresenterIds.includes(presenterId))
        return { ...base, route: 'digital_human', status: 'blocked', reason: '缺少已授权且具备 HeyGen 人物、声音映射的企业销售资产' };
      if (!String(shot?.narration || '').trim() || String(shot?.narration || '').trim() === '无')
        return { ...base, route: 'digital_human', status: 'blocked', reason: '该镜缺少逐句口播文案' };
      return { ...base, route: 'digital_human', status: 'needs_plan', reason: '可在保存草稿后逐镜创建数字人计划，执行器预检通过才可提交生成' };
    }
    if (assigned && !materialIssue) return { ...base, route: 'local_material', status: 'matched', reason: '已有可用本地素材关联' };
    return { ...base, route: 'aigc_first_frame', status: 'needs_plan', reason: assigned
      ? `已关联本地素材不可用（${materialIssue}），自动准备目标首帧`
      : '没有可用本地素材，自动准备目标首帧' };
  });
}
