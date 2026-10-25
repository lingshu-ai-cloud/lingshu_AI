import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Select } from 'antd';
import type { AssistantCreationPortal } from '../../../shared/contracts/assistantCreationPortal';
import { contentPlanFormInput, type ContentPlanFormValues } from '../../lib/contentPlanForm';
import { resumeSceneTaskBatch } from '../../lib/assistantSceneTaskBatch';
import { socialContentApi } from '../../lib/socialContentApi';
import { studioApi } from '../../lib/studioApi';
import { AUTH_TOKEN_CHANGED_EVENT } from '../../lib/auth';
import { productionNavigationIdentity } from '../../lib/productionNavigation';

type Receipt=NonNullable<AssistantCreationPortal['createdTasks']>[number];
export default function CreateContentPlanModal({open,onCancel,onCreated}:{open:boolean;onCancel:()=>void;onCreated:(taskId:string)=>void}) {
  const [form]=Form.useForm<ContentPlanFormValues>();
  const [products,setProducts]=useState<Array<{id:string;name:string}>>([]),[loading,setLoading]=useState(false),[loadError,setLoadError]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[locked,setLocked]=useState(false),[revision,setRevision]=useState(0);
  const draftId=useRef(`plan-${crypto.randomUUID()}`),receipts=useRef<Receipt[]>([]);
  const frozen=useRef<ReturnType<typeof contentPlanFormInput>|null>(null),submitLock=useRef(false);
  const identity=useRef(productionNavigationIdentity());
  const reset=()=>{form.resetFields();frozen.current=null;receipts.current=[];draftId.current=`plan-${crypto.randomUUID()}`;setLocked(false);setError('');};
  useEffect(()=>{
    const resetIdentity=()=>{identity.current=productionNavigationIdentity();reset();setProducts([]);onCancel();};
    const storage=(event:StorageEvent)=>{if(event.key===null||event.key==='overseas_token')resetIdentity();};
    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT,resetIdentity);window.addEventListener('storage',storage);
    return()=>{window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT,resetIdentity);window.removeEventListener('storage',storage);};
  },[onCancel,form]);
  useEffect(()=>{
    if(!open)return;let active=true;const scope=productionNavigationIdentity();identity.current=scope;
    setLoading(true);setLoadError('');
    void studioApi.materialProducts().then(result=>{if(active&&scope===productionNavigationIdentity())setProducts(result.items);})
      .catch(()=>{if(active)setLoadError('产品资料读取失败，请重试。');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[open,revision]);
  const submit=async(values:ContentPlanFormValues)=>{
    if(submitLock.current)return;const scope=identity.current;
    if(scope!==productionNavigationIdentity())return;
    const current=()=>scope===productionNavigationIdentity();
    submitLock.current=true;setBusy(true);setError('');
    try{
      const input=frozen.current||contentPlanFormInput(values,products,draftId.current);
      frozen.current=input;setLocked(true);
      await resumeSceneTaskBatch({groupId:draftId.current,rows:[{id:'content',input}],receipts:receipts.current,current,
        create:socialContentApi.createTask,
        start:async(taskId)=>{
          const task=await socialContentApi.getTask(taskId);
          try{return await socialContentApi.startAssistantAction(taskId,task.version,`assistant-start:${taskId}:${task.version}`);}
          catch(cause){
            if(!current())throw cause;
            const latest=await socialContentApi.getTask(taskId);
            if(latest.executionAdmission||latest.runId)return latest;
            throw cause;
          }
        },
        onReceipt:receipt=>{receipts.current=[receipt];},
      });
      const taskId=receipts.current[0]?.taskId;
      if(current()&&taskId){reset();onCreated(taskId);}
    }catch(cause){if(current())setError(cause instanceof Error?cause.message:'创建结果暂未核验，请重试原请求。');}
    finally{submitLock.current=false;setBusy(false);}
  };
  return <Modal title="创建一条新计划" open={open} onCancel={()=>{if(!busy)onCancel();}} footer={<div className="flex justify-end gap-2"><Button disabled={busy} onClick={onCancel}>取消</Button><Button type="primary" loading={busy} disabled={!locked&&(loading||Boolean(loadError))} onClick={()=>form.submit()}>{locked?'重试原请求':'确认本条创作任务'}</Button></div>} centered width={560} styles={{body:{maxHeight:'calc(100dvh - 180px)',overflowY:'auto'}}} maskClosable={!busy} closable={!busy} keyboard={!busy}>
    <Form form={form} layout="vertical" onFinish={values=>void submit(values)} disabled={busy||locked} className="pt-4">
      <Form.Item name="title" label="任务名称" rules={[{required:true,whitespace:true,message:'请填写任务名称。'}]}><Input maxLength={120} placeholder="例如：新品使用场景介绍"/></Form.Item>
      <Form.Item name="productIds" label="推广产品" rules={[{required:true,type:'array',min:1,message:'请至少选择一款产品。'}]}>
        <Select mode="multiple" showSearch optionFilterProp="label" maxTagCount="responsive" loading={loading} disabled={busy||locked||loading||Boolean(loadError)} placeholder="搜索并选择一款或多款产品" options={products.map(product=>({value:product.id,label:product.name}))}/>
      </Form.Item>
      {loadError&&<Alert type="warning" title={loadError} action={<Button disabled={busy} onClick={()=>setRevision(value=>value+1)}>重试</Button>} className="mb-4"/>}
      <Form.Item name="direction" label="创作方向" rules={[{required:true,whitespace:true,message:'请填写本条内容的创作方向。'}]}><Input.TextArea rows={3} maxLength={1000} placeholder="想表达什么内容、突出哪些产品特点？"/></Form.Item>
      <Form.Item name="publishAt" label="预计发布时间（北京时间）" rules={[{required:true,message:'请选择预计发布时间。'}]}><Input type="datetime-local"/></Form.Item>
    </Form>
    {error&&<Alert showIcon type="warning" title={error} description={locked?'任务及本次输入已保留，重试会继续原请求。':undefined} className="mb-4"/>}
  </Modal>;
}
