import fs from 'node:fs';
import { currentDataAuthority } from '../storage/dataAuthority.js';
import { readLocalMaterials, saveLocalMaterials } from '../lib/materialLibrary.js';
import { tenantAssetRelativePath } from '../lib/assetAccess.js';
import { materialAssetObjectKey } from '../storage/materialAssets.js';
import { objectStorageUpload, objectStorageHead } from '../storage/objectStorage.js';
import { Router, raw } from 'express';
import { createHash } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import { HeyGenPresenterClient, asianPresenterLook, mediaUrl, presenterLook } from '../lib/heygenPresenters.js';
import type { PresenterCreation, PresenterLook } from '../../src/lib/presenterAssets.js';
import type { ProductionDefaults, PresenterAsset } from '../../src/lib/shotProduction.js';
import { EMPTY_DEFAULTS } from '../../src/lib/shotProduction.js';
import { StudioPaidBudget } from '../lib/studioPaidBudget.js';
import path from 'node:path';
import { inspectPresenterVideo, presenterVideoFrame, trimPresenterVideo, type PresenterVideoInfo } from '../lib/presenterVideo.js';

const COLLECTION = 'studio_presenter_assets';
type Row = { id: string; tenant_id: string; request_id: string; kind: string; payload: any };
type Exclusive = <T>(key: string, operation: () => Promise<T>) => Promise<T>;
const validId = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_:.-]{1,150}$/.test(v);
const message = (e: unknown) => e instanceof Error ? e.message : '人物服务暂时不可用';
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const consentAccepted = (value: unknown) => ['accepted', 'approved'].includes(String(value || '').toLowerCase());
type CuratedPresenterGroup = { name: string; groupId: string; asian?: boolean };
const presenterCuration = (tenantId: string): { favoriteNames: Set<string>; asianNames: Set<string>; favoriteGroups: CuratedPresenterGroup[] } => {
  try {
    const document = JSON.parse(fs.readFileSync(path.resolve('data/heygen-presenter-curation.json'), 'utf8'));
    const tenantEntries = document?.tenants && typeof document.tenants === 'object' ? Object.values(document.tenants) : [];
    const entry = document?.tenants?.[tenantId] || (currentDataAuthority() === 'local' && tenantEntries.length === 1 ? tenantEntries[0] : {}) || {};
    const names = (value: unknown) => new Set((Array.isArray(value) ? value : []).map(item => String(item).trim().toLowerCase()).filter(Boolean));
    const favoriteGroups = (Array.isArray((entry as any).favoriteGroups) ? (entry as any).favoriteGroups : [])
      .filter((item: any) => item && typeof item.name === 'string' && typeof item.groupId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(item.groupId))
      .map((item: any) => ({ name: item.name.trim().slice(0, 100), groupId: item.groupId, asian: item.asian === true }));
    return { favoriteNames: names((entry as any).favoriteNames), asianNames: names((entry as any).asianNames), favoriteGroups };
  } catch { return { favoriteNames: new Set(), asianNames: new Set(), favoriteGroups: [] }; }
};
const curatedName = (names: Set<string>, value: string): string | undefined => {
  const normalized = value.trim().toLowerCase();
  return [...names].find(name => normalized === name || normalized.startsWith(`${name} `));
};
export function createPresenterAssetsRouter(store: DataStore, exclusive: Exclusive, options: {
  client?: HeyGenPresenterClient; configured?: () => boolean; enabled?: () => boolean; directConsent?: () => boolean;
  reserve?: (id: string) => Promise<void>;
  trimVideo?: (bytes: Buffer, seconds: number) => Promise<Buffer>;
  extractFrame?: (bytes: Buffer, seconds: number) => Promise<Buffer>;
  inspectVideo?: (bytes: Buffer) => Promise<PresenterVideoInfo>;
} = {}) {
  const router = Router();
  const client = () => options.client || new HeyGenPresenterClient(process.env.HEYGEN_API_KEY || '');
  const configured = () => options.configured?.() ?? Boolean(process.env.HEYGEN_API_KEY);
  const enabled = () => options.enabled?.() ?? (configured() && process.env.HEYGEN_GENERATION_ENABLED === 'true');
  const directConsent = () => options.directConsent?.() ?? process.env.HEYGEN_DIRECT_CONSENT_ENABLED === 'true';
  const privateCatalog = (tenant: string) => Boolean(tenant && process.env.HEYGEN_PRIVATE_ASSET_TENANT_ID === tenant);
  const canCreateFor = (tenant: string) => !process.env.HEYGEN_PRIVATE_ASSET_TENANT_ID || privateCatalog(tenant);
  const creationReservation = (type: 'photo' | 'digital_twin') => type === 'photo'
    ? process.env.STUDIO_HEYGEN_PHOTO_AVATAR_RESERVE_CNY || process.env.STUDIO_HEYGEN_AVATAR_RESERVE_CNY || ''
    : process.env.STUDIO_HEYGEN_DIGITAL_TWIN_RESERVE_CNY || process.env.STUDIO_HEYGEN_AVATAR_RESERVE_CNY || '';
  const creationBudget = (type: 'photo' | 'digital_twin') => new StudioPaidBudget(path.resolve('data/studio-presenter-paid-budget'), () => {
    const amount = (value: string | undefined, zero = false) => { if (!value || !/^\d+(\.\d{1,6})?$/.test(value)) throw new Error('人物创建预算尚未配置'); const units = Math.round(Number(value) * 1e6); if (!Number.isSafeInteger(units) || (zero ? units < 0 : units <= 0)) throw new Error('人物创建预算无效'); return units; };
    return { limit: amount(process.env.STUDIO_PRESENTER_PAID_BUDGET_CNY), openingUsed: amount(process.env.STUDIO_PRESENTER_PAID_OPENING_USED_CNY, true), reserve: { heygen: amount(creationReservation(type)), qwen_asr: 1 } };
  });
  const checkPrivateAccount = async (tenant: string) => {
    if (!privateCatalog(tenant)) throw new Error('企业专属人物账号尚未连接');
    // A platform key that has created other tenants' people cannot later be
    // exposed wholesale just by adding an owner setting.
    for (const kind of ['creation', 'voice_clone']) {
      let complete = false;
      for (let page = 1; page <= 20; page++) {
        const rows = await store.list<Row>(COLLECTION, { where: { kind }, page, perPage: 100 });
        if (rows.items.some(row => row.tenant_id !== tenant)) throw new Error('此 HeyGen 工作区已有其他企业的私人资产记录，不能作为当前企业专属账号使用');
        if (page >= rows.totalPages) { complete = true; break; }
      }
      if (!complete) throw new Error('专属账号归属记录尚未核验完整，暂不能读取私人资产');
    }
  };
  // Only provider-confirmed public looks can be imported from this catalog.
  const publicLooks = new Map<string, { look: PresenterLook; at: number; private: boolean }>();
  const publicVoices = new Map<string, number>();
  const validVoice = (id: string) => Date.now() - (publicVoices.get(id) || 0) < 1800000;
  const privateVoice = async (id: string) => {
    let token = '';
    for (let page = 0; page < 20; page++) {
      const result = await client().voices(token, '', 'private');
      const voice = result.items.find(item => item.id === id);
      if (voice) return voice;
      if (!result.nextToken) break;
      token = result.nextToken;
    }
    throw new Error('该音色不在当前 HeyGen 私人音色库中');
  };
  const own = async (id: string, tenant: string, kind: string) => {
    const row = await store.getById<Row>(COLLECTION, id);
    if (!row || row.tenant_id !== tenant || row.kind !== kind) throw new Error('当前企业的人物任务或素材不存在');
    return row;
  };
  const find = async (tenant: string, kind: string, requestId: string) => (await store.list<Row>(COLLECTION, { where: { tenant_id: tenant, kind, request_id: requestId }, perPage: 1 })).items[0];
  const write = async (row: Row, patch: Record<string, unknown>) => {
    const payload = { ...row.payload, ...patch, updatedAt: new Date().toISOString() };
    if (!await store.update(COLLECTION, row.id, { payload })) throw new Error('人物状态保存失败，请刷新原任务，不要重复创建');
    row.payload = payload;
    return publicJob(row);
  };
  const publicJob = (row: Row): PresenterCreation => {
    const p = row.payload;
    return { id: row.id, name: p.name, type: p.type, voiceId: p.voiceId, status: p.status, look: p.look,
      groupId: p.groupId, error: p.error, consentUrl: p.consentUrl,
      consentRequestedAt: p.consentRequestedAt || (p.consentUrl ? p.updatedAt : undefined),
      createdAt: p.createdAt, updatedAt: p.updatedAt };
  };
  const refresh = async (row: Row) => {
    if (!row.payload.groupId) throw new Error('提交结果尚未核实，请管理员核对原任务；刷新不会重新创建或计费');
    const group = await client().group(row.payload.groupId);
    const looks = row.payload.look?.id ? [await client().look(row.payload.look.id)] : await client().groupLooks(row.payload.groupId);
    const look = looks.find(item => item.id === row.payload.look?.id) || looks[0];
    const failed = group.status === 'failed' || look?.status === 'failed';
    const consentPending = (row.payload.type === 'digital_twin' ? !consentAccepted(group.consent_status) : Boolean(group.consent_status && !consentAccepted(group.consent_status))) || group.status === 'pending_consent';
    const status = failed ? 'failed' : consentPending ? 'pending_consent' : group.status === 'completed' && look?.status === 'completed' ? 'completed' : 'processing';
    return write(row, { status, look, error: failed ? '人物处理失败，请检查素材或授权录制要求' : '', ...(status === 'completed' ? { consentUrl: undefined } : {}) });
  };
  router.get('/capabilities', (_req, res) => {
    const photoBudget = creationBudget('photo').status('heygen');
    const digitalTwinBudget = creationBudget('digital_twin').status('heygen');
    const commonReason = !configured() ? '管理员尚未配置 HeyGen 服务密钥' : !canCreateFor(res.locals.tenantId) ? '当前企业尚未连接人物创建账号，可使用公共人物库' : !enabled() ? '人物创建尚未启用，可导入已有可用人物' : '';
    const photoCreationReason = commonReason || (options.reserve ? '' : photoBudget.reason);
    const digitalTwinCreationReason = commonReason || (options.reserve ? '' : digitalTwinBudget.reason);
    const photoCreationEnabled = !photoCreationReason;
    const digitalTwinCreationEnabled = !digitalTwinCreationReason;
    res.json({ localPhotoUpload: currentDataAuthority() === 'local', configured: configured(), creationEnabled: photoCreationEnabled || digitalTwinCreationEnabled, photoCreationEnabled, digitalTwinCreationEnabled, photoCreationReason, digitalTwinCreationReason, directConsent: directConsent(), privateCatalog: privateCatalog(res.locals.tenantId), reservationCny: photoBudget.reservationCny,
      photoReservationCny: photoBudget.reservationCny, digitalTwinReservationCny: digitalTwinBudget.reservationCny,
      reason: commonReason || (!photoCreationEnabled && !digitalTwinCreationEnabled ? photoCreationReason || digitalTwinCreationReason : '') });
  });
  router.post('/photo-materials', raw({ type: 'application/octet-stream', limit: '32mb' }), async (req, res) => {
    try {
      if (currentDataAuthority() !== 'local') { res.status(409).json({ error: '请使用企业素材库上传人物照片' }); return; }
      const tenantId = res.locals.tenantId as string; const bytes = req.body as Buffer;
      const mime = String(req.query.mime || '');
      if (!Buffer.isBuffer(bytes) || !bytes.length || !['image/jpeg', 'image/png'].includes(mime)
        || (mime === 'image/jpeg' ? bytes[0] !== 255 || bytes[1] !== 216 : !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))) throw new Error('请选择32MB以内的有效 JPG 或 PNG 人物照片');
      const id = `presenter-photo-${hash(`${tenantId}:${hash(bytes)}`).slice(0,24)}`;
      const material = await exclusive('presenter-photo-library', async () => {
        const records = readLocalMaterials(); const existing = records.find(item => item.id === id && item.tenantId === tenantId); if (existing) return existing;
        const filename = `${id}.${mime === 'image/png' ? 'png' : 'jpg'}`; const relative = tenantAssetRelativePath(tenantId, filename);
        const target = path.resolve('data/media', relative); fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, bytes, {mode:0o600});
        const objectKey = materialAssetObjectKey(tenantId, filename); await objectStorageUpload({key:objectKey, body:bytes, contentType:mime}); const head = await objectStorageHead(objectKey); if (!head?.etag) throw new Error('人物照片存储校验失败');
        const item = {id, name:String(req.query.name || '企业人物照片').slice(0,100), type:'image' as const, folder:'presenter', scope:'own' as const, tenantId, file:relative, url:`/media/${relative}`, objectKey, objectEtag:head.etag, contentSha256:hash(bytes), duration:0, size:`${Math.ceil(bytes.length/1024)} KB`, sourceType:'presenter-inline-upload', createdAt:new Date().toISOString()};
        saveLocalMaterials([...records,item]); return item;
      }); res.status(201).json({ok:true, material});
    } catch(error) {res.status(400).json({error:message(error)});}
  });
  router.get('/catalog', async (req, res) => {
    try {
      const tenant = res.locals.tenantId as string;
      const isPrivate = req.query.scope === 'private';
      if (isPrivate && !privateCatalog(tenant)) { res.status(403).json({ error: '企业专属人物账号尚未连接' }); return; }
      if (isPrivate) await checkPrivateAccount(tenant);
      const page = await client().looks(String(req.query.token || '').slice(0, 2000), isPrivate ? 'private' : 'public');
      const curation = presenterCuration(tenant);
      const favorite = (look: PresenterLook) => look.favorite || Boolean(curatedName(curation.favoriteNames, look.name));
      const asian = (look: PresenterLook) => asianPresenterLook(look) || Boolean(curatedName(curation.asianNames, look.name));
      for (const [id, entry] of publicLooks) if (Date.now() - entry.at > 300000) publicLooks.delete(id);
      for (const look of page.items) publicLooks.set(`${tenant}:${look.id}`, { look, at: Date.now(), private: isPrivate });
      while (publicLooks.size > 3000) publicLooks.delete(publicLooks.keys().next().value!);
      res.json({ ...page, items: [...page.items].sort((a, b) => Number(asian(b)) - Number(asian(a)) || Number(favorite(b)) - Number(favorite(a))) });
    } catch (e) { res.status(503).json({ error: message(e) }); }
  });
  router.post('/favorites/sync', async (_req, res) => {
    try {
      const tenant = res.locals.tenantId as string;
      const curation = presenterCuration(tenant);
      const favorites: PresenterLook[] = [];
      if (curation.favoriteGroups.length) {
        const groups = await Promise.all(curation.favoriteGroups.map(async group => ({ group, looks: await client().groupLooks(group.groupId) })));
        for (const { group, looks } of groups) {
          const preferred = looks.find(item => item.status === 'completed' && item.voiceId) || looks.find(item => item.status === 'completed');
          if (preferred) favorites.push({ ...preferred, name: group.name, favorite: true, tags: [...(preferred.tags || []), ...(group.asian ? ['asian'] : [])] });
        }
      } else {
        let token = '';
        for (let pageNumber = 0; pageNumber < 30; pageNumber++) {
          const page = await client().looks(token, 'public');
          favorites.push(...page.items.filter(item => (item.favorite || curatedName(curation.favoriteNames, item.name)) && item.status === 'completed'));
          if (!page.nextToken || page.nextToken === token) break;
          token = page.nextToken;
        }
      }
      const result = await exclusive(`defaults:${tenant}`, async () => {
        const row = (await store.list<Row>('studio_production_defaults', { where: { tenant_id: tenant }, perPage: 1 })).items[0];
        const defaults: ProductionDefaults = row?.payload || EMPTY_DEFAULTS;
        const existing = new Set(defaults.presenters.map(item => item.avatarId));
        const preferred = new Map<string, PresenterLook>();
        for (const look of favorites) {
          const group = curatedName(curation.favoriteNames, look.name) || look.groupId || look.id;
          const current = preferred.get(group);
          if (!current || (!current.voiceId && look.voiceId)) preferred.set(group, look);
        }
        const selectedFavorites = [...preferred.values()];
        const importable = selectedFavorites.filter(item => item.voiceId && !existing.has(item.id));
        const capacity = Math.max(0, 50 - defaults.presenters.length);
        const selected = importable.slice(0, capacity);
        const additions: PresenterAsset[] = selected.map(look => ({ id: `presenter-${hash(`${look.id}:${look.voiceId}`).slice(0, 24)}`, name: look.name.slice(0, 100), avatarId: look.id, voiceId: look.voiceId!, authorized: true,
          supportsAlpha: false, nativeOrientation: look.orientation, imageUrl: look.imageUrl, videoUrl: look.videoUrl, assetVersion: 1, capabilities: ['talking'], toolMappings: { heygen: { avatarId: look.id, voiceId: look.voiceId! } }, rightsEvidence: { authorizationRef: `document://studio_presenter_assets/catalog/${look.id}`, consentRef: `consent://heygen/${look.groupId || look.id}`, grantedAt: new Date().toISOString(), subjectAdultConfirmed: true, permittedProviders: ['heygen'], permittedUses: ['digital_presenter', 'voice_synthesis'] } }));
        const isAsian = (presenter: PresenterAsset) => Boolean(curatedName(curation.asianNames, presenter.name)) || asianPresenterLook(favorites.find(item => item.id === presenter.avatarId) || { id: '', name: '', orientation: 'unknown', status: '' });
        const presenters = [...defaults.presenters, ...additions].sort((a, b) => Number(isAsian(b)) - Number(isAsian(a)));
        const payload = { ...defaults, presenters, defaultPresenterId: defaults.defaultPresenterId || additions[0]?.id || '' };
        if (additions.length) {
          const saved = row ? await store.update('studio_production_defaults', row.id, { payload }) : await store.create('studio_production_defaults', { tenant_id: tenant, payload });
          if (!saved) throw new Error('收藏人物保存失败，请重试');
        }
        return { defaults: payload, favoriteCount: selectedFavorites.length, importedCount: additions.length, skippedWithoutVoice: selectedFavorites.filter(item => !item.voiceId).length, capacityReached: importable.length > selected.length };
      });
      res.json(result);
    } catch (e) { res.status(503).json({ error: message(e) }); }
  });
  router.get('/voices', async (req, res) => {
    try {
      const tenant = res.locals.tenantId as string;
      const scope = req.query.scope === 'private' ? 'private' : 'public';
      if (scope === 'private') await checkPrivateAccount(tenant);
      const page = await client().voices(String(req.query.token || '').slice(0, 2000), String(req.query.language || '').slice(0, 40), scope);
      if (scope === 'public') for (const voice of page.items) publicVoices.set(voice.id, Date.now());
      while (publicVoices.size > 5000) publicVoices.delete(publicVoices.keys().next().value!);
      res.json(page);
    }
    catch (e) { res.status(503).json({ error: message(e) }); }
  });
  router.post('/voices/clones', raw({ type: ['audio/webm', 'audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/ogg'], limit: '10mb' }), async (req, res) => {
    try {
      const tenant = res.locals.tenantId as string;
      await checkPrivateAccount(tenant);
      const name = String(req.query.name || '').trim();
      const language = String(req.query.language || '').trim();
      const requestId = String(req.query.requestId || '');
      const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const bytes = req.body as Buffer;
      const audioMatches = mime === 'audio/webm' ? bytes?.subarray(0, 4).equals(Buffer.from([26,69,223,163]))
        : mime === 'audio/wav' ? bytes?.toString('ascii', 0, 4) === 'RIFF' && bytes?.toString('ascii', 8, 12) === 'WAVE'
        : mime === 'audio/ogg' ? bytes?.toString('ascii', 0, 4) === 'OggS'
        : mime === 'audio/mp4' ? bytes?.toString('ascii', 4, 8) === 'ftyp'
        : mime === 'audio/mpeg' ? bytes?.toString('ascii', 0, 3) === 'ID3' || bytes?.[0] === 255 && (bytes?.[1] & 224) === 224 : false;
      if (req.query.consent !== 'true') throw new Error('请确认已取得本人声音克隆及商业口播使用授权');
      if (!validId(requestId) || !name || name.length > 100 || !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(language)
        || !['audio/webm','audio/wav','audio/mpeg','audio/mp4','audio/ogg'].includes(mime)
        || !Buffer.isBuffer(bytes) || bytes.length < 10_000 || bytes.length > 10 * 1024 * 1024 || !audioMatches) throw new Error('请提供名称、语言和 10MB 以内的有效录音');
      const digest = hash(bytes);
      const result = await exclusive(`voice-clone:${tenant}:${requestId}`, async () => {
        const previous = await find(tenant, 'voice_clone', requestId);
        if (previous) {
          if (previous.payload.digest !== digest || previous.payload.name !== name) throw new Error('同一提交标识不能更换录音或名称');
          return { id: previous.id, status: previous.payload.status, voiceId: previous.payload.voiceId || '' };
        }
        const created = await store.create<Row>(COLLECTION, { tenant_id: tenant, kind: 'voice_clone', request_id: requestId,
          payload: { name, language, digest, status: 'submitting', voiceId: '', authorizationConfirmedAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
        if (!created) throw new Error('音色任务记录保存失败，未调用 HeyGen');
        try {
          const voiceId = await client().cloneVoice(name, bytes, mime, language, `voice-clone:${tenant}:${requestId}`);
          await write(created, { voiceId, status: 'processing' });
          return { id: created.id, status: 'processing', voiceId };
        } catch (error) {
          await write(created, { status: 'uncertain', error: message(error) });
          throw new Error(`${message(error)}；任务已留档，请先核对 HeyGen 私人音色列表，勿重复提交`);
        }
      });
      res.status(result.status === 'processing' ? 202 : 200).json(result);
    } catch (error) { res.status(400).json({ error: message(error) }); }
  });
  router.get('/voices/clones', async (_req, res) => {
    try {
      const tenant = res.locals.tenantId as string;
      await checkPrivateAccount(tenant);
      const rows = await store.list<Row>(COLLECTION, { where: { tenant_id: tenant, kind: 'voice_clone' }, perPage: 100 });
      res.json(rows.items.map(row => ({ id: row.id, name: row.payload.name, status: row.payload.status, voiceId: row.payload.voiceId || '', createdAt: row.payload.createdAt })));
    } catch (error) { res.status(400).json({ error: message(error) }); }
  });
  router.get('/voices/clones/:id', async (req, res) => {
    try {
      const tenant = res.locals.tenantId as string;
      await checkPrivateAccount(tenant);
      const row = await own(req.params.id, tenant, 'voice_clone');
      if (!row.payload.voiceId) { res.json({ id: row.id, status: row.payload.status, error: row.payload.error || '' }); return; }
      const voice = await client().voice(row.payload.voiceId);
      const listed = !voice.status ? await privateVoice(row.payload.voiceId).then(() => true).catch(() => false) : false;
      const status = /^(complete|active)$/i.test(voice.status) || listed ? 'completed' : /^(failed|expired)$/i.test(voice.status) ? 'failed' : 'processing';
      await write(row, { status, error: status === 'failed' ? 'HeyGen 音色克隆失败' : '' });
      res.json({ id: row.id, status, voice });
    } catch (error) { res.status(400).json({ error: message(error) }); }
  });
  router.post('/voices/bind', async (req, res) => {
    try {
      const tenant = res.locals.tenantId as string;
      await checkPrivateAccount(tenant);
      const presenterId = String(req.body?.presenterId || '');
      const voiceId = String(req.body?.voiceId || '');
      if (!validId(presenterId) || !validId(voiceId) || req.body?.voiceAuthorized !== true) throw new Error('请选择人物与音色，并确认本人声音使用授权');
      await privateVoice(voiceId);
      const voice = await client().voice(voiceId);
      if (voice.id !== voiceId || (voice.status && !/^(complete|active)$/i.test(voice.status))) throw new Error('所选 HeyGen 私人音色尚不可用');
      const saved = await exclusive(`defaults:${tenant}`, async () => {
        const row = (await store.list<Row>('studio_production_defaults', { where: { tenant_id: tenant }, perPage: 1 })).items[0];
        const defaults = row?.payload as ProductionDefaults | undefined;
        const presenter = defaults?.presenters.find(item => item.id === presenterId && item.authorized);
        if (!defaults || !presenter) throw new Error('当前企业人物不存在或未授权');
        const presenters = defaults.presenters.map(item => item.id === presenterId ? {
          ...item, voiceId, assetVersion: Math.max(1, item.assetVersion || 1) + (item.voiceId === voiceId ? 0 : 1),
          voiceAuthorization: { voiceId, recordedAt: new Date().toISOString(), source: 'user_confirmation' as const },
          toolMappings: { ...item.toolMappings, heygen: { avatarId: item.avatarId || item.toolMappings?.heygen?.avatarId || '', voiceId } },
        } : item);
        const next = { ...defaults, presenters };
        if (!await store.update('studio_production_defaults', row.id, { payload: next })) throw new Error('音色绑定保存失败');
        return next;
      });
      res.json({ defaults: saved, voice });
    } catch (error) { res.status(400).json({ error: message(error) }); }
  });
  router.get('/creations', async (_req, res) => {
    try {
      const result = await store.list<Row>(COLLECTION, { where: { tenant_id: res.locals.tenantId, kind: 'creation' }, perPage: 100 });
      res.json(result.items.filter(row => row.tenant_id === res.locals.tenantId).map(publicJob));
    } catch { res.status(503).json({ error: '企业人物任务读取失败，请检查人物资产数据表' }); }
  });
  // Auth is inherited from studioRouter, before buffering a bounded binary body.
  router.post('/uploads', raw({ type: 'application/octet-stream', limit: '200mb' }), async (req, res) => {
    try {
      if (!configured()) throw new Error('管理员尚未配置 HeyGen 服务密钥');
      let mime = String(req.query.mime || ''); const requestId = String(req.query.requestId || '');
      let bytes = req.body as Buffer;
      if (!validId(requestId) || !Buffer.isBuffer(bytes) || bytes.length < 12) throw new Error('上传文件或请求标识无效');
      const matches = mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : ['video/mp4', 'video/quicktime'].includes(mime) ? bytes.toString('ascii', 4, 8) === 'ftyp' : mime === 'video/webm' ? bytes.subarray(0, 4).equals(Buffer.from([26,69,223,163])) : false;
      if (!matches) throw new Error('文件内容与格式不匹配，请使用 JPG、PNG、MP4、MOV 或 WebM');
      const trimSeconds = Number(req.query.trimSeconds);
      const frameAtSeconds = Number(req.query.frameAtSeconds);
      let trainingInfo: PresenterVideoInfo | undefined;
      if (frameAtSeconds >= 0 && req.query.frameAtSeconds !== undefined) {
        if (!mime.startsWith('video/') || frameAtSeconds > 10) throw new Error('只能从上传视频的前 10 秒提取本人照片');
        bytes = await (options.extractFrame || presenterVideoFrame)(bytes, frameAtSeconds);
        mime = 'image/jpeg';
      } else if (trimSeconds) {
        if (!mime.startsWith('video/') || trimSeconds !== 7) throw new Error('仅支持将真人人物视频截取为前 7 秒');
        bytes = await (options.trimVideo || trimPresenterVideo)(bytes, trimSeconds);
        mime = 'video/mp4';
      } else if (req.query.trainingVideo === 'true') {
        if (!mime.startsWith('video/')) throw new Error('专家模式必须上传完整真人视频');
        trainingInfo = await (options.inspectVideo || inspectPresenterVideo)(bytes);
        if (trainingInfo.duration < 30 || trainingInfo.duration > 300) throw new Error('专家模式训练视频须为 30 秒至 5 分钟的连续录制');
        if (!trainingInfo.hasAudio) throw new Error('专家模式训练视频必须包含本人清晰说话音频');
        if (Math.min(trainingInfo.width, trainingInfo.height) < 720 || trainingInfo.fps < 24) throw new Error('专家模式训练视频至少需要 720p、24fps；推荐 1080p、30fps');
      }
      const tenant = res.locals.tenantId as string;
      const result = await exclusive(`presenter:${tenant}`, async () => {
        const digest = hash(bytes), previous = await find(tenant, 'upload', requestId);
        if (previous) {
          if (previous.payload.digest !== digest) throw new Error('请求标识已用于其他文件');
          if (!previous.payload.assetId) throw new Error('上次上传结果待核实，请重新选择文件上传');
          return { id: previous.id, ...(trimSeconds ? { processedDurationSeconds: trimSeconds } : {}), ...(frameAtSeconds >= 0 && req.query.frameAtSeconds !== undefined ? { extractedFrame: true } : {}), ...(trainingInfo ? { trainingInfo } : {}) };
        }
        const row = await store.create<Row>(COLLECTION, { tenant_id: tenant, kind: 'upload', request_id: requestId, payload: { mime, digest, ...(trainingInfo ? { trainingInfo } : {}), createdAt: new Date().toISOString() } });
        if (!row) throw new Error('素材登记失败，未上传到供应商');
        const assetId = await client().upload(bytes, mime, `presenter-upload:${row.id}`);
        if (!await store.update(COLLECTION, row.id, { payload: { ...row.payload, assetId } })) throw new Error('素材登记失败，请重新选择文件');
        return { id: row.id, ...(trimSeconds ? { processedDurationSeconds: trimSeconds } : {}), ...(frameAtSeconds >= 0 && req.query.frameAtSeconds !== undefined ? { extractedFrame: true } : {}), ...(trainingInfo ? { trainingInfo } : {}) };
      });
      res.json(result);
    } catch (e) { res.status(400).json({ error: message(e) }); }
  });
  router.post('/creations', async (req, res) => {
    try {
      const b = req.body || {}, tenant = res.locals.tenantId as string;
      if (!validId(b.requestId) || !['photo', 'digital_twin'].includes(b.type) || typeof b.name !== 'string' || !b.name.trim() || b.name.length > 100 || b.authorized !== true || b.adultConfirmed !== true || b.confirmed !== true) throw new Error('请填写人物名称，并确认肖像授权、主体已成年与创建费用');
      const result = await exclusive(`presenter:${tenant}`, async () => {
        const reusePresenterId = String(b.reusePresenterId || '');
        const fingerprint = hash(JSON.stringify([b.type, b.name.trim(), b.uploadId, b.voiceId, reusePresenterId]));
        const previous = await find(tenant, 'creation', b.requestId);
        if (previous) { if (previous.payload.fingerprint !== fingerprint) throw new Error('请求标识已用于其他人物'); return publicJob(previous); }
        if (!enabled()) throw new Error('管理员尚未启用人物创建');
        if (!canCreateFor(tenant)) throw new Error('当前企业尚未连接人物创建账号');
        let reuseGroupId = '';
        if (reusePresenterId) {
          if (!validId(reusePresenterId) || b.samePersonConfirmed !== true) throw new Error('复用 HeyGen 本人授权前，请确认新增素材属于同一人物');
          await checkPrivateAccount(tenant);
          const defaults = (await store.list<Row>('studio_production_defaults', { where: { tenant_id: tenant }, perPage: 1 })).items[0]?.payload as ProductionDefaults | undefined;
          const presenter = defaults?.presenters.find(item => item.id === reusePresenterId && item.authorized);
          if (!presenter?.avatarId) throw new Error('当前人物没有可复用的 HeyGen 人物组');
          const priorLook = await client().look(presenter.avatarId);
          if (!priorLook.groupId || presenter.rightsEvidence?.consentRef !== `consent://heygen/${priorLook.groupId}`) throw new Error('当前人物缺少已核验的 HeyGen 人物组归属');
          const group = await client().group(priorLook.groupId);
          if (group.status !== 'completed' || (group.consent_status && !consentAccepted(group.consent_status))) throw new Error('原 HeyGen 人物组尚未完成本人验证');
          reuseGroupId = priorLook.groupId;
        }
        const upload = await own(String(b.uploadId), tenant, 'upload');
        if (!upload.payload.assetId || !(b.type === 'photo' ? upload.payload.mime.startsWith('image/') : upload.payload.mime.startsWith('video/'))) throw new Error('请上传与创建类型匹配的素材');
        if (b.type === 'digital_twin' && !upload.payload.trainingInfo) throw new Error('请使用经过时长、画幅、帧率和音轨检查的完整人物视频');
        const existing = (await store.list<Row>(COLLECTION, { where: { tenant_id: tenant, kind: 'creation' }, perPage: 100 })).items;
        if (existing.length >= 100) throw new Error('人物创建任务已达到当前上限');
        if (existing.some(row => row.payload.sourceDigest === upload.payload.digest && row.payload.status !== 'failed')) throw new Error('此素材已有创建任务，请查看并刷新原任务');
        if (b.voiceId && (!validId(b.voiceId) || (!validVoice(b.voiceId) && !(privateCatalog(tenant) && await privateVoice(b.voiceId))))) throw new Error('请重新加载声音列表后选择可用声音');
        const row = await store.create<Row>(COLLECTION, { tenant_id: tenant, kind: 'creation', request_id: b.requestId,
          payload: { name: b.name.trim(), type: b.type, voiceId: b.voiceId, uploadId: b.uploadId, sourceDigest: upload.payload.digest, fingerprint, authorized: true, subjectAdultConfirmed: true, ...(reusePresenterId ? { reusePresenterId } : {}), status: 'submitting', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
        if (!row) throw new Error('人物任务登记失败，未创建人物');
        try { await (options.reserve ? options.reserve(`presenter:${row.id}`) : creationBudget(b.type).reserve('heygen', `presenter:${row.id}`)); }
        catch (e) { await write(row, { status: 'failed', error: message(e) }); throw e; }
        try {
          const remote = await client().create(b.type, b.name.trim(), upload.payload.assetId, `presenter:${row.id}`, reuseGroupId || undefined);
          const look = remote.avatar_item ? presenterLook(remote.avatar_item) : undefined;
          const groupId = remote.avatar_group?.id || look?.groupId;
          if (!groupId) throw new Error('创建结果未返回人物组，需管理员核对原任务');
          if (reuseGroupId && groupId !== reuseGroupId) throw new Error('HeyGen 返回的人物组与原授权人物不一致，需核对原任务');
          await write(row, { groupId, look, status: 'processing' });
        } catch (e) { return write(row, { status: 'uncertain', error: `${message(e)}；请核实原任务，不要重复创建` }); }
        try { return await refresh(row); } catch (e) { return write(row, { error: message(e) }); }
      });
      res.json(result);
    } catch (e) { res.status(400).json({ error: message(e) }); }
  });
  router.post('/creations/:id/refresh', async (req, res) => {
    // Refresh only reads provider state and reconciles the existing local row. It
    // must remain available after a crashed paid operation leaves a fail-closed
    // creation lock for operator review.
    try { res.json(await refresh(await own(req.params.id, res.locals.tenantId, 'creation'))); }
    catch (e) { res.status(400).json({ error: message(e) }); }
  });
  router.post('/creations/:id/consent', async (req, res) => {
    try {
      const tenant = res.locals.tenantId as string;
      res.json(await exclusive(`presenter:${tenant}`, async () => {
        const row = await own(req.params.id, tenant, 'creation');
        if (!row.payload.groupId) throw new Error('人物尚未创建成功');
        if (!validId(req.body?.requestId)) throw new Error('授权请求标识无效');
        let assetId: string | undefined;
        if (req.body.uploadId) {
          if (!directConsent()) throw new Error('当前账号未开通直接提交授权视频，请使用本人授权验证入口');
          const upload = await own(String(req.body.uploadId), tenant, 'upload');
          if (!upload.payload.mime.startsWith('video/') || !upload.payload.assetId) throw new Error('请上传授权视频');
          assetId = upload.payload.assetId;
        }
        const result = await client().consent(row.payload.groupId, `consent:${row.id}:${req.body.requestId}`, assetId);
        const consentUrl = mediaUrl(result.url);
        if (consentUrl && !/(^|\.)heygen\.(com|ai)$/.test(new URL(consentUrl).hostname)) throw new Error('授权链接不属于可信供应商');
        if (!assetId && !consentUrl) throw new Error('未返回有效授权链接，请重新获取');
        return write(row, { consentUrl, consentRequestedAt: new Date().toISOString(), status: 'pending_consent',
          error: assetId ? '授权视频已提交审核，请稍后刷新状态' : '' });
      }));
    } catch (e) { res.status(400).json({ error: message(e) }); }
  });
  router.post('/import', async (req, res) => {
    try {
      const b = req.body || {}, tenant = res.locals.tenantId as string;
      if (b.reviewed !== true) throw new Error('请预览并确认使用所选人物和声音');
      let look: PresenterLook;
      let defaultVoice: string | undefined;
      let creationMode: PresenterAsset['creationMode'];
      if (b.creationId) {
        const job = await refresh(await own(String(b.creationId), tenant, 'creation'));
        if (job.status !== 'completed' || !job.look) throw new Error('人物训练或本人授权尚未完成');
        look = job.look; defaultVoice = job.voiceId; creationMode = job.type === 'digital_twin' ? 'expert' : 'quick';
      } else {
        const cached = publicLooks.get(`${tenant}:${String(b.lookId)}`);
        if (!cached || Date.now() - cached.at > 300000) throw new Error('请刷新可用人物列表后重新选择');
        if (cached.private) await checkPrivateAccount(tenant);
        look = await client().look(cached.look.id);
        if (cached.private) {
          if (!look.groupId) throw new Error('人物缺少可核验的授权记录');
          const group = await client().group(look.groupId);
          if (group.status !== 'completed' || (group.consent_status && !consentAccepted(group.consent_status))) throw new Error('人物训练或本人授权尚未完成');
        }
      }
      if (look.status !== 'completed') throw new Error('人物尚不可用');
      const voiceId = String(b.voiceId || defaultVoice || look.voiceId || '');
      if (!voiceId) throw new Error('请选择声音');
      if (voiceId !== defaultVoice && voiceId !== look.voiceId) {
        if (!validVoice(voiceId) && !(privateCatalog(tenant) && await privateVoice(voiceId))) throw new Error('请重新加载声音列表后选择可用声音');
      }
      const result = await exclusive(`defaults:${tenant}`, async () => {
        const row = (await store.list<Row>('studio_production_defaults', { where: { tenant_id: tenant }, perPage: 1 })).items[0];
        const defaults: ProductionDefaults = row?.payload || EMPTY_DEFAULTS;
        const previous = defaults.presenters.find(p => p.avatarId === look.id && p.voiceId === voiceId);
        if (previous) return defaults;
        if (defaults.presenters.length >= 50) throw new Error('企业人物已达到 50 个上限');
        const createdByTenant = Boolean(b.creationId);
        const presenter: PresenterAsset = { id: `presenter-${hash(`${look.id}:${voiceId}`).slice(0, 24)}`, name: String(b.name || look.name).slice(0, 100), avatarId: look.id, voiceId, authorized: true,
          supportsAlpha: false, nativeOrientation: look.orientation, imageUrl: look.imageUrl, videoUrl: look.videoUrl, creationMode, assetVersion: 1, capabilities: ['talking'], toolMappings: { heygen: { avatarId: look.id, voiceId } }, rightsEvidence: createdByTenant
            ? { authorizationRef: `document://studio_presenter_assets/${String(b.creationId)}/${look.id}`, consentRef: `consent://heygen/${look.groupId || look.id}`, grantedAt: new Date().toISOString(), subjectAdultConfirmed: true, permittedProviders: ['heygen'], permittedUses: ['digital_presenter', 'voice_synthesis'] }
            : { authorizationRef: `license://heygen/public-catalog/${look.id}`, consentRef: `license://heygen/public-catalog/${look.groupId || look.id}`, grantedAt: new Date().toISOString(), subjectAdultConfirmed: false, permittedProviders: ['heygen'], permittedUses: ['digital_presenter', 'voice_synthesis'] } };
        const payload = { ...defaults, presenters: [...defaults.presenters, presenter], defaultPresenterId: defaults.defaultPresenterId || presenter.id };
        const saved = row ? await store.update('studio_production_defaults', row.id, { payload }) : await store.create('studio_production_defaults', { tenant_id: tenant, payload });
        if (!saved) throw new Error('企业人物保存失败，请重试导入');
        return payload;
      });
      res.json(result);
    } catch (e) { res.status(400).json({ error: message(e) }); }
  });
  return router;
}
