import { langName } from './studioTranslationCore.js';
import { consumeDemoQuota, isDemoMode } from '../lib/demo.js';
import { GENERATED_MEDIA_DIR } from '../studio/runtimeConfig.js';
import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioGeminiVideoRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter' | 'isGeminiVideoEnabled' | 'normalizeGeminiVideoDuration' | 'geminiVideoConfig' | 'runGeminiVideoWorker'>) {
  const studioRouter = deps.studioRouter;
  const isGeminiVideoEnabled: StudioApplicationPorts['isGeminiVideoEnabled'] = (...args) => deps.isGeminiVideoEnabled(...args);
  const normalizeGeminiVideoDuration: StudioApplicationPorts['normalizeGeminiVideoDuration'] = (...args) => deps.normalizeGeminiVideoDuration(...args);
  const geminiVideoConfig: StudioApplicationPorts['geminiVideoConfig'] = (...args) => deps.geminiVideoConfig(...args);
  const runGeminiVideoWorker: StudioApplicationPorts['runGeminiVideoWorker'] = (...args) => deps.runGeminiVideoWorker(...args);

  function registerPostGeminiVideo() {
    studioRouter.post('/gemini-video', async (req, res) => {
      if (!isGeminiVideoEnabled() || isDemoMode()) {
        res.status(423).json({
          ok: false,
          locked: true,
          source: 'gemini',
          error: '当前视频生成服务暂未启用。请先配置可用的生成模型 Key 后重试。',
        });
        return;
      }
      const {
        script = '',
        productInfo = '',
        language = 'zh',
        ratio = '9:16',
        duration: rawDuration = 8,
        resolution = '720p',
        title = 'Gemini 生成视频',
      } = req.body ?? {};
      const duration = normalizeGeminiVideoDuration(rawDuration);
      if (!await consumeDemoQuota(req, res, 'videoGeneration')) return;
      const { apiKey, model } = geminiVideoConfig();
      if (!apiKey) {
        res.json({ ok: false, source: 'gemini', error: 'GEMINI_API_KEY not set' });
        return;
      }

      const prompt = [
        `Generate one ${duration}-second vertical commercial social video in ${langName(language)}, aspect ratio ${ratio}.`,
        'Treat the storyboard timecodes and the fields named Omni prompt / Omni negative prompt as the highest-priority visual instructions.',
        `Storyboard:\n${String(script).slice(0, 7000)}`,
        productInfo ? `Identity and product context (preserve appearance exactly; do not invent claims):\n${String(productInfo).slice(0, 1800)}` : '',
        'Reproduce only explicitly observed actions. An inferred intent explains why an image works, but it is not permission to invent a missing action. Never turn a causal gap into an on-screen event.',
        'For every beat, preserve the exact object state before and after the action, hand visibility, physical contact, gaze direction, head pose, framing, and whether the camera is static. Fast actions must start and end at the written sub-second boundary.',
        'Use realistic UGC optics, skin texture, eye reflections, tissue deformation and moisture. Preserve temporal continuity and subject identity. Do not beautify, recolor eyes, add tears, wiping, extra fingers, extra hand motion, camera moves, captions, platform UI, logos, or transitions unless explicitly requested.',
        'Do not render interface overlays or unreadable text into the video; overlays and verified captions are added in post-production.',
      ].filter(Boolean).join('\n\n');

      try {
        const timeoutMs = Math.max(30_000, Number(process.env.GEMINI_VIDEO_TIMEOUT_MS || 360_000));
        const output = await runGeminiVideoWorker({
          prompt,
          model,
          title,
          ratio,
          duration,
          resolution,
          outputDir: GENERATED_MEDIA_DIR,
          timeoutMs,
        }, timeoutMs);
        res.json(output);
        console.log(`[studio] TTS response sent headers=${res.headersSent} ended=${res.writableEnded}`);
      } catch (e: any) {
        const reason = String(e?.message ?? e).slice(0, 500);
        console.error('[studio] Gemini video generation failed:', e);
        res.json({ ok: false, source: 'gemini', error: `Gemini 视频生成失败：${reason}` });
      }
    });
  }

  return { registerPostGeminiVideo };
}
