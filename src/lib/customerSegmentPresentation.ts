const labels:Record<string,string>={stage:'客户阶段符合条件',handling_mode:'处理模式符合条件',bant:'客户资质符合条件',source:'来源符合条件',country:'国家符合条件',language:'语言符合条件',relationship:'新老关系符合条件',waiting_for:'待办进度符合条件',purchase:'成交台账符合条件',product:'关联产品符合条件',matching_tag:'命中所需标签',tags_all:'同时具备全部要求标签',tags_any:'具备任一要求标签',tags_none:'排除标签',inactive_days_min:'已达到买家沉默时长',inactive_days_max:'未超过买家沉默时长',customer_opted_out_or_blacklisted:'客户已退订或禁止联系',explicitly_excluded:'已明确排除',not_in_explicit_allowlist:'不在确认客户范围',excluded_tag:'具备需要排除的标签',native_channel_selection_required:'需先确认该会话的渠道发送范围'};
export function customerSegmentReasonLabel(code:string):string{
 if(code.startsWith('unknown:'))return `资料待核实：${labels[code.slice(8)]?.replace('符合条件','').replace('同时具备全部要求标签','业务标签')||'筛选依据'}`;
 if(code.startsWith('criteria_mismatch:'))return `不符合条件：${customerSegmentReasonLabel(code.slice(18))}`;
 if(code.startsWith('intent_score_min:'))return `意向分达到 ${code.split(':')[1]}`;
 if(code.startsWith('intent_score_max:'))return `意向分不高于 ${code.split(':')[1]}`;
 if(code.startsWith('active_within_days:'))return `最近 ${code.split(':')[1]} 天有买家互动`;
 if(code.startsWith('excluded_stage:'))return '客户阶段在排除范围';
 return labels[code]||'请核对客户证据';
}
