// Preload before application modules. Only HTTP servers opened by this test process are reachable.
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
const ports = new Set();
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function(...args) {
  let port;
  this.once('listening', () => { const address=this.address();if(address&&typeof address==='object'){port=String(address.port);ports.add(port);} });
  this.once('close', () => { if(port)ports.delete(port); });
  return listen.apply(this,args);
};
function allowed(input,options={}) {
  try {
    const url=input instanceof URL?input:typeof input==='string'?new URL(input):new URL(`${input?.protocol||options.protocol||'http:'}//${input?.hostname||input?.host||options.hostname||'localhost'}:${input?.port||options.port||80}`);
    return ['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&ports.has(url.port);
  } catch { return false; }
}
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
  if(!allowed(typeof input==='string'||input instanceof URL?input:input.url))throw Error('isolated_test_network_blocked');
  return originalFetch(input,init);
};
for(const module of [http,https]){
  const request=module.request;
  module.request=function(input,...args){if(!allowed(input,args[0]))throw Error('isolated_test_network_blocked');return request.call(this,input,...args);};
  module.get=function(input,...args){const req=module.request(input,...args);req.end();return req;};
}
syncBuiltinESMExports();
