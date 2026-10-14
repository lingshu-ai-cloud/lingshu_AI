import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';

const run = promisify(execFile);

export interface PresenterVideoInfo { duration: number; width: number; height: number; fps: number; hasAudio: boolean }

/** Read enough metadata to reject unsuitable paid Digital Twin uploads before supplier submission. */
export async function inspectPresenterVideo(bytes: Buffer): Promise<PresenterVideoInfo> {
  if (!ffmpegStatic) throw new Error('本地视频检查组件不可用');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lingshu-presenter-inspect-'));
  const input = path.join(dir, 'source');
  try {
    await fs.writeFile(input, bytes);
    const { stderr } = await run(String(ffmpegStatic), ['-hide_banner', '-i', input, '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-'], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    const videoLine = stderr.split('\n').find(line => /Video:/.test(line)) || '';
    const sizeMatch = videoLine.match(/(?:^|[ ,])(\d{2,5})x(\d{2,5})(?:[ ,]|$)/);
    const fpsMatch = videoLine.match(/(\d+(?:\.\d+)?)\s*fps\b/);
    const duration = durationMatch ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]) : 0;
    const result = { duration, width: Number(sizeMatch?.[1] || 0), height: Number(sizeMatch?.[2] || 0), fps: Number(fpsMatch?.[1] || 0), hasAudio: /Audio:/.test(stderr) };
    if (!(result.duration > 0) || !result.width || !result.height) throw new Error('无法读取视频时长或画面尺寸');
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`无法检查真人训练视频：${detail}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Normalize a training sample to a short MP4 while retaining its spoken audio. */
export async function trimPresenterVideo(bytes: Buffer, seconds = 7): Promise<Buffer> {
  if (!ffmpegStatic) throw new Error('本地视频裁剪组件不可用');
  const duration = Math.max(1, Math.min(7, Number(seconds) || 7));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lingshu-presenter-'));
  const input = path.join(dir, 'source');
  const output = path.join(dir, 'trimmed.mp4');
  try {
    await fs.writeFile(input, bytes);
    await run(String(ffmpegStatic), [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
      '-t', String(duration), '-map', '0:v:0', '-map', '0:a:0',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output,
    ], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    const result = await fs.readFile(output);
    if (result.length < 12) throw new Error('裁剪后的视频为空');
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`7 秒视频裁剪失败，请确认文件包含清晰画面和说话音轨：${detail}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Extract a clear still from an owned video for the lower-cost photo-avatar path. */
export async function presenterVideoFrame(bytes: Buffer, atSeconds = 1): Promise<Buffer> {
  if (!ffmpegStatic) throw new Error('本地视频取帧组件不可用');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lingshu-presenter-frame-'));
  const input = path.join(dir, 'source');
  const output = path.join(dir, 'frame.jpg');
  try {
    await fs.writeFile(input, bytes);
    await run(String(ffmpegStatic), [
      '-hide_banner', '-loglevel', 'error', '-y', '-ss', String(Math.max(0, atSeconds)), '-i', input,
      '-frames:v', '1', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-q:v', '2', output,
    ], { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
    const result = await fs.readFile(output);
    if (result.length < 12) throw new Error('提取的照片为空');
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`无法从视频提取本人照片：${detail}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export class PresenterAudioPreparationError extends Error {}

/** Normalize browser containers to actual MP3 before declaring the MIME to HeyGen. */
export async function normalizePresenterAudio(bytes: Buffer): Promise<Buffer> {
  if (!ffmpegStatic) throw new PresenterAudioPreparationError('本地录音转换组件不可用，未提交声音克隆');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lingshu-presenter-audio-'));
  try {
    const input = path.join(dir, 'source');
    const output = path.join(dir, 'voice.mp3');
    await fs.writeFile(input, bytes);
    await run(String(ffmpegStatic), ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vn', '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k', output], { timeout: 60_000, maxBuffer: 1024 * 1024 });
    const mp3 = await fs.readFile(output);
    if (mp3.length < 10000 || mp3.length > 10 * 1024 * 1024 || mp3.toString('ascii', 0, 3) !== 'ID3') throw new Error('invalid_audio');
    return mp3;
  } catch {
    throw new PresenterAudioPreparationError('录音无法转换为有效 MP3，未提交声音克隆；请重新录音或上传有效音频');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Keep full training footage and speech, exporting MOV to the supported MP4 container. */
export async function normalizePresenterTrainingVideo(bytes: Buffer): Promise<Buffer> {
  if (!ffmpegStatic) throw new Error('本地视频转换组件不可用，未上传到 HeyGen');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lingshu-presenter-training-'));
  try {
    const input = path.join(dir, 'source');
    const output = path.join(dir, 'training.mp4');
    await fs.writeFile(input, bytes);
    await run(String(ffmpegStatic), ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-maxrate', '3M', '-bufsize', '6M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output], { timeout: 120_000, maxBuffer: 1024 * 1024 });
    return await fs.readFile(output);
  } catch { throw new Error('无法将人物视频转换为 MP4，未上传到 HeyGen；请上传有效的视频'); }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
}
