import type { AssistantCreationPortal } from '../../shared/contracts/assistantCreationPortal';
import type { CreateSocialContentTaskInput } from '../../shared/contracts/socialContentWorkflow';
import { replicationConfirmationKey } from './assistantReplicationConfirmation';
type Receipt=NonNullable<AssistantCreationPortal['createdTasks']>[number];

/** Resume only unfinished task/source writes, using the exact frozen intake identity. */
export async function resumeSceneTaskBatch(input:{
  groupId:string;rows:Array<{id:string;input:CreateSocialContentTaskInput}>;receipts:Receipt[];
  current:()=>boolean;onReceipt:(receipt:Receipt)=>void;
  create:(value:CreateSocialContentTaskInput,key:string)=>Promise<{taskId:string;brief:{title:string}}>;
  start?:(taskId:string)=>Promise<{receipt:{queued?:boolean;started?:boolean;blockedReason?:string}}>;
  attach?:(taskId:string)=>Promise<unknown>;
}) {
  for(const row of input.rows){
    if(!input.current())return;
    let receipt=input.receipts.find(item=>item.itemId===row.id);
    if(!receipt){
      const key=await replicationConfirmationKey(`${input.groupId}:${row.id}`,row.input);
      if(!input.current())return;
      const task=await input.create(row.input,key);
      receipt={itemId:row.id,taskId:task.taskId,title:task.brief.title,sourceAttached:false};
      if(!input.current())return;input.onReceipt(receipt);
    }
    if(input.attach&&!receipt.sourceAttached){
      if(!input.current())return;
      await input.attach(receipt.taskId);
      if(!input.current())return;receipt={...receipt,sourceAttached:true};input.onReceipt(receipt);
    }
    if(input.start&&!receipt.startRequested){
      if(!input.current())return;
      const {receipt: admission}=await input.start(receipt.taskId);
      if(!input.current())return;
      const executionState=admission.started?'running':admission.queued?'queued':admission.blockedReason?'blocked':'saved';
      input.onReceipt({...receipt,startRequested:executionState==='running'||executionState==='queued',executionState,blockedReason:admission.blockedReason});
    }
  }
}
