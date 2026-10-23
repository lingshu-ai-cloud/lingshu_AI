import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { consumeDemoQuota } from '../lib/demo.js';
import { type AuthLocals } from '../middleware/auth.js';
import { objectStorageEnabled } from '../storage/objectStorage.js';
import { VOICE_SAMPLES_ROOT } from '../studio/runtimeConfig.js';
import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioVoiceSampleRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter' | 'readVoiceSampleIndex' | 'privateStudioAssetUrl' | 'scopedStudioAssetUrl' | 'scopedStudioAssetDir' | 'persistPrivateStudioAsset' | 'voiceSamplePathFromId' | 'readMinimaxVoiceCache' | 'minimaxFetchJson' | 'writeMinimaxVoiceCache' | 'writeVoiceSampleIndex' | 'studioAudioCapabilities'>) {
  const studioRouter = deps.studioRouter;
  const readVoiceSampleIndex: StudioApplicationPorts['readVoiceSampleIndex'] = (...args) => deps.readVoiceSampleIndex(...args);
  const privateStudioAssetUrl: StudioApplicationPorts['privateStudioAssetUrl'] = (...args) => deps.privateStudioAssetUrl(...args);
  const scopedStudioAssetUrl: StudioApplicationPorts['scopedStudioAssetUrl'] = (...args) => deps.scopedStudioAssetUrl(...args);
  const scopedStudioAssetDir: StudioApplicationPorts['scopedStudioAssetDir'] = (...args) => deps.scopedStudioAssetDir(...args);
  const persistPrivateStudioAsset: StudioApplicationPorts['persistPrivateStudioAsset'] = (...args) => deps.persistPrivateStudioAsset(...args);
  const voiceSamplePathFromId: StudioApplicationPorts['voiceSamplePathFromId'] = (...args) => deps.voiceSamplePathFromId(...args);
  const readMinimaxVoiceCache: StudioApplicationPorts['readMinimaxVoiceCache'] = (...args) => deps.readMinimaxVoiceCache(...args);
  const minimaxFetchJson: StudioApplicationPorts['minimaxFetchJson'] = (...args) => deps.minimaxFetchJson(...args);
  const writeMinimaxVoiceCache: StudioApplicationPorts['writeMinimaxVoiceCache'] = (...args) => deps.writeMinimaxVoiceCache(...args);
  const writeVoiceSampleIndex: StudioApplicationPorts['writeVoiceSampleIndex'] = (...args) => deps.writeVoiceSampleIndex(...args);
  const studioAudioCapabilities: StudioApplicationPorts['studioAudioCapabilities'] = (...args) => deps.studioAudioCapabilities(...args);

  function registerGetVoiceSamples() {
    studioRouter.get('/voice-samples', (_req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const items = readVoiceSampleIndex().map(item => ({
        ...item,
        url: objectStorageEnabled() ? privateStudioAssetUrl('voice-samples', tenantId, item.file) : scopedStudioAssetUrl('voice-samples', item.file),
      })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      res.json(items);
    });
  }

  function registerPostVoiceSamples() {
    studioRouter.post('/voice-samples', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      if (!await consumeDemoQuota(req, res, 'generation')) return;
      const { name = 'voice-sample.wav', dataBase64, mimeType, duration = 0, replacesVoiceId = '' } = req.body ?? {};
      if (!dataBase64) { res.status(400).json({ ok: false, error: 'dataBase64 required' }); return; }
      try {
        fs.mkdirSync(scopedStudioAssetDir(VOICE_SAMPLES_ROOT), { recursive: true });
        const match = String(dataBase64).match(/^data:([^;]+);base64,(.+)$/);
        const b64 = match ? match[2] : String(dataBase64);
        const type = String(mimeType || match?.[1] || '').toLowerCase();
        const ext = type.includes('mpeg') || type.includes('mp3') ? 'mp3'
          : type.includes('m4a') || type.includes('mp4') ? 'm4a'
            : 'wav';
        if (!['mp3', 'm4a', 'wav'].includes(ext) || /ogg|webm/i.test(type)) {
          res.status(400).json({ ok: false, error: '真人音色样本仅支持 mp3、m4a、wav。' });
          return;
        }
        const seconds = Number(duration) || 0;
        if (seconds > 0 && seconds < 10) {
          res.status(400).json({ ok: false, error: '真人音色样本需要至少 10 秒清晰人声。' });
          return;
        }
        const bytes = Buffer.from(b64, 'base64');
        if (bytes.length < 1024 || bytes.length > 20 * 1024 * 1024) {
          res.status(400).json({ ok: false, error: '真人音色样本文件需在 1KB 到 20MB 之间。' });
          return;
        }
        const id = randomUUID();
        const file = `${id}.${ext}`;
        const samplePath = path.join(scopedStudioAssetDir(VOICE_SAMPLES_ROOT), file);
        fs.writeFileSync(samplePath, bytes);
        const storedUrl = await persistPrivateStudioAsset('voice-samples', tenantId, samplePath, type);
        const replacedId = String(replacesVoiceId || '');
        if (replacedId.startsWith('custom:')) {
          const previousPath = voiceSamplePathFromId(replacedId);
          const cache = readMinimaxVoiceCache();
          const replacedEntries = Object.entries(cache).filter(([key]) => key.startsWith(`${replacedId}:`));
          for (const [key, entry] of replacedEntries) {
            if ((process.env.MINIMAX_API_KEY || process.env.MINIMAX_API_TOKEN) && entry.voiceId) {
              await minimaxFetchJson('/v1/delete_voice', { voice_type: 'voice_cloning', voice_id: entry.voiceId }, 30_000).catch(() => null);
            }
            delete cache[key];
          }
          writeMinimaxVoiceCache(cache);
          if (previousPath && previousPath !== path.join(scopedStudioAssetDir(VOICE_SAMPLES_ROOT), file)) {
            try { fs.unlinkSync(previousPath); } catch { /* replacement already succeeded; stale sample cleanup is best effort */ }
          }
        }
        const voiceId = `custom:${id}`;
        const voiceName = String(name || '真人音色').replace(/\.[^.]+$/, '');
        const index = readVoiceSampleIndex().filter(item => item.voiceId !== replacedId);
        index.push({ voiceId, name: voiceName, file, duration: seconds, createdAt: new Date().toISOString() });
        writeVoiceSampleIndex(index);
        const capabilities = studioAudioCapabilities();
        res.json({
          ok: true,
          id,
          voiceId,
          name: voiceName,
          url: storedUrl,
          duration: seconds,
          synthesisReady: capabilities.customVoice.synthesis,
          engine: capabilities.customVoice.engines.minimax ? 'minimax' : capabilities.customVoice.engines.xtts ? 'xtts' : undefined,
          warning: capabilities.customVoice.synthesis ? undefined : capabilities.customVoice.message,
        });
      } catch (e: any) {
        res.status(500).json({ ok: false, error: String(e?.message ?? e).slice(0, 300) });
      }
    });
  }

  return { registerGetVoiceSamples, registerPostVoiceSamples };
}
