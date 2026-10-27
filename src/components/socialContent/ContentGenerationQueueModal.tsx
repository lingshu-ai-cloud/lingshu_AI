import { Alert, Button, Modal, Skeleton, Tag } from 'antd';
import { Settings2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AUTH_TOKEN_CHANGED_EVENT } from '../../lib/auth';
import {
  CONTENT_GENERATION_QUEUE_OPEN_EVENT,
  type ContentGenerationQueueRequest,
} from '../../lib/contentGenerationQueue';
import { digitalEmployeeApi } from '../../lib/digitalEmployeeApi';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import CreationTaskWorkspace from './CreationTaskWorkspace';

export default function ContentGenerationQueueModal({ onOpenAgentSettings }: { onOpenAgentSettings: () => void }) {
  const [open,setOpen]=useState(false),[request,setRequest]=useState<ContentGenerationQueueRequest>({requestId:0,view:'tasks'});
  const [overview,setOverview]=useState<DigitalEmployeeOverview|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{
    const show=(event:Event)=>{const detail=(event as CustomEvent<ContentGenerationQueueRequest>).detail||{};setRequest(detail);setOpen(true);};
    const reset=()=>{setOpen(false);setOverview(null);setError('');};
    const storage=(event:StorageEvent)=>{if(event.key===null||event.key==='overseas_token')reset();};
    window.addEventListener(CONTENT_GENERATION_QUEUE_OPEN_EVENT,show);window.addEventListener(AUTH_TOKEN_CHANGED_EVENT,reset);window.addEventListener('storage',storage);
    return()=>{window.removeEventListener(CONTENT_GENERATION_QUEUE_OPEN_EVENT,show);window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT,reset);window.removeEventListener('storage',storage);};
  },[]);
  useEffect(()=>{
    if(!open)return;let active=true;setLoading(true);setError('');
    void digitalEmployeeApi.overview().then(result=>{if(active)setOverview(result);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'内容生成任务暂时无法读取');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[open,revision]);
  return <Modal open={open} onCancel={()=>setOpen(false)} footer={null} width="min(1320px, 96vw)" destroyOnHidden
    styles={{body:{maxHeight:'calc(100dvh - 150px)',overflowY:'auto',paddingTop:8}}}
    title={<div className="flex flex-wrap items-center justify-between gap-3 pr-8"><div className="flex items-center gap-2"><span>内容生成队列</span><Tag color="blue">周计划 + 临时单条</Tag></div><Button icon={<Settings2 size={16}/>} onClick={()=>{setOpen(false);onOpenAgentSettings();}}>Agent 设置</Button></div>}>
    <p className="mb-4 text-sm text-text-secondary">所有入口均查看这一份任务队列；按任务来源、状态或发布日历筛选，关闭后返回原页面。</p>
    {error && (
      <Alert
        className="mb-4"
        type="warning"
        showIcon
        title="内容生成队列暂时无法读取"
        description={error}
        action={<Button onClick={()=>setRevision(value=>value+1)}>重试</Button>}
      />
    )}
    {loading&&!overview?<Skeleton active paragraph={{rows:10}}/>:overview?<CreationTaskWorkspace data={overview} request={request} onRefresh={()=>setRevision(value=>value+1)}/>:null}
  </Modal>;
}
