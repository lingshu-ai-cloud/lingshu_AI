import { createMobileWorkbenchQueueRouter } from './mobileWorkbenchQueue.js';
import { createMobileWorkbenchOverviewRouter } from './mobileWorkbenchOverview.js';
import { createMobileWorkbenchActionsRouter, createMobileWorkbenchDomainExecutor } from './mobileWorkbenchActions.js';
import { decideDigitalEmployeeApproval } from '../digitalEmployees/approvalDecision.js';
import { retryDigitalEmployeeTask } from './digitalEmployees.js';
import { store } from '../storage/index.js';
import { Router, json, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { consumeDemoQuota } from '../lib/demo.js';
import { transcribeAudioWithQwen } from '../agents/qwen.js';
export const mobileWorkbenchRouter = Router();
mobileWorkbenchRouter.use(requireAuth, createMobileWorkbenchOverviewRouter(store), createMobileWorkbenchQueueRouter(store));
mobileWorkbenchRouter.use(requireAuth, createMobileWorkbenchActionsRouter(store, createMobileWorkbenchDomainExecutor({
    decideApproval: decideDigitalEmployeeApproval,
    retryTask: retryDigitalEmployeeTask,
})));
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
