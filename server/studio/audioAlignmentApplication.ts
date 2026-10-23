import { withStudioVoicePaidContext, type StudioVoicePaidContext } from '../lib/studioVoicePaidOperation.js';
import { wavDurationFromBytes } from '../lib/wavDuration';
import { type AlignedCue } from '../routes/studioTtsProviderRuntime.js';
import { alignQwenFile } from '../integrations/qwenAlignment.js';
import fs from 'fs';
import path from 'path';
import { createHash } from 'node:crypto';
import { tenantAssetDir } from '../lib/assetAccess.js';
import { objectStorageEnabled, objectStorageSignedGetUrl } from '../storage/objectStorage.js';
import { tenantPrivateObjectKey } from '../storage/materialAssets.js';
import { TTS_ROOT } from './runtimeConfig.js';
import type { StudioApplicationPorts } from './applicationPorts.js';

export function createAudioAlignmentApplication(deps: Pick<StudioApplicationPorts, 'localTtsFile' | 'studioTenantContext' | 'persistPrivateStudioAsset'>) {
  const localTtsFile: StudioApplicationPorts['localTtsFile'] = (...args) => deps.localTtsFile(...args);
  const studioTenantContext = deps.studioTenantContext;
  const persistPrivateStudioAsset: StudioApplicationPorts['persistPrivateStudioAsset'] = (...args) => deps.persistPrivateStudioAsset(...args);

  async function alignTtsAudio(transcript: string, url: string | undefined, duration: number): Promise<{ cues: AlignedCue[]; source: 'audio_ai' }> {
    if (!url || !localTtsFile(url)) throw Error('找不到当前企业的配音文件');
    const tenantId = studioTenantContext.getStore()!;
    const file = path.join(tenantAssetDir(TTS_ROOT, tenantId), path.basename(new URL(url, 'http://local').pathname));
    try {
      const cached = JSON.parse(fs.readFileSync(file + '.alignment.json', 'utf8'));
      if (cached.text === transcript && cached.source === 'audio_ai' && cached.cues?.length) return { cues: cached.cues, source: 'audio_ai' };
    } catch {}
    if (!objectStorageEnabled()) throw Error('该音频需要真实对齐。请重新生成句级配音，或配置私有对象存储后使用千问音频对齐');
    await persistPrivateStudioAsset('tts', tenantId, file);
    const signed = await objectStorageSignedGetUrl(tenantPrivateObjectKey('tts', tenantId, path.basename(file)), 15 * 60);
    return { cues: await alignQwenFile(signed, transcript, duration, file + '.asr.json', {audioSha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')}), source: 'audio_ai' };
  }

  async function alignStudioVoiceForAutomation(input: { tenantId: string; text: string; url: string; duration: number;paidContext?:StudioVoicePaidContext;
    preparedTrack?:{scope:import('../lib/socialContentTaskBudget.js').SocialTaskBudgetScope;receiptRef:string;filePath:string;audioSha256:string} }) {
    return withStudioVoicePaidContext(input.paidContext,()=>studioTenantContext.run(input.tenantId, async () => {
      if(!input.preparedTrack)return alignTtsAudio(input.text,input.url,input.duration);
      const track=input.preparedTrack,hash=(v:string)=>createHash('sha256').update(v).digest('hex');
      const root=path.resolve('data/social-content-whole-voice',hash(input.tenantId),hash(track.scope.taskId),hash(track.scope.runId));
      const receipt=path.resolve(track.receiptRef),file=path.resolve(track.filePath);
      if(!input.paidContext||track.scope.tenantId!==input.tenantId||path.dirname(receipt)!==root||path.dirname(file)!==root||path.extname(file)!=='.wav')throw Error('prepared_alignment_server_scope_invalid');
      const row=JSON.parse(fs.readFileSync(receipt,'utf8'));
      if(JSON.stringify(row.scope)!==JSON.stringify(track.scope)||row.voice?.localPath!==file||row.wholeTrackSha256!==track.audioSha256||row.voice?.duration!==input.duration)throw Error('prepared_alignment_receipt_changed');
      const bytes=fs.readFileSync(file);
      if(createHash('sha256').update(bytes).digest('hex')!==track.audioSha256||Math.abs(wavDurationFromBytes(bytes)-input.duration)>.02)throw Error('prepared_alignment_bytes_changed');
      if(row.scenes.map((scene:{spokenText:string})=>scene.spokenText).filter(Boolean).join(' ').replace(/\s+/g,'')!==input.text.replace(/\s+/g,''))throw Error('prepared_alignment_text_changed');
      if(!objectStorageEnabled())throw Error('prepared_alignment_private_storage_missing');
      await persistPrivateStudioAsset('tts',input.tenantId,file);
      const signed=await objectStorageSignedGetUrl(tenantPrivateObjectKey('tts',input.tenantId,path.basename(file)),15*60);
      return {cues:await alignQwenFile(signed,input.text,input.duration,file+'.asr.json',{audioSha256:track.audioSha256,localFilePath:file}),source:'audio_ai' as const};
    }));
  }

  return { alignTtsAudio, alignStudioVoiceForAutomation };
}
