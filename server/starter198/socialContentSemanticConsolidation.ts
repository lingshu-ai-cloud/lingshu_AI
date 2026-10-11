import { normalizeSceneVisualContract } from '../../shared/sceneVisualContract.js';
import type { SocialReplicationScriptShot } from '../../shared/contracts/socialContentWorkflow.js';
import type { VerifiedSocialScriptContext } from './socialContentScriptBaseline.js';
export interface ReferenceSemanticPlanning {
    targetDurationSeconds: number | null;
    budgetCny: number;
    language?: 'en' | 'zh';
    callToAction?: string | null;
}
/** New authored plan only. Reference analysis and source speech remain intact;
 * this never rewrites an already frozen identity-only plan. */
export function consolidateReferenceSemanticShots(input: {
    shots: SocialReplicationScriptShot[];
    planning: ReferenceSemanticPlanning;
    context: VerifiedSocialScriptContext;
}) {
    const { planning } = input;
    if (!planning.targetDurationSeconds || input.shots.length <= 6)
        return input.shots;
    if (planning.budgetCny <= 0 || planning.budgetCny > 10)
        throw Error('social_semantic_budget_invalid');
    const stage = (purpose: string) => purpose === 'hook' ? 0 : purpose === 'problem' ? 1 : purpose === 'value' ? 2 : purpose === 'demonstration' ? 3 : purpose === 'call_to_action' ? 5 : 4;
    const groups = new Map<number, SocialReplicationScriptShot[]>();
    for (const shot of input.shots) {
        const key = stage(shot.purpose);
        groups.set(key, [...(groups.get(key) || []), shot]);
    }
    const ordered = [...groups.entries()].sort((a, b) => a[0] - b[0]);
    if (planning.targetDurationSeconds < ordered.length * 3)
        throw Error('social_semantic_target_requires_fewer_functions');
    const en = planning.language !== 'zh';
    const copy = en ? ['Looking for your next product?', 'Start with the product.', 'Explore the details.', 'Take a closer look.', 'Consider your requirements.', 'Contact us to discuss this product.'] : ['寻找适合您的产品？', '从产品本身开始。', '了解产品细节。', '近距离查看产品。', '结合您的需求选择。', '联系我们了解这款产品。'];
    const visuals = en ? ['Authorized enterprise presenter introduces the product, with no unverified claim.', 'Show only the actual enterprise product packaging.', 'Inspect the actual package details without changing label text.', 'One simple product movement, preserving the enterprise package identity.', 'Show the product and invite the viewer to consider their needs; no factory or consumer demonstration.', 'Show the enterprise product with the exact contact invitation.'] : ['授权企业人物介绍产品，不作未经核验的声明。', '展示企业实际产品包装。', '观察实际包装细节，印刷文字保持不变。', '产品简单动作，企业包装身份保持不变。', '展示产品并邀请用户考虑需求，不展示工厂或消费者使用实证。', '展示企业产品与准确联系邀请。'];
    const durations = ordered.map(() => planning.targetDurationSeconds! / ordered.length);
    let cursor = 0;
    return ordered.map(([key, original], index) => {
        const representative = original.find(s => s.materialPlan.sourceStrategy === 'aigc_product_scene_replication') || original[0]!;
        const shotId = `semantic-scene-${index + 1}`;
        const referenceShotIds = [...new Set(original.flatMap(s => s.referenceShotIds || [s.referenceShotId]).filter((s): s is string => Boolean(s)))];
        const presenter = key === 0;
        const purpose = key === 4 ? 'value' as const : representative.purpose;
        const materialPlan = { ...structuredClone(representative.materialPlan), shotId, function: purpose, sourceStrategy: presenter ? 'authorized_digital_presenter' as const : 'aigc_product_scene_replication' as const, fallbackSourceStrategy: null, sourceRefs: [], referenceProductionRouting: undefined, materialRouting: undefined, productSceneReplication: undefined, truthBoundary: { ...structuredClone(representative.materialPlan.truthBoundary), subject: 'none' as const, syntheticVisualAllowed: true, customerEvidenceRequired: false, customerEvidenceRefs: [], mustNotImplyCustomerReality: true }, visualContract: normalizeSceneVisualContract({ subjects: [{ subjectId: presenter ? 'person' : 'product', kind: presenter ? 'person' : 'product', description: presenter ? '授权企业人物' : '企业实际产品', identitySensitive: true }], interaction: { kind: presenter ? 'person_talking' : 'product_only_display' }, environment: { kind: 'studio', description: '原创中性场景' }, productUsage: { kind: 'none' } }), requestedDescription: visuals[key]!, productionInstruction: visuals[key]!, functionalEquivalentReplacement: { required: original.some(s => s.purpose === 'd_to_c' || s.materialPlan.materialRouting?.policy === 'local_only' || s.materialPlan.truthBoundary.customerEvidenceRequired), preservesFunction: purpose, replacesSubject: 'customer_factory' as const, description: visuals[key]!, reason: '企业事实及真实本地证据未确认，使用原创产品介绍，不生成工厂或消费者使用事实' } };
        const duration = durations[index]!, startSeconds = cursor;
        cursor += duration;
        const spokenText = key === 5 && planning.callToAction?.trim() ? planning.callToAction.trim() : copy[key]!;
        return { ...structuredClone(representative), scriptOrigin: 'budget_semantic_revision' as const, shotId, purpose, referenceShotId: referenceShotIds[0] || null, referenceShotIds, startSeconds, endSeconds: cursor, spokenText, referenceSpokenText: null, speechLines: [], voiceoverReplacement: undefined, visualInstruction: visuals[key]!, captionText: spokenText, materialPlan,
            fidelityPoints: [...new Set(original.flatMap(s => s.fidelityPoints))], mustDifferPoints: [...new Set([...original.flatMap(s => s.mustDifferPoints), '本片按目标时长采用企业原创精简口播，不复制参考逐字台词或第三方事实。'])], risks: [...new Set(original.flatMap(s => s.risks))] };
    });
}
