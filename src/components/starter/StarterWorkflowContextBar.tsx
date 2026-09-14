import { ArrowRight, BriefcaseBusiness, Home } from 'lucide-react';
import type { Page } from '../../App';
import { PAGE_REGISTRY } from '../../pageRegistry';

type WorkflowContext = {
  flow: [string, string, string];
};

const PAGE_WORKFLOW_CONTEXT: Partial<Record<Page, WorkflowContext>> = {
  agentMonitor: { flow: ['查看运行状态', '定位需要处理的事项', '回到业务页面处理'] },
  strategy: { flow: ['查看经营信号', '确认优先事项', '推进今天的计划'] },
  socialInspiration: { flow: ['明确内容目标', '筛选可用灵感', '进入内容制作'] },
  scriptLibrary: { flow: ['整理选题', '沉淀可用脚本', '复用到内容制作'] },
  smartAssets: { flow: ['确认选题与脚本', '制作并检查内容', '进入发布与数据'] },
  traffic: { flow: ['检查待发布内容', '确认渠道与时间', '查看发布结果'] },
  accountManagement: { flow: ['选择业务渠道', '完成账号连接', '核对连接状态'] },
  conversion: { flow: ['接收客户消息', '确认回复与报价', '跟进处理结果'] },
  orders: { flow: ['确认成交信息', '跟踪履约状态', '查看收入结果'] },
  enterprise: { flow: ['维护企业资料', '确认业务边界', '供各业务页面使用'] },
  agentMemory: { flow: ['汇总可靠事实', '核对可用信息', '按权限提供上下文'] },
  scheduled: { flow: ['设定执行节奏', '到期自动处理', '查看任务结果'] },
  plugins: { flow: ['选择外部能力', '完成授权连接', '核对可用状态'] },
  organizationPermissions: { flow: ['设置成员角色', '限定数据范围', '保存权限配置'] },
  channels: { flow: ['选择发布渠道', '完成授权连接', '核对可用状态'] },
  youtube: { flow: ['准备发布渠道', '完成 YouTube 授权', '核对连接状态'] },
};

export default function StarterWorkflowContextBar({
  page,
  onNavigate,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
}) {
  const context = PAGE_WORKFLOW_CONTEXT[page];
  if (!context) return null;

  return (
    <section aria-label="当前页面与经营流程的关系" className="shrink-0 border-b border-emerald-100 bg-[#f3f8f4] px-4 py-2.5 sm:px-6">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex shrink-0 items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white"><BriefcaseBusiness size={15} aria-hidden="true" /></span>
          <div>
            <p className="text-[10px] font-semibold text-text-muted">当前业务页面</p>
            <p className="text-xs font-bold text-text-primary">{PAGE_REGISTRY[page].canonicalTitle}</p>
          </div>
        </div>
        <div className="flex min-w-[280px] flex-1 items-center gap-1.5 overflow-x-auto text-[11px] font-medium text-text-secondary" aria-label={context.flow.join('，然后')}>
          {context.flow.map((step, index) => (
            <div key={step} className="flex shrink-0 items-center gap-1.5">
              <span className="rounded-md border border-emerald-100 bg-white px-2 py-1">{step}</span>
              {index < context.flow.length - 1 && <ArrowRight size={12} className="text-accent" aria-hidden="true" />}
            </div>
          ))}
        </div>
        <button type="button" onClick={() => onNavigate('digitalEmployees')} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-accent transition hover:bg-emerald-50">
          <Home size={12} aria-hidden="true" />返回智能经营
        </button>
        <p data-starter-ai-managed-notice className="w-full text-[10px] leading-relaxed text-text-muted">
          你可以在这里查看进度、调整内容，并将结果保存到当前任务。
        </p>
      </div>
    </section>
  );
}
