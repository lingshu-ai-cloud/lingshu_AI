import { ArrowUpRight, MessageSquareText } from 'lucide-react';
import LsIllustratedEmpty from '../ui/LsIllustratedEmpty';

export type FunnelStage = { label: string; value: number | null };

export default function BusinessCustomerFunnel({ stages, onStageClick }: {
  stages: FunnelStage[];
  onStageClick: (stage: FunnelStage, index: number) => void;
}) {
  const available = stages.some(stage => stage.value !== null);
  const maximum = Math.max(...stages.map(stage => stage.value || 0), 1);
  return <section className="rounded-xl border border-border p-4 sm:p-5" aria-label="客户承接漏斗">
    <h3 className="text-sm font-semibold text-text-primary">客户承接漏斗</h3>
    {available ? <>
      <ol className="mt-5 space-y-2" aria-label="客户承接阶段人数">
        {stages.map((stage, index) => {
          const ratio = stage.value === null ? 0 : stage.value / maximum;
          const width = `${Math.max(30, ratio * 100)}%`;
          return <li key={stage.label} className="group">
            <button type="button" aria-label={`查看${stage.label}详情，${stage.value === null ? '暂无数据' : `${stage.value} 位客户`}`} aria-haspopup="dialog" onClick={() => onStageClick(stage, index)} className="w-full rounded-lg px-1 py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent">
              <span className="mb-1 flex items-center justify-between gap-2 text-xs"><span className="font-medium text-text-primary">{stage.label}</span><span className="flex items-center gap-1 tabular-nums text-text-secondary">{stage.value === null ? '—' : `${stage.value} 位`}<ArrowUpRight size={13} className="text-text-muted group-hover:text-accent" aria-hidden="true"/></span></span>
              <span className="mx-auto block h-9 rounded-sm bg-accent/85 transition-colors group-hover:bg-accent" style={{ width, clipPath: 'polygon(0 0, 100% 0, 96% 100%, 4% 100%)' }} aria-hidden="true"/>
            </button>
          </li>;
        })}
      </ol>
      <table className="sr-only"><caption>客户承接漏斗完整数值</caption><thead><tr><th scope="col">阶段</th><th scope="col">客户数</th></tr></thead><tbody>{stages.map(stage => <tr key={stage.label}><th scope="row">{stage.label}</th><td>{stage.value === null ? '暂无数据' : `${stage.value} 位`}</td></tr>)}</tbody></table>
    </> : <div className="mt-5"><LsIllustratedEmpty icon={MessageSquareText} title="客户数据待读取" detail="客服侧有客户进线与跟进回执后，展示五个承接环节。"/></div>}
  </section>;
}
