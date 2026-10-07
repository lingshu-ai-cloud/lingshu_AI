import type { PublishingTarget } from "../lib/digitalEmployees";
import { SocialPlatformIcon } from "./SocialPlatformIcon";

const platformLabel: Record<PublishingTarget["platform"], string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
};

export type SmartOperationsAccount = PublishingTarget & {
  connected?: boolean;
};

export default function SmartOperationsAccountRail({
  targets,
  selectedAccountId,
  taskCounts,
  onSelect,
  onManage,
}: {
  targets: SmartOperationsAccount[];
  selectedAccountId: string;
  taskCounts: Record<string, number>;
  onSelect: (accountId: string) => void;
  onManage: () => void;
}) {
  const selected = targets.find(target => target.accountId === selectedAccountId);
  return <>
    <section aria-label="智能经营账号筛选" className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:hidden">
      <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[.14em] text-slate-400">当前账号</p><p className="mt-1 text-sm font-black text-slate-950">{selected ? selected.accountLabel : "全部经营账号"}</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black text-slate-600">{selected ? taskCounts[selected.accountId] || 0 : Object.values(taskCounts).reduce((sum, count) => sum + count, 0)} 条</span></div>
      <div className="mt-3 flex gap-2"><select aria-label="切换经营账号" value={selectedAccountId} onChange={event => onSelect(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700"><option value="">全部账号</option>{targets.map(account=><option key={account.accountId} value={account.accountId}>{platformLabel[account.platform]} · {account.accountLabel} · {taskCounts[account.accountId] || 0} 条</option>)}</select><button type="button" onClick={onManage} className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[10px] font-black text-slate-700">管理</button></div>
    </section>
    <aside aria-label="智能经营账号列表" className="hidden h-fit rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:sticky lg:top-5 lg:block">
    <div className="flex items-center justify-between gap-3 px-2 py-2"><div><p className="text-[10px] font-black uppercase tracking-[.14em] text-slate-400">账号</p><h2 className="mt-1 text-sm font-black text-slate-950">全部经营账号</h2></div><span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black text-slate-600">{targets.length}</span></div>
    <button type="button" aria-pressed={!selectedAccountId} onClick={() => onSelect("")} className={`mt-2 flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs font-black ${!selectedAccountId ? "bg-[#173d31] text-white" : "text-slate-700 hover:bg-slate-50"}`}><span>全部账号</span><span className={selectedAccountId ? "text-slate-400" : "text-emerald-200"}>{Object.values(taskCounts).reduce((sum, count) => sum + count, 0)}</span></button>
    <div className="mt-2 space-y-1">{targets.map(account => <button key={account.accountId} type="button" aria-pressed={selectedAccountId === account.accountId} onClick={() => onSelect(account.accountId)} className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left ${selectedAccountId === account.accountId ? "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200" : "text-slate-600 hover:bg-slate-50"}`}><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-slate-100"><SocialPlatformIcon platform={account.platform} size={15}/></span><span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-black">{account.accountLabel}</span><span className={`mt-0.5 block text-[9px] font-bold ${account.connected === false ? "text-amber-600" : "text-slate-400"}`}>{platformLabel[account.platform]} · {account.connected === false ? "待连接" : "已连接"}</span></span><span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black ${selectedAccountId === account.accountId ? "bg-white text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{taskCounts[account.accountId] || 0}</span></button>)}{!targets.length&&<p className="rounded-xl border border-dashed border-slate-200 px-3 py-5 text-center text-[10px] text-slate-400">还没有纳入经营计划的账号</p>}</div>
    <button type="button" onClick={onManage} className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[10px] font-black text-slate-700 hover:border-emerald-200 hover:text-emerald-700">管理账号连接 →</button>
    </aside>
  </>;
}
