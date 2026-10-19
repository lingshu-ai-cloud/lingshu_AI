import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { DataStore } from '../storage/datastore.js';
import { createPresenterAssetsRouter } from './presenterAssets.js';
import { validateHeyGenPresenterRecord } from '../lib/presenterAssetTrust.js';
import { HeyGenPresenterClient } from '../lib/heygenPresenters.js';

test('presenter creation, consent, import, tenant isolation, pagination and uncertain requests', async () => {
  const rows = new Map<string, any>(); let seq = 0, failWrites = false, lost = false, approved = false, consentOmitted = false, consentProcessing = false, budgetBlocked = false, trimCalls = 0, frameCalls = 0, normalizeCalls = 0, inspectCalls = 0;
  const store: DataStore = {
    async getById<T>(c: string, id: string) { return structuredClone(rows.get(`${c}/${id}`) || null) as T | null; },
    async create<T>(c: string, value: Record<string, unknown>) { if (failWrites) return null; const row = { ...value, id: `r${++seq}` }; rows.set(`${c}/${row.id}`, structuredClone(row)); return row as T; },
    async update(c, id, patch) { if (failWrites || !rows.has(`${c}/${id}`)) return false; rows.set(`${c}/${id}`, { ...rows.get(`${c}/${id}`), ...structuredClone(patch) }); return true; },
    async delete(c, id) { return rows.delete(`${c}/${id}`); },
    async list<T>(c: string, q = {}) { const where = (q as any).where || {}; const items = [...rows.entries()].filter(([k, v]) => k.startsWith(`${c}/`) && Object.entries(where).every(([key, expected]) => v[key] === expected)).map(([, v]) => structuredClone(v) as T); return { items, totalItems: items.length, totalPages: 1, page: 1, perPage: 100 }; },
  };
  const calls: { url: string; init: RequestInit; body: any }[] = [];
  const look = { id: 'public1', name: 'Public presenter', avatar_type: 'studio_avatar', group_id: 'group-public', default_voice_id: 'voice1', preview_image_url: 'https://files.heygen.ai/p.png', image_width: 1080, image_height: 1920 };
  const client = new HeyGenPresenterClient('test-secret', (async (rawUrl: string, init: RequestInit) => {
    const url = new URL(rawUrl), body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url: rawUrl, init, body });
    let data: any = null, meta = {};
    if (url.pathname === '/v3/assets') data = { asset_id: 'uploaded1' };
    else if (url.pathname === '/v3/voices') { data = [{ voice_id: 'voice1', name: 'Sara', language: 'English', type: 'public', preview_audio_url: 'https://files.heygen.ai/s.mp3' }]; meta = { has_more: true, next_token: 'page2' }; }
    else if (url.pathname === '/v3/avatars/looks' && url.searchParams.get('ownership') === 'public') { data = [look]; meta = { has_more: true, next_token: 'page2' }; }
    else if (url.pathname === '/v3/avatars/looks' && url.searchParams.get('ownership') === 'private') data = [{ ...look, id: 'private-photo', name: 'Owned presenter', avatar_type: 'photo_avatar', group_id: 'private-group', status: 'completed' }];
    else if (url.pathname === '/v3/avatars' && init.method === 'POST') { if (lost) throw new Error('response lost'); data = { avatar_group: { id: 'created-group' }, avatar_item: { ...look, id: 'private1', group_id: 'created-group', status: 'processing' } }; }
    else if (url.pathname === '/v3/avatars/created-group') data = { id: 'created-group', status: 'completed', ...(consentOmitted ? {} : { consent_status: approved ? 'accepted' : 'pending' }) };
    else if (url.pathname === '/v3/avatars/private-group') data = { id: 'private-group', status: 'completed' };
    else if (url.pathname === '/v3/avatars/looks/private1') data = { ...look, id: 'private1', status: 'completed', group_id: 'created-group' };
    else if (url.pathname === '/v3/avatars/looks/private-photo') data = { ...look, id: 'private-photo', name: 'Owned presenter', avatar_type: 'photo_avatar', status: 'completed', group_id: 'private-group' };
    else if (url.pathname === '/v3/avatars/looks/public1') data = look;
    else if (url.pathname === '/v3/avatars/created-group/consent') {
      if (consentProcessing) return new Response(JSON.stringify({ error: { message: 'Consent is processing for this avatar group. Please wait for consent' } }), { status: 409 });
      data = { avatar_group: { id: 'created-group' }, url: 'https://app.heygen.com/consent/test' };
    }
    else throw new Error(`Unexpected test request ${rawUrl}`);
    return new Response(JSON.stringify({ data, ...meta }));
  }) as typeof fetch);
  const locks = new Map<string, Promise<unknown>>();
  const exclusive = async <T>(key: string, fn: () => Promise<T>): Promise<T> => { const next = (locks.get(key) || Promise.resolve()).catch(() => {}).then(fn); locks.set(key, next); return next; };
  const app = express(); app.use(express.json()); app.use((req, res, next) => { res.locals.tenantId = req.headers['x-tenant'] || 'A'; next(); });
  app.use(createPresenterAssetsRouter(store, exclusive, { client, configured: () => true, enabled: () => true, directConsent: () => false, reserve: async () => { if (budgetBlocked) throw new Error('预算不足'); }, trimVideo: async (_bytes, seconds) => { trimCalls++; assert.equal(seconds, 7); return Buffer.from([0,0,0,0,102,116,121,112,1,2,3,4]); }, extractFrame: async (_bytes, seconds) => { frameCalls++; assert.equal(seconds, 1); return Buffer.from([255,216,255,224,0,16,74,70,73,70,0,1,255,217]); }, normalizeTrainingVideo: async bytes => { normalizeCalls++; return bytes; }, inspectVideo: async () => { inspectCalls++; return inspectCalls === 1 ? { duration: 60, width: 640, height: 480, fps: 20, hasAudio: true } : { duration: 60, width: 1280, height: 720, fps: 30, hasAudio: true }; }, materialBelongs: (tenant, id, type) => tenant === 'A' && id === `ark-${type}` }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (url: string, body?: any, tenant = 'A') => fetch(root + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'x-tenant': tenant }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const upload = (requestId: string, bytes = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0])) => fetch(`${root}/uploads?mime=image/png&requestId=${requestId}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
  const creates = () => calls.filter(c => c.url === 'https://api.heygen.com/v3/avatars').length;
  try {
    const capabilities = await (await request('/capabilities')).json();
    assert.equal(capabilities.photoCreationEnabled, true);
    assert.equal(capabilities.digitalTwinCreationEnabled, true);
    const voices = await (await request('/voices?token=abc')).json(); assert.equal(voices.nextToken, 'page2'); assert.equal(voices.items[0].id, 'voice1');
    assert.match(calls.at(-1)!.url, /type=public/); assert.match(calls.at(-1)!.url, /token=abc/);
    const beforePrivate = calls.length;
    assert.equal((await request('/catalog?scope=private', undefined, 'B')).status, 403);
    assert.equal(calls.length, beforePrivate);
    assert.equal((await upload('bad', Buffer.from('not a valid picture'))).status, 400);
    const videoBytes = Buffer.from([0,0,0,0,102,116,121,112,9,8,7,6]);
    const trimmed = await (await fetch(`${root}/uploads?mime=video/quicktime&requestId=video-trim&trimSeconds=7`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: videoBytes })).json();
    assert.equal(trimmed.processedDurationSeconds, 7); assert.equal(trimCalls, 1);
    assert.equal(rows.get(`studio_presenter_assets/${trimmed.id}`).payload.mime, 'video/mp4');
    const extracted = await (await fetch(`${root}/uploads?mime=video/quicktime&requestId=video-frame&frameAtSeconds=1`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: videoBytes })).json();
    assert.equal(extracted.extractedFrame, true); assert.equal(frameCalls, 1);
    assert.equal(rows.get(`studio_presenter_assets/${extracted.id}`).payload.mime, 'image/jpeg');
    const training = await (await fetch(`${root}/uploads?mime=video/quicktime&requestId=training-video&trainingVideo=true`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: videoBytes })).json();
    assert.equal(training.trainingInfo.duration, 60); assert.equal(training.trainingInfo.hasAudio, true);
    assert.equal(training.trainingInfo.width, 1280); assert.equal(training.trainingInfo.fps, 30);
    assert.equal(normalizeCalls, 1); assert.equal(inspectCalls, 2);
    failWrites = true; const before = calls.length; assert.equal((await upload('save-failed')).status, 400); assert.equal(calls.length, before); failWrites = false;
    const asset = await (await upload('upload1')).json(); assert.ok(asset.id);
    const disposable = await store.create<any>('studio_presenter_assets', { tenant_id: 'A', kind: 'creation', request_id: 'discardable', payload: { name: 'Discardable', type: 'digital_twin', status: 'failed', error: 'not accepted', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
    assert.equal((await request(`/creations/${disposable.id}/discard`, {}, 'B')).status, 400);
    assert.equal((await request(`/creations/${disposable.id}/discard`, {})).status, 200);
    assert.equal(await store.getById('studio_presenter_assets', disposable.id), null);
    const assetsBeforeRepeat = calls.filter(c => c.url.endsWith('/assets')).length;
    assert.equal((await (await upload('upload1')).json()).id, asset.id); assert.equal(calls.filter(c => c.url.endsWith('/assets')).length, assetsBeforeRepeat);
    await store.create('studio_presenter_assets', { tenant_id: 'A', kind: 'creation', request_id: 'legacy-mock', payload: { mock: true, sourceDigest: rows.get(`studio_presenter_assets/${asset.id}`).payload.digest, status: 'completed' } });
    const input = { name: 'Our presenter', type: 'photo', voiceId: 'voice1', uploadId: asset.id, requestId: 'creation1', authorized: true, adultConfirmed: true, confirmed: true,
      arkPreparation: { photoMaterialId: 'ark-image', videoMaterialId: 'ark-video', processingAuthorized: true } };
    assert.equal((await request('/creations', { ...input, authorized: false })).status, 400);
    assert.equal((await request('/creations', { ...input, adultConfirmed: false })).status, 400);
    assert.equal((await request('/creations', input, 'B')).status, 400); assert.equal(creates(), 0);
    const pair = await Promise.all([request('/creations', input), request('/creations', input)]); const first = await pair[0].json();
    assert.equal((await pair[1].json()).id, first.id); assert.equal(creates(), 1); assert.equal(first.status, 'completed');
    assert.deepEqual(first.arkPreparation, input.arkPreparation, 'one-time Ark preparation survives the HeyGen consent round trip');
    const optionalArkInput = { ...input, requestId: 'creation-without-ark-consent', uploadId: asset.id,
      arkPreparation: { ...input.arkPreparation, processingAuthorized: false } };
    const optionalArk = await (await request('/creations', optionalArkInput)).json();
    assert.equal(optionalArk.arkPreparation.processingAuthorized, false, 'saving reusable materials does not imply Ark processing consent');
    assert.equal(first.uploadId, undefined); assert.equal(first.fingerprint, undefined);
    assert.deepEqual(calls.find(c => c.url === 'https://api.heygen.com/v3/avatars')!.body.file, { type: 'asset_id', asset_id: 'uploaded1' });
    assert.equal((await request('/creations', { ...input, name: 'changed' })).status, 400);
    const repeated = await (await request('/creations', { ...input, requestId: 'duplicate-file' })).json();
    assert.equal(repeated.id, first.id, 'a repeated action recovers the original paid task');
    const duplicateUpload = await (await upload('same-file-new-upload-id')).json();
    const repeatedUpload = await (await request('/creations', { ...input, uploadId: duplicateUpload.id, requestId: 'same-bytes-new-request' })).json();
    assert.equal(repeatedUpload.id, first.id, 'the same bytes under a new upload id still recover the original task');
    assert.equal(creates(), 1);
    assert.deepEqual(await (await request('/creations', undefined, 'B')).json(), []);
    assert.equal((await request(`/creations/${first.id}/refresh`, {}, 'B')).status, 400);
    assert.equal((await request(`/creations/${first.id}/consent`, { requestId: 'c1' }, 'B')).status, 400);
    assert.equal((await request(`/creations/${first.id}/consent`, { requestId: 'c1', uploadId: asset.id })).status, 400);
    const consent = await (await request(`/creations/${first.id}/consent`, { requestId: 'c1' })).json(); assert.equal(consent.status, 'completed'); assert.equal(consent.consentUrl, undefined);
    const bind = { creationId: first.id, voiceId: 'voice1', authorized: true, reviewed: true };
    consentOmitted = true;
    const missingConsent = await (await request(`/creations/${first.id}/refresh`, {})).json();
    assert.equal(missingConsent.status, 'completed', 'photo avatars use the retained local subject authorization because HeyGen exposes no consent step');
    consentOmitted = false;
    approved = true;
    const ready = await (await request(`/creations/${first.id}/refresh`, {})).json(); assert.equal(ready.status, 'completed'); assert.equal(ready.consentUrl, undefined); assert.equal(creates(), 1);
    const saved = await (await request('/import', bind)).json(); assert.equal(saved.presenters.length, 1); assert.equal(saved.presenters[0].nativeOrientation, 'portrait'); assert.equal(saved.presenters[0].supportsAlpha, false); assert.equal(saved.presenters[0].creationMode, 'quick');
    const boundDiscard = await request(`/creations/${first.id}/discard`, {});
    assert.equal(boundDiscard.status, 400);
    assert.match((await boundDiscard.json()).error, /人物资产/);
    assert.deepEqual(saved.presenters[0].referenceMaterialIds, ['ark-image', 'ark-video'], 'import binds the retained photo and video to the presenter for later Ark certification');
    assert.equal(validateHeyGenPresenterRecord(saved.presenters[0]).ok, true, 'verified import satisfies the existing generation gate');
    assert.equal((await (await request('/import', bind)).json()).presenters.length, 1);
    const defaultsRow = [...rows.values()].find(row => row.payload?.presenters?.some((presenter: any) => presenter.id === saved.presenters[0].id));
    if (!defaultsRow) throw new Error('missing presenter defaults row');
    defaultsRow.payload.presenters[0].referenceMaterialIds = [];
    const repaired = await (await request('/import', bind)).json();
    assert.deepEqual(repaired.presenters[0].referenceMaterialIds, ['ark-image', 'ark-video'], 'retrying import repairs missing Ark material bindings');
    assert.equal((await request('/import', bind, 'B')).status, 400);
    assert.equal((await request('/import', { lookId: 'private-other', authorized: true, reviewed: true })).status, 400);
    const catalog = await (await request('/catalog')).json(); assert.equal(catalog.items[0].id, 'public1'); assert.equal(catalog.nextToken, 'page2');
    const stock = await (await request('/import', { lookId: 'public1', reviewed: true, makeDefault: true, authorized: true })).json(); assert.equal(stock.presenters.length, 2);
    assert.equal(stock.presenters[1].rightsEvidence.subjectAdultConfirmed, false);
    assert.match(stock.presenters[1].rightsEvidence.authorizationRef, /^license:\/\/heygen\/public-catalog\//);
    assert.equal(stock.defaultPresenterId, stock.presenters[1].id, 'initial import replaces the previous default with the new asset');
    const ordinaryImport = await (await request('/import', bind)).json();
    assert.equal(ordinaryImport.defaultPresenterId, stock.defaultPresenterId, 'ordinary imports preserve the current default');
    await request('/import', { ...bind, makeDefault: true });
    const initialSelection = { lookId: 'public1', reviewed: true, makeDefault: true };
    assert.equal((await request('/import', initialSelection)).status, 400, 'default selection requires explicit usage authorization');
    const selected = await (await request('/import', { ...initialSelection, authorized: true })).json();
    assert.equal(selected.defaultPresenterId, stock.presenters[1].id, 'initial selection replaces an existing default');
    assert.equal(selected.presenters.length, 2, 'selecting an imported asset does not duplicate it');
    const switchedBack = await (await request('/import', { ...bind, makeDefault: true })).json();
    assert.equal(switchedBack.defaultPresenterId, saved.presenters[0].id, 'a completed own creation can become default again');
    failWrites = true;
    assert.equal((await request('/import', { ...initialSelection, authorized: true })).status, 400, 'failed default persistence never reports success');
    failWrites = false;
    const previousPrivateTenant = process.env.HEYGEN_PRIVATE_ASSET_TENANT_ID;
    try {
      process.env.HEYGEN_PRIVATE_ASSET_TENANT_ID = 'A';
      const privateCatalog = await (await request('/catalog?scope=private')).json();
      assert.equal(privateCatalog.items[0].id, 'private-photo');
      const privateSelection = { lookId: 'private-photo', voiceId: 'voice1', reviewed: true, authorized: true, makeDefault: true };
      assert.equal((await request('/import', privateSelection)).status, 400, 'private person needs explicit adult confirmation');
      assert.equal((await request('/import', { ...privateSelection, authorized: false, adultConfirmed: true })).status, 400);
      const privateImported = await (await request('/import', { ...privateSelection, adultConfirmed: true })).json();
      const ownedPresenter = privateImported.presenters.find((item: any) => item.avatarId === 'private-photo');
      assert.ok(ownedPresenter);
      assert.equal(validateHeyGenPresenterRecord(ownedPresenter).ok, true);
      assert.match(ownedPresenter.rightsEvidence.authorizationRef, /^document:\/\/studio_presenter_assets\//);
      assert.match(ownedPresenter.rightsEvidence.consentRef, /^consent:\/\/user-declaration\//);
      assert.equal(privateImported.defaultPresenterId, ownedPresenter.id);
      assert.equal([...rows.values()].filter(row => row.kind === 'import_authorization').length, 1);
      assert.equal((await (await request('/import', { ...privateSelection, adultConfirmed: true })).json()).presenters.length, privateImported.presenters.length);
      const retainedPrivateAuth = [...rows.entries()].find(([key, row]) => key.startsWith('studio_presenter_assets/') && row.kind === 'import_authorization')!;
      rows.set(retainedPrivateAuth[0], { ...retainedPrivateAuth[1], payload: { ...retainedPrivateAuth[1].payload, revokedAt: '2026-10-19T00:00:00Z' } });
      assert.equal((await request('/import', { ...privateSelection, adultConfirmed: true })).status, 400, 'revoked original consent cannot be replayed as a successful default selection');
      rows.set(retainedPrivateAuth[0], retainedPrivateAuth[1]);
      const defaultsEntry = [...rows.entries()].find(([key]) => key.startsWith('studio_production_defaults/'))!;
      const legacyDefaults = structuredClone(defaultsEntry[1]);
      legacyDefaults.payload.presenters = legacyDefaults.payload.presenters.map((item: any) => item.id === ownedPresenter.id
        ? { ...item, rightsEvidence: { ...item.rightsEvidence, authorizationRef: `license://heygen/public-catalog/${item.avatarId}`, subjectAdultConfirmed: false } }
        : item);
      rows.set(defaultsEntry[0], legacyDefaults);
      const privateAuthEntry = [...rows.entries()].find(([key, row]) => key.startsWith('studio_presenter_assets/') && row.kind === 'import_authorization')!;
      rows.set(privateAuthEntry[0], { ...privateAuthEntry[1], payload: { ...privateAuthEntry[1].payload, voiceId: 'tampered-voice' } });
      assert.equal((await request('/import', { ...privateSelection, adultConfirmed: true })).status, 400, 'a tampered retained authorization cannot upgrade a private presenter');
      rows.set(privateAuthEntry[0], privateAuthEntry[1]);
      const upgraded = await (await request('/import', { ...privateSelection, adultConfirmed: true })).json();
      const upgradedPresenter = upgraded.presenters.find((item: any) => item.id === ownedPresenter.id);
      assert.equal(upgradedPresenter.assetVersion, ownedPresenter.assetVersion + 1, 'legacy private imports require an explicit versioned rights upgrade');
      assert.equal(validateHeyGenPresenterRecord(upgradedPresenter).ok, true);
      assert.equal([...rows.values()].filter(row => row.kind === 'import_authorization').length, 1);
      const samePersonAsset = await (await upload('same-person-new-look', Buffer.from([137,80,78,71,13,10,26,10,0,0,0,2]))).json();
      const reuseInput = { ...input, uploadId: samePersonAsset.id, requestId: 'same-person-reuse', reusePresenterId: saved.presenters[0].id, samePersonConfirmed: true };
      assert.equal((await request('/creations', { ...reuseInput, samePersonConfirmed: false })).status, 400);
      assert.equal((await request('/creations', reuseInput, 'B')).status, 400);
      assert.equal(creates(), 1, 'invalid reuse cannot call the paid provider endpoint');
      const reused = await (await request('/creations', reuseInput)).json();
      assert.equal(reused.status, 'completed', 'accepted consent on the same group is reused');
      assert.equal(creates(), 2);
      assert.equal(calls.filter(c => c.url === 'https://api.heygen.com/v3/avatars').at(-1)?.body.avatar_group_id, 'created-group');
      assert.equal(calls.filter(c => c.url.endsWith('/created-group/consent')).length, 0, 'photo avatars never call the digital-twin-only HeyGen consent endpoint');
    } finally {
      if (previousPrivateTenant === undefined) delete process.env.HEYGEN_PRIVATE_ASSET_TENANT_ID;
      else process.env.HEYGEN_PRIVATE_ASSET_TENANT_ID = previousPrivateTenant;
    }
    budgetBlocked = true;
    const secondAsset = await (await upload('upload2', Buffer.from([137,80,78,71,13,10,26,10,0,0,0,1]))).json();
    assert.equal((await request('/creations', { ...input, uploadId: secondAsset.id, requestId: 'budget-denied' })).status, 400); assert.equal(creates(), 2); budgetBlocked = false;
    lost = true;
    const uncertainInput = { ...input, uploadId: secondAsset.id, requestId: 'lost-response' };
    const uncertain = await (await request('/creations', uncertainInput)).json(); assert.equal(uncertain.status, 'uncertain'); assert.equal(creates(), 3);
    assert.equal((await (await request('/creations', uncertainInput)).json()).id, uncertain.id);
    assert.equal((await request(`/creations/${uncertain.id}/refresh`, {})).status, 400); assert.equal(creates(), 3);
    const uncertainRetry = await (await request('/creations', { ...uncertainInput, requestId: 'new-id-same-file' })).json();
    assert.equal(uncertainRetry.id, uncertain.id, 'uncertain paid tasks are recovered instead of duplicated');
    lost = false; approved = false;
    const twinInput = { ...input, name: 'Digital twin', type: 'digital_twin', uploadId: training.id, requestId: 'digital-twin', voiceId: 'voice1' };
    const twin = await (await request('/creations', twinInput)).json();
    assert.equal(twin.status, 'pending_consent');
    const rerouteUrl = 'https://app.example.test/?page=digitalEmployees&presenterConsentReturn=job';
    const twinConsentResponse = await fetch(`${root}/creations/${twin.id}/consent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-tenant': 'A', Origin: 'https://app.example.test' }, body: JSON.stringify({ requestId: 'digital-twin-consent', rerouteUrl }) });
    const twinConsent = await twinConsentResponse.json();
    assert.equal(twinConsentResponse.status, 200); assert.match(twinConsent.consentUrl, /heygen.com/);
    assert.equal(calls.filter(c => c.url.endsWith('/created-group/consent')).at(-1)?.body.reroute_url, rerouteUrl);
    const processingTwin = await store.create<any>('studio_presenter_assets', { tenant_id: 'A', kind: 'creation', request_id: 'consent-already-processing', payload: { name: 'Processing consent', type: 'digital_twin', groupId: 'created-group', look: { ...look, id: 'private1', groupId: 'created-group', status: 'completed', orientation: 'portrait' }, status: 'pending_consent', consentStatus: 'pending', authorized: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
    consentProcessing = true;
    const processingConsentResponse = await request(`/creations/${processingTwin.id}/consent`, { requestId: 'processing-consent' });
    const processingConsent = await processingConsentResponse.json();
    assert.equal(processingConsentResponse.status, 200, 'an upstream consent-processing conflict remains a recoverable pending state');
    assert.equal(processingConsent.status, 'pending_consent');
    assert.ok(processingConsent.consentRequestedAt);
    assert.equal(processingConsent.error, '');
    consentProcessing = false;
    approved = true;
    assert.equal((await (await request(`/creations/${twin.id}/refresh`, {})).json()).status, 'completed');
    assert.equal((await request('/revoke', { presenterId: saved.presenters[0].id }, 'B')).status, 400, 'another tenant cannot revoke the presenter');
    const revoked = await (await request('/revoke', { presenterId: saved.presenters[0].id })).json();
    assert.equal(revoked.presenters.some((item: any) => item.id === saved.presenters[0].id), false);
    assert.notEqual(revoked.defaultPresenterId, saved.presenters[0].id);
    const revocationAudit = [...rows.values()].find(row => row.kind === 'revocation' && row.tenant_id === 'A');
    assert.equal(revocationAudit.payload.presenterId, saved.presenters[0].id);
    assert.ok(revocationAudit.payload.revokedAt);
    assert.deepEqual(await (await request('/revoke', { presenterId: saved.presenters[0].id })).json(), revoked, 'repeated cancellation is idempotent');
    assert.ok(calls.every(c => c.init.redirect === 'error'));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('adapter submits direct consent with an asset source and never exposes upstream secret-bearing errors', async () => {
  let received: any;
  const client = new HeyGenPresenterClient('secret', (async (_url: string, init: RequestInit) => { received = JSON.parse(String(init.body)); return new Response(JSON.stringify({ data: { avatar_group: { id: 'g' } } })); }) as typeof fetch);
  await client.consent('g', 'req', 'asset'); assert.deepEqual(received, { consent_video: { type: 'asset_id', asset_id: 'asset' } });
  await client.consent('g', 'req-redirect', undefined, 'https://app.example.test/return'); assert.deepEqual(received, { reroute_url: 'https://app.example.test/return' });
  const denied = new HeyGenPresenterClient('secret', (async () => new Response(JSON.stringify({ error: { message: 'key=secret' } }), { status: 403 })) as typeof fetch);
  await assert.rejects(() => denied.looks(), /403：当前账号未开通此接口权限/);
});

test('adapter safely retries transient read failures and localizes exhausted network errors', async () => {
  let attempts = 0;
  const recovered = new HeyGenPresenterClient('secret', (async () => {
    attempts += 1;
    if (attempts < 3) throw new TypeError('fetch failed');
    return new Response(JSON.stringify({ data: { id: 'group-1', status: 'processing' } }));
  }) as typeof fetch);
  assert.equal((await recovered.group('group-1')).status, 'processing');
  assert.equal(attempts, 3);

  const unavailable = new HeyGenPresenterClient('secret', (async () => { throw new TypeError('fetch failed'); }) as typeof fetch);
  await assert.rejects(() => unavailable.group('group-1'), /HeyGen 网络连接失败，请稍后刷新原任务/);
});


test('large person videos finish direct upload before becoming usable and do not leak the API key', async () => {
  const calls: string[] = [];
  const client = new HeyGenPresenterClient('private-test-key', async (url, options) => {
    calls.push(String(url));
    if (String(url).endsWith('direct-uploads')) return new Response(JSON.stringify({ data: { asset_id: 'asset-large', upload_url: 'https://files.heygen.ai/upload', upload_headers: { 'Content-Type': 'video/mp4' } } }));
    if (String(url) === 'https://files.heygen.ai/upload') { assert.equal(new Headers(options?.headers).has('x-api-key'), false); assert.equal(options?.method, 'PUT'); return new Response('', { status: 200 }); }
    assert.match(String(url), /asset-large\/complete$/);
    return new Response(JSON.stringify({ data: { asset_id: 'asset-large' } }));
  });
  assert.equal(await client.upload(Buffer.alloc(32 * 1024 * 1024 + 1), 'video/mp4', 'large-upload'), 'asset-large');
  assert.equal(calls.length, 3);
});

test('local photo ingress persists exact bytes once and isolates identical uploads by tenant', async () => {
  const fs = await import('node:fs/promises'); const os = await import('node:os'); const path = await import('node:path');
  const { dataAuthorityRequestScope, bindDataAuthority } = await import('../storage/dataAuthority.js');
  const { readLocalMaterials } = await import('../lib/materialLibrary.js');
  const previousCwd = process.cwd(), previousDriver = process.env.OBJECT_STORAGE_DRIVER;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lingshu-photo-ingress-'));
  process.chdir(directory); process.env.OBJECT_STORAGE_DRIVER = 'local';
  const app=express(); app.use(dataAuthorityRequestScope); app.use((req,res,next)=>{bindDataAuthority(req.headers['x-authority']==='pocketbase'?'pocketbase':'local');res.locals.tenantId=req.headers['x-tenant']||'A';next();});
  app.use(createPresenterAssetsRouter({} as DataStore,async(_key,operation)=>operation()));
  const server=app.listen(0,'127.0.0.1'); await new Promise<void>(resolve=>server.once('listening',resolve));
  const root=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR0cAAAAASUVORK5CYII=','base64');
  const upload=(tenant='A',body=bytes,authority='local')=>fetch(`${root}/photo-materials?mime=image/png`,{method:'POST',headers:{'Content-Type':'application/octet-stream','x-tenant':tenant,'x-authority':authority},body});
  try {
    assert.equal((await upload('A',Buffer.from('invalid'))).status,400);
    assert.equal((await upload('A',bytes,'pocketbase')).status,409);
    const first=await (await upload()).json(),repeat=await (await upload()).json(),other=await (await upload('B')).json();
    assert.equal(first.ok,true);assert.equal(first.material.id,repeat.material.id);assert.notEqual(first.material.id,other.material.id);
    assert.deepEqual(await fs.readFile(path.join(directory,'data/media',first.material.file)),bytes);
    assert.equal(readLocalMaterials().length,2);assert.equal(readLocalMaterials().find(row=>row.id===other.material.id)?.tenantId,'B');
  } finally {
    await new Promise<void>(resolve=>server.close(()=>resolve()));process.chdir(previousCwd);
    if(previousDriver===undefined)delete process.env.OBJECT_STORAGE_DRIVER;else process.env.OBJECT_STORAGE_DRIVER=previousDriver;
    await fs.rm(directory,{recursive:true,force:true});
  }
});
