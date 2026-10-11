import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {buildSocialProductSceneReplicationSpec} from '../../shared/socialContentAssetSupply.js';
import {generateSeedanceConceptVideo} from '../lib/generativeVideoGateway.js';
import {runVisualFfmpeg} from '../lib/renderVisualQuality.js';
import {socialRequestHash} from './socialContentValidation.js';
import {firstFrameInputFingerprint} from '../lib/firstFrameGenerator.js';
import {createEnvironmentProductReplacementPorts, productReplacementOperationFingerprint, type ProductReplacementEnvironmentContext} from './socialContentProductReplacementEnvironment.js';
import {createEnvironmentSeedanceProductScenePorts} from './socialContentSeedanceProductScene.js';
import type {MvpBudgetRecord} from '../lib/mvpBudgetAdmission.js';
const sha = (x: Buffer | string) => createHash('sha256').update(x).digest('hex');
async function fixture(rights = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'product-environment-'));
  const product = await sharp({create: {width: 160, height: 288, channels: 3, background: '#87a3c0'}}).png().toBuffer();
  const source = path.join(root, 'source.mp4');
  const rendered = await runVisualFfmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=160x288:rate=24', '-t', '4', '-c:v', 'libx264', '-y', source], false, {timeoutMs: 120000});
  assert.equal(rendered.ok, true);
  const video = fs.readFileSync(source);
  const spec = buildSocialProductSceneReplicationSpec({shot: {shotId: 'S04', function: 'demonstration', requestedDescription: 'Hold the package'}, inventory: {customerVideoIds: [], productImageIds: ['KB'], presenterAssetIds: [], referenceVideoIds: [], factoryEvidenceAssetIds: [], customerCaseEvidenceAssetIds: [], productEffectEvidenceAssetIds: [], licensedStockAssetIds: [], productIdentityGroups: [{productRef: 'product', imageIds: ['KB']}]}})!;
  spec.cameraLock.durationSeconds = 3;
  spec.referenceSourceId = 'system-reference:source'; spec.referenceShotId = 'ref-shot';
  const routing = {schemaVersion: 'social-material-routing.v1' as const, materialType: 'product' as const, policy: 'local_first_product_i2v' as const,
    localMatch: {state: 'missing' as const, sourceRefs: [], evidenceRef: null}, generation: {method: 'reference_first_frame_product_replacement_i2v' as const, durationSeconds: 3, productImageRefs: ['KB'], referenceSourceId: spec.referenceSourceId, referenceShotId: spec.referenceShotId}};
  const task = {id: 'record-task', task_id: 'task', tenant_id: 'tenant', version: 1, run_id: 'run', brief: {productId: 'product', targetAccountRef: null, perItemBudgetCny: 10}, replication_script: {shots: [{shotId: 'S04', materialPlan: {materialRouting: routing, productSceneReplication: spec}}]}};
  const handoff = {inspirationId: 'inspiration-analysis', source: {sourceUrl: 'https://example.test/owned-source'}, taskContext: {taskId: 'task'}, rights: {mayUseOriginalMedia: rights, mayAdapt: rights}};
  let downloads = 0;
  const context: ProductReplacementEnvironmentContext = {
    dataStore: {getById: async (table: string, id: string) => (table === 'starter_social_content_tasks' ? task : table === 'starter_social_inspiration_handoff_versions' ? {id: 'handoff', tenant_id: 'tenant', payload: handoff, record_hash: socialRequestHash(handoff)} : table === 'trend_videos' && id === 'source' ? {tenantId: 'tenant', sourceUrl: handoff.source.sourceUrl, objectKey: 'source-key', contentSha256: sha(video)} : null),
      list: async (table: string) => ({items: table === 'starter_social_content_tasks' ? [task] : [{id: 'handoff', tenant_id: 'tenant', payload: handoff, record_hash: socialRequestHash(handoff)}], totalItems: 1})} as unknown as ProductReplacementEnvironmentContext['dataStore'],
    materials: async () => ({items: [{id: 'KB', type: 'image', tenantId: 'tenant', productId: 'product', objectKey: 'product-key', contentSha256: sha(product)}], sources: [], status: 'ready'}),
    download: async key => {downloads++; return {buf: key === 'product-key' ? product : video, contentType: key === 'product-key' ? 'image/png' : 'video/mp4'};},
    budgetRoot: path.join(root, 'budgets'), durableRoot: path.join(root, 'durable'),
  };
  fs.mkdirSync(path.join(root, 'workspace'));
  const input = {tenantId: 'tenant', taskId: 'task', shotId: 'S04', idempotencyKey: 'fixture-operation', spec, materialRouting: routing,
    referenceImages: [{assetId: 'KB', productRef: 'product', url: 'never-fetch-client-url', contentHash: sha(product)}], outputDirectory: path.join(root, 'workspace'), maximumCostCny: 10};
  const records = new Map<string, MvpBudgetRecord>();
  const addQuote = (fp: string, provider: string, model: string, amount: number) => {
    const id = `fixture-${provider}`;
    const existingFile = path.join(context.budgetRoot!, `${sha(id)}.json`);
    const record: MvpBudgetRecord = (fs.existsSync(existingFile) ? JSON.parse(fs.readFileSync(existingFile, 'utf8')) : records.get(id)) || {schemaVersion: 1 as const, id, tenantId: 'tenant', taskId: 'task', session: 'B' as const, limitCny: 10,
      authorizations: [{tenantId: 'tenant', taskId: 'task', version: 1, session: 'B' as const, accountId: null, productId: 'product', runId: 'run', action: 'generate_media' as const,
        authority: 'customer' as const, expiresAt: new Date(Date.now() + 60000).toISOString(), revoked: false, provider, model, shotIds: ['S04'], authorizedBy: 'fixture-only', authorizationRef: 'fixture-only', budgetPoolId: id, budgetLimitCny: 10}],
      pricing: {verifiedAccountPrice: true, checkedAt: new Date(Date.now() - 1000).toISOString(), validUntil: new Date(Date.now() + 60000).toISOString(), balanceCny: 100, evidenceRef: 'fixture-not-production-price', operationQuotes: {}}, entries: {}};
    record.pricing.operationQuotes[fp] = {provider, model, upperBoundCny: amount};
    records.set(id, record); fs.mkdirSync(context.budgetRoot!, {recursive: true});
    fs.writeFileSync(path.join(context.budgetRoot!, `${sha(id)}.json`), JSON.stringify(record), {mode: 0o600});
  };
  return {root, input, context, task, handoff, product, video, addQuote, downloads: () => downloads};
}
test('default reader rejects structural-only public pixels before downloads or provider work', async () => {
  const f = await fixture(false), ports = await createEnvironmentProductReplacementPorts(f.input, f.context);
  await assert.rejects(ports.composition(f.input), /pixels_usage_missing/); assert.equal(f.downloads(), 0);
  f.task.tenant_id = 'other'; await assert.rejects(ports.assertCurrent(), /task_changed/);
});
test('canonical frozen materialPlan and actual composition/product bytes are read; missing exact quote blocks paid preparation', async () => {
  const f = await fixture(), ports = await createEnvironmentProductReplacementPorts(f.input, f.context);
  const composition = await ports.composition(f.input); assert.ok(composition); assert.match(composition.usageEvidenceRef, /^handoff:/);
  const products = await ports.products(f.input); assert.equal(products[0]!.sha256, sha(f.product));
  assert.equal((await sharp(composition.reference.bytes).metadata()).width, 160);
  let paid = 0; f.context.prepareFrame = (async () => {paid++; throw Error('must not submit');}) as typeof f.context.prepareFrame;
  const factory = createEnvironmentSeedanceProductScenePorts({replacementEnvironment: f.context});
  await assert.rejects(factory.execute(f.input), /exact_server_budget_quote_missing/); assert.equal(paid, 0);
});
test('environment ports integrate actual extraction, exact budget grants, provider4s, real trim3s, bounded delivered-media QA and terminal replay', async () => {
  const f = await fixture();
  const frameModel = process.env.SEEDREAM_IMAGE_MODEL || 'doubao-seedream-5-0-pro-260628';
  const videoModel = process.env.SEEDANCE_MODEL || 'doubao-seedance-2-0-fast-260128';
  const qaModel = process.env.QWEN_VL_MODEL || 'qwen3-vl-plus';
  let frameCalls = 0, videoCalls = 0, qaCalls = 0;
  f.context.prepareFrame = (async (input, ports) => {
    frameCalls++; const fp = firstFrameInputFingerprint(input.request, 'seedream', frameModel);
    assert.deepEqual(input.request.references.map(r => r.role), ['source_composition', 'product_identity']);
    await ports.reserveQa(fp); await ports.reserve(fp); await ports.assertCurrent();
    fs.mkdirSync(input.root, {recursive: true});
    const filePath = path.join(input.root, `${fp}.png`); fs.writeFileSync(filePath, f.product);
    fs.writeFileSync(path.join(input.root, `${fp}.json`), JSON.stringify({state: 'evaluated', outputSha256: sha(f.product)}));
    return {filePath, providerRequestId: 'controlled-frame', model: frameModel, qaModel, canProceedToVideo: true};
  }) as typeof f.context.prepareFrame;
  f.context.generateVideo = async request => {
    videoCalls++; assert.equal(request.durationSeconds, 4); assert.ok(request.firstFrameDataUrl); assert.equal(request.referenceVideoUrl, undefined); assert.equal(request.referenceImageDataUrls, undefined);
    return {bytes: f.video, providerTaskId: 'controlled-video', providerId: 'seedance', model: videoModel, duration: 4, estimatedCostCny: 4};
  };
  f.context.inspectVisual = async request => {
    qaCalls++; assert.equal(request.frames.length, 3); assert.ok(request.boundedPaidQa);
    request.onReceipt?.({provider: 'controlled-fixture', requestId: 'controlled-qa'});
    return ['product_identity', 'environment_fidelity', 'layout_continuity', 'contact_continuity', 'action_order', 'end_state', 'visual_integrity'].map(key => ({key, verdict: 'pass', note: 'Controlled no-network fixture', evidenceFrames: request.frames.map(r => r.timeLabel)}));
  };
  const ports = await createEnvironmentProductReplacementPorts(f.input, f.context);
  const firstFrame = ports.firstFrame, video = ports.video, quality = ports.quality;
  ports.firstFrame = async request => {
    const fp = firstFrameInputFingerprint(request, 'seedream', frameModel);
    f.addQuote(fp, 'seedream', frameModel, .6); f.addQuote(productReplacementOperationFingerprint('first-frame-qa', {fingerprint: fp, qaModel}), 'qwen', qaModel, .1);
    return firstFrame(request);
  };
  ports.video = async request => {
    f.addQuote(productReplacementOperationFingerprint('video', {...request, firstFrame: sha(request.firstFrame), checkpointPath: undefined, model: videoModel}), 'seedance', videoModel, 4);
    return video(request);
  };
  ports.quality = async request => {
    f.addQuote(productReplacementOperationFingerprint('video-qa', {mediaSha256: sha(fs.readFileSync(request.filePath)), qaModel, directorScene: request.directorScene, products: request.productReferences.map(r => r.sha256)}), 'qwen', qaModel, .1);
    return quality(request);
  };
  const old = process.env.SEEDANCE_VIDEO_ENABLED; process.env.SEEDANCE_VIDEO_ENABLED = 'true';
  try {
    const factory = createEnvironmentSeedanceProductScenePorts({replacementPorts: ports});
    const result = await factory.execute(f.input); assert.equal(result.status, 'completed');
    if (result.status !== 'completed') throw Error('unexpected');
    const budgetDirectory = path.join(path.dirname(f.context.budgetRoot!), 'social-content-task-budget');
    const ledger = JSON.parse(fs.readFileSync(path.join(budgetDirectory, fs.readdirSync(budgetDirectory).find(n => n.endsWith('.json'))!), 'utf8'));
    assert.equal(ledger.limitMicros, 10000000);
    assert.equal(Object.values(ledger.entries).reduce((total: number, e: any) => total + e.reservedMicros, 0), 4800000, 'both QA stages count against the whole-film ceiling');
    assert.equal(result.duration, 3); assert.equal(result.actualCostCny, null); assert.equal(result.estimatedCostCny, 4.8);
    const evidence = result.quality.evidenceRefs.filter(ref => ref.endsWith('.json'));
    fs.rmSync(f.input.outputDirectory, {recursive: true, force: true}); fs.mkdirSync(f.input.outputDirectory);
    assert.ok(evidence.every(ref => fs.existsSync(ref)));
    await factory.execute(f.input); assert.equal(videoCalls, 1); assert.equal(qaCalls, 1); assert.equal(frameCalls, 2);
    assert.ok(fs.existsSync(result.localPath));
  } finally { if (old === undefined) delete process.env.SEEDANCE_VIDEO_ENABLED; else process.env.SEEDANCE_VIDEO_ENABLED = old; }
});
test('unknown accepted video submission cannot trigger another POST without its canonical task checkpoint', async () => {
  const f = await fixture();
  const model = process.env.SEEDANCE_MODEL || 'doubao-seedance-2-0-fast-260128';
  let calls = 0;
  f.context.generateVideo = async () => {calls++; throw Error('transport lost after submission');};
  const ports = await createEnvironmentProductReplacementPorts(f.input, f.context);
  const request = {requestId: 'fixture-unknown-video', firstFrame: f.product, prompt: 'Actual director motion', providerDurationSeconds: 4, checkpointPath: path.join(f.root, 'unknown.json')};
  const fp = productReplacementOperationFingerprint('video', {...request, firstFrame: sha(request.firstFrame), checkpointPath: undefined, model});
  f.addQuote(fp, 'seedance', model, 4);
  const old = process.env.SEEDANCE_VIDEO_ENABLED; process.env.SEEDANCE_VIDEO_ENABLED = 'true';
  try {
    await assert.rejects(ports.video(request), /transport lost/);
    fs.rmSync(f.input.outputDirectory, {recursive: true, force: true}); fs.mkdirSync(f.input.outputDirectory);
    const restarted = await createEnvironmentProductReplacementPorts(f.input, f.context);
    await assert.rejects(restarted.video({...request, checkpointPath: path.join(f.input.outputDirectory, 'new-worker.json')}), /submission_unknown_requires_original_receipt/);
    assert.equal(calls, 1);
    const pool = JSON.parse(fs.readFileSync(path.join(f.context.budgetRoot!, `${sha('fixture-seedance')}.json`), 'utf8'));
    assert.equal(Object.values(pool.entries).length, 1);
    assert.equal((Object.values(pool.entries)[0] as {amountCny: number}).amountCny, 4);
  } finally {if (old === undefined) delete process.env.SEEDANCE_VIDEO_ENABLED; else process.env.SEEDANCE_VIDEO_ENABLED = old;}
});
test('stored pixel authorization revoked after extraction blocks the next paid boundary', async () => {
  const f = await fixture();
  const ports = await createEnvironmentProductReplacementPorts(f.input, f.context);
  await ports.composition(f.input);
  f.handoff.rights.mayUseOriginalMedia = false;
  await assert.rejects(ports.assertCurrent(), /pixels_usage_changed/);
});
test('registered task-file URL uses canonical tenant file reader and exact single productRef association', async () => {
  const f = await fixture();
  const file = {id: 'file-row', tenant_id: 'tenant', task_id: 'task', file_id: 'socialfile_registered', usage: 'source', byte_size: f.product.length,
    content_sha256: sha(f.product), name: 'packaging.png', mime_type: 'image/png', storage_kind: 'backend_file', storage_key: 'registered.png'};
  const originalList = f.context.dataStore!.list.bind(f.context.dataStore);
  f.context.dataStore!.list = (async (table: string, options: unknown) => table === 'starter_social_content_files' ? {items: [file], totalItems: 1} : originalList(table, options as never)) as NonNullable<ProductReplacementEnvironmentContext['dataStore']>['list'];
  f.context.materials = async () => ({items: [{id: 'KB', type: 'image', tenantId: 'tenant', productRef: 'product', sourceType: 'social_task_upload',
    url: '/api/overseas/starter-198/social-content/files/socialfile_registered', contentSha256: sha(f.product)}], sources: [], status: 'ready'});
  let backendReads = 0;
  f.context.backendFilePort = {attach: async () => {throw Error('read-only');}, fetch: async input => {
    backendReads++; assert.equal(input.recordId, 'file-row'); assert.equal(input.filename, 'registered.png'); return {buf: f.product, contentType: 'image/png'};
  }};
  const ports = await createEnvironmentProductReplacementPorts(f.input, f.context);
  assert.equal((await ports.products(f.input))[0]!.sha256, sha(f.product)); assert.equal(backendReads, 1);
  assert.equal(f.downloads(), 0);
  file.tenant_id = 'other'; await assert.rejects(ports.products(f.input)); assert.equal(backendReads, 1);
  file.tenant_id = 'tenant'; file.content_sha256 = '0'.repeat(64);
  await assert.rejects(ports.products(f.input), /registered_task_file_invalid/); assert.equal(backendReads, 1);
});
test('wrong SKU, arbitrary URL and changed canonical task-file SHA cannot reach provider bytes', async () => {
  const f = await fixture(); let calls = 0;
  const material = {id: 'KB', type: 'image', tenantId: 'tenant', productRef: 'other-SKU', url: 'https://example.test/arbitrary.png', contentSha256: sha(f.product)};
  f.context.materials = async () => ({items: [material], sources: [], status: 'ready'});
  f.context.readRegisteredFile = async () => {calls++; return Buffer.from('changed');};
  const ports = await createEnvironmentProductReplacementPorts(f.input, f.context);
  await assert.rejects(ports.products(f.input), /same_tenant_packaging_missing/);
  material.productRef = 'product'; await assert.rejects(ports.products(f.input), /registered_bytes_changed/); assert.equal(calls, 0);
  material.url = '/api/overseas/starter-198/social-content/files/socialfile_registered';
  await assert.rejects(ports.products(f.input), /registered_bytes_changed/); assert.equal(calls, 1);
});
test('actual Seedream prepared fence survives render cleanup and a fresh environment instance', async () => {
  const f = await fixture();
  const model = process.env.SEEDREAM_IMAGE_MODEL || 'doubao-seedream-5-0-pro-260628', qaModel = process.env.QWEN_VL_MODEL || 'qwen3-vl-plus';
  const request = {referenceMode: 'product_scene' as const, tenantId: 'tenant', videoId: 'task', compositionId: 'S04', presenterVersion: 'KB-v1',
    prompt: 'Replace only the package, retaining the real composition.', ratio: '9:16' as const, idempotencyKey: 'fixture-frame',
    references: [{role: 'source_composition' as const, bytes: f.product, mimeType: 'image/png' as const, sha256: sha(f.product)},
      {role: 'product_identity' as const, bytes: f.product, mimeType: 'image/png' as const, sha256: sha(f.product)}]};
  const fp = firstFrameInputFingerprint(request, 'seedream', model);
  f.addQuote(fp, 'seedream', model, .6); f.addQuote(productReplacementOperationFingerprint('first-frame-qa', {fingerprint: fp, qaModel}), 'qwen', qaModel, .1);
  const oldKey = process.env.SEEDREAM_API_KEY, oldBase = process.env.SEEDREAM_BASE_URL, oldFetch = globalThis.fetch;
  process.env.SEEDREAM_API_KEY = 'controlled-no-real-provider'; process.env.SEEDREAM_BASE_URL = 'http://127.0.0.1:1';
  let posts = 0;
  globalThis.fetch = async url => {assert.ok(String(url).startsWith('http://127.0.0.1:1/')); posts++; throw Error('controlled unknown submit');};
  try {
    const ports = await createEnvironmentProductReplacementPorts(f.input, f.context);
    await assert.rejects(ports.firstFrame(request), /请求状态未知/);
    fs.rmSync(f.input.outputDirectory, {recursive: true, force: true}); fs.mkdirSync(f.input.outputDirectory);
    const restarted = await createEnvironmentProductReplacementPorts({...f.input, outputDirectory: path.join(f.root, 'different-worker-workspace')}, f.context);
    await assert.rejects(restarted.firstFrame(request), /original_receipt_reconciliation/);
    assert.equal(posts, 1);
    const firstFrames: string[] = [];
    const walk = (directory: string) => {for (const name of fs.readdirSync(directory)) {const file = path.join(directory, name); if (fs.statSync(file).isDirectory()) walk(file); else if (name === `${fp}.json`) firstFrames.push(file);}};
    walk(f.context.durableRoot!); assert.equal(firstFrames.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(firstFrames[0]!, 'utf8')).state, 'prepared');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.SEEDREAM_API_KEY; else process.env.SEEDREAM_API_KEY = oldKey;
    if (oldBase === undefined) delete process.env.SEEDREAM_BASE_URL; else process.env.SEEDREAM_BASE_URL = oldBase;
  }
});
test('actual Seedance gateway resumes the original accepted task with GET after workspace cleanup', async () => {
  const f = await fixture(), model = process.env.SEEDANCE_MODEL || 'doubao-seedance-2-0-fast-260128';
  let posts = 0, gets = 0, gatewayCalls = 0;
  const transport: typeof fetch = async (url, init) => {
    const address = String(url);
    if (init?.method === 'POST') {assert.ok(address.startsWith('http://127.0.0.1:1/')); posts++; return new Response(JSON.stringify({id: 'controlled-original-task'}), {status: 200});}
    if (address.endsWith('/controlled-original-task')) {gets++; return new Response(JSON.stringify({status: 'succeeded', content: {video_url: 'https://controlled-media.test/controlled.mp4'}}), {status: 200});}
    assert.equal(address, 'https://controlled-media.test/controlled.mp4'); return new Response(f.video, {status: 200});
  };
  f.context.generateVideo = request => generateSeedanceConceptVideo({...request, apiKey: 'controlled', baseUrl: 'http://127.0.0.1:1', transport,
    timeoutMs: gatewayCalls++ === 0 ? 0 : 1000, reserveBudget: () => ({ok: true, reservationId: 'controlled-monthly-reservation', limitCny: 10, usedCny: 0, reservedCny: 4, remainingCny: 6}),
    releaseBudget: () => {throw Error('accepted reservation must be retained');}});
  const request = {requestId: 'controlled-original-video', firstFrame: f.product, prompt: 'Animate original director motion', providerDurationSeconds: 4, checkpointPath: path.join(f.input.outputDirectory, 'first-worker.json')};
  const fp = productReplacementOperationFingerprint('video', {...request, firstFrame: sha(f.product), checkpointPath: undefined, model});
  f.addQuote(fp, 'seedance', model, 4);
  const old = process.env.SEEDANCE_VIDEO_ENABLED; process.env.SEEDANCE_VIDEO_ENABLED = 'true';
  try {
    const ports = await createEnvironmentProductReplacementPorts(f.input, f.context);
    await assert.rejects(ports.video(request), /timed out; do not resubmit/);
    fs.rmSync(f.input.outputDirectory, {recursive: true, force: true});
    const restarted = await createEnvironmentProductReplacementPorts({...f.input, outputDirectory: path.join(f.root, 'next-worker')}, f.context);
    const result = await restarted.video({...request, checkpointPath: path.join(f.root, 'next-worker', 'other.json')});
    assert.equal(result.providerTaskId, 'controlled-original-task'); assert.equal(sha(result.bytes), sha(f.video)); assert.equal(posts, 1); assert.equal(gets, 1);
  } finally {if (old === undefined) delete process.env.SEEDANCE_VIDEO_ENABLED; else process.env.SEEDANCE_VIDEO_ENABLED = old;}
});
