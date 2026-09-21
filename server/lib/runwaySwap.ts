import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';

const exec = promisify(execFile);
export async function ff(args: string[]) {
  if (!ffmpeg) throw new Error('缺少 FFmpeg 视频处理组件');
  try { return await exec(ffmpeg, ['-hide_banner', '-nostdin', '-y', ...args], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 }); }
  catch { throw new Error('视频无法解码或处理失败，请使用有效 MP4/MOV 文件'); }
}
const input = (file: string) => ['-protocol_whitelist', 'file,pipe', '-f', 'mov', '-i', file];
export async function inspectSwapVideo(file: string) {
  const { stderr } = await ff([...input(file), '-t', '11', '-map', '0:v:0', '-an', '-f', 'null', '-']);
  const t = stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const line = stderr.split('\n').find(s => /Stream .*Video:/.test(s)) || '';
  const size = line.match(/\b(\d{2,5})x(\d{2,5})\b/);
  const duration = t ? +t[1] * 3600 + +t[2] * 60 + +t[3] : 0;
  if (!size || !(duration > 0 && duration <= 10)) throw new Error('案例视频必须大于 0 秒且不超过 10 秒，不会自动截断');
  return { duration, width: +size[1], height: +size[2], hasAudio: /Stream .*Audio:/.test(stderr) };
}
export async function prepareSwapVideo(dir: string) {
  const info = await inspectSwapVideo(path.join(dir, 'source.mp4'));
  // Normalize display rotation, SAR and frame rate; short inputs are tail-padded only for Aleph.
  await ff([...input(path.join(dir, 'source.mp4')), '-map', '0:v:0', '-an', '-vf', "scale=w='min(1080,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=2", '-t', String(Math.max(2, info.duration)), '-c:v', 'libx264', '-crf', '18', '-movflags', '+faststart', path.join(dir, 'input.mp4')]);
  const normalized = await inspectSwapVideo(path.join(dir, 'input.mp4'));
  await ff([...input(path.join(dir, 'input.mp4')), '-frames:v', '1', path.join(dir, 'frame.png')]);
  return { ...normalized, duration: info.duration, hasAudio: info.hasAudio, generationDuration: Math.max(2, info.duration) };
}
export async function finishSwapVideo(dir: string, duration: number) {
  const generated = await inspectSwapVideo(path.join(dir, 'generated.mp4'));
  if (generated.duration + 0.1 < duration) throw new Error('生成视频短于原片，不能作为完成结果');
  const source = await inspectSwapVideo(path.join(dir, 'input.mp4'));
  if (Math.abs(generated.width / generated.height - source.width / source.height) > 0.02) throw new Error('生成画幅与原片不符，请检查候选');
  await ff([...input(path.join(dir, 'generated.mp4')), ...input(path.join(dir, 'source.mp4')), '-map', '0:v:0', '-map', '1:a:0?', '-t', String(duration), '-c:v', 'libx264', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', path.join(dir, 'output.mp4')]);
  const final = await inspectSwapVideo(path.join(dir, 'output.mp4'));
  const original = await inspectSwapVideo(path.join(dir, 'source.mp4'));
  if (Math.abs(final.duration - duration) > 0.1 || final.hasAudio !== original.hasAudio) throw new Error('输出时长或原音轨合成检查未通过');
}
export function imageRatio(width: number, height: number) {
  return ['1024:1024', '1360:768', '1080:1920', '1440:1080', '1080:1440', '1808:768'].sort((a, b) => {
    const ratio = (s: string) => { const [w, h] = s.split(':').map(Number); return Math.abs(Math.log(w / h / (width / height))); };
    return ratio(a) - ratio(b);
  })[0];
}
export class RunwaySwapClient {
  constructor(private key: string, private transport: typeof fetch = fetch) {}
  async call(route: string, body?: unknown): Promise<any> {
    if (!this.key) throw new Error('请配置 RUNWAY_API_KEY');
    const r = await this.transport(`https://api.dev.runwayml.com/v1/${route}`, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(60000), headers: { Authorization: `Bearer ${this.key}`, 'X-Runway-Version': '2024-11-06', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!r.ok) throw new Error(`Runway 请求失败 (${r.status})，请核对账号和原任务`);
    return r.json();
  }
  async upload(file: string, mime: string) {
    const p = await this.call('uploads', { filename: path.basename(file), type: 'ephemeral' });
    if (!String(p.runwayUri || '').startsWith('runway://') || new URL(p.uploadUrl).protocol !== 'https:') throw new Error('Runway 上传响应无效');
    const form = new FormData();
    for (const [k, v] of Object.entries(p.fields || {})) form.append(k, String(v));
    form.append('file', new Blob([new Uint8Array(await fs.readFile(file))], { type: mime }), path.basename(file));
    const r = await this.transport(p.uploadUrl, { method: 'POST', body: form, redirect: 'error', signal: AbortSignal.timeout(120000) });
    if (!r.ok) throw new Error('Runway 素材上传失败');
    return p.runwayUri as string;
  }
  async keyframe(frame: string, person: string, ratio: string) {
    const r = await this.call('text_to_image', { model: 'gen4_image', ratio, promptText: 'Edit @scene: replace the single visible person with the identity, face and hair of @person. Keep the original pose, expression, clothing, framing, camera, background, lighting, products and all other objects unchanged. Photorealistic, same scene.', referenceImages: [{ uri: frame, tag: 'scene' }, { uri: person, tag: 'person' }] });
    if (!r.id) throw new Error('关键帧提交结果未知'); return String(r.id);
  }
  async video(videoUri: string, keyframeUri: string) {
    const r = await this.call('video_to_video', { model: 'aleph2', videoUri, keyframes: [{ uri: keyframeUri, seconds: 0 }], promptText: 'Replace the single person throughout the video with the person shown in the edited keyframe. Maintain their identity consistently. Preserve original composition, camera motion, actions, timing, clothing, background, lighting and products.', outputFormat: 'mp4' });
    if (!r.id) throw new Error('视频提交结果未知'); return String(r.id);
  }
  status(id: string) { return this.call(`tasks/${encodeURIComponent(id)}`); }
}
