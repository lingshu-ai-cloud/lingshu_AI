import childProcess from 'node:child_process';
import workerThreads from 'node:worker_threads';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {realpathSync,readFileSync} from 'node:fs';
export function installIsolatedProcesses(guardUrl,blocked) {
 const originals=[];
 const guardPath=fileURLToPath(guardUrl);
 const require=createRequire(import.meta.url);
 let compiler;try{const tsxRequire=createRequire(require.resolve('tsx/package.json'));const esbuildRequire=createRequire(tsxRequire.resolve('esbuild/package.json'));const version=JSON.parse(readFileSync(tsxRequire.resolve('esbuild/package.json'),'utf8')).version;compiler={path:realpathSync(esbuildRequire.resolve(`@esbuild/${process.platform}-${process.arch}/bin/esbuild`)),version};}catch{/* No native compiler exception if it cannot be resolved. */}
 const preload=`--import=${JSON.stringify(guardPath)}`;
 function options(command,value={},args=[]) {
  if(!value.shell&&compiler&&args.length===2&&args[0]===`--service=${compiler.version}`&&args[1]==='--ping'){try{if(realpathSync(String(command))===compiler.path)return value;}catch{}}
  // Shells and arbitrary executables cannot inherit a JavaScript network guard.
  if(value.shell||path.resolve(String(command))!==path.resolve(process.execPath))throw blocked('child_process');
  return {...value,env:{...(value.env||process.env),...(process.env.CUSTOMER_ISOLATION_CANARY==='1'?{CUSTOMER_ISOLATION_CANARY:'1'}:{}),NODE_OPTIONS:`${preload} ${value.env?.NODE_OPTIONS??process.env.NODE_OPTIONS??''}`.trim()}};
 }
 for(const key of ['spawn','spawnSync','execFile','execFileSync']) {
  const original=childProcess[key];
  childProcess[key]=function(command,args,opts,...rest){
   if(!Array.isArray(args)){rest=[opts,...rest];opts=args;args=[];}
   const callback=typeof opts==='function'?opts:undefined;
   return original.call(this,command,args,options(command,callback?{}:opts,args),...(callback?[callback]:rest.filter(v=>v!==undefined)));
  };
  originals.push([childProcess,key,childProcess[key]]);
 }
 const fork=childProcess.fork;
 childProcess.fork=function(modulePath,args,opts){if(!Array.isArray(args)){opts=args;args=[];}return fork.call(this,modulePath,args,options(opts?.execPath||process.execPath,opts));};
 for(const key of ['exec','execSync'])childProcess[key]=()=>{throw blocked('child_process_shell');};
 for(const key of ['fork','exec','execSync'])originals.push([childProcess,key,childProcess[key]]);
 const Worker=workerThreads.Worker;
 workerThreads.Worker=class extends Worker {
  constructor(filename,opts={}){
   const entry=opts.eval?`const {createRequire}=await import('node:module');const require=createRequire(${JSON.stringify(pathToFileURL(path.join(process.cwd(),'worker-eval.cjs')).href)});${filename}`:`await import(${JSON.stringify(filename instanceof URL?filename.href:pathToFileURL(path.resolve(filename)).href)});`;
   const wrapper=new URL('data:text/javascript,'+encodeURIComponent(`await import(${JSON.stringify(guardUrl)});${entry}`));
   super(wrapper,{...opts,eval:false,...(opts.env&&typeof opts.env==='object'&&process.env.CUSTOMER_ISOLATION_CANARY==='1'?{env:{...opts.env,CUSTOMER_ISOLATION_CANARY:'1'}}:{}),execArgv:['--import',guardPath,...(opts.execArgv||process.execArgv)]});
  }
 };
 originals.push([workerThreads,'Worker',workerThreads.Worker]);
 return ()=>originals.every(([object,key,value])=>object[key]===value);
}
