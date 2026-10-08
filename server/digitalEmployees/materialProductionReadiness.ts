import type { BenchmarkAnalysis } from '../../shared/benchmarkAnalysis.js';
import type { AssetCandidate } from './contentProductionContracts.js';

export interface ProductMaterialReference {
  id: string;
  name: string;
  sku?: string;
}

export interface MaterialProductAssociation {
  productId: string;
  productName: string;
  source: 'product_id' | 'product_name' | 'product_ref' | 'material_metadata';
}

type MaterialRecordLike = Record<string, unknown>;

function text(value: unknown): string {
  return String(value || '').trim();
}

function normalized(value: unknown): string {
  return text(value).toLocaleLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, '');
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value).split(/[,，、;；|\n]+/).map(item => item.trim()).filter(Boolean);
}

/**
 * Resolve a durable product boundary for legacy material rows without guessing
 * between similarly named products. Explicit IDs always win. Name/tag fallback
 * is accepted only when it identifies exactly one current enterprise product.
 */
export function resolveMaterialProductAssociation(
  record: MaterialRecordLike,
  products: ProductMaterialReference[],
): MaterialProductAssociation | null {
  const byId = new Map(products.map(product => [product.id, product]));
  const explicitId = text(record.productId);
  if (explicitId) {
    const product = byId.get(explicitId);
    return product ? { productId: product.id, productName: product.name, source: 'product_id' } : null;
  }
  // System-provided cloud material remains reusable cloud material. It must
  // never become a tenant product asset merely because a tag/name happens to
  // overlap with a product. Only owned uploads receive legacy inference.
  if (text(record.scope) === 'shared') return null;

  const exactValues = [record.productName, record.productRef]
    .map(normalized)
    .filter(Boolean);
  const exactMatches = products.filter(product => {
    const keys = [normalized(product.name), normalized(product.sku)].filter(Boolean);
    return exactValues.some(value => keys.includes(value));
  });
  if (exactMatches.length === 1) {
    const product = exactMatches[0]!;
    return {
      productId: product.id,
      productName: product.name,
      source: normalized(record.productName) ? 'product_name' : 'product_ref',
    };
  }

  const metadataValues = [record.name, record.sourceName, ...stringList(record.tags)]
    .map(normalized)
    .filter(Boolean);
  const metadataMatches = products.filter(product => {
    const keys = [normalized(product.name), normalized(product.sku)].filter(key => key.length >= 3);
    return keys.some(key => metadataValues.some(value => value === key || value.includes(key)));
  });
  if (metadataMatches.length !== 1) return null;
  const product = metadataMatches[0]!;
  return { productId: product.id, productName: product.name, source: 'material_metadata' };
}

export type StoryboardMaterialRequirement = 'optional' | 'static_product' | 'dynamic_product' | 'factory_evidence';

export interface StoryboardMaterialDecision {
  structureIndex: number;
  requirement: StoryboardMaterialRequirement;
  required: boolean;
  assetId: string;
  blocker: string;
}

const DYNAMIC_PRODUCT = /(?:使用|试用|涂抹|擦拭|揉搓|起泡|清洁|冲洗|挤出|按压|喷洒|倒入|滴入|吸收|开箱|拆封|旋转|摇晃|操作|前后对比|质地变化|apply|use|demo|before.?after|rub|foam|cleanse|rinse|pour|spray|press|unbox)/i;
const FACTORY_EVIDENCE = /(?:工厂|车间|产线|生产线|流水线|灌装|包装工序|质检|设备|机器|加工|装配|产能|factory|production|assembly|filling|packing|quality.?control|machine)/i;

function assetText(asset: Pick<AssetCandidate, 'name' | 'productName' | 'tags' | 'visualObservations'>): string {
  return [asset.name, asset.productName, ...asset.tags, ...asset.visualObservations].filter(Boolean).join(' ');
}

function stepText(analysis: BenchmarkAnalysis | undefined, shotIds: string[]): string {
  if (!analysis) return '';
  return shotIds.flatMap(shotId => {
    const shot = analysis.shots.find(item => item.shotId === shotId);
    return shot ? [shot.visual, shot.purpose, shot.camera, shot.environment, shot.authenticity, ...Object.values(shot.detailedAnalysis)] : [];
  }).filter(Boolean).join(' ');
}

function requirementForStep(
  analysis: BenchmarkAnalysis,
  step: BenchmarkAnalysis['structure'][number],
): StoryboardMaterialRequirement {
  const description = stepText(analysis, step.shotIds);
  if (step.materialType === 'factory' || step.narrativeRole === 'capability_proof') return 'factory_evidence';
  if (step.materialType === 'consumer_demo' || step.narrativeRole === 'effect_proof') return 'dynamic_product';
  if (step.materialType === 'product') return DYNAMIC_PRODUCT.test(description) ? 'dynamic_product' : 'static_product';
  return 'optional';
}

function candidateForRequirement(requirement: StoryboardMaterialRequirement, assets: AssetCandidate[]): AssetCandidate | undefined {
  if (requirement === 'factory_evidence') {
    return assets.find(asset => asset.type === 'video' && FACTORY_EVIDENCE.test(assetText(asset)));
  }
  if (requirement === 'dynamic_product') return assets.find(asset => asset.type === 'video');
  if (requirement === 'static_product') return assets.find(asset => asset.type === 'image') || assets.find(asset => asset.type === 'video');
  return assets.find(asset => asset.type === 'video') || assets.find(asset => asset.type === 'image');
}

function missingMessage(requirement: StoryboardMaterialRequirement, index: number): string {
  if (requirement === 'dynamic_product') return `第 ${index + 1} 段需要真实动态产品视频；已有产品图可继续用于其他静态镜头`;
  if (requirement === 'factory_evidence') return `第 ${index + 1} 段需要与产品相关的真实工厂/生产过程视频`;
  if (requirement === 'static_product') return `第 ${index + 1} 段需要该产品的图片或视频`;
  return '';
}

/**
 * Evaluate only the material-dependent shots in one master. Missing evidence
 * blocks this master family, not the rest of the weekly plan. Pure-avatar
 * masters remain executable because every scene is rendered by the presenter.
 */
export function assessStoryboardMaterialReadiness(input: {
  analysis?: BenchmarkAnalysis;
  assets: AssetCandidate[];
  presenter: 'material' | 'heygen' | 'avatar';
}): { decisions: StoryboardMaterialDecision[]; blockers: string[] } {
  const structure = input.analysis?.structure || [];
  const decisions = structure.map((step, structureIndex): StoryboardMaterialDecision => {
    const requirement = input.presenter === 'avatar' ? 'optional' : requirementForStep(input.analysis!, step);
    const candidate = candidateForRequirement(requirement, input.assets);
    const required = requirement !== 'optional';
    return {
      structureIndex,
      requirement,
      required,
      assetId: candidate?.id || '',
      blocker: required && !candidate ? missingMessage(requirement, structureIndex) : '',
    };
  });
  if (!structure.length && input.presenter !== 'avatar' && !input.assets.length) {
    return { decisions, blockers: ['本条母版缺少该产品的可用图片或视频'] };
  }
  return { decisions, blockers: [...new Set(decisions.map(item => item.blocker).filter(Boolean))] };
}
