import type {
  AddSocialTaskSourceInput,
  CreateSocialContentTaskInput,
} from '../../shared/contracts/socialContentWorkflow';

export interface SocialPlanningTaskSeed {
  requestedOutputCount?: number;
  requestId: number;
  draftProjectId?: string;
  title: string;
  initialScript?: string;
  specialRequirements?: string;
  productId?: string;
  productIds?: string[];
  productMaterialSelection?: CreateSocialContentTaskInput['productMaterialSelection'];
  productName?: string;
  presenterAssetId?: string;
  callToAction?: string;
  creationPath: 'material_processing' | 'viral_replication';
  uploadedMaterialCount: number;
  platforms?: string[];
  themeId?: CreateSocialContentTaskInput['themeId'];
}

function limited(value: unknown, maximum: number): string {
  return String(value || '').trim().slice(0, maximum);
}

/**
 * Turn the planning workbench into the same durable task contract used by the
 * task centre, Studio, digital employees and production read model. Navigation
 * hints may still be written for legacy Studio builds, but they are not truth.
 */
export function socialPlanningTaskInput(seed: SocialPlanningTaskSeed): CreateSocialContentTaskInput {
  if (seed.requestedOutputCount !== undefined && (!Number.isSafeInteger(seed.requestedOutputCount) || seed.requestedOutputCount < 1 || seed.requestedOutputCount > 1)) throw new Error('即时任务一次对应一条内容；多条需求请通过批量草稿入口提交。');
  const title = limited(seed.title, 120) || '社媒内容制作';
  const objective = limited(seed.initialScript, 1_000)
    || limited(seed.specialRequirements, 1_000)
    || `完成“${title}”的脚本、分镜、素材生产、质量验收与成片交付。`;
  const productId = limited(seed.productId, 200);
  const productName = limited(seed.productName, 200);
  const presenterAssetId = limited(seed.presenterAssetId, 200);
  return {
    title,
    objective,
    productId: productId || null,
    ...(seed.productIds ? { productIds: [...new Set(seed.productIds.map(id => limited(id, 200)).filter(Boolean))] } : {}),
    ...(seed.productMaterialSelection ? { productMaterialSelection: seed.productMaterialSelection } : {}),
    productRef: productName || null,
    requestedPresenterAssetId: presenterAssetId || null,
    presenterAssetId: presenterAssetId || null,
    platforms: [...new Set((seed.platforms || []).map(item => limited(item, 40)).filter(Boolean))].slice(0, 10),
    formats: ['short_video'],
    aspectRatio: '9:16',
    requestedOutputCount: seed.requestedOutputCount ?? 1,
    planningMode: 'auto_adjust',
    specialRequirements: limited(seed.specialRequirements, 2_000) || null,
    callToAction: limited(seed.callToAction, 500) || null,
    referenceMode: seed.creationPath === 'viral_replication' ? 'single_source_fidelity' : undefined,
    creationMode: seed.creationPath,
    assetAvailability: seed.uploadedMaterialCount > 0 ? 'ready' : 'none',
    managementMode: 'one_click_managed',
    productionMode: 'social_ready',
    productionApproach: 'ai_enhanced',
    mode: 'instant',
    themeId: seed.themeId || 'product_value',
    topic: title,
    legacyCreationRoute: seed.creationPath === 'viral_replication' ? 'clone' : 'material',
  };
}

function base64UrlUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function socialPlanningMaterialSource(material: { id: string; name?: string }): AddSocialTaskSourceInput {
  const id = limited(material.id, 200);
  if (!id) throw new Error('素材缺少有效标识，无法关联到生产任务');
  return {
    kind: 'material',
    sourceRef: `socialmaterial:${base64UrlUtf8(id)}`,
    label: limited(material.name, 160) || '制作素材',
    purpose: '由创作规划工作台确认并交接到统一生产任务；具体镜头用途由素材匹配与质量门禁决定。',
  };
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Stable across retries of the same workbench submission. */
export function socialPlanningOperationKey(seed: Pick<SocialPlanningTaskSeed, 'requestId' | 'draftProjectId' | 'title' | 'creationPath'>): string {
  return `planning:${fnv1a(JSON.stringify([seed.draftProjectId || seed.requestId, seed.title, seed.creationPath]))}`;
}

/** Reuse task source mutations; a confirmed selection replaces only workbench material links. */
export async function syncPlanningTaskMaterials(input: {
  task: import('../../shared/contracts/socialContentWorkflow').SocialContentTaskDetail;
  materials: Array<{ id: string; name?: string; type: string }>;
  operationKey: string;
  previousProductMaterialSelection?: CreateSocialContentTaskInput['productMaterialSelection'];
  selectionChanges?: Pick<CreateSocialContentTaskInput, 'productId' | 'productIds' | 'productRef' | 'productMaterialSelection'>;
  isCurrent: () => boolean;
  api: Pick<typeof import('./socialContentApi').socialContentApi, 'addSource' | 'removeSource' | 'updateTask'>;
}): Promise<import('../../shared/contracts/socialContentWorkflow').SocialContentTaskDetail> {
  let task = input.task;
  const desired = [...new Map(input.materials.filter(item => item.type === 'image' || item.type === 'video')
    .map(item => [item.id, socialPlanningMaterialSource(item)])).values()];
  const refs = new Set(desired.map(item => item.sourceRef));
  const managedIds = input.previousProductMaterialSelection ?? task.brief.productMaterialSelection;
  const managedRefs = new Set([...(managedIds?.selectedIds || []), ...(managedIds?.automaticIds || []), ...(managedIds?.dismissedIds || [])]
    .map(id => socialPlanningMaterialSource({ id }).sourceRef));
  const revision = fnv1a(JSON.stringify([...refs].sort()));
  for (const source of task.sources.filter(item => item.status === 'active' && item.kind === 'material'
    && managedRefs.has(item.sourceRef) && !refs.has(item.sourceRef))) {
    if (!input.isCurrent()) throw Error('当前账号或创作需求已变化，请重新打开任务。');
    task = (await input.api.removeSource(task.taskId, source.sourceId, task.version,
      `${input.operationKey}:${task.taskId}:${revision}:remove:${source.sourceId}:${task.version}`)).task;
  }
  for (const source of desired) {
    if (!input.isCurrent()) throw Error('当前账号或创作需求已变化，请重新打开任务。');
    if (task.sources.some(item => item.status === 'active' && item.kind === source.kind && item.sourceRef === source.sourceRef)) continue;
    task = (await input.api.addSource(task.taskId, source,
      `${input.operationKey}:${task.taskId}:${revision}:add:${fnv1a(source.sourceRef)}:${task.version}`)).task;
  }
  const availability = task.sources.some(source => source.status === 'active' && source.kind === 'material') ? 'ready' : 'none';
  if (!input.isCurrent()) throw Error('当前账号或创作需求已变化，请重新打开任务。');
  if (input.selectionChanges || task.brief.assetAvailability !== availability) task = await input.api.updateTask(task.taskId,
    { expectedVersion: task.version, changes: { ...input.selectionChanges, assetAvailability: availability } },
    `${input.operationKey}:${task.taskId}:${revision}:availability:${task.version}`);
  return task;
}
