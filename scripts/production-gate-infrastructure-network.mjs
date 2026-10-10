// Test process guard: permit only sockets to ephemeral HTTP servers created by this process.
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
const tsxPipePath=pid=>path.join(os.tmpdir(),`tsx-${process.geteuid?process.geteuid():os.userInfo().username}`,`${pid}.pipe`);
import {syncBuiltinESMExports} from 'node:module';
import {writeFileSync} from 'node:fs';
const allowed=new Set(),events=[];
const listen=net.Server.prototype.listen,connect=net.Socket.prototype.connect;
net.Server.prototype.listen=function(...args){this.once('listening',()=>{const address=this.address();if(address&&typeof address==='object'&&['127.0.0.1','::1'].includes(address.address)){allowed.add(address.port);events.push({type:'isolated_listener',host:address.address,port:address.port});}});return listen.apply(this,args);};
net.Socket.prototype.connect=function(...args){let options=args[0];if(Array.isArray(options))options=options[0];const socketPath=typeof options==='string'?options:options?.path;if(socketPath===tsxPipePath(process.ppid)){events.push({type:'allowed_loader_ipc'});return connect.apply(this,args);}const host=options&&typeof options==='object'?options.host:(typeof args[1]==='string'?args[1]:'localhost');const port=Number(options&&typeof options==='object'?options.port:options);if(!['127.0.0.1','::1','localhost'].includes(host)||!allowed.has(port)){events.push({type:'blocked_socket',port:Number.isFinite(port)?port:null});throw Error('isolated_infrastructure_socket_not_authorized');}events.push({type:'allowed_ephemeral_socket',port});return connect.apply(this,args);};
syncBuiltinESMExports();
process.on('exit',()=>{if(process.env.INFRA_EVIDENCE_PATH)writeFileSync(process.env.INFRA_EVIDENCE_PATH,JSON.stringify({events},null,2));});
