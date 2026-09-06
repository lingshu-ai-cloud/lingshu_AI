import fs from 'node:fs';
import path from 'node:path';
import { runVisualFfmpeg } from '../lib/renderVisualQuality.js';
export async function finishContent(file: string, spec: Record<string, any>) {
  const audio = await runVisualFfmpeg(['-loglevel','info','-i',file,'-vn','-af','volumedetect','-f','null','-'],false);
  const peak = Number(audio.stderr.match(/max_volume: ([-\d.]+) dB/)?.[1] ?? '-Infinity');
  const mean = Number(audio.stderr.match(/mean_volume: ([-\d.]+) dB/)?.[1] ?? '-Infinity');
  if (!audio.ok || peak < -55 || !Number.isFinite(mean)) throw Error('成片音轨缺失或近乎静音');
  const probe = audio.stderr.match(/Video: .*?, (\d{2,5})x(\d{2,5})/);
  const duration = Number(spec.duration || 20);
  const cover = file.replace(/\.mp4$/i, '-cover-v'+Number(spec.automation?.contentVersion||1)+'.jpg');
  const titleFile = file.replace(/\.mp4$/i, '-cover.txt');
  const title = String(spec.coverTitle || '').slice(0, 100).replace(/(.{28})/gu, '$1\n').trim();
  fs.writeFileSync(titleFile, title);
  const escape = (value:string) => value.replace(/\\/g,'\\\\').replace(/:/g,'\\:').replace(/'/g,"'\\''");
  let frame = Number.isFinite(Number(spec.coverFrameTime)) ? Number(spec.coverFrameTime) : Math.min(1, duration / 4);
  if (spec.coverFrameTime === undefined) {
    let best = -Infinity;
    for (const candidate of [.15, .4, .65].map(f => duration * f)) {
      const sample = await runVisualFfmpeg(['-ss',String(candidate),'-i',file,'-vf','scale=64:64,format=gray','-frames:v','1','-f','rawvideo','pipe:1'],true);
      if (!sample.ok || sample.stdout.length !== 4096) continue;
      const mean = sample.stdout.reduce((sum,n) => sum+n,0)/4096;
      const variance = sample.stdout.reduce((sum,n) => sum+(n-mean)**2,0)/4096;
      const score = variance - Math.abs(mean-120)*12;
      if (score>best) { best=score;frame=candidate; }
    }
  }
  // Prefer an actual frame selected by the renderer's image checks; human time overrides it.
  const textFilter = title ? ",drawtext=textfile='"+escape(titleFile)+"':fontsize=h/24:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=16:x=(w-tw)/2:y=h*0.12" : '';
  const rendered = await runVisualFfmpeg(['-y','-ss',String(Math.max(0,Math.min(duration-.1,frame))),'-i',file,'-vf','scale=iw:ih'+textFilter,'-frames:v','1',cover]);
  if (!rendered.ok || !fs.existsSync(cover)) throw Error('封面生成失败：'+rendered.stderr.slice(-200));
  return { coverImagePath: cover, coverFrameTime: frame, coverSelection: { source: spec.coverFrameTime === undefined ? 'frame_contrast' : 'human', titleSource: 'script_or_human' }, exportSpec: { ratio: spec.ratio || '9:16', resolution: spec.exportSpec?.resolution || '1080p', fps: 30, codec:'h264', width:probe ? Number(probe[1]) : undefined,height:probe ? Number(probe[2]) : undefined }, audioQuality: { passed:true, peakDb:peak, meanDb:mean, reviewedByHuman:false } };
}
