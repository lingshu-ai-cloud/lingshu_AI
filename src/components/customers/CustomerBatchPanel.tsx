import { customerSegmentReasonLabel } from '../../lib/customerSegmentPresentation';
import { useEffect, useState } from 'react';
import { Alert, Button, Input, InputNumber, Select, Space, Table } from 'antd';
import { authHeader } from '../../lib/auth';
import type { CustomerSegmentCriteria } from '../../../shared/contracts/customerSegmentation';
const presets:Record<string,{label:string;criteria:CustomerSegmentCriteria}>={
  screen:{label:'按标签筛选',criteria:{purpose:'screen',match:'all'}},
  new_inquiry:{label:'新询盘管理',criteria:{purpose:'new_inquiry',match:'all',relationships:['new_inquiry']}},
  reactivate:{label:'已有往来客户唤醒',criteria:{purpose:'reactivate',match:'all',relationships:['existing_contact']}},
  repurchase:{label:'已记录成交客户复购',criteria:{purpose:'repurchase',match:'all',purchase:'recorded_paid'}},
};
type Preview={previewHash:string;counts:{total:number;included:number;excluded:number;unknown:number};rows:Array<{customerId:string;name:string;included:boolean;inclusionReasons:string[];exclusionReasons:string[];evidence:{fingerprint:string;buyerMessages:Array<{id:string;body:string;occurredAt:string}>}}>};
export default function CustomerBatchPanel({runId,onSaved}:{runId:string;onSaved:()=>Promise<void>}){
  const [preset,setPreset]=useState('screen'),[tags,setTags]=useState(''),[days,setDays]=useState<number|null>(null),[score,setScore]=useState<number|null>(null);
  const [selectedIds,setSelectedIds]=useState<React.Key[]>([]),[language,setLanguage]=useState(''),[timeZone,setTimeZone]=useState(''),[relationshipReason,setRelationshipReason]=useState('');
  const [mode,setMode]=useState<'screen'|'draft'>('screen');
  const [preview,setPreview]=useState<Preview|null>(null),[frozen,setFrozen]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [capabilities,setCapabilities]=useState<{criteriaFields:string[]}|null>(null);
  const request=async(path:string,body?:unknown)=>{const response=await fetch(`/api/overseas/customer-batches/${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...authHeader()},body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok)throw Error(data.message||data.error||'批量管理操作失败');return data;};
  useEffect(()=>{let alive=true;void request('capabilities').then(v=>{if(alive)setCapabilities(v);}).catch(e=>{if(alive)setError(String(e.message));});return()=>{alive=false;};},[runId]);
  useEffect(()=>{setPreview(null);setFrozen(null);setSelectedIds([]);},[preset,tags,days,score,mode,runId]);
  const criteria:CustomerSegmentCriteria={...presets[preset].criteria,managementAction:mode,tagsAll:tags.split(/[，,]/).map(t=>t.trim()).filter(Boolean),...(days!==null?{inactiveDaysMin:days}:{}),...(score!==null?{minIntentScore:score}:{})};
  async function act(action:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await action();}catch(e){setError(e instanceof Error?e.message:'操作失败');}finally{setBusy(false);}}
  return <section aria-label="按业务条件批量管理客户" className="space-y-3 border-y border-border py-3">
    <Space wrap>
      <Select aria-label="管理场景" value={preset} onChange={setPreset} options={Object.entries(presets).map(([value,p])=>({value,label:p.label}))}/>
      <Input aria-label="必须同时具备的标签" placeholder="必须同时具备的标签，逗号分隔" value={tags} onChange={e=>setTags(e.target.value)} style={{width:260}}/>
      <InputNumber style={{width:190}} aria-label="买家沉默至少天数" placeholder="买家沉默至少天数" min={0} max={36500} value={days} onChange={setDays}/>
      <InputNumber style={{width:160}} aria-label="最低意向分" placeholder="最低意向分" min={0} max={100} value={score} onChange={setScore}/>
      <Select aria-label="批量操作" value={mode} onChange={setMode} options={[{value:'screen',label:'只筛选和归类'},{value:'draft',label:'筛选后生成待审草稿'}]}/>
      <Button type={preview?'default':'primary'} loading={busy} disabled={!capabilities} onClick={()=>void act(async()=>{setPreview(await request(`runs/${encodeURIComponent(runId)}/preview`,{criteria}));})}>预览客群</Button>
    </Space>
    {notice&&<Alert type="success" title={notice} showIcon/>}
    {error&&<Alert type="error" title={error} showIcon/>}
    {preview&&<>
      <p>候选 {preview.counts.total} 人 · 纳入 {preview.counts.included} 人 · 排除 {preview.counts.excluded} 人 · 资料待核实 {preview.counts.unknown} 人</p>
      <Table rowSelection={{selectedRowKeys:selectedIds,onChange:setSelectedIds}} size="small" rowKey="customerId" dataSource={preview.rows} pagination={{pageSize:10}} columns={[{title:'客户',dataIndex:'name'},{title:'筛选结果',render:(_,r)=>r.included?'纳入':'排除'},{title:'依据',render:(_,r)=><div>{[...r.inclusionReasons,...r.exclusionReasons].map(customerSegmentReasonLabel).join('；')}<details><summary>买家消息证据</summary>{r.evidence.buyerMessages?.map(m=><p key={m.id}>{m.occurredAt} · {m.body}</p>)}</details></div>}]}/>
      <Space wrap>
        <Button disabled={busy||!selectedIds.length||selectedIds.length>10} onClick={()=>void act(async()=>{const classified=await request(`runs/${encodeURIComponent(runId)}/classify`,{customerIds:selectedIds});setNotice(`标签复核完成 ${classified.items.filter((r:{status:string})=>r.status==='succeeded').length} 人，失败 ${classified.items.filter((r:{status:string})=>r.status!=='succeeded').length} 人`);setPreview(await request(`runs/${encodeURIComponent(runId)}/preview`,{criteria}));})}>重新核对选中客户标签</Button>
        <Input aria-label="确认客户语言" placeholder="确认客户语言，如 English" value={language} onChange={e=>setLanguage(e.target.value)}/>
        <Input aria-label="确认客户时区" placeholder="确认时区，如 Europe/Paris" value={timeZone} onChange={e=>setTimeZone(e.target.value)}/>
        <Button disabled={busy||!selectedIds.length||selectedIds.length>10||!language.trim()||!timeZone.trim()} onClick={()=>void act(async()=>{for(const id of selectedIds){const row=preview.rows.find(r=>r.customerId===id);if(!row)throw Error('客群已变化');await request(`runs/${encodeURIComponent(runId)}/customers/${encodeURIComponent(String(id))}/profile`,{expectedFingerprint:row.evidence.fingerprint,profile:{language:language.trim(),timeZone:timeZone.trim()}});}setPreview(await request(`runs/${encodeURIComponent(runId)}/preview`,{criteria}));setNotice('选中客户的语言和时区已确认');})}>确认选中客户语言和时区</Button>
      </Space>
      <Space wrap>
        <Input aria-label="新询盘确认依据" placeholder="核对首条买家消息后填写新询盘确认依据" value={relationshipReason} onChange={e=>setRelationshipReason(e.target.value)} style={{width:360}}/>
        <Button disabled={busy||!selectedIds.length||selectedIds.length>10||!relationshipReason.trim()} onClick={()=>void act(async()=>{for(const id of selectedIds){const row=preview.rows.find(r=>r.customerId===id);const first=row?.evidence.buyerMessages?.[0];if(!row||!first)throw Error('缺少首条买家消息证据');await request(`runs/${encodeURIComponent(runId)}/customers/${encodeURIComponent(String(id))}/confirm-new-inquiry`,{firstMessageId:first.id,expectedFingerprint:row.evidence.fingerprint,reason:relationshipReason.trim()});}setPreview(await request(`runs/${encodeURIComponent(runId)}/preview`,{criteria}));setNotice('新询盘关系已确认');})}>确认选中客户为本周新询盘</Button>
      </Space>
      <Space wrap>
        <Button type="primary" disabled={busy||!preview.counts.included} onClick={()=>void act(async()=>{const r=await request(`runs/${encodeURIComponent(runId)}/segments`,{criteria,expectedPreviewHash:preview.previewHash});setFrozen(r.segment.id);await onSaved();})}>确认并冻结这批客户</Button>
        {frozen&&mode==='draft'&&<Button type="primary" loading={busy} onClick={()=>void act(async()=>{const response=await fetch(`/api/overseas/digital-employees/customer-segments/${encodeURIComponent(frozen)}/followup-batches`,{method:'POST',headers:{'Content-Type':'application/json',...authHeader()},body:JSON.stringify({})});const data=await response.json();if(!response.ok)throw Error(data.error||'草稿生成失败');await onSaved();})}>生成逐客待审草稿</Button>}
        {frozen&&mode==='screen'&&<span role="status">筛选结果已保存，未启动消息发送。</span>}
      </Space>
    </>}
  </section>;
}
