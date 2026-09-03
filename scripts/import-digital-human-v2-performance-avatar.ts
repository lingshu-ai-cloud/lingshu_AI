import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ffmpeg = path.join(repoRoot, 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const sourceDir = path.join(repoRoot, 'data', 'digital-human-v2', 'source');
const mediaRoot = path.join(repoRoot, 'data', 'media');
const tenantId = 'local_tenant_admin_admin_local_test';
const relativeMediaDir = `tenants/${tenantId}`;
const mediaDir = path.join(mediaRoot, relativeMediaDir);
const materialsPath = path.join(repoRoot, 'data', 'materials.json');
const preferencesPath = path.join(repoRoot, 'data', 'digital-human-avatar-preferences.json');
const licensePage = 'https://www.pexels.com/license/';

type MotionDefinition = {
  id: string;
  name: string;
  start: number;
  duration: number;
  playbackRate: number;
  gesture: 'open_palm' | 'emphasis' | 'point_right' | 'cta';
  emotion: 'concerned' | 'confident' | 'friendly';
  intensity: number;
  performanceClasses: Array<'opening' | 'explanation' | 'emphasis' | 'pointing' | 'closing'>;
};

type AvatarProfile = {
  key: '6548010' | '8048481';
  avatarId: string;
  avatarName: string;
  sourceFile: string;
  sourcePage: string;
  directDownload: string;
  duration: number;
  motions: MotionDefinition[];
};

const profiles: Record<AvatarProfile['key'], AvatarProfile> = {
  '6548010': {
    key: '6548010',
    avatarId: 'avatar-pexels-6548010-v1',
    avatarName: '亚洲男性人物IP·连续表演母片',
    sourceFile: 'pexels-6548010-uhd.mp4',
    sourcePage: 'https://www.pexels.com/video/a-man-talking-while-looking-at-the-camera-6548010/',
    directDownload: 'https://videos.pexels.com/video-files/6548010/6548010-uhd_2160_3840_24fps.mp4',
    duration: 10.01,
    motions: [
      { id: 'motion-pexels-6548010-opening-v2', name: '亚洲男性人物IP·开场提问', start: 0, duration: 3.2, playbackRate: 0.8, gesture: 'open_palm', emotion: 'concerned', intensity: 0.56, performanceClasses: ['opening'] },
      { id: 'motion-pexels-6548010-explain-v2', name: '亚洲男性人物IP·讲解与强调', start: 3.2, duration: 3.4, playbackRate: 0.8, gesture: 'emphasis', emotion: 'confident', intensity: 0.66, performanceClasses: ['explanation', 'emphasis'] },
      { id: 'motion-pexels-6548010-close-v2', name: '亚洲男性人物IP·指向收尾', start: 6.6, duration: 3.4, playbackRate: 0.8, gesture: 'point_right', emotion: 'friendly', intensity: 0.7, performanceClasses: ['pointing', 'closing'] },
    ],
  },
  '8048481': {
    key: '8048481',
    avatarId: 'avatar-pexels-8048481-v1',
    avatarName: '亚洲男性人物IP·自然讲解母片',
    sourceFile: 'pexels-8048481-hd.mp4',
    sourcePage: 'https://www.pexels.com/video/close-up-footage-of-a-man-talking-8048481/',
    directDownload: 'https://videos.pexels.com/video-files/8048481/8048481-hd_1080_1920_25fps.mp4',
    duration: 12.08,
    motions: [
      { id: 'motion-pexels-8048481-opening-v2', name: '亚洲男性人物IP·开场提问', start: 0, duration: 3.84, playbackRate: 0.96, gesture: 'open_palm', emotion: 'concerned', intensity: 0.48, performanceClasses: ['opening'] },
      { id: 'motion-pexels-8048481-explain-v2', name: '亚洲男性人物IP·讲解与强调', start: 3.84, duration: 4.12, playbackRate: 0.96, gesture: 'emphasis', emotion: 'confident', intensity: 0.6, performanceClasses: ['explanation', 'emphasis'] },
      { id: 'motion-pexels-8048481-close-v2', name: '亚洲男性人物IP·指向微笑收尾', start: 7.96, duration: 4.12, playbackRate: 0.96, gesture: 'point_right', emotion: 'friendly', intensity: 0.64, performanceClasses: ['pointing', 'closing'] },
    ],
  },
};

const requestedProfile = String(process.argv.find(argument => argument.startsWith('--avatar='))?.split('=', 2)[1] || '6548010') as AvatarProfile['key'];
const profile = profiles[requestedProfile];
if (!profile) throw new Error(`Unknown avatar profile: ${requestedProfile}. Expected ${Object.keys(profiles).join(' or ')}`);
const { avatarId, avatarName, sourcePage, directDownload } = profile;
const source = path.join(sourceDir, profile.sourceFile);

function runFfmpeg(args: string[]) {
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}

async function ensureSource() {
  if (fs.existsSync(source) && fs.statSync(source).size > 1_000_000) return;
  fs.mkdirSync(sourceDir, { recursive: true });
  const response = await fetch(directDownload, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Pexels source download failed (${response.status})`);
  const temporary = `${source}.download`;
  fs.writeFileSync(temporary, Buffer.from(await response.arrayBuffer()));
  if (fs.statSync(temporary).size < 1_000_000) throw new Error('Downloaded avatar source is unexpectedly small');
  fs.renameSync(temporary, source);
}

function sha256(file: string) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sizeLabel(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

function renderClip(id: string, start?: number, duration?: number, playbackRate = 1) {
  const videoPath = path.join(mediaDir, `${id}.mp4`);
  const posterPath = path.join(mediaDir, `${id}.poster.jpg`);
  const trim = start === undefined ? [] : ['-ss', String(start), '-t', String(duration)];
  runFfmpeg([
    ...trim, '-i', source, '-map', '0:v:0', '-an',
    '-vf', `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,setpts=PTS/${playbackRate},fps=25`,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoPath,
  ]);
  runFfmpeg(['-ss', '1', '-i', videoPath, '-frames:v', '1', '-q:v', '2', posterPath]);
  return { videoPath, posterPath };
}

function baseRecord(id: string, name: string, videoPath: string, posterPath: string, duration: number) {
  const sourceHash = sha256(videoPath);
  return {
    id, name, folder: 'presenter', type: 'video', duration, width: 1080, height: 1920, aspectRatio: 0.5625,
    size: sizeLabel(fs.statSync(videoPath).size),
    file: `${relativeMediaDir}/${path.basename(videoPath)}`,
    url: `/media/${relativeMediaDir}/${path.basename(videoPath)}`,
    poster: `/media/${relativeMediaDir}/${path.basename(posterPath)}`,
    scope: 'own', tenantId, usage: 'editable', sourceType: 'licensed-stock-internal-demo', sourceUrl: sourcePage,
    rightsStatus: 'commercial_cleared', rightsUsageScope: ['internal_preview'], rightsSourceUrl: licensePage,
    rightsNotice: '仅限内部技术样片；画面须显示“AI生成·非真人代言”，不得暗示模特为项目或品牌背书。客户交付前必须替换为企业持有完整数字化改编授权的人物IP。',
    sourceHash, avatarId, avatarVersion: 1, productionReady: true, createdAt: new Date().toISOString(),
  };
}

await ensureSource();
if (!fs.existsSync(ffmpeg)) throw new Error(`ffmpeg-static not found: ${ffmpeg}`);
fs.mkdirSync(mediaDir, { recursive: true });

const masterFiles = renderClip(avatarId);
const originSourceHash = sha256(source);
const records: Array<Record<string, unknown>> = [{
  ...baseRecord(avatarId, avatarName, masterFiles.videoPath, masterFiles.posterPath, profile.duration),
  assetRole: 'avatar_master',
}];

for (const motion of profile.motions) {
  const files = renderClip(motion.id, motion.start, motion.duration, motion.playbackRate);
  const renderedDuration = motion.duration / motion.playbackRate;
  const record = baseRecord(motion.id, motion.name, files.videoPath, files.posterPath, renderedDuration);
  records.push({
    ...record,
    assetRole: 'avatar_motion_clip',
    motionClip: {
      id: `${avatarId}-${motion.id.split('-').at(-2)}-v2`, version: 2, safeStartMs: 0, safeEndMs: Math.round(motion.duration * 1000),
      sourceHash: record.sourceHash, gaze: 'camera', rightsStatus: 'commercial_cleared', avatarId,
      gesture: motion.gesture, intensity: motion.intensity, emotion: motion.emotion, materialId: motion.id, shotSize: 'medium',
      originSourceHash, originStartMs: Math.round(motion.start * 1000), originEndMs: Math.round((motion.start + motion.duration) * 1000),
      performanceClasses: motion.performanceClasses,
    },
  });
}

const existing = JSON.parse(fs.readFileSync(materialsPath, 'utf8')) as Array<Record<string, unknown>>;
const recordIds = new Set(records.map(item => String(item.id)));
const nextMaterials = existing
  .filter(item => !recordIds.has(String(item.id)) && !(item.assetRole === 'avatar_motion_clip' && item.avatarId === avatarId))
  .map(item => item.sourceType === 'ai-generated-synthetic-avatar'
    ? { ...item, productionReady: false, qualityHoldReason: '静态姿势缩放素材，未通过V2连续动作门禁' }
    : item)
  .concat(records);
fs.writeFileSync(materialsPath, `${JSON.stringify(nextMaterials, null, 2)}\n`, 'utf8');

const preferences = fs.existsSync(preferencesPath) ? JSON.parse(fs.readFileSync(preferencesPath, 'utf8')) as Record<string, unknown> : {};
preferences[tenantId] = { preferredAvatarMaterialId: avatarId, updatedAt: new Date().toISOString() };
fs.writeFileSync(preferencesPath, `${JSON.stringify(preferences, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({ avatarId, motionIds: profile.motions.map(item => item.id), sourcePage, licensePage }, null, 2));
