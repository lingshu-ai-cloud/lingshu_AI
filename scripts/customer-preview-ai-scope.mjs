import {AsyncLocalStorage} from 'node:async_hooks';
// tsx may load this module through both ESM and synchronous require. One process
// must share the same capability context across those module caches.
const storageKey=Symbol.for('lingshu.customerPreviewAiScopes');
if(!Reflect.get(globalThis,storageKey))Object.defineProperty(globalThis,storageKey,{value:{scope:new AsyncLocalStorage(),transport:new AsyncLocalStorage()}});
const {scope,transport}=Reflect.get(globalThis,storageKey);
export function customerPreviewAiTransportAllowed(host,port){const active=transport.getStore();return !!active?.open&&host===new URL(active.endpoint).hostname&&Number(port)===443;}
export function customerPreviewAiRequestAllowed(input,init={}){
 const active=scope.getStore();if(!active?.open)return false;
 try{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);return url.href===active.endpoint&&(init.method||input?.method||'GET').toUpperCase()==='POST'&&!url.username&&!url.password;}catch{return false;}
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
 const record={startedAt:new Date().toISOString(),endpoint:active.endpoint,status:null,requestId:null,completionId:null,model:null,usage:null};active.audit.push(record);
 const permit={endpoint:active.endpoint,open:true};
 let response;try{response=await transport.run(permit,()=>originalFetch(input,{...init,redirect:'error'}));}finally{permit.open=false;}record.status=response.status;record.requestId=response.headers.get('x-request-id')||response.headers.get('request-id');
 try{const data=await response.clone().json();record.completionId=data.id||null;record.model=data.model||null;record.usage=data.usage||null;}catch{/* Provider errors remain errors, never synthetic success. */}
 return response;
}
