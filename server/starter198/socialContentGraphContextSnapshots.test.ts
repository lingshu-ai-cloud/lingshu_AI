import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {compactGraphContextSnapshot,readGraphContextSnapshot} from './socialContentGraphContextSnapshots.js';
test('compact frozen plan retains exact content and rejects damaged snapshot without a silent replan',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'graph-snapshot-'));
 try{
  const context={version:'78',agentWorkflow:{selectedVoiceId:'real-voice',scenes:Array.from({length:37},(_,i)=>({id:i,text:'Approved narration'.repeat(100)}))},assetSupplyPlan:{planVersion:'78'}};
  const payload={executor:'langgraph',inputHash:'original-funded-scope',approvedContext:context};
  const compact=compactGraphContextSnapshot(payload,root);
  assert.equal(compact.approvedContext,undefined);assert.ok(JSON.stringify(compact).length<300);
  assert.deepEqual(readGraphContextSnapshot(compact,root),context);
  assert.deepEqual(compactGraphContextSnapshot(compact,root),compact);
  fs.writeFileSync(path.join(root,String(compact.approvedContextHash)+'.json'),JSON.stringify({...context,version:'unapproved'}));
  assert.throws(()=>readGraphContextSnapshot(compact,root),/snapshot_changed/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
