import path from 'node:path';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';

const root=path.resolve('video/coosto-product-only-v1');
const serveUrl=await bundle({entryPoint:path.join(root,'index.ts'),publicDir:path.join(root,'public'),
  rootDir:process.cwd(),onProgress:progress=>{if(progress===1)process.stdout.write('bundle ready\n');}});
const composition=await selectComposition({serveUrl,id:'CoostoProductOnlyV1',logLevel:'warn'});
const output=path.join(root,'out','coosto-product-only-v1.mp4');
await renderMedia({serveUrl,composition,codec:'h264',outputLocation:output,overwrite:true,concurrency:2,
  crf:18,pixelFormat:'yuv420p',logLevel:'warn',onProgress:({progress})=>{
    const pct=Math.floor(progress*100); if(pct%10===0)process.stdout.write(`render ${pct}%\n`);
  }});
process.stdout.write(`${output}\n`);
