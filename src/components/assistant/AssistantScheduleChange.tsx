import { useState } from 'react';
import { Alert, Button, Modal } from 'antd';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import type { CreationTaskRow } from '../../lib/creationTaskWorkspace';
import { calendarDateTimeValue } from '../../lib/calendarModel';
import { assistantSchedulePreview, assistantScheduleTarget, assistantTaskScheduleChanges } from '../../lib/assistantScheduleChange';
import { digitalEmployeeApi } from '../../lib/digitalEmployeeApi';
import { socialContentApi } from '../../lib/socialContentApi';
import AssistantSceneDateInput from './AssistantSceneDateInput';

export default function AssistantScheduleChange({row,rows,goal,onChanged}:{row:CreationTaskRow;rows:CreationTaskRow[];goal:DigitalEmployeeOverview['goal'];onChanged:()=>void}) {
  const target=assistantScheduleTarget(row,goal?.id||'');
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [localTime,setLocalTime]=useState('');
  if(!target)return null;
  const openChange=()=>{setError('');setLocalTime(row.publishAt&&row.publishAt.length>10?calendarDateTimeValue(row.publishAt):`${row.publishAt||new Date().toISOString().slice(0,10)}T18:00`);setOpen(true);};
  let preview:ReturnType<typeof assistantSchedulePreview>|null=null,previewError='';
  if(open&&localTime)try{preview=assistantSchedulePreview(row,localTime,rows,goal||undefined);}catch(cause){previewError=cause instanceof Error?cause.message:'改期输入无效';}
  const confirm=async()=>{
    if(!preview||busy)return;
    setBusy(true);setError('');
    try {
      if(target.kind==='weekly')await digitalEmployeeApi.reschedulePublication(target.goalId,target.contentId,preview.instant);
      else await socialContentApi.updateTask(target.taskId,assistantTaskScheduleChanges(target,preview.instant),`assistant-schedule:${target.taskId}:${target.expectedVersion}:${preview.instant}`);
      setOpen(false);onChanged();
    }catch(cause){setError(cause instanceof Error?cause.message:'改期结果待核验，请刷新后检查原任务。');onChanged();}
    finally{setBusy(false);}
  };
  return <><Button onClick={openChange}>调整发布时间</Button>
    <Modal title="核对发布时间调整" open={open} onCancel={()=>!busy&&setOpen(false)} footer={<><Button disabled={busy} onClick={()=>setOpen(false)}>取消</Button><Button type="primary" loading={busy} disabled={!preview||preview.instant===row.publishAt} onClick={()=>void confirm()}>确认调整</Button></>}>
      <div className="space-y-3">
        <p className="text-sm">{row.title}</p>
        <p className="text-sm">原计划：{row.publishAt||'时间待定'}（北京时间）</p>
        <label className="block text-sm">新发布时间（北京时间）<AssistantSceneDateInput label="新的发布时间" value={localTime} onChange={setLocalTime}/></label>
        {previewError&&<Alert type="warning" title={previewError}/>}
        {preview&&<><p className="text-sm">新计划：{localTime.replace('T',' ')}（北京时间）</p>
          <p className="text-xs text-text-secondary">影响：本条内容的计划发布时间；原成片交付截止 {preview.deliverBy||'未设置'}。</p>
          {!!preview.sameAccount.length&&<Alert type="info" title={`同账号当天另有 ${preview.sameAccount.length} 条内容，请检查发布间隔。`}/>}
          <p className="text-xs text-text-secondary">仅更新原任务的计划时间；实际发布仍以审批和平台回执为准。</p></>}
        {error&&<Alert type="warning" title={error}/>}
      </div>
    </Modal>
  </>;
}
