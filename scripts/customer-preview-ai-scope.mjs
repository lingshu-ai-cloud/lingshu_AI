import { socialInsightQueries } from '../shared/socialInsightQueries.mjs';
import { publicSourceUrl, publicDisclosureQueryAllowed } from '../shared/assistantPublicSourcePolicy.mjs';
import {isIP} from 'node:net';
import {isPublicSearchAddress,publicSearchOriginalUrl} from '../shared/publicSearchReadPolicy.mjs';
import {AsyncLocalStorage} from 'node:async_hooks';
// tsx may load this module through both ESM and synchronous require. One process
// must share the same capability context across those module caches.
const storageKey=Symbol.for('lingshu.customerPreviewAiScopes');
if(!Reflect.get(globalThis,storageKey))Object.defineProperty(globalThis,storageKey,{value:{scope:new AsyncLocalStorage(),transport:new AsyncLocalStorage()}});
const {scope,transport}=Reflect.get(globalThis,storageKey);
export function customerPreviewAiTransportAllowed(host,port){const active=transport.getStore();if(active?.kind==='public-read')return !!active.open&&!!active.parent.open&&active.used&&[new URL(active.endpoint).hostname,active.address].includes(host)&&Number(port)===443;return !!active?.open&&host===new URL(active.endpoint).hostname&&Number(port)===443;}

// Only the validated public-original reader grants this exact one-request capability.
export async function withAssistantPreviewPublicRead(config,callback){
 const url=new URL(config.url);const address=config.pinnedAddress;
 if(config.kind==='article')publicSearchOriginalUrl(url.href);
 else if(config.kind!=='dns'||url.origin!=='https://cloudflare-dns.com'||url.pathname!=='/dns-query'||url.hash||url.username||url.password||url.port||[...url.searchParams.keys()].length!==2||!/^([a-z0-9-]+\.)+[a-z0-9-]+$/iu.test(url.searchParams.get('name')||'')||!['1','28'].includes(url.searchParams.get('type'))||address!=='1.1.1.1')throw Error('public_read_capability_invalid');
 if(config.kind==='dns')publicSearchOriginalUrl('https://'+url.searchParams.get('name')+'/dns-validation');
 if(!isPublicSearchAddress(address))throw Error('public_read_pin_not_public');
 const family=isIP(address);
 const pinnedLookup=(host,options,callback)=>{if(host!==url.hostname)return callback(Error('public_read_hostname_mismatch'));if(options.all)callback(null,[{address,family}]);else callback(null,address,family);};
 const parent=scope.getStore();
 if(process.env.LINGSHU_LOCAL_PREVIEW!=='1')return callback(pinnedLookup);
 if(!parent?.open||parent.kind!=='assistant')throw Error('public_read_assistant_scope_required');
 parent.publicRead??={articles:0,dns:0,queries:new Map(),permits:new Set()};
 const state=parent.publicRead;
 const dnsKey=config.kind==='dns'?url.href:null;
 if(dnsKey&&state.queries.has(dnsKey))return state.queries.get(dnsKey);
 if(config.kind==='article'){if(state.articles>=24)throw Error('public_read_article_limit');state.articles++;}
 else{if(state.dns>=48)throw Error('public_read_dns_limit');state.dns++;}
 const permit={kind:'public-read',parent,endpoint:url.href,address,family,lookup:pinnedLookup,open:true,used:false};
 state.permits.add(permit);
 const run=transport.run(permit,async()=>{try{return await callback(pinnedLookup);}finally{permit.open=false;state.permits.delete(permit);permit.cleanup?.();}});
 if(dnsKey)state.queries.set(dnsKey,run);
 return run;
}
export function customerPreviewPublicReadLease(onClose){
 const permit=transport.getStore();if(permit?.kind!=='public-read'||!permit.open||!permit.parent.open)throw Error('public_read_lease_required');
 permit.cleanup=onClose;return ()=>permit.open&&permit.parent.open;
}
function closePublicReadPermits(active){for(const permit of active.publicRead?.permits??[]){permit.open=false;permit.cleanup?.();}active.publicRead?.permits.clear();}
export function customerPreviewPublicReadRequestAllowed(input,options={}){
 const active=transport.getStore();if(active?.kind!=='public-read'||!active.open||!active.parent.open||active.used)return false;
 try{
  const dataObject=value=>value!==null&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&Reflect.ownKeys(value).every(key=>typeof key==='string'&&Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value'));
  if(!dataObject(options))return false;
  if(!(typeof input==='string'||input instanceof URL)||new URL(input).href!==active.endpoint||(options.method||'GET').toUpperCase()!=='GET'||options.agent!==false||options.lookup!==active.lookup||Number(options.family)!==active.family)return false;
  if(Object.keys(options).some(key=>!['method','signal','family','agent','headers','lookup'].includes(key)))return false;
  const headers=options.headers||{};if(!dataObject(headers)||Reflect.ownKeys(headers).some(key=>typeof key!=='string'||key.toLowerCase()!=='accept'||typeof headers[key]!=='string'||/[\r\n]/u.test(headers[key])))return false;
  active.used=true;return true;
 }catch{return false;}
}
function assistantReadAllowed(url,method,body){
 if(url.protocol!=='https:'||url.username||url.password||url.port)return false;
 if(method==='GET'&&url.hostname==='open.er-api.com')return /^\/v6\/latest\/[A-Z]{3}$/.test(url.pathname)&&!url.search;
 if(method==='GET'&&url.hostname==='comtradeapi.un.org')return /^\/(?:public\/v1\/preview|data\/v1\/get)\/C\/A\/HS$/.test(url.pathname)&&url.searchParams.get('maxRecords')==='500';
 if(method==='GET'){try{publicSourceUrl(url.href);return true;}catch{return false;}}
 if(method!=='POST')return false;
 if(publicDisclosureQueryAllowed(url.href,method,body))return true;
 const base=new URL(process.env.DASHSCOPE_BASE_URL||'https://maas.qianwenaiapi.com/compatible-mode/v1');
 if(['maas.qianwenaiapi.com','dashscope.aliyuncs.com'].includes(base.hostname)&&url.href===base.origin+'/compatible-mode/v1/chat/completions')return true;
 const native=process.env.QWEN_SEARCH_ENDPOINT||(['maas.qianwenaiapi.com','dashscope.aliyuncs.com'].includes(base.hostname)?base.origin+'/api/v1/services/aigc/text-generation/generation':null);
 if(native&&url.href===native&&(['maas.qianwenaiapi.com','dashscope.aliyuncs.com'].includes(url.hostname)||url.hostname.endsWith('.maas.aliyuncs.com'))&&url.pathname==='/api/v1/services/aigc/text-generation/generation'&&!url.search){try{const input=JSON.parse(body);const strategy=input.parameters?.search_options?.search_strategy;return strategy===undefined||['turbo','max'].includes(strategy);}catch{return false;}}
 return url.hostname==='generativelanguage.googleapis.com'&&/^\/v1beta\/models\/gemini-[\w.-]+:(?:streamGenerateContent|generateContent)$/.test(url.pathname)&&[...url.searchParams.keys()].every(key=>['alt','key'].includes(key));
}
export function customerPreviewAiRequestAllowed(input,init={}){
 const active=scope.getStore();if(!active?.open)return false;
 try{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);const method=(init.method||input?.method||'GET').toUpperCase();return active.kind==='social-insights'?socialInsightAllowed(active,url,method,init.body):active.kind==='assistant'?assistantReadAllowed(url,method,init.body):url.href===active.endpoint&&method==='POST'&&!url.username&&!url.password;}catch{return false;}
}
export async function withAssistantPreviewInformation(callback){
 if(process.env.NODE_ENV!=='development'||process.env.LINGSHU_LOCAL_PREVIEW!=='1'||process.env.ASSISTANT_PREVIEW_REAL_QUERIES!=='1')throw Error('assistant_preview_real_queries_not_enabled');
 const active={kind:'assistant',open:true,audit:[]};
 return scope.run(active,async()=>{try{return {value:await callback(),audit:active.audit};}finally{active.open=false;closePublicReadPermits(active);}});
}
export async function withCustomerPreviewAi(callback){
 if(process.env.NODE_ENV!=='development'||process.env.LINGSHU_LOCAL_PREVIEW!=='1'||process.env.CUSTOMER_SIMULATION_REAL_AI!=='1')throw Error('preview_real_ai_not_enabled');
 const base=new URL(process.env.DASHSCOPE_BASE_URL||'https://maas.qianwenaiapi.com/compatible-mode/v1');
 if(base.protocol!=='https:'||!['maas.qianwenaiapi.com','dashscope.aliyuncs.com'].includes(base.hostname)||base.port||base.username||base.password||base.search||base.hash||base.pathname.replace(/\/+$/,'')!=='/compatible-mode/v1')throw Error('preview_ai_endpoint_not_supported');
 const active={open:true,endpoint:base.origin+'/compatible-mode/v1/chat/completions',audit:[]};
 return scope.run(active,async()=>{try{const value=await callback();return {value,audit:active.audit};}catch(error){if(error instanceof Error)Object.defineProperty(error,'previewAiAudit',{value:active.audit});throw error;}finally{active.open=false;}});
}
export async function auditedCustomerPreviewAiFetch(originalFetch,input,init){
 const active=scope.getStore();if(!active||!customerPreviewAiRequestAllowed(input,init))throw Error('isolated_test_network_blocked');
 if(active.audit.length>=(active.kind==='social-insights'?64:16))throw Error('preview_ai_request_limit');
 const requestUrl=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 if(active.kind==='social-insights'){const method=(init?.method||input?.method||'GET').toUpperCase();if(requestUrl.hostname==='api.apify.com'&&method==='POST')active.submitted=true;else if(requestUrl.hostname==='api.apify.com'&&requestUrl.pathname.includes('/datasets/'))active.datasetRead=true;else if(method==='POST')active.analyzed=true;}
 const record={startedAt:new Date().toISOString(),endpoint:['assistant','social-insights'].includes(active.kind)?requestUrl.origin+requestUrl.pathname:active.endpoint,status:null,requestId:null,completionId:null,model:null,usage:null};active.audit.push(record);
 const permit={endpoint:requestUrl.href,open:true};
 let response;try{response=await transport.run(permit,()=>originalFetch(input,{...init,redirect:'error'}));}finally{permit.open=false;}record.status=response.status;record.requestId=response.headers.get('x-request-id')||response.headers.get('request-id');
 if(active.kind==='social-insights'&&requestUrl.hostname==='api.apify.com'&&init?.method==='POST'&&response.ok){try{const data=await response.clone().json();if(typeof data.data?.id==='string'&&typeof data.data?.defaultDatasetId==='string'){active.runId=data.data.id;active.datasetId=data.data.defaultDatasetId;}}catch{}}
 if(!response.headers.get('content-type')?.includes('text/event-stream'))try{const data=await response.clone().json();record.completionId=data.id||data.request_id||null;record.model=data.model||null;record.usage=data.usage||null;}catch{/* Provider errors remain errors, never synthetic success. */}
 return response;
}

// A separate, one-confirmation capability. It never widens the default assistant scope.
function socialInsightAllowed(active,url,method,body){
 if(url.protocol!=='https:'||url.username||url.password||url.port)return false;
 if(url.hostname==='api.apify.com'){
  if(method==='POST'&&url.pathname===`/v2/acts/${encodeURIComponent(active.actorId)}/runs`&&!active.submitted){
   let input;try{input=JSON.parse(body);}catch{return false;}
   if(url.searchParams.get('maxTotalChargeUsd')!==String(active.maxUsd)||url.searchParams.get('restartOnError')!=='false'||[...url.searchParams.keys()].some(k=>!['maxTotalChargeUsd','restartOnError'].includes(k))||input.resultsPerPage!==7||!Array.isArray(input.searchQueries)||JSON.stringify(input.searchQueries)!==JSON.stringify(socialInsightQueries(active.confirmedKeyword)))return false;
   return true;
  }
  if(method==='GET'&&active.runId&&url.pathname===`/v2/actor-runs/${encodeURIComponent(active.runId)}`&&!url.search)return true;
  if(method==='GET'&&active.datasetId&&url.pathname===`/v2/datasets/${encodeURIComponent(active.datasetId)}/items`&&!active.datasetRead&&url.searchParams.get('limit')==='30'&&url.searchParams.get('clean')==='true'&&[...url.searchParams.keys()].every(k=>['limit','clean'].includes(k))){return true;}
  return false;
 }
 const modelBase=new URL(process.env.DASHSCOPE_BASE_URL||'https://maas.qianwenaiapi.com/compatible-mode/v1');
 if(method==='POST'&&active.datasetRead&&!active.analyzed&&['maas.qianwenaiapi.com','dashscope.aliyuncs.com'].includes(modelBase.hostname)&&url.href===modelBase.origin+'/compatible-mode/v1/chat/completions'){
  return true;
 }
 return false;
}
export async function withSocialInsightPreviewInformation(config,callback){
 if(process.env.NODE_ENV!=='development'||process.env.LINGSHU_LOCAL_PREVIEW!=='1'||process.env.ASSISTANT_PREVIEW_REAL_QUERIES!=='1')throw Error('assistant_preview_real_queries_not_enabled');
 if(config.actorId!=='clockworks~tiktok-scraper'||!(config.maxUsd>0&&config.maxUsd<=0.5)||!(config.datasetReadMaxUsd>0&&config.datasetReadMaxUsd<=0.05))throw Error('social_insight_budget_not_configured');
 socialInsightQueries(config.confirmedKeyword);
 const active={kind:'social-insights',open:true,actorId:config.actorId,maxUsd:config.maxUsd,confirmedKeyword:config.confirmedKeyword,submitted:false,datasetRead:false,analyzed:false,audit:[]};
 return scope.run(active,async()=>{try{return {value:await callback(),audit:active.audit};}finally{active.open=false;}});
}
