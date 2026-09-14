import { ArrowRight, Bot, Home } from 'lucide-react';
import type { Page } from '../../App';

type WorkflowContext = {
  agent: '灵小枢' | '灵小图' | '灵小量' | '灵小售';
  stage: string;
  flow: [string, string, string];
};

const PAGE_WORKFLOW_CONTEXT: Partial<Record<Page, WorkflowContext>> = {
  agentMonitor: { agent: '灵小枢', stage: '运行监控', flow: ['统筹经营任务', '协调四个 Agent', '查看运行与消耗'] },
  strategy: { agent: '灵小枢', stage: '经营分析', flow: ['理解经营目标', '拆解执行计划', '回到工作台确认'] },
  socialInspiration: { agent: '灵小图', stage: '灵感与选题', flow: ['灵小枢派发目标', '灵小图检索与筛选', '在灵感中心查看'] },
  scriptLibrary: { agent: '灵小图', stage: '脚本沉淀', flow: ['选题形成', '灵小图生成脚本', '在脚本库复用'] },
  smartAssets: { agent: '灵小图', stage: '内容生产', flow: ['选题与脚本确认', '灵小图制作内容', '在内容创作查看'] },
  traffic: { agent: '灵小量', stage: '投流与发布', flow: ['内容通过审批', '灵小量生成发布任务', '在本页查看进度'] },
  accountManagement: { agent: '灵小量', stage: '渠道准备', flow: ['灵小枢确定渠道', '灵小量读取账号状态', '在账号管理核对'] },
  conversion: { agent: '灵小售', stage: '询盘与报价', flow: ['接收客户询盘', '灵小售按规则报价', '在会话中查看'] },
  orders: { agent: '灵小售', stage: '成交跟进', flow: ['报价获得确认', '灵小售整理成交信息', '在订单管理跟进'] },
  enterprise: { agent: '灵小枢', stage: '企业知识', flow: ['沉淀企业资料', '四个 Agent 受控读取', '在知识库维护'] },
  agentMemory: { agent: '灵小枢', stage: '工作记忆', flow: ['汇总可靠事实', '按权限提供上下文', '在记忆页核对'] },
  scheduled: { agent: '灵小枢', stage: '周期任务', flow: ['设定经营节奏', '到期自动派发', '在定时任务查看'] },
  plugins: { agent: '灵小枢', stage: '能力接入', flow: ['连接外部能力', '按权限提供给 Agent', '在集成中心管理'] },
  organizationPermissions: { agent: '灵小枢', stage: '组织权限', flow: ['设置成员角色', '约束页面与数据范围', '在权限页管理'] },
  channels: { agent: '灵小量', stage: '渠道接入', flow: ['选择发布渠道', '校验连接状态', '在集成页管理'] },
  youtube: { agent: '灵小量', stage: 'YouTube 渠道', flow: ['准备发布内容', '校验渠道连接', '在集成页管理'] },
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
    <section aria-label="当前页面与 AI 工作流的关系" className="shrink-0 border-b border-emerald-100 bg-[#f3f8f4] px-4 py-2.5 sm:px-6">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex shrink-0 items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white"><Bot size={15} aria-hidden="true" /></span>
          <div>
            <p className="text-[10px] font-semibold text-text-muted">当前协作</p>
            <p className="text-xs font-bold text-text-primary">{context.agent} · {context.stage}</p>
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
          <Home size={12} aria-hidden="true" />回到灵小枢
        </button>
        <p data-starter-ai-managed-notice className="w-full text-[10px] leading-relaxed text-text-muted">
          你可以在这里查看进度、调整内容，并将结果保存到当前任务。
        </p>
      </div>
    </section>
  );
}
