import { statusLabel, statusTone } from './presentation';

export function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusTone[status] || 'border-slate-200 bg-white text-slate-600'}`}>
    {statusLabel[status] || status}
  </span>;
}
