const model = require('./workbench');
function project(w, snoozes = {}) {
  const today = w.today || {};
  const items = [...(today.completed || []), ...(today.inProgress || []), ...(today.nextSteps || [])];
  const tasks = [...new Map(items.map(i => [i.id, { ...i, title: i.what, reason: i.why, description: i.output, agentLabel: i.ownerAgent, statusLabel: model.labels[i.status] || i.status, starter: true }])).values()];
  const cards = [ ...(w.decisions || []).map(d => ({ id: 'starter:' + d.id, title: d.title, reason: d.summary, type: 'starter', starterItem: d, action:'查看原因与处理选项', priority: ['L2','L3'].includes(d.riskLevel) ? 'high' : 'normal', dueAt: d.dueAt, actions: d.actions || [] })),
    ...(today.nextSteps || []).filter(i => (i.actions || []).some(a => !a.disabledReason)).map(i => ({ id: 'starter:' + i.id, title: i.what, reason: i.why || i.next, type: 'starter', starterItem: i, action:'查看下一步与处理选项', priority: 'normal', createdAt: i.updatedAt, actions: i.actions })) ];
  const all = model.sortUrgency([...new Map(cards.map(i => [i.id, i])).values()]);
  const matters = all.filter(i => !(snoozes[i.id] > Date.now()));
  return { starterWorkspace: w, tasks, agents: (w.agents || []).map(a => ({ role: a.role, label: a.displayName, statusLabel: model.labels[a.status] || a.status, currentTask: a.stage })), matters, activeMatter: matters[0] || null, snoozed: all.filter(i => snoozes[i.id] > Date.now()),
    // Current 198 workspace exposes current-cycle projections, not calendar-week aggregates.
    metrics: ['tasks','completed','videos','exposure','inquiries'].map((key,i) => ({key,label:['本周任务','已完成','已发布视频','曝光','有效询盘'][i],value:'—'})),
    notifications: (w.decisions || []).map(d => ({id:d.id,title:d.title,time:w.generatedAt})), posts:[], calendarItems:[], dayPosts:[], queueAvailable:true,
    workspaceNote: '当前工作周期：' + (w.run?.cycleLabel || '尚未开工') + '。周统计和发布日期尚未由此接口提供。', updatedAt: w.generatedAt,
  };
}
function answer(w = {}, input) {
  const current = w.today || {};
  const rows = [...(current.completed || []), ...(current.inProgress || []), ...(current.nextSteps || [])];
  const unique = [...new Map(rows.map(i => [i.id, i])).values()];
  const matches = unique.filter(i => String(input).includes(i.what) || /任务|进展|完成|卡点|这周|本周/.test(input));
  const lines = (matches.length ? matches : unique).slice(0, 8).map(i => '• ' + (i.what || '工作记录') + '：' + (model.labels[i.status] || i.status || '状态未提供') + (i.next ? '；下一步：' + i.next : '') + (i.output ? '；产出：' + i.output : ''));
  return '当前工作周期：' + (w.run?.cycleLabel || '尚未开工') + '，数据更新时间：' + (w.generatedAt || '未提供') + '。\n' + (lines.length ? lines.join('\n') : '当前没有已同步的工作记录。') + '\n待确认事项：' + (w.decisions || []).length + ' 件，可在「待处理」查看详情。\n此接口未提供准确周统计、视频、曝光和询盘汇总，因此这些数据暂时未知。要交给 Agent 执行，请编辑输入后选择「提交工作指令」。';
}
module.exports = { project, answer };
