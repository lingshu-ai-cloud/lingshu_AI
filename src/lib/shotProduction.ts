export type AppearancePreference = 'auto' | 'avatar' | 'real' | 'none';
export type ShotSource = 'material' | 'avatar' | 'ai' | 'shoot';
export type ShotSound = 'voiceover' | 'source' | 'silent';
export type ShotLayout = 'full' | 'split' | 'pip';
export type AvatarProductionMode = 'presenter' | 'cinematic' | 'overlay';
export type AvatarCameraMovement = 'fixed' | 'push_in' | 'pull_out' | 'pan_left' | 'pan_right' | 'handheld' | 'tracking' | 'orbit' | 'crane';
export type AvatarPerformancePreset = 'natural' | 'professional' | 'warm' | 'surprise_marketing';
export const AVATAR_PERFORMANCE_PRESETS: Record<AvatarPerformancePreset, { label: string; description: string; intensity: number }> = {
  natural: { label: '自然讲解', description: '动作少，稳定说明', intensity: 0.45 },
  professional: { label: '专业推荐', description: '稳定、自信、有说服力', intensity: 0.6 },
  warm: { label: '营销种草', description: '微笑并用手势强调卖点', intensity: 0.75 },
  surprise_marketing: { label: '强惊喜感', description: '明显反应，控制嘴型并保持本人特征', intensity: 0.7 },
};
export interface PresenterAsset { id: string; name: string; avatarId: string; voiceId: string; authorized: boolean; supportsAlpha: boolean; nativeOrientation?: 'unknown' | 'portrait' | 'landscape' | 'square'; imageUrl?: string; videoUrl?: string; creationMode?: 'quick' | 'expert' }
export interface ProductionDefaults { preference: AppearancePreference; presenters: PresenterAsset[]; defaultPresenterId: string }
export interface ShotCandidate { id: string; materialId: string; fingerprint: string; createdAt: string; source: ShotSource; jobId?: string }
export interface ShotProduction {
  source: ShotSource; sound: ShotSound; layout: ShotLayout; presenterId: string;
  productId: string; productMaterialId: string; backgroundMaterialId: string; backgroundMode: 'independent' | 'baked';
  transparent: boolean; narration: string; locked: boolean; factsConfirmed: boolean;
  avatarMode: AvatarProductionMode; cameraMovement: AvatarCameraMovement;
  expression: string; gesture: string; gaze: string; sceneDescription: string;
  performancePreset?: AvatarPerformancePreset; emotionIntensity?: number; motionPrompt?: string;
  candidates: ShotCandidate[]; adoptedId: string; revision: number;
}
export const EMPTY_DEFAULTS: ProductionDefaults = { preference: 'auto', presenters: [], defaultPresenterId: '' };
export const newShotProduction = (narration = '', presenterId = ''): ShotProduction => ({
  source: 'material', sound: 'voiceover', layout: 'full', presenterId, productId: '', productMaterialId: '', backgroundMaterialId: '',
  backgroundMode: 'independent', transparent: false, narration, locked: false, factsConfirmed: false, candidates: [], adoptedId: '', revision: 1,
  avatarMode: 'presenter', cameraMovement: 'fixed', expression: '自然可信', gesture: '自然讲解', gaze: '看镜头', sceneDescription: '',
  performancePreset: 'natural', emotionIntensity: 0.5, motionPrompt: '',
});

export function avatarMotionPrompt(shot: Pick<ShotProduction, 'performancePreset' | 'emotionIntensity' | 'motionPrompt'>, duration?: number): string {
  if (shot.motionPrompt?.trim()) return shot.motionPrompt.trim().slice(0, 300);
  const intensity = Math.max(0, Math.min(1, Number(shot.emotionIntensity ?? 0.5)));
  const degree = intensity >= 0.75 ? 'clearly' : intensity >= 0.45 ? 'noticeably' : 'subtly';
  const seconds = Math.max(1, Number(duration) || 4);
  const first = Math.max(0.5, Math.round(seconds * 0.25 * 10) / 10);
  const second = Math.max(first + 0.5, Math.round(seconds * 0.75 * 10) / 10);
  const timing = (opening: string, middle: string, ending: string) =>
    `0-${first}s: ${opening} ${first}-${second}s: ${middle} ${second}-${seconds}s: ${ending} Preserve the person's original mouth and teeth shape; no enlarged, extra, or overly white teeth.`.slice(0, 300);
  return ({
    natural: timing(`Begin calmly with ${degree} natural facial movement.`, 'Use steady eye contact and minimal gestures.', 'Finish relaxed.'),
    professional: timing('Begin composed and confident.', `Nod ${degree} with one controlled gesture.`, 'Finish with confident eye contact.'),
    warm: timing('Begin with a warm, natural smile.', `Open one hand and emphasize the benefit ${degree}.`, 'Finish with friendly eye contact.'),
    surprise_marketing: timing('Show controlled surprise; gently raise eyebrows and keep the mouth relaxed.', `Use a natural light smile. Raise one hand ${degree}; never stretch lips or open wide.`, 'Finish confidently with the same facial identity.'),
  } as const)[shot.performancePreset || 'natural'];
}

/** Independent layers don't invalidate an expensive presenter generation. */
export function shotFingerprint(shot: ShotProduction, context: string): string {
  let normalizedContext = context;
  try { const value = JSON.parse(context); if (shot.source !== 'avatar' || shot.sound !== 'voiceover') { delete value.audioIdentity; delete value.audioDuration; delete value.audioSegments; delete value.alignment; delete value.alignmentSource; } normalizedContext = JSON.stringify(value); } catch { /* opaque legacy context */ }
  return JSON.stringify({ source: shot.source, sound: shot.sound, narration: shot.source === 'avatar' || shot.sound === 'source' ? shot.narration : '',
    presenterId: shot.presenterId, productId: shot.productId, transparent: shot.transparent,
    avatarMode: shot.avatarMode || 'presenter', cameraMovement: shot.cameraMovement || 'fixed', expression: shot.expression || '', gesture: shot.gesture || '', gaze: shot.gaze || '', sceneDescription: shot.sceneDescription || '',
    performancePreset: shot.performancePreset || 'natural', emotionIntensity: shot.emotionIntensity ?? 0.5, motionPrompt: avatarMotionPrompt(shot),
    background: shot.backgroundMode === 'baked' ? shot.backgroundMaterialId : '', context: normalizedContext });
}
export function patchShot(current: ShotProduction, patch: Partial<ShotProduction>): ShotProduction {
  if (current.locked && patch.locked !== false) throw new Error('请先解锁镜头');
  const changesFacts = patch.productId !== undefined && patch.productId !== current.productId;
  return { ...current, ...patch, ...(changesFacts ? { factsConfirmed: false } : {}), revision: current.revision + 1 };
}
export function recommendShot(input: { detail: string; preference: AppearancePreference; locked: boolean; hasMaterial: boolean; hasPresenter: boolean }): { source: ShotSource; reason: string } {
  if (input.locked) return { source: 'material', reason: '镜头已锁定，保持当前选择' };
  if (/证书|检测|质检|操作|安装|客户案例|证言|proof|certificate|test report|testimonial/i.test(input.detail)) return input.hasMaterial
    ? { source: 'material', reason: '事实证明镜头优先核验并复用真实素材' } : { source: 'shoot', reason: '缺少事实证据，安排实拍或补充原始资料' };
  if (input.hasMaterial) return { source: 'material', reason: '已有画面可复用，请确认内容与台词匹配' };
  if (input.preference === 'real') return { source: 'shoot', reason: '按真人实拍偏好安排拍摄' };
  if (input.preference === 'none') return { source: 'material', reason: '不出镜，优先选产品原图或实拍' };
  if ((input.preference === 'avatar' || /口播|讲解|解释|FAQ|presenter|talking/i.test(input.detail)) && input.hasPresenter) return { source: 'avatar', reason: '使用授权人物讲解，按确认台词生成新口型' };
  return { source: 'material', reason: '优先补充产品素材；创意场景可手动选择AI生成' };
}
export function shotBlockers(shot: ShotProduction, context: string): string[] {
  const result: string[] = [];
  const candidate = shot.candidates.find(item => item.id === shot.adoptedId);
  if (shot.source === 'avatar' && (!candidate || candidate.source !== 'avatar')) result.push('请生成并采用当前数字人镜头候选，不能将原素材视为已生成数字人');
  if (candidate && candidate.fingerprint !== shotFingerprint(shot, context)) result.push('已采用画面与当前人物/台词/产品要求不一致，请生成或采用匹配候选');
  if (shot.productId && !shot.factsConfirmed) result.push('更换产品后，请核对并确认台词中的产品事实');
  if (shot.layout !== 'full' && !shot.productMaterialId) result.push('分屏或画中画缺少产品素材');
  if (shot.source === 'avatar' && shot.layout === 'pip' && !shot.transparent) result.push('数字人画中画需要去背景的透明人物层；当前可改用全屏普通混剪');
  if (shot.backgroundMaterialId && shot.backgroundMode === 'independent' && !shot.transparent) result.push('人物更换独立背景需要透明人物素材');
  return result;
}

export interface AvatarJob {
  id: string; projectId: string; shotId: string; assemblyId: string; fingerprint: string;
  status: 'submitting' | 'pending' | 'completed' | 'failed' | 'uncertain';
  remoteId?: string; materialId?: string; error?: string; createdAt: string; updatedAt: string;
}

export function avatarCandidateReady(candidate: ShotCandidate, jobs: AvatarJob[]): boolean {
  if (candidate.source !== 'avatar') return true;
  return jobs.some(job => job.id === candidate.jobId && job.status === 'completed' && !job.error
    && job.materialId === candidate.materialId && job.fingerprint === candidate.fingerprint);
}

/** Failed technical checks need a deliberate retry; cap automatic download/decode concurrency. */
export function automaticAvatarRefreshes(jobs: AvatarJob[], projectId: string): AvatarJob[] {
  return jobs.filter(job => job.projectId === projectId && job.status === 'pending' && !job.error)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).slice(0, 3);
}

/** Small, explicit command vocabulary. Never triggers generation, payments or bulk writes. */
export function parseShotCommand(text: string): Partial<ShotProduction> | null {
  const value = text.trim().replace(/[。！!\s]/g, '');
  if (/^(解锁|解锁镜头)$/.test(value)) return { locked: false };
  if (/^(锁定|锁定镜头)$/.test(value)) return { locked: true };
  if (/^(改成|换成|使用|切换到)?(数字人|数字人口播)$/.test(value)) return { source: 'avatar', sound: 'source' };
  if (/^(改成|换成|使用|切换到)?(精准口播|稳定口播)$/.test(value)) return { source: 'avatar', avatarMode: 'presenter', transparent: false };
  if (/^(改成|换成|使用|切换到)?(运镜口播|电影感数字人)$/.test(value)) return { source: 'avatar', avatarMode: 'cinematic', transparent: false };
  if (/^(改成|换成|使用|切换到)?(透明人物|透明人物层)$/.test(value)) return { source: 'avatar', avatarMode: 'overlay', transparent: true };
  if (/^(改成|换成|使用|切换到)?(真人拍摄|安排拍摄|待拍)$/.test(value)) return { source: 'shoot' };
  if (/^(改成|换成|使用|切换到)?(已有素材|选素材)$/.test(value)) return { source: 'material' };
  if (/^(改成|换成|使用|切换到)?(AI画面|AI创意画面)$/i.test(value)) return { source: 'ai' };
  if (/^(改成|换成|使用|切换到)?(画中画|产品主画面人物小窗)$/.test(value)) return { layout: 'pip' };
  if (/^(改成|换成|使用|切换到)?(分屏|人物与产品分屏)$/.test(value)) return { layout: 'split' };
  if (/^(改成|换成|使用|切换到)?(全屏|全屏人物)$/.test(value)) return { layout: 'full' };
  if (/^(改成|换成|使用|切换到)?(连续旁白|旁白)$/.test(value)) return { sound: 'voiceover' };
  if (/^(改成|换成|使用|切换到)?(镜头原声|原声)$/.test(value)) return { sound: 'source' };
  if (/^(改成|换成|使用|切换到)?(无声|静音)$/.test(value)) return { sound: 'silent' };
  const narration = text.trim().match(/^(?:台词改成|台词改为|改台词)[：:]?\s*([\s\S]+)$/);
  return narration ? { narration: narration[1] } : null;
}

export function productionSummary(spec: Record<string, unknown>): string {
  const shots = Object.values((spec.shotProductions || {}) as Record<string, ShotProduction>);
  if (!shots.length) return '';
  const pending = shots.filter(shot => shot.source === 'shoot' && !shot.adoptedId).length;
  const stale = shots.filter(shot => shotBlockers(shot, String(spec.shotProductionContext || '')).length).length;
  const locked = shots.filter(shot => shot.locked).length;
  return [`${shots.length} 个制作镜头`, pending ? `${pending} 个待拍/待核验` : '', stale ? `${stale} 个待更新` : '', locked ? `${locked} 个已锁定` : ''].filter(Boolean).join(' · ');
}
