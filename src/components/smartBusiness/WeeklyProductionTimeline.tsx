import { Tag, Timeline, theme } from 'antd';
import { CheckCircle2, Circle, CircleDot, Clock3, TriangleAlert } from 'lucide-react';
import type { WeeklyContentProgressStage, WeeklyContentProgressStageKey } from '../../lib/weeklyContentProgress';

const stageRoles: Record<WeeklyContentProgressStageKey, string> = {
  benchmark: '编导 Agent', script: '编导 Agent', materials: '内容 Agent',
  voice: '内容 Agent', presenter: '内容 Agent', render: '内容 Agent', quality: '内容 Agent · 质检',
};

/** Visual nodes reflect receipts, never queue percentages or inferred prior steps. */
export default function WeeklyProductionTimeline({ stages }: { stages: readonly WeeklyContentProgressStage[] }) {
  const { token } = theme.useToken();
  return <section aria-label="制作节点" className="space-y-4">
    <div><h3 className="text-base font-semibold text-text-primary">制作节点</h3><p className="mt-1 text-xs text-text-muted">按真实回执更新，已有产物与待处理事项分别保留</p></div>
    <Timeline orientation="vertical" items={stages.map((stage, index) => {
      const completed = stage.status === 'completed';
      const blocked = stage.status === 'blocked';
      const running = stage.status === 'running';
      const waiting = stage.status === 'waiting';
      const color = completed ? token.colorSuccess : blocked ? token.colorError : running ? token.colorPrimary : waiting ? token.colorWarning : token.colorTextTertiary;
      const Icon = completed ? CheckCircle2 : blocked ? TriangleAlert : running ? CircleDot : waiting ? Clock3 : Circle;
      return {
        key: stage.key,
        color,
        icon: <Icon size={18} aria-hidden style={{ color, background: token.colorBgContainer }} />,
        content: <article data-production-stage={stage.key} data-stage-status={stage.status} className="min-w-0 space-y-2" style={{ padding: token.paddingSM, borderRadius: token.borderRadiusLG, background: token.colorFillQuaternary, border: `1px solid ${blocked ? token.colorErrorBorder : running ? token.colorPrimaryBorder : token.colorBorderSecondary}` }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-text-primary">{index + 1}. {stage.label}</h4>
            <Tag color={completed ? 'success' : blocked ? 'error' : running ? 'processing' : waiting ? 'warning' : 'default'}>{stage.statusLabel}</Tag>
          </div>
          <p className="text-xs text-text-muted">执行角色：{stageRoles[stage.key]}</p>
          <p className="break-words text-sm leading-6 text-text-secondary">{stage.detail}</p>
          {stage.evidence.length > 0 && <div className="border-t border-border pt-2 text-xs text-text-muted"><span className="font-medium">回执依据：</span>{stage.evidence.join(' · ')}</div>}
        </article>,
      };
    })} />
  </section>;
}
