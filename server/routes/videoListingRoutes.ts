import type { RequestHandler, Router } from 'express';
import type { AuthLocals } from '../middleware/auth.js';
import { publicVideoRecord } from './videoPublicRecordProjection.js';
import { type ContentFormat } from './videoRecordVisibility.js';
import { createVideoTenantListing, withImagePublicBaselines } from './videoTenantListing.js';
import { readMaterialLibrary } from '../lib/materialLibrary.js';
import { readTenantEnterpriseProfile } from './enterprise.js';
import { enterpriseProductMaterials } from './studioMaterialProjection.js';
import { projectStudioMaterialLibrary } from './studioMaterialLibraryProjection.js';
import { productIdentity } from '../digitalEmployees/contentProductionPlanning.js';
import { recordsToVideos, type CrawlerRecord } from '../../src/components/inspiration/inspirationVideoProjection.js';
import { buildShootingNeeds } from '../../src/components/inspiration/inspirationShootingNeeds.js';
import type { Material } from '../../src/lib/studioApi.js';

type TenantListing = ReturnType<typeof createVideoTenantListing>;

async function shootingMaterialsForTenant(tenantId: string): Promise<Material[]> {
  const [inventory, profile] = await Promise.all([readMaterialLibrary(tenantId), readTenantEnterpriseProfile(tenantId)]);
  if (inventory.status === 'unavailable') throw new Error('Material inventory unavailable');
  const productReferences = (profile.products.items || []).map((product, index) => ({
    id: productIdentity(product, index), name: String(product.name || '').trim(), sku: String(product.sku || '').trim(),
  })).filter(product => product.name);
  return projectStudioMaterialLibrary({
    enterpriseMaterials: enterpriseProductMaterials(tenantId, profile) as unknown as Material[],
    inventoryMaterials: inventory.items as Material[], productReferences, tenantId, query: { purpose: 'library' },
  }).filteredMaterials;
}

// Express 4 does not consume rejected async handlers. A failed strict store
// read must return an unavailable response instead of terminating the server.
function listingRead(handler: (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) => Promise<void>): RequestHandler {
  return (req, res) => {
    void handler(req, res).catch(() => {
      console.warn('[videos] VIDEO_LIST_UNAVAILABLE', { tenantId: String(res.locals.tenantId || '') });
      if (res.headersSent) { res.end(); return; }
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.setHeader('Retry-After', '5');
      res.status(503).json({ error: '素材列表暂时无法读取，请稍后重试', code: 'VIDEO_LIST_UNAVAILABLE', retryable: true });
    });
  };
}

export function registerVideoListingRoutes(router: Router, input: {
  listing: TenantListing;
  tenantAnalysisQueuePositions: (tenantId: string) => Promise<Map<string, number>>;
  withSignedThumbnail: (record: Record<string, unknown>, tenantId: string) => Record<string, unknown>;
  loadShootingMaterials?: (tenantId: string) => Promise<Material[]>;
}): void {
  const { listPublicVideosForTenant, tenantInventoryTotal } = input.listing;
  const { tenantAnalysisQueuePositions, withSignedThumbnail } = input;
  const shootingCache = new Map<string, { expiresAt: number; needs: ReturnType<typeof buildShootingNeeds> }>();

// ─── GET /videos ──────────────────────────────────────────────────────────────
// Query: page, perPage, platform, status, contentFormat(video|image)

router.get('/inventory-summary', listingRead(async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const rawContentFormat = String(_req.query.contentFormat || 'video');
  const contentFormat: ContentFormat = rawContentFormat === 'image' ? 'image' : 'video';
  const [totalItems, visible] = await Promise.all([
    tenantInventoryTotal(tenantId, contentFormat),
    listPublicVideosForTenant({ tenantId, contentFormat, page: 1, perPage: 1, crawlRange: 'all' }),
  ]);
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.json({ contentFormat, totalItems, visibleItems: visible.totalItems });
}));

router.get('/shooting-needs', listingRead(async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const cached = shootingCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) { res.json({ needs: cached.needs }); return; }
  const materials = await (input.loadShootingMaterials || shootingMaterialsForTenant)(tenantId);
  const records: CrawlerRecord[] = [];
  for (const contentFormat of ['video', 'image'] as const) {
    const first = await listPublicVideosForTenant({ tenantId, contentFormat, page: 1, perPage: 100, crawlRange: 'all' });
    records.push(...first.items.filter(item => typeof item.id === 'string') as unknown as CrawlerRecord[]);
    for (let page = 2; page <= first.totalPages; page += 4) {
      const batch = await Promise.all(Array.from({ length: Math.min(4, first.totalPages - page + 1) }, (_, index) =>
        listPublicVideosForTenant({ tenantId, contentFormat, page: page + index, perPage: 100, crawlRange: 'all' })));
      for (const result of batch) records.push(...result.items.filter(item => typeof item.id === 'string') as unknown as CrawlerRecord[]);
    }
  }
  const needs = buildShootingNeeds(recordsToVideos(records), materials);
  shootingCache.set(tenantId, { expiresAt: Date.now() + 60_000, needs });
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.json({ needs });
}));

router.get('/', listingRead(async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const { page = '1', perPage = '20', platform, status, search, crawlRange = 'all', contentFormat: rawContentFormat = 'video' } = req.query as Record<string, string>;
  const pageNumber = Math.max(1, Number(page) || 1);
  const perPageNumber = Math.min(100, Math.max(1, Number(perPage) || 20));
  const contentFormat: ContentFormat = rawContentFormat === 'image' ? 'image' : 'video';

  // Inventory KPI: every crawled record owned by this tenant. This deliberately
  // ignores page/search/status/admin aggregation; the inspiration list below may
  // hide failed or processing records, but they still belong to the crawl total.
  const [inventoryTotalItems, result, queuePositions] = await Promise.all([
    tenantInventoryTotal(tenantId, contentFormat),
    listPublicVideosForTenant({
      tenantId,
      platform,
      status,
      contentFormat,
      search,
      crawlRange,
      page: pageNumber,
      perPage: perPageNumber,
    }),
    contentFormat === 'video' ? tenantAnalysisQueuePositions(tenantId) : Promise.resolve(new Map<string, number>()),
  ]);

  // Keep list requests read-only and fast. Repair/download/analysis work belongs
  // to crawl jobs or explicit user actions; launching it from GET made every page
  // refresh multiply expensive background work.

  if (contentFormat === 'image') {
    // listPublicVideosForTenant has already scanned and filtered the image records.
    // A second full collection scan here doubled list latency as the inspiration
    // library grew. The first page contains the latest requested page of records, which is also the
    // product definition of the public recent-account baseline.
    res.json({ ...result, inventoryTotalItems, items: withImagePublicBaselines(result.items).map(item => withSignedThumbnail({ ...item, canManage: String(item.tenantId || '') === tenantId }, tenantId)) });
    return;
  }
  res.json({
    ...result,
    inventoryTotalItems,
    items: result.items.map(item => {
      const withProgress = publicVideoRecord(item, { queuePosition: queuePositions.get(String(item.id || '')) || null });
      return withSignedThumbnail({ ...withProgress, canManage: String(item.tenantId || '') === tenantId }, tenantId);
    }),
  });
}));
}
