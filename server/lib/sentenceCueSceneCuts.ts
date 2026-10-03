import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DigitalHumanReferenceCue } from '../../shared/contracts/digitalHumanRequirements.js';

const run = promisify(execFile);

/** Detect strong physical cuts in the source video before any paid cue generation. */
export async function hardSceneCutTimes(ffmpegPath: string, sourcePath: string): Promise<number[]> {
  if (!ffmpegPath || !sourcePath) throw new Error('逐句镜头切点预检缺少本地视频或 FFmpeg');
  let stderr: string;
  try {
    ({ stderr } = await run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'info', '-nostats', '-nostdin', '-i', sourcePath,
      '-map', '0:v:0', '-vf', "select='gt(scene,0.35)',metadata=print", '-an', '-f', 'null', '-',
    ], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }));
  } catch {
    throw new Error('逐句镜头切点预检失败；请检查参考视频，未调用供应商');
  }
  return [...stderr.matchAll(/frame:\d+\s+pts:\s*-?\d+\s+pts_time:(\d+(?:\.\d+)?)/g)]
    .map(match => Number(match[1]))
    .filter(Number.isFinite);
}

export function assertPersonCueShotBoundaries(cues: DigitalHumanReferenceCue[], cuts: number[]): void {
  for (const cue of cues) {
    if (cue.splitFromCueId && (cue.personShot === undefined || (cue.personShot === true && !cue.targetText.trim()))) {
      throw new Error(`拆分镜头 ${cue.id} 须指定镜头类型并为人物镜头填写本片对应语句，未调用供应商`);
    }
    if (cue.personShot === false) continue;
    const cut = cuts.find(time => time > cue.start + 0.05 && time < cue.end - 0.05);
    if (cut !== undefined) {
      throw new Error(`人物逐句镜头 ${cue.id} 在原片 ${cut.toFixed(2)}s 存在硬切；请按物理镜头拆分并分别指定人物或非人物素材，未调用供应商`);
    }
  }
}
