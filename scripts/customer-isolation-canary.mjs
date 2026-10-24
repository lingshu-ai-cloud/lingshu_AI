// Test-only second barrier. Counts attempted escapes and NEVER contacts a real host.
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
const hits=[];
function fail(transport){hits.push(transport);throw Error('isolation_canary_reached');}
function local(input){try{const host=typeof input==='string'||input instanceof URL?new URL(input).hostname:input?.hostname||input?.host||'localhost';return ['localhost','127.0.0.1','::1','[::1]'].includes(host);}catch{return false;}}
export function installCustomerIsolationCanary(){
if(Reflect.get(globalThis,Symbol.for('lingshu.customerIsolationCanary')))return;
const fetch=globalThis.fetch;globalThis.fetch=(input,init)=>local(typeof input==='object'&&!(input instanceof URL)?input.url:input)?fetch(input,init):Promise.reject((hits.push('fetch'),Error('isolation_canary_reached')));
for(const m of [http,https]){const request=m.request;m.request=function(input,...args){if(!local(input)||typeof args[0]==='object'&&!local(args[0]))fail('http');return request.call(this,input,...args);};}
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){const a=Array.isArray(args[0])?args[0]:args;const o=typeof a[0]==='object'?a[0]:{host:typeof a[1]==='string'?a[1]:'localhost'};if(!local(o))fail('net');return connect.apply(this,args);};
const tlsConnect=tls.connect;tls.connect=function(...args){const a=Array.isArray(args[0])?args[0]:args;const o=typeof a[0]==='object'?a[0]:{host:typeof a[1]==='string'?a[1]:'localhost'};if(!local(o))fail('tls');return tlsConnect.apply(this,args);};
Object.defineProperty(globalThis,Symbol.for('lingshu.customerIsolationCanary'),{value:()=>[...hits]});
syncBuiltinESMExports();
}
// Exercises the second barrier and exit failure without attempting any network I/O.
export function tripCustomerIsolationCanaryForTest(){fail('self_test');}
