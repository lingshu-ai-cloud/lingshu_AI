import test from 'node:test';
import assert from 'node:assert/strict';
import {MaterialRecoveryRejected,recoverMeasuredMaterial} from './socialMeasuredMaterialRecoveryApi';
const command={action:'resume_material_supply' as const,jobId:'job',runId:'run',expectedVersion:'v1',slotId:'slot',materialId:'material'};
test('恢复仅发送原槽、素材和原任务身份，并拒绝其他运行回执',async()=>{
 const old=globalThis.fetch;Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=> 'token'}});
 try {globalThis.fetch=async(url,init)=>{assert.match(String(url),/tasks\/task\/recover-execution$/);assert.deepEqual(JSON.parse(String(init?.body)),command);assert.equal((init?.headers as Record<string,string>)['Idempotency-Key'],'operation');return Response.json({taskId:'task',runId:'run',jobId:'job',status:'queued'});};
 assert.equal((await recoverMeasuredMaterial('task',command,'operation')).status,'queued');
 globalThis.fetch=async()=>Response.json({taskId:'task',runId:'other',jobId:'job',status:'queued'});
 await assert.rejects(recoverMeasuredMaterial('task',command,'operation'),/不一致/);
 globalThis.fetch=async()=>Response.json({code:'content_execution_material_recovery_material_not_eligible'},{status:409});
 await assert.rejects(recoverMeasuredMaterial('task',command,'operation'),MaterialRecoveryRejected);
 }finally{globalThis.fetch=old;}
});
