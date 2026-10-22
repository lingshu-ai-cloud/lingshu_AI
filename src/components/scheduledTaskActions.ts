import type { AgentType } from '../App';

interface ScheduledTask {
  taskType: string;
}

export interface NextAction {
  label: string;
  agent: AgentType;
  agentLabel: string;
  prompt: string;
}

export function suggestedActions(task: Pick<ScheduledTask, 'taskType'>, output: string): NextAction[] {
  const context = output ? `\n\n定时任务摘要：\n${output}` : '';
  if (task.taskType === 'holiday_push') {
    return [
      {
        label: '整理节日前 7 天主推 SKU 与库存水位',
        agent: 'strategy',
        agentLabel: '首页',
        prompt: `根据节日推品提醒，按市场和节日优先级整理未来 7 天需要主推的 SKU、库存水位、备货风险和负责人动作。${context}`,
      },
      {
        label: '生成社媒预热脚本和短视频内容方向',
        agent: 'traffic',
        agentLabel: '我的社媒',
        prompt: `基于节日推品提醒，生成可直接使用的社媒预热脚本、短视频钩子和多语言内容方向，重点适配企业中心主要市场。${context}`,
      },
      {
        label: '生成私域触达话术并安排近 90 天询盘跟进',
        agent: 'conversion',
        agentLabel: '我的客户',
        prompt: `基于节日推品提醒，设计私域触达话术，并筛选近 90 天相关品类询盘客户，输出跟进优先级和报价/邀约话术。${context}`,
      },
    ];
  }
  if (task.taskType === 'trend_report') {
    return [
      {
        label: '把高频话题转成 3 条 TikTok 脚本方向',
        agent: 'traffic',
        agentLabel: '我的社媒',
        prompt: `把爆款日报中的高频话题转成 3 条 TikTok 脚本方向，包含钩子、镜头结构和口播重点。${context}`,
      },
      {
        label: '挑选 2 个产品卖点做 A/B 内容测试',
        agent: 'traffic',
        agentLabel: '我的社媒',
        prompt: `基于爆款日报，挑选 2 个产品卖点设计 A/B 内容测试方案，输出标题、素材形式和判断指标。${context}`,
      },
      {
        label: '将适配市场和语言写回企业中心学习记录',
        agent: 'strategy',
        agentLabel: '首页',
        prompt: `基于爆款日报，提炼适配市场、主要语言和有效内容角度，整理成可写回企业中心的 Agent 学习记录。${context}`,
      },
    ];
  }
  if (task.taskType === 'video_keyword_crawl') {
    return [
      {
        label: '查看新入库视频并筛选可复用素材',
        agent: 'traffic',
        agentLabel: '我的社媒',
        prompt: `根据视频采集结果，筛选新入库视频里最值得复用的素材方向，并说明筛选标准。${context}`,
      },
      {
        label: '选择高互动视频生成克隆脚本',
        agent: 'traffic',
        agentLabel: '我的社媒',
        prompt: `从视频采集结果中挑选高互动视频方向，生成 3 条去重后的克隆脚本。${context}`,
      },
      {
        label: '复盘失败下载链接并补充关键词',
        agent: 'strategy',
        agentLabel: '首页',
        prompt: `复盘视频采集任务中下载失败或结果不足的问题，补充下一轮关键词和平台采集策略。${context}`,
      },
    ];
  }
  if (task.taskType === 'exchange_rate') {
    return [
      {
        label: '生成多币种询盘报价话术',
        agent: 'conversion',
        agentLabel: '我的客户',
        prompt: `根据汇率日报，生成面向不同市场客户的多币种报价话术，并标注报价有效期。${context}`,
      },
      {
        label: '更新报价风险和利润提醒',
        agent: 'strategy',
        agentLabel: '首页',
        prompt: `根据汇率日报，判断当前报价风险、利润保护线和需要用户确认的报价策略。${context}`,
      },
      {
        label: '整理老客补货报价提醒',
        agent: 'retention',
        agentLabel: '我的客户',
        prompt: `根据汇率日报，为老客补货场景生成报价提醒和复购触达建议。${context}`,
      },
    ];
  }
  if (task.taskType === 'market_intelligence') {
    return [
      {
        label: '按市场拆解报价和选品动作',
        agent: 'strategy',
        agentLabel: '首页',
        prompt: `根据主要市场行业周报，按市场拆解未来 7 天的报价、选品、合规和销售动作，并标注依据来源。${context}`,
      },
      {
        label: '把行业动态转成内容方向',
        agent: 'traffic',
        agentLabel: '我的社媒',
        prompt: `根据主要市场行业周报，把可用事实转成 3 个社媒选题和短视频内容方向，避免把未经证实的信息写成企业卖点。${context}`,
      },
      {
        label: '生成重点客户跟进理由',
        agent: 'conversion',
        agentLabel: '我的客户',
        prompt: `根据主要市场行业周报，生成不同市场客户的跟进理由、询盘问题和报价注意事项。${context}`,
      },
    ];
  }
  if (task.taskType === 'weekly_review') {
    return [
      {
        label: '拆解下周社媒内容任务',
        agent: 'traffic',
        agentLabel: '我的社媒',
        prompt: `根据每周经营复盘，拆解下周社媒内容任务，输出选题、脚本方向和优先级。${context}`,
      },
      {
        label: '生成询盘转化跟进动作',
        agent: 'conversion',
        agentLabel: '我的客户',
        prompt: `根据每周经营复盘，生成询盘转化跟进动作、报价优化点和高意向客户处理顺序。${context}`,
      },
      {
        label: '生成老客复购唤醒动作',
        agent: 'retention',
        agentLabel: '我的客户',
        prompt: `根据每周经营复盘，生成老客复购唤醒任务、客户分层和触达节奏。${context}`,
      },
    ];
  }
  if (task.taskType === 'crm_wakeup') {
    return [
      {
        label: '生成老客唤醒分层和触达节奏',
        agent: 'retention',
        agentLabel: '我的客户',
        prompt: `根据沉默客户唤醒任务，生成客户分层、触达节奏和复购推荐逻辑。${context}`,
      },
      {
        label: '生成 WhatsApp 跟进话术',
        agent: 'conversion',
        agentLabel: '我的客户',
        prompt: `根据沉默客户唤醒任务，生成可直接发送的 WhatsApp 跟进话术，并区分高意向/普通老客。${context}`,
      },
      {
        label: '生成复购内容素材方向',
        agent: 'traffic',
        agentLabel: '我的社媒',
        prompt: `根据沉默客户唤醒任务，生成适合老客复购的内容素材方向和短视频脚本钩子。${context}`,
      },
    ];
  }
  return [
    {
      label: '交给首页拆解后续任务',
      agent: 'strategy',
      agentLabel: '首页',
      prompt: `请根据这次定时任务结果，拆解可执行的后续 Agent 任务。${context}`,
    },
  ];
}
