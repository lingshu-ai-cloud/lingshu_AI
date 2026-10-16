// Explicitly authorized single-sample manual baseline. Never calls start,
// refresh-reference, collection or a provider; cached-source admission is strict.
const base='http://127.0.0.1:8791';
const prefix='manual-716-coosto-spray-draft-v1';
const login=await fetch(`${base}/api/overseas/auth/local-preview-session`,{method:'POST',headers:{origin:'http://127.0.0.1:5177','content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(20_000)});
const auth=await login.json() as {token?:string};
if(!login.ok||!auth.token)throw Error(`local_login_failed_${login.status}`);
const headers={authorization:`Bearer ${auth.token}`,'content-type':'application/json'};
const body={title:'COOSTO止汗净味喷雾 · 716单样本复刻草稿',objective:'基于716同源参考分析，结合已导入COOSTO止汗净味喷雾真实资料制作单条原创视频；不复制参考品牌、人物身份或商务承诺，缺少授权和素材时保留受阻。',mode:'instant',requestedOutputCount:1,creationMode:'viral_replication',referenceMode:'single_source_fidelity',themeId:'product_value',topic:'COOSTO止汗净味喷雾产品介绍',productId:'import-1791945562092-9',languages:['en'],perItemBudgetCny:15,managementMode:'advanced',assetAvailability:'none',callToAction:'Contact us on WhatsApp to get your free sample.'};
const created=await fetch(`${base}/api/overseas/starter-198/social-content/tasks`,{method:'POST',headers:{...headers,'idempotency-key':`${prefix}:create`},body:JSON.stringify(body),signal:AbortSignal.timeout(20_000)});
const result=await created.json() as any;
const taskId=result.task?.taskId??result.task?.id;
console.log(JSON.stringify({stage:'create',status:created.status,taskId,version:result.task?.version,state:result.task?.status,error:result.error}));
if(!created.ok||!taskId)throw Error('manual_baseline_create_not_verified');
const source=await fetch(`${base}/api/overseas/starter-198/social-content/tasks/${taskId}/sources`,{method:'POST',headers:{...headers,'idempotency-key':`${prefix}:source`},body:JSON.stringify({kind:'reference_link',sourceRef:'https://www.tiktok.com/@justtraghda/video/7697001086565027073',cachedReferenceRecordId:'trend_videos_71680deb85134ece87862f02282c2af2',label:'716已完成精确分析缓存参考',purpose:'只参考表达与分镜，不构成企业事实、人物或原素材使用授权'}),signal:AbortSignal.timeout(20_000)});
const bound=await source.json() as any;
console.log(JSON.stringify({stage:'source',status:source.status,error:bound.error}));
const detail=await fetch(`${base}/api/overseas/starter-198/social-content/tasks/${taskId}`,{headers,signal:AbortSignal.timeout(20_000)});
const output=await detail.json() as any,t=output.task;
console.log(JSON.stringify({stage:'detail',status:detail.status,taskId,state:t?.status,version:t?.version,productId:t?.brief?.productId,outputs:t?.brief?.requestedOutputCount,budget:t?.brief?.perItemBudgetCny,referenceReuse:t?.brief?.referenceReuse,sourceCount:t?.sources?.length,analysisStatus:t?.referenceVideoAnalysis?.status,executionReview:t?.executionReview,keys:t?Object.keys(t):[],error:output.error}));
if(!source.ok||!detail.ok)process.exitCode=1;
export {};
