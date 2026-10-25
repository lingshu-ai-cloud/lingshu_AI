import { publicSourceUrl } from '../shared/assistantPublicSourcePolicy.mjs';
import {AsyncLocalStorage} from 'node:async_hooks';
// tsx may load this module through both ESM and synchronous require. One process
// must share the same capability context across those module caches.
const storageKey=Symbol.for('lingshu.customerPreviewAiScopes');
if(!Reflect.get(globalThis,storageKey))Object.defineProperty(globalThis,storageKey,{value:{scope:new AsyncLocalStorage(),transport:new AsyncLocalStorage()}});
const {scope,transport}=Reflect.get(globalThis,storageKey);
export function customerPreviewAiTransportAllowed(host,port){const active=transport.getStore();return !!active?.open&&host===new URL(active.endpoint).hostname&&Number(port)===443;}
function assistantReadAllowed(url,method){
 if(url.protocol!=='https:'||url.username||url.password||url.port)return false;
 if(method==='GET'&&url.hostname==='open.er-api.com')return /^\/v6\/latest\/[A-Z]{3}$/.test(url.pathname)&&!url.search;
 if(method==='GET'&&url.hostname==='comtradeapi.un.org')return /^\/(?:public\/v1\/preview|data\/v1\/get)\/C\/A\/HS$/.test(url.pathname)&&url.searchParams.get('maxRecords')==='500';
 if(method==='GET'){try{publicSourceUrl(url.href);return true;}catch{return false;}}
 if(method!=='POST')return false;
 const base=new URL(process.env.DASHSCOPE_BASE_URL||'https://maas.qianwenaiapi.com/compatible-mode/v1');
 if(['maas.qianwenaiapi.com','dashscope.aliyuncs.com'].includes(base.hostname)&&url.href===base.origin+'/compatible-mode/v1/chat/completions')return true;
 const native=process.env.QWEN_SEARCH_ENDPOINT;
 if(native&&url.href===native&&(['maas.qianwenaiapi.com','dashscope.aliyuncs.com'].includes(url.hostname)||url.hostname.endsWith('.maas.aliyuncs.com'))&&url.pathname==='/api/v1/services/aigc/text-generation/generation'&&!url.search)return true;
 return url.hostname==='generativelanguage.googleapis.com'&&/^\/v1beta\/models\/gemini-[\w.-]+:(?:streamGenerateContent|generateContent)$/.test(url.pathname)&&[...url.searchParams.keys()].every(key=>['alt','key'].includes(key));
}
export function customerPreviewAiRequestAllowed(input,init={}){
 const active=scope.getStore();if(!active?.open)return false;
 try{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);const method=(init.method||input?.method||'GET').toUpperCase();return active.kind==='assistant'?assistantReadAllowed(url,method):url.href===active.endpoint&&method==='POST'&&!url.username&&!url.password;}catch{return false;}
}
export async function withAssistantPreviewInformation(callback){
 if(process.env.NODE_ENV!=='development'||process.env.LINGSHU_LOCAL_PREVIEW!=='1'||process.env.ASSISTANT_PREVIEW_REAL_QUERIES!=='1')throw Error('assistant_preview_real_queries_not_enabled');
 const active={kind:'assistant',open:true,audit:[]};
 return scope.run(active,async()=>{try{return {value:await callback(),audit:active.audit};}finally{active.open=false;}});
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
 if(active.audit.length>=16)throw Error('preview_ai_request_limit');
 const requestUrl=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 const record={startedAt:new Date().toISOString(),endpoint:active.kind==='assistant'?requestUrl.origin+requestUrl.pathname:active.endpoint,status:null,requestId:null,completionId:null,model:null,usage:null};active.audit.push(record);
 const permit={endpoint:requestUrl.href,open:true};
 let response;try{response=await transport.run(permit,()=>originalFetch(input,{...init,redirect:'error'}));}finally{permit.open=false;}record.status=response.status;record.requestId=response.headers.get('x-request-id')||response.headers.get('request-id');
 if(!response.headers.get('content-type')?.includes('text/event-stream'))try{const data=await response.clone().json();record.completionId=data.id||data.request_id||null;record.model=data.model||null;record.usage=data.usage||null;}catch{/* Provider errors remain errors, never synthetic success. */}
 return response;
}
