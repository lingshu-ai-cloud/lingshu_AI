import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions } from 'antd';
import { socialProgramApi } from '../../lib/socialProgramApi';
import { WEEKLY_AUTOMATION_TEMPLATE as defaults } from '../../../shared/weeklyAutomationTemplate';
import type { AgentCalendarTask } from '../smartBusiness/AgentWeeklyCalendar';
import { authHeader, getToken } from '../../lib/auth';
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
    requiredActions?: Array<{code:string;taskId?:string;channel?:string|null;label:string;action:string;userRequired:boolean}>;
    requirementDiagnostics?: Array<{code:string;label:string;impact:string;action:string;sourceVersion:string|null;diagnosticOnly:true}>;
    whatsappMock?: {status:string;createdAt:string;realAuthorization:false;businessDelivery:false}|null;
};
const labels: Record<string, string> = { business_goal_unavailable: '系统恢复生产目标绑定', capacity_plan_unavailable: '系统恢复资源容量', automation_policy_unavailable: '系统核验自动执行能力', weekly_initial_capacity_schedule_required: '系统采用模板补排任务及资源窗口', business_dispatch_required: '系统完成排期并派单', benchmark_account_video_link_required: '补齐对标账号和视频关联', weekly_preproduction_authority_required: '系统绑定真实采集范围与原任务', weekly_preproduction_outline_goal_not_ready: '系统恢复生产目标，真实转化许可仅影响对外分支' };
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
    function openAction(action: (typeof actions)[number]) {
        const source = targets.find(t => t.workspaceTarget?.executionTaskId === action.taskId) ?? targets[0]!;
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
 <Descriptions size="small" column={1} items={[{ key: 'price', label: '成片费用', children: '每条不超过 ¥15；不再单独要求确认整周预算' }, { key: 'cta', label: '默认 CTA', children: defaults.callToAction }, { key: 'crawl', label: '采集规则', children: '从货盘、公司资料与行业词生成5个搜索词；每天最多采集10条，不设置采集金额上限' }, { key: 'clock', label: '执行窗口', children: '普通任务06:00起按依赖执行；常驻客服00:00至次日00:00' }, { key: 'adopt', label: '模板留痕', children: adopted ? `已自动采用 · ${adopted}；不代表授权或验收通过` : '尚未留痕，启动任务时自动采用' }]}/>
 {!adopted && <Button loading={busy} onClick={() => void adopt()}>应用默认模板（无需审批）</Button>}
 {error && <Alert type="error" showIcon title={error}/>}
 {whatsappTask&&<div className="space-y-2"><Alert type="info" showIcon title={whatsappTask.whatsappMock?.status==='passed'?'WhatsApp Mock 传输联调已通过':'WhatsApp 可用 Mock 传输联调'} description="仅验证模拟收信、入队与回执存储；不验证 AI 回复质量，不代表真实授权、24小时值守或业务交付，不会发送真实消息。"/><Button loading={busy} onClick={()=>void runMock(whatsappTask.taskId)}>运行 WhatsApp Mock</Button></div>}
 {onPlanning && <Button onClick={onPlanning}>补排或调整任务范围</Button>}
 {diagnostics.length > 0 && <div className="space-y-3"><h5 className="text-sm font-semibold">本步骤资料提示</h5><p className="text-xs text-text-secondary">以下来自已有资料，只提示本步骤需要核对的内容；不会自动新增阻塞原因或暂停其他分支。</p>{diagnostics.map(d => <div key={d.code} className="space-y-1"><p className="text-sm">{d.label}</p><p className="text-xs text-text-secondary">{d.impact}</p>{d.sourceVersion && <p className="break-words text-xs text-text-secondary">来源：已有企业与产品资料 · {d.sourceVersion}</p>}<Button size="small" onClick={() => openEnterprise(d.action === 'enterprise_products' ? 'products' : 'company')}>{d.action === 'enterprise_products' ? '补充产品素材与权利' : '补充公司与市场资料'}</Button></div>)}</div>}
 {actions.length > 0 && <div className="space-y-3">{[true, false].map(userRequired => { const group = actions.filter(a => a.userRequired === userRequired); return group.length > 0 && <div key={String(userRequired)} className="space-y-2"><h5 className="text-sm font-semibold">{userRequired ? '真实分支待补充' : '系统技术待恢复'}</h5>{group.map(action => <div key={`${action.channel ?? ''}:${action.action}:${action.label}`} className="flex min-w-0 flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-words text-sm">{action.label !== action.code ? action.label : labels[action.code] ?? action.code}</span><Button size="small" onClick={() => openAction(action)}>{action.action === 'enterprise_facts' ? '核对已有资料' : action.action === 'channel' ? '进入真实渠道操作' : userRequired ? '进入对应生产界面' : '查看恢复入口'}</Button></div>)}</div>; })}</div>}
 <p className="text-xs text-text-secondary">渠道缺项在执行中补充；成片验收和发布许可进入“发布与渠道”。只有真实执行开始才移除缺项提示，真实交付完成后显示对勾。</p></section>;
}
