// Loaded only by the offline production-budget regression command. Tests may
// replace fetch with fixtures; real remote sockets remain forbidden.
import net from 'node:net';
import {syncBuiltinESMExports} from 'node:module';
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
  const normalized=Array.isArray(args[0])?args[0]:args;
  const options=typeof normalized[0]==='object'?normalized[0]:null;
  const host=options?.host??(typeof normalized[1]==='string'?normalized[1]:'localhost');
  if(!options?.path&&!['localhost','127.0.0.1','::1'].includes(host))
    throw Error('offline_regression_remote_socket_forbidden');
  return connect.apply(this,args);
};
syncBuiltinESMExports();
