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
import {createEnvironmentProductReplacementPorts, productReplacementOperationFingerprint, readProductReplacementRequestBounds, type ProductReplacementEnvironmentContext} from './socialContentProductReplacementEnvironment.js';
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
test('media URL product bytes resolve against the configured worker media root',async()=>{
  const f=await fixture(),mediaRoot=path.join(f.root,'canonical-media'),relative='tenants/tenant/catalog/product.png';
  fs.mkdirSync(path.dirname(path.join(mediaRoot,relative)),{recursive:true});fs.writeFileSync(path.join(mediaRoot,relative),f.product);
  f.context.materials=async()=>({items:[{id:'KB',type:'image',tenantId:'tenant',productId:'product',url:'/media/'+relative,contentSha256:sha(f.product)}],sources:[],status:'ready'});
  const prior=process.env.SOCIAL_CONTENT_MEDIA_ROOT;process.env.SOCIAL_CONTENT_MEDIA_ROOT=mediaRoot;
  try{const ports=await createEnvironmentProductReplacementPorts(f.input,f.context);assert.equal((await ports.products(f.input))[0]!.sha256,sha(f.product));}
  finally{if(prior===undefined)delete process.env.SOCIAL_CONTENT_MEDIA_ROOT;else process.env.SOCIAL_CONTENT_MEDIA_ROOT=prior;}
});
test('environment ports integrate actual extraction, exact budget grants, provider4s, real trim3s, bounded delivered-media QA and terminal replay', async () => {
  const f = await fixture();
  const frameModel = process.env.SEEDREAM_IMAGE_MODEL || 'doubao-seedream-5-0-pro-260628';
  const videoModel = process.env.SEEDANCE_MODEL || 'doubao-seedance-2-0-fast-260128';
  const qaModel = process.env.QWEN_VL_MODEL || 'qwen3-vl-plus';
  let frameCalls = 0, videoCalls = 0, qaCalls = 0;
  let provisionQuotes = true;
  f.context.prepareFrame = (async (input, ports) => {
    frameCalls++; const fp = firstFrameInputFingerprint(input.request, 'seedream', frameModel);
    assert.deepEqual(input.request.references.map(r => r.role), ['source_composition', 'product_identity']);
    await ports.reserveQa(fp); await ports.reserve(fp); await ports.assertCurrent();
    fs.mkdirSync(input.root, {recursive: true});
    const filePath = path.join(input.root, `${fp}.png`); fs.writeFileSync(filePath, f.product);
    fs.writeFileSync(path.join(input.root, `${fp}.json`), JSON.stringify({fingerprint: fp, tenantId: input.request.tenantId, projectId: input.request.videoId, shotId: input.request.compositionId, state: 'evaluated', model: frameModel, qaModel, providerRequestId: 'controlled-frame', filePath, outputSha256: sha(f.product), canProceedToVideo: true}));
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
    if (provisionQuotes) {
      f.addQuote(fp, 'seedream', frameModel, .6);
      f.addQuote(productReplacementOperationFingerprint('first-frame-qa', {fingerprint: fp, qaModel}), 'qwen', qaModel, .1);
    }
    return firstFrame(request);
  };
  ports.video = async request => {
    if (provisionQuotes) f.addQuote(productReplacementOperationFingerprint('video', {...request, firstFrame: sha(request.firstFrame), checkpointPath: undefined, model: videoModel}), 'seedance', videoModel, 4);
    return video(request);
  };
  ports.quality = async request => {
    if (provisionQuotes) f.addQuote(productReplacementOperationFingerprint('video-qa', {mediaSha256: sha(fs.readFileSync(request.filePath)), qaModel, directorScene: request.directorScene, products: request.productReferences.map(r => r.sha256)}), 'qwen', qaModel, .1);
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
    provisionQuotes = false;
    for (const name of fs.readdirSync(f.context.budgetRoot!)) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(f.context.budgetRoot!, name);
      const record = JSON.parse(fs.readFileSync(file, 'utf8'));
      record.pricing.operationQuotes = [];
      record.pricing.expiresAt = '2000-01-01T00:00:00.000Z';
      fs.writeFileSync(file, JSON.stringify(record));
    }
    process.env.SEEDANCE_VIDEO_ENABLED = 'false';
    await factory.execute(f.input); assert.equal(videoCalls, 1); assert.equal(qaCalls, 1); assert.equal(frameCalls, 1);
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
    for (const name of fs.readdirSync(f.context.budgetRoot!)) {if (!name.endsWith('.json')) continue; const file = path.join(f.context.budgetRoot!, name), pool = JSON.parse(fs.readFileSync(file, 'utf8')); pool.pricing.operationQuotes = {}; pool.pricing.validUntil = '2020-01-01T00:00:00Z'; fs.writeFileSync(file, JSON.stringify(pool));}
    const restarted = await createEnvironmentProductReplacementPorts({...f.input, outputDirectory: path.join(f.root, 'next-worker')}, f.context);
    const result = await restarted.video({...request, checkpointPath: path.join(f.root, 'next-worker', 'other.json')});
    assert.equal(result.providerTaskId, 'controlled-original-task'); assert.equal(sha(result.bytes), sha(f.video)); assert.equal(posts, 1); assert.equal(gets, 1);
  } finally {if (old === undefined) delete process.env.SEEDANCE_VIDEO_ENABLED; else process.env.SEEDANCE_VIDEO_ENABLED = old;}
});
test('authored default environment accepts owned KB with structural-only reference rights and never reads source pixels', async () => {
  const f = await fixture(false);
  const routing = {...f.input.materialRouting, generation: {...f.input.materialRouting.generation,
    method: 'enterprise_authored_product_first_frame_i2v' as const, firstFrameOrigin: 'enterprise_authored_storyboard' as const}};
  Object.assign(f.task.replication_script.shots[0]!.materialPlan, {materialRouting: routing});
  const input = {...f.input, materialRouting: routing};
  const ports = await createEnvironmentProductReplacementPorts(input, f.context);
  await assert.rejects(ports.composition(input), /must_not_read_reference_pixels/);
  assert.equal(f.downloads(), 0);
  const products = await ports.products(input);
  assert.equal(products[0]!.sha256, sha(f.product));
  assert.equal(f.downloads(), 1);
  await ports.assertCurrent();
  const bounds=await readProductReplacementRequestBounds(input,f.context);
  assert.equal(bounds.firstFrameMaximumFrames,2);assert.equal(bounds.videoMaximumFrames,5);
  assert.deepEqual(bounds.productSha256s,[sha(f.product)]);assert.equal(bounds.providerDurationSeconds,4);
  assert.equal(fs.existsSync(f.context.budgetRoot!),false);
});

test('whole preallocated four-stage context executes canonical authored pipeline with no MVP quote or duplicate reservation, then replays after cleanup',async()=>{
  const f=await fixture(false);
  const routing={...f.input.materialRouting,generation:{...f.input.materialRouting.generation,method:'enterprise_authored_product_first_frame_i2v' as const,firstFrameOrigin:'enterprise_authored_storyboard' as const}};
  Object.assign(f.task.replication_script.shots[0]!.materialPlan,{materialRouting:routing});
  const input={...f.input,materialRouting:routing};
  const {paidProductionHash}=await import('./socialContentPaidOperationPlan.js');
  const scope={tenantId:'tenant',taskId:'task',runId:'run',planHash:'a'.repeat(64)};
  const stages=['first_frame','first_frame_qa','video','video_qa'] as const;
  const models={first_frame:process.env.SEEDREAM_IMAGE_MODEL||'doubao-seedream-5-0-pro-260628',first_frame_qa:'qwen3-vl-plus',video:process.env.SEEDANCE_MODEL||'doubao-seedance-2-0-fast-260128',video_qa:'qwen3-vl-plus'};
  const requirements=stages.map(stage=>({key:`scene:S04:${stage}`,stage,shotId:'S04',sourceRef:null,durationSeconds:stage==='video'?3:null,text:null,frameCount:stage.endsWith('_qa')?5:null,inputContractHash:'b'.repeat(64)}));
  const routes: Record<string,import('./socialContentPaidOperationPlan.js').BoundPaidRoute>=Object.fromEntries(requirements.map(r=>[r.key,{provider:r.stage.endsWith('_qa')?'qwen':r.stage==='video'?'seedance':'seedream',model:models[r.stage as keyof typeof models],accountRef:'fixture-provider-account',routeEvidenceRef:'canonical-fixture-route',usageBoundRef:'request-enforced-fixture',maximumAttempts:1,maximumUnits:r.stage.endsWith('_qa')?{frames:5,inputTokens:32000,outputTokens:4096}:r.stage==='video'?{providerSeconds:4,requests:1}:{images:2,requests:1} as Record<string,number>}]));
  const intents=requirements.map(r=>{const route=routes[r.key]!;return {operationId:'paid-plan:'+paidProductionHash({scope,key:r.key,attempt:0}),provider:route.provider,model:route.model,accountRef:route.accountRef,stage:r.stage,shotId:'S04',inputContractHash:paidProductionHash({requirement:r,route,attempt:0}),maximumUnits:route.maximumUnits};});
  const claims=new Map<string,unknown>();let supplierCalls=0;let recoveries=0;
  f.context.paidContext={scope,requirements,routeBindings:routes,intents,readReservedCny:id=>{assert.ok(intents.some(i=>i.operationId===id));return .2;},assertRecovery:async id=>{assert.ok(claims.has(id));recoveries++;},permit:{beforeSubmit:async body=>{assert.equal(claims.has(body.operationId),false);claims.set(body.operationId,body);return {operationId:body.operationId,fingerprint:'fixture-preallocated'};},markOutcome:async id=>{assert.ok(claims.has(id));},assertRecovery:async()=>{throw Error('unused');}},assertProviderBinding:async route=>{assert.equal(route.accountRef,'fixture-provider-account');},measureInputTokens:async()=>100};
  f.context.prepareFrame=(async(args,ports)=>{supplierCalls++;const fp=firstFrameInputFingerprint(args.request,'seedream',models.first_frame);await ports.reserveQa(fp);await ports.reserve(fp);await args.beforeFrameSubmit!({model:models.first_frame,image:args.request.references.map(r=>'data:image/png;base64,'+r.bytes.toString('base64')),prompt:args.request.prompt});await args.beforeQaSubmit!({model:models.first_frame_qa,enable_thinking:false,max_tokens:4096,messages:[{content:[{type:'image_url'},{type:'image_url'}]}]});fs.mkdirSync(args.root,{recursive:true});const filePath=path.join(args.root,fp+'.png');fs.writeFileSync(filePath,f.product);fs.writeFileSync(path.join(args.root,fp+'.json'),JSON.stringify({fingerprint:fp,state:'evaluated',tenantId:'tenant',projectId:'task',shotId:'S04',model:models.first_frame,qaModel:models.first_frame_qa,providerRequestId:'controlled-frame',outputSha256:sha(f.product),canProceedToVideo:true}));return {filePath,providerRequestId:'controlled-frame',model:models.first_frame,qaModel:models.first_frame_qa,canProceedToVideo:true};}) as typeof f.context.prepareFrame;
  f.context.generateVideo=async args=>{supplierCalls++;await args.beforeSubmit!({model:models.video,duration:4,resolution:'720p',generate_audio:false,content:[{role:'first_frame',type:'image_url',image_url:{url:args.firstFrameDataUrl}}]});return {bytes:f.video,providerId:'seedance',providerTaskId:'controlled-video',model:models.video,duration:4,estimatedCostCny:.2};};
  f.context.inspectVisual=async args=>{supplierCalls++;await args.paidSubmission!({model:models.video_qa,enable_thinking:false,max_tokens:4096,messages:[{content:[...(args.productReferences||[]),...(args.environmentReferences||[]),...args.frames].map(()=>({type:'image_url'}))}]});args.onReceipt?.({id:'controlled-QA'});return ['product_identity','environment_fidelity','layout_continuity','contact_continuity','action_order','end_state','visual_integrity'].map(key=>({key,verdict:'pass',note:'controlled fixture',evidenceFrames:args.frames.map(r=>r.timeLabel)}));};
  const priorEnabled=process.env.SEEDANCE_VIDEO_ENABLED;process.env.SEEDANCE_VIDEO_ENABLED='true';
  try{const factory=createEnvironmentSeedanceProductScenePorts({replacementEnvironment:f.context});const first=await factory.execute(input);assert.equal(first.status,'completed');assert.equal(claims.size,4);assert.equal(fs.existsSync(f.context.budgetRoot!),false,'no legacy MVP pool or fresh quote was created');fs.rmSync(input.outputDirectory,{recursive:true,force:true});fs.mkdirSync(input.outputDirectory);const again=await factory.execute(input);assert.equal(again.status,'completed');assert.equal(supplierCalls,3);assert.equal(claims.size,4);assert.equal(recoveries,4);}finally{if(priorEnabled===undefined)delete process.env.SEEDANCE_VIDEO_ENABLED;else process.env.SEEDANCE_VIDEO_ENABLED=priorEnabled;}
});
test('normal frozen Wan environment uses same task budget, exact three-second request and same-task GET/media recovery',async()=>{
 const f=await fixture(false),{paidProductionHash}=await import('./socialContentPaidOperationPlan.js');const routing={...f.input.materialRouting,generation:{...f.input.materialRouting.generation,method:'enterprise_authored_product_first_frame_i2v' as const,firstFrameOrigin:'enterprise_authored_storyboard' as const,videoProvider:'wan' as const,videoModel:'wan2.6-i2v-flash' as const}};
 Object.assign(f.task.replication_script.shots[0]!.materialPlan,{materialRouting:routing});const input={...f.input,materialRouting:routing},scope={tenantId:'tenant',taskId:'task',runId:'run',planHash:'a'.repeat(64)},requirement={key:'scene:S04:video',stage:'video',shotId:'S04',sourceRef:null,durationSeconds:3,text:null,frameCount:null,inputContractHash:'b'.repeat(64)},route={provider:'wan',model:'wan2.6-i2v-flash',accountRef:'fixture-account',routeEvidenceRef:'same-SDK-actual-account',usageBoundRef:'official-duration',maximumAttempts:1,maximumUnits:{providerSeconds:3}},intent={operationId:'paid-plan:'+paidProductionHash({scope,key:requirement.key,attempt:0}),provider:route.provider,model:route.model,accountRef:route.accountRef,stage:'video',shotId:'S04',inputContractHash:paidProductionHash({requirement,route,attempt:0}),maximumUnits:route.maximumUnits};let posts=0,claims=0,recoveries=0;
 f.context.paidContext={scope,requirements:[requirement],routeBindings:{[requirement.key]:route},intents:[intent],readReservedCny:()=>.45,assertRecovery:async()=>{recoveries++;assert.equal(claims,1);},permit:{beforeSubmit:async request=>{claims++;assert.deepEqual(request.actualUnits,{providerSeconds:3});return{operationId:request.operationId,fingerprint:'frozen'};},markOutcome:async()=>{},assertRecovery:async()=>{throw Error('unused');}},assertProviderBinding:async()=>{},measureInputTokens:async()=>{throw Error('video-not-token-billed');}};
 f.context.wanCredentials=()=>({apiKey:'controlled-key',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',credentialSha256:sha('controlled-key')});
 f.context.wanTransport=(async(url,init)=>{if(init?.method==='POST'){posts++;const body=JSON.parse(String(init.body));assert.equal(body.parameters.duration,3);assert.equal(body.parameters.audio,false);assert.equal(body.input.img_url,'data:image/png;base64,'+f.product.toString('base64'));return Response.json({output:{task_id:'actual-controlled-wan'}});}if(String(url).includes('/tasks/'))return Response.json({output:{task_id:'actual-controlled-wan',task_status:'SUCCEEDED',video_url:'https://provider.test/output'},usage:{video_duration:3}});return new Response(f.video);}) as typeof fetch;
 try{const bounds=await readProductReplacementRequestBounds(input,f.context);assert.equal(bounds.providerDurationSeconds,3);assert.equal(bounds.videoProvider,'wan');const ports=await createEnvironmentProductReplacementPorts(input,f.context),request={requestId:'current-task-wan',firstFrame:f.product,prompt:'Preserve verified packaging',providerDurationSeconds:3,checkpointPath:'never-use-ephemeral-file'};const generated=await ports.video(request);assert.equal(generated.model,'wan2.6-i2v-flash');assert.equal(generated.estimatedCostCny,.45);assert.equal(sha(generated.bytes),sha(f.video));await ports.video(request);assert.equal(posts,1);assert.equal(claims,1);assert.equal(recoveries,1);assert.equal(fs.existsSync(f.context.budgetRoot!),false);}finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
