import path from 'node:path';
import fsp from 'node:fs/promises';
import sharp from 'sharp';
import {runVisualFfmpeg} from '../lib/renderVisualQuality.js';

/** Burn the disclosure into the actual scene bytes, so it survives final composition and download. */
export async function burnIllustrativeVideoDisclosure(inputPath: string): Promise<void> {
  const label=path.join(path.dirname(inputPath),path.basename(inputPath)+'.disclosure.png');
  const output=inputPath+'.disclosed.mp4';
  try {
    await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="60"><rect width="240" height="60" rx="10" fill="#000" fill-opacity="0.7"/><text x="18" y="40" font-size="28" font-family="PingFang SC, Arial, sans-serif" fill="#fff">AI 场景示意</text></svg>')).png().toFile(label);
    const result=await runVisualFfmpeg(['-y','-i',inputPath,'-i',label,'-filter_complex','[0:v][1:v]overlay=20:20:eof_action=repeat[v]',
      '-map','[v]','-map','0:a?','-c:v','libx264','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',output],false,{timeoutMs:120000});
    if(!result.ok||(await fsp.stat(output)).size<=0)throw Error('illustrative_video_disclosure_render_failed');
    await fsp.rename(output,inputPath);
  } finally {await Promise.all([fsp.rm(label,{force:true}),fsp.rm(output,{force:true})]);}
}
