import { Alert, Button, Modal, Skeleton, Tag } from 'antd';
import { Settings2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AUTH_TOKEN_CHANGED_EVENT } from '../../lib/auth';
import {
  CONTENT_GENERATION_QUEUE_CLOSE_EVENT,
  CONTENT_GENERATION_QUEUE_OPEN_EVENT,
  type ContentGenerationQueueRequest,
} from '../../lib/contentGenerationQueue';
import { digitalEmployeeApi } from '../../lib/digitalEmployeeApi';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import WeeklyTaskPackageView from './WeeklyTaskPackageView';
import CreationTaskWorkspace from './CreationTaskWorkspace';
import { OnboardingPanel } from '../smartBusiness/DigitalEmployeeOnboardingPanel';

export default function ContentGenerationQueueModal({ embedded = false, onBack }: { embedded?: boolean; onBack?: () => void } = {}) {
  const [open,setOpen]=useState(embedded),[request,setRequest]=useState<ContentGenerationQueueRequest>({requestId:0,view:'tasks', ...(embedded ? { source: 'weekly' as const } : {})});
  const [overview,setOverview]=useState<DigitalEmployeeOverview|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const [settingsOpen,setSettingsOpen]=useState(false);
  useEffect(()=>{
    if (embedded) return;
    const show=(event:Event)=>{const detail=(event as CustomEvent<ContentGenerationQueueRequest>).detail||{};setRequest(detail);setSettingsOpen(false);setOpen(true);};
    const hide=()=>{setSettingsOpen(false);setOpen(false);};
    const reset=()=>{setSettingsOpen(false);setOpen(false);setOverview(null);setError('');};
    const storage=(event:StorageEvent)=>{if(event.key===null||event.key==='overseas_token')reset();};
    window.addEventListener(CONTENT_GENERATION_QUEUE_OPEN_EVENT,show);window.addEventListener(CONTENT_GENERATION_QUEUE_CLOSE_EVENT,hide);window.addEventListener(AUTH_TOKEN_CHANGED_EVENT,reset);window.addEventListener('storage',storage);
    return()=>{window.removeEventListener(CONTENT_GENERATION_QUEUE_OPEN_EVENT,show);window.removeEventListener(CONTENT_GENERATION_QUEUE_CLOSE_EVENT,hide);window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT,reset);window.removeEventListener('storage',storage);};
  },[embedded]);
  useEffect(()=>{
    if(!open)return;let active=true;setLoading(true);setError('');
    void digitalEmployeeApi.overview().then(result=>{if(active)setOverview(result);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'内容生成任务暂时无法读取');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[open,revision]);
  const title = <div data-growth-tour="queue-modal" className="flex flex-wrap items-center justify-between gap-3 pr-8"><div className="flex items-center gap-2"><span>{settingsOpen?'Agent 设置':request.source==='weekly'?'周任务包':'内容生成队列'}</span>{!settingsOpen&&<Tag color="blue">{request.source==='weekly'?'本周全部计划任务':'周计划 + 临时单条'}</Tag>}</div><Button icon={<Settings2 size={16}/>} onClick={()=>setSettingsOpen(value=>!value)}>{settingsOpen?(request.source==='weekly'?'返回周任务包':'返回任务列表'):'Agent 设置'}</Button></div>;
  const content = <>
    {settingsOpen ? <>{error && <Alert className="mb-4" type="warning" showIcon title="Agent 设置暂不可用" description={error}/>} {overview?.config ? <OnboardingPanel key={revision} initial={overview.config} readiness={overview.businessSnapshot?.readiness || []} busy={loading} mode="rules" initialSettingsOpen activeRun={Boolean(overview.run && ['running','planning','initializing'].includes(overview.run.status))} onOpenReadiness={item=>setError(`${item.label}请在账号管理中配置`)} onSave={async config=>{try{setLoading(true);setError('');const next=await digitalEmployeeApi.completeOnboarding(config);setOverview(next);setSettingsOpen(false);setRevision(value=>value+1);return true;}catch(cause){setError(cause instanceof Error?cause.message:'Agent 设置保存失败');return false;}finally{setLoading(false);}}}/> : <Alert type="warning" title="企业配置尚未就绪" description="请先完成企业资料确认。"/>}</> : <>
    <p className="mb-4 text-sm text-text-secondary">{request.source==='weekly'?'这里展示本周经营目标、全部计划阶段、任务依赖、负责 Agent 和真实运行状态；内容制作与发布只是其中环节。':'所有入口均查看这一份任务队列；可切换任务列表与发布日历，关闭后返回原页面。'}</p>
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
    {loading&&!overview?<Skeleton active paragraph={{rows:10}}/>:overview?(request.source==='weekly'?<WeeklyTaskPackageView data={overview}/>:<CreationTaskWorkspace data={overview} request={request} onRefresh={()=>setRevision(value=>value+1)}/>):null}
    </>}
  </>;
  if (embedded) return <div className="flex h-full min-h-0 flex-col"><header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3"><Button onClick={onBack} aria-label="返回灵小枢对话">返回</Button><div className="min-w-0 flex-1">{title}</div></header><div className="assistant-work-scroller">{content}</div></div>;
  return <Modal open={open} onCancel={()=>{setSettingsOpen(false);setOpen(false);}} footer={null} width="min(1320px, 96vw)" destroyOnHidden styles={{body:{maxHeight:'calc(100dvh - 150px)',overflowY:'auto',paddingTop:8}}} title={title}>{content}</Modal>;
}
