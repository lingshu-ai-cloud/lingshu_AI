import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { advanceOneProject, bindVoiceCuesToScenes, expandContentOrdersByLanguage, languageSceneAlignmentIssues, productionTiming, translateStoryboardFromMaster, type AssetCandidate, platformCreativeBrief } from './contentProduction.js';
import { materialRevision } from './productionMaterialAnalysis.js';
import { normalizeDigitalEmployeeConfig, normalizeWeeklyGoal } from './domain.js';
import { normalizeVideoPlan } from '../../src/lib/videoCreationPlan.js';
import { assessScriptQualityV2 } from '../lib/studioScriptQualityV2.js';
import { store } from '../storage/index.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'production-quality-worker-'));
const originalCwd=process.cwd(), originalUpdate=store.update, originalFetch=globalThis.fetch;
const hash=(value:unknown)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ffmpeg=(args:string[])=>execFileSync(String(ffmpegStatic),['-hide_banner','-loglevel','error',...args],{timeout:30000});
try {
  process.chdir(root);
  globalThis.fetch=async()=>{throw Error('Unexpected external request in isolated production workflow test');};
  const assets: AssetCandidate[]=['a','b','c'].map((id,i)=>{
    const localPath=path.join(root,id+'.png');
    ffmpeg(['-f','lavfi','-i','smptebars=s=320x480','-vf',i===0?'null':i===1?'hflip':'negate','-frames:v','1','-y',localPath]);
    return {id,name:'彩色条纹'+id,type:'image',duration:0,localPath,observations:['彩色条纹'],visualObservations:['彩色条纹'],segments:[],productId:'display',productName:'显示图案',source:'enterprise_product',tags:[],synthetic:false,authorization:{status:'owned',scope:'tenant',evidence:'isolated test input'}};
  });
  const voice=path.join(root,'voice.wav');ffmpeg(['-f','lavfi','-i','sine=frequency=440:duration=12','-y',voice]);
  const initial=path.join(root,'initial.mp4');
  const clips=['a','b','a'].map((id,i)=>{
    const clip=path.join(root,`clip-${i}.mp4`);ffmpeg(['-loop','1','-i',assets.find(a=>a.id===id)!.localPath!,'-t','4','-r','30','-pix_fmt','yuv420p','-y',clip]);return clip;
  });
  const list=path.join(root,'clips.txt');fs.writeFileSync(list,clips.map(file=>`file '${file}'`).join('\n'));
  ffmpeg(['-f','concat','-safe','0','-i',list,'-i',voice,'-c:v','copy','-c:a','aac','-shortest','-y',initial]);
  const lines=['Look at the colored stripes.','Compare the visible pattern.','Which pattern do you prefer?'];
  const script=lines.map((line,i)=>`[${i*4}-${(i+1)*4}s]\n素材：彩色条纹${['a','b','a'][i]}\n环境：彩色条纹\n景别：全景\n运镜：固定\n构图：彩色条纹\n镜头功能：展示图案\n画面：彩色条纹\n台词：${line}\n字幕：${line}`).join('\n\n');
  const infos=['a','b','a'].map((id,i)=>({name:'彩色条纹'+id,targetStart:i*4,targetEnd:(i+1)*4,observations:['彩色条纹']}));
  const facts='产品：显示图案；SKU：display；类别：显示图案';
  const assessed=assessScriptQualityV2({script,productInfo:facts,materialsText:'彩色条纹',materialInfos:infos});
  assert.equal(assessed.script,script,JSON.stringify(assessed));
  const spoken=lines.join(' ');
  const platformBrief=platformCreativeBrief('facebook');
  const spec:any={script,duration:12,voiceoverDur:12,lang:'en',ratio:'9:16',exportSpec:{resolution:'720p'},bgm:'',voiceoverUrl:'/voice.wav',scenePlanOrigin:'director',productionDirection:{voice:'v1'},platformBrief,subtitleAlignmentSource:'synthesized_sentence_audio',
    contentOrder:{videoPlan:normalizeVideoPlan({presenter:'material',language:'en',duration:12,platform:'facebook',productName:'显示图案',materialIds:['a','b','c']})},
    sceneSourcePlan:['a','b','a'].map((assetId,sceneIndex)=>({sceneIndex,assetId,start:sceneIndex*4,end:(sceneIndex+1)*4,sourceStart:0,intent:'画面：彩色条纹',observations:['彩色条纹'],score:10,reasons:['彩色条纹']})),
    sceneOverrides:[0,1,2].map(()=>({trimStart:0})),selectedMaterialIds:['a','b'],materialInfos:infos,
    alignedCuesByLang:{en:lines.map((text,i)=>({start:i*4,end:(i+1)*4,text}))},renderOutputPath:initial,
    automation:{managedBy:'digital_employee',route:'product',stage:'quality',contentVersion:1,renderOutputPath:initial,voiceLocalPath:voice,narrationReviewPassed:true,narrationHash:hash(spoken),spokenText:spoken,pathDifferenceCheck:{pathDifference:true},
      routePlan:{route:'product',productId:'display',assetIds:['a','b','c'],platform:'facebook',platformBrief},
      renderMaterialRevision:hash(assets.map(asset=>[asset.id,materialRevision(asset)]).sort())}};
  const record:any={id:'isolated-project',title:'图案展示',spec};
  store.update=(async(collection,id,patch)=>{assert.equal(collection,'studio_projects');assert.equal(id,record.id);Object.assign(record,structuredClone(patch));return true;}) as typeof store.update;
  const config=normalizeDigitalEmployeeConfig({focusProducts:'显示图案',companyName:'示例企业'});
  const multilingualConfig=normalizeDigitalEmployeeConfig({focusProducts:'显示图案',companyName:'示例企业',videoDefaults:{language:'en'},videoLanguages:['en','zh','en']});
  const expanded=expandContentOrdersByLanguage([{id:'order-1',languages:['en','zh'],route:'product',platform:'facebook',productId:'display',productName:'显示图案',evidenceRefs:[]}],multilingualConfig);
  assert.deepEqual(expanded.map(order=>order.id),['order-1::en','order-1::zh']);
  assert.deepEqual(expanded.map(order=>order.videoPlan?.language),['en','zh']);
  assert.equal(expanded[1].masterContentOrderId,'order-1::en');
  let translationCalls=0;
  const translated=await translateStoryboardFromMaster(script,'en','zh',(async()=>{
    translationCalls+=1;
    return {backend:'qwen',fallbackReason:'',text:translationCalls===1
      ? JSON.stringify({scenes:[{sceneId:'scene-1',text:'看看彩色条纹。'},{sceneId:'scene-2',text:'比较可见图案。'},{sceneId:'scene-3',text:'你更喜欢哪个图案？'}]})
      : JSON.stringify({passed:true,issues:[]})};
  }) as any);
  assert.equal(translationCalls,2);assert.equal(translated.bindings.length,3);
  assert.match(translated.script,/台词：看看彩色条纹。/);assert.match(translated.script,/素材：彩色条纹a/);
  const sceneCues=bindVoiceCuesToScenes(['第一句。还有一句。','第二镜。'],[{start:0,end:1,text:'第一句。'},{start:1.15,end:2,text:'还有一句。'},{start:2.15,end:3,text:'第二镜。'}]);
  assert.deepEqual(sceneCues?.map(cue=>cue.start),[0,2.15]);
  assert.deepEqual(productionTiming({duration:3.2,voiceoverDur:3.2,lang:'zh',sceneVoiceCuesByLang:{zh:sceneCues}},[{start:0,end:2},{start:2,end:4}]).sceneDurations,[2.15,1.0500000000000003]);
  assert.deepEqual(languageSceneAlignmentIssues({script:translated.script,lang:'zh',languageSceneBindings:translated.bindings,sceneVoiceCuesByLang:{zh:translated.bindings.map((binding,index)=>({start:index,end:index+1,text:binding.translatedText}))}}),[]);
  const goal=normalizeWeeklyGoal({metric:'approved_content_packages',target:1},config);
  const profile:any={products:{items:[{name:'显示图案',sku:'display',category:'显示图案'}]}};
  const tick=()=>advanceOneProject({tenantId:'isolated-tenant',record,config,goal,profile,assets,analyses:[],allProjects:[record]});
  record.spec=structuredClone(spec);record.spec.automation.narrationHash='stale';
  await tick();
  assert.equal(record.spec.automation.stage,'blocked');
  assert.equal(record.spec.automation.sceneRepairAttempts,undefined,'do not spend on visual repair before current narration approval');
  record.spec=structuredClone(spec);
  await tick();
  assert.equal(record.spec.automation.stage,'render',JSON.stringify(record.spec.automation));
  assert.equal(record.spec.automation.sceneRepairAttempts,1);
  assert.deepEqual(record.spec.sceneSourcePlan.map((scene:any)=>scene.assetId),['a','b','c']);
  assert.equal(record.spec.voiceoverUrl,spec.voiceoverUrl);assert.deepEqual(record.spec.alignedCuesByLang,spec.alignedCuesByLang);
  await tick();
  assert.equal(record.spec.automation.stage,'quality',JSON.stringify(record.spec.automation));
  assert.ok(fs.existsSync(record.spec.renderOutputPath));
  await tick();
  assert.equal(record.spec.automation.stage,'completed',JSON.stringify(record.spec.automation));
  assert.equal(record.status,'ready_for_approval');assert.equal(record.spec.automation.quality.passed,true);
  assert.equal(record.spec.automation.quality.sceneDiagnostics.passed,true);
  assert.ok(record.spec.audioQuality.passed);assert.ok(fs.existsSync(record.spec.coverImagePath));
  if (process.env.QUALITY_TEST_ARTIFACT_DIR) {
    const artifactDir=path.resolve(originalCwd,process.env.QUALITY_TEST_ARTIFACT_DIR);
    fs.mkdirSync(artifactDir,{recursive:true});
    fs.copyFileSync(record.spec.renderOutputPath,path.join(artifactDir,'isolated-workflow-result.mp4'));
    fs.copyFileSync(record.spec.coverImagePath,path.join(artifactDir,'isolated-workflow-cover.jpg'));
    fs.writeFileSync(path.join(artifactDir,'workflow-validation.json'),JSON.stringify({scope:'isolated test patterns and tone audio; not a customer video',stages:['quality','render','quality','completed'],passed:true,repairAttempts:record.spec.automation.sceneRepairAttempts,sceneDiagnostics:record.spec.automation.quality.sceneDiagnostics,visualMetrics:record.spec.automation.quality.visualMetrics,audioQuality:record.spec.audioQuality},null,2));
  }
  console.log('Production worker integration passed: quality failure → targeted repair → real composite render → final video/audio/cover checks → ready_for_approval. Only in-memory records and temporary test media used.');
} finally {store.update=originalUpdate;globalThis.fetch=originalFetch;process.chdir(originalCwd);fs.rmSync(root,{recursive:true,force:true});}
