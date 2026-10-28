import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The child runs the real isolation guard over inert native transport spies.
// No branch in this fixture can open an external socket or contact a provider.
const setup = `
import assert from 'node:assert/strict';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import {EventEmitter} from 'node:events';
let created=0, sent=0;
https.request=(input,options={})=>{
 created++;
 const target=new URL(input), headers={...(options.headers||{})};
 const req=new EventEmitter();
 req.path=target.pathname+target.search;req.method=options.method||'GET';
 req.getHeaders=()=>({...headers});req.getHeader=name=>headers[name.toLowerCase()];
 req.setHeader=(name,value)=>{headers[name.toLowerCase()]=value;};
 req.removeHeader=name=>{delete headers[name.toLowerCase()];};
 req.write=()=>{sent++;return true;};req.addTrailers=()=>{sent++;};
 req.flushHeaders=()=>{sent++;};req.end=()=>{sent++;return req;};
 req.destroy=()=>{req.destroyed=true;return req;};
 return req;
};
http.request=()=>{throw Error('INERT_HTTP_TRANSPORT');};
net.Socket.prototype.connect=()=>{throw Error('INERT_NET_TRANSPORT');};
tls.connect=()=>{throw Error('INERT_TLS_TRANSPORT');};
globalThis.fetch=async()=>{throw Error('INERT_FETCH_TRANSPORT');};
const scope=await import('./scripts/customer-preview-ai-scope.mjs');
await import('./scripts/customer-isolated-test-guard.mjs');
const {withAssistantPreviewInformation:assistant,withAssistantPreviewPublicRead:permit,customerPreviewAiTransportAllowed:transportAllowed}=scope;
const url='https://www.cosmeticsdesign-europe.com/Article/2026/10/20/research-update';
const config={url,pinnedAddress:'104.18.1.1',kind:'article'};
const opts=lookup=>({method:'GET',agent:false,family:4,lookup,headers:{Accept:'text/html,application/xhtml+xml'}});
const blocked=/isolated_test_network_blocked/;
`;
function child(code) { return runChildSource(setup + code); }
function runChildSource(source) {
 const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
  cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 15000,
  env: { ...process.env, NODE_OPTIONS: '', NODE_ENV: 'development', LINGSHU_LOCAL_PREVIEW: '1', ASSISTANT_PREVIEW_REAL_QUERIES: '1' },
 });
 assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error));
}

test('guard remains default-deny and public reads require the live assistant and exact single GET capability', () => child(`
assert.throws(()=>https.request(url),blocked);
await assert.rejects(fetch(url),blocked);
assert.throws(()=>net.connect(443,'www.cosmeticsdesign-europe.com'),blocked);
assert.throws(()=>tls.connect({host:'www.cosmeticsdesign-europe.com',port:443}),blocked);
await assert.rejects(permit(config,async()=>{}),/public_read_assistant_scope_required/);
let escaped;
await assistant(async()=>{
 assert.throws(()=>https.request(url),blocked);
 await permit(config,async lookup=>{
  assert.equal(transportAllowed(new URL(url).hostname,443),false);
  assert.equal(transportAllowed(config.pinnedAddress,443),false);
  assert.throws(()=>net.connect(443,config.pinnedAddress),blocked);
  assert.equal(transportAllowed('differentpublisher.com',443),false);
  lookup(new URL(url).hostname,{all:true},(error,records)=>{assert.equal(error,null);assert.deepEqual(records,[{address:config.pinnedAddress,family:4}]);});
  lookup('differentpublisher.com',{},error=>assert.match(error.message,/hostname_mismatch/));
  escaped=()=>https.request(url,opts(lookup));
  const req=https.request(url,opts(lookup));
  assert.equal(transportAllowed(new URL(url).hostname,443),true);
  assert.equal(transportAllowed(config.pinnedAddress,443),true);
  req.end();
  assert.throws(()=>https.request(url,opts(lookup)),blocked);
 });
 assert.throws(()=>escaped(),blocked);
 assert.equal(transportAllowed(config.pinnedAddress,443),false);
});
assert.throws(()=>escaped(),blocked);
assert.throws(()=>https.request(url),blocked);
assert.equal(created,1);assert.equal(sent,1);
`));

test('public capability denies destination, TLS, header, body and method overrides before inert transport sees them', () => child(`
await assistant(async()=>{
 for(const patch of [
  {method:'POST'},{agent:{}},{family:6},{lookup:()=>{}},
  {host:'127.0.0.1'},{hostname:'127.0.0.1'},{port:80},{path:'/send'},
  {servername:'differentpublisher.com'},{rejectUnauthorized:false},{checkServerIdentity:()=>{}},{createConnection:()=>{}},
  {headers:{Authorization:'Bearer inert'}},{headers:{Cookie:'session=inert'}},{headers:{Host:'127.0.0.1'}},
  {headers:{Accept:'text/html\\r\\nAuthorization: inert'}},
  {headers:new Headers({Authorization:'Bearer inert'})},
  {headers:Object.assign(Object.create({Authorization:'Bearer inert'}),{Accept:'text/html'})},
 ]) await permit(config,async lookup=>assert.throws(()=>https.request(url,{...opts(lookup),...patch}),blocked));
 await permit(config,async lookup=>assert.throws(()=>https.request(url+'/different',opts(lookup)),blocked));
 await permit(config,async lookup=>assert.throws(()=>http.request(url,opts(lookup)),blocked));
});
assert.equal(created,0);assert.equal(sent,0);
`));

test('returned GET request cannot mutate credentials, payload, method or path to bypass the capability', () => child(`
await assistant(async()=>{
 for(const mutation of [
  req=>req.setHeader('Authorization','Bearer inert'),req=>req.setHeader('Cookie','session=inert'),req=>req.setHeader('Host','127.0.0.1'),
  req=>req.write('payload'),req=>req.end('payload'),req=>req.addTrailers({Authorization:'inert'}),
  req=>{req.method='POST';req.end();},req=>{req.path='/send';req.end();},
  req=>{req.method='POST';req.flushHeaders();},req=>{req.path='/send';req.flushHeaders();},
 ]) await permit(config,async lookup=>{const req=https.request(url,opts(lookup));assert.throws(()=>mutation(req));});
});
assert.equal(sent,0);
`));

test('fixed resolver capability only permits the exact Cloudflare JSON DNS GET with public bootstrap pin', () => child(`
const dns={url:'https://cloudflare-dns.com/dns-query?name=www.cosmeticsdesign-europe.com&type=1',pinnedAddress:'1.1.1.1',kind:'dns'};
await assistant(async()=>{
 for(const candidateConfig of [
  {...dns,url:dns.url.replace('cloudflare-dns.com','otherresolver.com')},
  {...dns,pinnedAddress:'8.8.8.8'}, {...dns,url:dns.url+'&extra=inert'},
  {...dns,url:dns.url.replace('type=1','type=15')},
  {...dns,url:dns.url.replace('www.cosmeticsdesign-europe.com','localhost')},
  {url:'https://127.0.0.1/private',pinnedAddress:'104.18.1.1',kind:'article'},
  {...config,pinnedAddress:'127.0.0.1'}, {...config,pinnedAddress:'10.2.3.4'},
 ]) await assert.rejects(permit(candidateConfig,async()=>{}));
 await permit(dns,async lookup=>https.request(dns.url,{...opts(lookup),headers:{Accept:'application/dns-json'}}).end());
 // Identical DNS queries share one promise within this assistant request.
 await permit(dns,async()=>{throw Error('DNS callback must not repeat');});
});
assert.equal(created,1);assert.equal(sent,1);
`));

test('a request object leaked out of its read scope cannot later send or flush headers', () => child(`
let leaked;
await assistant(async()=>{
 await permit(config,async lookup=>{leaked=https.request(url,opts(lookup));});
 assert.throws(()=>leaked.end(),blocked);
 assert.throws(()=>leaked.flushHeaders(),blocked);
});
assert.throws(()=>leaked.end(),blocked);
assert.throws(()=>leaked.flushHeaders(),blocked);
assert.equal(created,1);assert.equal(sent,0);
`));

test('closing the parent assistant revokes an unfinished background public-read request', () => child(`
let release, pending, request;
await assistant(async()=>{
 pending=permit(config,async lookup=>{
  request=https.request(url,opts(lookup));
  await new Promise(resolve=>{release=resolve;});
  assert.equal(request.destroyed,true);
  assert.throws(()=>request.end(),blocked);
  assert.throws(()=>request.flushHeaders(),blocked);
 });
});
release();await pending;
assert.equal(created,1);assert.equal(sent,0);
`));

test('request options cannot use getters or inherited transport overrides to change after validation', () => child(`
await assistant(async()=>{
 await permit(config,async lookup=>{
  const options=opts(lookup);let reads=0;
  Object.defineProperty(options,'lookup',{enumerable:true,get(){reads++;return reads===1?lookup:()=>{};}});
  assert.throws(()=>https.request(url,options),blocked);
 });
 await permit(config,async lookup=>{
  const options=Object.assign(Object.create({hostname:'127.0.0.1'}),opts(lookup));
  assert.throws(()=>https.request(url,options),blocked);
 });
 await permit(config,async lookup=>{
  const headers={};Object.defineProperty(headers,'Accept',{enumerable:true,get(){return 'text/html';}});
  assert.throws(()=>https.request(url,{...opts(lookup),headers}),blocked);
 });
});
assert.equal(created,0);assert.equal(sent,0);
`));


test('native pre-aborted ClientRequest preserves inherited path and query when the guard freezes its target', () => runChildSource(`
import assert from 'node:assert/strict';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
let socketAttempts=0,tlsConstructed=0;
// Keep the real Node ClientRequest constructor and its inherited path accessor.
// TLS construction may still occur before Node observes the aborted signal.
// Return an unconnected native socket so no external connection is possible.
net.Socket.prototype.connect=()=>{socketAttempts++;throw Error('OFFLINE_SOCKET_PROHIBITED');};
tls.connect=()=>{tlsConstructed++;const socket=new net.Socket();socket.encrypted=true;return socket;};
const {withAssistantPreviewInformation:assistant,withAssistantPreviewPublicRead:permit}=await import('./scripts/customer-preview-ai-scope.mjs');
await import('./scripts/customer-isolated-test-guard.mjs');
const url='https://www.cosmeticsdesign-europe.com/Article/research-update?lang=en&category=research';
assert.throws(()=>https.request(url),/isolated_test_network_blocked/);
await assistant(async()=>{
 await permit({url,pinnedAddress:'104.18.1.1',kind:'article'},async lookup=>{
  const cancellation=new AbortController();cancellation.abort();
  const req=https.request(url,{method:'GET',signal:cancellation.signal,agent:false,family:4,lookup,headers:{Accept:'text/html'}});
  const closed=new Promise((resolve,reject)=>{
   req.on('error',error=>{if(error.code!=='ABORT_ERR')reject(error);});
   req.once('close',resolve);
  });
  assert.equal(req.path,'/Article/research-update?lang=en&category=research');
  assert.equal(req.method,'GET');
  const path=Object.getOwnPropertyDescriptor(req,'path');
  assert.equal(path.value,'/Article/research-update?lang=en&category=research');
  assert.equal(path.writable,false);
  assert.throws(()=>{req.path='/messages';},TypeError);
  req.end();await closed;
 });
});
assert.equal(socketAttempts,0);assert.equal(tlsConstructed,1);
assert.throws(()=>https.request(url),/isolated_test_network_blocked/);
`));
