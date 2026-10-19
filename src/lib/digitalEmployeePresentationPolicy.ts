import type { BusinessDestination, DigitalEmployeeWorkflow } from './digitalEmployees';

export const workflowOptions: Array<{
  id: DigitalEmployeeWorkflow;
  label: string;
  detail: string;
  dependency?: string;
}> = [
  { id: 'scheduled_social', label: '定时社媒采集', detail: '关键词、平台与对标账号' },
  { id: 'viral_clone', label: '爆款裂变', detail: '从爆款证据和精确分析进入创作' },
  { id: 'content_publish', label: '内容发布', detail: '审批后进入发布日历', dependency: '依赖社媒视频制作' },
  { id: 'customer_segmentation', label: '客户分层', detail: '生成可审计客群快照' },
  { id: 'batch_followup', label: '批量跟进', detail: '逐客草稿与整批审批', dependency: '依赖客户分层' },
];

export const workflowLabel: Record<DigitalEmployeeWorkflow, string> = {
  ...Object.fromEntries(workflowOptions.map((option) => [option.id, option.label])),
  product_content: '历史：使用产品生成',
  material_content: '历史：使用素材生成',
} as Record<DigitalEmployeeWorkflow, string>;

export const contentCreationWorkflows: DigitalEmployeeWorkflow[] = ['viral_clone'];
const legacyFreeCreationWorkflows: DigitalEmployeeWorkflow[] = ['product_content', 'material_content'];

export function synchronizeThemeContentWorkflows(
  workflows: DigitalEmployeeWorkflow[],
): DigitalEmployeeWorkflow[] {
  const hadLegacyContent = workflows.some((item) => legacyFreeCreationWorkflows.includes(item));
  const cleaned = workflows.filter((item) => !legacyFreeCreationWorkflows.includes(item));
  return hadLegacyContent && !cleaned.includes('viral_clone') ? [...cleaned, 'viral_clone'] : cleaned;
}

export const agentRoleGroups: Array<{
  id: 'orchestrator' | 'business' | 'director' | 'content' | 'customer';
  label: string;
  responsibility: string;
  outputs: string;
  workflows: DigitalEmployeeWorkflow[];
}> = [
  { id: 'orchestrator', label: '灵小枢 · 统筹 Agent', responsibility: '读取企业上下文、拆解本周目标，协调四个专业 Agent 并跟踪任务状态', outputs: '执行上下文、周目标、任务编排与异常提醒', workflows: [] },
  { id: 'business', label: '经营 Agent', responsibility: '负责发布审批、发布日历、平台回执和周度经营复盘', outputs: '发布计划、真实回执、经营结果与复盘报告', workflows: ['content_publish'] },
  { id: 'director', label: '编导 Agent', responsibility: '逐镜分析爆款参考，重点拆解前三秒钩子，锁定可复刻的脚本、口播、字幕、分镜、音乐节奏和验收规则', outputs: '参考视频分析、逐镜复刻脚本、素材映射、替代方案与验收规则', workflows: ['scheduled_social', 'viral_clone'] },
  { id: 'content', label: '内容 Agent', responsibility: '执行已锁定的导演方案，按镜头选择真实素材、数字人、授权素材和生成模型，完成配音、字幕、剪辑、混音、封面和技术质检', outputs: '可播放成片、字幕与音轨、封面、平台版本和质检报告', workflows: [] },
  { id: 'customer', label: '客服 Agent', responsibility: '承接真实询盘、完成客户分层，并按客户上下文生成跟进草稿', outputs: '客户标签、回复草稿、跟进批次、转人工提醒', workflows: ['customer_segmentation', 'batch_followup'] },
];

export const destinationLabel: Record<BusinessDestination, string> = {
  enterprise: '企业资料', accountManagement: '社媒账号', plugins: '集成中心', scheduled: '定时任务',
  socialInspiration: '爆款灵感', scriptLibrary: '话术库', smartAssets: '内容工作台', adsManaged: '广告投放',
  conversion: '客户工作台', digitalEmployees: '数字员工驾驶舱',
};

export const capabilityLabel: Record<string, string> = {
  'enterprise.readiness': '核对企业知识库与授权资产', 'workflow.plan': '拆解并锁定周计划',
  'scheduler.social_collection': '建立社媒采集调度', 'inspiration.exact_analysis': '筛选有完整证据的爆款',
  'studio.mode_routing': '确认创作主题与待拍素材', 'studio.production': '执行脚本、素材与成片生产',
  'studio.quality_gate': '校验内容质量与事实', 'publishing.delivery': '等待平台真实发布回执',
  'customer.segment_snapshot': '冻结可审计客户分层', 'customer.followup_delivery': '按安全规则执行跟进',
  'review.weekly_business': '生成经营复盘与改进草案', 'foundation.context_readiness': '核对企业经营资料',
  'planning.goal_decomposition': '拆解周目标', 'social.collection': '采集社媒内容',
  'social.viral_analysis': '分析爆款证据', 'content.routing': '匹配主题与待拍素材',
  'content.production': '生成内容作品', 'content.quality_gate': '内容质检', 'publishing.approval': '发布审批',
  'publishing.calendar': '发布排期', 'publishing.platform': '平台发布', 'customer.attribution': '客户来源归因',
  'customer.segmentation': '客户分层', 'customer.followup_drafts': '逐客生成跟进草稿',
  'customer.followup_approval': '整批跟进审批', 'customer.followup_dispatch': '按逐客条件发送',
  'review.weekly': '生成本周复盘',
};

export const statusSourceLabel: Record<string, string> = {
  'enterprise/profile + platform accounts': '企业知识库与已授权账号', weekly_plans: '已保存并锁定的周计划',
  'scheduled_tasks + crawl_jobs': '定时任务及其采集运行记录', 'trend_videos.aiAnalysis': '爆款库精确分析记录',
  'weekly_plan.scope': '当期计划锁定的业务范围', 'studio_projects + render jobs': '内容项目与成片任务状态',
  'studio project quality state': '内容项目质量门状态', approval_requests: '服务端审批单',
  'posts.stats.status=scheduled': '发布日历排期记录', 'posts.platform_post_id + publishResults': '平台帖子编号与发布回执',
  'whatsapp_customers.sourcePostId': 'WhatsApp 客户来源归因', 'customer_segments + members': '客户分层快照与成员记录',
  'followup_batches + followup_batch_items': '跟进批次与逐客草稿', 'approval_requests + followup_batches': '审批单与获批跟进批次',
  'followup_batch_items.status + provider receipt': '逐客发送状态与渠道回执',
  'weekly_reviews + business snapshot': '复盘记录与经营业务快照',
};

export const technicalKeyLabel: Record<string, string> = {
  capability: '业务能力', statusSource: '结果核验来源', successMetric: '成功指标', themes: '内容主题',
  constraints: '行动边界', businessRefs: '关联业务记录', messagesSent: '取得发送回执的客户',
  bulkWorkerStatus: '发送执行方式', messagingAuthorization: '真实消息发送授权', dispatchPreflight: '真实发送预检',
  blockers: '发送阻断原因', reason: '原因', source: '来源', target: '目标', baseline: '基线', output: '产出',
  evidence: '证据', itemCount: '记录数量', id: '记录编号', type: '记录类型',
};

export const technicalValueLabel: Record<string, string> = {
  internal: '数字员工内部执行', observe: '等待真实业务状态回写', approval: '等待人工审批', none: '无外部影响',
  draft: '只生成草稿', schedule: '登记真实排期', publish: '真实对外发布', send: '真实对客发送',
  scheduled: '定时执行', manual_or_scheduled: '人工触发或定时执行', manual_only: '仅人工触发', true: '是', false: '否',
  approved_content_packages: '获批内容包', published_posts: '真实发布内容', qualified_inquiries: '高意向询盘',
  won_customers: '成交客户', reactivated_customers: '唤醒客户',
};

export const eventTypeLabel: Record<string, string> = {
  run_started: '运行已启动', task_started: '任务已开始', task_completed: '任务已完成', task_failed: '任务执行失败',
  task_waiting_external: '等待业务结果', approval_requested: '已请求人工审批', approval_decided: '审批已处理',
  task_corrected: '纠偏已登记', task_retried: '任务已重试', task_skipped: '任务已跳过',
  task_manually_completed: '人工结果已登记', run_paused: '运行已暂停', run_resumed: '运行已恢复',
  run_completed: '运行已完成', handoff_started: '人工已接管', handoff_returned: '任务已交还',
  'workflow.started': '运行已启动', 'workflow.paused': '运行已暂停', 'workflow.resumed': '运行已恢复',
  'workflow.cancelled': '运行已取消', 'workflow.completed': '运行已完成', 'workflow.reconciled': '业务状态已同步',
  'plan.generated': '计划已生成', 'task.started': '任务已开始', 'task.reconciled': '任务状态已同步',
  'task.waiting_external': '等待业务结果', 'task.execution_failed': '执行服务异常', 'task.no_data': '暂无符合条件的数据',
  'task.not_required': '本轮无需执行', 'task.completed': '任务已完成', 'task.retry': '任务已重试',
  'task.skip': '任务已跳过', 'task.manual_complete': '人工结果已登记', 'task.replan': '任务已重新规划',
  'approval.requested': '已请求人工审批', 'approval.preflight_blocked': '审批前检查未通过',
  'approval.decided': '审批已处理', 'business.resource.created': '业务记录已创建',
  'business.resource.first_run': '首次执行已完成', 'business.resource.first_run_failed': '首次执行未成功',
  'customer.segment.created': '客户分层已保存', 'followup.batch.created': '跟进批次已保存',
  'review.generated': '本周复盘已生成', 'handoff.started': '人工已接管', 'handoff.returned': '任务已交还',
  'agent.ui.action_started': 'Agent 开始页面操作', 'agent.ui.navigation': 'Agent 已导航',
  'agent.ui.click': 'Agent 已点击', 'agent.ui.input': 'Agent 已输入', 'agent.ui.screenshot': 'Agent 已上报现场截图',
};
