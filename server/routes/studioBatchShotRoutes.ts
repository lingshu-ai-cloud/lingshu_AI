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
  route: 'digital_human' | 'local_material' | 'seedance_action' | 'unresolved';
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
  activeAssemblyId?: string;
  shootingSlots?: Array<{ id?: string; slotId?: string; detail?: string; requirements?: string }>;
  shotProductions?: Record<string, ShotProduction>;
  storyboardAssignments?: Record<string, string>;
  clipEdits?: Record<string, { segmentId?: string; trimStart?: number; trimEnd?: number }>;
  materialSnapshots?: Array<{ id?: string; usage?: string; name?: string }>;
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
    const foregroundPerson = /女性|男性|女人|男人|女士|男士|销售|主播|讲师|主讲者|真人|人物|模特|出镜|presenter|talking/i.test(description)
      && !/(?:女性|男性|人物|真人).{0,8}(?:背影|背景人物|远景人物)|路人|人群|background person/i.test(description);
    const hasSpeech = /口播：\s*(?!无(?:\s|$))\S/.test(String(slot.detail || ''))
      || /对镜口播|销售.*口播|讲师.*口播|主播.*口播/i.test(description);
    const identityForeground = foregroundPerson && /正面|面对镜头|直视镜头|嘴唇|口型|销售|讲师|主播|主人公|主角|镜头前|快速靠近镜头/i.test(description);
    // An audio sentence over factory or product B-roll does not turn the shot
    // into a digital presenter. Require visible speaking evidence plus the
    // enterprise protagonist's foreground identity.
    const spokenOnScreen = identityForeground && hasSpeech;
    const action = identityForeground && /快速靠近|靠近镜头|手臂.*靠近|凑近|敲门|明显动作|大幅手势|双臂.*伸展|双臂.*展开|指向镜头|gesture|approach/i.test(description);
    const visualTopic: StudioBatchShotRoute['visualTopic'] = action || spokenOnScreen ? 'presenter'
      : /工厂|车间|生产线|流水线|灌装|工人|factory|manufactur/i.test(description) ? 'factory'
        : /使用|试用|上脸|涂抹|妆效|粉底覆盖|usage/i.test(description) ? 'usage_scene'
          : /产品|包装|瓶身|质地|粉底液|product/i.test(description) ? 'product' : 'other';
    const assignedId = String(assignments[slotId] || '').trim();
    const assigned = assignedId && snapshots.has(assignedId) ? assignedId : null;
    const edit = assigned ? spec.clipEdits?.[`${slotId}:${assigned}`] : undefined;
    const trimStart = Number(edit?.trimStart);
    const trimEnd = Number(edit?.trimEnd);
    const base = { shotId, slotId, order: index + 1, visualTopic, expressionPurpose: purpose,
      matchedMaterialId: assigned, matchedSegmentId: assigned ? String(edit?.segmentId || '') || null : null,
      trimStart: assigned && Number.isFinite(trimStart) ? trimStart : null,
      trimEnd: assigned && Number.isFinite(trimEnd) && trimEnd > trimStart ? trimEnd : null,
      generated: false as const };
    if (visualTopic === 'presenter' && action) {
      return { ...base, route: 'seedance_action', status: 'blocked', reason: options.actionExecutorReady
        ? '动作镜头需建立逐镜首帧重建计划与授权后再提交现有执行接口'
        : '人物动作复刻执行器尚未接通，不能当作普通数字人口播生成' };
    }
    if (visualTopic === 'presenter') {
      if (!options.talkingExecutorReady) return { ...base, route: 'digital_human', status: 'blocked', reason: '数字人口播执行器不可用' };
      const presenterId = shot?.presenterId || options.defaultSalesPresenterId;
      if (!presenterId || !options.authorizedPresenterIds.includes(presenterId))
        return { ...base, route: 'digital_human', status: 'blocked', reason: '缺少已授权且具备 HeyGen 人物、声音映射的企业销售资产' };
      if (!String(shot?.narration || '').trim() || String(shot?.narration || '').trim() === '无')
        return { ...base, route: 'digital_human', status: 'blocked', reason: '该镜缺少逐句口播文案' };
      return { ...base, route: 'digital_human', status: 'needs_plan', reason: '可在保存草稿后逐镜创建数字人计划，执行器预检通过才可提交生成' };
    }
    if (assigned) return { ...base, route: 'local_material', status: 'matched', reason: '已有本地素材关联；仍需逐镜核对视觉主题与表达目的' };
    return { ...base, route: 'local_material', status: 'needs_material', reason: '需按视觉主题与表达目的从企业素材库匹配；当前没有已关联素材' };
  });
}
