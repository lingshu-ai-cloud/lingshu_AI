import path from 'node:path';
import {bundle} from '@remotion/bundler';
import {renderStill, selectComposition} from '@remotion/renderer';

const root=path.resolve('video/coosto-product-only-v1');
const serveUrl=await bundle({entryPoint:path.join(root,'index.ts'),publicDir:path.join(root,'public'),rootDir:process.cwd()});
const composition=await selectComposition({serveUrl,id:'CoostoProductOnlyV1',logLevel:'warn'});
for(const [label,frame] of [['start',15],['middle',794],['end',1560]]){
  await renderStill({serveUrl,composition,frame,output:path.join(root,'out',`qa-${label}.png`),imageFormat:'png',overwrite:true,logLevel:'warn'});
}
process.stdout.write(JSON.stringify({id:composition.id,width:composition.width,height:composition.height,fps:composition.fps,durationInFrames:composition.durationInFrames,durationSeconds:composition.durationInFrames/composition.fps}));
