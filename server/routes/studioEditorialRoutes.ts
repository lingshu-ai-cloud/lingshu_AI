import { extractJSON } from './studioTranslationCore.js';
import { callLLM } from '../agents/llm.js';
import { consumeDemoQuota } from '../lib/demo.js';
import { upstreamGenerationFailure } from '../lib/studioGenerationTruthfulness.js';

import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioEditorialRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter' | 'enterpriseCtx'>) {
  const studioRouter = deps.studioRouter;
  const enterpriseCtx: StudioApplicationPorts['enterpriseCtx'] = (...args) => deps.enterpriseCtx(...args);

  function registerPostInsight() {
    studioRouter.post('/insight', async (req, res) => {
      if (!await consumeDemoQuota(req, res, 'generation')) return;
      const { scope = 'traffic', metrics = {} } = req.body ?? {};
      const prompt = `你是跨境电商社媒操盘手。根据以下「${scope}」当期数据（JSON），给运营一句中文洞察 + 2-3 条可执行建议。
数据：${JSON.stringify(metrics)}
只返回 JSON：{ "summary": string（一句话核心结论，≤40 字）, "actions": string[]（2-3 条，每条≤18 字，动词开头，具体到内容方向/平台/语言/发布节奏） }`;
      try {
        const text = await callLLM(prompt, { backend: 'qwen', systemPrompt: await enterpriseCtx() || undefined });
        const obj = extractJSON<{ summary: string; actions: string[] }>(text);
        if (obj?.summary) {
          res.json({ ok: true, source: 'ai', provenance: 'ai', publishable: true, qualityStatus: 'passed', summary: obj.summary, actions: (obj.actions ?? []).slice(0, 3) });
          return;
        }
        throw new Error('parse');
      } catch (error) {
        res.status(502).json({ ...upstreamGenerationFailure(error, '数据洞察'), summary: '', actions: [] });
      }
    });
  }

  function registerPostSelect() {
    studioRouter.post('/select', async (req, res) => {
      if (!await consumeDemoQuota(req, res, 'generation')) return;
      const { materials = [], duration = 20 } = req.body ?? {};
      const list = materials as { id: string; name: string; type: string; duration: number }[];

      const prompt = `From the clip library below, pick and order the best clips to build a ${duration}s product short video.
Prefer a strong opener, varied shots, and a clear ending. Keep total length close to ${duration}s.
Clips: ${JSON.stringify(list)}
Return ONLY JSON: { "selectedIds": string[] (ordered), "reason": string (one short sentence) }`;

      try {
        const text = await callLLM(prompt, { backend: 'qwen', systemPrompt: await enterpriseCtx() || undefined });
        const obj = extractJSON<{ selectedIds: string[]; reason: string }>(text);
        const valid = obj?.selectedIds?.filter(id => list.some(c => c.id === id));
        if (valid && valid.length) {
          res.json({ ok: true, source: 'ai', provenance: 'ai', publishable: true, qualityStatus: 'passed', selectedIds: valid, reason: obj!.reason ?? '' });
          return;
        }
        throw new Error('parse');
      } catch (error) {
        res.status(502).json({ ...upstreamGenerationFailure(error, '智能选材结果'), selectedIds: [], reason: '' });
      }
    });
  }

  return { registerPostInsight, registerPostSelect };
}
