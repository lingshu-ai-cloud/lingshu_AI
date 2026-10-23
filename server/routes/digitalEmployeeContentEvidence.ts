import { productionReferenceAdmission } from '../../shared/productionReferenceAdmission.js';
import type { DigitalEmployeeConfig } from '../digitalEmployees/domain.js';
import { productIdentity, resolveEnterpriseAssetLocation } from '../digitalEmployees/contentProduction.js';
import { enterpriseAssetStableId } from '../digitalEmployees/contentBatchPlan.js';
import { readExecutionMaterialLibrary } from '../digitalEmployees/executionAdapters.js';
import { resolveMaterialProductAssociation } from '../digitalEmployees/materialProductionReadiness.js';
import { exactVideoAnalysis } from '../digitalEmployees/taskEvidenceProjection.js';
import { referenceContentIdentity } from '../digitalEmployees/referenceContentIdentity.js';
import { benchmarkAnalysisForRecord } from '../lib/benchmarkAnalysis.js';
import { store } from '../storage/index.js';
import { readTenantEnterpriseProfile, type EnterpriseProfile } from './enterprise.js';
import { jsonObject, type StoredRecord } from './digitalEmployeeRecords.js';

function stableProductId(product: Record<string, unknown>, index: number): string {
  return productIdentity(product as Parameters<typeof productIdentity>[0], index);
}

function enterpriseMaterialIds(tenantId: string, products: Array<Record<string, unknown>>, originalIndexes: number[] = []): string[] {
  const ids: string[] = [];
  products.forEach((product, localIndex) => {
    const productIndex = originalIndexes[localIndex] ?? localIndex;
    const groups = ['images', 'videos', 'factoryImages', 'packagingImages', 'sceneImages', 'brandAssets']
      .map(group => Array.isArray(product[group]) ? product[group] as Array<Record<string, unknown>> : [])
      .filter(group => group.length);
    if (String(product.imageUrl || '').trim()) groups.unshift([{ type: 'image', url: product.imageUrl }]);
    groups.flat().forEach((asset, assetIndex) => {
      const url = String(asset.url || '').trim();
      const location = resolveEnterpriseAssetLocation(url, tenantId);
      if (url && (location.url || location.localPath || location.objectKey)) {
        ids.push(enterpriseAssetStableId(productIndex, assetIndex, url));
      }
    });
  });
  return ids;
}

export async function contentRoutingEvidence(tenantId: string, config: DigitalEmployeeConfig, frozenProfile?: EnterpriseProfile) {
  const [profile, analyses, materials] = await Promise.all([
    frozenProfile ? Promise.resolve(structuredClone(frozenProfile)) : readTenantEnterpriseProfile(tenantId),
    store.list<StoredRecord>('trend_videos', { where: { tenantId }, perPage: 500 }),
    readExecutionMaterialLibrary(tenantId),
  ]);
  return projectContentRoutingEvidence(tenantId, config, profile, analyses.items, materials);
}

export function projectContentRoutingEvidence(
  tenantId: string,
  config: DigitalEmployeeConfig,
  profile: EnterpriseProfile,
  analyses: StoredRecord[],
  materials: Awaited<ReturnType<typeof readExecutionMaterialLibrary>>,
) {
  if (materials.status === 'unavailable') throw Error('素材库暂时不可用，请稍后重试');
  const rawProducts = Array.isArray(profile.products?.items) ? profile.products.items as Array<Record<string, unknown>> : [];
  const focused = config.focusProducts.split(/[\n,，;；、]/).map(item => item.trim().toLowerCase()).filter(Boolean);
  const focusedProducts = focused.length ? rawProducts.filter(product => focused.some(value => [product.name, product.sku].some(field => String(field || '').trim().toLowerCase() === value))) : [];
  // Focus changes ordering, not eligibility: every confirmed product remains selectable.
  const selectedProducts = [...focusedProducts, ...rawProducts.filter(product => !focusedProducts.includes(product))];
  const productReferences = rawProducts.map((product, index) => ({
    id: stableProductId(product, index),
    name: String(product.name || product.sku || `产品 ${index + 1}`).trim(),
    sku: String(product.sku || '').trim(),
  }));
  const materialRows = materials.items.filter(item => {
    const url = String(item.url || item.path || item.objectKey || '').trim();
    return Boolean(url && item.synthetic !== true && !/mock|placeholder|e2e-quality-test/i.test(url));
  });
  const associatedMaterialRows = materialRows.map(item => ({
    item,
    association: resolveMaterialProductAssociation(item, productReferences),
  }));
  return {
    products: selectedProducts.map((product, index) => {
      const originalIndex = rawProducts.indexOf(product);
      const id = stableProductId(product, originalIndex);
      return {
        id,
        name: String(product.name || product.sku || `产品 ${index + 1}`).trim(),
        materialIds: [...enterpriseMaterialIds(tenantId, [product], [originalIndex]), ...associatedMaterialRows.filter(row => row.association?.productId === id).map(row => row.item.id)],
      };
    }),
    exactAnalysisIds: analyses.filter(exactVideoAnalysis).map(item => item.id),
    referenceIdentities: Object.fromEntries(analyses.map(item => [item.id, referenceContentIdentity(item)])),
    referenceAnalyses: Object.fromEntries(analyses.map(item => [item.id,
      benchmarkAnalysisForRecord(item, jsonObject<Record<string, unknown>>(item.aiAnalysis, {})),
    ])),
    referenceAdmissions: Object.fromEntries(analyses.map(item => [item.id,
      productionReferenceAdmission(benchmarkAnalysisForRecord(item, jsonObject<Record<string, unknown>>(item.aiAnalysis, {}))),
    ])),
    materialIds: [
      ...enterpriseMaterialIds(tenantId, selectedProducts, selectedProducts.map(product => rawProducts.indexOf(product))),
      ...associatedMaterialRows.filter(row => selectedProducts.some(product => row.association?.productId === stableProductId(product, rawProducts.indexOf(product)))).map(row => row.item.id),
    ],
  };
}
