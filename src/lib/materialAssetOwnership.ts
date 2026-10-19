import type { Material } from './studioApi';

export type MaterialAssetGroup = 'enterprise' | 'ai' | 'cloud';
export type MaterialAssetTab = 'all' | MaterialAssetGroup;

export function materialAssetTabOf(material: Pick<Material, 'sourceType' | 'folder' | 'scope'>): MaterialAssetGroup {
  const source = String(material.sourceType || '').toLowerCase();
  if (material.scope === 'shared' || material.folder === 'hot' || /official|viral|licensed[-_ ]?stock|cloud/.test(source)) return 'cloud';
  if (/seedance|seedream|gemini|qwen|ai[-_ ]?generated|aigc|^ai[-_]/.test(source)) return 'ai';
  return 'enterprise';
}

export function generatedMaterialOriginLabel(material: Pick<Material, 'sourceType' | 'provenance'>): string {
  const source = String(material.sourceType || '').toLowerCase();
  if (!/seedance|seedream|gemini|qwen|ai[-_]?generated|aigc|^ai[-_]/.test(source)) return '';
  const provenance = material.provenance || {};
  const shotLabel = String(provenance.shotId || '').trim().replace(/^slot[-_]?/i, '').trim();
  if (provenance.storyboardAigc === true) return `内容制作 · ${shotLabel ? `分镜 ${shotLabel}` : '分镜生成'}`;
  if (provenance.freeCreationHook === true) return '内容制作 · 自由创作';
  return source.includes('seedance') ? '内容制作 · Seedance 生成' : '内容制作 · AI 生成';
}
