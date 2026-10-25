import { Checkbox, Input, Select } from 'antd';
import type { AssistantCreationPortal } from '../../../shared/contracts/assistantCreationPortal';
import AssistantSceneDateInput from './AssistantSceneDateInput';
export const CAMPAIGN_PHASES = [
  {id:'warmup',title:'活动预热',phase:'warmup' as const},
  {id:'launch',title:'活动主推',phase:'launch' as const},
  {id:'followup',title:'活动回顾与跟进',phase:'followup' as const},
];
export function initialCampaign(): NonNullable<AssistantCreationPortal['campaign']> {
  return {name:'',type:'',objective:'',startsAt:'',endsAt:'',items:CAMPAIGN_PHASES.map(item=>({...item,publishAt:''}))};
}
export default function AssistantCampaignEditor({value,onChange}:{value:NonNullable<AssistantCreationPortal['campaign']>;onChange:(value:NonNullable<AssistantCreationPortal['campaign']>)=>void}) {
  const patch=(next:Partial<typeof value>)=>onChange({...value,...next});
  return <div className="space-y-3">
    <label className="block text-xs">活动名称<Input aria-label="活动名称" maxLength={120} value={value.name} onChange={e=>patch({name:e.target.value})}/></label>
    <Select className="w-full" aria-label="活动类型" placeholder="选择活动类型" value={value.type||undefined} onChange={type=>patch({type})} options={['新品发布','展会','促销','品牌活动'].map(label=>({value:label,label}))}/>
    <label className="block text-xs">业务目标<Input.TextArea aria-label="活动业务目标" maxLength={500} value={value.objective} onChange={e=>patch({objective:e.target.value})} placeholder="例如获取新品询盘，不填写未经确认的价格或优惠"/></label>
    <div className="grid gap-2 sm:grid-cols-2">{(['startsAt','endsAt'] as const).map(key=><label key={key} className="text-xs">{key==='startsAt'?'活动开始':'活动结束'}（北京时间）<AssistantSceneDateInput label={key==='startsAt'?'活动开始时间':'活动结束时间'} value={value[key]} onChange={next=>patch({[key]:next})}/></label>)}</div>
    <p className="text-xs text-text-secondary">选择要准备的内容，可保留一条或多条，并分别安排预计发布时间。</p>
    {CAMPAIGN_PHASES.map(template=>{
      const item=value.items.find(row=>row.id===template.id);
      return <div key={template.id} className="space-y-2 rounded-lg border border-border p-3">
        <Checkbox checked={!!item} onChange={e=>patch({items:e.target.checked?[...value.items,{...template,publishAt:''}]:value.items.filter(row=>row.id!==template.id)})}>{template.title}</Checkbox>
        {item&&<><Input aria-label={`${template.title}主题`} value={item.title} maxLength={120} onChange={e=>patch({items:value.items.map(row=>row.id===item.id?{...row,title:e.target.value}:row)})}/>
          <label className="block text-xs">预计发布时间（北京时间）<AssistantSceneDateInput label={`${template.title}发布时间`} value={item.publishAt} onChange={next=>patch({items:value.items.map(row=>row.id===item.id?{...row,publishAt:next}:row)})}/></label></>}
      </div>;
    })}
  </div>;
}
