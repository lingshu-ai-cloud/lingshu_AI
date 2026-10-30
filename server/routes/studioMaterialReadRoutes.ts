import { productSceneMaterialProvenanceOf } from './studioProductSceneProvenance.js';
import { buildStudioProductScenePreparationSlots, productSceneSourceImageUrl, scopeProductSceneProjection } from './studioProductSceneProjection.js';
import { projectStudioMaterialLibrary } from './studioMaterialLibraryProjection.js';
import { enterpriseProductMaterials, materialResponse, type Material } from './studioMaterialProjection.js';
import { loadStudioPublishLinks } from './studioPublishLinkRoutes.js';
import { productIdentity } from '../digitalEmployees/contentProductionPlanning.js';
import { isMaterialAnalysisActive } from '../lib/materialLibraryAnalysis.js';
import { productCutoutProcessingState } from '../lib/productCutoutPipeline.js';
import { readMaterialLibrary } from '../lib/materialLibrary.js';
import fs from 'fs';
import path from 'path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { readTenantEnterpriseProfile } from './enterprise.js';
import { materialUsage } from '../lib/materialPolicy.js';
import { fetchCloudMaterial, getCloudMaterialRecord } from '../lib/cloudMaterials.js';
import { type AuthLocals } from '../middleware/auth.js';
import { signAssetUrl, signPathAssetUrl } from '../lib/assetAccess.js';
import { isSyntheticMaterial } from '../lib/materialTruthfulness.js';
import { materialUsageSummariesFromProjects, type StudioMaterialUsageProject } from '../lib/materialUsageTracking.js';
import { EMPTY_MATERIAL_USAGE_SUMMARY, type MaterialUsageSummary } from '../../shared/contracts/materialUsageTracking.js';

import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioMaterialReadRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter' | 'listAllTenantRows' | 'loadDurableMaterialPublishLinks' | 'extractPoster'>) {
  const studioRouter = deps.studioRouter;
  function listAllTenantRows<T extends { id?: string }>(collection: string, tenantId: string): Promise<T[]> { return deps.listAllTenantRows<T>(collection, tenantId); }
  const loadDurableMaterialPublishLinks: StudioApplicationPorts['loadDurableMaterialPublishLinks'] = (...args) => deps.loadDurableMaterialPublishLinks(...args);
  const extractPoster: StudioApplicationPorts['extractPoster'] = (...args) => deps.extractPoster(...args);

  function registerGetMaterials() {
    studioRouter.get('/materials', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const scope = req.query.scope as string | undefined;
      const purpose = String(req.query.purpose || 'library');
      const [inventory, enterpriseProfile] = await Promise.all([
        // The gallery already projects profile assets below. Byte verification
        // belongs to production admission, not every paginated inventory read.
        readMaterialLibrary(tenantId, { includeEnterpriseProductImages: false }),
        readTenantEnterpriseProfile(tenantId),
      ]);
      // Listing the library is read-only. Analysis is started only by an explicit
      // selected-material action below; opening a page must never scan every local
      // video, call a provider or consume a production budget.
      const productReferences = (enterpriseProfile.products.items || []).map((product, index) => ({
        id: productIdentity(product, index),
        name: String(product.name || '').trim(),
        sku: String(product.sku || '').trim(),
      })).filter(product => product.name);
      const projection = projectStudioMaterialLibrary({
        enterpriseMaterials: enterpriseProductMaterials(tenantId, enterpriseProfile),
        inventoryMaterials: inventory.items as Material[],
        productReferences,
        tenantId,
        query: req.query as Record<string, unknown>,
      });
      if (projection.error) { res.status(400).json({ error: projection.error }); return; }
      const {
        sceneMaterials: productSceneProjectionMaterials,
        filteredMaterials: list,
        pageItems: sorted,
        total, inventoryTotal, page, pageSize, facets, productIdFilter,
      } = projection;
      let usageByMaterial = new Map<string, MaterialUsageSummary>();
      try {
        const projects = await listAllTenantRows<StudioMaterialUsageProject>('studio_projects', tenantId);
        usageByMaterial = materialUsageSummariesFromProjects({
          projects,
          publishLinks: [...loadStudioPublishLinks(tenantId), ...await loadDurableMaterialPublishLinks(tenantId, projects)],
          knownMaterialIds: list.map(material => material.id),
        });
      } catch {
        // The material library remains usable when historical project or metric
        // storage is temporarily unavailable; usage evidence simply stays empty.
      }
      const response = await Promise.all(sorted.map(async m => ({
        ...(await materialResponse(m, tenantId)),
        ...(m.type === 'image' && m.productId && m.materialV2?.contentRole !== 'transparent_cutout'
          && ['enterprise_product_table', 'enterprise_upload', 'enterprise_product_image_import'].includes(String(m.sourceType || ''))
          ? { productImageProcessing: {
            analysis: ['pending', 'analyzing', 'completed', 'failed'].includes(String(m.segmentAnalysisStatus || ''))
              ? m.segmentAnalysisStatus : 'pending',
            cutout: inventory.items.some(item => item.productId === m.productId
              && item.materialV2?.contentRole === 'transparent_cutout' && !item.libraryRemovedAt
              && (!item.provenance?.cutoutSourceSha256 || item.provenance.cutoutSourceSha256 === m.contentSha256))
              ? 'completed' : productCutoutProcessingState(tenantId, String(m.productId))
                && [m.contentSha256, ''].includes(productCutoutProcessingState(tenantId, String(m.productId))!.sourceSha256)
                ? productCutoutProcessingState(tenantId, String(m.productId))!.status : 'pending',
          } } : {}),
        usage: materialUsage(m),
        usageSummary: usageByMaterial.get(m.id) || {
          ...EMPTY_MATERIAL_USAGE_SUMMARY,
          metrics: { ...EMPTY_MATERIAL_USAGE_SUMMARY.metrics },
          history: [],
        },
        ...(['pending','analyzing'].includes(m.segmentAnalysisStatus || '') && !isMaterialAnalysisActive(tenantId,m.id)
          ? {segmentAnalysisStatus:'failed' as const, segmentAnalysisError:'分析任务已中断，请重试以继续处理原片'} : {}),
      })));
      const productSceneProjection = req.query.envelope === '1'
        ? scopeProductSceneProjection({
          products: (enterpriseProfile.products.items || [])
            .filter(product => String(product.name || product.sku || '').trim()) as unknown as Record<string, unknown>[],
          materials: productSceneProjectionMaterials,
          productId: productIdFilter,
        })
        : { products: [], materials: [] as Material[] };
      const productSceneSlots = req.query.envelope === '1'
        ? buildStudioProductScenePreparationSlots({
          products: productSceneProjection.products,
          materials: await Promise.all(productSceneProjection.materials
            .filter(material => Boolean(productSceneMaterialProvenanceOf(material as unknown as Record<string, unknown>))
              || (material.type === 'image' && Boolean(String(material.productId || '').trim())))
            .map(material => materialResponse(material, tenantId))) as unknown as Record<string, unknown>[],
          resolveSourceImageUrl: product => {
            const raw = productSceneSourceImageUrl(product);
            return /^\/(?:cloud-files|studio-media)\//.test(raw)
              ? signPathAssetUrl(raw, tenantId, 24 * 60 * 60 * 1000)
              : /^\/(?:media|api\/overseas\/studio\/materials\/pb)\//.test(raw)
                ? signAssetUrl(raw, tenantId)
                : raw;
          },
        })
        : [];
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      if (req.query.envelope === '1') res.status(inventory.status === 'unavailable' ? 503 : 200).json({ ...inventory, items: response, total, inventoryTotal, page, pageSize, facets, productSceneSlots });
      else { res.setHeader('X-Material-Library-Status', inventory.status); res.json(response); }
    });
  }

  function registerGetMaterialsIdUsage() {
    studioRouter.get('/materials/:id/usage', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const [inventory, enterpriseProfile] = await Promise.all([
        readMaterialLibrary(tenantId),
        readTenantEnterpriseProfile(tenantId),
      ]);
      const materialId = String(req.params.id || '').trim();
      const accessibleIds = new Set([
        ...inventory.items.map(item => item.id),
        ...enterpriseProductMaterials(tenantId, enterpriseProfile).map(item => item.id),
      ]);
      if (!accessibleIds.has(materialId)) {
        res.status(404).json({ ok: false, error: 'Material not found' });
        return;
      }
      const projects = await listAllTenantRows<StudioMaterialUsageProject>('studio_projects', tenantId);
      const summary = materialUsageSummariesFromProjects({
        projects,
        publishLinks: [...loadStudioPublishLinks(tenantId), ...await loadDurableMaterialPublishLinks(tenantId, projects)],
        knownMaterialIds: [materialId],
      }).get(materialId) || {
        ...EMPTY_MATERIAL_USAGE_SUMMARY,
        metrics: { ...EMPTY_MATERIAL_USAGE_SUMMARY.metrics },
        history: [],
      };
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.json({ ok: true, materialId, summary });
    });
  }

  function registerGetMaterialsPbIdKind() {
    studioRouter.get('/materials/pb/:id/:kind', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const field = req.params.kind === 'poster' ? 'posterFile' : req.params.kind === 'media' ? 'videoFile' : null;
      if (!field) { res.status(404).end(); return; }
      if (!await getCloudMaterialRecord(req.params.id, tenantId)) { res.status(404).end(); return; }
      let upstream = await fetchCloudMaterial(req.params.id, field, req.headers.range, tenantId);
      if (!upstream && field === 'posterFile') {
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-material-poster-'));
        const mediaPath = path.join(temporary, 'media');
        const posterPath = path.join(temporary, 'poster.jpg');
        try {
          const media = await fetchCloudMaterial(req.params.id, 'videoFile', undefined, tenantId);
          if (media?.ok) {
            fs.writeFileSync(mediaPath, Buffer.from(await media.arrayBuffer()), { mode: 0o600 });
            if (await extractPoster(mediaPath, posterPath, 1)) {
              res.setHeader('Content-Type', 'image/jpeg');
              res.setHeader('Cache-Control', 'private, max-age=3600');
              res.send(fs.readFileSync(posterPath));
              return;
            }
          }
        } finally {
          fs.rmSync(temporary, { recursive: true, force: true });
        }
      }
      if (!upstream || !upstream.body) { res.status(404).end(); return; }
      for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
        const value = upstream.headers.get(header);
        if (value) res.setHeader(header, value);
      }
      res.setHeader('Cache-Control', field === 'posterFile' ? 'private, max-age=86400' : 'private, max-age=3600');
      res.setHeader('Vary', 'Cookie, Authorization');
      res.status(upstream.status);
      Readable.fromWeb(upstream.body as any).pipe(res);
    });
  }

  function isMockMaterial(m: Material): boolean {
    return (m.scope ?? 'own') === 'shared'
      || /^sh-/.test(m.id)
      || isSyntheticMaterial(m as unknown as Record<string, unknown>);
  }

  return { registerGetMaterials, registerGetMaterialsIdUsage, registerGetMaterialsPbIdKind };
}
