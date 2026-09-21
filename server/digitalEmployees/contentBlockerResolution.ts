import { contentAcceptanceHash } from './contentAcceptance.js';

export type ContentBlockerAction = 'retry' | 'relax_non_core' | 'rewrite_scene';

export function resolveContentBlocker(spec: Record<string, any>, action: ContentBlockerAction, reason = '') {
  const automation = { ...(spec.automation || {}) };
  if (automation.stage !== 'blocked') throw Error('当前项目没有等待处理的受阻节点');
  const resumeStage = ['script', 'material_match', 'voice_subtitles', 'heygen', 'render', 'quality'].includes(automation.resumeStage)
    ? automation.resumeStage
    : 'script';
  const now = new Date().toISOString();
  const snapshot = { blocker: automation.blocker || '', resumeStage, sceneSourcePlan: spec.sceneSourcePlan || [], script: spec.script || '' };
  const next: Record<string, any> = {
    ...spec,
    contentAcceptance: null,
    revisionHistory: [...(spec.revisionHistory || []), {
      node: 'blocker_resolution', values: { action }, snapshot,
      reason: String(reason || ({ retry: '重新执行当前节点', relax_non_core: '放宽非核心画面条件', rewrite_scene: '交由编导改写受阻分镜' }[action])).slice(0, 240),
      hash: contentAcceptanceHash(spec), version: automation.contentVersion || 1, changedAt: now,
    }].slice(-30),
  };
  if (action === 'relax_non_core') {
    next.materialMatchPolicy = { ...(spec.materialMatchPolicy || {}), allowCompositionVariance: true, preserveFactBoundary: true, confirmedByHuman: true };
  } else if (action === 'rewrite_scene') {
    next.productionDirection = null;
    next.scenePlanOrigin = 'director';
    next.sceneSourcePlan = [];
    next.sceneOverrides = [];
    next.selectedMaterialIds = [];
  } else if (action !== 'retry') throw Error('不支持的受阻处理策略');
  const stage = action === 'rewrite_scene' ? 'script' : resumeStage;
  next.renderOutputPath = '';
  next.languageRenderOutputs = {};
  next.coverImagePath = '';
  next.automation = {
    ...automation, stage, status: 'queued', blocker: '', retryAfter: '', retryPolicy: '', resumeStage: '',
    quality: {}, renderedAt: '', completedAt: '', renderOutputPath: '', retryRequestedAt: now,
    contentVersion: Number(automation.contentVersion || 1) + 1,
    blockerResolution: { action, reason: String(reason || '').slice(0, 240), resolvedAt: now },
  };
  return next;
}
