import { createMobileWorkbenchQueueRouter } from './mobileWorkbenchQueue.js';
import { createMobileWorkbenchOverviewRouter } from './mobileWorkbenchOverview.js';
import { createMobileWorkbenchActionsRouter, createMobileWorkbenchDomainExecutor, type MobileWorkbenchActionExecutor, type MobileWorkbenchSubjectResolver } from './mobileWorkbenchActions.js';
import { decideDigitalEmployeeApproval } from '../digitalEmployees/approvalDecision.js';
import { retryDigitalEmployeeTask } from './digitalEmployees.js';
import { store } from '../storage/index.js';
import { Router, json, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { consumeDemoQuota } from '../lib/demo.js';
import { transcribeAudioWithQwen } from '../agents/qwen.js';
import { createMobileWorkbenchProductAdapter } from './mobileWorkbenchProductAdapter.js';
import { createMobileAssistantSessionsRouter } from './mobileAssistantSessions.js';
import { createMobileWorkbenchAssistantRouter } from './mobileWorkbenchAssistant.js';
import { createMobileWorkbenchMattersRouter } from './mobileWorkbenchMatters.js';
import { createExternalReplyAdapter } from '../mobileWorkbenchInterventions/externalReply.js';
import { createMaterialConnectionInterventions } from '../mobileWorkbenchInterventions/materialConnection.js';
import { executeProductionScopedRepair } from '../mobileWorkbenchInterventions/repairProduction.js';
import { readStarterPublicationPackage } from '../publishing/starterPublicationPackage.js';
import type { Record_ } from '../storage/datastore.js';
export const mobileWorkbenchRouter = Router();
const productAdapter = createMobileWorkbenchProductAdapter();
mobileWorkbenchRouter.use(requireAuth, createMobileWorkbenchOverviewRouter(store, productAdapter), createMobileWorkbenchQueueRouter(store, productAdapter));
// Session routes must run before the assistant grounding gate so history can
// be restored without turning a read into a new model request.
mobileWorkbenchRouter.use(requireAuth, createMobileAssistantSessionsRouter(store));
mobileWorkbenchRouter.use(requireAuth, createMobileWorkbenchAssistantRouter(store));
mobileWorkbenchRouter.use(requireAuth, createMobileWorkbenchMattersRouter(store));
const standardExecutor = createMobileWorkbenchDomainExecutor({
    decideApproval: decideDigitalEmployeeApproval,
    retryTask: retryDigitalEmployeeTask,
});
const externalReply = createExternalReplyAdapter({ dataStore: store, retryTask: retryDigitalEmployeeTask });
// Production checkpoint callbacks for these routes have not been implemented.
// Keeping them absent makes their advertised actions and direct execution fail closed.
const materialConnection = createMaterialConnectionInterventions({ store });
const mobileActionExecutor: MobileWorkbenchActionExecutor = async input => {
    const { action, tenantId, userId, receiptId } = input;
    if (action.kind === 'approval_decision' || action.kind === 'retry_task') return standardExecutor(input);
    if (action.kind === 'scoped_repair') return executeProductionScopedRepair({ tenantId, userId,
        projectId: action.targetId, commandId: receiptId, payload: action.payload as any });
    if (action.kind === 'material_fulfillment') return materialConnection.fulfillMaterials({ tenantId, userId }, {
        shootingTaskId: action.targetId, materialIds: action.payload.materialIds as string[], checkpointId: String(action.payload.checkpointId || ''),
        expectedVersion: action.expectedVersion,
    }) as Promise<Record<string, unknown>>;
    if (action.kind === 'connection_repair') return materialConnection.repairConnection({ tenantId, userId }, {
        accountId: action.targetId, requiredScopes: action.payload.requiredScopes as string[], checkpointId: String(action.payload.checkpointId || ''),
    }) as Promise<Record<string, unknown>>;
    return externalReply.execute({ tenantId, userId, targetId: action.targetId, expectedVersion: action.expectedVersion,
        idempotencyKey: action.idempotencyKey, kind: action.kind as any, payload: action.payload });
};
const mobileActionSubject: MobileWorkbenchSubjectResolver = async (dataStore, tenantId, action) => {
    const collection = action.kind === 'approval_decision' ? 'approval_requests'
        : ['retry_task', 'dependency_retry'].includes(action.kind) ? 'workflow_tasks'
        : action.kind === 'scoped_repair' ? 'studio_projects'
        : action.kind === 'material_fulfillment' ? 'studio_shooting_tasks'
        : action.kind === 'connection_repair' ? 'social_accounts'
        : action.kind === 'publication_receipt_verify' ? 'posts'
        : ['conversation_reply_send', 'conversation_assign'].includes(action.kind) ? 'wecom_kf_conversations' : '';
    if (action.kind === 'publication_evidence_submit') {
        const manifest = await readStarterPublicationPackage(tenantId, action.targetId, dataStore);
        return manifest ? { id: manifest.packageId, tenant_id: tenantId, version: manifest.contentHash } as Record_ : null;
    }
    if (!collection) return null;
    const row = await dataStore.getById<Record_>(collection, action.targetId);
    const owner = row?.tenant_id ?? row?.tenantId;
    return row && owner === tenantId ? row : null;
};
mobileWorkbenchRouter.use(requireAuth, createMobileWorkbenchActionsRouter(store, mobileActionExecutor, undefined, mobileActionSubject));
export async function transcribeMobileVoice(req: Request, res: Response) {
    const audio = req.body?.audio;
    if (typeof audio !== 'string' || audio.length > 2800000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) {
        res.status(400).json({ error: '录音格式无效或超过大小限制' });
        return;
    }
    const bytes = Buffer.from(audio, 'base64');
    if (bytes.length < 32 || bytes.length > 2 * 1024 * 1024) {
        res.status(400).json({ error: '录音为空或超过 2 MB' });
        return;
    }
    if (!await consumeDemoQuota(req, res, 'aiChat'))
        return;
    try {
        const result = await transcribeAudioWithQwen({ audio: bytes, fileName: 'mobile-voice.mp3', signal: AbortSignal.timeout(60000) });
        if (!result.text?.trim()) {
            res.status(422).json({ error: '没有识别到语音，请重录' });
            return;
        }
        res.json({ text: result.text });
    }
    catch {
        res.status(502).json({ error: '语音识别暂不可用，请重试或使用文字输入' });
    }
}
mobileWorkbenchRouter.post('/transcribe', requireAuth, json({ limit: '3mb' }), transcribeMobileVoice);
