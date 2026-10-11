import { createHash } from 'node:crypto';
import { validateFirstFrameRequest, type FirstFrameReference, type FirstFrameRequest } from './firstFrameGenerator.js';
/** New product-scene path: reuse a verified local match first, otherwise replace
 * the reference-shot product with actual enterprise KB packaging. No paid call. */
export function planStoryboardProductScene(input: {
    tenantId: string;
    projectId: string;
    shotId: string;
    productId: string;
    productVersion: string;
    directorScene: string;
    ratio: '9:16' | '16:9' | '1:1';
    composition: FirstFrameReference;
    product: FirstFrameReference;
    compositionAuthorized: boolean;
    productOwned: boolean;
    operationId: string;
    frozenDurationSeconds?: number;
    localMatch?: {
        materialId: string;
        tenantId: string;
        productId: string;
        durationSeconds: number;
        semanticMatch: boolean;
        identityPassed: boolean;
        qualityPassed: boolean;
    };
}) {
    const duration = input.frozenDurationSeconds ?? 3;
    if (!Number.isFinite(duration) || duration <= 0 || !input.tenantId.trim() || !input.projectId.trim() || !input.shotId.trim() || !input.productVersion.trim() || !input.directorScene.trim() || !input.productId.trim())
        throw Error('product_scene_plan_invalid');
    const local = input.localMatch;
    if (local && local.materialId.trim() && local.tenantId === input.tenantId && local.productId === input.productId && local.semanticMatch && local.identityPassed && local.qualityPassed && local.durationSeconds >= duration)
        return { route: 'reuse_local' as const, materialId: local.materialId, desiredDurationSeconds: duration };
    if (!input.compositionAuthorized || !input.productOwned || input.composition.role !== 'source_composition' || input.product.role !== 'product_identity')
        throw Error('product_scene_authorized_composition_and_KB_required');
    const prompt = `Edit image 1, the original storyboard first-frame composition. Replace only the depicted product and its packaging with the actual enterprise product packaging in image 2. Preserve the original shot's composition, setting, lighting, object placement and director action unless replacement requires fitting the correct package. Image 2 is the sole product-identity authority: preserve its brand, printed product name, quantity, label texture, marks and package geometry; do not invent claims, contents or factory/manufacturing evidence. Do not replace the scene with a generic neutral tabletop. No new on-screen captions or logos outside the original packaging. Director shot specification: ${input.directorScene}`;
    const request: FirstFrameRequest = { referenceMode: 'product_scene', tenantId: input.tenantId, videoId: input.projectId, compositionId: input.shotId, presenterVersion: input.productVersion, prompt, ratio: input.ratio, references: [input.composition, input.product], idempotencyKey: input.operationId };
    validateFirstFrameRequest(request);
    const identity = createHash('sha256').update(JSON.stringify({ productId: input.productId, productVersion: input.productVersion, compositionSha256: input.composition.sha256, productSha256: input.product.sha256, directorScene: input.directorScene, desiredDurationSeconds: duration })).digest('hex');
    return { route: 'replace_product_first_frame' as const, request, identity, desiredDurationSeconds: duration, seedanceFastProviderDurationSeconds: Math.max(4, Math.ceil(duration)), requiresExplicitTrim: duration < 4 };
}
