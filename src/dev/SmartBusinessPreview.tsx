import { useState } from "react";
import SmartBusinessDashboard, { type SmartBusinessView } from "../components/SmartBusinessDashboard";
import type { DigitalEmployeeOverview } from "../lib/digitalEmployees";

const mockOverview = {
  config: {}, goals: [], goal: null, plan: null, run: null, approvals: [], handoffs: [], review: null,
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
} as unknown as DigitalEmployeeOverview;

const tabs: Array<[SmartBusinessView,string]> = [["home","经营总览"],["queue","内容队列"],["review","数据复盘"]];

export default function SmartBusinessPreview() {
  const [view,setView]=useState<SmartBusinessView>("home");
  return <main className="min-h-screen bg-[#f7f8f6] p-4 sm:p-7"><div className="mx-auto max-w-[1450px]"><header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold tracking-[.2em] text-emerald-700">ALWAYS ON</p><h1 className="mt-1 text-3xl font-black text-slate-950">智能经营</h1></div><span className="rounded-full bg-white px-3 py-1.5 text-[10px] font-bold text-slate-400">本地 UI 预览</span></header><nav className="mt-6 flex gap-7 border-b border-slate-200">{tabs.map(([id,label])=><button key={id} onClick={()=>setView(id)} className={`border-b-2 pb-3 text-sm font-black ${view===id?'border-emerald-700 text-emerald-800':'border-transparent text-slate-400'}`}>{label}</button>)}</nav><section className="py-6"><SmartBusinessDashboard data={mockOverview} view={view}/></section></div></main>;
}
