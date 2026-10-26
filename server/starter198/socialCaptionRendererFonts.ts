import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const require=createRequire(import.meta.url);
/** Reuse the renderer's bundled font inventory and integrity check. System
 * fallback fonts are not the glyph evidence used to make the exported video. */
type Font={file:string;sha256:string};
export function verifyCaptionRendererFontInventory(directory:string,fonts:Font[]):{directory:string;hash:string}|null{
 try{
  if(!fonts.length)return null;
  for(const font of fonts){
   if(path.basename(font.file)!==font.file||!/^[a-f0-9]{64}$/.test(font.sha256)
    ||createHash('sha256').update(readFileSync(path.join(directory,font.file))).digest('hex')!==font.sha256)return null;
  }
  return {directory,hash:createHash('sha256').update(JSON.stringify(fonts)).digest('hex')};
 }catch{return null;}
}
export function socialCaptionRendererFontIdentity():{directory:string;hash:string}|null{
 try{
  const renderer=require('../../desktop/automatic-subtitles.cjs') as {fontsDirectory:string;template:{body:Font;emphasis:Font;product:Font}};
  // The renderer memoizes verification. Audits and cache reads verify the
  // current bytes again so a later missing/corrupt font cannot reuse a pass.
  return verifyCaptionRendererFontInventory(renderer.fontsDirectory,[renderer.template.body,renderer.template.emphasis,renderer.template.product]);
 }catch{return null;}
}
export const socialCaptionRendererFonts=():string|null=>socialCaptionRendererFontIdentity()?.directory??null;
