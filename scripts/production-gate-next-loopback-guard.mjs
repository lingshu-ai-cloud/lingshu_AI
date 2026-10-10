// Test-only preload; not an application/worker dependency.
// Only this process's ephemeral test listeners and exact tsx IPC are permitted.
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {writeFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const loopback=host=>['127.0.0.1','localhost','::1','[::1]'].includes(String(host||'localhost').toLowerCase());
const pipe=pid=>path.join(os.tmpdir(),`tsx-${process.geteuid?process.geteuid():os.userInfo().username}`,`${pid}.pipe`);
const ports=new Set(),events=[];
const refuse=(kind,port)=>{events.push({type:'blocked',kind,port:Number.isFinite(Number(port))?Number(port):null,caller:String(new Error('local audit block').stack).split('\n').slice(2,12)});process.exitCode=1;throw Object.assign(Error(`LOCAL_AUDIT_NETWORK_DENIED:${kind}`),{code:'LOCAL_AUDIT_NETWORK_DENIED'});};
const socketConnect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
 const first=Array.isArray(args[0])?args[0][0]:args[0];
 const socketPath=typeof first==='string'?first:first?.path;
 if(socketPath){if(socketPath!==pipe(process.ppid))refuse('ipc');events.push({type:'allowed_loader_ipc'});return socketConnect.apply(this,args);}
 const host=typeof first==='object'&&first!==null?first.host:typeof args[1]==='string'?args[1]:'localhost';
 const port=Number(typeof first==='object'&&first!==null?first.port:first);
 if(!loopback(host)||!ports.has(port))refuse('socket',port);
 events.push({type:'allowed_ephemeral_socket',port});return socketConnect.apply(this,args);
};
const serverListen=net.Server.prototype.listen;
net.Server.prototype.listen=function(...args){
 if(typeof args[0]==='string'||args[0]?.path){const socketPath=typeof args[0]==='string'?args[0]:args[0].path;if(socketPath!==pipe(process.pid))refuse('ipc-listener');return serverListen.apply(this,args);}
 const requestedPort=typeof args[0]==='number'?args[0]:args[0]?.port;
 if(Number(requestedPort)!==0)refuse('non-ephemeral-listener',requestedPort);
 if(typeof args[0]==='number'){
  if(typeof args[1]==='string'){if(!loopback(args[1]))refuse('listener');args[1]='127.0.0.1';}
  else args.splice(1,0,'127.0.0.1');
 }else if(args[0]&&typeof args[0]==='object'){
  if(args[0].host&&!loopback(args[0].host))refuse('listener');args[0]={...args[0],host:'127.0.0.1'};
 }else refuse('listener');
 let ownedPort;
 this.once('listening',()=>{const address=this.address();if(!address||typeof address!=='object'||address.address!=='127.0.0.1')refuse('listener-address');ownedPort=address.port;ports.add(ownedPort);events.push({type:'isolated_listener',port:ownedPort,host:address.address});});
 this.once('close',()=>{ports.delete(ownedPort);events.push({type:'closed_listener',port:ownedPort});});
 return serverListen.apply(this,args);
};
const realFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url),port=Number(url.port||(url.protocol==='https:'?443:80));
 if(!['http:','https:'].includes(url.protocol)||!loopback(url.hostname)||!ports.has(port))refuse('fetch',port);
 return realFetch(input,init);
};
syncBuiltinESMExports();
process.on('exit',()=>{if(process.env.NEXT_AUDIT_NETWORK_EVIDENCE)writeFileSync(process.env.NEXT_AUDIT_NETWORK_EVIDENCE,JSON.stringify({events},null,2));if(events.some(e=>e.type==='blocked'))process.stderr.write('LOCAL_AUDIT_NETWORK_DENIED\n');});
