import fs from 'fs';
import path from 'path';
import { validatePresenterRightsEvidence } from '../lib/presenterAssetTrust.js';
import { isTenantPrivateObjectKey } from '../storage/materialAssets.js';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { store } from '../storage/index.js';
import { type ReferenceImage } from '../lib/imageGen.js';
import { materialLocalFile } from '../socialImage/studioPosterHelpers.js';
import { tenantCatalogImageFile } from '../lib/enterpriseMediaImage.js';
import { enterpriseAssetObjectKey, enterpriseAssetTenantKey } from '../storage/enterpriseAssets.js';
import { videoAnalysisOf } from '../lib/videoAnalysisCodec.js';
import { tenantAssetDir } from '../lib/assetAccess.js';
import { objectStorageEnabled, objectStorageDownload } from '../storage/objectStorage.js';
import { GENERATED_MEDIA_DIR, MEDIA_DIR } from './runtimeConfig.js';
import type { StudioApplicationPorts } from './applicationPorts.js';

export function createStoryboardReferenceAssets(deps: Pick<StudioApplicationPorts, 'loadMaterials'>) {
  const loadMaterials: StudioApplicationPorts['loadMaterials'] = (...args) => deps.loadMaterials(...args);

  function storyboardImageMime(file: string): string {
    const ext = path.extname(file).toLowerCase();
    return ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/png';
  }

  function storyboardImageUrlPath(raw: string): string {
    try { return new URL(raw, 'http://local.invalid').pathname; } catch { return ''; }
  }

  async function storyboardEnterpriseImage(url: string, tenantId: string): Promise<ReferenceImage | null> {
    const catalogFile=tenantCatalogImageFile(url,tenantId,MEDIA_DIR);
    if(catalogFile)return {mimeType:storyboardImageMime(catalogFile),base64:fs.readFileSync(catalogFile).toString('base64')};
    const route = storyboardImageUrlPath(url);
    const match = route.match(/^\/api\/overseas\/enterprise\/assets\/([\w.-]+)$/);
    if (!match) {
      // Some enterprise products are imported with an external image URL. Only
      // read the URL stored on the authenticated tenant's product record.
      if (!/^https:\/\//i.test(url)) return null;
      const target = new URL(url);
      if (target.username || target.password || target.port || isIP(target.hostname)) return null;
      const addresses = await lookup(target.hostname, { all: true }).catch(() => []);
      if (!addresses.length || addresses.some(item => {
        const ip = item.address;
        return item.family === 4
          ? /^(?:0|10|127|169\.254|172\.(?:1[6-9]|2\d|3[01])|192\.168|224|23\d|24\d|25[0-5])\./.test(ip)
          : ip === '::1' || ip === '::' || /^f[cd]/i.test(ip) || /^fe[89ab]/i.test(ip) || /^::ffff:(?:10|127|192\.168|172\.)/i.test(ip);
      })) return null;
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) }).catch(() => null);
      if (!response?.ok) return null;
      const mimeType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) return null;
      const length = Number(response.headers.get('content-length') || 0);
      if (length > 10 * 1024 * 1024) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      return bytes.length > 0 && bytes.length <= 10 * 1024 * 1024
        ? { mimeType, base64: bytes.toString('base64') } : null;
    }
    const file = path.basename(match[1]);
    const local = path.join(process.cwd(), 'data', 'enterprise-assets', enterpriseAssetTenantKey(tenantId), file);
    if (fs.existsSync(local)) return { mimeType: storyboardImageMime(file), base64: fs.readFileSync(local).toString('base64') };
    if (objectStorageEnabled()) {
      const object = await objectStorageDownload(enterpriseAssetObjectKey(tenantId, file));
      if (object?.buf?.length) return { mimeType: object.contentType || storyboardImageMime(file), base64: object.buf.toString('base64') };
    }
    return null;
  }

  async function storyboardMaterialImage(id: string, tenantId: string): Promise<ReferenceImage | null> {
    const material = loadMaterials().find(item => item.id === id && item.tenantId === tenantId && item.scope === 'own');
    if (!material) return null;
    if (material.objectKey) {
      const key = material.type === 'image' ? material.objectKey : material.posterObjectKey;
      if (!key) return null;
      const object = await objectStorageDownload(key);
      return object?.buf?.length ? { mimeType: object.contentType, base64: object.buf.toString('base64') } : null;
    }
    const local = materialLocalFile(material, MEDIA_DIR, GENERATED_MEDIA_DIR);
    return local && fs.existsSync(local) ? { mimeType: storyboardImageMime(local), base64: fs.readFileSync(local).toString('base64') } : null;
  }

  async function storyboardPersonAssetImage(id: string, tenantId: string): Promise<ReferenceImage | null> {
    const material = loadMaterials().find(item => item.id === id && item.tenantId === tenantId
      && item.scope === 'own' && item.type === 'image');
    return material ? storyboardMaterialImage(id, tenantId) : null;
  }

  async function storyboardCharacterMaterialAuthorizationIssue(tenantId: string, materialId: string): Promise<string | null> {
    const material = loadMaterials().find(item => item.id === materialId && item.tenantId === tenantId
      && item.scope === 'own' && item.type === 'image');
    if (!material) return '指定人物图片已不属于当前企业，或不是图片素材';
    if (!isTenantPrivateObjectKey(String(material.objectKey || ''), tenantId))
      return '指定人物图片缺少本企业私有存储凭据，请重新上传企业人物照片';
    let records: Awaited<ReturnType<typeof store.list<any>>>;
    try { records = await store.list<any>('studio_production_defaults', { where: { tenant_id: tenantId }, perPage: 1 }); }
    catch { return '企业人物授权记录暂不可读取'; }
    const presenters = Array.isArray(records.items[0]?.payload?.presenters) ? records.items[0].payload.presenters : [];
    const bound = presenters.filter((presenter: any) => presenter?.authorized === true
      && Array.isArray(presenter.referenceMaterialIds) && presenter.referenceMaterialIds.map(String).includes(materialId));
    if (!bound.length) return '这张图片未绑定到已授权的企业人物，请先在企业人物中绑定并确认使用权';
    if (!bound.some((presenter: any) => validatePresenterRightsEvidence(presenter.rightsEvidence,
      { provider: 'dashscope', uses: ['person_replacement', 'quality_inspection'] }).ok))
      return '人物授权缺少千问生图和质量检查用途，或授权已过期、撤销；请更新企业人物授权';
    return null;
  }

  async function storyboardUrlImage(raw: string, tenantId: string): Promise<ReferenceImage | null> {
    const route = storyboardImageUrlPath(raw);
    const shot = route.match(/^\/api\/overseas\/videos\/([\w-]+)\/shot\/(\d+)\/first-frame$/);
    if (shot) {
      const record = await store.getById<any>('trend_videos', shot[1]);
      if (!record || record.tenantId !== tenantId) return null;
      const index = Number(shot[2]) - 1;
      if (!Number.isSafeInteger(index) || index < 0) return null;
      const analysis = videoAnalysisOf(record);
      let gemini: Record<string, unknown> = {};
      if (analysis.gemini && typeof analysis.gemini === 'object') gemini = analysis.gemini as Record<string, unknown>;
      else if (typeof analysis.gemini === 'string') {
        try { gemini = JSON.parse(analysis.gemini) as Record<string, unknown>; } catch { /* no verified details */ }
      }
      const details = Array.isArray(gemini.scriptDetails15s) ? gemini.scriptDetails15s : [];
      const detail = details[index] as { materialEvidence?: { extractionStatus?: string; firstFrameObjectKey?: string } } | undefined;
      const evidence = detail?.materialEvidence;
      if (evidence?.extractionStatus !== 'ready') return null;
      const file = path.join(tenantAssetDir(MEDIA_DIR, tenantId), 'trend-shots', String(record.id), `shot-${index + 1}.jpg`);
      if (objectStorageEnabled() && evidence.firstFrameObjectKey) {
        const object = await objectStorageDownload(evidence.firstFrameObjectKey);
        if (object?.buf?.length) {
          return { mimeType: object.contentType || 'image/jpeg', base64: object.buf.toString('base64') };
        }
        // Local analyses created before object storage was configured still own
        // valid tenant-scoped evidence on disk. Enabling COS later must not make
        // those already-extracted frames unreadable or force another video pass.
      }
      return fs.existsSync(file) ? { mimeType: 'image/jpeg', base64: fs.readFileSync(file).toString('base64') } : null;
    }
    const privateMaterialFile = route.match(/^\/api\/overseas\/studio\/private-assets\/materials\/([\w.-]+)$/)?.[1];
    const material = loadMaterials().find(item => item.tenantId === tenantId && item.scope === 'own' &&
      ([item.url, item.poster].some(url => url && storyboardImageUrlPath(url) === route) ||
        (privateMaterialFile && [item.objectKey, item.posterObjectKey].some(key => key && path.basename(key) === privateMaterialFile))));
    return material ? storyboardMaterialImage(material.id, tenantId)
      : route.startsWith('/api/overseas/enterprise/assets/') ? storyboardEnterpriseImage(raw, tenantId) : null;
  }

  function storyboardIdentityNotice(layer: unknown, hasProduct: boolean): string | undefined {
    if (!hasProduct) return undefined;
    if (!layer || typeof layer !== 'object') return undefined;
    const value = layer as { strategy?: string; fallbackReason?: string };
    if (value.strategy === 'exact_source_pixels') return '已使用企业产品原图保留包装外观；请核对摆放、接触和光影。';
    if (value.strategy === 'seedream_reference_composite') return '已先用 Seedream 清除对标产品，再以企业产品图重建目标首帧；请核对产品身份、手部接触、比例和光影。';
    if (value.strategy !== 'generative' || !value.fallbackReason) return undefined;
    if (value.fallbackReason === 'hand_foreground_missing') return '手持产品缺少可对齐的手部前景，已生成普通首帧草稿；请重点核对握持接触，失败时补充真实手持参考。';
    if (/cutout|transparent|view/i.test(value.fallbackReason)) return '当前产品图缺少适合此角度的透明产品层，已生成普通首帧草稿；请核对包装文字和外观，必要时补产品图后重做。';
    if (/GEOMETRY|layout|contact_surface|observer/i.test(value.fallbackReason)) return '当前镜头的产品位置或接触面尚不够明确，已生成普通首帧草稿；请核对构图，必要时调整本镜产品位置后重做。';
    if (value.fallbackReason === 'usage_scene_requires_action') return '使用场景已生成动作起始首帧草稿；请重点核对产品与人体、工具或安装面的起始接触关系。';
    if (value.fallbackReason === 'named_person_requires_generation') return '指定人物与产品需共同生成；请核对人物身份、产品外观及两者的接触关系。';
    return '已生成普通首帧草稿；请重点核对企业产品外观与当前分镜的接触关系。';
  }

  return { storyboardImageUrlPath, storyboardEnterpriseImage, storyboardMaterialImage, storyboardPersonAssetImage, storyboardCharacterMaterialAuthorizationIssue, storyboardUrlImage, storyboardIdentityNotice };
}
