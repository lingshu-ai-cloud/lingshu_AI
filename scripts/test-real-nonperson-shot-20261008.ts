import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
dotenv.config({path:path.resolve('../local-preview-1002/.env'),quiet:true});
dotenv.config({path:path.resolve('../local-preview-1002/.env.local'),override:true,quiet:true});
process.env.LOCAL_STORE_DIR=path.resolve('data/local-store');
const root=path.resolve('data/acceptance/real-shot-replication-20261008');
const tenantId='local_tenant_customer_1b2913131e2c46deab66172228c4df0a';
const {runWithDataAuthority}=await import('../server/storage/dataAuthority.js');
const {store}=await import('../server/storage/index.js');
const {studioRouter}=await import('../server/routes/studio.js');
// Call the same domain handler from the authorized local CLI. No auth endpoint,
// supplier transport, store, quality result, or budget is mocked by this runner.
await runWithDataAuthority('local',async()=>{
 const stateFile=path.join(root,'nonperson-shot-state.json');
 const state:any=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):{};
 const shotId='nonperson-mask-product-closeup';
 const description='复刻参考视频第2镜的双手持产品近景、固定机位和居中展示动作。替换为企业知识库的丝蛋白生物基抗皱干膜实物包装，严格保留企业产品包装颜色、轮廓和文字，不保留原片品牌，不虚构功效。画面只显示双手和产品，不出现真人出镜脸。注意：企业产品包装正面印刷的女模特人像、面膜图案属于产品包装身份，必须完整保留，不能把包装印刷人像当成真人脸删除。必须与企业参考图完全一致地保留正面女模特印刷图、面膜图案、GUIANFA品牌和文字排版。';
 const spec:any={mode:'clone',creationPath:'viral_replication',ratio:'9:16',activeAssemblyId:'video-1',selectedProductIds:['GUIANFA-RS-014'],selected:[],shootingSlots:[{id:shotId,slotId:'slot-2',detail:description,duration:0.87,observedPresenterRole:'none',salesPresenterConfirmed:false}],shotProductions:{},storyboardAssignments:{},storyboardSourcePlans:{'slot-2':{mode:'ai',sceneType:'product',productIds:['GUIANFA-RS-014'],videoResolution:'480p',videoResolutionPinned:true}},videoKickoff:{referenceAnalysis:{details:[{shotId:'slot-2',time:'5.1-5.97s',firstFrameRef:'/api/overseas/videos/trend_videos_192e76d4b21244c4a2922e60672c95f2/shot/2/first-frame'}]}}};
 if(!state.projectId){const p=await store.create<any>('studio_projects',{tenant_id:tenantId,title:'真实逐镜测试 · 非人物产品镜头',status:'draft',spec,created_at:new Date().toISOString(),updated_at:new Date().toISOString()});if(!p?.id)throw Error('Isolated project creation failed');state.projectId=p.id;fs.writeFileSync(stateFile,JSON.stringify(state,null,2));}
 await store.update('studio_projects',state.projectId,{spec,updated_at:new Date().toISOString()});
 const layer=(studioRouter as any).stack.find((x:any)=>x.route?.path==='/storyboard-first-frame'&&x.route.methods.post);
 if(!layer)throw Error('Native first-frame handler unavailable');
 let status=200;let result:any;
 const res:any={locals:{tenantId,userId:'authorized-local-acceptance-runner'},status:(s:number)=>{status=s;return res;},json:(v:any)=>{result=v;return res;},setHeader:()=>{},getHeader:()=>undefined};
 const req:any={body:{projectId:state.projectId,shotId,requestId:'real-nonperson-mask-frame-20261008-v2',mode:'replication',sceneType:'product',shotDescription:description,startSeconds:5.1,endSeconds:5.97,ratio:'9:16',productIds:['GUIANFA-RS-014'],sourceFirstFrameUrl:spec.videoKickoff.referenceAnalysis.details[0].firstFrameRef},headers:{},params:{},query:{},get:()=>undefined};
 await layer.route.stack[0].handle(req,res);
 state.responseStatus=status;state.result=result;state.businessAccepted=false;state.executionKind='native_domain_handler_real_suppliers';fs.writeFileSync(stateFile,JSON.stringify(state,null,2));
 console.log(JSON.stringify({status,ok:result?.ok,code:result?.code,error:result?.error,materialId:result?.material?.id,quality:result?.firstFrameQuality},null,2));
});
