const model = require('./workbench');

function iso(date, hour = 10) { return date + 'T' + String(hour).padStart(2, '0') + ':00:00+08:00'; }

function project(week) {
  const d = week.days.map(item => item.date);
  const tasks = [
    { id:'demo-script', title:'「秋季工厂探访」脚本定稿', status:'succeeded', agent_role:'director', description:'完成 60 秒口播脚本与分镜表', due_at:iso(d[0],16), updated_at:iso(d[0],15), run_id:'demo-run' },
    { id:'demo-edit', title:'工厂实力短视频剪辑', status:'running', agent_role:'content', description:'初剪已完成，正在生成中英双语字幕', due_at:iso(d[3],18), updated_at:iso(d[2],11), run_id:'demo-run', output:{stage:'字幕与包装'} },
    { id:'demo-leads', title:'跟进本周高意向询盘', status:'running', agent_role:'business', description:'已识别 3 条高意向线索，等待销售跟进', due_at:iso(d[4],17), updated_at:iso(d[2],12), run_id:'demo-run' },
    { id:'demo-cover', title:'确认新品视频封面', status:'handed_off', agent_role:'content', priority:'urgent', blocked_reason:'两个封面方案需要你确认后才能排期', due_at:iso(d[2],16), updated_at:iso(d[2],9), run_id:'demo-run', task_version:'3' },
    { id:'demo-retry', title:'同步 TikTok 发布结果', status:'failed', agent_role:'traffic', priority:'high', blocked_reason:'平台授权已过期，需要重新授权后重试', due_at:iso(d[2],14), updated_at:iso(d[2],10), run_id:'demo-run', task_version:'2' }
  ];
  const posts = [
    { id:'demo-post-1', contentId:'factory-tour', taskId:'demo-script', title:'工厂探访：一台设备如何完成质检', platform:'视频号', status:'published', scheduledAt:iso(d[1],12), publishReceipt:'verified', stage:'发布完成', steps:[{label:'脚本',state:'done'},{label:'剪辑',state:'done'},{label:'发布',state:'done'}] },
    { id:'demo-post-2', contentId:'product-demo', taskId:'demo-edit', title:'新品 30 秒功能演示', platform:'抖音', status:'scheduled', scheduledAt:iso(d[3],18), publishReceipt:'pending', stage:'字幕与包装', steps:[{label:'脚本',state:'done'},{label:'剪辑',state:'active'},{label:'发布',state:'todo'}] },
    { id:'demo-post-3', contentId:'customer-story', taskId:'demo-leads', title:'客户案例：交付周期缩短 40%', platform:'小红书', status:'planned', scheduledAt:iso(d[5],11), publishReceipt:'pending', stage:'等待素材', steps:[{label:'素材',state:'active'},{label:'成稿',state:'todo'},{label:'发布',state:'todo'}] }
  ];
  const overview = {
    generatedAt:new Date().toISOString(),
    metrics:{tasks:{value:8,availability:'available'},completed:{value:3,availability:'available'},publishedVideos:{value:2,availability:'available'},exposure:{value:128600,availability:'available',note:'各平台本周增量汇总'},qualifiedInquiries:{value:7,availability:'available'}},
    inquiryDrilldown:{availability:'available',items:[
      {id:'demo-inquiry-1',platform:'TikTok',accountId:'@lingshu_global',qualification:{authority:'客服 Agent'},body:'询问 MOQ、交期及德国代理政策'},
      {id:'demo-inquiry-2',platform:'视频号',accountId:'华南设备采购',qualification:{authority:'销售 Agent'},body:'希望本周安排线上产品演示'},
      {id:'demo-inquiry-3',platform:'小红书',accountId:'设计师阿琳',qualification:{authority:'客服 Agent'},body:'咨询样品与企业采购报价'}
    ]}
  };
  const queue = {tasks,approvals:[{id:'demo-approval',task_id:'demo-cover',status:'pending',risk_level:'high',action_summary:'选择封面 A 后，Agent 将按周四 18:00 自动发布',subject_version:'3',created_at:iso(d[2],9)}],shooting:[{id:'demo-shoot',title:'补拍产品接口特写',shotBrief:'横屏与竖屏各一条，保持自然光，时长 8 秒',priority:'normal',dueAt:iso(d[4],12),createdAt:iso(d[1],10),uploadedMaterialIds:[]}],snoozes:{}};
  const taskViews = tasks.map(model.taskView);
  const calendarItems = posts.map(post => ({...post,date:model.day(post.scheduledAt),statusLabel:model.labels[post.status] || post.status,workflowTaskId:post.taskId,kind:'post'}));
  const agents = [
    {role:'orchestrator',label:'灵小枢',status:'running',statusLabel:'统筹中',currentTask:'协调本周内容发布与询盘跟进'},
    {role:'director',label:'编导 Agent',status:'running',statusLabel:'进行中',currentTask:'策划客户案例选题'},
    {role:'content',label:'内容 Agent',status:'running',statusLabel:'进行中',currentTask:'生成新品视频双语字幕'},
    {role:'business',label:'经营 Agent',status:'waiting_review',statusLabel:'待验收',currentTask:'整理 3 条高意向询盘'}
  ];
  return {overview,tasks:taskViews,agents,posts:calendarItems,calendarItems,matters:model.matters(queue,queue.shooting),snoozed:[],activeMatter:null,metrics:[
    {key:'tasks',label:'本周任务',value:'8'},{key:'completed',label:'已完成',value:'3'},{key:'videos',label:'已发布视频',value:'2'},{key:'exposure',label:'曝光',value:'128600'},{key:'inquiries',label:'有效询盘',value:'7'}
  ],notifications:[{id:'demo-note-1',title:'新品视频初剪已完成，等待你确认封面',time:'10 分钟前',task_id:'demo-cover'},{id:'demo-note-2',title:'新增 3 条高意向询盘',time:'1 小时前',task_id:'demo-leads'}],queueAvailable:true,workspaceKind:'demo',workspaceNote:'演示数据 · 用于体验移动工作台完整交互',updatedAt:'刚刚'};
}

function answer(input) {
  if (/询盘/.test(input)) return '本周共有 7 条有效询盘，其中 3 条为高意向。建议优先跟进“华南设备采购”的线上演示需求。';
  if (/视频|内容/.test(input)) return '本周已发布 2 条视频，累计曝光 128,600。新品功能演示正在制作双语字幕，计划周四 18:00 发布。';
  return '本周 8 项任务已完成 3 项。当前最需要你处理的是确认新品视频封面，其次是恢复 TikTok 平台授权。';
}

module.exports = { project, answer };
