import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { DataStore } from '../storage/datastore.js';
import { readSocialImageTask, updateSocialImageTask } from '../socialImage/socialImageTask.js';
import { mergeSocialImageVisualChecks, socialImageCandidateOcrCheck, socialImageCandidatePixelChecks, socialImageGifAnimationCheck, socialImageDeterministicChecks } from '../socialImage/socialImageQuality.js';
import { readTenantMaterialBytes } from '../lib/sentenceReplicationProduction.js';
import { readMaterialLibrary } from '../lib/materialLibrary.js';
import { SOCIAL_IMAGE_HARD_CHECKS, type SocialImageCreationTask, type SocialImageQualityCheck } from '../../shared/contracts/socialImageCreation.js';
import { assertSocialImageLayerGraph } from '../socialImage/layerGraphValidation.js';
import { renderSocialImageLayerGraph } from '../socialImage/layerRenderer.js';
import { enterpriseAssetTenantKey } from '../storage/enterpriseAssets.js';
import { recordSocialImageBusinessContext, recordSocialImageNodeOutput, SocialImageProductionRunError } from '../socialImage/socialImageProductionRun.js';
import { projectSocialImageProductionSnapshot } from '../socialImage/socialImageProductionRuntime.js';
import { analyzeSocialImageReference, inspectSocialImageAsset, socialImageAssetAuthorization, socialImageAssetManifest } from '../socialImage/socialImageEvidenceWorker.js';
import { readSocialImageReferenceBytes } from '../socialImage/socialImageReferenceBytes.js';
import { inspectSocialImageCandidateFactors, prepareSocialImageReferenceStrategy, socialImageFrozenGraphMatches, socialImageFrozenSourceIssue } from '../socialImage/socialImageReferenceStrategy.js';
import { localProductOcrReadiness, recognizeProductImageLocally, recognizeProductImageTokensLocally } from '../lib/localProductOcr.js';
import { runSocialImageVisualPreflight } from '../socialImage/socialImageQualityPreflight.js';
import { continueSocialImageProduction } from '../socialImage/socialImageProductionContinuation.js';
export class ImageQuotaResponseHandled extends Error {
}
export class ImageWorkflowError extends Error {
    constructor(status: number, readonly body: {
        code?: string;
        error?: string;
        [key: string]: unknown;
    }) { super(body.error || body.code || 'social_image_command_failed'); this.status=status; this.code=body.code || 'social_image_command_failed'; }
    readonly status:number;
    readonly code:string;
}
export const imageCommandFailure = (status: number, body: ImageWorkflowError['body']) => new ImageWorkflowError(status, body);
export interface ImageWorkflowInput {
    store: DataStore;
    tenantId: string;
    taskId: string;
    expectedVersion: number;
    enterpriseProductAsset: (tenantId: string, id: string) => Promise<{
        name: string;
        bytes: Buffer;
    } | null>;
    outputImageBytes: (tenantId: string, output: {
        mediaUrl?: string;
        materialId?: string;
    }) => Promise<{
        bytes: Buffer;
        mimeType: string;
    } | null>;
    allowPaidCall: () => Promise<boolean>;
}
export const imageRenderRoot = (tenantId: string) => path.resolve(process.cwd(), 'data', 'social-image-renders', enterpriseAssetTenantKey(tenantId));
export async function prepareImageEvidence(input: ImageWorkflowInput) {
    const { store, tenantId, taskId, expectedVersion, enterpriseProductAsset, outputImageBytes, allowPaidCall } = input;
    const foundTask = await readSocialImageTask(store, tenantId, taskId);
    if (!foundTask) {
        throw imageCommandFailure(404, { ok: false, code: 'social_image_task_missing', error: '图片任务不存在' });
    }
    let task: SocialImageCreationTask = foundTask;
    if (expectedVersion !== task.version) {
        throw imageCommandFailure(409, { ok: false, code: 'social_image_version_conflict', error: '任务已被更新，请刷新后继续', task });
    }
    if (task.schemaVersion !== 'social-image-creation.v3' || !task.productionRuntime?.binding) {
        throw imageCommandFailure(409, { ok: false, code: 'social_image_content_task_binding_missing', error: '历史图片项目不自动升级生产运行' });
    }
    task = await recordSocialImageBusinessContext({ store, tenantId, taskId: task.id, expectedVersion: task.version });
    const library = await readMaterialLibrary(tenantId);
    const ocrReadiness = localProductOcrReadiness();
    const ocr = ocrReadiness.ready ? recognizeProductImageTokensLocally : undefined;
    const inspected = [] as Awaited<ReturnType<typeof inspectSocialImageAsset>>[];
    for (const asset of task.enterpriseAssets) {
        let loaded: {
            bytes: Buffer;
            mimeType: string;
        } | null = null;
        let authorityRecord: Record<string, unknown> | null = null;
        if (asset.role === 'product' && asset.source === 'enterprise_knowledge_base') {
            const product = await enterpriseProductAsset(tenantId, asset.assetId);
            if (product) {
                const format = (await sharp(product.bytes).metadata().catch(() => ({ format: undefined }))).format;
                loaded = { bytes: product.bytes, mimeType: format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg' };
                const contentHash = createHash('sha256').update(product.bytes).digest('hex');
                authorityRecord = library.items.find(item => item.type === 'image' && item.sourceType === 'enterprise_product_table'
                    && String(item.productId || '') === asset.assetId && String(item.contentSha256 || '') === contentHash) || null;
            }
        }
        else {
            const material = library.items.find(item => item.id === asset.assetId && item.type === 'image');
            if (material) {
                authorityRecord = material;
                loaded = await readTenantMaterialBytes(material as any, tenantId).catch(() => null);
            }
        }
        inspected.push(await inspectSocialImageAsset({ assetId: asset.assetId, role: asset.role, required: asset.required,
            bytes: loaded?.bytes || null, mimeType: loaded?.mimeType || 'application/octet-stream',
            expectedContentHash: asset.contentHash || String(authorityRecord?.contentSha256 || ''),
            authorization: socialImageAssetAuthorization(authorityRecord, tenantId), ocr }));
    }
    const manifest = socialImageAssetManifest({ assets: inspected, ocrAvailable: ocrReadiness.ready,
        prohibitedClaims: task.contentBrief.prohibitedClaims });
    const unreadable = manifest.assets.filter(asset => asset.required && !asset.readable).map(asset => asset.assetId);
    const unauthorized = manifest.assets.filter(asset => asset.required && asset.readable && asset.rights !== 'cleared').map(asset => asset.assetId);
    task = await recordSocialImageNodeOutput({ store, tenantId, taskId: task.id, expectedVersion: task.version,
        nodeId: 'asset_manifest', status: unreadable.length || unauthorized.length ? 'blocked' : 'completed', value: manifest, inputRefs: [],
        evidenceRefs: manifest.assets.filter(asset => asset.readable).map(asset => ({ objectType: 'enterprise-image-asset',
            id: asset.assetId, version: asset.version, contentHash: asset.contentHash })),
        createdBy: { kind: 'worker', id: 'social_image_asset_probe' },
        blockingReasons: [...unreadable.map(id => `social_image_required_asset_unreadable:${id}`),
            ...unauthorized.map(id => `social_image_required_asset_rights_unverified:${id}`)],
        warnings: ocrReadiness.ready ? [] : [ocrReadiness.code] });
    if (unreadable.length) {
        throw imageCommandFailure(422, { ok: false, code: 'social_image_required_asset_unreadable',
            error: `强制企业图片不可读取：${unreadable.join('、')}`, task, snapshot: projectSocialImageProductionSnapshot(task) });
    }
    if (unauthorized.length) {
        throw imageCommandFailure(422, { ok: false, code: 'social_image_required_asset_rights_unverified',
            error: `强制企业图片缺少可核验的商用与衍生授权：${unauthorized.join('、')}`, task,
            snapshot: projectSocialImageProductionSnapshot(task) });
    }
    if (task.creationPath === 'material_processing') {
        return { ok: true, task, snapshot: projectSocialImageProductionSnapshot(task), manifest };
    }
    const referenceUrl = task.referenceSnapshot?.imageUrls[0] || task.referenceUrls[0] || task.referenceSnapshot?.sourceUrl || '';
    const reference = referenceUrl ? await readSocialImageReferenceBytes(tenantId, referenceUrl) : null;
    let inventory: Awaited<ReturnType<typeof analyzeSocialImageReference>> | null = null;
    if (reference) {
        try {
            inventory = await analyzeSocialImageReference({ bytes: reference.bytes, mimeType: reference.mimeType,
                referenceId: task.referenceSnapshot?.sourceRecordId || task.id, ocr });
        }
        catch {
            inventory = null;
        }
    }
    const referenceReadable = Boolean(reference && inventory);
    const referenceHash = reference?.bytes.length ? createHash('sha256').update(reference.bytes).digest('hex')
        : createHash('sha256').update(referenceUrl || 'missing-reference').digest('hex');
    const imageAssetRef = { objectType: 'social-image-reference', id: task.referenceSnapshot?.sourceRecordId || task.id,
        version: 1, contentHash: referenceHash };
    const referenceValue = {
        referenceId: task.referenceSnapshot?.sourceRecordId || task.id, sourceUrl: referenceUrl || null,
        sourceRecordId: task.referenceSnapshot?.sourceRecordId || null, imageAssetRef,
        platform: task.referenceSnapshot?.platform || null, account: task.referenceSnapshot?.accountName || null,
        publishedAt: null, rightsPolicy: 'structure_only' as const, performanceEvidence: [], relativePerformance: null,
        referencePurpose: ['structure', 'visual_hook'] as Array<'structure' | 'visual_hook'>,
        fingerprint: task.referenceSnapshot?.fingerprint || referenceHash,
    };
    task = await recordSocialImageNodeOutput({ store, tenantId, taskId: task.id, expectedVersion: task.version,
        nodeId: 'reference_snapshot', status: referenceReadable ? 'completed' : 'blocked', value: referenceValue,
        inputRefs: [], evidenceRefs: referenceReadable ? [imageAssetRef] : [],
        createdBy: { kind: 'worker', id: 'social_image_reference_probe' },
        blockingReasons: referenceReadable ? [] : ['social_image_reference_bytes_unreadable'] });
    if (!referenceReadable || !inventory) {
        throw imageCommandFailure(422, { ok: false, code: 'social_image_reference_bytes_unreadable', error: '参考图不可读取，不能执行爆点拆解',
            task, snapshot: projectSocialImageProductionSnapshot(task) });
    }
    const snapshotEnvelope = task.productionRuntime!.nodeOutputs.filter(output => output.nodeId === 'reference_snapshot').at(-1)!;
    task = await recordSocialImageNodeOutput({ store, tenantId, taskId: task.id, expectedVersion: task.version,
        nodeId: 'element_inventory', status: 'completed', value: inventory,
        inputRefs: [{ objectType: snapshotEnvelope.schemaVersion, id: snapshotEnvelope.id,
                version: snapshotEnvelope.version, contentHash: snapshotEnvelope.contentHash }],
        evidenceRefs: inventory.regions.map(region => region.evidenceRef),
        createdBy: { kind: 'worker', id: 'social_image_reference_pixel_analyzer' },
        warnings: ocrReadiness.ready ? [] : [ocrReadiness.code] });
    task = await prepareSocialImageReferenceStrategy({ store, tenantId, taskId: task.id, expectedVersion: task.version });
    return { ok: true, task, snapshot: projectSocialImageProductionSnapshot(task), manifest, inventory };
}
export async function renderImageLayers(input: ImageWorkflowInput) {
    const { store, tenantId, taskId, expectedVersion, enterpriseProductAsset, outputImageBytes, allowPaidCall } = input;
    const task = await readSocialImageTask(store, tenantId, taskId);
    if (!task) {
        throw imageCommandFailure(404, { ok: false, error: '图片任务不存在' });
    }
    if (expectedVersion !== task.version) {
        throw imageCommandFailure(409, { ok: false, error: '任务已被更新，请刷新后继续', task });
    }
    if (!task.layerGraph) {
        throw imageCommandFailure(422, { ok: false, error: '任务尚未生成分层合同' });
    }
    if (task.schemaVersion === 'social-image-creation.v3' && task.creationPath === 'viral_replication'
        && !socialImageFrozenGraphMatches(task)) {
        throw imageCommandFailure(422, { ok: false, code: 'social_image_reference_plan_stale', error: '参考版式证据或冻结规格已失效，请重新规划' });
    }
    // Unresolved optional layers are omitted from the first draft instead of
    // stopping production. The user can add them later from unified review.
    const renderGraph = {
        ...task.layerGraph,
        layers: task.layerGraph.layers.filter(item => item.kind !== 'logo'),
    };
    assertSocialImageLayerGraph(renderGraph);
    const assets = new Map<string, Buffer>();
    for (const layer of renderGraph.layers.filter(item => item.kind === 'product')) {
        const product = layer.sourceAssetId ? await enterpriseProductAsset(tenantId, layer.sourceAssetId) : null;
        if (!product || !layer.sourceAssetId) {
            throw imageCommandFailure(422, { ok: false, error: `企业产品资产不可读取：${layer.id}` });
        }
        assets.set(layer.sourceAssetId, product.bytes);
    }
    if (task.schemaVersion === 'social-image-creation.v3' && task.creationPath === 'viral_replication') {
        const referenceUrl = task.referenceSnapshot?.imageUrls[0] || task.referenceUrls[0] || task.referenceSnapshot?.sourceUrl || '';
        const reference = referenceUrl ? await readSocialImageReferenceBytes(tenantId, referenceUrl) : null;
        const sourceIssue = socialImageFrozenSourceIssue({ task, productBytes: assets, referenceBytes: reference?.bytes || null });
        if (sourceIssue) {
            throw imageCommandFailure(422, { ok: false, code: sourceIssue, error: sourceIssue });
        }
    }
    const rendered = await renderSocialImageLayerGraph({ graph: renderGraph, assets });
    const digest = createHash('sha256').update(rendered.bytes).digest('hex');
    const filename = `${task.id}-v${task.version}-${digest.slice(0, 12)}.png`;
    const directory = imageRenderRoot(tenantId);
    fs.mkdirSync(directory, { recursive: true });
    const target = path.join(directory, filename);
    if (!fs.existsSync(target)) {
        const temporary = `${target}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, rendered.bytes, { mode: 0o600 });
        fs.renameSync(temporary, target);
    }
    const mediaUrl = `/api/overseas/social-images/renders/${filename}`;
    const outputVersion = Math.max(0, ...task.outputs.filter(item => item.role === 'single' && item.label === '分层主视觉').map(item => item.version)) + 1;
    const output = {
        id: randomUUID(), role: 'single' as const, label: '分层主视觉', state: 'quality_checking' as const,
        mediaUrl, contentHash: digest, version: outputVersion,
        qualityChecks: SOCIAL_IMAGE_HARD_CHECKS.map(key => ({ key, verdict: 'uncertain' as const, severity: 'hard' as const, checker: 'deterministic' as const, note: '等待分层成片质检' })),
    };
    const updated = await updateSocialImageTask(store, tenantId, task.id, task.version, {
        status: 'review_required', step: 'review', layerGraph: renderGraph,
        outputs: [...task.outputs.map(item => item.role === output.role && item.label === output.label ? { ...item, state: 'superseded' as const } : item), output],
        repairInstructions: task.repairInstructions.map(item => item.status === 'pending'
            ? { ...item, status: 'completed' as const, toVersion: outputVersion } : item),
    });
    if (updated.kind !== 'updated') {
        throw imageCommandFailure(updated.kind === 'conflict' ? 409 : 422, { ok: false, error: updated.kind === 'invalid' ? updated.issues.join('；') : '分层成片保存失败' });
    }
    return { ok: true, task: updated.task, layerGraph: renderGraph, url: mediaUrl, sha256: digest, mimeType: rendered.mimeType };
}
export async function preflightImage(input: ImageWorkflowInput) {
    const { store, tenantId, taskId, expectedVersion, enterpriseProductAsset, outputImageBytes, allowPaidCall } = input;
    const found = await readSocialImageTask(store, tenantId, taskId);
    if (!found) {
        throw imageCommandFailure(404, { ok: false, error: '图片任务不存在' });
    }
    let task: SocialImageCreationTask = found;
    if (expectedVersion !== task.version) {
        throw imageCommandFailure(409, { ok: false, error: '任务已被更新，请刷新后继续', task });
    }
    if (task.status === 'approved') {
        throw imageCommandFailure(409, { ok: false, code: 'social_image_approved_immutable' });
    }
    const deterministic = socialImageDeterministicChecks(task);
    const productAssets = (await Promise.all(task.contentBrief.productRefs.map(id => enterpriseProductAsset(tenantId, id))))
        .filter((item): item is {
        name: string;
        bytes: Buffer;
    } => Boolean(item));
    const products = await Promise.all(productAssets.map(async (item) => {
        const format = (await sharp(item.bytes).metadata()).format;
        return { ...item, mimeType: format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg' };
    }));
    const reference = (await Promise.all([...(task.referenceSnapshot?.imageUrls || []), ...task.referenceUrls]
        .slice(0, 4).map(url => readSocialImageReferenceBytes(tenantId, url)))).find(Boolean) || undefined;
    const visualByOutput = new Map<string, SocialImageQualityCheck[]>();
    const localByOutput = new Map<string, { generated: Awaited<ReturnType<ImageWorkflowInput['outputImageBytes']>>;
        pixelChecks: SocialImageQualityCheck[]; ocrCheck: SocialImageQualityCheck }>();
    for (const output of task.outputs) {
        if (output.state === 'superseded' || (task.imageType === 'gif_poster' && output.role === 'gif_plate'))
            continue;
        const generated = await outputImageBytes(tenantId, output);
        if (!generated)
            continue;
        const plannedUnit = task.renderPlan?.units.find(unit => (unit.role === output.role || output.role === 'gif_frame') && unit.label === output.label);
        // Free pixel/OCR checks run before any paid visual QA. A clipped title
        // can then be recomposed from the saved plate without buying a QA call
        // for a candidate that already fails a hard local gate.
        const pixelChecks = await socialImageCandidatePixelChecks({ bytes: generated.bytes, aspectRatio: task.deliverySpec.aspectRatio });
        const ocrCheck = await socialImageCandidateOcrCheck({ bytes: generated.bytes, mimeType: generated.mimeType,
            expectedTexts: [String(plannedUnit?.poster.headline || task.imageTextContract.headline),
                String(plannedUnit?.poster.subheadline || task.imageTextContract.supportingText || ''), task.imageTextContract.cta || ''],
            recognize: recognizeProductImageLocally });
        localByOutput.set(output.id, { generated, pixelChecks, ocrCheck });
        if ([...pixelChecks, ocrCheck].some(check => check.severity === 'hard'
            && !['pass', 'not_applicable'].includes(check.verdict))) continue;
        const result = await runSocialImageVisualPreflight({ store, tenantId, taskId: task.id, outputId: output.id,
            visualInput: { generated, products, reference, expected: {
                    headline: String(plannedUnit?.poster.headline || task.imageTextContract.headline),
                    supportingText: String(plannedUnit?.poster.subheadline || task.imageTextContract.supportingText),
                    cta: task.imageTextContract.cta, facts: task.imageTextContract.requiredFacts, format: task.deliverySpec.format,
                    language: task.deliverySpec.language,
                } }, allowPaidCall: () => allowPaidCall() });
        if (!result)
            return;
        task = result.task;
        visualByOutput.set(output.id, result.visual);
    }
    const outputs = await Promise.all(task.outputs.map(async (output) => {
        if (output.state === 'superseded')
            return output;
        // GIF plates are paid background evidence, not customer-visible frames.
        // Their fixed product/copy layers are checked on the composed frame/GIF.
        if (task.imageType === 'gif_poster' && output.role === 'gif_plate')
            return output;
        const plannedUnit = task.renderPlan?.units.find(unit => (unit.role === output.role || output.role === 'gif_frame') && unit.label === output.label);
        const local = localByOutput.get(output.id);
        const generated = local?.generated || await outputImageBytes(tenantId, output);
        if (!generated) {
            const pixelChecks = await socialImageCandidatePixelChecks({ bytes: Buffer.alloc(0), aspectRatio: task.deliverySpec.aspectRatio });
            const localChecks = new Map(pixelChecks.map(check => [check.key, check]));
            return { ...output, state: 'repair_required' as const,
                qualityChecks: deterministic.map(check => localChecks.get(check.key) || check) };
        }
        const pixelChecks = local?.pixelChecks || await socialImageCandidatePixelChecks({ bytes: generated.bytes, aspectRatio: task.deliverySpec.aspectRatio });
        const expectedFrameBytes = output.role === 'gif_output' ? await Promise.all((task.gifDelivery?.frameOutputIds || [])
            .map(async (id) => (await outputImageBytes(tenantId, task.outputs.find(candidate => candidate.id === id) || {}))?.bytes || null)) : [];
        const animationCheck = output.role === 'gif_output'
            ? [await socialImageGifAnimationCheck({ bytes: generated.bytes, aspectRatio: task.deliverySpec.aspectRatio,
                    expectedFrames: task.renderPlan?.units.length || 0,
                    expectedFrameBytes: expectedFrameBytes.every(Boolean) ? expectedFrameBytes as Buffer[] : [] })] : [];
        const ocrCheck = local?.ocrCheck || await socialImageCandidateOcrCheck({ bytes: generated.bytes, mimeType: generated.mimeType,
            expectedTexts: [String(plannedUnit?.poster.headline || task.imageTextContract.headline),
                String(plannedUnit?.poster.subheadline || task.imageTextContract.supportingText || ''), task.imageTextContract.cta || ''],
            recognize: recognizeProductImageLocally });
        const localChecks = new Map([...pixelChecks, ocrCheck, ...animationCheck].map(check => [check.key, check]));
        const deterministicForOutput = deterministic.filter(check => output.role === 'gif_output'
            || check.key !== 'motion_mechanism_similarity').map(check => localChecks.get(check.key) || check);
        const qualityChecks = mergeSocialImageVisualChecks(deterministicForOutput, visualByOutput.get(output.id) || []);
        qualityChecks.push(...await inspectSocialImageCandidateFactors({ task, bytes: generated.bytes,
            mimeType: generated.mimeType, ocr: localProductOcrReadiness().ready ? recognizeProductImageTokensLocally : undefined }));
        const failed = qualityChecks.filter(check => check.severity === 'hard' && !['pass', 'not_applicable'].includes(check.verdict));
        return { ...output, contentHash: createHash('sha256').update(generated.bytes).digest('hex'),
            state: failed.length ? 'repair_required' as const : 'quality_checking' as const, qualityChecks };
    }));
    const generationJobs = task.generationJobs.map(job => job.status === 'quality_checking'
        ? { ...job, status: 'completed' as const, updatedAt: new Date().toISOString() }
        : job);
    const repairInstructions = [...task.repairInstructions];
    for (const output of outputs.filter(item => item.state === 'repair_required')) {
        const failed = output.qualityChecks.filter(check => check.severity === 'hard' && check.verdict === 'fail');
        if (!failed.length || repairInstructions.some(item => item.outputNodeId === output.id && item.status === 'pending'))
            continue;
        repairInstructions.push({
            id: randomUUID(), outputNodeId: output.id, failedChecks: failed.map(check => check.key),
            targetLayer: failed.some(check => ['product_identity', 'packaging_visibility', 'subject_visibility', 'safe_zone', 'visual_cohesion'].includes(check.key)) ? 'product' : 'typography',
            instruction: failed.map(check => check.repairSuggestion || check.note).join('；').slice(0, 1000),
            status: 'pending', fromVersion: output.version,
        });
    }
    const result = await updateSocialImageTask(store, tenantId, task.id, task.version, { outputs, generationJobs, repairInstructions, status: 'review_required', step: 'review' });
    if (result.kind !== 'updated') {
        throw imageCommandFailure(result.kind === 'conflict' ? 409 : 422, { ok: false, error: result.kind === 'invalid' ? result.issues.join('；') : '质检结果保存失败' });
    }
    const continued = await continueSocialImageProduction({ store, tenantId, taskId: result.task.id,
        expectedVersion: result.task.version });
    return { ok: true, task: continued.task, snapshot: projectSocialImageProductionSnapshot(continued.task),
        advancedNodes: continued.advancedNodes, checks: outputs.flatMap(output => output.qualityChecks) };
}
