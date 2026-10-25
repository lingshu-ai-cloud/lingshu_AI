import { useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Empty, Select, Space, Table, Tag } from 'antd';
import type { MetaPlanAudit, MetaSetup } from '../../shared/metaPlanAudit';
import { platformAdsRequest } from '../lib/platformAds';
export function MetaPageSelect({ connectionId, value, onChange }: { connectionId: string; value: string; onChange: (id: string) => void }) {
  const [snapshot, setSnapshot] = useState<{ connectionId: string; data: MetaSetup } | null>(null), [error, setError] = useState('');
  const setup = snapshot?.connectionId === connectionId ? snapshot.data : null;
  const [refresh, setRefresh] = useState(0);
  useEffect(() => { const c = new AbortController(); setSnapshot(null); setError(''); if (connectionId) platformAdsRequest<MetaSetup>(`/connections/${connectionId}/meta-setup`, { signal: c.signal }).then(v => { if (!c.signal.aborted) setSnapshot({ connectionId, data: v }); }).catch(e => { if (!c.signal.aborted) setError(e.message); }); return () => c.abort(); }, [connectionId, refresh]);
  useEffect(() => {
    if (!setup) return;
    const pages = setup.pages.filter(p => p.tasks.some(t => ['ADVERTISE', 'MANAGE'].includes(t)));
    if (value && !pages.some(p => p.id === value)) { onChange(''); return; }
    if (!value && setup.defaultPage && pages.some(p => p.id === setup.defaultPage?.id)) onChange(setup.defaultPage.id);
    else if (!value && !setup.hasMorePages && pages.length === 1) onChange(pages[0].id);
  }, [setup, value, onChange]);
  return <div><label>Facebook 主页</label><Select aria-label="已授权 Facebook 主页" style={{ width: '100%' }} value={setup?.pages.some(p => p.id === value) ? value : undefined} placeholder="自动读取可用主页" disabled={!connectionId} onChange={onChange} options={setup?.pages.filter(p => p.tasks.some(t => ['ADVERTISE', 'MANAGE'].includes(t))).map(p => ({ value: p.id, label: p.name })) || []}/>
    <Button type="link" disabled={!connectionId} onClick={() => setRefresh(v => v + 1)}>同步可投放主页</Button>
    {setup && !setup.pages.length && <Alert type="warning" showIcon title="当前账户没有可用于广告的授权主页" description="系统已核对账户可推广主页与现有主页授权。请账户管理员完成资产分配或重新授权，无需填写主页编号。"/>}
    {setup && <p className="ads-muted">{setup.account.currency} · {setup.account.timezone || '时区未返回'} · 最低计划预算 {setup.account.minSpendCap ?? '待核验'} / 最低日预算 {setup.account.minDailyBudget ?? '待核验'}。主页与资产由系统关联。</p>}{setup?.hasMorePages && <Alert type="warning" title="主页目录尚未读取完整，请重新连接账户以同步完整授权。"/>}{error && <Alert type="warning" title={error} description="请重新连接账户后同步主页，无需填写平台编号。"/>}</div>;
}
export default function MetaPlanAuditPanel({ taskId, version, onData, onCreatives }: { taskId: string; version: number; onData: () => void; onCreatives: () => void }) {
  const [data, setData] = useState<MetaPlanAudit | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  useEffect(() => { const c = new AbortController(); setBusy(true); setData(old => old?.taskId === taskId && old.taskVersion === version ? old : null); setError(''); platformAdsRequest<MetaPlanAudit>(`/tasks/${taskId}/meta-audit`, { signal: c.signal }).then(v => { if (!c.signal.aborted) setData(v); }).catch(e => { if (!c.signal.aborted) setError(`最新核对失败：${e.message}。已有快照以采集时间为准。`); }).finally(() => { if (!c.signal.aborted) setBusy(false); }); return () => c.abort(); }, [taskId, version, refresh]);
  return <section className="ads-card" aria-label="Meta 计划与真实资源核对"><Space wrap><h3>Meta 计划与真实资源核对</h3><Button loading={busy} onClick={() => setRefresh(v => v + 1)}>只读核对现有资源</Button><Button onClick={onData}>查看此计划投放数据</Button><Button onClick={onCreatives}>查看此计划素材</Button></Space><p className="ads-muted">仅查询，不重建。系列花费限额不是生命周期预算；日预算不是账户余额或严格当日扣费上限。结果缓存最多 60 秒，审核与配置暂停分开显示。</p>
    {error && <Alert type="error" title={error} showIcon/>}{data?.pendingCount ? <Alert type="warning" title={`${data.pendingCount} 条操作待核对，禁止重复创建。`}/> : null}{data?.truncated && <Alert type="warning" title="仅展示前 20 条回执，不是完整总账。"/>}{data && !data.entries.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无完整 Meta 创建回执，请核对原记录；不能据此重复创建。"/>}
    {data?.entries.map(e => <div key={e.executionId} style={{ minWidth: 0, overflowWrap: 'anywhere' }}><Space wrap><Tag>{e.checks.some(c => c.status === 'mismatch') ? '发现不一致' : '已读回现有资源'}</Tag><span>采集：{new Date(data.checkedAt).toLocaleString('zh-CN')}</span></Space><Descriptions size="small" column={1} items={[
      ['Meta 账户', `${e.accountName} · ${e.accountId} · ${e.currency} · ${e.timezone || '时区未返回'}`], ['主页 / 视频', `${e.pageId} / ${e.videoId}`], ['目标 / 优化 / 目的地 / 计费', `${e.objective} / ${e.optimizationGoal} / ${e.destinationType} / ${e.billingEvent}`], ['Meta 预算', `系列花费限额 ${e.currency} ${e.spendCap ?? '未返回'} · 广告组日预算 ${e.currency} ${e.dailyBudget ?? '未返回'}`], ['地域 / 平台版位', `${e.countries.join(', ')} / ${e.platforms.join(', ')}`], ['Meta 原始人群与版位', e.targeting ? JSON.stringify(e.targeting) : '旧报告未返回'], ['Meta 排期', `${e.startsAt || '未返回'} — ${e.endsAt || '未设结束时间'}`], ['配置 / 审核状态', `Campaign ${e.campaignStatus} · Ad Set ${e.adsetStatus} · Ad ${e.adStatus}；广告有效状态 ${e.adEffectiveStatus}`], ['回执 / 四层 ID', `${e.executionId} / ${e.campaignId} / ${e.adsetId} / ${e.creativeId} / ${e.adId}`], ['素材映射', `${e.bindingId || '未关联'} · ${e.mapping === 'creation_binding' ? '创建时绑定' : e.mapping === 'post_execution' ? '投放后核对映射（未改原回执）' : '未映射'} · ${e.sha256 || '无文件指纹'}`], ['实际网站 CTA', e.destinationType === 'ON_VIDEO' ? '视频内观看，不使用网站 CTA' : e.linkUrl || '未返回'],
    ].map(([label, children]) => ({ key: label, label, children }))}/>{e.issues?.map(i => <Alert key={i.code} type="warning" showIcon title={`Meta 广告问题 ${i.code}：${i.message}`}/>)}<Table size="small" rowKey="name" pagination={false} dataSource={e.checks} columns={[{ title: '核对项', dataIndex: 'name', width: 180 }, { title: '结果', dataIndex: 'status', width: 100, render: s => s === 'pass' ? '一致' : s === 'warning' ? '待确认' : '不一致' }, { title: '依据', dataIndex: 'detail' }]}/></div>)}
  </section>;
}
