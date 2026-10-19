import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions } from 'antd';
import { socialProgramApi } from '../../lib/socialProgramApi';
import { WEEKLY_AUTOMATION_TEMPLATE as defaults } from '../../../shared/weeklyAutomationTemplate';
import type { AgentCalendarTask } from '../smartBusiness/AgentWeeklyCalendar';
import { authHeader, getToken } from '../../lib/auth';
import WeeklyCtaContactIntervention from './WeeklyCtaContactIntervention';
import WeeklyProductSelectionIntervention from './WeeklyProductSelectionIntervention';
import WeeklyAccountCollectionIntervention from './WeeklyAccountCollectionIntervention';
import WeeklyPinnedReferenceIntervention from './WeeklyPinnedReferenceIntervention';
import WeeklyProductFootageIntervention from './WeeklyProductFootageIntervention';
import WeeklyCollectionCredentialIntervention from './WeeklyCollectionCredentialIntervention';
type AuditItem = {
    taskId: string;
    step?: string;
    channel?: string | null;
    ownReasons: Array<{
        code: string;
        category: string;
    }>;
    rootCauses: Array<{
        code: string;
    }>;
    ctaContactStatus?: 'missing' | 'recorded' | 'unavailable';
    requiredActions?: Array<{code:string;taskId?:string;channel?:string|null;label:string;action:string;userRequired:boolean}>;
    requirementDiagnostics?: Array<{code:string;label:string;impact:string;action:string;sourceVersion:string|null;diagnosticOnly:true}>;
    whatsappMock?: {status:string;createdAt:string;realAuthorization:false;businessDelivery:false}|null;
};
const labels: Record<string, string> = { business_goal_unavailable: '系统恢复生产目标绑定', capacity_plan_unavailable: '系统恢复资源容量', automation_policy_unavailable: '系统核验自动执行能力', weekly_initial_capacity_schedule_required: '系统采用模板补排任务及资源窗口', business_dispatch_required: '系统完成排期并派单', benchmark_account_video_link_required: '补齐对标账号和视频关联', weekly_preproduction_authority_required: '系统绑定真实采集范围与原任务', weekly_preproduction_outline_goal_not_ready: '系统恢复生产目标，真实转化许可仅影响对外分支' };
const isPostAnalysisSystemGap=(code:string)=>['weekly_postanalysis_canonical_media_intervention_required','weekly_postanalysis_canonical_evidence_intervention_required','weekly_postanalysis_exact_analysis_authorization_required','weekly_postanalysis_exact_analysis_original_receipt_pending','candidate_context_semantic_budget_authorization_required'].includes(code)||code.startsWith('weekly_candidate_semantic_budget_');
function openEnterprise(view: 'company' | 'products') {
    try { localStorage.setItem('lingshu:enterprise:initial-view', view); } catch { /* Navigation still works without optional storage. */ }
    window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'enterprise' } }));
    window.dispatchEvent(new CustomEvent('lingshu:enterprise-view', { detail: { view } }));
}
export default function WeeklyTaskQuickActions({ sources, onOpen, onPlanning }: {
    sources: AgentCalendarTask[];
    onOpen(task: AgentCalendarTask): void;
    onPlanning?: () => void;
}) {
    const targets = sources.filter(s => s.workspaceTarget), target = targets[0]?.workspaceTarget ?? null;
    const identity = JSON.stringify(targets.map(s => s.workspaceTarget)), current = useRef(identity);
    current.current = identity;
    const [items, setItems] = useState<AuditItem[]>([]), [adopted, setAdopted] = useState<string | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    useEffect(() => { if (!target)
        return; let live = true; const token = getToken(); setItems([]); setError(''); setAdopted(null); const base = `/api/overseas/social-programs/${encodeURIComponent(target.programId)}/operating-packages/${encodeURIComponent(target.packageId)}/execution-pipeline`; async function read(selected: NonNullable<typeof target>) { try {
        const r = await fetch(`${base}/task-audit?version=${selected.packageVersion}`, { headers: authHeader() });
        const body = await r.json();
        if (!r.ok)
            throw Error(body.message || '任务缺项核验失败');
        const a = await socialProgramApi.readWeeklyTemplate(selected.programId, selected.packageId, selected.packageVersion);
        if (live && getToken() === token) {
            setItems(body.item.items.filter((i: AuditItem) => targets.some(t => t.workspaceTarget!.executionTaskId === i.taskId)));
            setAdopted(a?.adoptedAt ?? null);
        }
    }
    catch (e) {
        if (live && getToken() === token)
            setError(e instanceof Error ? e.message : String(e));
    } } void read(target); return () => { live = false; }; }, [identity]);
    async function adopt() { if (!target)
        return; const captured = identity, token = getToken(); setBusy(true); setError(''); try {
        const result = await socialProgramApi.adoptWeeklyTemplate(target.programId, target.packageId, target.packageVersion);
        if (current.current === captured && getToken() === token)
            setAdopted(result.adoptedAt);
    }
    catch (e) {
        if (current.current === captured)
            setError(e instanceof Error ? e.message : String(e));
    }
    finally {
        if (current.current === captured)
            setBusy(false);
    } }
    async function runMock(taskId:string){
        if(!target)return;
        const captured=identity,token=getToken();setBusy(true);setError('');
        try{
            const r=await fetch(`/api/overseas/social-programs/${encodeURIComponent(target.programId)}/operating-packages/${encodeURIComponent(target.packageId)}/execution-pipeline/whatsapp-mock`,{method:'POST',headers:{...authHeader(),'content-type':'application/json'},body:JSON.stringify({expectedPackageVersion:target.packageVersion,taskId})});
            const data=await r.json();if(!r.ok)throw Error(data.message||data.error||'Mock 联调失败');
            if(current.current===captured&&getToken()===token)setItems(old=>old.map(i=>i.taskId===taskId?{...i,whatsappMock:data.item}:i));
        }catch(e){if(current.current===captured&&getToken()===token)setError(e instanceof Error?e.message:String(e));}
        finally{if(current.current===captured&&getToken()===token)setBusy(false);}
    }
    const actions = [...new Map(items.flatMap(i => (i.requiredActions ?? []).map(a => [`${a.channel ?? ''}:${a.action}:${a.label}`, a] as const))).values()];
    const diagnostics = [...new Map(items.flatMap(i => (i.requirementDiagnostics ?? []).map(d => [d.code, d] as const))).values()];
    const whatsappTask=items.find(i=>i.channel==='whatsapp'&&i.step==='customer_channel_readiness');
    const ctaContactStatus=items.find(i=>i.requiredActions?.some(action=>action.action==='cta_contact'||action.action==='sample_policy'||action.code==='weekly_cta_contact_read_failed'))?.ctaContactStatus;
    const productSelectionRequired=items.some(i=>i.requiredActions?.some(action=>action.code==='weekly_production_product_selection_required'||action.code==='weekly_production_product_selection_incomplete_group'||action.code==='weekly_production_product_selection_pending_operation'));
    const productSelectionReadFailed=items.some(i=>i.requiredActions?.some(action=>action.code==='weekly_production_product_selection_read_failed'||action.code==='weekly_production_product_selection_group_conflict'));
    const productFootageRequired=items.some(i=>i.requiredActions?.some(action=>action.action==='product_footage'));
    const collectionStatusRequired=items.some(i=>i.requiredActions?.some(action=>['weekly_preproduction_collection_credentials_required','weekly_preproduction_collection_budget_authorization_required','weekly_preproduction_collection_budget_authorization_unverified','weekly_preproduction_collection_cost_ceiling_unverified','weekly_preproduction_collection_dataset_cost_unverified'].includes(action.code)));
    const refreshAudit = async () => {
        if (!target) return;
        const captured = identity, token = getToken();
        const base = `/api/overseas/social-programs/${encodeURIComponent(target.programId)}/operating-packages/${encodeURIComponent(target.packageId)}/execution-pipeline`;
        const response = await fetch(`${base}/task-audit?version=${target.packageVersion}`, { headers: authHeader() });
        const body = await response.json();
        if (!response.ok) throw Error(body.message || '任务状态刷新失败');
        if (current.current === captured && getToken() === token) setItems(body.item.items.filter((item: AuditItem) => targets.some(source => source.workspaceTarget?.executionTaskId === item.taskId)));
    };
    function openAction(action: (typeof actions)[number]) {
        const source = targets.find(t => t.workspaceTarget?.executionTaskId === action.taskId) ?? targets[0]!;
        if(isPostAnalysisSystemGap(action.code)||action.action==='presenter_voice')return onOpen(source);
        if (action.code === 'weekly_cta_contact_read_failed' || action.code === 'weekly_production_product_selection_read_failed' || action.code === 'weekly_production_product_selection_group_conflict') { void refreshAudit().catch(e=>setError(e instanceof Error?e.message:'任务状态重新读取失败')); return; }
        if (action.action === 'publication_product') {
            const section = document.getElementById(`weekly-product-selection-${target?.packageId}`);
            section?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
            section?.focus({ preventScroll: true });
            return;
        }
        if (action.action === 'cta_contact' || action.action === 'sample_policy') {
            const id = action.action === 'sample_policy' ? `weekly-cta-sample-policy-${target?.packageId}` : `weekly-cta-contact-${target?.packageId}`;
            const section = document.getElementById(id);
            section?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
            section?.focus({ preventScroll: true });
            return;
        }
        if(action.action==='product_footage'){
            const section=document.getElementById(`weekly-product-footage-${target?.packageId}`);
            section?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});
            section?.focus({preventScroll:true});return;
        }
        if(['collection_service','technical_recovery'].includes(action.action)&&['weekly_preproduction_collection_credentials_required','weekly_preproduction_collection_budget_authorization_required','weekly_preproduction_collection_budget_authorization_unverified','weekly_preproduction_collection_cost_ceiling_unverified','weekly_preproduction_collection_dataset_cost_unverified'].includes(action.code)){
            const section=document.getElementById(`weekly-collection-status-${target?.packageId}`);
            section?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});
            section?.focus({preventScroll:true});return;
        }
        if (action.action === 'enterprise_facts') return openEnterprise('company');
        if (action.action === 'enterprise_products') return openEnterprise('products');
        if (action.action === 'candidate_analysis') {
            window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'socialInspiration' } })); return;
        }
        if (action.action === 'channel' && action.channel !== 'whatsapp') {
            window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'channels' } })); return;
        }
        if (action.action === 'technical_recovery' && onPlanning && !/customer|messenger|whatsapp|instagram|followup/.test(action.code)) return onPlanning();
        onOpen(source);
    }
    if (!target)
        return null;
    return <section aria-label="任务快捷行动与默认模板" className="space-y-3 border-t border-border pt-4"><h4 className="font-semibold">快捷行动与默认模板</h4>
 <Descriptions size="small" column={1} items={[{ key: 'price', label: '成片费用', children: '每条不超过 ¥10；不再单独要求确认整周预算，也不会自动提额' }, { key: 'cta', label: '默认 CTA', children: defaults.callToAction }, { key: 'crawl', label: '采集规则', children: '本轮同账号目标为5条不同的合格视频，每日最多采集10条；采集与语义分析需分别取得明确人民币额度，费用上界未核验前不得付费采集' }, { key: 'clock', label: '执行窗口', children: '普通任务06:00起按依赖执行；常驻客服00:00至次日00:00' }, { key: 'adopt', label: '模板留痕', children: adopted ? `已自动采用 · ${adopted}；不代表发布或成片验收通过` : '尚未留痕，启动任务时自动采用' }]}/>
 {!adopted && <Button loading={busy} onClick={() => void adopt()}>应用默认模板（无需审批）</Button>}
 {ctaContactStatus&&<Alert type="warning" showIcon title={ctaContactStatus==='unavailable'?'CTA 联系记录待读取恢复':'CTA 仍待干预'} description={ctaContactStatus==='missing'?'联系号码待填写；免费样品承诺也待可核验证据。':ctaContactStatus==='recorded'?'联系方式已记录；免费样品承诺仍待可核验证据，其他卡点不变。':'联系记录读取失败，无法判断号码是否已填写；请待系统恢复后重新核验。'}/>}
 {ctaContactStatus&&ctaContactStatus!=='unavailable'&&<div id={`weekly-cta-contact-${target.packageId}`} tabIndex={-1}><WeeklyCtaContactIntervention scope={{programId:target.programId,packageId:target.packageId,packageVersion:target.packageVersion}} samplePolicySectionId={`weekly-cta-sample-policy-${target.packageId}`} openWhenMissing={ctaContactStatus==='missing'} onRecorded={refreshAudit}/></div>}
 {productSelectionRequired&&<div id={`weekly-product-selection-${target.packageId}`} tabIndex={-1}><WeeklyProductSelectionIntervention scope={{programId:target.programId,packageId:target.packageId,packageVersion:target.packageVersion}} onSelected={refreshAudit}/></div>}
 {productSelectionReadFailed&&<Alert type="error" showIcon title="发布选品需要技术核验" description="选品记录不可读或同母版组回执冲突；请系统恢复，不要覆盖或重复提交。" />}
 <WeeklyAccountCollectionIntervention packageIdentity={`${target.programId}:${target.packageId}:${target.packageVersion}`} />
 {collectionStatusRequired&&<div id={`weekly-collection-status-${target.packageId}`} tabIndex={-1}><WeeklyCollectionCredentialIntervention scope={{programId:target.programId,packageId:target.packageId,packageVersion:target.packageVersion}} /></div>}
 <WeeklyPinnedReferenceIntervention scope={{programId:target.programId,packageId:target.packageId,packageVersion:target.packageVersion}} />
 {productFootageRequired&&<div id={`weekly-product-footage-${target.packageId}`} tabIndex={-1}><WeeklyProductFootageIntervention scope={{programId:target.programId,packageId:target.packageId,packageVersion:target.packageVersion}} /></div>}
 {error && <Alert type="error" showIcon title={error}/>}
 {whatsappTask&&<div className="space-y-2"><Alert type="info" showIcon title={whatsappTask.whatsappMock?.status==='passed'?'WhatsApp Mock 传输联调已通过':'WhatsApp 可用 Mock 传输联调'} description="仅验证模拟收信、入队与回执存储；不验证 AI 回复质量，不代表真实授权、24小时值守或业务交付，不会发送真实消息。"/><Button loading={busy} onClick={()=>void runMock(whatsappTask.taskId)}>运行 WhatsApp Mock</Button></div>}
 {onPlanning && <Button onClick={onPlanning}>补排或调整任务范围</Button>}
 {diagnostics.length > 0 && <div className="space-y-3"><h5 className="text-sm font-semibold">本步骤资料提示</h5><p className="text-xs text-text-secondary">以下来自已有资料，只提示本步骤需要核对的内容；不会自动新增阻塞原因或暂停其他分支。</p>{diagnostics.map(d => <div key={d.code} className="space-y-1"><p className="text-sm">{d.label}</p><p className="text-xs text-text-secondary">{d.impact}</p>{d.sourceVersion && <p className="break-words text-xs text-text-secondary">来源：已有企业与产品资料 · {d.sourceVersion}</p>}<Button size="small" onClick={() => openEnterprise(d.action === 'enterprise_products' ? 'products' : 'company')}>{d.action === 'enterprise_products' ? '补充产品素材与权利' : '补充公司与市场资料'}</Button></div>)}</div>}
 {actions.length > 0 && <div className="space-y-3">{[true, false].map(userRequired => { const group = actions.filter(a => a.userRequired === userRequired); return group.length > 0 && <div key={String(userRequired)} className="space-y-2"><h5 className="text-sm font-semibold">{userRequired ? '真实分支待补充' : '系统技术待恢复'}</h5>{group.map(action => <div key={`${action.channel ?? ''}:${action.action}:${action.label}`} className="flex min-w-0 flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-words text-sm">{action.label !== action.code ? action.label : labels[action.code] ?? action.code}</span><Button className={action.action === 'cta_contact' || action.action === 'sample_policy' || action.action === 'publication_product' || action.action === 'product_footage' || action.action === 'presenter_voice' || action.code === 'weekly_cta_contact_read_failed' || action.code === 'weekly_production_product_selection_read_failed' ? 'min-h-11' : undefined} size="small" onClick={() => openAction(action)}>{isPostAnalysisSystemGap(action.code) ? '查看任务卡 · 系统待接线' : action.code === 'weekly_cta_contact_read_failed' || action.code === 'weekly_production_product_selection_read_failed' ? '重新核验记录' : action.action === 'cta_contact' ? '填写联系号码' : action.action === 'sample_policy' ? '查看样品证据缺口' : action.action === 'publication_product' ? '选择发布商品' : action.action === 'product_footage' ? '查看当前样片素材卡点' : action.action === 'presenter_voice' ? '查看当前样片人物声音卡点' : action.action === 'enterprise_facts' ? '核对已有资料' : action.action === 'channel' ? '进入真实渠道操作' : userRequired ? '进入对应生产界面' : '查看恢复入口'}</Button></div>)}</div>; })}</div>}
 <p className="text-xs text-text-secondary">渠道缺项在执行中补充；成片验收和发布许可进入“发布与渠道”。只有真实执行开始才移除缺项提示，真实交付完成后显示对勾。</p></section>;
}
