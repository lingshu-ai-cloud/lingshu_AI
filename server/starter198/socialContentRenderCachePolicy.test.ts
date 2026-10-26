import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {DataStore} from '../storage/datastore.js';
import {runWithContentExecutionContext} from '../contentExecution/context.js';
import {socialRequestHash} from './socialContentValidation.js';
import {executeSocialRenderStage} from './socialContentProductionStages.js';

test('normal render stage replaces a valid old-policy cache once, then reuses the new-policy byte receipt',async()=>{
 const previousCwd=process.cwd(),root=await mkdtemp(path.join(os.tmpdir(),'render-policy-'));
 try{
  process.chdir(root);
  const manifest={spec:{duration:1},timeline:[],subtitles:{mode:'off',cues:[]}};
  const scope=createHash('sha256').update(JSON.stringify(['tenant','task','run'])).digest('hex');
  const directory=path.resolve('data/content-execution-render',scope);await mkdir(directory,{recursive:true});
  const oldBytes='old misaligned video',oldSha=createHash('sha256').update(oldBytes).digest('hex'),oldHash=socialRequestHash(manifest);
  const oldPath=path.join(directory,oldSha+'.mp4');await writeFile(oldPath,oldBytes);
  let checkpoints:Record<string,unknown>={'social.graph_render':{version:'1',inputHash:oldHash,payload:{cachePath:oldPath,sha256:oldSha,inputHash:oldHash},updatedAt:new Date().toISOString()}};
  const store:DataStore={
   getById:async<T>(_collection:string,id:string)=>({id,tenant_id:'tenant',task_id:'task',run_id:'run',status:'running'} as T),
   list:async<T>()=>({items:[] as T[],totalItems:0,totalPages:1,page:1,perPage:20}),
   create:async()=>null,delete:async()=>false,
   update:async(_collection,_id,value)=>{if(value.checkpoints)checkpoints=value.checkpoints as Record<string,unknown>;return true;},
  };
  const outputPath=path.join(root,'new.mp4');await writeFile(outputPath,'new aligned video');let renders=0;
  const render=async()=>{renders++;return {ok:true as const,outputPath};};
  const run=()=>runWithContentExecutionContext({dataStore:store,jobId:'job',checkpoints,action:()=>executeSocialRenderStage({tenantId:'tenant',taskId:'task',runId:'run',manifest:manifest as never,outputDirectory:root,render})});
  const first=await run();assert.equal(first.reused,false);assert.equal(renders,1);assert.notEqual(first.receipt.inputHash,oldHash);
  assert.equal((checkpoints['social.graph_render'] as {version:string}).version,'2');
  const second=await run();assert.equal(second.reused,true);assert.equal(renders,1);assert.equal(second.receipt.sha256,first.receipt.sha256);
 }finally{process.chdir(previousCwd);await rm(root,{recursive:true,force:true});}
});
