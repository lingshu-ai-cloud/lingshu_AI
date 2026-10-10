const api = require('../../lib/api');
const model = require('../../lib/workbench');
const mobileAssistant = require('../../lib/assistant');
const agentSchedule = require('../../lib/agentSchedule');
Page({
    data: { loggedIn: false, email: '', password: '', userName: '', tab: 'work', loading: false, error: '', week: model.week(), selectedDay: model.day(new Date().toISOString()), overview: {}, tasks: [], agents: [], agentScheduleGroups: [], agentScheduleItems: [], posts: [], calendarItems: [], matters: [], snoozed: [], activeMatter: null, cardX: 0, swipeDirection: '', swipeReady: false, swipeLabel: '', metrics: [], dayPosts: [], sheet: null, sheetItems: [], detail: null, processing: false, assistantMode: 'chat', messages: [], input: '', sending: false, recording: false, transcribing: false, offline: false, suggestions: ['本周最需要我决定的 3 件事是什么？', '哪些任务会影响本周发布目标？', '哪条内容卡在素材、制作或验收？', '今天有哪些高意向询盘要跟进？', '4 个 Agent 现在分别在做什么？'], notifications: [], assistantPreview: null, assistantReceipts: [], assistantLinks: [], assistantActions: [], assistantLoading: false, assistantConfirming: false, chatAnchor: '' },
    onLoad() { this.networkListener = r => this.setData({ offline: !r.isConnected }); if (wx.onNetworkStatusChange) wx.onNetworkStatusChange(this.networkListener); if (wx.getNetworkType) wx.getNetworkType({success:r=>this.setData({offline:r.networkType === 'none'})}); if (api.token())
        this.restore(); },
    onShow() { if (!api.token()) { if (this.data.loggedIn) this.signOut(); return; } if (this.data.loggedIn) { this.startSync(); this.refresh(); if (this.assistantController) this.assistantController.poll(); } },
    startSync() { if (this.syncTimer) clearInterval(this.syncTimer); this.syncTimer = setInterval(() => { if (this.data.loggedIn && !this.data.processing && !this.data.recording && !this.data.sending && !this.refreshing) this.refresh(); }, 30000); },
    stopSync() { if (this.syncTimer) clearInterval(this.syncTimer); this.syncTimer = null; },
    onHide() { if (this.assistantController) this.assistantController.pause(); this.stopSync(); if (this.recorder && this.data.recording) {
        this.cancelVoice = true;
        this.recorder.stop();
    } },
    onUnload() { if (this.assistantController) this.assistantController.dispose(); if (wx.offNetworkStatusChange && this.networkListener) wx.offNetworkStatusChange(this.networkListener); this.stopSync(); if (this.snoozeWakeTimer) clearTimeout(this.snoozeWakeTimer); this.disposed = true; this.epoch = (this.epoch || 0) + 1; if (this.recorder && this.data.recording) {
        this.cancelVoice = true;
        this.recorder.stop();
    } },
    inputEmail(e) { this.setData({ email: e.detail.value }); }, inputPassword(e) { this.setData({ password: e.detail.value }); },
    async signIn() { if (this.data.loading)
        return; const epoch = this.epoch || 0; this.setData({ loading: true, error: '' }); try {
        const s = await api.login(this.data.email.trim(), this.data.password);
        if (epoch !== (this.epoch || 0) || this.disposed) return;
        this.session(s);
        await this.refresh();
    }
    catch (e) {
        if (epoch === (this.epoch || 0)) this.setData({ error: e.message });
    }
    finally {
        if (!this.disposed && (epoch === (this.epoch || 0) || this.data.loggedIn)) this.setData({ loading: false });
    } },
    session(s) { this.epoch = (this.epoch || 0) + 1; this.setData({tab:'work', detail:null, sheet:null, messages:[], matters:[], snoozed:[], activeMatter:null, tasks:[], agents:[], agentScheduleGroups:[], agentScheduleItems:[], metrics:[], notifications:[], calendarItems:[], posts:[], dayPosts:[], input:'', processing:false, sending:false, transcribing:false}); this.sessionProfile = s; const user = s.user || {}; this.scope = String(user.tenantId || user.tenant_id || '') + ':' + String(user.id || user.email || ''); this.chatKey = 'mobile-chat:' + this.scope; this.snoozes = {}; this.setData({ loggedIn: true, userName: user.name || user.email || '', password: '', messages: [], suggestions: [], assistantPreview:null, assistantReceipts:[], assistantLinks:[], assistantActions:[] }); this.initializeAssistant(); this.startSync(); },
    async restore() { const epoch = this.epoch || 0; try {
        const s = await api.me();
        if (epoch !== (this.epoch || 0) || this.disposed) return;
        this.session(s);
        await this.refresh();
    }
    catch (e) {
        if (epoch === (this.epoch || 0)) this.setData({ error: e.message, loggedIn: false });
    } },
    signOut() { if (this.assistantController) this.assistantController.dispose(); this.assistantController = null; if (this.data.recording && this.recorder) { this.cancelVoice = true; this.recorder.stop(); } this.stopSync(); this.inputCommandKey = null; this.actionKey = null; this.actionKeyScope = null; this.epoch = (this.epoch || 0) + 1; api.clearToken(); this.setData({ loggedIn: false, overview: {}, tasks: [], agents: [], agentScheduleGroups: [], agentScheduleItems: [], posts: [], calendarItems: [], dayPosts: [], metrics: [], matters: [], snoozed: [], activeMatter: null, messages: [], assistantPreview:null, assistantReceipts:[], assistantLinks:[], assistantActions:[], assistantLoading:false, assistantConfirming:false, suggestions:[], notifications: [], workspaceNote: '', undoVisible: false, queueAvailable: false, detail: null, sheet: null, userName: '', input: '', error: '', processing:false, sending:false, recording:false, transcribing:false }); },
    switchTab(e) { this.setData({ tab: e.currentTarget.dataset.tab, sheet: null, detail: null, error: '' }); },
    async refresh() {
        if (!this.data.loggedIn)
            return;
        if (this.data.offline) { this.setData({error:'网络已断开，当前展示上次同步结果。连接后请刷新。'}); return; }
        if (this.refreshing) {
            this.refreshAgain = true;
            return;
        }
        this.refreshing = true;
        const epoch = this.epoch || 0;
        this.setData({ loading: true, error: '' });
        try {
            const w = this.data.week;
            const results = await Promise.allSettled([
                api.request('mobile-workbench/overview?weekStart=' + encodeURIComponent(w.start)),
                api.request('mobile-workbench/queue')
            ]);
            if (epoch !== (this.epoch || 0) || this.disposed)
                return;
            if (results[0].status !== 'fulfilled') throw results[0].reason;
            const overview = results[0].value;
            const queue = results[1].status === 'fulfilled' ? results[1].value : null;
            if (queue) this.snoozes = queue.snoozes || {};
            const shooting = queue?.shooting || [];
            const queueTasks = new Map((queue?.tasks || []).map(task => [task.id, task]));
            const tasks = (overview.taskDrilldown?.items || []).map(task => model.taskView({
                ...(queueTasks.get(task.id) || {}), ...task,
                agent_role: task.agentRole, run_id: task.runId, updated_at: task.updatedAt,
                task_version: task.version
            }));
            const posts = (overview.contentSchedule?.items || []).map(post => ({
                ...post, date: model.day(post.scheduledAt), statusLabel: model.labels[post.status] || post.status,
                workflowTaskId: post.taskId, kind: 'post', timeLabel: model.time(post.scheduledAt),
                nextAction: model.scheduleNextAction(post), agentLabel: model.roles[post.agentRole] || post.agentRole || ''
            }));
            const calendarItems = posts;
            const projectedMatters = (queue?.matters || []).map(item => ({ ...item, type: 'command', starterItem: item.subject, action: '查看原因与处理选项' }));
            const allMatters = queue?.matters ? model.sortUrgency(projectedMatters) : queue ? model.matters(queue, shooting) : [];
            this.setData({ queueAvailable: Boolean(queue) });
            const snoozed = allMatters.filter(i => Number(this.snoozes[i.id]) > Date.now());
            const matters = allMatters.filter(i => Number(this.snoozes[i.id]) <= Date.now() || !this.snoozes[i.id]);
            const showMetric = entry => entry?.availability === 'available' && typeof entry.value === 'number' ? String(entry.value) : '—';
            const metrics = [
                { key: 'tasks', label: '本周任务', value: showMetric(overview.metrics?.tasks), note: overview.metrics?.tasks?.note },
                { key: 'completed', label: '已完成', value: showMetric(overview.metrics?.completed), note: overview.metrics?.completed?.note },
                { key: 'videos', label: '已发布视频', value: showMetric(overview.metrics?.publishedVideos), note: overview.metrics?.publishedVideos?.note },
                { key: 'exposure', label: '曝光', value: showMetric(overview.metrics?.exposure), note: overview.metrics?.exposure?.note },
                { key: 'inquiries', label: '有效询盘', value: showMetric(overview.metrics?.qualifiedInquiries), note: overview.metrics?.qualifiedInquiries?.note }
            ];
            const agents = (overview.agents?.items || []).map(agent => ({
                ...agent, label: model.roles[agent.role] || agent.role,
                statusLabel: model.labels[agent.status] || agent.status,
                currentTask: agent.currentTask?.title || '', observedAt: agent.updatedAt
            }));
            const scheduleView = agentSchedule.project(overview.agentSchedule, agents, allMatters);
            this.setData({ ...scheduleView, overview, tasks, calendarItems, agents, posts, matters, snoozed, activeMatter: matters[0] || null, metrics, notifications: [], workspaceNote: overview.workspace?.note || '', cardX: 0, updatedAt: overview.generatedAt ? new Date(overview.generatedAt).toLocaleTimeString() : new Date().toLocaleTimeString(), error: results[1].status === 'rejected' ? results[1].reason.message : '' });
            this.scheduleNextSnoozeWake();
            this.updateDay();
        }
        catch (e) {
            if (epoch === (this.epoch || 0)) {
                if (!api.token()) this.signOut();
                else this.setData({ error: e.message });
            }
        }
        finally {
            this.refreshing = false;
            if (epoch === (this.epoch || 0) && !this.disposed)
                this.setData({ loading: false });
            if (this.refreshAgain) {
                this.refreshAgain = false;
                this.refresh();
            }
        }
    },
    changeWeek(e) { if (this.data.recording && this.recorder) {this.cancelVoice=true;this.recorder.stop();} this.setData({sending:false,transcribing:false,recording:false}); this.epoch = (this.epoch || 0) + 1; const offset = (this.weekOffset || 0) + Number(e.currentTarget.dataset.offset); this.weekOffset = offset; const week = model.week(Date.now(), offset); this.setData({ week, selectedDay: week.start, posts: [], calendarItems: [], dayPosts: [], tasks: [], agentScheduleGroups: [], agentScheduleItems: [], metrics: [], matters: [], activeMatter: null, sheet: null, detail: null }); this.refresh(); },
    selectDay(e) { this.setData({ selectedDay: e.currentTarget.dataset.date }); this.updateDay(); },
    updateDay() { this.setData({ dayPosts: this.data.calendarItems.filter(p => p.date === this.data.selectedDay), days: this.data.week.days.map(d => ({ ...d, count: this.data.calendarItems.filter(p => p.date === d.date).length })) }); },
    touchStart(e) { const t = e.touches[0]; this.gesture = { x: t.clientX, y: t.clientY, dx: 0, dy: 0 }; },
    touchMove(e) { if (!this.gesture)
        return; const t = e.touches[0]; this.gesture.dx = t.clientX - this.gesture.x; this.gesture.dy = t.clientY - this.gesture.y; if (Math.abs(this.gesture.dx) > Math.abs(this.gesture.dy) * 1.4) {
        const direction = this.gesture.dx > 0 ? 'process' : 'later';
        const ready = Math.abs(this.gesture.dx) >= 85;
        this.setData({ cardX: Math.max(-140, Math.min(140, this.gesture.dx)), swipeDirection: direction, swipeReady: ready, swipeLabel: direction === 'process' ? (ready ? '松手，立即处理' : '继续右滑，立即处理') : (ready ? '松手，稍后提醒' : '继续左滑，稍后提醒') });
    } },
    touchEnd() { const g = this.gesture; this.gesture = null; this.setData({ cardX: 0, swipeDirection: '', swipeReady: false, swipeLabel: '' }); if (!g)
        return; const action = model.swipe(g.dx, g.dy);
        if (action) this.lastGestureAt = Date.now(); if (action === 'later')
        this.snooze(); if (action === 'process')
        this.processMatter(); },
    touchCancel() { this.gesture = null; this.setData({ cardX: 0, swipeDirection: '', swipeReady: false, swipeLabel: '' }); },
    snooze() {
        const item = this.data.activeMatter;
        if (!item || this.data.processing || this.data.offline) return;
        const epoch = this.epoch || 0;
        wx.showActionSheet({ itemList: ['5 分钟后', '1 小时后', '明天上午 9 点'], success: async r => {
            if (epoch !== (this.epoch || 0) || this.disposed) return;
            let until = Date.now() + (r.tapIndex === 0 ? 5 * 60000 : 3600000);
            if (r.tapIndex === 2) { const tomorrow = new Date(Date.now() + 8 * 3600000); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1); tomorrow.setUTCHours(1, 0, 0, 0); until = tomorrow.getTime(); }
            await this.saveSnooze(item, until);
        } });
    },
    async saveSnooze(item, until) {
        if (this.data.processing) return;
        const epoch = this.epoch || 0;
        this.setData({ processing: true, error: '' });
        try {
            await api.request('mobile-workbench/snooze', 'POST', { matterId: item.id, until });
            if (epoch !== (this.epoch || 0) || this.disposed) return;
            if (until) {
                this.snoozes[item.id] = until; this.lastSnooze = item.id;
                const matters = this.data.matters.filter(i => i.id !== item.id);
                const snoozedItem = { ...item, snoozedUntil: until, snoozeLabel: '将于 ' + new Date(until).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) + ' 回到待处理' };
                this.setData({ matters, activeMatter: matters[0] || null, snoozed: [...this.data.snoozed.filter(i => i.id !== item.id), snoozedItem], undoVisible: true });
                this.scheduleNextSnoozeWake();
            } else {
                delete this.snoozes[item.id];
                const matters = model.sortUrgency([...this.data.matters.filter(i => i.id !== item.id), item]);
                this.setData({ matters, activeMatter: matters[0] || null, snoozed: this.data.snoozed.filter(i => i.id !== item.id), undoVisible: false });
                this.scheduleNextSnoozeWake();
            }
        } catch (e) { if (epoch === (this.epoch || 0)) this.setData({ error: e.message }); }
        finally { if (epoch === (this.epoch || 0) && !this.disposed) this.setData({ processing: false }); }
    },
    scheduleSnoozeWake(until) { if (typeof setTimeout !== 'function') return; if (this.snoozeWakeTimer) clearTimeout(this.snoozeWakeTimer); const delay = Math.max(0, Math.min(until - Date.now() + 200, 2147483647)); this.snoozeWakeTimer = setTimeout(() => { if (this.data.loggedIn && !this.disposed) this.refresh(); }, delay); if (this.snoozeWakeTimer?.unref) this.snoozeWakeTimer.unref(); },
    scheduleNextSnoozeWake() { const now=Date.now(); const next=Object.values(this.snoozes || {}).map(Number).filter(value=>value>now).sort((a,b)=>a-b)[0]; if(next)this.scheduleSnoozeWake(next); else if(this.snoozeWakeTimer){clearTimeout(this.snoozeWakeTimer);this.snoozeWakeTimer=null;} },
    async undoSnooze() { const item = this.data.snoozed.find(i => i.id === this.lastSnooze); if (item) await this.saveSnooze(item, 0); },
    showSnoozed() { this.setData({ sheet: '稍后处理', sheetItems: this.data.snoozed.map(i => ({ ...i, subtitle: i.snoozeLabel || i.reason, kind: 'matter' })) }); },
    viewMatter() { if (Date.now() - (this.lastGestureAt || 0) < 400) return; this.processMatter(); },
    processMatter() { const item = this.data.activeMatter; if (!item)
        return; if (item.type === 'command') { this.setData({detail:{...item.starterItem,title:item.title,reason:item.reason,starter:true,actions:item.actions},sheet:null}); return; }
        const matterId = item.matterId || item.id;
        if (matterId && /^(approval|task|shoot|external|conversation|connection):/.test(matterId)) {
            wx.navigateTo({ url: '/pages/action/index?matterId=' + encodeURIComponent(matterId) });
            return;
        }
        const actionDetail = model.actionDetail(item.task); this.setData({ detail: { ...item.task, ...actionDetail, title: item.title, reason: item.reason, approval: item.approval, type: item.type, interventionType: item.interventionType, route: item.route || model.actionRoute(item), receipt: null }, sheet: null }); this.loadTaskEvents(item.task); },
    selectFailedShots(e) { const ids = (e.detail.value || []).map(String); this.setData({'detail.selectedShotIds':ids,'detail.failedShots':(this.data.detail?.failedShots || []).map(shot=>({...shot,selected:ids.includes(String(shot.id))}))}); },
    askMatterAssistant() { const d = this.data.detail; if (!d) return; this.setData({ detail:null, tab:'assistant', input:'请根据真实工作数据告诉我“' + d.title + '”为什么停下、我需要补充什么，以及提交后如何确认它已恢复。' }); },
    async openAgentAssignment(e) {
        const epoch = this.epoch || 0;
        const entry = (this.data.agentScheduleItems || []).find(item => item.taskId === String(e.currentTarget.dataset.id));
        if (!entry) return;
        // Resolve against the latest actionable queue; status text alone never authorizes an action.
        const matter = [...this.data.matters, ...this.data.snoozed].find(item =>
            (entry.matterId && (item.matterId || item.id) === entry.matterId) ||
            String(item.source?.entityId || item.task?.id || item.taskId || '') === entry.taskId);
        if (matter) {
            if (this.snoozes?.[matter.id]) {
                await this.saveSnooze(matter, 0);
                if (epoch !== (this.epoch || 0) || this.disposed || this.snoozes[matter.id]) return;
            }
            this.setData({tab:'todo',activeMatter:matter,sheet:null,detail:null});
            this.processMatter();
            return;
        }
        const task = model.taskView({id:entry.taskId,title:entry.title,status:entry.status,
            agent_role:entry.role,run_id:entry.runId,blocked_reason:entry.blockedReason,
            stage:entry.stage,next:entry.nextAction,due_at:entry.dueAt,
            scheduleReadOnly:true});
        this.setData({detail:task,sheet:null});
        await this.loadTaskEvents(task);
    },
    openTask(e) { const task = this.data.tasks.find(t => t.id === e.currentTarget.dataset.id); if (task) {
        this.setData({ detail: task });
        if (!task.starter) this.loadTaskEvents(task);
    } },
    openNotification(e) { const event = this.data.notifications.find(i => i.id === e.currentTarget.dataset.id); if (event?.task_id)
        this.openTask({ currentTarget: { dataset: { id: event.task_id } } }); },
    openShooting() { wx.navigateTo({ url: '/pages/index/index' }); },
    async openMetric(e) { const key = e.currentTarget.dataset.key; if (key === 'tasks' || key === 'completed')
        this.setData({ sheet: key === 'completed' ? '本周已完成' : '本周任务', sheetItems: this.data.tasks.filter(t => key !== 'completed' || t.status === 'succeeded').map(t => ({ ...t, kind: 'task', subtitle: t.statusLabel + ' · ' + t.agentLabel })) }); if (key === 'videos')
        this.setData({ sheet: '本周视频发布记录', sheetItems: this.data.posts.filter(p => p.publishReceipt === 'verified').map(p => ({ ...p, kind: 'post', subtitle: p.platform + ' · ' + p.statusLabel })) }); if (key === 'exposure') {
        const metric = this.data.overview.metrics?.exposure;
        this.setData({ sheet: '曝光数据口径', sheetItems: [{ id: 'note', title: metric?.availability === 'available' ? '本周曝光 ' + metric.value : '暂无可靠曝光数据', subtitle: metric?.note || '按平台日值或累计快照差分计算。' }] });
    } if (key === 'inquiries') {
        const drilldown = this.data.overview.inquiryDrilldown;
        this.setData({ sheet: '本周有效询盘', sheetItems: (drilldown?.items || []).map(item => ({ ...item, title: item.platform + ' 询盘', subtitle: (item.accountId || '来源账号未知') + ' · 已由' + item.qualification.authority + '确认', kind: 'inquiry' })), sheetError: drilldown?.availability === 'available' ? '' : '询盘或资格数据暂不可用，请稍后刷新。' });
    } },
    async selectItem(e) { const i = this.data.sheetItems.find(i => i.id === e.currentTarget.dataset.id); if (!i)
        return; if (i.kind === 'matter') {
        await this.saveSnooze(i, 0);
        if (this.snoozes[i.id]) return;
        this.setData({ activeMatter: i });
        this.processMatter();
        return;
    } this.setData({ detail: i, sheet: null }); if (i.kind === 'task' && !i.starter)
        this.loadTaskEvents(i); },
    openPost(e) { const p = this.data.calendarItems.find(p => p.id === e.currentTarget.dataset.id); if (!p)
        return; const task = this.data.tasks.find(t => t.id === (p.workflowTaskId || p.taskId)); this.setData({ detail: task ? { ...task, post: p, steps: p.steps || [], stage: p.stage || '' } : { ...p, kind: p.kind, reason: p.reason || p.publishError || '当前内容排期', statusLabel: p.statusLabel } }); if (task)
        if (!task.starter) this.loadTaskEvents(task); },
    async loadTaskEvents(task) {
        if (!task?.run_id) return;
        const epoch = this.epoch || 0;
        const requestId = this.detailRequest = (this.detailRequest || 0) + 1;
        this.setData({'detail.loading':true, 'detail.loadError':''});
        try {
            const r = await api.request('digital-employees/runs/' + encodeURIComponent(task.run_id) + '/tasks/' + encodeURIComponent(task.id) + '/workspace');
            if (epoch !== (this.epoch || 0) || this.disposed || requestId !== this.detailRequest || this.data.detail?.id !== task.id) return;
            const current = r.task || task;
            this.setData({'detail.events':r.events || [], 'detail.result':current.output && Object.keys(current.output).length ? JSON.stringify(current.output,null,2) : '', 'detail.statusLabel':model.labels[current.status] || current.status || task.statusLabel, 'detail.stage':current.output?.stage || current.stage || task.stage || '', 'detail.loading':false});
        } catch(e) {
            if (epoch === (this.epoch || 0) && requestId === this.detailRequest && this.data.detail?.id === task.id) this.setData({'detail.loading':false,'detail.loadError':e.message});
        }
    },
    reloadDetail() { if (this.data.detail && !this.data.detail.starter) this.loadTaskEvents(this.data.detail); },
    closeDetail() { this.detailRequest = (this.detailRequest || 0) + 1; if (!this.data.processing)
        this.setData({ detail: null, sheet: null, sheetError: '' }); },
    async submitWorkbenchAction(kind, targetId, expectedVersion, payload) {
        const scope = JSON.stringify([kind, targetId, expectedVersion, payload]);
        if (this.actionKeyScope !== scope) {
            this.actionKeyScope = scope;
            this.actionKey = 'mobile-action-' + Date.now() + '-' + Math.random().toString(36).slice(2);
        }
        const result = await api.request('mobile-workbench/actions', 'POST', { kind, targetId, expectedVersion: String(expectedVersion || ''), idempotencyKey: this.actionKey, payload });
        const receipt = result.receipt;
        if (!receipt || receipt.status === 'failed') throw new Error(receipt?.error?.code || '操作执行失败，请刷新后重试');
        if (receipt.status !== 'succeeded') throw new Error('操作已接收但尚未完成，请稍后刷新查看结果');
        this.actionKey = null;
        this.actionKeyScope = null;
        return receipt;
    },
    async submitQualityRetry(e) {
        const task = this.data.detail;
        if (!task?.id || this.data.processing) return;
        const shotIds = task.selectedShotIds || [];
        if (!shotIds.length) { this.setData({error:'请至少选择一个需要重做的分镜'}); return; }
        const mode = e.currentTarget.dataset.mode;
        const costLimit = mode === 'budget' ? Number(task.costLimitInput) : null;
        if (mode === 'budget' && (!Number.isFinite(costLimit) || costLimit <= 0)) { this.setData({error:'请输入有效的本次费用上限'}); return; }
        const selected = (task.failedShots || []).filter(shot => shotIds.includes(String(shot.id)));
        const summary = selected.map(shot => `${shot.label}(${shot.reason})`).join('、');
        const instruction = `保留已通过分镜，仅重做：${summary}。${mode === 'budget' ? `本次新增费用上限为¥${costLimit.toFixed(2)}。` : '费用上限沿用当前任务授权，超出时停止并再次请求确认。'}重新质检后再合成，不重跑其他已完成步骤。`;
        const epoch = this.epoch || 0;
        wx.showModal({title:'确认提交局部重做？',content:`将重做 ${selected.length} 个分镜。${(task.impact || []).join('；')}`,confirmText:'确认执行',success:async r=>{
            if(!r.confirm || epoch !== (this.epoch || 0) || this.disposed) return;
            this.setData({processing:true,error:''});
            try { const receipt=await this.submitWorkbenchAction('retry_task',task.id,task.task_version || task.version || task.updated_at,{instruction,rerunDownstream:false});
                if(epoch !== (this.epoch || 0) || this.disposed)return;
                this.setData({'detail.receipt':{...receipt,statusLabel:'已提交并由后端受理',summary:`${selected.length} 个分镜已进入重做队列`}}); await this.refresh();
            } catch(err) { if(epoch === (this.epoch || 0))this.setData({error:err.message}); }
            finally { if(epoch === (this.epoch || 0))this.setData({processing:false}); }
        }});
    },
    inputCostLimit(e) { this.setData({'detail.costLimitInput':e.detail.value}); },
    async decideApproval(e) { if (this.data.processing || !this.data.detail?.approval)
        return; const a = this.data.detail.approval; const decision = e.currentTarget.dataset.decision; const epoch = this.epoch || 0; wx.showModal({ title: decision === 'approved' ? '确认批准此事项？' : '退回此事项？', content: a.action_summary, success: async (r) => { if (!r.confirm || epoch !== (this.epoch || 0) || this.disposed)
            return; this.setData({ processing: true }); try {
            await this.submitWorkbenchAction('approval_decision', a.id, a.subject_version || a.version || a.updated_at, { decision, note: '移动工作台确认' });
            if (epoch !== (this.epoch || 0) || this.disposed) return;
            this.setData({ detail: null }); await this.refresh();
        }
        catch (e) {
            if (epoch === (this.epoch || 0)) this.setData({ error: e.message });
        }
        finally {
            if (epoch === (this.epoch || 0)) this.setData({ processing: false });
        } } }); },
    async retryTask() { const task = this.data.detail; if (!task?.id || this.data.processing)
        return; const epoch = this.epoch || 0; wx.showModal({ title: '重试当前任务', content: '系统会重新核验依赖与预算，可能产生新增费用。确认后提交恢复请求。', success: async (r) => { if (!r.confirm || epoch !== (this.epoch || 0) || this.disposed)
            return; this.setData({ processing: true }); try {
            await this.submitWorkbenchAction('retry_task', task.id, task.task_version || task.version || task.updated_at, { instruction: '重试当前任务并重置下游', rerunDownstream: true });
            if (epoch !== (this.epoch || 0) || this.disposed) return;
            this.setData({ detail: null });
            await this.refresh();
            wx.showToast({ title: '已提交恢复请求', icon: 'none' });
        }
        catch (e) {
            if (epoch === (this.epoch || 0)) this.setData({ error: e.message });
        }
        finally {
            if (epoch === (this.epoch || 0)) this.setData({ processing: false });
        } } }); },
    retryWithMode(e) {
        const task = this.data.detail;
        if (!task?.id || this.data.processing) return;
        const mode = e.currentTarget.dataset.mode;
        const definitions = {
            retry_failed_shots: { title: '只重做未通过分镜', placeholder: '可补充画面、口播或字幕要求', prefix: '保留已通过分镜，只重做质检未通过的分镜并重新合成。' },
            increase_cost_limit: { title: '设置本次费用上限', placeholder: '输入本次允许增加的金额（元）', prefix: '仅本次返工允许的新增费用上限（元）：' },
            retry_failed_step: { title: '只重试失败步骤', placeholder: '可补充恢复说明', prefix: '保留已完成成果，只从失败节点安全重试。' },
            rerun_downstream: { title: '重跑失败节点及下游', placeholder: '请说明为什么需要重跑下游', prefix: '从失败节点开始重跑相关下游步骤。' },
            authorization_fixed: { title: '确认授权已恢复', placeholder: '可填写已重新授权的账号', prefix: '我已完成账号重新授权，请先校验连接，再从失败节点重试。' },
            supply_instruction: { title: '补充处理指令', placeholder: '填写 Agent 继续工作所需的决定或约束', prefix: '' }
        };
        const def = definitions[mode]; if (!def) return;
        const epoch = this.epoch || 0;
        wx.showModal({ title: def.title, editable: true, placeholderText: def.placeholder, confirmText: '提交并继续', success: async r => {
            if (!r.confirm || epoch !== (this.epoch || 0) || this.disposed) return;
            const value = String(r.content || '').trim();
            if (mode === 'increase_cost_limit' && (!/^\d+(\.\d{1,2})?$/.test(value) || Number(value) <= 0)) { this.setData({error:'请输入有效的本次费用上限'}); return; }
            if (mode === 'supply_instruction' && !value) { this.setData({error:'请填写 Agent 继续工作所需的信息'}); return; }
            this.setData({processing:true,error:''});
            try {
                await this.submitWorkbenchAction('retry_task', task.id, task.task_version || task.version || task.updated_at, { instruction: def.prefix + value, rerunDownstream: mode === 'rerun_downstream' });
                if (epoch !== (this.epoch || 0) || this.disposed) return;
                this.setData({detail:null}); await this.refresh(); wx.showToast({title:'已提交，Agent 正在恢复',icon:'none'});
            } catch (err) { if (epoch === (this.epoch || 0)) this.setData({error:err.message}); }
            finally { if (epoch === (this.epoch || 0)) this.setData({processing:false}); }
        }});
    },
    starterAction(e) {
        if (this.data.processing) return;
        const detail = this.data.detail;
        const action = detail?.actions?.find(a => a.id === e.currentTarget.dataset.id);
        if (!action || action.disabledReason) { this.setData({error:action?.disabledReason || '此操作当前不可用'}); return; }
        if (!['resolve_decision','pause_run','resume_run','cancel_run'].includes(action.command)) { this.setData({error:'此事项需要完整业务资料，请在对应网页工作台完成。'}); return; }
        const decision = e.currentTarget.dataset.decision; const epoch=this.epoch || 0;
        wx.showModal({title:action.label,content:detail.reason || detail.summary || '确认对当前工作周期执行此操作？',success:async r=>{
            if (!r.confirm || epoch !== (this.epoch || 0)) return; this.setData({processing:true,error:''});
            const key=JSON.stringify([detail.id,action.id,action.expectedVersion,decision]);
            if (this.actionKeyScope !== key) { this.actionKeyScope=key; this.actionKey='mobile-action-'+Date.now()+'-'+Math.random().toString(36).slice(2); }
            try { await api.command({command:action.command,targetId:detail.id,expectedVersion:action.expectedVersion || detail.subjectVersion,idempotencyKey:this.actionKey,payload:decision ? {decision}: {}});
                if (epoch !== (this.epoch || 0)) return;
                this.actionKey=null;this.actionKeyScope=null;this.setData({detail:null});await this.refresh();
            } catch (err) { if(epoch===(this.epoch||0))this.setData({error:err.message}); }
            finally {if (epoch === (this.epoch || 0)) this.setData({processing:false});}
        }});
    },
    initializeAssistant() {
        if (this.assistantController) this.assistantController.dispose();
        const epoch = this.epoch || 0;
        this.assistantController = mobileAssistant.createAssistantController({
            request: (path, method, body) => api.request(path, method, body),
            storage: {get:key=>wx.getStorageSync(key),set:(key,value)=>wx.setStorageSync(key,value)},
            onChange: state => {
                if (epoch !== (this.epoch || 0) || this.disposed) return;
                const labels = {accepted:'已接收',queued:'排队中',running:'执行中',waiting_user:'等待你处理',succeeded:'操作已完成',failed:'操作失败',cancelled:'已取消'};
                const messages = state.messages.map(message=>({...message,content:message.text || message.content || ''}));
                this.setData({messages,suggestions:state.suggestions.map(q=>typeof q === 'string'?q:q.label),assistantLoading:state.loading,assistantPreview:state.preview,assistantReceipts:state.receipts.map(r=>({...r,statusLabel:labels[r.status] || '状态待核实',errorLabel:r.error?.code || ''})),assistantLinks:state.links || [],assistantActions:state.actions || [],assistantConfirming:state.confirming,sending:state.sending,input:state.input || '',chatAnchor:messages.length?messages[messages.length-1].id:'',...(state.error?{error:state.error}:{})});
            }
        });
        this.assistantController.restore(this.scope).catch(error=>{if(epoch === (this.epoch || 0))this.setData({error:error.message});});
    },
    reloadAssistant() { this.initializeAssistant(); },
    switchAssistant(e) { this.setData({ assistantMode: e.currentTarget.dataset.mode }); },
    inputText(e) { this.setData({input:e.detail.value}); if(this.assistantController)this.assistantController.setInput(e.detail.value); },
    askSuggestion(e) { this.setData({input:e.currentTarget.dataset.text}); this.send(); },
    async send() {
        const input = this.data.input.trim(); if(!input || this.data.sending || this.data.offline)return;
        const epoch = this.epoch || 0;
        try { if(!this.assistantController)this.initializeAssistant(); await this.assistantController.send(input); }
        catch(error){if(epoch === (this.epoch || 0) && !this.disposed)this.setData({error:error.message,input});}
    },
    async previewAssistantAction(e) {
        const action=this.data.assistantActions[Number(e.currentTarget.dataset.index)]; if(!action || !this.assistantController)return;
        try {await this.assistantController.preview(action.action || action);}catch(error){this.setData({error:error.message});}
    },
    async confirmAssistantAction() {
        if(!this.assistantController || !this.data.assistantPreview || this.data.offline)return;
        try {await this.assistantController.confirm(this.data.assistantPreview.previewId);await this.refresh();}catch(error){this.setData({error:error.message});}
    },
    dismissAssistantPreview() { if(this.assistantController)this.assistantController.dismissPreview(); },
    async refreshAssistantReceipts() {if(this.assistantController)await this.assistantController.poll();},
    assistantAction(e) {
        const action=this.data.assistantLinks[Number(e.currentTarget.dataset.index)]; if(!action)return;
        if(action.type==='matter' || action.matterId){const id=action.matterId || action.id;const matter=this.data.matters.find(m=>m.id===id || m.matterId===id);if(!matter){this.setData({error:'该事项已更新，请刷新后查看最新状态。'});return;}this.setData({activeMatter:matter,tab:'todo'});this.processMatter();return;}
        if(action.type==='task'){this.openTask({currentTarget:{dataset:{id:action.id}}});return;}
        const key=action.type==='video'?'videos':action.type==='inquiry'?'inquiries':action.metric;
        if(key)this.openMetric({currentTarget:{dataset:{key}}});
    },
    async ensureRecordPermission() {
        if (!wx.getSetting) return true;
        const settings = await new Promise((resolve, reject) => wx.getSetting({ success: resolve, fail: reject }));
        if (settings.authSetting?.['scope.record'] === true) return true;
        if (settings.authSetting?.['scope.record'] === false) {
            this.setData({ error: '麦克风权限已关闭，请在小程序设置中开启，或继续使用文字输入。' });
            if (wx.showModal && wx.openSetting) wx.showModal({ title: '需要麦克风权限', content: '语音仅用于把当前录音转成可编辑文字。你也可以继续使用文字输入。', confirmText: '去设置', success: result => { if (result.confirm) wx.openSetting({}); } });
            return false;
        }
        if (!wx.authorize) {
            this.setData({ error: '当前微信版本无法申请麦克风权限，可以继续使用文字输入。' });
            return false;
        }
        try {
            await new Promise((resolve, reject) => wx.authorize({ scope: 'scope.record', success: resolve, fail: reject }));
            return true;
        } catch (_) {
            this.setData({ error: '未获得麦克风权限，可以继续使用文字输入。' });
            return false;
        }
    },
    async toggleVoice() { if (this.data.transcribing)
        return; if (this.data.recording) {
        this.recorder.stop();
        return;
    } if (!await this.ensureRecordPermission()) return; if (!this.recorder) {
        this.recorder = wx.getRecorderManager();
        this.recorder.onStart(() => { if (this.voiceEpoch === (this.epoch || 0) && !this.disposed) this.setData({ recording: true }); });
        this.recorder.onError(() => { if (this.voiceEpoch === (this.epoch || 0) && !this.disposed) this.setData({ recording: false, error: '无法录音，请允许麦克风权限或使用文字输入' }); });
        this.recorder.onStop(async (r) => { if (this.voiceEpoch !== (this.epoch || 0) || this.disposed) return; this.setData({ recording: false }); if (this.cancelVoice) {
            this.cancelVoice = false;
            return;
        } const epoch = this.epoch || 0; this.setData({ transcribing: true, error: '' }); try {
            const audio = await new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath: r.tempFilePath, encoding: 'base64', success: r => resolve(r.data), fail: reject }));
            const result = await api.request('mobile-workbench/transcribe', 'POST', { audio });
            if (epoch === (this.epoch || 0) && !this.disposed)
                this.setData({ input: result.text }); if(this.assistantController)this.assistantController.voiceDraft(result.text);
        }
        catch (e) {
            if (epoch === (this.epoch || 0) && !this.disposed)
                this.setData({ error: e.message || '识别失败，请使用文字输入' });
        }
        finally {
            if (epoch === (this.epoch || 0) && !this.disposed)
                this.setData({ transcribing: false });
        } });
    } this.voiceEpoch = this.epoch || 0; this.cancelVoice = false; this.recorder.start({ duration: 60000, format: 'mp3', sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000 }); },
    cancelRecording() { this.cancelVoice = true; if (this.recorder)
        this.recorder.stop(); },
    showAgents() { this.setData({ sheet: 'Agent 工作状态', sheetItems: this.data.agents.map(a => ({ id: a.role, title: a.label, subtitle: a.statusLabel + ' · ' + (a.currentTask || '当前无活跃任务') })) }); }
});
