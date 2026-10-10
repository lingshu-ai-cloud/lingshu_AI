import type {ContentQueueItem} from '../../lib/digitalEmployees';
import type {AgentCalendarTask} from './AgentWeeklyCalendar';

type Account = {accountId:string;platform:string;connected?:boolean};
/** Read-only exceptions from actual completed content and its intended publication. */
export function projectAccountBindingCalendar(items:ContentQueueItem[],accounts:Account[]):AgentCalendarTask[]{
 const groups=new Map<string,{items:ContentQueueItem[];deadline:string}>();
 for(const item of items){
  if(!['completed','waiting_review'].includes(item.status))continue;
  const deadline=item.contentPlan?.publishAt||item.plannedPublishDate;
  if(!deadline||!Number.isFinite(Date.parse(deadline)))continue;
  if(item.accountId&&accounts.some(a=>a.accountId===item.accountId&&a.platform===item.platform&&a.connected===true))continue;
  const key=JSON.stringify([item.platform,item.accountId||item.accountLabel||'unbound']);
  const existing=groups.get(key);
  if(existing){existing.items.push(item);if(Date.parse(deadline)<Date.parse(existing.deadline))existing.deadline=deadline;}
  else groups.set(key,{items:[item],deadline});
 }
 return [...groups].map(([key,group])=>{
  const first=group.items[0]!,date=group.deadline.slice(0,10),clock=group.deadline.match(/T(\d{2}:\d{2})/)?.[1]||'00:00';
  return {id:`account-binding:${key}`,date,time:clock,agent:'human',title:`绑定发布账号 · ${first.platform}${first.accountLabel?` · ${first.accountLabel}`:''}`,output:'连接并明确选择目标发布账号，恢复原发布安排',context:`已完成内容：${group.items.map(i=>i.title).join('、')}`,minutes:null,status:'blocked',dueAt:group.deadline,submission:'missing',availableForHuman:true,reason:'成片已就绪，目标发布账号尚未连接；内容无需重新制作。',affectedPublicationIds:group.items.map(i=>i.id),accountBindingTarget:{platform:first.platform,accountId:first.accountId||null,consumerIds:group.items.map(i=>i.id)}};
 });
}
