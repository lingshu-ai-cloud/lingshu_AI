import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {store} from '../storage/index.js';
import {objectStorageDownload} from '../storage/objectStorage.js';
import {readMaterialLibrary} from '../lib/materialLibrary.js';
import {prepareTrustedStoryboardSeedream} from '../lib/storyboardSeedreamPreparation.js';
import {firstFrameInputFingerprint, type FirstFrameReference} from '../lib/firstFrameGenerator.js';
import {generateSeedanceConceptVideo} from '../lib/generativeVideoGateway.js';
import {withPaidOperationLock} from '../lib/paidOperationLock.js';
import {MvpBudgetAdmission, type MvpBudgetRecord} from '../lib/mvpBudgetAdmission.js';
import {SocialContentTaskBudget} from '../lib/socialContentTaskBudget.js';
import {runVisualFfmpeg} from '../lib/renderVisualQuality.js';
import {inspectStoryboardAigcFramesWithQwen} from '../agents/qwen.js';
import {applyStoryboardReplicationAutomation, buildStoryboardQaReport, inspectStoryboardTechnicalFrames} from '../lib/storyboardAigcQuality.js';
import {createStarter198Repository} from './repository.js';
import {findSocialContentFile, readSocialContentFile, MAX_SOCIAL_CONTENT_FILE_BYTES, type SocialContentBackendFilePort} from './socialContentFiles.js';
import {socialRequestHash} from './socialContentValidation.js';
import type {ProductReplacementPorts} from './socialContentProductReplacementExecution.js';
import type {ProductSceneExecutionPorts} from './socialContentProductSceneAdapter.js';

type Input = Parameters<ProductSceneExecutionPorts['execute']>[0];
type Row = Record<string, any>;
const json = (x: unknown): any => typeof x === 'string' ? JSON.parse(x) : x;
const sha = (x: Buffer | string) => createHash('sha256').update(x).digest('hex');
/** Exact inputs for server quotes; provider duration, not trimmed duration, is billed. */
export function productReplacementOperationFingerprint(kind: string, value: unknown) {
  return sha(JSON.stringify({schema: 'product-replacement-operation.v1', kind, value}));
}
export interface ProductReplacementEnvironmentContext {
  dataStore?: Pick<typeof store, 'getById' | 'list'>;
  materials?: typeof readMaterialLibrary;
  download?: typeof objectStorageDownload;
  budgetRoot?: string;
  /** Private server evidence cache; never a worker render workspace. */
  durableRoot?: string;
  backendFilePort?: SocialContentBackendFilePort;
  readRegisteredFile?: (input: {tenantId: string; fileId: string; expectedSha256: string}) => Promise<Buffer>;
  /** Trusted server callback, never populated from an HTTP body. */
  assertCurrent?: () => Promise<void>;
  prepareFrame?: typeof prepareTrustedStoryboardSeedream;
  generateVideo?: typeof generateSeedanceConceptVideo;
  inspectVisual?: typeof inspectStoryboardAigcFramesWithQwen;
}

/** Default readers use canonical task, immutable handoffs, registered KB bytes and
 * provisioned budget pools. Missing rights/quotes are gaps, never implicit grants. */
export async function createEnvironmentProductReplacementPorts(input: Input, context: ProductReplacementEnvironmentContext = {}): Promise<ProductReplacementPorts> {
  const db = context.dataStore || store;
  const taskRows = await db.list<Row>('starter_social_content_tasks', {where: {tenant_id: input.tenantId, task_id: input.taskId}, perPage: 2});
  const tasks = taskRows.items.filter(row => row.tenant_id === input.tenantId && row.task_id === input.taskId);
  if (tasks.length !== 1 || taskRows.totalItems > taskRows.items.length) throw Error('product_replacement_canonical_task_missing_or_ambiguous');
  const task = tasks[0]!;
  const script = task && json(task.replication_script);
  const shot = script?.shots?.find((s: Row) => s.shotId === input.shotId);
  if (!task || task.tenant_id !== input.tenantId || !task.run_id || !shot
    || !shot.materialPlan?.materialRouting || !shot.materialPlan?.productSceneReplication
    || socialRequestHash(shot.materialPlan?.materialRouting) !== socialRequestHash(input.materialRouting)
    || socialRequestHash(shot.materialPlan?.productSceneReplication) !== socialRequestHash(input.spec)) throw Error('product_replacement_current_frozen_shot_missing');
  const brief = json(task.brief);
  const productId = brief?.productId;
  const accountId = brief?.targetAccountRef?.id ?? null;
  if (typeof productId !== 'string' || !productId) throw Error('product_replacement_canonical_product_identity_missing');
  let usageAuthority: {id: string; hash: string} | null = null;
  const taskIdentity = socialRequestHash({version: task.version, run: task.run_id, script: task.replication_script, brief: task.brief});
  const assertCurrent = async () => {
    await context.assertCurrent?.();
    const live = await db.getById<Row>('starter_social_content_tasks', task.id);
    if (!live || live.tenant_id !== input.tenantId || socialRequestHash({version: live.version, run: live.run_id, script: live.replication_script, brief: live.brief}) !== taskIdentity) throw Error('product_replacement_task_changed');
    if (usageAuthority) {
      const row = await db.getById<Row>('starter_social_inspiration_handoff_versions', usageAuthority.id);
      const h = row && json(row.payload);
      if (!row || row.tenant_id !== input.tenantId || row.record_hash !== usageAuthority.hash || socialRequestHash(h) !== usageAuthority.hash
        || h.rights?.mayUseOriginalMedia !== true || h.rights?.mayAdapt !== true) throw Error('product_reference_pixels_usage_changed');
    }
  };
  const budgetRoot = context.budgetRoot || path.resolve(process.env.MVP_BUDGET_POOL_DIR || 'data/mvp-budget-pools');
  const repository = createStarter198Repository(db as typeof store);
  const admission = new MvpBudgetAdmission(budgetRoot);
  const durableDirectory = path.join(context.durableRoot || path.resolve('data/social-product-replacement-executions'),
    sha(input.tenantId), sha(input.taskId), sha(String(task.run_id)), sha(input.shotId), sha(input.idempotencyKey));
  const quote = (fingerprint: string, provider: string, model: string) => {
    const candidates: Array<{record: MvpBudgetRecord; scope: MvpBudgetRecord['authorizations'][number]; amount: number}> = [];
    for (const name of fs.existsSync(budgetRoot) ? fs.readdirSync(budgetRoot).filter(n => /^[a-f0-9]{64}\.json$/.test(n)) : []) {
      const record = JSON.parse(fs.readFileSync(path.join(budgetRoot, name), 'utf8')) as MvpBudgetRecord;
      if (record.tenantId !== input.tenantId || record.taskId !== input.taskId) continue;
      const q = record.pricing?.operationQuotes?.[fingerprint];
      if (!q || q.provider !== provider || q.model !== model || !Number.isFinite(q.upperBoundCny) || q.upperBoundCny < 0) continue;
      for (const scope of record.authorizations || []) if (scope.version === Number(task.version) && scope.runId === task.run_id && scope.provider === provider && scope.model === model && scope.shotIds.includes(input.shotId)
        && scope.accountId === (accountId) && scope.productId === productId) candidates.push({record, scope, amount: q.upperBoundCny});
    }
    if (candidates.length !== 1) throw Error('product_replacement_exact_server_budget_quote_missing_or_ambiguous');
    return candidates[0]!;
  };
  const taskBudgetScope = {tenantId: input.tenantId, taskId: input.taskId, runId: String(task.run_id), planHash: taskIdentity};
  const taskBudget = new SocialContentTaskBudget(path.join(path.dirname(budgetRoot), 'social-content-task-budget'), {
    assertCurrent: async () => assertCurrent(),
    authorization: async () => {
      const limit = Number(brief.perItemBudgetCny);
      if (!Number.isFinite(limit) || limit <= 0) throw Error('product_whole_film_budget_missing');
      return {maximumCny: Math.min(10, limit), authorizationRef: 'canonical-task-budget:' + taskIdentity};
    },
    quote: async (_scope, op) => {
      const q = quote(op.fingerprint, op.provider, op.model);
      return {upperBoundCny: q.amount, quoteRef: q.record.pricing.evidenceRef + ':' + op.fingerprint, validUntil: q.record.pricing.validUntil};
    },
    verifyRejection: async () => false, // Unknown/failed generation does not refund this chain's upper bound.
  });
  const reserve = async (fingerprint: string, provider: string, model: string, operation: string) => {
    await assertCurrent();
    const q = quote(fingerprint, provider, model);
    if (q.amount > input.maximumCostCny) throw Error('product_replacement_quote_exceeds_shot_budget');
    // Refuse to create a fresh whole-film ledger over unreconciled historical spending.
    if (!taskBudget.status(taskBudgetScope)) {
      for (const name of fs.existsSync(budgetRoot) ? fs.readdirSync(budgetRoot).filter(n => /^[a-f0-9]{64}\.json$/.test(n)) : []) {
        const existing = JSON.parse(fs.readFileSync(path.join(budgetRoot, name), 'utf8')) as MvpBudgetRecord;
        if (existing.tenantId === input.tenantId && existing.taskId === input.taskId && Object.keys(existing.entries || {}).length)
          throw Error('product_whole_film_historical_budget_reconciliation_required');
      }
    }
    await taskBudget.reserveBatch(taskBudgetScope, [{operationId: `product-replacement:${sha(input.idempotencyKey + ':' + operation)}`,
      fingerprint, provider, model, accountRef: accountId || 'unbound', stage: operation, shotId: input.shotId}]);
    await admission.reserve({scope: q.scope, tenantId: input.tenantId, taskId: input.taskId, version: Number(task.version), runId: task.run_id,
      session: q.scope.session, accountId: accountId, productId: productId, action: 'generate_media', provider, model, shotId: input.shotId,
      estimatedCostCny: q.amount, operationId: `product-replacement:${sha(input.idempotencyKey + ':' + operation)}`, fingerprint});
    return q.amount;
  };
  const readBytes = async (record: Row): Promise<Buffer> => {
    // Only canonical registered object keys; arbitrary caller URLs/paths are not read.
    const key = String(record.objectKey || record.videoFileId || '').trim();
    const expected = String(record.contentSha256 || record.contentHash || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected)) throw Error('product_replacement_registered_bytes_missing');
    let bytes: Buffer | undefined;
    if (key) bytes = (await (context.download || objectStorageDownload)(key))?.buf;
    else if (typeof record.url === 'string' && /^\/api\/overseas\/starter-198\/social-content\/files\/[A-Za-z0-9_-]{1,180}$/.test(record.url)) {
      const fileId = record.url.slice(record.url.lastIndexOf('/') + 1);
      if (context.readRegisteredFile) bytes = await context.readRegisteredFile({tenantId: input.tenantId, fileId, expectedSha256: expected});
      else {
        const registered = await findSocialContentFile({repository, tenantId: input.tenantId, fileId});
        if (!registered || registered.tenant_id !== input.tenantId || registered.content_sha256 !== expected
          || registered.usage !== 'source' || !String(registered.mime_type).startsWith('image/')) throw Error('product_replacement_registered_task_file_invalid');
        const result = await readSocialContentFile({repository, tenantId: input.tenantId, fileId, backendFilePort: context.backendFilePort});
        if (result.view.sha256 !== expected || result.view.size > MAX_SOCIAL_CONTENT_FILE_BYTES) throw Error('product_replacement_registered_task_file_invalid');
        if (result.backend) bytes = result.backend.buf;
        else if (result.localPath) bytes = fs.readFileSync(result.localPath);
        else if (result.object) {
          const chunks: Buffer[] = []; let size = 0;
          for await (const chunk of result.object.body) {size += chunk.length; if (size > result.view.size) throw Error('product_replacement_registered_task_file_size_changed'); chunks.push(Buffer.from(chunk));}
          bytes = Buffer.concat(chunks);
        }
        if (bytes?.length !== result.view.size) throw Error('product_replacement_registered_task_file_size_changed');
      }
    } else {
      const mediaRoot = path.resolve('data/media');
      const candidate = record.localPath || (typeof record.url === 'string' && record.url.startsWith('/media/') ? path.resolve('data', record.url.slice(1)) : null);
      if (typeof candidate === 'string' && fs.existsSync(candidate)) {
        const actual = fs.realpathSync(candidate);
        if (actual.startsWith(fs.realpathSync(mediaRoot) + path.sep)) bytes = fs.readFileSync(actual);
      }
    }
    if (!bytes?.length || sha(bytes) !== expected) throw Error('product_replacement_registered_bytes_changed');
    return bytes;
  };
  const imageReference = (bytes: Buffer, role: FirstFrameReference['role']): FirstFrameReference => ({bytes, role, sha256: sha(bytes), mimeType: bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : bytes.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : 'image/png'});
  let firstFrameEstimate = 0;
  const frameModel = process.env.SEEDREAM_IMAGE_MODEL || 'doubao-seedream-5-0-pro-260628';
  const videoModel = process.env.SEEDANCE_MODEL || 'doubao-seedance-2-0-fast-260128';
  const qaModel = process.env.QWEN_VL_MODEL || 'qwen3-vl-plus';
  return {
    evidenceDirectory: durableDirectory,
    estimatedCostCny: () => +(taskBudget.status(taskBudgetScope)?.entries.filter(e => e.shotId === input.shotId && e.status !== 'rejected').reduce((total, e) => total + e.reservedMicros, 0) || 0) / 1e6,
    assertCurrent,
    composition: async () => {
      await assertCurrent();
      const sourceId = input.materialRouting!.generation!.referenceSourceId!.replace(/^system-reference:/, '');
      const source = await db.getById<Row>('trend_videos', sourceId);
      if (!source || (source.tenantId || source.tenant_id) !== input.tenantId) throw Error('product_reference_same_tenant_source_missing');
      const sourceUrl = source.sourceUrl || source.videoUrl || source.url;
      if (typeof sourceUrl !== 'string' || !sourceUrl) throw Error('product_reference_canonical_source_url_missing');
      const rows = await db.list<Row>('starter_social_inspiration_handoff_versions', {where: {tenant_id: input.tenantId}, perPage: 500});
      if (rows.totalItems > rows.items.length) throw Error('product_reference_usage_lookup_incomplete');
      const matches = rows.items.filter(r => {
        const h = json(r.payload);
        return r.tenant_id === input.tenantId && h?.source?.sourceUrl === sourceUrl && h.taskContext?.taskId === input.taskId
          && h.rights?.mayUseOriginalMedia === true && h.rights?.mayAdapt === true && socialRequestHash(h) === r.record_hash;
      });
      if (matches.length !== 1) throw Error('product_reference_pixels_usage_missing_or_ambiguous');
      usageAuthority = {id: matches[0]!.id, hash: matches[0]!.record_hash};
      const bytes = await readBytes(source);
      fs.mkdirSync(input.outputDirectory, {recursive: true, mode: 0o700});
      const sourceFile = path.join(input.outputDirectory, `source-${sha(bytes)}.mp4`);
      const image = path.join(input.outputDirectory, `composition-${sha(bytes)}-${input.shotId}.png`);
      fs.writeFileSync(sourceFile, bytes, {mode: 0o600});
      const extracted = await runVisualFfmpeg(['-ss', String(input.spec.referenceStartSeconds || 0), '-i', sourceFile, '-frames:v', '1', '-y', image], false, {timeoutMs: 120000});
      if (!extracted.ok || !fs.existsSync(image)) throw Error('product_reference_actual_frame_extraction_failed');
      return {reference: imageReference(fs.readFileSync(image), 'source_composition'), usageEvidenceRef: `${matches[0]!.id}:${matches[0]!.record_hash}`};
    },
    products: async () => {
      await assertCurrent();
      const library = await (context.materials || readMaterialLibrary)(input.tenantId);
      const refs = input.materialRouting!.generation!.productImageRefs;
      if (refs.length < 1 || refs.length > 2) throw Error('product_replacement_bounded_QA_product_reference_count_unsupported');
      return Promise.all(refs.map(async id => {
        const record = library.items.find(r => {
          const groups = input.spec.productIdentity.groups.filter(g => g.referenceImageIds.includes(id));
          const refs = [r.productRef, ...(Array.isArray(r.productRefs) ? r.productRefs : [])].filter(v => typeof v === 'string');
          const associationMatches = r.productId ? r.productId === productId : groups.length > 0 && groups.some(g => refs.includes(g.productRef));
          return r.id === id && (r.tenantId || r.tenant_id) === input.tenantId && r.type === 'image' && r.scope !== 'shared' && groups.length > 0 && associationMatches;
        });
        if (!record || !input.referenceImages.some(r => r.assetId === id && r.contentHash === (record.contentSha256 || record.contentHash))) throw Error('product_KB_same_tenant_packaging_missing');
        return imageReference(await readBytes(record), 'product_identity');
      }));
    },
    firstFrame: async request => {
      await assertCurrent();
      if (!context.prepareFrame && !(process.env.SEEDREAM_API_KEY || process.env.SEEDANCE_API_KEY)) throw Error('product_replacement_seedream_not_configured');
      const fingerprint = firstFrameInputFingerprint(request, 'seedream', frameModel);
      const q = quote(fingerprint, 'seedream', frameModel);
      firstFrameEstimate = q.amount;
      const result = await (context.prepareFrame || prepareTrustedStoryboardSeedream)({request, model: frameModel, estimatedCostCny: q.amount, root: path.join(durableDirectory, 'first-frame-receipts'), productInfo: JSON.stringify(input.spec.productIdentity), execute: true, qaModel}, {
        assertCurrent, reserve: fp => reserve(fp, 'seedream', frameModel, 'first-frame').then(() => undefined),
        reserveQa: fp => reserve(productReplacementOperationFingerprint('first-frame-qa', {fingerprint: fp, qaModel}), 'qwen', qaModel, 'first-frame-qa').then(() => undefined),
      });
      if ('dryRun' in result) throw Error('product_first_frame_unexpected_dryrun');
      if (result.qaModel !== qaModel) throw Error('product_first_frame_QA_model_binding_changed');
      return {bytes: fs.readFileSync(result.filePath), providerRequestId: result.providerRequestId, model: result.model, estimatedCostCny: q.amount,
        canProceedToVideo: result.canProceedToVideo, evidenceRefs: [path.join(durableDirectory, 'first-frame-receipts', `${fingerprint}.json`)]};
    },
    video: async request => {
      await assertCurrent();
      const fingerprint = productReplacementOperationFingerprint('video', {...request, firstFrame: sha(request.firstFrame), checkpointPath: undefined, model: videoModel});
      const q = quote(fingerprint, 'seedance', videoModel);
      if (q.amount + firstFrameEstimate > input.maximumCostCny) throw Error('product_replacement_total_quote_exceeds_shot_budget');
      if (process.env.SEEDANCE_VIDEO_ENABLED !== 'true') throw Error('seedance_not_enabled');
      if (!context.generateVideo && !process.env.SEEDANCE_API_KEY) throw Error('product_replacement_seedance_not_configured');
      return withPaidOperationLock(path.join(durableDirectory, '.video-locks'), fingerprint, async () => {
      const checkpointPath = path.join(durableDirectory, 'video', `${fingerprint}.json`);
      const attempt = `${checkpointPath}.attempt.json`, media = `${checkpointPath}.completed.mp4`;
      const prior = fs.existsSync(attempt) ? JSON.parse(fs.readFileSync(attempt, 'utf8')) : null;
      if (prior && prior.fingerprint !== fingerprint) throw Error('product_video_attempt_changed');
      if (prior?.state === 'completed') {
        const bytes = fs.readFileSync(media);
        if (sha(bytes) !== prior.sha256) throw Error('product_video_completed_bytes_changed');
        return {bytes, providerTaskId: prior.providerTaskId, model: videoModel, estimatedCostCny: prior.estimatedCostCny};
      }
      if (prior) {
        const checkpoint = fs.existsSync(checkpointPath) ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) : null;
        if (!checkpoint?.taskId || !checkpoint.reservationId || !Number.isFinite(checkpoint.reservedCny)) throw Error('product_video_submission_unknown_requires_original_receipt');
      } else if (fs.existsSync(checkpointPath)) throw Error('product_video_checkpoint_without_attempt_identity');
      const amount = await reserve(fingerprint, 'seedance', videoModel, request.requestId);
      await assertCurrent();
      fs.mkdirSync(path.dirname(attempt), {recursive: true, mode: 0o700});
      fs.writeFileSync(attempt, JSON.stringify({fingerprint, state: 'prepared'}), {mode: 0o600});
      const result = await (context.generateVideo || generateSeedanceConceptVideo)({tenantId: input.tenantId, apiKey: process.env.SEEDANCE_API_KEY || '', model: videoModel,
        prompt: request.prompt, durationSeconds: request.providerDurationSeconds, ratio: '9:16', resolution: '720p', idempotencyKey: request.requestId,
        timeoutMs: 900000, checkpointPath, firstFrameDataUrl: `data:image/png;base64,${request.firstFrame.toString('base64')}`});
      fs.writeFileSync(media, result.bytes, {mode: 0o600});
      fs.writeFileSync(attempt, JSON.stringify({fingerprint, state: 'completed', providerTaskId: result.providerTaskId, sha256: sha(result.bytes), estimatedCostCny: amount}), {mode: 0o600});
      return {...result, estimatedCostCny: amount};
      });
    },
    quality: async request => {
      const mediaSha256 = sha(fs.readFileSync(request.filePath));
      const fingerprint = productReplacementOperationFingerprint('video-qa', {mediaSha256, qaModel, directorScene: request.directorScene, products: request.productReferences.map(r => r.sha256)});
      await reserve(fingerprint, 'qwen', qaModel, 'video-qa');
      const receipt = path.join(durableDirectory, 'video-qa', `${fingerprint}.json`);
      fs.mkdirSync(path.dirname(receipt), {recursive: true, mode: 0o700});
      if (fs.existsSync(receipt)) { const prior = JSON.parse(fs.readFileSync(receipt, 'utf8')); if (prior.fingerprint !== fingerprint || !prior.quality) throw Error('product_video_qa_unknown'); return prior.quality; }
      const frames: Array<{bytes: Buffer; timeLabel: string}> = [];
      const sampleTimes = request.productReferences.length === 1 ? [0.1, request.durationSeconds / 2, request.durationSeconds - 0.1] : [0.1, request.durationSeconds - 0.1];
      for (const [index, second] of sampleTimes.entries()) {
        const image = `${request.filePath}.${index}.png`;
        const extraction = await runVisualFfmpeg(['-ss', String(second), '-i', request.filePath, '-frames:v', '1', '-y', image], false, {timeoutMs: 120000});
        if (!extraction.ok) throw Error('product_video_qa_frame_extraction_failed');
        frames.push({bytes: fs.readFileSync(image), timeLabel: `actual-video-${index}`});
      }
      await assertCurrent();
      fs.writeFileSync(receipt, JSON.stringify({fingerprint, state: 'prepared', mediaSha256}), {mode: 0o600});
      const visual = await (context.inspectVisual || inspectStoryboardAigcFramesWithQwen)({model: qaModel, boundedPaidQa: true, phase: 'video', sceneType: 'product',
        frames: frames.map(f => ({base64: f.bytes.toString('base64'), mimeType: 'image/png', timeLabel: f.timeLabel})),
        productReferences: request.productReferences.map((p, i) => ({base64: p.bytes.toString('base64'), mimeType: p.mimeType, timeLabel: `KB-package-${i}`})),
        environmentReferences: [{base64: request.firstFrame.toString('base64'), mimeType: 'image/png', timeLabel: 'approved-first-frame'}],
        storyboard: request.directorScene, productInfo: JSON.stringify(input.spec.productIdentity), onReceipt: raw => fs.writeFileSync(`${receipt}.provider.json`, JSON.stringify(raw), {mode: 0o600})});
      const technical = await inspectStoryboardTechnicalFrames('video', frames);
      const report = applyStoryboardReplicationAutomation(buildStoryboardQaReport({phase: 'video', sceneType: 'product', hasProduct: true, hasNamedPerson: false,
        hasEnvironmentReference: true, hasContact: true, hasAction: true, observations: [...technical, ...visual], evidenceFrameLabels: frames.map(f => f.timeLabel)}));
      const pass = report.automatedPassed ? 1 : 0;
      const quality = {productIdentitySimilarity: Object.fromEntries(input.spec.productIdentity.groups.map(g => [g.productRef, pass])), labelOcrExactMatch: pass === 1,
        sceneTopologyScore: pass, productSlotLayoutScore: pass, cameraTrajectoryScore: pass, evidenceRefs: [receipt, `${receipt}.provider.json`]};
      fs.writeFileSync(receipt, JSON.stringify({fingerprint, state: 'completed', mediaSha256, report, quality, humanApproved: false}), {mode: 0o600});
      return quality;
    },
  };
}
