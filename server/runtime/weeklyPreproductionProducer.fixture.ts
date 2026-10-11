import type { WeeklyOperatingPackage } from '../../shared/contracts/socialProgram.js';
import type { DataStore } from '../storage/datastore.js';
import { socialRequestHash } from '../starter198/socialContentValidation.js';
function preproductionPackage(): WeeklyOperatingPackage {
    const publication = {
        publicationTaskId: 'publication-1', motherContentId: 'mother-1', adaptationOfPublicationTaskId: null,
        platform: 'tiktok' as const, accountId: 'account-a', accountPositioning: 'B2B factory', businessProposition: 'OEM proof', cta: 'Contact sales',
        factRefs: [{ type: 'enterprise_fact', id: 'fact-1', version: 1 }], metricTargets: ['qualified_inquiry'], publishWindow: '2026-10-15T10:00:00Z', status: 'planned' as const,
    };
    return {
        packageId: 'package-a', programId: 'program-a', version: 1, status: 'draft', weekStart: '2026-10-12', weekEnd: '2026-10-18', objective: '获得 B2B 询盘',
        enterpriseProfileRef: null, monthlyPlanRef: null, workflows: [], workflowTasks: [], appliedWorkflowEvents: [], taskVersionMappings: [], planningBlockers: [],
        capacityPlanRef: null, automationPolicyRef: null, discoveryBudgetCny: 10,
        socialContentPackage: {
            contentPackageId: 'content-package-a', operatingPackageId: 'package-a', version: 1, status: 'draft', originalContentTarget: 1, adaptationVersionTarget: 0,
            publicationTaskTarget: 1, publicationTasks: [publication], weeklyBudgetCny: 100, perItemBudgetCny: 100, capacityNotes: [],
            authorization: { mode: 'bounded', accountIds: ['account-a'], maxPublishItems: 1, weekStart: '2026-10-12', weekEnd: '2026-10-18', allowRealPublishing: false, authorizedBy: null, authorizedAt: null, revokedBy: null, revokedAt: null },
        },
        successCriteria: ['1 条完成'], changeReason: null, previousVersion: null, createdBy: 'owner', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
    };
}
export { preproductionPackage };
export async function seedPreproductionSupply(store: DataStore) {
 await store.create('social_playbook_versions',{tenant_id:'tenant-a',program_id:'program-a',account_id:'account-a',playbook_id:'playbook-a',version:1,status:'active',payload:{playbookId:'playbook-a',version:1,accountId:'account-a',programId:'program-a',status:'active'}});
    await store.create('social_candidate_evidence', {
        tenant_id: 'tenant-a', evidenceId: 'evidence-video-1', version: 1, tenantId: 'tenant-a', candidateId: 'video-1', inputFingerprint: 'fp',
        evidence: {
            inspirationId: 'video-1', discoveryPath: ['keyword'], sceneIds: [], relevance: { level: 'high', reasons: [] }, momentum: { level: 'high_performance', reasons: [], confidence: 0.8 },
            transferability: { level: 'high', mechanisms: ['demo'], limitations: [] }, evidenceRefs: ['source'],
            qualityScore: { ruleVersion: 'discovery-score-v1', overall: 90, dimensions: { relevance: 90, transferability: 90, momentum: 75, evidence: 80, platformPriority: 100, businessModelFit: 100 }, decision: 'accepted', reasons: ['B2B'], blockers: [], scoredAt: '2026-10-01T00:00:00Z' },
            classification: { businessModel: 'b2b', platform: 'tiktok', keywordTier: 'medium' },
        },
        g1: { sourceUrl: 'https://www.tiktok.com/video-1' }, completeness: 'complete', createdAt: '2026-10-01T00:00:00Z', supersedesEvidenceId: null,
    });
    await store.create('trend_videos', { id: 'video-1', tenantId: 'tenant-a', platform: 'tiktok', title: 'OEM factory capability proof', sourceUrl: 'https://www.tiktok.com/video-1' });
    await store.create('social_tracked_accounts', {
        tenant_id: 'tenant-a', accountId: 'https://www.tiktok.com/@oem_factory', decision: 'track', status: 'tracked', accountRole: 'brand_factory', reasons: ['OEM factory wholesale supplier'],
        evidenceVideoIds: ['video-1', 'video-2', 'video-3'], relatedSceneIds: [], missingEvidence: [], confidence: 0.95,
        businessConfirmation: { status: 'confirmed', confirmedBy: 'business_agent', decisionRef: 'decision-1', reason: null, confirmedAt: '2026-10-01T00:00:00Z' },
    });
    const handoff = { inspirationId: 'video-1', version: '1', analysisVersion: '1', readiness: 'production_reference', source: { sourceUrl: 'https://www.tiktok.com/video-1' }, rights: { mayAnalyze: true, mayAdapt: true }, productionImplications: { requiredEvidence: [], likelyAssetNeeds: [] }, adaptationBoundary: { reusable: [], mustReplace: [], prohibited: [] } };
    await store.create('starter_social_inspiration_handoff_versions', { tenant_id: 'tenant-a', handoff_version: '1', record_hash: socialRequestHash(handoff), payload: handoff });
}
