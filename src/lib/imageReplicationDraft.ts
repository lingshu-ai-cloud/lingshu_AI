import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation';
import type { CreateSocialContentTaskInput, SocialContentTaskDetail } from '../../shared/contracts/socialContentWorkflow';
import type { SocialImageReferenceLayerBlueprint } from '../../shared/contracts/socialImageCreation';
import { imageLanguageSchema, type ImageLanguage } from '../../shared/contracts/imageLanguages';

export type ImageReplicationReference = {
  url: string; title: string; caption?: string; materialId?: string;
  sourceRecordId?: string; imageIndex?: number; sourceUrl?: string; platform?: string; collectedAt?: string;
  layerBlueprints?: SocialImageReferenceLayerBlueprint[];
};
export type ImageReplicationDraft = {
  reference: ImageReplicationReference;
  product: { id: string; name: string };
  objective: string;
  audience: string;
  platform: 'facebook' | 'instagram' | 'linkedin';
  aspectRatio: '1:1' | '4:5' | '9:16' | '16:9';
  language: ImageLanguage;
  callToAction: string;
  budgetLimitCny?: number | null;
};

export function imageReplicationDraftIssue(draft: ImageReplicationDraft): string | null {
  if (!draft.reference.url.trim() || draft.reference.url.length > 2000) return '请选择或上传一张可读取的参考图。';
  if (!draft.product.id.trim() || !draft.product.name.trim()) return '请选择一个企业产品。';
  if (!draft.objective.trim() || draft.objective.length > 1000) return '请填写1～1000字的核心卖点或创作目标。';
  if (!draft.audience.trim() || draft.audience.length > 500) return '请填写目标受众（不超过500字）。';
  if (!['facebook', 'instagram', 'linkedin'].includes(draft.platform)
    || !['1:1', '4:5', '9:16', '16:9'].includes(draft.aspectRatio)
    || !imageLanguageSchema.safeParse(draft.language).success) return '请选择支持的平台、画幅和配文语言。';
  if (!draft.callToAction.trim() || draft.callToAction.length > 500) return '请填写希望客户采取的行动（不超过500字）。';
  if (draft.budgetLimitCny != null && (!Number.isFinite(draft.budgetLimitCny) || draft.budgetLimitCny <= 0)) return '单条费用上限须大于 0 元。';
  return null;
}

type DraftPorts = {
  createTask: (value: CreateSocialContentTaskInput, key: string) => Promise<SocialContentTaskDetail>;
  createOrResumeRun: (id: string, input: {
    expectedContentTaskVersion: string; idempotencyKey: string; deliverableKey: string;
    entrySource: 'assistant' | 'workspace'; imageType: 'product_poster';
  }) => Promise<{ task: SocialImageCreationTask }>;
  updateTask: (task: SocialImageCreationTask, patch: Partial<SocialImageCreationTask>) => Promise<{ task: SocialImageCreationTask }>;
};

/** Resume the same draft on transport failure. This command never starts production or calls a model. */
export async function createImageReplicationDraft(input: {
  draft: ImageReplicationDraft; operationKey: string; entrySource: 'assistant' | 'workspace';
  isCurrent: () => boolean; ports: DraftPorts;
}): Promise<SocialImageCreationTask> {
  const { draft, ports, operationKey } = input;
  const issue = imageReplicationDraftIssue(draft);
  if (issue) throw new Error(issue);
  const assertCurrent = () => { if (!input.isCurrent()) throw new Error('登录状态或当前创作已变化，请重新打开任务。'); };
  assertCurrent();
  const content = await ports.createTask({
    title: `${draft.product.name} · 图文爆款复刻`.slice(0, 100), objective: draft.objective.trim(),
    productId: draft.product.id, productRef: draft.product.name, audience: draft.audience.trim(),
    platforms: [draft.platform], languages: [draft.language], formats: ['social_image'],
    aspectRatio: draft.aspectRatio, requestedOutputCount: 1, callToAction: draft.callToAction.trim(),
    creationMode: 'viral_replication', assetAvailability: 'none', managementMode: 'one_click_managed',
    productionMode: 'social_ready', productionApproach: 'ai_enhanced', mode: 'instant', themeId: 'product_value',
    ...(draft.budgetLimitCny != null ? { perItemBudgetCny: draft.budgetLimitCny } : {}),
  }, `${operationKey}:content`);
  assertCurrent();
  const { task } = await ports.createOrResumeRun(content.taskId, {
    expectedContentTaskVersion: content.version, idempotencyKey: `${operationKey}:run`,
    deliverableKey: 'primary-image', entrySource: input.entrySource, imageType: 'product_poster',
  });
  assertCurrent();
  // A resumed production belongs to the original task: never reset its outputs, review or paid jobs.
  if (task.referenceSnapshot?.imageUrls[0] === draft.reference.url) return task;
  if (task.generationJobs.length || task.outputs.length || task.referenceSnapshot?.imageUrls.length) {
    throw new Error('原复刻任务已有参考或生产记录，请从“我的创作”恢复。');
  }
  const result = await ports.updateTask(task, {
    referenceUrls: [draft.reference.url],
    referenceSnapshot: {
      ...((draft.reference.sourceRecordId || draft.reference.materialId) ? { sourceRecordId: draft.reference.sourceRecordId || draft.reference.materialId } : {}),
      sourceUrl: draft.reference.sourceUrl || draft.reference.url, title: draft.reference.title,
      caption: draft.reference.caption || '', imageUrls: [draft.reference.url],
      collectedAt: draft.reference.collectedAt || task.createdAt, fingerprint: '',
    },
    ...(draft.reference.layerBlueprints?.length ? {
      replicationRecipe: { ...task.replicationRecipe!, referenceLayerBlueprints: draft.reference.layerBlueprints },
    } : {}),
  });
  assertCurrent();
  return result.task;
}
