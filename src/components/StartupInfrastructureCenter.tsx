import { useMemo, useState } from 'react';
import { AlertTriangle, Boxes, Check, CloudCog, GitBranch, Plus, ServerCog, ShieldCheck, UserCog, Users } from 'lucide-react';
import type { StartupDeployment, StartupHubSnapshot, StartupMember, StartupResource } from '../../shared/startupHub';
import type { StartupHubActions } from '../lib/startupHubUi';

interface Props { snapshot: StartupHubSnapshot; actions: StartupHubActions; saving: boolean }
type SettingsView = 'operations' | 'deployments' | 'permissions';

const ROLE_LABEL: Record<StartupMember['role'], string> = { admin: '管理员', operator: '协作者', viewer: '只读成员' };
const BILLING_LABEL: Record<NonNullable<StartupResource['billingCycle']>, string> = { monthly: '月付', quarterly: '季付', annual: '年付', pay_as_you_go: '按量付费', free: '免费' };
const DEPLOYMENT_TYPE: Record<StartupDeployment['serviceType'], string> = { frontend: '前端', api: 'API 服务', worker: '后台任务', database: '数据库', proxy: '反向代理', storage: '存储', other: '其他' };
const CURRENCY_SYMBOL = { CNY: '¥', USD: '$', EUR: '€', HKD: 'HK$' } as const;

const emptyResource = () => ({
  name: '', type: '云服务器', environment: '生产', owner: '', status: 'unknown' as StartupResource['status'], provider: '', region: '',
  billingCycle: 'monthly' as NonNullable<StartupResource['billingCycle']>, subscriptionAmount: '', currency: 'CNY' as NonNullable<StartupResource['currency']>, renewalDate: '',
  cpuCores: '', memoryTotalGb: '', storageUsedGb: '', storageTotalGb: '', trafficUsedGb: '', trafficTotalGb: '', managementUrl: '', notes: '',
});

const emptyDeployment = () => ({
  name: '', resourceId: '', environment: '生产', serviceType: 'api' as StartupDeployment['serviceType'], owner: '',
  status: 'planned' as StartupDeployment['status'], version: '', branch: '', url: '', deployedAt: '',
});

function numberOrUndefined(value: string): number | undefined {
  return value.trim() === '' ? undefined : Number(value);
}

function daysUntil(value?: string): number | null {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
}

function usage(item: StartupResource, used: 'storageUsedGb' | 'trafficUsedGb', total: 'storageTotalGb' | 'trafficTotalGb') {
  const maximum = item[total];
  const current = item[used];
  if (maximum === undefined || current === undefined || maximum <= 0) return null;
  return { percent: Math.min(100, Math.round((current / maximum) * 100)), remaining: Math.max(0, maximum - current) };
}

export default function StartupInfrastructureCenter({ snapshot, actions, saving }: Props) {
  const [view, setView] = useState<SettingsView>('operations');
  const [formOpen, setFormOpen] = useState(false);
  const [resource, setResource] = useState(emptyResource);
  const [deployment, setDeployment] = useState(emptyDeployment);
  const [member, setMember] = useState({ name: '', email: '', role: 'operator' as StartupMember['role'], status: 'invited' as StartupMember['status'] });

  const activeMembers = snapshot.members.filter(item => item.status === 'active');
  const adminCount = activeMembers.filter(item => item.role === 'admin').length;
  const renewalRisks = snapshot.resources.filter(item => { const days = daysUntil(item.renewalDate); return days !== null && days <= 30; });
  const capacityRisks = snapshot.resources.filter(item => [usage(item, 'storageUsedGb', 'storageTotalGb'), usage(item, 'trafficUsedGb', 'trafficTotalGb')].some(metric => metric && metric.percent >= 80));
  const runningDeployments = snapshot.deployments.filter(item => item.status === 'running').length;
  const monthlyCost = snapshot.resources.reduce((sum, item) => {
    if (!item.subscriptionAmount || item.currency !== 'CNY') return sum;
    if (item.billingCycle === 'annual') return sum + item.subscriptionAmount / 12;
    if (item.billingCycle === 'quarterly') return sum + item.subscriptionAmount / 3;
    if (item.billingCycle === 'monthly') return sum + item.subscriptionAmount;
    return sum;
  }, 0);

  const checks = useMemo(() => [
    { title: '生产资源已纳管', passed: snapshot.resources.some(item => item.environment === '生产'), detail: `${snapshot.resources.filter(item => item.environment === '生产').length} 项生产资源` },
    { title: '续费日期已登记', passed: snapshot.resources.length > 0 && snapshot.resources.every(item => item.billingCycle === 'free' || Boolean(item.renewalDate)), detail: `${snapshot.resources.filter(item => item.billingCycle !== 'free' && !item.renewalDate).length} 项待补充` },
    { title: '容量指标可判断', passed: snapshot.resources.some(item => item.storageTotalGb || item.trafficTotalGb), detail: `${capacityRisks.length} 项容量风险` },
    { title: '部署归属可追踪', passed: snapshot.deployments.length > 0 && snapshot.deployments.every(item => Boolean(item.resourceId && item.owner)), detail: `${snapshot.deployments.length} 条部署记录` },
  ], [capacityRisks.length, snapshot.deployments, snapshot.resources]);

  const changeView = (next: SettingsView) => { setView(next); setFormOpen(false); };
  const createResource = async () => {
    if (!resource.name.trim() || !resource.owner.trim()) return;
    await actions.create('resources', {
      name: resource.name, type: resource.type, environment: resource.environment, owner: resource.owner, status: resource.status,
      provider: resource.provider || undefined, region: resource.region || undefined, billingCycle: resource.billingCycle,
      subscriptionAmount: numberOrUndefined(resource.subscriptionAmount), currency: resource.currency, renewalDate: resource.renewalDate || undefined,
      cpuCores: numberOrUndefined(resource.cpuCores), memoryTotalGb: numberOrUndefined(resource.memoryTotalGb),
      storageUsedGb: numberOrUndefined(resource.storageUsedGb), storageTotalGb: numberOrUndefined(resource.storageTotalGb),
      trafficUsedGb: numberOrUndefined(resource.trafficUsedGb), trafficTotalGb: numberOrUndefined(resource.trafficTotalGb),
      managementUrl: resource.managementUrl || undefined, notes: resource.notes || undefined,
    });
    setResource(emptyResource()); setFormOpen(false);
  };
  const createDeployment = async () => {
    if (!deployment.name.trim() || !deployment.resourceId || !deployment.owner.trim()) return;
    await actions.create('deployments', { ...deployment, version: deployment.version || undefined, branch: deployment.branch || undefined, url: deployment.url || undefined, deployedAt: deployment.deployedAt || undefined });
    setDeployment(emptyDeployment()); setFormOpen(false);
  };
  const createMember = async () => {
    if (!member.name.trim() || !member.email.trim()) return;
    await actions.create('members', member);
    setMember({ name: '', email: '', role: 'operator', status: 'invited' }); setFormOpen(false);
  };

  return <div className="space-y-4">
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="已纳管资源" value={String(snapshot.resources.length)} />
      <Metric label="运行中部署" value={String(runningDeployments)} />
      <Metric label="30 天内续费" value={String(renewalRisks.length)} warning={renewalRisks.length > 0} />
      <Metric label="人民币月均订阅" value={`¥${monthlyCost.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`} />
    </section>

    <section className="section-panel overflow-hidden">
      <div className="flex flex-col justify-between gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center">
        <div className="flex gap-1 overflow-x-auto" role="tablist">
          <Tab active={view === 'operations'} onClick={() => changeView('operations')} icon={<ServerCog size={13} />} label="服务器与订阅" />
          <Tab active={view === 'deployments'} onClick={() => changeView('deployments')} icon={<GitBranch size={13} />} label="部署管理" />
          <Tab active={view === 'permissions'} onClick={() => changeView('permissions')} icon={<UserCog size={13} />} label="用户权限" />
        </div>
        <button type="button" onClick={() => setFormOpen(value => !value)} className="btn-primary flex items-center justify-center gap-1.5 px-3 py-2 text-[10px]"><Plus size={12} />{view === 'operations' ? '登记资源' : view === 'deployments' ? '记录部署' : '添加成员'}</button>
      </div>

      {view === 'operations' && <>
        {formOpen && <ResourceForm value={resource} onChange={setResource} onSave={() => void createResource()} onCancel={() => setFormOpen(false)} disabled={saving || !resource.name.trim() || !resource.owner.trim()} owners={snapshot.members} />}
        <div className="grid xl:grid-cols-[minmax(0,1.35fr)_360px]">
          <div className="border-b border-border xl:border-b-0 xl:border-r">
            <SectionTitle title="服务器、存储与订阅" detail="记录真实供应商、费用、续费日期和容量；不自动生成示例资产。" />
            {snapshot.resources.length ? <div className="divide-y divide-border">{snapshot.resources.map(item => <ResourceRow key={item.id} item={item} saving={saving} onUpdate={patch => void actions.update('resources', item.id, patch)} />)}</div> : <Empty icon={<ServerCog size={28} />} title="还没有服务器或订阅" detail="登记实际云服务器、数据库、对象存储、域名、证书和关键 SaaS。" />}
          </div>
          <div>
            <SectionTitle title="仓库识别到的运行架构" detail="这是代码与部署配置中的事实，不代表已确认云账号和机器规格。" />
            <div className="space-y-3 p-5 text-[10px]">
              <Architecture icon={<CloudCog size={14} />} title="推荐部署目标" detail="腾讯云 CloudBase Run；实际账号与实例规格尚未在仓库中记录。" />
              <Architecture icon={<Boxes size={14} />} title="应用运行层" detail="Docker + Node/Express，Caddy 负责反向代理与入口。" />
              <Architecture icon={<ServerCog size={14} />} title="数据与镜像" detail="PocketBase 持久卷；GHCR 构建镜像，文档建议后续接 COS。" />
            </div>
            <div className="border-t border-border"><SectionTitle title="运营检查" detail="根据你实际录入的数据实时判断。" /><div className="divide-y divide-border">{checks.map(item => <div key={item.title} className="flex gap-3 p-4"><span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${item.passed ? 'bg-[#e8f2eb] text-accent' : 'bg-[#fff4e8] text-[#a6572a]'}`}>{item.passed ? <Check size={12} /> : <AlertTriangle size={12} />}</span><div><p className="font-semibold">{item.title}</p><p className="mt-1 text-[9px] text-text-muted">{item.detail}</p></div></div>)}</div></div>
          </div>
        </div>
      </>}

      {view === 'deployments' && <>
        {formOpen && <DeploymentForm value={deployment} onChange={setDeployment} onSave={() => void createDeployment()} onCancel={() => setFormOpen(false)} disabled={saving || !deployment.name.trim() || !deployment.resourceId || !deployment.owner.trim()} resources={snapshot.resources} owners={snapshot.members} />}
        <SectionTitle title="部署台账" detail="把版本、分支、运行环境和承载资源关联起来，异常状态会进入总览风险队列。" />
        {snapshot.deployments.length ? <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left"><thead className="border-b border-border bg-[#fbfcfa] text-[9px] text-text-muted"><tr><th className="px-5 py-2.5">服务</th><th className="px-4 py-2.5">承载资源</th><th className="px-4 py-2.5">版本 / 分支</th><th className="px-4 py-2.5">部署时间</th><th className="px-4 py-2.5">状态</th></tr></thead><tbody className="divide-y divide-border">{snapshot.deployments.map(item => <tr key={item.id} className="text-[10px]"><td className="px-5 py-3.5"><p className="font-semibold">{item.name}</p><p className="mt-1 text-[9px] text-text-muted">{DEPLOYMENT_TYPE[item.serviceType]} · {item.environment} · {item.owner}</p>{item.url && <a href={item.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-[9px] text-accent hover:underline">{item.url}</a>}</td><td className="px-4 py-3.5">{snapshot.resources.find(resourceItem => resourceItem.id === item.resourceId)?.name || '资源已不存在'}</td><td className="px-4 py-3.5">{item.version || '—'}<span className="block text-[9px] text-text-muted">{item.branch || '未记录分支'}</span></td><td className="px-4 py-3.5">{item.deployedAt ? new Date(item.deployedAt).toLocaleString('zh-CN') : '未部署'}</td><td className="px-4 py-3.5"><select value={item.status} onChange={event => void actions.update('deployments', item.id, { status: event.target.value as StartupDeployment['status'] })} disabled={saving} className="rounded-lg border border-border bg-white px-2 py-1 text-[9px]"><option value="planned">计划中</option><option value="deploying">部署中</option><option value="running">运行中</option><option value="degraded">异常</option><option value="stopped">已停止</option></select></td></tr>)}</tbody></table></div> : <Empty icon={<GitBranch size={28} />} title="还没有部署记录" detail={snapshot.resources.length ? '记录第一次真实部署，形成服务到服务器的追踪关系。' : '请先在“服务器与订阅”登记承载资源。'} />}
      </>}

      {view === 'permissions' && <>
        {formOpen && <div className="grid gap-3 border-b border-border bg-[#fbfcfa] p-5 md:grid-cols-2"><Field label="成员姓名"><input value={member.name} onChange={event => setMember(value => ({ ...value, name: event.target.value }))} className="ui-field mt-1.5" /></Field><Field label="工作邮箱"><input type="email" value={member.email} onChange={event => setMember(value => ({ ...value, email: event.target.value }))} className="ui-field mt-1.5" /></Field><Field label="角色"><select value={member.role} onChange={event => setMember(value => ({ ...value, role: event.target.value as StartupMember['role'] }))} className="ui-field ui-select mt-1.5"><option value="admin">管理员</option><option value="operator">协作者</option><option value="viewer">只读成员</option></select></Field><Field label="账号状态"><select value={member.status} onChange={event => setMember(value => ({ ...value, status: event.target.value as StartupMember['status'] }))} className="ui-field ui-select mt-1.5"><option value="invited">待加入</option><option value="active">已启用</option><option value="disabled">已停用</option></select></Field><FormActions onSave={() => void createMember()} onCancel={() => setFormOpen(false)} disabled={saving || !member.name.trim() || !member.email.trim()} /></div>}
        <SectionTitle title="成员与角色" detail="权限台账用于协作分工；实际接口访问仍由服务端登录身份控制。" />
        {snapshot.members.length ? <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left"><thead className="border-b border-border bg-[#fbfcfa] text-[9px] text-text-muted"><tr><th className="px-5 py-2.5">成员</th><th className="px-4 py-2.5">角色</th><th className="px-4 py-2.5">状态</th></tr></thead><tbody className="divide-y divide-border">{snapshot.members.map(item => <tr key={item.id} className="text-[10px]"><td className="px-5 py-3.5"><div className="flex items-center gap-2"><Users size={13} className="text-accent" /><div><p className="font-semibold">{item.name}</p><p className="text-[9px] text-text-muted">{item.email}</p></div></div></td><td className="px-4 py-3.5"><select value={item.role} onChange={event => void actions.update('members', item.id, { role: event.target.value as StartupMember['role'] })} className="rounded-lg border border-border bg-white px-2 py-1 text-[9px]"><option value="admin">管理员</option><option value="operator">协作者</option><option value="viewer">只读成员</option></select></td><td className="px-4 py-3.5"><select value={item.status} onChange={event => void actions.update('members', item.id, { status: event.target.value as StartupMember['status'] })} className="rounded-lg border border-border bg-white px-2 py-1 text-[9px]"><option value="invited">待加入</option><option value="active">已启用</option><option value="disabled">已停用</option></select><span className="ml-2 text-[9px] text-text-muted">{ROLE_LABEL[item.role]}</span></td></tr>)}</tbody></table></div> : <Empty icon={<UserCog size={28} />} title="还没有成员" detail="添加真实成员后再分配工作区角色。" />}
        <div className="m-5 flex items-start gap-3 rounded-xl border border-[#e7dfc8] bg-[#fffdf7] p-4"><ShieldCheck size={16} className="shrink-0 text-[#a66c24]" /><p className="text-[9px] leading-4 text-text-muted">此处不保存密码、密钥或云账号凭证。敏感凭证请使用专业密钥管理服务。</p></div>
      </>}
    </section>
  </div>;
}

function Metric({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) { return <div className="section-panel p-4"><p className="text-[9px] text-text-muted">{label}</p><p className={`mt-2 text-2xl font-semibold ${warning ? 'text-red-700' : ''}`}>{value}</p></div>; }
function Tab({ active, onClick, icon, label }: { active: boolean; onClick(): void; icon: React.ReactNode; label: string }) { return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-semibold ${active ? 'bg-[#e8f2eb] text-accent' : 'text-text-secondary hover:bg-[#f4f6f3]'}`}>{icon}{label}</button>; }
function SectionTitle({ title, detail }: { title: string; detail: string }) { return <div className="border-b border-border px-5 py-4"><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-[10px] text-text-muted">{detail}</p></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-[10px] font-semibold text-text-secondary">{label}{children}</label>; }
function FormActions({ onSave, onCancel, disabled }: { onSave(): void; onCancel(): void; disabled: boolean }) { return <div className="flex gap-2 md:col-span-2 xl:col-span-4"><button type="button" onClick={onSave} disabled={disabled} className="btn-primary px-4 py-2 text-[10px] disabled:opacity-45">保存</button><button type="button" onClick={onCancel} className="btn-ghost px-4 py-2 text-[10px]">取消</button></div>; }
function Empty({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) { return <div className="grid min-h-[300px] place-items-center px-6 text-center"><div><span className="mx-auto grid place-items-center text-text-muted">{icon}</span><p className="mt-3 text-xs font-semibold">{title}</p><p className="mt-1 text-[10px] text-text-muted">{detail}</p></div></div>; }
function Architecture({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) { return <div className="flex gap-3 rounded-xl border border-border bg-[#fbfcfa] p-3"><span className="text-accent">{icon}</span><div><p className="font-semibold">{title}</p><p className="mt-1 text-[9px] leading-4 text-text-muted">{detail}</p></div></div>; }

function ResourceForm({ value, onChange, onSave, onCancel, disabled, owners }: { value: ReturnType<typeof emptyResource>; onChange: React.Dispatch<React.SetStateAction<ReturnType<typeof emptyResource>>>; onSave(): void; onCancel(): void; disabled: boolean; owners: StartupMember[] }) {
  const set = (patch: Partial<ReturnType<typeof emptyResource>>) => onChange(current => ({ ...current, ...patch }));
  return <div className="grid gap-3 border-b border-border bg-[#fbfcfa] p-5 md:grid-cols-2 xl:grid-cols-4">
    <Field label="资源名称 *"><input value={value.name} onChange={event => set({ name: event.target.value })} className="ui-field mt-1.5" placeholder="例如：生产 API 主机" /></Field>
    <Field label="资源类型"><select value={value.type} onChange={event => set({ type: event.target.value })} className="ui-field ui-select mt-1.5"><option>云服务器</option><option>数据库</option><option>对象存储</option><option>域名 / DNS</option><option>CDN</option><option>证书</option><option>第三方 SaaS</option><option>其他</option></select></Field>
    <Field label="环境"><select value={value.environment} onChange={event => set({ environment: event.target.value })} className="ui-field ui-select mt-1.5"><option>开发</option><option>测试</option><option>预发布</option><option>生产</option></select></Field>
    <Field label="负责人 *"><input list="infrastructure-owners" value={value.owner} onChange={event => set({ owner: event.target.value })} className="ui-field mt-1.5" /><datalist id="infrastructure-owners">{owners.filter(item => item.status !== 'disabled').map(item => <option key={item.id} value={item.name} />)}</datalist></Field>
    <Field label="供应商"><select value={value.provider} onChange={event => set({ provider: event.target.value })} className="ui-field ui-select mt-1.5"><option value="">请选择</option><option>腾讯云</option><option>阿里云</option><option>华为云</option><option>AWS</option><option>Cloudflare</option><option>自建</option><option>其他</option></select></Field>
    <Field label="区域"><input value={value.region} onChange={event => set({ region: event.target.value })} className="ui-field mt-1.5" placeholder="例如：上海 / ap-shanghai" /></Field>
    <Field label="计费周期"><select value={value.billingCycle} onChange={event => set({ billingCycle: event.target.value as NonNullable<StartupResource['billingCycle']> })} className="ui-field ui-select mt-1.5">{Object.entries(BILLING_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
    <Field label="订阅金额"><div className="mt-1.5 flex"><select value={value.currency} onChange={event => set({ currency: event.target.value as NonNullable<StartupResource['currency']> })} className="ui-field ui-select w-[82px] rounded-r-none"><option>CNY</option><option>USD</option><option>EUR</option><option>HKD</option></select><input type="number" min="0" value={value.subscriptionAmount} onChange={event => set({ subscriptionAmount: event.target.value })} className="ui-field rounded-l-none" /></div></Field>
    <Field label="续约日期"><input type="date" value={value.renewalDate} onChange={event => set({ renewalDate: event.target.value })} className="ui-field mt-1.5" /></Field>
    <Field label="CPU 核数"><input type="number" min="0" value={value.cpuCores} onChange={event => set({ cpuCores: event.target.value })} className="ui-field mt-1.5" /></Field>
    <Field label="内存容量（GB）"><input type="number" min="0" value={value.memoryTotalGb} onChange={event => set({ memoryTotalGb: event.target.value })} className="ui-field mt-1.5" /></Field>
    <Field label="存储 已用 / 总量（GB）"><div className="mt-1.5 flex gap-2"><input type="number" min="0" value={value.storageUsedGb} onChange={event => set({ storageUsedGb: event.target.value })} className="ui-field" placeholder="已用" /><input type="number" min="0" value={value.storageTotalGb} onChange={event => set({ storageTotalGb: event.target.value })} className="ui-field" placeholder="总量" /></div></Field>
    <Field label="流量 已用 / 总量（GB）"><div className="mt-1.5 flex gap-2"><input type="number" min="0" value={value.trafficUsedGb} onChange={event => set({ trafficUsedGb: event.target.value })} className="ui-field" placeholder="已用" /><input type="number" min="0" value={value.trafficTotalGb} onChange={event => set({ trafficTotalGb: event.target.value })} className="ui-field" placeholder="总量" /></div></Field>
    <Field label="控制台地址"><input type="url" value={value.managementUrl} onChange={event => set({ managementUrl: event.target.value })} className="ui-field mt-1.5" placeholder="https://" /></Field>
    <Field label="运行状态"><select value={value.status} onChange={event => set({ status: event.target.value as StartupResource['status'] })} className="ui-field ui-select mt-1.5"><option value="unknown">待确认</option><option value="healthy">正常</option><option value="warning">警告</option><option value="offline">离线</option></select></Field>
    <Field label="备注"><input value={value.notes} onChange={event => set({ notes: event.target.value })} className="ui-field mt-1.5" /></Field>
    <FormActions onSave={onSave} onCancel={onCancel} disabled={disabled} />
  </div>;
}

function ResourceRow({ item, saving, onUpdate }: { item: StartupResource; saving: boolean; onUpdate(patch: Partial<StartupResource>): void }) {
  const storage = usage(item, 'storageUsedGb', 'storageTotalGb');
  const traffic = usage(item, 'trafficUsedGb', 'trafficTotalGb');
  const renewal = daysUntil(item.renewalDate);
  return <div className="p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${item.status === 'healthy' ? 'bg-[#e8f2eb] text-accent' : 'bg-[#fff4e8] text-[#a6572a]'}`}><ServerCog size={15} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-[11px] font-semibold">{item.name}</p>{renewal !== null && renewal <= 30 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[8px] font-semibold text-red-700">{renewal < 0 ? `逾期 ${Math.abs(renewal)} 天` : `${renewal} 天后续费`}</span>}</div><p className="mt-1 text-[9px] text-text-muted">{item.type} · {item.environment} · {item.provider || '供应商未填'} · {item.region || '区域未填'} · {item.owner}</p><div className="mt-3 grid gap-2 sm:grid-cols-2"><Capacity label="存储" metric={storage} used={item.storageUsedGb} total={item.storageTotalGb} /><Capacity label="流量" metric={traffic} used={item.trafficUsedGb} total={item.trafficTotalGb} /></div><p className="mt-2 text-[9px] text-text-muted">{item.subscriptionAmount !== undefined ? `${CURRENCY_SYMBOL[item.currency || 'CNY']}${item.subscriptionAmount.toLocaleString()} · ${item.billingCycle ? BILLING_LABEL[item.billingCycle] : '周期未填'}` : '费用未登记'}{item.cpuCores !== undefined ? ` · ${item.cpuCores} 核 / ${item.memoryTotalGb ?? '—'} GB 内存` : ''}</p></div><div className="flex flex-wrap gap-2"><input type="date" value={item.renewalDate?.slice(0, 10) || ''} onChange={event => onUpdate({ renewalDate: event.target.value || undefined })} aria-label={`${item.name}续约日期`} className="rounded-lg border border-border bg-white px-2 py-1 text-[9px]" /><select value={item.status} onChange={event => onUpdate({ status: event.target.value as StartupResource['status'] })} disabled={saving} className="rounded-lg border border-border bg-white px-2 py-1 text-[9px]"><option value="unknown">待确认</option><option value="healthy">正常</option><option value="warning">警告</option><option value="offline">离线</option></select>{item.managementUrl && <a href={item.managementUrl} target="_blank" rel="noreferrer" className="btn-ghost px-3 py-2 text-[9px]">打开控制台</a>}</div></div></div>;
}

function Capacity({ label, metric, used, total }: { label: string; metric: ReturnType<typeof usage>; used?: number; total?: number }) {
  if (!metric) return <div className="rounded-lg border border-dashed border-border px-3 py-2 text-[9px] text-text-muted">{label}容量未登记</div>;
  return <div><div className="mb-1 flex justify-between text-[8px] text-text-muted"><span>{label} {used} / {total} GB</span><span>剩余 {metric.remaining.toLocaleString()} GB</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[#e9ece8]"><span className={`block h-full rounded-full ${metric.percent >= 80 ? 'bg-red-600' : 'bg-accent'}`} style={{ width: `${metric.percent}%` }} /></div></div>;
}

function DeploymentForm({ value, onChange, onSave, onCancel, disabled, resources, owners }: { value: ReturnType<typeof emptyDeployment>; onChange: React.Dispatch<React.SetStateAction<ReturnType<typeof emptyDeployment>>>; onSave(): void; onCancel(): void; disabled: boolean; resources: StartupResource[]; owners: StartupMember[] }) {
  const set = (patch: Partial<ReturnType<typeof emptyDeployment>>) => onChange(current => ({ ...current, ...patch }));
  return <div className="grid gap-3 border-b border-border bg-[#fbfcfa] p-5 md:grid-cols-2 xl:grid-cols-4"><Field label="服务名称 *"><input value={value.name} onChange={event => set({ name: event.target.value })} className="ui-field mt-1.5" /></Field><Field label="承载资源 *"><select value={value.resourceId} onChange={event => set({ resourceId: event.target.value })} className="ui-field ui-select mt-1.5"><option value="">请选择已登记资源</option>{resources.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="服务类型"><select value={value.serviceType} onChange={event => set({ serviceType: event.target.value as StartupDeployment['serviceType'] })} className="ui-field ui-select mt-1.5">{Object.entries(DEPLOYMENT_TYPE).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field label="环境"><select value={value.environment} onChange={event => set({ environment: event.target.value })} className="ui-field ui-select mt-1.5"><option>开发</option><option>测试</option><option>预发布</option><option>生产</option></select></Field><Field label="负责人 *"><input list="deployment-owners" value={value.owner} onChange={event => set({ owner: event.target.value })} className="ui-field mt-1.5" /><datalist id="deployment-owners">{owners.filter(item => item.status !== 'disabled').map(item => <option key={item.id} value={item.name} />)}</datalist></Field><Field label="版本"><input value={value.version} onChange={event => set({ version: event.target.value })} className="ui-field mt-1.5" placeholder="例如：v1.4.0" /></Field><Field label="分支"><input value={value.branch} onChange={event => set({ branch: event.target.value })} className="ui-field mt-1.5" placeholder="例如：main" /></Field><Field label="访问地址"><input type="url" value={value.url} onChange={event => set({ url: event.target.value })} className="ui-field mt-1.5" /></Field><Field label="部署时间"><input type="datetime-local" value={value.deployedAt} onChange={event => set({ deployedAt: event.target.value })} className="ui-field mt-1.5" /></Field><Field label="状态"><select value={value.status} onChange={event => set({ status: event.target.value as StartupDeployment['status'] })} className="ui-field ui-select mt-1.5"><option value="planned">计划中</option><option value="deploying">部署中</option><option value="running">运行中</option><option value="degraded">异常</option><option value="stopped">已停止</option></select></Field><FormActions onSave={onSave} onCancel={onCancel} disabled={disabled} /></div>;
}
