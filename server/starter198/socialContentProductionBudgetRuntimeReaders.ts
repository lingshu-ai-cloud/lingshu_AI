import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {createProductionBudgetRouteReaders} from './socialContentProductionBudgetRoutes.js';
import type { ProductionBudgetReadPorts } from './socialContentProductionBudgetPreflight.js';
import type { InternalSocialContentFormula } from './socialContentThemes.js';
import { socialDirectorFrozenDirection } from './socialContentDirectorPlan.js';
import { socialDirectorSpokenNarration } from './socialContentDirectorHandoff.js';
import { dashscopeCredentialConfigured } from '../lib/voiceQuality.js';
/** Trusted server factory. No request body, supplier request or business write.
 * Formula is the resolved version already used by production; an absent or
 * different formula cannot be replaced by a speculative voice selection. */
export function createProductionBudgetRuntimeReaders(input: {
    formula?: InternalSocialContentFormula | null;
    env?: NodeJS.ProcessEnv;
    localExecutionReader?: ProductionBudgetReadPorts['readVerifiedLocalExecution'];
} = {}): Pick<ProductionBudgetReadPorts, 'readVoicePlan' | 'readAnalysisFrames' | 'readVerifiedLocalExecution' | 'resolveBoundRoute' | 'readProductFrameBounds'> {
    const env = { ...(input.env || process.env) };
    return {
        ...createProductionBudgetRouteReaders({env:()=>input.env||process.env}),
        async readVoicePlan(baseline) {
            const ref = baseline.formulaReference;
            if (ref && (!input.formula || input.formula.formulaId !== ref.formulaId || input.formula.version !== ref.version))
                return null;
            const direction = socialDirectorFrozenDirection({ baseline, formula: input.formula, duration: 0 });
            const text = socialDirectorSpokenNarration(baseline.scenes.map(scene => ({ voiceover: scene.voiceover || scene.narration })), baseline.language);
            const { splitStudioNarrationSentences } = await import('../routes/studio.js');
            const lines = splitStudioNarrationSentences(text);
            const custom = direction.voiceover.voice.startsWith('custom:');
            const expressive = env.TTS_PREFER_EXPRESSIVE_PROVIDER !== 'false' && Boolean((env.MINIMAX_API_KEY || env.MINIMAX_API_TOKEN || '').trim()) && Boolean(direction.voiceover.preset || direction.voiceover.pauseStyle);
            return { mode: !text ? 'none' : lines.length > 1 && lines.length <= 100 && text.length <= 5000 ? 'continuous' : 'sentences', lines, requiresClone: custom, allowFallback: custom || !(expressive && env.TTS_REQUIRE_MINIMAX === 'true'), requiresAsr: env.TTS_ASR_QA_ENABLED !== 'false' && dashscopeCredentialConfigured(env), reuseReceiptRef: null };
        },
        async readAnalysisFrames(asset) {
            if (asset.type !== 'video' || !asset.localPath || (env.VIDEO_ANALYSIS_PROVIDER || 'qwen').trim().toLowerCase() !== 'qwen')
                return null;
            const h = createHash('sha256');
            for await (const part of fs.createReadStream(asset.localPath))
                h.update(part);
            if (h.digest('hex') !== asset.contentHash)
                throw Error('production_budget_analysis_source_changed');
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-analysis-'));
            try {
                const { resolveSourceDurations } = await import('../lib/videoSourcePlan.js');
                const { runVisualFfmpeg } = await import('../lib/renderVisualQuality.js');
                const { extractQwenAnalysisFrames } = await import('../routes/videos.js');
                const { materialFrameBatches } = await import('../digitalEmployees/productionMaterialAnalysis.js');
                const [resolved] = await resolveSourceDurations([asset]);
                if (!resolved?.duration)
                    return null;
                const proxy = path.join(dir, 'analysis-proxy.mp4');
                const prepared = await runVisualFfmpeg(['-i', asset.localPath, '-map', '0:v:0', '-an', '-vf', "scale='min(960,iw)':-2", '-r', '6', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-y', proxy], false, { timeoutMs: 120000 });
                if (!prepared.ok || !fs.existsSync(proxy))
                    throw Error('production_budget_analysis_proxy_failed');
                const frames = await extractQwenAnalysisFrames(proxy, Math.max(18, Math.min(48, Math.ceil(resolved.duration * 2))), resolved.duration);
                const after = createHash('sha256');
                for await (const part of fs.createReadStream(asset.localPath))
                    after.update(part);
                if (after.digest('hex') !== asset.contentHash)
                    throw Error('production_budget_analysis_source_changed');
                return { frameCount: frames.length, batchFrameCounts: materialFrameBatches(frames, resolved.duration).map(batch => batch.frames.length) };
            }
            finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        },
        async readVerifiedLocalExecution(requirement) {
            // Strategy names are not receipts: animation/stock/graphics can all incur
            // supplier charges. Only the actual selected canonical adapter may attest.
            return input.localExecutionReader ? input.localExecutionReader(requirement) : null;
        }
    };
}
