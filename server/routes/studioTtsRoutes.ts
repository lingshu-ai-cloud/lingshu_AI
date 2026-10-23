import { normalizeTtsLanguage, normalizeTtsStyle } from './studioTtsStyle.js';
import { createStudioAsrRouter } from '../lib/studioAsrRouter.js';
import { spokenLanguageMatches } from '../../shared/contracts/videoCreationPlan.js';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import ffmpegStatic from 'ffmpeg-static';
import { consumeDemoQuota } from '../lib/demo.js';
import { transcribeAudioWithQwen } from '../agents/qwen.js';
import { type AuthLocals } from '../middleware/auth.js';
import { TTS_ROOT } from '../studio/runtimeConfig.js';
import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioTtsRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter' | 'studioAudioCapabilities' | 'minimaxFetchJson' | 'rememberRejectedMinimaxCredential' | 'spokenText' | 'synthesizeStudioVoiceForAutomation' | 'localTtsFile' | 'proportionalCues' | 'alignTtsAudio' | 'scopedStudioAssetDir' | 'persistPrivateStudioAsset'>) {
  const studioRouter = deps.studioRouter;
  const studioAudioCapabilities: StudioApplicationPorts['studioAudioCapabilities'] = (...args) => deps.studioAudioCapabilities(...args);
  const minimaxFetchJson: StudioApplicationPorts['minimaxFetchJson'] = (...args) => deps.minimaxFetchJson(...args);
  const rememberRejectedMinimaxCredential: StudioApplicationPorts['rememberRejectedMinimaxCredential'] = (...args) => deps.rememberRejectedMinimaxCredential(...args);
  const spokenText: StudioApplicationPorts['spokenText'] = (...args) => deps.spokenText(...args);
  const synthesizeStudioVoiceForAutomation: StudioApplicationPorts['synthesizeStudioVoiceForAutomation'] = (...args) => deps.synthesizeStudioVoiceForAutomation(...args);
  const localTtsFile: StudioApplicationPorts['localTtsFile'] = (...args) => deps.localTtsFile(...args);
  const proportionalCues: StudioApplicationPorts['proportionalCues'] = (...args) => deps.proportionalCues(...args);
  const alignTtsAudio: StudioApplicationPorts['alignTtsAudio'] = (...args) => deps.alignTtsAudio(...args);
  const scopedStudioAssetDir: StudioApplicationPorts['scopedStudioAssetDir'] = (...args) => deps.scopedStudioAssetDir(...args);
  const persistPrivateStudioAsset: StudioApplicationPorts['persistPrivateStudioAsset'] = (...args) => deps.persistPrivateStudioAsset(...args);

  function registerGetTtsCapabilities() {
    studioRouter.get('/tts/capabilities', (_req, res) => {
      res.json({ ok: true, ...studioAudioCapabilities() });
    });
  }

  function registerPostTtsMinimaxDiagnose() {
    studioRouter.post('/tts/minimax/diagnose', async (_req, res) => {
      const configured = Boolean((process.env.MINIMAX_API_KEY || process.env.MINIMAX_API_TOKEN || '').trim());
      if (!configured) {
        res.status(503).json({ ok: false, configured: false, error: 'MINIMAX_API_KEY 未配置。' });
        return;
      }
      const startedAt = Date.now();
      try {
        const result = await minimaxFetchJson('/v1/get_voice', { voice_type: 'all' }, 20_000);
        const clonedVoices = Array.isArray(result?.voice_cloning) ? result.voice_cloning.length : 0;
        res.json({
          ok: true,
          configured: true,
          latencyMs: Date.now() - startedAt,
          model: process.env.MINIMAX_TTS_MODEL || 'speech-2.8-hd',
          clonedVoices,
          message: `MiniMax Key 与网络正常，当前账号可查询到 ${clonedVoices} 个已激活克隆音色。`,
        });
      } catch (error) {
        rememberRejectedMinimaxCredential(error);
        res.status(502).json({
          ok: false,
          configured: true,
          latencyMs: Date.now() - startedAt,
          error: String(error instanceof Error ? error.message : error).slice(0, 300),
        });
      }
    });
  }

  function registerPostTts() {
    studioRouter.post('/tts', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      if (!await consumeDemoQuota(req, res, 'generation')) return;
      const { script = '', text = '', voice = 'v1', language = 'zh', style = {}, sentenceLines, measuredSentenceTiming } = req.body ?? {};
      const spoken = (text || spokenText(script)).trim();
      if (!spoken) { res.status(400).json({ ok: false, error: 'no spoken text' }); return; }

      try {
        if ((!['zh', 'ja'].includes(normalizeTtsLanguage(language)) && /[\u4e00-\u9fff]/.test(spoken)) || !spokenLanguageMatches(spoken, language)) { res.status(400).json({ ok: false, error: '口播与目标语言不一致，请先修改脚本；配音不会自动翻译。' }); return; }
        const output = await synthesizeStudioVoiceForAutomation({ tenantId, text: spoken, voice, language, style: normalizeTtsStyle(style), sentenceLines, measuredSentenceTiming: measuredSentenceTiming === true });
        const payload = JSON.stringify(output);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Length', Buffer.byteLength(payload));
        res.end(payload);
      } catch (e: any) {
        console.error('[studio] TTS request failed:', e);
        res.json({ ok: false, source: 'fallback', error: String(e?.message ?? e).slice(0, 200) });
      }
    });
  }

  function registerStudioAsrRouter() {
    studioRouter.use('/tts', createStudioAsrRouter(url => localTtsFile(url), ffmpegStatic));
  }

  function registerPostTtsAlign() {
    studioRouter.post('/tts/align', async (req, res) => {
      const text = String(req.body?.text || '').trim();
      const url = String(req.body?.url || '').trim();
      const duration = Math.max(0.2, Math.min(180, Number(req.body?.duration) || 0));
      if (!text || (!url.startsWith('/tts/') && !url.includes('/private-assets/tts/')) || !duration) {
        res.status(400).json({ ok: false, error: 'text, local tts url and duration required', cues: [] });
        return;
      }
      const fallback = { cues: proportionalCues(text, duration), source: 'proportional' as const };
      try {
        const aligned = await Promise.race([
          alignTtsAudio(text, url, duration),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('alignment timeout')), 45_000)),
        ]);
        res.json({ ok: true, ...aligned });
      } catch (error) {
        console.warn('[studio] TTS alignment request fallback:', error instanceof Error ? error.message : error);
        res.status(422).json({ ok: false, error: error instanceof Error ? error.message : '音频对齐失败', cues: [] });
      }
    });
  }

  function registerPostTtsTranscribe() {
    studioRouter.post('/tts/transcribe', async (req, res) => {
      const url = String(req.body?.url || '').trim();
      const duration = Math.max(0.2, Math.min(180, Number(req.body?.duration) || 0));
      const language = String(req.body?.language || 'auto').trim();
      const transcriptHint = String(req.body?.transcriptHint || '').trim().slice(0, 6000);
      const media = localTtsFile(url);
      if (!media || !duration) {
        res.status(400).json({ ok: false, error: 'local audio url and duration required', text: '', cues: [] });
        return;
      }
      const qwenConfigured = Boolean(process.env.DASHSCOPE_API_KEY?.trim());
      if (!qwenConfigured) {
        if (transcriptHint) {
          res.status(503).json({ ok: false, text: transcriptHint, cues: [], error: '音频对齐服务不可用，请重新生成配音' });
        } else {
          res.status(503).json({ ok: false, error: 'DASHSCOPE_API_KEY not set; uploaded audio cannot be transcribed', text: '', cues: [] });
        }
        return;
      }
      try {
        void language;
        const parsed = await transcribeAudioWithQwen({ audio: media.bytes, fileName: `voice${media.mimeType === 'audio/mpeg' ? '.mp3' : '.wav'}` });
        const text = String(parsed.text || transcriptHint || '').trim();
        if (!text) throw new Error('audio transcription returned no text');
        const aligned = await alignTtsAudio(text, url, duration);
        res.json({ ok: true, text, cues: aligned.cues, source: 'audio_ai' });
      } catch (error) {
        if (transcriptHint) {
          res.status(422).json({ ok: false, text: transcriptHint, cues: [], error: String(error instanceof Error ? error.message : error).slice(0, 240) });
        } else {
          res.status(502).json({ ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 240), text: '', cues: [] });
        }
      }
    });
  }

  function registerPostTtsBatch() {
    studioRouter.post('/tts/batch', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      if (!await consumeDemoQuota(req, res, 'generation')) return;
      const { voice = 'v1', items = [], style = {} } = req.body ?? {};
      const input = Array.isArray(items) ? items.slice(0, 8) : [];
      if (input.length === 0) { res.status(400).json({ ok: false, error: 'items required', audios: {} }); return; }

      const audios: Record<string, Awaited<ReturnType<typeof synthesizeStudioVoiceForAutomation>>> = {};
      for (const item of input) {
        const code = String(item?.code || item?.language || '').trim() || 'zh';
        const language = String(item?.language || code).trim() || code;
        const spoken = String(item?.text || '').trim();
        if (!spoken) {
          audios[code] = { ok: false, source: 'empty', error: 'no spoken text' };
          continue;
        }
        try {
          if (!spokenLanguageMatches(spoken, language)) throw Error('口播与目标语言不一致，请先修改脚本');
          audios[code] = await synthesizeStudioVoiceForAutomation({ tenantId, text: spoken, voice, language, style: normalizeTtsStyle(style),
            sentenceLines: item?.sentenceLines, measuredSentenceTiming: item?.measuredSentenceTiming === true });
        } catch (error) {
          audios[code] = {
            ok: false,
            source: 'language_repair_failed',
            error: String(error instanceof Error ? error.message : error).slice(0, 240),
          };
        }
      }
      res.json({ ok: Object.values(audios).some(item => item.ok && item.url), audios });
    });
  }

  function registerPostVoiceover() {
    studioRouter.post('/voiceover', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const { name = 'voiceover.wav', dataBase64, mimeType, duration = 0 } = req.body ?? {};
      if (!dataBase64) { res.status(400).json({ ok: false, error: 'dataBase64 required' }); return; }
      try { fs.mkdirSync(scopedStudioAssetDir(TTS_ROOT), { recursive: true }); } catch { /* ignore */ }
      try {
        const extFromMime = (mimeType as string | undefined)?.split('/')[1]?.replace('mpeg', 'mp3').replace('x-wav', 'wav');
        const extFromName = String(name).split('.').pop();
        const ext = (extFromMime || extFromName || 'wav').replace(/[^\w]+/g, '').slice(0, 8) || 'wav';
        const file = `${randomUUID()}.${ext}`;
        const buf = Buffer.from(String(dataBase64).replace(/^data:[^,]+,/, ''), 'base64');
        const filePath = path.join(scopedStudioAssetDir(TTS_ROOT), file);
        fs.writeFileSync(filePath, buf);
        res.json({ ok: true, url: await persistPrivateStudioAsset('tts', tenantId, filePath, String(mimeType || '')), duration: Number(duration) || 0 });
      } catch (e: any) {
        res.status(500).json({ ok: false, error: String(e?.message || e).slice(0, 200) });
      }
    });
  }

  return { registerGetTtsCapabilities, registerPostTtsMinimaxDiagnose, registerPostTts, registerStudioAsrRouter, registerPostTtsAlign, registerPostTtsTranscribe, registerPostTtsBatch, registerPostVoiceover };
}
