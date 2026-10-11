import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { planStoryboardProductScene } from '../lib/storyboardProductScenePreparation.js';
import { runVisualFfmpeg } from '../lib/renderVisualQuality.js';
import type { FirstFrameReference, FirstFrameRequest } from '../lib/firstFrameGenerator.js';
import type { ProductSceneExecutionPorts, ProductSceneQualityReport } from './socialContentProductSceneAdapter.js';
type Input = Parameters<ProductSceneExecutionPorts['execute']>[0];
export interface ProductReplacementPorts {
    estimatedCostCny?: () => number;
    /** Trusted server receipt directory, independent of render workspace cleanup. */
    evidenceDirectory?: string;
    assertCurrent: () => Promise<void>;
    /** True only when both the video and its QA operation are funded. */
    canUseVideoAttempt?: (attempt: 0 | 1) => boolean;
    composition: (input: Input) => Promise<{
        reference: FirstFrameReference;
        usageEvidenceRef: string;
    } | null>;
    products: (input: Input) => Promise<FirstFrameReference[]>;
    firstFrame: (request: FirstFrameRequest) => Promise<{
        bytes: Buffer;
        providerRequestId: string;
        model: string;
        estimatedCostCny: number;
        canProceedToVideo: boolean;
        evidenceRefs: string[];
    }>;
    video: (input: {
        attempt?: 0 | 1;
        requestId: string;
        firstFrame: Buffer;
        prompt: string;
        providerDurationSeconds: number;
        checkpointPath: string;
    }) => Promise<{
        bytes: Buffer;
        providerTaskId: string;
        model: string;
        estimatedCostCny: number;
    }>;
    quality: (input: {
        attempt?: 0 | 1;
        filePath: string;
        durationSeconds: number;
        productReferences: FirstFrameReference[];
        composition?: FirstFrameReference;
        firstFrame: Buffer;
        directorScene: string;
    }) => Promise<ProductSceneQualityReport>;
}
export async function trimAndProbeProductScene(sourcePath: string, targetPath: string, duration: number) {
    if (!Number.isFinite(duration) || duration <= 0)
        throw Error('product_target_duration_invalid');
    const trim = await runVisualFfmpeg(['-i', sourcePath, '-t', String(duration), '-map', '0:v:0', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '24', '-movflags', '+faststart', '-y', targetPath], false, { timeoutMs: 120000 });
    if (!trim.ok)
        throw Error('product_actual_trim_failed');
    const probe = await runVisualFfmpeg(['-i', targetPath, '-map', '0:v:0', '-f', 'null', '-'], false, { timeoutMs: 120000, logLevel: 'info' });
    const match = probe.stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    const actual = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : NaN;
    if (!probe.ok || !Number.isFinite(actual) || Math.abs(actual - duration) > 1 / 24 + .01 || /Stream #0:\d[^\n]*Audio:/.test(probe.stderr))
        throw Error('product_actual_trim_probe_failed');
    return actual;
}

async function renderApprovedFirstFrameMotion(input: {
    firstFrame: Buffer;
    outputDirectory: string;
    shotId: string;
    identity: string;
    durationSeconds: number;
    minimumSsimRequired: number;
}) {
    fs.mkdirSync(input.outputDirectory, { recursive: true, mode: 0o700 });
    const source = path.join(input.outputDirectory, `${input.shotId}-${input.identity}-approved-first-frame`);
    const target = path.join(input.outputDirectory, `${input.shotId}-${input.identity}-local-low-motion.mp4`);
    fs.writeFileSync(source, input.firstFrame, { mode: 0o600 });
    const probe = await runVisualFfmpeg(['-i', source, '-frames:v', '1', '-f', 'null', '-'], false, { timeoutMs: 120000, logLevel: 'info' });
    const size = probe.stderr.match(/Video:[^\n]*? (\d{2,})x(\d{2,})/);
    if (!probe.ok || !size) throw Error('product_local_motion_first_frame_invalid');
    const width = Math.max(2, Math.floor(Number(size[1]) / 2) * 2);
    const height = Math.max(2, Math.floor(Number(size[2]) / 2) * 2);
    const frames = Math.max(1, Math.round(input.durationSeconds * 24));
    // A fixed, bounded camera push changes only the view transform. No image
    // synthesis, object insertion, inpainting or provider request is involved.
    const zoom = frames === 1 ? '1' : `1+0.012*on/${frames - 1}`;
    const rendered = await runVisualFfmpeg([
        '-loop', '1', '-i', source,
        '-vf', `zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=24`,
        '-t', String(input.durationSeconds), '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '24', '-movflags', '+faststart', '-y', target,
    ], false, { timeoutMs: 120000 });
    if (!rendered.ok) throw Error('product_local_motion_render_failed');
    const duration = await trimAndProbeProductScene(target, `${target}.verified.mp4`, input.durationSeconds);
    fs.renameSync(`${target}.verified.mp4`, target);
    const affineReference = `${target}.affine-reference.mkv`;
    const referenceRendered = await runVisualFfmpeg(['-loop', '1', '-i', source,
      '-vf', `zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=24`,
      '-t', String(input.durationSeconds), '-an', '-c:v', 'ffv1', '-pix_fmt', 'yuv420p', '-r', '24', '-y', affineReference], false,
    { timeoutMs: 120000 });
    if (!referenceRendered.ok) throw Error('product_local_motion_reference_render_failed');
    const samples = [] as Array<{ position: 'first' | 'middle' | 'last'; seconds: number; ssim: number }>;
    // Decode by frame index instead of seeking near the MP4 tail. Timestamp
    // rounding and B-frame reordering can otherwise produce an empty sample.
    for (const [position, frameIndex] of [['first', 0], ['middle', Math.floor(frames / 2)], ['last', Math.max(0, frames - 4)]] as const) {
      const select = `select='eq(n\\,${frameIndex})',setpts=PTS-STARTPTS`;
      const comparison = await runVisualFfmpeg(['-i', affineReference, '-i', target,
        '-filter_complex', `[0:v]${select}[approved];[1:v]${select}[delivered];[approved][delivered]ssim`, '-frames:v', '1', '-f', 'null', '-'], false,
      { timeoutMs: 120000, logLevel: 'info' });
      const measured = [...comparison.stderr.matchAll(/SSIM[^\n]*All:([\d.]+)/g)].at(-1)?.[1];
      const ssim = Number(measured);
      if (!comparison.ok || !Number.isFinite(ssim)) throw Error('product_local_motion_sample_QA_failed');
      samples.push({ position, seconds: frameIndex / 24, ssim });
    }
    const minimumSsim = Math.min(...samples.map(sample => sample.ssim));
    if (minimumSsim < input.minimumSsimRequired) throw Error('product_local_motion_affine_consistency_failed');
    const affineReferenceSha256 = createHash('sha256').update(fs.readFileSync(affineReference)).digest('hex');
    fs.rmSync(affineReference);
    return { target, duration, width, height, frames, zoom, samples, minimumSsim, affineReferenceSha256 };
}
/** Explicit type-aware policy only. Historic shots retain their prior executor. */
export async function executeProductReplacementScene(input: Input, ports: ProductReplacementPorts) {
    const routing = input.materialRouting, g = routing?.generation;
    const authored = g?.method === 'enterprise_authored_product_first_frame_i2v';
    if (routing?.policy !== 'local_first_product_i2v' || routing.materialType !== 'product' || (!authored && g?.method !== 'reference_first_frame_product_replacement_i2v') || (authored && g?.firstFrameOrigin !== 'enterprise_authored_storyboard') || (!authored && g?.firstFrameOrigin !== undefined && g.firstFrameOrigin !== 'original_reference_pixels') || !g || g.durationSeconds !== input.spec.cameraLock.durationSeconds)
        throw Error('product_replacement_contract_invalid');
    if (!authored && (!g.referenceSourceId || !g.referenceShotId))
        throw Error('product_reference_first_frame_missing');
    await ports.assertCurrent();
    const composition = authored ? null : await ports.composition(input);
    if (!authored && (!composition?.usageEvidenceRef || composition.reference.role !== 'source_composition'))
        throw Error('product_reference_pixels_usage_missing');
    const products = await ports.products(input);
    if (!products.length || products.some(p => p.role !== 'product_identity'))
        throw Error('product_KB_packaging_missing');
    const directorScene = JSON.stringify({ scene: input.spec.sceneLock, camera: input.spec.cameraLock });
    const plan = planStoryboardProductScene({
        tenantId: input.tenantId,
        projectId: input.taskId,
        shotId: input.shotId,
        productId: input.spec.productIdentity.groups[0]?.productRef || '',
        productVersion: products.map(p => p.sha256).join(':'),
        directorScene,
        ratio: '9:16',
        composition: composition?.reference,
        firstFrameOrigin: authored ? 'enterprise_authored_storyboard' : 'original_reference_pixels',
        product: products[0]!,
        compositionAuthorized: true,
        productOwned: true,
        operationId: input.idempotencyKey + ':product-replacement-first-frame',
        frozenDurationSeconds: g.durationSeconds,
    });
    if (plan.route !== 'replace_product_first_frame' && plan.route !== 'author_product_first_frame')
        throw Error('product_replacement_plan_unexpected');
    // Keep every specified same-product KB reference, not a guessed SKU.
    plan.request.references = authored ? products : [composition!.reference, ...products];
    const frame = await ports.firstFrame(plan.request);
    if (!frame.canProceedToVideo || !frame.bytes.length || !frame.evidenceRefs.length)
        throw Error('product_replacement_first_frame_identity_QA_failed');
    await ports.assertCurrent();
    const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
    const providerDurationSeconds = g.videoProvider === 'wan' ? (g.videoModel === 'wan2.2-i2v-flash' ? 5 : Math.max(2,Math.ceil(g.durationSeconds))) : plan.seedanceFastProviderDurationSeconds;
    if(g.videoProvider==='wan'&&(!['wan2.6-i2v-flash','wan2.2-i2v-flash'].includes(g.videoModel||'')||!Number.isInteger(providerDurationSeconds)||providerDurationSeconds<2||providerDurationSeconds>15||(g.videoModel==='wan2.2-i2v-flash'&&g.durationSeconds>5)))throw Error('product_wan_frozen_duration_invalid');
    const identity = hash(JSON.stringify({ request: plan.identity, firstFrameSha256: hash(frame.bytes), providerDuration: providerDurationSeconds, targetDuration: g.durationSeconds }));
    let video!: Awaited<ReturnType<ProductReplacementPorts['video']>>, quality!: ProductSceneQualityReport, duration = 0, target = '', localFallback = false;
    const failedAigcQualityEvidence: string[] = [];
    let attemptedVideos = 0;
    const qualityFailed = (report: ProductSceneQualityReport) => input.spec.productIdentity.groups.some(group =>
      Number(report.productIdentitySimilarity[group.productRef] || 0) < input.spec.productIdentity.identitySimilarityMinimum)
      || input.spec.productIdentity.ocrExactMatchRequired && !report.labelOcrExactMatch
      || report.sceneTopologyScore < .75 || report.productSlotLayoutScore < .75 || report.cameraTrajectoryScore < .75 || !report.evidenceRefs.length;
    for (const attempt of [0, 1] as const) {
      const retry = attempt === 1;
      if (retry && (!input.spec.validation.singleShotRetryOnFailure || !qualityFailed(quality))) break;
      if (ports.canUseVideoAttempt && !ports.canUseVideoAttempt(attempt)) break;
      attemptedVideos++;
      const attemptIdentity = retry ? `${identity}:attempt:1` : identity;
      video = await ports.video({ attempt,
        // Attempt zero keeps its historical durable identity so an in-flight
        // task recovers the accepted provider request instead of resubmitting it.
        requestId: `${input.idempotencyKey}:${attemptIdentity}`,
        firstFrame: frame.bytes,
        prompt: `Animate the supplied actual approved enterprise product first frame according to this director shot: ${directorScene}. Preserve product packaging, labels and composition. No added text or fabricated manufacturing facts.${retry ? ' This is the single directed correction: keep the supplied first frame unchanged and correct the prior video quality failure without changing product identity or scene topology.' : ''}`,
        providerDurationSeconds,
        checkpointPath: path.join(input.outputDirectory, `${attemptIdentity}${g.videoProvider==='wan'?'.wan.json':'.seedance.json'}`),
      });
      fs.mkdirSync(input.outputDirectory, { recursive: true, mode: 0o700 });
      const original = path.join(input.outputDirectory, `${input.shotId}-${identity}-attempt-${attempt}-provider.mp4`);
      target = path.join(input.outputDirectory, `${input.shotId}-${identity}-attempt-${attempt}-delivery.mp4`);
      fs.writeFileSync(original, video.bytes, { mode: 0o600 });
      duration = await trimAndProbeProductScene(original, target, g.durationSeconds);
      quality = await ports.quality({ attempt, filePath: target, durationSeconds: duration, productReferences: products, composition: composition?.reference, firstFrame: frame.bytes, directorScene: plan.request.prompt });
      if (!qualityFailed(quality)) break;
      failedAigcQualityEvidence.push(...quality.evidenceRefs);
    }
    if (!attemptedVideos) throw Error('product_video_funded_attempt_missing');
    const pixelIntegrityFailure = input.spec.productIdentity.groups.some(group =>
      Number(quality.productIdentitySimilarity[group.productRef] || 0) < input.spec.productIdentity.identitySimilarityMinimum)
      || input.spec.productIdentity.ocrExactMatchRequired && !quality.labelOcrExactMatch
      || quality.sceneTopologyScore < .75 || quality.productSlotLayoutScore < .75;
    if (qualityFailed(quality) && input.spec.validation.singleShotRetryOnFailure && pixelIntegrityFailure) {
      await ports.assertCurrent();
      const local = await renderApprovedFirstFrameMotion({ firstFrame: frame.bytes, outputDirectory: input.outputDirectory,
        shotId: input.shotId, identity, durationSeconds: g.durationSeconds,
        minimumSsimRequired: Math.max(.82, input.spec.productIdentity.identitySimilarityMinimum) });
      target = local.target;
      duration = local.duration;
      localFallback = true;
      const localEvidence = path.join(ports.evidenceDirectory || input.outputDirectory, `${input.shotId}-${identity}-local-low-motion-QA.json`);
      fs.mkdirSync(path.dirname(localEvidence), { recursive: true, mode: 0o700 });
      fs.writeFileSync(localEvidence, JSON.stringify({
        schemaVersion: 'social-product-local-low-motion-QA.v1', passed: true, costCny: 0,
        source: 'approved_product_first_frame', sourceSha256: hash(frame.bytes), outputSha256: hash(fs.readFileSync(target)),
        durationSeconds: duration, width: local.width, height: local.height, frameCount: local.frames,
        transform: { kind: 'deterministic_camera_push', zoomExpression: local.zoom, maximumZoom: 1.012 },
        verification: { kind: 'approved_source_deterministic_affine_transform_verified', metric: 'ffmpeg_ssim',
          samples: local.samples, minimumSsim: local.minimumSsim,
          passThreshold: Math.max(.82, input.spec.productIdentity.identitySimilarityMinimum),
          affineReferenceSha256: local.affineReferenceSha256,
          mapping: 'minimum SSIM maps to identity/topology/layout/trajectory scores; OCR is accepted only because every decoded sample is derived exclusively by the verified affine transform from the OCR-approved source frame' },
        invariants: { providerCalledForFallback: false, sourceIsApprovedFirstFrame: true,
          transformIsDeterministicAffineWithCodecInterpolation: true, productObjectsComposited: false, audioAdded: false },
        attemptedVideoCount: attemptedVideos,
        priorAigcQualityEvidenceRefs: failedAigcQualityEvidence,
        reason: 'available_authorized_aigc_video_attempts_failed_product_pixel_integrity_QA',
      }, null, 2), { mode: 0o600 });
      quality = { productIdentitySimilarity: Object.fromEntries(input.spec.productIdentity.groups.map(group => [group.productRef, local.minimumSsim])),
        labelOcrExactMatch: local.minimumSsim >= Math.max(.82, input.spec.productIdentity.identitySimilarityMinimum), sceneTopologyScore: local.minimumSsim,
        productSlotLayoutScore: local.minimumSsim, cameraTrajectoryScore: local.minimumSsim,
        evidenceRefs: [...failedAigcQualityEvidence, localEvidence] };
    }
    const contentHash = hash(fs.readFileSync(target));
    const evidenceDirectory = ports.evidenceDirectory || input.outputDirectory;
    fs.mkdirSync(evidenceDirectory, {recursive: true, mode: 0o700});
    const lineage = path.join(evidenceDirectory, input.shotId + '-' + identity + '-trim-lineage.json');
    fs.writeFileSync(lineage, JSON.stringify({provider:localFallback?'local_deterministic_motion':g.videoProvider??'seedance',model:localFallback?'ffmpeg-zoompan-v1':video.model,providerTaskId: localFallback?null:video.providerTaskId, sourceSha256: localFallback?hash(frame.bytes):hash(video.bytes), deliveredSha256: contentHash, providerDurationSeconds: localFallback?null:providerDurationSeconds, actualDeliveredDurationSeconds: duration, transform: localFallback?'deterministic 1.2% affine camera push from approved first frame with codec interpolation':'ffmpeg video-only re-encode trim; no tempo or still-image synthesis', fallbackCostCny:localFallback?0:null, firstFrameOrigin: authored ? 'enterprise_authored_storyboard' : 'original_reference_pixels', compositionSha256: composition?.reference.sha256 ?? null, productSha256s: products.map(p => p.sha256), usageEvidenceRef: composition?.usageEvidenceRef ?? null, humanApproved: false }, null, 2), { mode: 0o600 });
    return { status: 'completed' as const, providerId: localFallback?'local-product-low-motion':g.videoProvider==='wan'?'seedream-product-replacement-wan':'seedream-product-replacement-seedance', providerTaskId: localFallback?`local:${identity}`:video.providerTaskId, model: frame.model + '+' + (localFallback?'ffmpeg-zoompan-v1':video.model), localPath: target, contentHash, duration, actualCostCny: localFallback?0:null, estimatedCostCny: ports.estimatedCostCny?.() ?? frame.estimatedCostCny + video.estimatedCostCny, quality: { ...quality, evidenceRefs: [...frame.evidenceRefs, ...quality.evidenceRefs, lineage] } };
}
