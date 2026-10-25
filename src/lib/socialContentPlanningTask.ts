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
