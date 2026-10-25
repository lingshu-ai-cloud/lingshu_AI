import { socialLocalMediaHash, stableSocialMediaInput } from './socialMediaInputIdentity.js';
import { stat } from 'node:fs/promises';
import { readCurrentContentExecutionCheckpoint, recordCurrentContentExecutionCheckpoint } from '../contentExecution/context.js';
import { socialObject, socialRequestHash } from './socialContentValidation.js';
import type { probeSocialSceneMedia, SocialSceneMediaHardProbe } from './socialSceneMediaHardProbe.js';
import {socialCaptionRendererFontIdentity} from './socialCaptionRendererFonts.js';

type ProbeInput = Parameters<typeof probeSocialSceneMedia>[0];
type Scope = { tenantId: string; taskId: string; runId: string };
type Checkpoint = { scope: Scope; inputHash: string; resultHash: string; result: SocialSceneMediaHardProbe };
const STAGE = 'social.scene_media_hard_probe';
export const SOCIAL_MEDIA_PROBE_CACHE_POLICY = 'scene-media-hard-probe-cache.v5';

async function localHash(file: string): Promise<string | null> {
  if (!file || /^[a-z][a-z0-9+.-]*:/i.test(file)) return null;
  try {
    if (!(await stat(file)).isFile()) return null;
    return await socialLocalMediaHash(file);
  } catch { return null; }
}
async function fingerprint(input: ProbeInput, scope: Scope, policyVersion: string) {
  const voice = socialObject(input.manifest.voiceover), voicePath = typeof voice?.url === 'string' ? voice.url : '';
  const mask = input.captionMaskSources;
  // Remote/missing inputs cannot prove immutable bytes. Do the original probe,
  // retaining its unknown/failure semantics, rather than caching that evidence.
  if (!voicePath || !mask) return null;
  const fonts=socialCaptionRendererFontIdentity();if(!fonts)return null;
  const [mediaSha256, voiceSha256, baselineSha256, assSha256] = await Promise.all([
    localHash(input.filePath), localHash(voicePath), localHash(mask.baselinePath), localHash(mask.assPath),
  ]);
  if (!mediaSha256 || !voiceSha256 || !baselineSha256 || !assSha256
    || baselineSha256 !== mask.baselineSha256 || assSha256 !== mask.assSha256) return null;
  return { mediaSha256, voiceSha256, inputHash: socialRequestHash({ policyVersion, scope,
    mediaSha256, manifest: await stableSocialMediaInput({ ...input.manifest, voiceover: { ...voice, url: { mediaSha256: voiceSha256 } } }), frozenVoiceCues: input.frozenVoiceCues ?? null,
    subtitleRenderEvidence: input.subtitleRenderEvidence ?? null, frameRenderEvidence: input.frameRenderEvidence ?? null,
    localInputs: { voiceSha256, baselineSha256, assSha256, rendererFontHash:fonts.hash } }) };
}

/** Full measured probe cache. Never turns a failed or unknown report into a pass. */
export async function probeSocialSceneMediaCached(input: ProbeInput, scope: Scope, ports: {
  probe?: typeof probeSocialSceneMedia;
  read?: (key: { stage: string; version: string; inputHash: string }) => Checkpoint | null;
  write?: (key: { stage: string; version: string; inputHash: string; payload: Checkpoint }) => Promise<void>;
  policyVersion?: string;
} = {}): Promise<SocialSceneMediaHardProbe> {
  if (!scope.tenantId || !scope.taskId || !scope.runId) throw Error('social_media_probe_cache_scope_missing');
  const policyVersion = ports.policyVersion || SOCIAL_MEDIA_PROBE_CACHE_POLICY;
  const before = await fingerprint(input, scope, policyVersion);
  const key = before ? { stage: STAGE, version: '1', inputHash: before.inputHash } : null;
  if (before && key) {
    try {
      const cached = (ports.read || readCurrentContentExecutionCheckpoint<Checkpoint>)(key);
      if (cached && socialRequestHash(cached.scope) === socialRequestHash(scope) && cached.inputHash === before.inputHash
        && cached.resultHash === socialRequestHash(cached.result) && cached.result?.version === 'scene-media-hard-probe.v1'
        && cached.result.mediaSha256 === before.mediaSha256 && cached.result.frozenVoiceSha256 === before.voiceSha256)
        return structuredClone(cached.result);
    } catch { /* Invalid cache evidence requires a complete fresh measurement. */ }
  }
  const probe = ports.probe || (await import('./socialSceneMediaHardProbe.js')).probeSocialSceneMedia;
  const result = await probe(input);
  if (!before || !key) return result;
  const after = await fingerprint(input, scope, policyVersion);
  if (!after || after.inputHash !== before.inputHash) throw Error('social_media_probe_inputs_changed');
  if (result.mediaSha256 === before.mediaSha256 && result.frozenVoiceSha256 === before.voiceSha256) {
    await (ports.write || recordCurrentContentExecutionCheckpoint)({ ...key,
      payload: { scope: structuredClone(scope), inputHash: before.inputHash, resultHash: socialRequestHash(result), result: structuredClone(result) } });
  }
  return result;
}
