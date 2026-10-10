import { agentCalendarDemo } from "./agentCalendarDemo";
import { agentCalendarEstablishedDemo } from './agentCalendarEstablishedDemo';
import { useEffect, useState } from "react";
import SmartBusinessDashboard, { type SmartBusinessView } from "../components/SmartBusinessDashboard";
import SmartOperationsAccountRail from "../components/SmartOperationsAccountRail";
import type { DigitalEmployeeOverview } from "../lib/digitalEmployees";
import { SocialProgramProvider } from "../contexts/SocialProgramContext";
import coverA from "../assets/covers/mock-8.png";
import coverB from "../assets/covers/mock-20.png";

const publishingTargets = [
  { platform:"youtube",accountId:"yt-main",accountLabel:"Lingshu Factory" },
  { platform:"instagram",accountId:"ig-main",accountLabel:"Lingshu Products" },
  { platform:"facebook",accountId:"fb-main",accountLabel:"Lingshu Global" },
  { platform:"tiktok",accountId:"tt-main",accountLabel:"Lingshu Lab" },
] as const;

const previewReady = {
  version:1,status:"ready",generatedAt:new Date().toISOString(),
  benchmark:{status:"ready",referenceId:"ref-1",title:"3 秒展示买家最关心的产品细节",account:"@industrial.daily",views:"128 万",thumbnailUrl:coverA,sourceUrl:"",hook:"先展示采购中最容易忽略的质量细节，再给出可核验产品证据。",shotSummary:["镜头功能：前三秒问题钩子","画面：产品细节与工厂检测","字幕：把采购顾虑说清楚"]},
  materials:{status:"ready",items:[{id:"asset-1",name:"产品正面",type:"image",previewUrl:coverB,status:"ready"},{id:"asset-2",name:"工厂检测",type:"image",previewUrl:coverA,status:"ready"}],blockers:[],pendingShootTaskIds:[]},
  readiness:{canStart:true,blockers:[]},confidence:{onTimeRate:null,effectLevel:"medium",reasons:["已绑定精确分析","已锁定两项真实素材"]},
} as const;

const previewBlocked = {
  version:1,status:"blocked",generatedAt:new Date().toISOString(),
  benchmark:{status:"not_applicable",referenceId:"",title:"",account:"",views:"",thumbnailUrl:"",sourceUrl:"",hook:"按产品和账号策略原创",shotSummary:[]},
  materials:{status:"blocked",items:[{id:"shoot-1",name:"包装开箱镜头",type:"video",previewUrl:"",status:"pending_shoot"}],blockers:["有 1 个待拍任务尚未回填素材"],pendingShootTaskIds:["shoot-1"]},
  readiness:{canStart:false,blockers:["有 1 个待拍任务尚未回填素材"]},confidence:{onTimeRate:null,effectLevel:"insufficient",reasons:["待拍素材尚未回填"]},
} as const;

const queueItem = (input: Record<string,unknown>) => ({
  id:"content-1",contentId:"content-1",orderId:"order-1",batchPlanId:"batch-1",projectIds:[],taskId:"task-1",socialContentTaskId:"social-1",origin:"weekly_plan",
  lineage:{goalId:"goal-1",objective:"获得 20 条有效询盘",accountId:"yt-main",accountLabel:"Lingshu Factory",budgetCny:36,planId:"plan-1",planVersion:3,authorizationMode:"each"},
  outputSummary:{count:1,formats:["产品证据短视频"],durationSeconds:30},
  title:"采购商最容易忽略的 3 个产品细节",productName:"工业控制器 A",platform:"youtube",accountId:"yt-main",accountLabel:"Lingshu Factory",route:"clone",languages:["en"],plannedPublishDate:"2026-10-08",
  referenceId:"ref-1",referenceTitle:"3 秒展示买家最关心的产品细节",referenceViews:"128 万",benchmarkAccount:"@industrial.daily",matchScore:88,planningFactors:["前三秒钩子结构匹配","受众与主推产品一致"],
  status:"producing",stage:"素材与生成",progress:48,reason:"",updatedAt:new Date().toISOString(),estimatedCostCny:36,settledCostCny:null,costStatus:"estimated",
  steps:[{label:"计划确认",state:"done"},{label:"脚本与分镜",state:"done"},{label:"素材与生成",state:"active"},{label:"质量检查",state:"pending"},{label:"完成",state:"pending"}],
  preproduction:previewReady,
  confidence:{production:{level:"medium",label:"中",evidence:["素材已锁定"],gaps:[]},publishing:{level:"medium",label:"中",evidence:["账号已连接"],gaps:[]},business:{level:"low",label:"低",evidence:[],gaps:["尚无同类发布样本"]},note:"只展示可解释依据，不把匹配度包装成成功率。"},
  ...input,
});

const mockOverview = {
  config: { smartOperationsEnabled:true,publishingTargets,focusProducts:"工业控制器 A",targetMarkets:"北美 / 欧洲",customerProfile:"工业自动化采购商",socialCadence:"每周 6 条",reviewSchedule:"周五 17:30" }, goals: [],
  goal: { id:"goal-1",title:"本周海外内容增长",objective:"获得 20 条有效询盘",metric:"qualified_leads",target:20,unit:"条",startsAt:"2026-10-05",endsAt:"2026-10-11",contentPlatforms:["youtube","instagram","facebook","tiktok"],status:"draft",version:1 },
  plan: { id:"plan-1",businessPackage:{revision:3,detailGeneration:{status:"blocked",startedAt:new Date().toISOString(),generatedAt:new Date().toISOString(),estimatedMinutes:6,usageCostCny:null,readyCount:1,blockedCount:1,blockers:["有 1 个待拍任务尚未回填素材"]},directorPlan:{currency:"CNY",productionBudget:240,productionReserved:64,productionSpent:72,paidMediaBudget:120,originalTarget:6,platformVersionTarget:6,publishTarget:6,collectionBrief:"围绕采购顾虑选择真实参考",qualityStandard:"事实与素材可核验",progress:[]},matrixPlan:publishingTargets.map((target,index)=>({...target,accountRole:"brand_combined",formats:["短视频"],audience:"工业自动化采购商",productName:"工业控制器 A",language:"en",objective:"获得询盘",contentDirection:"产品证据",cta:"预约产品咨询",weeklyCount:index<2?2:1,sourceProjectIds:[],connected:true})),tasks:[{templateId:"production",title:"制作产品视频",ownerId:"",ownerName:"",dueAt:"2026-10-11",notes:"",sourceProjectIds:[],videoPlans:[]}],authorization:{mode:"each",accountIds:publishingTargets.map(item=>item.accountId),customerIds:[],maxPublishItems:6,maxCustomerMessages:0},operatingContext:{cycle:{startsAt:"2026-10-05",endsAt:"2026-10-11",timeZone:"Asia/Shanghai"},goal:{title:"本周海外内容增长",objective:"获得 20 条有效询盘",metric:"qualified_leads",baseline:0,target:20,unit:"条"},markets:["北美","欧洲"],accounts:publishingTargets.map((target,index)=>({...target,positioning:"产品证据账号",contentCount:index<2?2:1,budgetCny:index<2?80:40,allocationBasis:"content_load"})),budget:{currency:"CNY",productionCny:240,paidMediaCny:120,totalCny:360},cadence:{contentCount:6,description:"每周 6 条",reviewSchedule:"周五 17:30"},authorization:{mode:"each",allowRealPublishing:false,allowRealCustomerMessages:false,accountIds:publishingTargets.map(item=>item.accountId),maxPublishItems:6,maxCustomerMessages:0},outputs:{count:6,formats:["产品证据短视频","爆款结构复刻"],totalDurationSeconds:180}}}},
  run: null, approvals: [], handoffs: [], review: null,
  agents: [
    { role:"business",status:"running",currentTask:"正在安排本周 12 条内容的发布节奏",completed:4,total:7 },
    { role:"director",status:"running",currentTask:"正在验收定时采集的 18 条灵感",completed:11,total:18 },
    { role:"content",status:"idle",currentTask:"等待已确认脚本",completed:5,total:5 },
    { role:"customer",status:"idle",currentTask:"等待新询盘",completed:8,total:8 },
  ],
  tasks: [
    { id:"task-1",run_id:"run-1",task_key:"weekly-plan",title:"安排本周发布节奏",description:"",agent_role:"business",kind:"planning",status:"running",sequence:1,priority:"high",requires_approval:false,depends_on:[],output:{},blocked_reason:"",owner_id:"",updated_at:new Date().toISOString() },
    { id:"task-2",run_id:"run-1",task_key:"collect",title:"验收对标内容采集结果",description:"",agent_role:"director",kind:"analysis",status:"running",sequence:2,priority:"high",requires_approval:false,depends_on:[],output:{},blocked_reason:"",owner_id:"",updated_at:new Date(Date.now()-1800000).toISOString() },
  ],
  events: [
    { id:"event-1",run_id:"run-1",task_id:"task-1",sequence:2,type:"progress",level:"info",summary:"已确认 YouTube 和 TikTok 本周发布账号",payload:{},occurred_at:new Date().toISOString() },
    { id:"event-2",run_id:"run-1",task_id:"task-1",sequence:1,type:"started",level:"info",summary:"开始按视频矩阵安排发布节奏",payload:{},occurred_at:new Date(Date.now()-2400000).toISOString() },
  ],
  deliveries: [
    { id:"delivery-1",taskIds:["task-1"],taskId:"task-1",runId:"run-1",title:"工厂为什么总在这里丢单？",subject:"YouTube · 产品讲解",kind:"视频",acceptance:"",stage:"待验收",column:"human",reason:"等待确认字幕",exception:false,updatedAt:new Date().toISOString(),artifacts:[],steps:[{label:"脚本",state:"done"},{label:"成片",state:"done"},{label:"验收",state:"pending"}],link:{page:"smartAssets",runId:"run-1",taskId:"task-1",businessRef:{taskKey:"content",platform:"youtube"}},actionLabel:"查看",effect:"",metrics:[{label:"生成成本",value:8.6},{label:"播放量",value:38500}] },
    { id:"delivery-2",taskIds:["task-2"],taskId:"task-2",runId:"run-1",title:"3 秒看懂产品核心卖点",subject:"TikTok · 爆款裂变",kind:"视频",acceptance:"",stage:"生成中",column:"active",reason:"",exception:false,updatedAt:new Date(Date.now()-3600000).toISOString(),artifacts:[],steps:[{label:"脚本",state:"done"},{label:"成片",state:"active"},{label:"验收",state:"pending"}],link:{page:"smartAssets",runId:"run-1",taskId:"task-2",businessRef:{taskKey:"content",platform:"tiktok"}},actionLabel:"查看",effect:"",metrics:[{label:"生成成本",value:12.4},{label:"播放量",value:19200}] },
  ],
  businessSnapshot: {
    generatedAt:new Date().toISOString(),range:{startsAt:"2026-09-21",endsAt:"2026-09-28",timeZone:"Asia/Shanghai"},readiness:[],dataGaps:["paid_media_spend"],
    content:{scheduledAutomations:{value:3,status:"available",source:"scheduler"},collectedItems:{value:42,status:"available",source:"inspiration"},exactAnalyses:{value:18,status:"available",source:"inspiration"},contentProjects:{value:12,status:"available",source:"studio"},completedWorks:{value:9,status:"available",source:"studio"},approvedWorks:{value:7,status:"available",source:"studio"},scheduledPosts:{value:12,status:"available",source:"publishing"},publishedPosts:{value:8,status:"available",source:"publishing"},failedPosts:{value:0,status:"available",source:"publishing"},inquiries:{value:36,status:"available",source:"crm"},deals:{value:5,status:"available",source:"crm"}},
    customer:{total:{value:168,status:"available",source:"crm"},attributed:{value:36,status:"available",source:"crm"},highIntent:{value:14,status:"available",source:"crm"},aiAuto:{value:22,status:"available",source:"crm"},draftReview:{value:3,status:"available",source:"crm"},humanNeeded:{value:2,status:"available",source:"crm"},quoted:{value:8,status:"available",source:"crm"},won:{value:5,status:"available",source:"crm"},segmentSnapshots:{value:1,status:"available",source:"crm"},followupDrafts:{value:8,status:"available",source:"crm"},outreachBatches:{value:2,status:"available",source:"crm"},outreachSent:{value:6,status:"available",source:"crm"},outreachFailed:{value:0,status:"available",source:"crm"}},
    social:{accountCount:{value:8,status:"available",source:"accounts"},platformCount:{value:4,status:"available",source:"accounts"},views:{value:106000,status:"available",source:"platforms"},reach:{value:83000,status:"available",source:"platforms"},likes:{value:4200,status:"available",source:"platforms"},comments:{value:318,status:"available",source:"platforms"},shares:{value:126,status:"available",source:"platforms"},saves:{value:534,status:"available",source:"platforms"},profileViews:{value:1200,status:"available",source:"platforms"},platformBreakdown:[],dailyTrend:[]},
    next24Hours:[],attribution:{attributedCustomers:36,postsWithInquiries:8,status:"available"},
  },
  contentQueue:{generatedAt:new Date().toISOString(),sourceStatus:"available",sourceNote:"正式任务数据库",items:[
    queueItem({}),
    queueItem({id:"content-2",contentId:"content-2",orderId:"order-2",taskId:"task-2",socialContentTaskId:"social-2",title:"30 秒产品开箱与安装说明",platform:"instagram",accountId:"ig-main",accountLabel:"Lingshu Products",route:"product",referenceId:"",referenceTitle:"",referenceViews:"",benchmarkAccount:"",matchScore:null,status:"blocked",stage:"制作准备",progress:16,reason:"待拍素材尚未回填",estimatedCostCny:28,preproduction:previewBlocked,lineage:{goalId:"goal-1",objective:"获得 20 条有效询盘",accountId:"ig-main",accountLabel:"Lingshu Products",budgetCny:28,planId:"plan-1",planVersion:3,authorizationMode:"each"}}),
    queueItem({id:"content-3",contentId:"content-3",orderId:"manual-1",taskId:"task-3",socialContentTaskId:"social-3",origin:"manual",title:"客户展会现场剪辑",platform:"tiktok",accountId:"tt-main",accountLabel:"Lingshu Lab",route:"material",referenceId:"",referenceTitle:"",referenceViews:"",benchmarkAccount:"",matchScore:null,status:"queued",stage:"等待制作",progress:8,estimatedCostCny:18,preproduction:undefined,lineage:{goalId:"",objective:"单项内容交付",accountId:"tt-main",accountLabel:"Lingshu Lab",budgetCny:18,planId:"",planVersion:0,authorizationMode:"manual"}}),
  ]},
  executionRuntime:{generatedAt:new Date().toISOString(),sourceStatus:"available",sourceNote:"正式任务队列",capacity:{tenant:{active:1,max:2},accountDefaultMaxRunning:1,workerMaxRunning:4,accounts:[{accountId:"yt-main",active:1,max:1}],taskTypes:[{taskType:"social_content_weekly",active:1,max:2}]},counts:{queued:1,running:1,retry_wait:0,reconciling:0,blocked:1,paused:0,succeeded:0,cancelled:0,dead_letter:0},jobs:[
    {id:"job-1",taskId:"social-1",runId:"run-1",accountId:"yt-main",taskType:"social_content_weekly",status:"running",attempt:1,maxAttempts:3,nextAttemptAt:null,retryClass:null,publicReason:"后台正在制作，结果会持续保存",queuePosition:null,waitingOn:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()},
    {id:"job-2",taskId:"social-2",runId:"run-1",accountId:"ig-main",taskType:"social_content_weekly",status:"blocked",attempt:1,maxAttempts:1,nextAttemptAt:null,retryClass:"input_required",publicReason:"需要补充素材或人工修改",queuePosition:null,waitingOn:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()},
    {id:"job-3",taskId:"social-3",runId:"run-1",accountId:"tt-main",taskType:"social_content_instant",status:"queued",attempt:0,maxAttempts:1,nextAttemptAt:new Date().toISOString(),retryClass:null,publicReason:"等待后台工作槽；关闭或刷新网页不会中断",queuePosition:1,waitingOn:"worker",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()},
  ]},
} as unknown as DigitalEmployeeOverview;

const tabs: Array<[SmartBusinessView,string]> = [["home","经营总览"],["matrix","账号矩阵"],["queue","内容队列"],["review","数据复盘"]];

export default function SmartBusinessPreview() {
  const [view,setView]=useState<SmartBusinessView>(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "matrix" ? "matrix" : "home");
  const [selectedAccountId,setSelectedAccountId]=useState("");
  const [selectedContentItemId,setSelectedContentItemId]=useState("");
  const [message,setMessage]=useState("当前是交互预览；正式入口在登录后的“智能经营”。");
  const [profile,setProfile]=useState<'cold'|'established'>(()=>typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('profile')==='established'?'established':'cold');
  useEffect(() => {
    const navigate = (event: Event) => {
      const detail = (event as CustomEvent<{ page?: string; view?: string }>).detail || {};
      const label = detail.view === "shooting" ? "待拍任务" : detail.page === "socialInspiration" ? "爆款分析" : detail.page === "enterprise" ? "企业素材" : "对应业务页";
      setMessage(`已接收到跳转：${label}。正式工作台会保留当前任务并打开对应记录。`);
    };
    window.addEventListener("lingshu:navigate", navigate);
    return () => window.removeEventListener("lingshu:navigate", navigate);
  }, []);
  const taskCounts=Object.fromEntries(publishingTargets.map(target=>[target.accountId,mockOverview.contentQueue?.items.filter(item=>item.accountId===target.accountId).length||0]));
  const calendarTasks=profile==='established'?agentCalendarEstablishedDemo:agentCalendarDemo;
  return <SocialProgramProvider scope="smart-business-preview" enabled={false}><main className="min-h-screen bg-[#f7f8f6] p-4 sm:p-7"><div className="mx-auto max-w-[1500px]"><header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold tracking-[.2em] text-emerald-700">SMART OPERATIONS</p><h1 className="mt-1 text-3xl font-black text-slate-950">智能经营</h1><p className="mt-1 text-sm text-slate-500">查看经营结果、内容队列和 Agent 的实时工作。</p></div><div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3"><div><p className="text-xs font-black text-slate-900">智能经营</p><p className="text-[10px] text-slate-500">会生成新的总纲与任务详情</p></div><span className="relative h-7 w-12 rounded-full bg-emerald-600"><span className="absolute left-6 top-1 h-5 w-5 rounded-full bg-white shadow"/></span></div></header><p role="status" className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs font-bold text-sky-800">{message}</p><div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="验收用户画像"><span className="text-xs font-bold text-slate-600">验收画像</span><button type="button" aria-pressed={profile==='cold'} onClick={()=>setProfile('cold')} className={`rounded-xl px-3 py-2 text-xs font-black ${profile==='cold'?'bg-emerald-700 text-white':'border bg-white text-slate-600'}`}>B2B 零基础 · Z 链</button><button type="button" aria-pressed={profile==='established'} onClick={()=>setProfile('established')} className={`rounded-xl px-3 py-2 text-xs font-black ${profile==='established'?'bg-emerald-700 text-white':'border bg-white text-slate-600'}`}>B2B 有基础 · H 链</button><span className="text-[10px] text-slate-500">预览数据仅用于界面验收，不写入生产任务。</span></div><nav className="mt-6 flex gap-7 overflow-x-auto border-b border-slate-200">{tabs.map(([id,label])=><button key={id} onClick={()=>setView(id)} className={`shrink-0 border-b-2 pb-3 text-sm font-black ${view===id?'border-emerald-700 text-emerald-800':'border-transparent text-slate-400'}`}>{label}</button>)}</nav><div className="grid gap-5 py-6 lg:grid-cols-[220px_minmax(0,1fr)]"><SmartOperationsAccountRail targets={[...publishingTargets]} selectedAccountId={selectedAccountId} taskCounts={taskCounts} onSelect={setSelectedAccountId} onManage={()=>setMessage("正式工作台会打开账号管理；预览模式不修改真实账号。")}/><section className="min-w-0"><SmartBusinessDashboard calendarTasks={calendarTasks} calendarDemo data={mockOverview} view={view} selectedAccountId={selectedAccountId} selectedContentItemId={selectedContentItemId} onGenerateDetails={()=>setMessage("已模拟启动编导与内容 Agent 的预分析。") } onNavigate={page=>setMessage(`正式工作台将打开：${page}，并定位到当前任务对应记录。`)} onOpenContent={()=>window.location.assign("/social-content-preview")} onOpenProductionProgress={(_taskId,contentItemId)=>{setSelectedContentItemId(contentItemId);setView("production");}} onBackToQueue={()=>{setSelectedContentItemId("");setView("queue");}} onRetryTask={async ()=>{setMessage("已模拟从失败节点重新生成；正式工作台会保留已完成结果。");return true;}} onControlJob={async (_jobId,action)=>{setMessage(`已模拟${action}操作；正式工作台会写入后台任务记录。`);return true;}}/></section></div></div></main></SocialProgramProvider>;
}
