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
  return <section aria-label="智能经营账号列表" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 px-1">
      <div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-[.14em] text-slate-400">账号筛选</p><p className="mt-0.5 truncate text-sm font-black text-slate-950">{selected ? selected.accountLabel : `全部经营账号 · ${targets.length} 个`}</p></div>
      <button type="button" onClick={onManage} className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black text-slate-700 hover:border-zinc-300 hover:text-zinc-900">管理账号连接 →</button>
    </div>
    <div className="mt-3 flex min-w-0 gap-2 overflow-x-auto pb-1">
      <button type="button" aria-pressed={!selectedAccountId} onClick={() => onSelect("")} className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-black ${!selectedAccountId ? "bg-zinc-100 text-zinc-900 ring-1 ring-zinc-200" : "border border-slate-200 text-slate-700 hover:bg-slate-50"}`}><span>全部账号</span><span className={selectedAccountId ? "text-zinc-500" : "text-zinc-600"}>{targets.length} 个</span></button>
      {targets.map(account => <button key={account.accountId} type="button" aria-pressed={selectedAccountId === account.accountId} onClick={() => onSelect(account.accountId)} className={`flex min-w-[205px] shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left ${selectedAccountId === account.accountId ? "bg-zinc-100 text-zinc-900 ring-1 ring-zinc-200" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-slate-100"><SocialPlatformIcon platform={account.platform} size={15}/></span><span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-black">{account.accountLabel}</span><span className={`mt-0.5 block text-[9px] font-bold ${account.connected === false ? "text-amber-600" : "text-slate-400"}`}>{platformLabel[account.platform]} · {account.connected === false ? "待连接" : "已连接"}</span></span><span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black ${selectedAccountId === account.accountId ? "bg-white text-zinc-700" : "bg-slate-100 text-slate-500"}`}>{taskCounts[account.accountId] || 0} 版</span></button>)}
      {!targets.length&&<p className="w-full rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-[10px] text-slate-400">还没有纳入经营计划的账号</p>}
    </div>
  </section>;
}
