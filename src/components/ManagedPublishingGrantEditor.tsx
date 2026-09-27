import type { DigitalEmployeeConfig } from '../lib/digitalEmployees';
import { managedPublishingGrantErrors } from '../../shared/contracts/managedPublishingGrant';

export default function ManagedPublishingGrantEditor({ config, onChange }: { config: DigitalEmployeeConfig; onChange: (value: DigitalEmployeeConfig['managedPublishingGrant']) => void }) {
  const grant = config.managedPublishingGrant;
  const errors = managedPublishingGrantErrors(grant, config);
  const eligible = config.autonomyMode === 'automatic' && config.allowRealPublishing && config.enabledWorkflows.includes('content_publish') && config.publishingTargets.length > 0;
  const patch = (value: Partial<NonNullable<typeof grant>>) => onChange({ enabled: false, accountIds: [], maxPublishItems: 1, validUntil: '', ...grant, ...value });
  return <section className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4">
    <h3 className="text-sm font-bold text-slate-900">持续托管的发布授权</h3>
    <p className="mt-1 text-xs leading-5 text-slate-600">默认仅制作或逐条审批。勾选并保存后，当前及后续周期可在以下范围内自动批准发布；不包含客户消息、商业承诺或超出范围的内容。</p>
    <label className="mt-3 flex items-start gap-2 text-xs font-semibold"><input type="checkbox" checked={grant?.enabled === true} disabled={!eligible && !grant?.enabled} onChange={event => patch({ enabled: event.target.checked })} />我授权数字员工在截止日期前，按所选账号和每周期上限自动发布</label>
    {!eligible && <p className="mt-2 text-xs text-amber-800">需先选择全自动自主等级、启用内容发布和真实发布，并绑定具体账号。仅开启托管编导不会获得发布权限。</p>}
    {grant?.enabled && <div className="mt-4 space-y-3">
      <fieldset><legend className="text-xs font-semibold">允许持续发布的账号</legend><div className="mt-2 flex flex-wrap gap-3">{config.publishingTargets.map(account => <label key={account.accountId} className="text-xs"><input type="checkbox" checked={grant.accountIds.includes(account.accountId)} onChange={event => patch({ accountIds: event.target.checked ? [...grant.accountIds, account.accountId] : grant.accountIds.filter(id => id !== account.accountId) })} /> {account.platform} · {account.accountLabel}</label>)}</div></fieldset>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">每周期发布项上限<input type="number" min={1} max={100} className="ui-field mt-1" value={grant.maxPublishItems} onChange={event => patch({ maxPublishItems: Number(event.target.value) })} /></label><label className="text-xs font-semibold">授权截止日期（北京时间）<input type="date" min={new Date().toISOString().slice(0, 10)} className="ui-field mt-1" value={grant.validUntil} onChange={event => patch({ validUntil: event.target.value })} /></label></div>
      <p className="text-xs text-slate-600">周期完成后，后台在下一周期窗口自动续接；保留原周期账号、任务数量与每周期制作预算，不能超过此上限。超范围、过期或撤销后回到待处理；平台连接、内容验收和真实回执仍需分别满足。保存配置即更新授权，旧引用不会自动扩大。</p>
      {errors.length > 0 && <p role="alert" className="text-xs text-red-700">{errors.join('；')}</p>}
    </div>}
  </section>;
}
