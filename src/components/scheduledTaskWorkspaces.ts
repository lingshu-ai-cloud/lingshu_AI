interface ScheduledTask {
  taskType: string;
  cronLabel: string;
  enabled: boolean;
  config: Record<string, string>;
}

export function taskWorkspace(task: ScheduledTask) {
  switch (task.taskType) {
    case 'video_keyword_crawl':
      return {
        title: '视频采集工作台',
        cards: [
          { label: '采集平台', value: task.config.platforms || 'youtube', desc: '按平台拉取关键词视频' },
          { label: '发现范围', value: task.config.keywordEvidence || task.config.keywords || task.config.keyword || '根据企业产品、市场和场景自动生成', desc: '关键词只是发现范围的执行投影' },
          { label: '时间窗口', value: `${task.config.dateWindowDays || '7'} 天`, desc: '只采集近期内容' },
        ],
        actions: ['刷新采集看板', '查看排队状态', '生成脚本方向'],
      };
    case 'trend_report':
      return {
        title: '爆款日报工作台',
        cards: [
          { label: '报告范围', value: 'TikTok', desc: '聚合热门品类、话题和内容角度' },
          { label: '输出频率', value: task.cronLabel, desc: '定时更新趋势简报' },
          { label: '后续动作', value: '内容矩阵', desc: '转成选题、脚本和投放建议' },
        ],
        actions: ['提炼 3 条脚本', '生成话题标签', '写回企业学习记录'],
      };
    case 'holiday_push':
      return {
        title: '节日推品工作台',
        cards: [
          { label: '提醒窗口', value: '节前 7 天', desc: '提前规划备货和触达' },
          { label: '推品对象', value: '重点 SKU', desc: '结合库存、季节和历史询盘' },
          { label: '触达方式', value: '社媒/私域', desc: '生成预热内容和跟进话术' },
        ],
        actions: ['生成节日推品清单', '生成预热脚本', '生成客户触达话术'],
      };
    case 'exchange_rate':
      return {
        title: '汇率报价工作台',
        cards: [
          { label: '基础币种', value: 'USD', desc: '统一用于报价换算' },
          { label: '覆盖币种', value: '按主要市场', desc: '由企业中心目标市场自动匹配' },
          { label: '报价规则', value: '人工确认', desc: '结合价格区间、MOQ 和毛利线' },
        ],
        actions: ['生成多币种报价', '复制汇率摘要', '生成询盘报价话术'],
      };
    case 'market_intelligence':
      return {
        title: '主要市场行业情报工作台',
        cards: [
          { label: '内部依据', value: '企业中心', desc: '行业、产品、主要市场与报价规则' },
          { label: '外部依据', value: '公开检索', desc: '需求、合规、渠道和竞争动态' },
          { label: '更新周期', value: '每周', desc: '保留来源并生成行动建议' },
        ],
        actions: ['查看公开来源', '拆解市场动作', '生成客户跟进理由'],
      };
    case 'weekly_review':
      return {
        title: '经营复盘工作台',
        cards: [
          { label: '复盘维度', value: '流量/询盘/转化', desc: '聚合关键经营指标' },
          { label: '输出周期', value: '每周', desc: '形成固定经营节奏' },
          { label: '行动沉淀', value: '下周任务', desc: '把复盘转为可执行动作' },
        ],
        actions: ['生成老板版摘要', '生成运营任务清单', '拆给各 Agent 执行'],
      };
    case 'crm_wakeup':
      return {
        title: '老客唤醒工作台',
        cards: [
          { label: '客户范围', value: '60 天沉默', desc: '筛选未复购或未回复客户' },
          { label: '触达渠道', value: 'WhatsApp', desc: '生成轻量跟进话术' },
          { label: '推荐依据', value: '历史采购', desc: '按客户偏好匹配新品' },
        ],
        actions: ['生成唤醒文案', '生成推品理由', '标记高潜客户'],
      };
    default:
      return {
        title: '任务工作台',
        cards: [
          { label: '任务类型', value: task.taskType, desc: '当前自动化任务' },
          { label: '执行频率', value: task.cronLabel, desc: '按计划自动运行' },
          { label: '状态', value: task.enabled ? '已启用' : '已停用', desc: '可随时调整' },
        ],
        actions: ['查看结果', '复制产出', '安排下一步'],
      };
  }
}
