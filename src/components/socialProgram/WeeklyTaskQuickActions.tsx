import {useEffect,useRef,useState} from 'react';
import {Alert,Button,Descriptions} from 'antd';
import {socialProgramApi} from '../../lib/socialProgramApi';
import {WEEKLY_AUTOMATION_TEMPLATE as defaults} from '../../../shared/weeklyAutomationTemplate';
import type {AgentCalendarTask} from '../smartBusiness/AgentWeeklyCalendar';
import {authHeader,getToken} from '../../lib/auth';
type AuditItem={taskId:string;ownReasons:Array<{code:string;category:string}>;rootCauses:Array<{code:string}>};
const labels:Record<string,string>={business_goal_unavailable:'补充真实 WhatsApp 承接入口',capacity_plan_unavailable:'补齐资源容量',automation_policy_unavailable:'核验自动执行能力',weekly_initial_capacity_schedule_required:'补排任务、调整范围及资源窗口',business_dispatch_required:'完成排期并派单',benchmark_account_video_link_required:'补齐对标账号和视频关联',weekly_preproduction_authority_required:'采用真实采集范围并绑定原任务',weekly_preproduction_outline_goal_not_ready:'补齐经营目标的真实入口',customer_agent_not_enabled:'启用客服智能体',tenant_real_customer_messages_not_authorized:'补充真实消息授权',followup_background_worker_disabled:'渠道授权后核验客服消费者',whatsapp_provider_not_ready:'连接 WhatsApp 账号',messenger_provider_not_ready:'连接 Messenger 账号',instagram_provider_not_ready:'连接 Instagram 账号'};
export default function WeeklyTaskQuickActions({sources,onOpen,onPlanning}:{sources:AgentCalendarTask[];onOpen(task:AgentCalendarTask):void;onPlanning?:()=>void}){
 const targets=sources.filter(s=>s.workspaceTarget),target=targets[0]?.workspaceTarget ?? null;
 const identity=JSON.stringify(targets.map(s=>s.workspaceTarget)),current=useRef(identity);current.current=identity;
 const [items,setItems]=useState<AuditItem[]>([]),[adopted,setAdopted]=useState<string|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{if(!target)return;let live=true;const token=getToken();setItems([]);setError('');setAdopted(null);const base=`/api/overseas/social-programs/${encodeURIComponent(target.programId)}/operating-packages/${encodeURIComponent(target.packageId)}/execution-pipeline`;async function read(selected:NonNullable<typeof target>){try{const r=await fetch(`${base}/task-audit?version=${selected.packageVersion}`,{headers:authHeader()});const body=await r.json();if(!r.ok)throw Error(body.message||'任务缺项核验失败');const a=await socialProgramApi.readWeeklyTemplate(selected.programId,selected.packageId,selected.packageVersion);if(live&&getToken()===token){setItems(body.item.items.filter((i:AuditItem)=>targets.some(t=>t.workspaceTarget!.executionTaskId===i.taskId)));setAdopted(a?.adoptedAt??null);}}catch(e){if(live&&getToken()===token)setError(e instanceof Error?e.message:String(e));}}void read(target);return()=>{live=false;};},[identity]);
 async function adopt(){if(!target)return;const captured=identity,token=getToken();setBusy(true);setError('');try{const result=await socialProgramApi.adoptWeeklyTemplate(target.programId,target.packageId,target.packageVersion);if(current.current===captured&&getToken()===token)setAdopted(result.adoptedAt);}catch(e){if(current.current===captured)setError(e instanceof Error?e.message:String(e));}finally{if(current.current===captured)setBusy(false);}}
 const codes=[...new Set(items.flatMap(i=>[...i.ownReasons,...i.rootCauses].map(r=>r.code)))];
 if(!target)return null;
 return <section aria-label="任务快捷行动与默认模板" className="space-y-3 border-t border-border pt-4"><h4 className="font-semibold">快捷行动与默认模板</h4>
 <Descriptions size="small" column={1} items={[{key:'price',label:'成片费用',children:'每条不超过 ¥15；不再单独要求确认整周预算'},{key:'cta',label:'默认 CTA',children:defaults.callToAction},{key:'crawl',label:'采集规则',children:'从货盘、公司资料与行业词生成5个搜索词；每天最多采集10条，不设置采集金额上限'},{key:'clock',label:'执行窗口',children:'普通任务06:00起按依赖执行；常驻客服00:00至次日00:00'},{key:'adopt',label:'模板留痕',children:adopted?`已自动采用 · ${adopted}；不代表授权或验收通过`:'尚未留痕，启动任务时自动采用'}]}/>
 {!adopted&&<Button loading={busy} onClick={()=>void adopt()}>应用默认模板（无需审批）</Button>}
 {error&&<Alert type="error" showIcon title={error}/>}
 {onPlanning&&<Button onClick={onPlanning}>补排或调整任务范围</Button>}
 {codes.length>0&&<div className="space-y-2"><h5 className="text-sm font-semibold">对应缺项</h5>{codes.map(code=>{const customer=/customer|messenger|whatsapp|instagram|followup/.test(code);const source=targets.find(t=>customer?t.agent==='customer':t.executionStep==='business_outline'||t.executionStep==='business_schedule')??targets[0]!;return <div key={code} className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 text-sm">{labels[code]??code}</span><Button size="small" onClick={()=>!customer&&onPlanning?onPlanning():onOpen(source)}>处理此缺项</Button></div>;})}</div>}
 <p className="text-xs text-text-secondary">渠道缺项在执行中补充；成片验收和发布许可进入“发布与渠道”。只有真实执行开始才移除缺项提示，真实交付完成后显示对勾。</p></section>;
}
