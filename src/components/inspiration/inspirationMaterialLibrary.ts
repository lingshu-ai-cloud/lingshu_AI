import type { Material } from '../../lib/studioApi';
import type { TrendVideo } from '../../lib/inspirationTypes';
import { MATERIAL_SOURCE_LABELS, MATERIAL_THEME_LABELS, materialSourceCategoryOf, materialThemeTagsOf } from '../../../shared/materialTaxonomy';
import { MATERIAL_ASSET_ROLE_LABELS, MATERIAL_CONTENT_ROLE_LABELS, materialDirectorSummary } from '../../../shared/imageCreativePlanning';
import type { MaterialSourceFilter, MaterialThemeFilter } from '../material-library/MaterialTaxonomyFilters';
import { materialHasAuthoritativeAspectRatio, materialIntrinsicAspectRatio } from '../../lib/materialAspectRatio';
import { materialAssetTabOf, type MaterialAssetTab } from '../../lib/materialAssetOwnership';
import { canProcessVideo } from '../../lib/inspirationDataQuality';

export type MaterialIndustryFilter = 'all' | 'beauty_skincare' | 'universal_manufacturing' | 'apparel_textile' | 'metalworking';
export type MaterialApplicabilityFilter = 'all' | 'universal' | 'cross_industry' | 'industry_specific';
export type MaterialOrientationFilter = 'all' | 'vertical' | 'horizontal';
export type MaterialTypeFilter = 'all' | 'video' | 'image' | 'audio';
export type FavoriteFilter = 'all' | 'favorite';
export type MaterialLibraryEntryContext = { openLibrary: boolean; productId: string; productRef: string };
const ENTERPRISE_COMMON_MATERIAL_TAG = 'enterprise_common';

/** Cards and detail drawers must share the same media-creation admission rule. */
export function canCreateFromLibraryMaterial(material: Pick<Material, 'type' | 'duration' | 'url' | 'poster'>): boolean {
  return material.type !== 'audio'
    && (material.type !== 'video' || canProcessVideo({ contentFormat: 'video', duration: material.duration }))
    && Boolean(String(material.url || material.poster || '').trim());
}

export function parseMaterialLibraryEntry(search: string): MaterialLibraryEntryContext {
  const params = new URLSearchParams(search);
  return {
    openLibrary: params.get('view') === 'library',
    productId: String(params.get('productId') || '').trim(),
    productRef: String(params.get('productRef') || '').trim(),
  };
}

export function initialMaterialLibraryEntry(): MaterialLibraryEntryContext {
  return typeof window === 'undefined'
    ? { openLibrary: false, productId: '', productRef: '' }
    : parseMaterialLibraryEntry(window.location.search);
}

export function initialMaterialTaxonomyFilters(): { source: MaterialSourceFilter; theme: MaterialThemeFilter } {
  if (typeof window === 'undefined') return { source: 'all', theme: 'all' };
  const params = new URLSearchParams(window.location.search);
  const source = params.get('source') || 'all';
  const theme = params.get('theme') || 'all';
  return {
    source: source === 'all' || Object.hasOwn(MATERIAL_SOURCE_LABELS, source) ? source as MaterialSourceFilter : 'all',
    theme: theme === 'all' || Object.hasOwn(MATERIAL_THEME_LABELS, theme) ? theme as MaterialThemeFilter : 'all',
  };
}

export function isEnterpriseCommonMaterial(material: Pick<Material, 'tags'>): boolean {
  return String(material.tags || '').split(/[,，]/).map(tag => tag.trim()).includes(ENTERPRISE_COMMON_MATERIAL_TAG);
}

export function materialOwnershipTags(tags: string | undefined, productId: string): string {
  const values = String(tags || '').split(/[,，]/).map(tag => tag.trim()).filter(Boolean)
    .filter(tag => tag !== ENTERPRISE_COMMON_MATERIAL_TAG);
  if (!productId) values.push(ENTERPRISE_COMMON_MATERIAL_TAG);
  return Array.from(new Set(values)).join(', ');
}

export function visibleMaterialTags(tags: string | undefined): string {
  return String(tags || '').split(/[,，]/).map(tag => tag.trim()).filter(Boolean)
    .filter(tag => tag !== ENTERPRISE_COMMON_MATERIAL_TAG).join(', ');
}

export function resolveLinkedFavoriteMaterialId(
  video: Pick<TrendVideo, 'sourceUrl' | 'aiAnalysis'>,
  materials: Array<Pick<Material, 'id' | 'sourceUrl'>>,
): string {
  const analyzedMaterialId = String(video.aiAnalysis?.materialId || '').trim();
  const linkedById = analyzedMaterialId && materials.find(material => material.id === analyzedMaterialId);
  if (linkedById) return linkedById.id;
  const sourceUrl = String(video.sourceUrl || '').trim();
  return sourceUrl
    ? materials.find(material => String(material.sourceUrl || '').trim() === sourceUrl)?.id || ''
    : '';
}

type MaterialSemanticSource = Pick<Material, 'productName' | 'tags' | 'visualObservations' | 'scriptAnalysis'>;

const HIDDEN_MATERIAL_KEYWORDS = new Set([
  'vertical', 'horizontal', '9:16', '16:9', 'image', 'video', 'audio',
  'hook', 'proof', 'support', 'transition', 'closing', 'explanation', 'demonstration',
  'local_upload', 'official_import', 'licensed_stock', 'seedance', 'gemini',
]);

function compactMaterialKeyword(value: unknown): string {
  const normalized = String(value || '').trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (!normalized || HIDDEN_MATERIAL_KEYWORDS.has(normalized.toLowerCase())) return '';
  return normalized.replace(/[。；;，,].*$/, '').slice(0, 24).trim();
}

/** One user-facing semantic line for a My Materials card; never exposes IDs or analysis state. */
export function materialSemanticLabel(material: MaterialSemanticSource): string {
  const productName = String(material.productName || '').trim();
  if (productName) return `产品：${productName}`;

  const manualKeywords = visibleMaterialTags(material.tags).split(/[,，]/)
    .map(compactMaterialKeyword).filter(Boolean);
  const analysis = material.scriptAnalysis;
  const analyzedKeywords = [
    ...(analysis?.directorIndex?.subjects || []),
    ...(analysis?.directorIndex?.actions || []),
    ...(analysis?.directorIndex?.environments || []),
    ...(material.visualObservations || []),
  ].map(compactMaterialKeyword).filter(Boolean);
  const keywords = [...new Set(manualKeywords.length ? manualKeywords : analyzedKeywords)].slice(0, 3);
  return keywords.length ? `内容：${keywords.join(' · ')}` : '内容：待补充说明';
}

export function materialDirectorUi(material: Pick<Material, 'materialV2' | 'productName' | 'segmentAnalysisStatus' | 'segmentAnalysisError'>) {
  const metadata = material.materialV2;
  if (!metadata) return {
    status: material.segmentAnalysisStatus === 'failed' ? '分析失败'
      : material.segmentAnalysisStatus === 'pending' || material.segmentAnalysisStatus === 'analyzing' ? '编导分析中' : '等待编导分析',
    role: '角色待识别',
    content: '内容待识别',
    uses: [] as string[],
    cautions: material.segmentAnalysisError ? [material.segmentAnalysisError] : [] as string[],
  };
  const summary = materialDirectorSummary(metadata, material.productName || '');
  return {
    status: '编导分析完成',
    role: MATERIAL_ASSET_ROLE_LABELS[metadata.assetRole],
    content: MATERIAL_CONTENT_ROLE_LABELS[metadata.contentRole],
    uses: summary.usableFor,
    cautions: summary.cautions,
  };
}

export function materialMatchesProductFilter(
  material: Pick<Material, 'productId' | 'productName' | 'tags'>,
  filter: { enabled: boolean; productId: string; productRef: string },
): boolean {
  if (!filter.enabled) return true;
  if (filter.productId) {
    return material.productId === filter.productId
      || (!material.productId && Boolean(filter.productRef) && material.productName === filter.productRef);
  }
  if (filter.productRef) return material.productName === filter.productRef;
  return !material.productId && isEnterpriseCommonMaterial(material);
}

export const MATERIAL_INDUSTRY_LABELS: Record<string, string> = {
  all: '全部行业', beauty_skincare: '美妆护肤', universal_manufacturing: '通用制造',
  apparel_textile: '服装纺织', metalworking: '金属加工',
};
export const MATERIAL_FUNCTION_LABELS: Record<string, string> = {
  all: '全部镜头功能', application: '使用/涂抹', texture_demo: '质地展示', product_demo: '产品展示',
  device_demo: '设备演示', ingredient_visual: '成分视觉', factory_proof: '工厂背书', production: '生产过程',
  equipment_demo: '设备展示', factory_exterior: '工厂外景', worker_operation: '工人操作',
  quality_control: '质检/检修', packaging: '包装交付', warehouse: '仓储物流', manufacturing_process: '加工过程',
  equipment_inspection: '设备检修', logistics_fulfillment: '物流履约', treatment_experience: '护理体验', usage_setup: '使用准备',
};
export const MATERIAL_APPLICABILITY_LABELS: Record<string, string> = {
  all: '全部适用范围', universal: '通用素材', cross_industry: '跨行业素材', industry_specific: '行业专属',
};
export function materialAssetBadge(material: Pick<Material, 'sourceType' | 'folder' | 'scope'>): { label: string; className: string } {
  const category = materialSourceCategoryOf(material);
  if (category === 'official_import') return { label: '官方导入', className: 'bg-orange-50 text-orange-700' };
  if (category === 'user_generated') return { label: '用户生成', className: 'bg-violet-50 text-violet-700' };
  return { label: '本地上传', className: 'bg-sky-50 text-sky-700' };
}

export function isFavoriteMaterial(material: Material): boolean {
  return material.pinned === true;
}

export type MaterialGalleryFilterSnapshot = {
  query: string;
  assetTab: MaterialAssetTab;
  type: MaterialTypeFilter;
  industry: MaterialIndustryFilter;
  shotFunction: string;
  applicability: MaterialApplicabilityFilter;
  orientation: MaterialOrientationFilter;
  source: MaterialSourceFilter;
  theme: MaterialThemeFilter;
  favorite: FavoriteFilter;
};

export function materialMatchesOrientation(material: Material, orientation: MaterialOrientationFilter): boolean {
  if (orientation === 'all') return true;
  if (materialHasAuthoritativeAspectRatio(material)) {
    const aspectRatio = materialIntrinsicAspectRatio(material);
    return orientation === 'vertical' ? aspectRatio < 1 : aspectRatio > 1;
  }
  const tags = String(material.tags || '');
  return orientation === 'vertical'
    ? /竖屏|vertical/i.test(tags)
    : /横屏|horizontal/i.test(tags);
}

export function materialMatchesLibraryFilters(material: Material, filters: MaterialGalleryFilterSnapshot): boolean {
  const query = filters.query.trim().toLowerCase();
  const functions = String(material.shotFunction || '').split(',').map(item => item.trim());
  const searchable = [
    material.name,
    material.folder,
    material.industry,
    material.shotFunction,
    material.applicability,
    material.tags,
    material.productName,
    material.scriptAnalysis?.searchableText,
    materialSemanticLabel(material),
  ].filter(Boolean).join(' ').toLowerCase();
  const orientationMatches = materialMatchesOrientation(material, filters.orientation);
  return (!query || searchable.includes(query))
    && (filters.assetTab === 'all' || materialAssetTabOf(material) === filters.assetTab)
    && (filters.theme === 'all' || materialThemeTagsOf(material).includes(filters.theme))
    && (filters.type === 'all' || material.type === filters.type)
    && (filters.industry === 'all' || material.industry === filters.industry)
    && (filters.shotFunction === 'all' || functions.includes(filters.shotFunction))
    && (filters.applicability === 'all' || material.applicability === filters.applicability)
    && (filters.source === 'all' || filters.source === materialSourceCategoryOf(material))
    && (filters.favorite === 'all' || isFavoriteMaterial(material))
    && orientationMatches;
}
