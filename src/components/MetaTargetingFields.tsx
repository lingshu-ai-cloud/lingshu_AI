import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, InputNumber, Select, Space } from 'antd';
import { emptyMetaTargeting, metaVideoPositions, type MetaTargeting, type MetaTargetOption } from '../../shared/metaTargeting';
import { platformAdsRequest } from '../lib/platformAds';

type Result = { source: 'meta_graph'; items: MetaTargetOption[]; hasMore: boolean; after: string | null; apiVersion: string; fetchedAt: string; accountId: string };
function PlatformOptions({ connectionId, kind, label, value, onChange }: { connectionId?: string; kind: 'interest' | 'locale' | 'audience'; label: string; value: MetaTargetOption[]; onChange: (v: MetaTargetOption[]) => void }) {
  const [query, setQuery] = useState(''), [request, setRequest] = useState<{ q: string; after?: string; run: number } | null>(null);
  const [snapshot, setSnapshot] = useState<{ scope: string; data: Result } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const scope = `${connectionId || ''}:${request?.q || ''}`;
  const data = snapshot?.scope === scope ? snapshot.data : null;
  useEffect(() => {
    if (!connectionId || !request) { setBusy(false); return; }
    const c = new AbortController(); setBusy(true); setError('');
    const params = new URLSearchParams({ kind, q: request.q, ...(request.after ? { after: request.after } : {}) });
    platformAdsRequest<Result>(`/connections/${encodeURIComponent(connectionId)}/meta-targeting-options?${params}`, { signal: c.signal })
      .then(result => { if (!c.signal.aborted) setSnapshot(old => ({ scope, data: { ...result, items: request.after && old?.scope === scope ? [...new Map([...old.data.items, ...result.items].map(o => [o.id, o])).values()] : result.items } })); })
      .catch(e => { if (!c.signal.aborted) setError(e instanceof Error ? e.message : '平台选项读取失败'); }).finally(() => { if (!c.signal.aborted) setBusy(false); });
    return () => c.abort();
  }, [connectionId, kind, request]);
  const options = [...new Map([...value, ...(data?.items || [])].map(o => [o.id, o])).values()];
  return <div className="ads-targeting-option"><label>{label}</label>
    {kind !== 'audience' ? <Input.Search aria-label={`搜索${label}`} placeholder="输入至少两个字符，再搜索 Meta" value={query} onChange={e => setQuery(e.target.value)} disabled={!connectionId || busy} loading={busy} onSearch={() => { if (query.trim().length >= 2) setRequest({ q: query.trim(), run: Date.now() }); }}/>
      : <Button disabled={!connectionId} loading={busy} onClick={() => setRequest({ q: '', run: Date.now() })}>读取账户自定义受众</Button>}
    <Select aria-label={`选择${label}`} mode="multiple" allowClear maxTagCount="responsive" disabled={!connectionId} value={value.map(o => o.id)} placeholder="不限制；可从平台查询结果中选择" options={options.map(o => ({ value: o.id, label: o.name }))} onChange={ids => onChange(ids.flatMap(id => options.find(o => o.id === id) || []))} />
    {error && <Alert type="error" showIcon title={error}/>}
    {data && <small>Meta {data.apiVersion} · {new Date(data.fetchedAt).toLocaleString('zh-CN')} · 本次已读取 {data.items.length} 项{data.hasMore ? '，还有下一页' : ''}</small>}
    {data?.hasMore && <Button loading={busy} onClick={() => setRequest(old => ({ q: old?.q || '', after: data.after || undefined, run: Date.now() }))}>加载更多{label}</Button>}
  </div>;
}
export default function MetaTargetingFields({ value, connectionId, channels, onChange }: { value?: MetaTargeting; connectionId?: string; channels: string[]; onChange: (v: MetaTargeting) => void }) {
  const config = value || emptyMetaTargeting;
  const priorAccount = useRef(connectionId);
  useEffect(() => {
    if (priorAccount.current !== connectionId) { priorAccount.current = connectionId; if (config.customAudiences.length) onChange({ ...config, customAudiences: [] }); }
  }, [connectionId]);
  const change = (patch: Partial<MetaTargeting>) => onChange({ ...config, ...patch });
  return <section className="ads-targeting-fields" aria-label="Meta 人群与版位设置">
    <h3>人群与版位</h3><p>国家沿用上一步选择。这里的配置会保存到计划并传给 Meta；最终可投放性由平台校验。</p>
    {!connectionId && <Alert type="info" showIcon title="先关联广告账户，才能查询平台语言、兴趣和自定义受众。"/>}
    <div className="ads-targeting-grid"><div><label>年龄范围（最高 65 表示 65+）</label><Space wrap><InputNumber aria-label="最低年龄" min={18} max={65} value={config.ageMin} onChange={v => { if (v !== null) change({ ageMin: v }); }}/><span>至</span><InputNumber aria-label="最高年龄" min={18} max={65} value={config.ageMax} onChange={v => { if (v !== null) change({ ageMax: v }); }}/></Space></div>
      <div><label>性别</label><Select aria-label="人群性别" value={config.gender} options={[{ value: 'all', label: '不限' }, { value: 'male', label: '男性' }, { value: 'female', label: '女性' }]} onChange={gender => change({ gender })}/></div></div>
    <PlatformOptions connectionId={connectionId} kind="locale" label="语言" value={config.locales} onChange={locales => change({ locales })}/>
    <PlatformOptions connectionId={connectionId} kind="interest" label="兴趣" value={config.interests} onChange={interests => change({ interests })}/>
    <small>兴趣之间为“或”；与地区、年龄、语言及已选自定义受众共同构成定向。平台可能因目标或政策限制调整可用性。</small>
    <PlatformOptions connectionId={connectionId} kind="audience" label="自定义受众" value={config.customAudiences} onChange={customAudiences => change({ customAudiences })}/>
    <label>版位方式</label><Select aria-label="版位方式" value={config.placementMode} options={[{ value: 'automatic', label: '所选渠道内自动版位' }, { value: 'manual', label: '手动选择视频版位' }]} onChange={placementMode => change({ placementMode, facebookPositions: [], instagramPositions: [] })}/>
    {config.placementMode === 'manual' && (Object.keys(metaVideoPositions) as Array<keyof typeof metaVideoPositions>).map(platform => {
      const key = platform === 'Facebook' ? 'facebookPositions' : 'instagramPositions';
      return <div key={platform}><label>{platform} 视频位置</label><Select aria-label={`${platform} 手动版位`} mode="multiple" disabled={!channels.includes(platform) && !config[key].length} placeholder={channels.includes(platform) ? '至少选择一个位置' : '请先勾选此投放渠道'} value={config[key]} options={metaVideoPositions[platform]} onChange={positions => change({ [key]: positions })}/></div>;
    })}
    <small>版位来源：官方接口字段规则目录，并非账户实时可投放清单。目前提供动态、快拍与 Reels 视频位置；其他平台版位尚未接入。自动模式保留上方选择的渠道范围。</small>
  </section>;
}
