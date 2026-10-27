import { ArrowUpRight } from 'lucide-react';
export type FunnelStage = { label: string; value: number | null };
export default function BusinessCustomerFunnel({ stages, description, onStageClick }: {
  stages: FunnelStage[];
  description: string;
  onStageClick: (stage: FunnelStage, index: number) => void;
}) {
  return <section className="business-customer-funnel" aria-label="客户承接漏斗">
    <h3 className="text-sm font-semibold text-text-primary">推广转化漏斗</h3>
    <p className="mt-1 text-xs leading-5 text-text-secondary">{description}</p>
    <ol className="business-funnel-stages" aria-label="推广转化环节">
      {stages.map((stage, index) => <li key={stage.label}>
        <button type="button" aria-haspopup="dialog" aria-label={`查看${stage.label}详情，${stage.value === null ? '暂无数据' : `${stage.value} 次`}`} onClick={() => onStageClick(stage, index)} className="business-funnel-stage" style={{ width: `${100 - index * Math.min(12, 48 / Math.max(1, stages.length - 1))}%`, background: `linear-gradient(100deg, rgb(37 99 235 / ${0.22 - index * 0.025}), rgb(99 102 241 / ${0.13 - index * 0.015}))` }}>
          <span>{stage.label}</span><strong>{stage.value === null ? '—' : stage.value.toLocaleString('zh-CN')}<ArrowUpRight size={13} aria-hidden="true"/></strong>
        </button>
      </li>)}
    </ol>
    <p className="mt-3 text-xs leading-5 text-text-muted">色带按环节层级收束，数值以平台回传为准；不同目标事件不强制互为子集，不推算连续转化率。</p>
    <table className="sr-only"><caption>推广转化完整数值</caption><thead><tr><th scope="col">环节</th><th scope="col">次数</th></tr></thead><tbody>{stages.map(stage => <tr key={stage.label}><th scope="row">{stage.label}</th><td>{stage.value === null ? '暂无数据' : `${stage.value} 次`}</td></tr>)}</tbody></table>
  </section>;
}
