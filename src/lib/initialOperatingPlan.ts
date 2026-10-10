import type { DigitalEmployeeConfig, PublishingTarget } from './digitalEmployees';
import type { SocialContentStageId } from './socialContentStage';
import { buildPresetMatrixVideoPlans, weeklyTaskPackagePreset } from './weeklyTaskPackagePresets';
import { defaultMatrixPlan, linkMatrixVersionsToMasters } from './weeklyMatrix';
export type InitialOperatingPlan = { stage: SocialContentStageId; products: string[]; market: string; language: string; platforms: PublishingTarget['platform'][]; accountIds?: Partial<Record<PublishingTarget["platform"], string>>; count: number; budgetCapCny: number; deliveryDate: string };
export function recommendFocusProducts(products: Array<Record<string, any>>): string[] {
  return products.map((p,index)=>({name:String(p.name||p.title||p.productName||'').trim(),index,score:Number(!!p.description)+Number(!!p.highlights)+Number(!!p.sku)+Number(Array.isArray(p.images)&&p.images.length>0)*2})).filter(p=>p.name).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,2).map(p=>p.name);
}
export function initialPlanMatrixRows(plan:InitialOperatingPlan, config:DigitalEmployeeConfig){
 const rows=defaultMatrixPlan({...config,focusProducts:plan.products.join("、"),videoDefaults:{...config.videoDefaults,language:plan.language}},plan.platforms,"完成首次经营内容交付");
 return plan.platforms.flatMap(platform=>{const row=rows.find(r=>r.platform===platform&&(!plan.accountIds?.[platform]||r.accountId===plan.accountIds[platform]));return row?[{...row,weeklyCount:plan.count}]:[];});
}
export function initialPlanVideoPlans(plan:InitialOperatingPlan, config:DigitalEmployeeConfig){
  const preset=weeklyTaskPackagePreset(plan.stage==='b2b_launch'?'b2b_starting':plan.stage==='b2b_growth'?'b2b_growing':'dtc_sales');
  const adjusted={...config,targetMarkets:plan.market,focusProducts:plan.products.join('、'),videoDefaults:{...config.videoDefaults,language:plan.language}};
  return linkMatrixVersionsToMasters(buildPresetMatrixVideoPlans({preset:{...preset,weeklyOutput:plan.count},productName:plan.products[0]||'',focus:plan.products.join('、'),defaults:adjusted.videoDefaults,platforms:plan.platforms,matrixRows:initialPlanMatrixRows(plan,adjusted)}),plan.count);
}
export function validateInitialPlan(plan:InitialOperatingPlan){
  return [!plan.products.length?'请选择主推产品':'',!plan.market.trim()?'请确认目标市场':'',!plan.language.trim()?'请确认语言':'',!plan.platforms.length?'请选择平台':'',!Number.isSafeInteger(plan.count)||plan.count<1||plan.count>30?'视频数量须为1–30':'',plan.count*plan.platforms.length>30?'平台适配总数须不超过30条':'',!Number.isFinite(plan.budgetCapCny)||plan.budgetCapCny<=0?'请设置正数预算上限':'',!/^\d{4}-\d{2}-\d{2}$/.test(plan.deliveryDate)||!Number.isFinite(Date.parse(plan.deliveryDate))?'请设置交付日期':''].filter(Boolean);
}
