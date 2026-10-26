import { tenantUploadUsesReservedOrigin } from '../lib/industryMaterialAccess.js';
import { productSceneMaterialBindingChanges, productSceneMaterialProductAssociationChanges, productSceneMaterialProvenanceOf, recordObject } from './studioProductSceneProvenance.js';
import { productSceneMaterialProductionEligible } from './studioProductSceneProjection.js';
import { materialResponse, type Material } from './studioMaterialProjection.js';
import { productSceneUploadErrorResponse, resolveMaterialUploadProductBinding, resolveProductSceneUploadIntent, verifyProductSceneUpload, type MaterialUploadProductBinding, type ProductSceneUploadIntent, type VerifiedProductSceneUpload } from './studioProductSceneUpload.js';
import { autoFulfillProductionInputRequestsForMaterial } from '../production/productionInputRequests.js';
import { materialAssetV2FromRecord, normalizeMaterialAssetV2 } from '../../shared/contracts/materialAssetV2.js';
import { productIdentity } from '../digitalEmployees/contentProductionPlanning.js';
import { requestMaterialAnalysis, saveMaterialSegmentsWithScriptAnalysis } from '../lib/materialLibraryAnalysis.js';
import { hideLocalMaterialFromLibrary, readMaterialLibrary, updateLocalMaterial } from '../lib/materialLibrary.js';
import { PRODUCT_SCENE_KINDS, type ProductSceneKind } from '../../shared/contracts/productScenePreparation.js';
import fs from 'fs';
import path from 'path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { readTenantEnterpriseProfile } from './enterprise.js';
import { store } from '../storage/index.js';
import { assertExactMaterialProductBindingImmutable, deleteOwnedCloudMaterial, getOwnedCloudMaterialRecord, updateCloudMaterial } from '../lib/cloudMaterials.js';
import { type MaterialSegment } from './studioMaterialAnalysisSegments.js';
import { type AuthLocals } from '../middleware/auth.js';
import { objectStorageDelete } from '../storage/objectStorage.js';
import { materialAssetContentType, materialAssetTypeAllowed } from '../storage/materialAssets.js';
import { MATERIAL_THEMES } from '../../shared/materialTaxonomy.js';
import { MEDIA_DIR, MAX_MATERIAL_UPLOAD_BYTES } from '../studio/runtimeConfig.js';
import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioMaterialMutationRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter' | 'materialUploadFileName' | 'saveMaterialUploadToDatabase' | 'loadMaterials' | 'persistMaterials'>) {
  const studioRouter = deps.studioRouter;
  const materialUploadFileName: StudioApplicationPorts['materialUploadFileName'] = (...args) => deps.materialUploadFileName(...args);
  const saveMaterialUploadToDatabase: StudioApplicationPorts['saveMaterialUploadToDatabase'] = (...args) => deps.saveMaterialUploadToDatabase(...args);
  const loadMaterials: StudioApplicationPorts['loadMaterials'] = (...args) => deps.loadMaterials(...args);
  const persistMaterials: StudioApplicationPorts['persistMaterials'] = (...args) => deps.persistMaterials(...args);

  function registerPostMaterials() {
    studioRouter.post('/materials', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      if (tenantUploadUsesReservedOrigin(req.body || {})) { res.status(403).json({ ok: false, error: '官方行业素材与系统生成来源不能通过用户上传设置' }); return; }
      const { name, folder = 'upload', type, duration = 0, width = 0, height = 0, dataBase64, mimeType, usage, sourceType, sourceUrl, productId, productSceneType, rightsConfirmed = false } = req.body ?? {};
      if (!dataBase64 || !type) { res.status(400).json({ ok: false, error: 'dataBase64 and type required' }); return; }
      if (!['video', 'image', 'audio'].includes(type)) { res.status(400).json({ ok: false, error: 'invalid type' }); return; }
      let productSceneIntent: ProductSceneUploadIntent | undefined;
      let productBinding: MaterialUploadProductBinding | undefined;
      try {
        productSceneIntent = await resolveProductSceneUploadIntent({
          tenantId,
          type: String(type),
          sourceType: String(sourceType || ''),
          productId,
          productSceneType,
        });
        productBinding = productSceneIntent ? undefined : await resolveMaterialUploadProductBinding(tenantId, productId);
      } catch (error) {
        const response = productSceneUploadErrorResponse(error);
        res.status(response?.status || 503).json({ ok: false, error: response?.message || '产品资料暂不可读取，请稍后重试' });
        return;
      }

      const file = materialUploadFileName(type, String(mimeType || ''));
      const buf = Buffer.from(String(dataBase64).replace(/^data:[^,]+,/, ''), 'base64');
      const contentType = materialAssetContentType(file, String(mimeType || ''));
      if (!materialAssetTypeAllowed(contentType)) { res.status(415).json({ ok: false, error: 'unsupported material type' }); return; }
      if (!buf.length || buf.length > MAX_MATERIAL_UPLOAD_BYTES) { res.status(413).json({ ok: false, error: 'material must be between 1 byte and 100 MB' }); return; }
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-material-upload-'));
      const tempFile = path.join(tempDir, file);
      fs.writeFileSync(tempFile, buf, { mode: 0o600 });
      const sha256 = createHash('sha256').update(buf).digest('hex');
      let productScene: VerifiedProductSceneUpload | undefined;
      try {
        productScene = await verifyProductSceneUpload(productSceneIntent, tempFile, sha256);
      } catch (error) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        const response = productSceneUploadErrorResponse(error);
        res.status(response?.status || 422).json({ ok: false, error: response?.message || '视频文件校验失败' });
        return;
      }

      try {
        const material = await saveMaterialUploadToDatabase({
          tenantId, name: String(name || ''), folder: String(folder || 'upload'), type,
          duration: Number(duration) || 0, width: Number(width) || 0, height: Number(height) || 0,
          usage: String(usage || ''), sourceType: String(sourceType || ''), sourceUrl: String(sourceUrl || ''),
          mimeType: contentType, mediaName: file, mediaPath: tempFile, sizeBytes: buf.length,
          sha256, tempDirectory: tempDir, productScene, productBinding, rightsConfirmed: rightsConfirmed === true,
        });
        if (['video', 'image'].includes(material.type)) {
          void requestMaterialAnalysis(tenantId, material.id).catch(() => {});
        }
        res.status(201).json({ ok: true, material: await materialResponse(material, tenantId) });
      } catch (error) {
        console.error('[materials] database upload failed', error instanceof Error ? error.message : error);
        res.status(503).json({ ok: false, error: '素材数据库暂时不可用，请稍后重试' });
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  }

  function registerPostMaterialsIdAnalysis() {
    studioRouter.post('/materials/:id/analysis', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      try { res.status(202).json({ ok: true, ...(await requestMaterialAnalysis(tenantId, req.params.id, req.body?.retry === true)) }); }
      catch (error) { res.status(409).json({ ok: false, error: error instanceof Error ? error.message : '素材分析无法启动' }); }
    });
  }

  function registerPatchMaterialsIdSegmentsSegmentId() {
    studioRouter.patch('/materials/:id/segments/:segmentId', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      try {
        const inventory = await readMaterialLibrary(tenantId);
        const material = inventory.items.find(item => item.id === req.params.id && item.tenantId === tenantId && item.scope !== 'shared');
        const segments = structuredClone(material?.segments || []) as MaterialSegment[];
        const segment = segments.find(item => item.id === req.params.segmentId);
        if (!material || !segment) { res.status(404).json({ok:false,error:'素材片段不存在或不可编辑'}); return; }
        const editable = ['start','end','subject','action','shot','camera','environment','needsReview','manualConfirmed'] as const;
        for (const key of editable) if (key in (req.body || {})) (segment as any)[key] = req.body[key];
        const start = Number(segment.start), end = Number(segment.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > Number(material.duration)) {
          res.status(400).json({ok:false,error:'片段时间必须位于原视频范围内'}); return;
        }
        segment.start=start; segment.end=end; segment.duration=end-start;
        if (segment.manualConfirmed === true) { segment.needsReview=false; segment.confidence=Math.max(.65,Math.min(1,Number(segment.confidence)||0)); }
        const scriptAnalysis = await saveMaterialSegmentsWithScriptAnalysis(tenantId, material, segments as unknown as Array<Record<string, unknown>>);
        res.json({ok:true,material:await materialResponse({...material,segments,scriptAnalysis} as Material,tenantId),segment});
      } catch(error) {res.status(503).json({ok:false,error:error instanceof Error ? error.message : '片段修改失败'});}
    });
  }

  function registerPatchMaterialsIdPin() {
    studioRouter.patch('/materials/:id/pin', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const pinned = req.body?.pinned !== false;
      // 云端素材同样不在 data/materials.json 里，直接写回 PocketBase。
      if (req.params.id.startsWith('pb-')) {
        const pbId = req.params.id.slice(3);
        if (!await getOwnedCloudMaterialRecord(pbId, tenantId)) { res.status(404).json({ ok: false, error: 'Material not found' }); return; }
        const saved = await updateCloudMaterial(pbId, { pinned });
        if (!saved) { res.status(500).json({ ok: false, error: '置顶写回云端失败' }); return; }
        res.json({ ok: true, material: { id: req.params.id, pinned } });
        return;
      }
      const list = loadMaterials();
      const material = list.find(item => item.id === req.params.id && item.tenantId === tenantId);
      if (!material) { res.status(404).json({ ok: false, error: 'Material not found' }); return; }
      material.pinned = pinned;
      persistMaterials(list);
      res.json({ ok: true, material });
    });
  }

  function registerGetMaterialProducts() {
    studioRouter.get('/material-products', async (_req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      try {
        const profile = await readTenantEnterpriseProfile(tenantId);
        res.json({items: (profile.products.items || []).map((item,index) => ({id:productIdentity(item,index),name:item.name,
          imageUrls:[...new Set([item.imageUrl,...(item.images||[]).map(image=>image.url),...(item.packagingImages||[]).map(image=>image.url)].filter((url):url is string=>typeof url==='string'&&Boolean(url.trim())))].slice(0,4),
        })).filter(item => item.name)});
      } catch { res.status(503).json({error:'产品资料暂不可读取，请稍后重试'}); }
    });
  }

  function registerPatchMaterialsIdGeneratedImageReview() {
    studioRouter.patch('/materials/:id/generated-image-review', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const inventory = await readMaterialLibrary(tenantId);
      const material = inventory.items.find(item => item.id === req.params.id && item.tenantId === tenantId && item.scope !== 'shared');
      if (!material) { res.status(404).json({ ok: false, error: '生成图片不存在或不可编辑' }); return; }
      if (material.type !== 'image' || material.sourceType !== 'ai_generated_marketing_image') {
        res.status(409).json({ ok: false, error: '只有当前工作流生成的营销图片可以在这里确认' }); return;
      }
      if (req.body?.accepted !== true) { res.status(400).json({ ok: false, error: '请明确确认图片已通过人工复核' }); return; }
      const changes = {
        provenance: {
          ...recordObject(material.provenance),
          qualityStatus: 'accepted',
          confirmed: true,
          confirmationSource: 'user',
          generatedImageReview: {
            schemaVersion: 'generated-image-review.v1',
            status: 'accepted',
            reviewedAt: new Date().toISOString(),
          },
        },
      };
      const saved = material.id.startsWith('pb-')
        ? Boolean(await getOwnedCloudMaterialRecord(material.id.slice(3), tenantId))
        && await updateCloudMaterial(material.id.slice(3), changes)
        : updateLocalMaterial(material.id, tenantId, changes);
      if (!saved) { res.status(500).json({ ok: false, error: '图片复核结果保存失败' }); return; }
      const nextMaterial = { ...(material as unknown as Material), ...changes } as Material;
      void requestMaterialAnalysis(tenantId, material.id).catch(() => {});
      res.json({ ok: true, material: await materialResponse(nextMaterial, tenantId) });
    });
  }

  function registerPatchMaterialsId() {
    studioRouter.patch('/materials/:id', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      try {
        const inventory = await readMaterialLibrary(tenantId);
        const material = inventory.items.find(item => item.id === req.params.id && item.tenantId === tenantId && item.scope !== 'shared');
        if (!material) { res.status(404).json({ok:false,error:'素材不存在或不可编辑'}); return; }
        const body = recordObject(req.body);
        const hasName = Object.prototype.hasOwnProperty.call(body, 'name');
        const name = String(hasName ? body.name : material.name || '').trim().slice(0,120);
        if (!name) { res.status(400).json({ok:false,error:'请填写素材名称'}); return; }
        const changes: Record<string,unknown> = hasName ? {name} : {};
        if ('tags' in body) changes.tags = String(body.tags || '').trim().slice(0,500);
        const hasProductSceneType = Object.prototype.hasOwnProperty.call(body, 'productSceneType');
        const requestedProductId = String('productId' in body ? body.productId || '' : material.productId || '').trim();
        const existingSceneBinding = productSceneMaterialProvenanceOf(material as unknown as Record<string, unknown>);
        let product: NonNullable<Awaited<ReturnType<typeof readTenantEnterpriseProfile>>['products']['items']>[number] | undefined;
        if ('productId' in body || hasProductSceneType) {
          const profile = await readTenantEnterpriseProfile(tenantId);
          product = (profile.products.items || []).find((item,index) => productIdentity(item,index) === requestedProductId);
          if (requestedProductId && !product) { res.status(400).json({ok:false,error:'关联产品不在当前企业资料中'}); return; }
          if (hasProductSceneType && !product) { res.status(400).json({ok:false,error:'请先选择当前企业资料中的产品'}); return; }
          Object.assign(changes, 'productId' in body
            ? productSceneMaterialProductAssociationChanges({
              material: { ...material, ...changes },
              productId: requestedProductId,
              productName: String(product?.name || ''),
            })
            : { productId: requestedProductId, productName: product?.name || '' });
        }
        const finalProductId = requestedProductId;
        if ('primaryTheme' in body) {
          const theme = String(body.primaryTheme || '');
          if (!MATERIAL_THEMES.includes(theme as any)) { res.status(400).json({ok:false,error:'主题标签无效'}); return; }
          changes.primaryTheme = theme;
          changes.themeTags = [theme];
          changes.classificationStatus = 'completed';
          changes.classificationSource = 'user';
        }
        if ('materialV2' in body || 'enterpriseCommon' in body) {
          const current = material.materialV2 || (material.provenance && typeof material.provenance === 'object'
            ? material.provenance.materialAssetV2 : undefined) || {};
          const metadata = normalizeMaterialAssetV2({
            ...(current as Record<string, unknown>),
            ...(body.materialV2 && typeof body.materialV2 === 'object' && !Array.isArray(body.materialV2) ? body.materialV2 : {}),
            ...('enterpriseCommon' in body ? { enterpriseCommon: body.enterpriseCommon === true } : {}),
          });
          changes.provenance = {
            ...recordObject(changes.provenance || material.provenance),
            materialAssetV2: metadata,
            ...('materialV2' in body ? { materialAssetV2Source: 'user' } : {}),
          };
        }
        const effectiveMetadata = materialAssetV2FromRecord({
          ...(material as unknown as Record<string, unknown>),
          ...(changes.provenance ? { provenance: changes.provenance } : {}),
        });
        const effectiveEnterpriseCommon = effectiveMetadata
          ? effectiveMetadata.enterpriseCommon
          : material.enterpriseCommon === true;
        if (effectiveEnterpriseCommon && finalProductId) {
          res.status(400).json({ ok: false, code: 'enterprise_common_product_binding_conflict', error: '企业通用素材不能同时绑定具体产品' }); return;
        }
        if (effectiveMetadata?.productIdentityLevel === 'exact' && !finalProductId) {
          res.status(400).json({ ok: false, code: 'exact_product_binding_required', error: '精准产品素材必须绑定具体产品' }); return;
        }
        try {
          assertExactMaterialProductBindingImmutable(
            material as unknown as Record<string, unknown>,
            finalProductId,
            effectiveMetadata,
          );
        } catch (error) {
          if (error instanceof Error && error.message === 'exact_product_binding_immutable') {
            res.status(409).json({ ok: false, code: 'exact_product_binding_immutable', error: '精准产品素材已锁定原产品；同一文件不能改绑到其他产品' }); return;
          }
          throw error;
        }
        if (hasProductSceneType) {
          const kind = String(body.productSceneType || '') as ProductSceneKind;
          if (!PRODUCT_SCENE_KINDS.includes(kind)) { res.status(400).json({ok:false,error:'产品预制场景类型无效'}); return; }
          if (!existingSceneBinding) {
            res.status(409).json({ok:false,error:'请从产品素材详情中上传预制素材，系统需要校验原始视频文件'});
            return;
          }
          if (!productSceneMaterialProductionEligible(material as unknown as Record<string, unknown>, existingSceneBinding)) {
            res.status(409).json({ok:false,error:'该素材的原始文件校验凭证已失效，请重新上传'});
            return;
          }
          Object.assign(changes, productSceneMaterialBindingChanges({
            material: { ...material, ...changes },
            productId: requestedProductId,
            productName: String(product?.name || ''),
            kind,
            verification: {
              durationSeconds: existingSceneBinding.verifiedDurationSeconds,
              width: existingSceneBinding.verifiedWidth,
              height: existingSceneBinding.verifiedHeight,
              decodedFrameCount: existingSceneBinding.decodedFrameCount,
              verificationMethod: existingSceneBinding.verificationMethod,
              contentSha256: existingSceneBinding.contentSha256,
            },
          }));
        }
        const saved = material.id.startsWith('pb-')
          ? Boolean(await getOwnedCloudMaterialRecord(material.id.slice(3), tenantId)) && await updateCloudMaterial(material.id.slice(3), {...changes,...(hasName ? {title:name} : {})})
          : updateLocalMaterial(material.id,tenantId,changes);
        if (!saved) throw Error('素材修改保存失败');
        const nextMaterial = { ...material, ...changes } as Material;
        let fulfilledProductionInputRequestIds: string[] = [];
        let productionInputSyncWarning: string | undefined;
        try {
          const fulfilledRequests = await autoFulfillProductionInputRequestsForMaterial({
            store,
            tenantId,
            material: nextMaterial as unknown as Record<string, unknown>,
          });
          fulfilledProductionInputRequestIds = fulfilledRequests.map(item => item.id);
        } catch (error) {
          // The material update already committed. Never report it as failed and
          // tempt the client to create duplicate uploads; reconciliation can retry.
          productionInputSyncWarning = error instanceof Error ? error.message : 'production_input_reconcile_failed';
        }
        res.json({ok:true,material:await materialResponse(nextMaterial,tenantId),fulfilledProductionInputRequestIds,...(productionInputSyncWarning ? { productionInputSyncWarning } : {})});
      } catch (error) { res.status(503).json({ok:false,error:error instanceof Error ? error.message : '素材修改失败'}); }
    });
  }

  function registerDeleteMaterialsId() {
    studioRouter.delete('/materials/:id', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const projects = await store.list<any>('studio_projects', { where: { tenant_id: tenantId }, perPage: 500 });
      const materialId = String(req.params.id);
      const referencedBy = projects.items.filter(project => {
        const visit = (value: unknown, key = ''): boolean => {
          if (Array.isArray(value)) return value.some(item => visit(item, key));
          if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>)
            .some(([childKey, child]) => visit(child, childKey));
          if (key === 'spec' && typeof value === 'string') {
            try { return visit(JSON.parse(value), ''); } catch { return false; }
          }
          return /materialid$/i.test(key) && String(value || '') === materialId;
        };
        return visit(project.spec, 'spec');
      });
      if (referencedBy.length) {
        if (materialId.startsWith('pb-')) {
          res.status(409).json({ ok: false, error: '云素材仍被制作项目引用，请先从相关分镜移除',
            references: referencedBy.map(project => ({ projectId: project.id, title: project.title })) });
          return;
        }
        const current = loadMaterials();
        const hidden = hideLocalMaterialFromLibrary(current, materialId, tenantId, new Date().toISOString());
        if (!hidden.material) { res.status(404).json({ ok: false, error: 'Material not found' }); return; }
        persistMaterials(hidden.records as Material[]);
        res.json({ ok: true, retainedForProjectReferences: true });
        return;
      }
      if (req.params.id.startsWith('pb-')) {
        try {
          const result = await deleteOwnedCloudMaterial(req.params.id.slice(3), tenantId);
          if (result === 'not_found') { res.status(404).json({ ok: false, error: 'Material not found' }); return; }
          res.json({ ok: true });
        } catch (error) {
          res.status(503).json({ ok: false, error: error instanceof Error ? error.message : '素材数据库删除失败' });
        }
        return;
      }
      const list = loadMaterials();
      const m = list.find(x => x.id === req.params.id && x.tenantId === tenantId);
      if (!m) { res.status(404).json({ ok: false, error: 'Material not found' }); return; }
      if (m.scope === 'shared') { res.status(403).json({ ok: false, error: 'Shared materials are read-only' }); return; }
      // A social-task upload and its material entry intentionally share one
      // immutable object. Removing it from My Materials must not break the task's
      // auditable file reference; the task owns the bytes until task retention
      // handles them separately.
      const taskBacked = m.sourceType === 'social_task_upload'
        || (Array.isArray((m as Material & { sourceTaskFileRefs?: unknown[] }).sourceTaskFileRefs)
          && (m as Material & { sourceTaskFileRefs?: unknown[] }).sourceTaskFileRefs!.length > 0);
      if (m.objectKey) {
        if (!taskBacked) await objectStorageDelete(m.objectKey).catch(error => console.error('[materials] COS delete failed', error));
      } else try { fs.unlinkSync(path.join(MEDIA_DIR, m.file)); } catch { /* file may be gone */ }
      if (m.posterObjectKey && m.posterObjectKey !== m.objectKey) await objectStorageDelete(m.posterObjectKey).catch(error => console.error('[materials] COS poster delete failed', error));
      if (m.poster && m.poster !== m.url) { try { fs.unlinkSync(path.join(MEDIA_DIR, m.poster.replace(/^\/media\//, ''))); } catch { /* ignore */ } }
      for (const segment of m.segments || []) {
        if (segment.posterObjectKey) await objectStorageDelete(segment.posterObjectKey).catch(error => console.error('[materials] COS segment poster delete failed', error));
        else if (segment.poster) try { fs.unlinkSync(path.join(MEDIA_DIR, segment.poster.replace(/^\/media\//, ''))); } catch { /* ignore */ }
      }
      persistMaterials(list.filter(x => x.id !== req.params.id));
      res.json({ ok: true });
    });
  }

  return { registerPostMaterials, registerPostMaterialsIdAnalysis, registerPatchMaterialsIdSegmentsSegmentId, registerPatchMaterialsIdPin, registerGetMaterialProducts, registerPatchMaterialsIdGeneratedImageReview, registerPatchMaterialsId, registerDeleteMaterialsId };
}
