// Install before application imports. This is process isolation, not an OS firewall.
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
import {customerPreviewAiRequestAllowed,auditedCustomerPreviewAiFetch,customerPreviewAiTransportAllowed} from './customer-preview-ai-scope.mjs';
import {installCustomerIsolationCanary} from './customer-isolation-canary.mjs';
import {customerIsolationDiagnostic} from './customer-isolation-diagnostics.mjs';
import {installIsolatedProcesses} from './customer-isolated-processes.mjs';
if(process.env.CUSTOMER_ISOLATION_CANARY==='1')installCustomerIsolationCanary();
const key=Symbol.for('lingshu.customerIsolationGuard');
const priorStatus=Reflect.get(globalThis,Symbol.for('lingshu.customerIsolationStatus'));
let guardedFetch,processIntegrity;
const ports=new Set();
const audit=[];
const integrity=[];
function blocked(transport,target){audit.push({at:new Date().toISOString(),transport,decision:'blocked',...customerIsolationDiagnostic(target,new Error().stack)});if(audit.length>200)audit.shift();return Object.assign(Error('isolated_test_network_blocked'),{code:'ISOLATED_NETWORK_BLOCKED'});}
function socketOptions(args){
 const a=args[0];
 if(Array.isArray(a))return socketOptions(a);
 if(a&&typeof a==='object')return a;
 return typeof a==='number'||/^\d+$/.test(String(a))?{port:a,host:typeof args[1]==='string'?args[1]:'localhost'}:{path:a};
}
function local(o){return !o.path&&!o.socketPath&&['127.0.0.1','localhost','::1','[::1]'].includes(o.hostname||o.host||'localhost')&&ports.has(String(o.port));}
function socketAllowed(o){return local(o)||customerPreviewAiTransportAllowed(o.host||o.hostname,o.port);}
if(typeof priorStatus!=='function'){
const listen=net.Server.prototype.listen;
net.Server.prototype.listen=function(...args){let port;this.once('listening',()=>{const a=this.address();if(a&&typeof a==='object'){port=String(a.port);ports.add(port);}});this.once('close',()=>{if(port)ports.delete(port);});return listen.apply(this,args);};
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){if(!socketAllowed(socketOptions(args)))throw blocked('net',socketOptions(args));return connect.apply(this,args);};
const tlsConnect=tls.connect;
tls.connect=function(...args){const o=socketOptions(args);if(!socketAllowed(o))throw blocked('tls',o);return tlsConnect.apply(this,args);};
function requestLocal(input,options={}){
 try{const u=typeof input==='string'||input instanceof URL?new URL(input):null;const o={...(u?{hostname:u.hostname,port:u.port||(u.protocol==='https:'?443:80)}:input),...options};if(options.host&&!options.hostname)o.hostname=options.host;delete o.path;return local(o);}catch{return false;}
}
const originalFetch=globalThis.fetch;
guardedFetch=async(input,init)=>{
 if(!requestLocal(typeof input==='string'||input instanceof URL?input:input.url)){
  if(customerPreviewAiRequestAllowed(input,init))return auditedCustomerPreviewAiFetch(originalFetch,input,init);
  throw blocked('fetch',typeof input==='string'||input instanceof URL?input:input.url);
 }
 return originalFetch(input,{...init,redirect:'error'});
};
globalThis.fetch=guardedFetch;
for(const module of [http,https]){
 const request=module.request;
 module.request=function(input,...args){if(!requestLocal(input,typeof args[0]==='object'?args[0]:{}))throw blocked(module===http?'http':'https',typeof input==='object'&&!(input instanceof URL)?{...input,...(typeof args[0]==='object'?args[0]:{})}:input);return request.call(this,input,...args);};
 module.get=function(input,...args){const req=module.request(input,...args);req.end();return req;};
}
for(const [object,name]of [[net.Socket.prototype,'connect'],[tls,'connect'],[http,'request'],[https,'request'],[http,'get'],[https,'get']])integrity.push([object,name,object[name]]);
processIntegrity=installIsolatedProcesses(import.meta.url,blocked);
syncBuiltinESMExports();
Object.defineProperty(globalThis,key,{value:true,configurable:false});
Object.defineProperty(globalThis,Symbol.for('lingshu.customerIsolationStatus'),{value:customerIsolationStatus});
if(process.env.CUSTOMER_ISOLATION_CANARY==='1')process.on('exit',()=>{const hits=Reflect.get(globalThis,Symbol.for('lingshu.customerIsolationCanary'))?.();if(!Array.isArray(hits)||hits.length){process.exitCode=1;console.error('customer_isolation_canary_failed');}});
}
export function customerIsolationStatus(){if(typeof priorStatus==='function')return priorStatus();return {installed:globalThis[key]===true&&globalThis.fetch===guardedFetch&&integrity.every(([object,name,value])=>object[name]===value)&&processIntegrity(),version:2,pid:process.pid,defaultPolicy:'deny',allowedLocalPorts:[...ports],blocked:[...audit]};}
export function assertCustomerIsolationInstalled(){if(!customerIsolationStatus().installed)throw Error('customer_isolation_guard_missing');}
// Fixed reserved-domain probes only; no caller-supplied URL or real channel address.
export async function runCustomerIsolationSelfCheck(){
 assertCustomerIsolationInstalled();
 const target='https://customer-channel.invalid/messages';
 const child=await import('node:child_process');
 const checks=[];
 for(const [name,action]of [
  ['fetch',()=>fetch(target,{method:'POST'})],['http',()=>http.request(target)],['https',()=>https.request(target)],
  ['net',()=>net.connect(443,'customer-channel.invalid')],['tls',()=>tls.connect({host:'customer-channel.invalid',port:443})],
  ['curl_subprocess',()=>child.spawn('curl',[target])],['shell',()=>child.exec('curl '+target)],
 ]){
  try{await action();throw Error('customer_isolation_probe_escaped:'+name);}catch(error){if(error?.code!=='ISOLATED_NETWORK_BLOCKED')throw error;checks.push({name,result:'blocked',code:error.code});}
 }
 const code=`const a=require('node:assert/strict');a.equal(globalThis[Symbol.for('lingshu.customerIsolationGuard')],true);a.throws(()=>require('node:https').request('${target}'),/isolated_test_network_blocked/);console.log('child-default-deny');`;
 const output=child.execFileSync(process.execPath,['-e',code],{env:{},encoding:'utf8',timeout:10000});
 if(!output.includes('child-default-deny'))throw Error('customer_isolation_child_probe_failed');
 checks.push({name:'node_child_empty_env',result:'blocked',code:'ISOLATED_NETWORK_BLOCKED'});
 return {checkedAt:new Date().toISOString(),...customerIsolationStatus(),checks};
}
