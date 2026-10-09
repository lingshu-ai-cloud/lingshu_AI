import { useEffect, useRef, useState } from 'react';
import type { SocialWeeklyPublicationTask, WeeklyOperatingPackage } from '../../../shared/contracts/socialProgram';
import { publicationReceptionApi, type ReceptionEmployee, type ReceptionEnterpriseFacts } from '../../lib/publicationReceptionApi';

type Configuration = { ownerId: string; kind: 'messaging' | 'url'; channel: 'whatsapp' | 'messenger' | 'instagram'; mode: 'human' | 'draft' | 'automatic'; url: string; documents: string[]; needsDocuments: boolean };
const initial = (): Configuration => ({ ownerId: '', kind: 'messaging', channel: 'whatsapp', mode: 'human', url: '', documents: [], needsDocuments: false });
export interface PublicationReceptionSetupProps {
  pkg: WeeklyOperatingPackage;
  onCreateRevision(publicationTasks: SocialWeeklyPublicationTask[]): Promise<void>;
}
/** Saves explicit next-version bindings, then delegates the immutable package revision to the parent. */
export default function PublicationReceptionSetup({ pkg, onCreateRevision }: PublicationReceptionSetupProps) {
  const [facts, setFacts] = useState<ReceptionEnterpriseFacts | null>(null);
  const [employees, setEmployees] = useState<ReceptionEmployee[]>([]);
  const [configurations, setConfigurations] = useState<Record<string, Configuration>>({});
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const identity = `${pkg.programId}:${pkg.packageId}:${pkg.version}`;
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  const [loadedIdentity, setLoadedIdentity] = useState('');
  const isLoading = loading || loadedIdentity !== identity;
  const publications = pkg.socialContentPackage.publicationTasks.filter(item => !['published', 'cancelled'].includes(item.status));
  useEffect(() => {
    let disposed = false; setLoading(true); setSaving(false); setLoadedIdentity(''); setFacts(null); setEmployees([]); setConfigurations({}); setError('');
    Promise.all([publicationReceptionApi.facts(), publicationReceptionApi.employees()]).then(([nextFacts, people]) => {
      if (disposed) return; setFacts(nextFacts); setEmployees(people); setLoadedIdentity(identity); if (!people.length) setError('企业还没有可用接待人员，请先配置企业成员。');
    }).catch(cause => { if (!disposed) setError(cause instanceof Error ? cause.message : '承接资料加载失败。'); }).finally(() => { if (!disposed) { setLoadedIdentity(identity); setLoading(false); } });
    return () => { disposed = true; };
  }, [pkg.programId, pkg.packageId, pkg.version, reload]);
  const documents = (facts?.profile.products?.items ?? []).flatMap(product => (product.documents ?? []).filter(document => document.url).map(document => ({ url: document.url!, label: `${product.name} · ${document.name}` })));
  function update(id: string, patch: Partial<Configuration>) { setConfigurations(previous => ({ ...previous, [id]: { ...(previous[id] ?? initial()), ...patch } })); }
  async function save() {
    if (isLoading || !facts || !employees.length || !publications.length) return;
    const savingIdentity = identity;
    setError('');
    for (const item of publications) {
      const config = configurations[item.publicationTaskId];
      if (!item.cta?.trim() || !config?.ownerId || !employees.some(person => person.id === config.ownerId)) { setError('每条待发布视频都需要明确 CTA 和真实接待人。'); return; }
      if (config.needsDocuments && !config.documents.length) { setError('此 CTA 必须提供资料，请先补充并选择目录、规格表等真实资料。'); return; }
      if (config.kind === 'url') {
        try { const url = new URL(config.url); if (url.protocol !== 'https:' || url.username || url.password) throw Error(); } catch { setError('请为对应视频填写无账号密码的 HTTPS 承接入口。'); return; }
      }
    }
    setSaving(true);
    try {
      const saved = await Promise.all(publications.map(async item => {
        const config = configurations[item.publicationTaskId];
        const result = await publicationReceptionApi.save({ programId: pkg.programId, packageId: pkg.packageId, packageVersion: pkg.version + 1, publicationId: item.publicationTaskId, cta: item.cta!, enterpriseFactHash: facts.version.contentHash,
          targets: [{ id: 'primary-cta', required: true, ownerId: config.ownerId, destination: config.kind === 'url' ? { kind: 'url', url: config.url } : { kind: 'messaging', channel: config.channel, receptionMode: config.mode }, requiredDocumentUrls: config.documents }] });
        return [item.publicationTaskId, result.bindingId] as const;
      }));
      const bindings = new Map(saved);
      if (currentIdentity.current !== savingIdentity) return;
      await onCreateRevision(pkg.socialContentPackage.publicationTasks.map(item => bindings.has(item.publicationTaskId) ? { ...item, receptionRequirement: { required: true, bindingId: bindings.get(item.publicationTaskId)! } } : item));
    } catch (cause) { if (currentIdentity.current === savingIdentity) setError(cause instanceof Error ? cause.message : '承接配置保存失败，周包尚未完成修订。'); }
    finally { if (currentIdentity.current === savingIdentity) setSaving(false); }
  }
  return <section className="rounded-2xl border border-stone-200 bg-white p-5 space-y-4">
    <div><h3 className="font-semibold text-stone-900">发布承接配置</h3><p className="text-sm text-stone-500">当前周包 v{pkg.version}，保存后创建 v{pkg.version + 1}。发布前经营 Agent 会重新检查入口、资料和接待人。</p></div>
    {isLoading ? <p className="text-sm text-stone-500">正在读取企业确认资料和接待人员…</p> : facts && <p className="text-xs text-stone-500">企业确认资料 v{facts.version.revision} · {facts.version.contentHash.slice(0, 12)}，来源：企业知识库</p>}
    {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error} <button onClick={() => setReload(value => value + 1)} disabled={saving} className="underline">重新加载</button></div>}
    {!isLoading && !publications.length && <p className="text-sm text-stone-500">当前没有需要配置承接的待发布视频。</p>}
    {!isLoading && facts && employees.length > 0 && publications.map(item => {
      const config = configurations[item.publicationTaskId] ?? initial();
      return <fieldset key={item.publicationTaskId} disabled={saving} className="rounded-xl border border-stone-200 p-4 space-y-3">
        <legend className="px-1 text-sm font-medium">{item.platform} · {item.publishWindow ?? '待确认发布时间'}</legend>
        <p className="text-sm">CTA：{item.cta || '缺少 CTA，请先修订内容任务'}</p>
        <label className="block text-sm">接待负责人<select aria-label={`接待负责人 ${item.publicationTaskId}`} value={config.ownerId} onChange={event => update(item.publicationTaskId, { ownerId: event.target.value })} className="ml-2 rounded border p-2"><option value="">请选择企业成员</option>{employees.map(person => <option key={person.id} value={person.id}>{person.name || person.email}</option>)}</select></label>
        <label className="block text-sm">承接入口<select value={config.kind} onChange={event => update(item.publicationTaskId, { kind: event.target.value as Configuration['kind'] })} className="ml-2 rounded border p-2"><option value="messaging">客服渠道</option><option value="url">页面或资料入口</option></select></label>
        {config.kind === 'url' ? <input aria-label={`HTTPS 承接入口 ${item.publicationTaskId}`} type="url" placeholder="https://…" value={config.url} onChange={event => update(item.publicationTaskId, { url: event.target.value })} className="w-full rounded border p-2 text-sm" /> : <div className="flex flex-wrap gap-2"><select aria-label={`客服渠道 ${item.publicationTaskId}`} value={config.channel} onChange={event => update(item.publicationTaskId, { channel: event.target.value as Configuration['channel'] })} className="rounded border p-2 text-sm"><option value="whatsapp">WhatsApp</option><option value="messenger">Messenger</option><option value="instagram">Instagram</option></select><select aria-label={`接待方式 ${item.publicationTaskId}`} value={config.mode} onChange={event => update(item.publicationTaskId, { mode: event.target.value as Configuration['mode'] })} className="rounded border p-2 text-sm"><option value="human">人工接待</option><option value="draft">客服生成草稿，人工发送</option><option value="automatic">已授权自动回复</option></select></div>}
        <div className="text-sm"><p className="mb-1">此 CTA 必须提供的企业资料</p><label className="block mb-2"><input type="checkbox" checked={config.needsDocuments} onChange={event => update(item.publicationTaskId, { needsDocuments: event.target.checked })} /> 此 CTA 承诺提供目录、规格表等资料</label>{documents.length ? documents.map((document, index) => <label key={`${document.url}:${index}`} className="block"><input type="checkbox" checked={config.documents.includes(document.url)} onChange={event => update(item.publicationTaskId, { documents: event.target.checked ? [...new Set([...config.documents, document.url])] : config.documents.filter(url => url !== document.url) })} /> {document.label}</label>) : <p className="text-amber-700">知识库尚无带入口的产品资料；CTA 如承诺目录或规格表，请先补充资料后再配置。</p>}</div>
      </fieldset>;
    })}
    <button disabled={isLoading || saving || !facts || !employees.length || !publications.length} onClick={save} className="rounded-lg bg-emerald-900 px-4 py-2 text-sm text-white disabled:opacity-40">{saving ? '正在保存并修订排期…' : `保存承接配置并创建 v${pkg.version + 1}`}</button>
  </section>;
}
