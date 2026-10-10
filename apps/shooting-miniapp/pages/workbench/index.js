const api = require('../../lib/api');
const model = require('../../lib/workbench');
const starter = require('../../lib/starter');
const demo = require('../../lib/workbench-demo');
Page({
    data: { loggedIn: false, email: '', password: '', userName: '', tab: 'work', loading: false, error: '', week: model.week(), selectedDay: model.day(new Date().toISOString()), overview: {}, tasks: [], agents: [], posts: [], calendarItems: [], matters: [], snoozed: [], activeMatter: null, cardX: 0, swipeDirection: '', swipeReady: false, swipeLabel: '', metrics: [], dayPosts: [], sheet: null, sheetItems: [], detail: null, processing: false, assistantMode: 'chat', messages: [], input: '', sending: false, recording: false, transcribing: false, offline: false, suggestions: ['这周还有哪些任务没完成？', '哪条视频需要我处理？', '今天有哪些新询盘？'], notifications: [], chatAnchor: '' },
    onLoad() { this.networkListener = r => this.setData({ offline: !r.isConnected }); if (wx.onNetworkStatusChange) wx.onNetworkStatusChange(this.networkListener); if (wx.getNetworkType) wx.getNetworkType({success:r=>this.setData({offline:r.networkType === 'none'})}); if (api.token())
        this.restore(); },
    onShow() { if (!api.token()) { if (this.data.loggedIn) this.signOut(); return; } if (this.data.loggedIn) { this.startSync(); this.refresh(); } },
    startSync() { if (this.syncTimer) clearInterval(this.syncTimer); this.syncTimer = setInterval(() => { if (this.data.loggedIn && !this.data.processing && !this.data.recording && !this.data.sending && !this.refreshing) this.refresh(); }, 30000); },
    stopSync() { if (this.syncTimer) clearInterval(this.syncTimer); this.syncTimer = null; },
    onHide() { this.stopSync(); if (this.recorder && this.data.recording) {
        this.cancelVoice = true;
        this.recorder.stop();
    } },
    onUnload() { if (wx.offNetworkStatusChange && this.networkListener) wx.offNetworkStatusChange(this.networkListener); this.stopSync(); this.disposed = true; this.epoch = (this.epoch || 0) + 1; if (this.recorder && this.data.recording) {
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
    session(s) { this.epoch = (this.epoch || 0) + 1; this.setData({tab:'work', detail:null, sheet:null, messages:[], matters:[], snoozed:[], activeMatter:null, tasks:[], agents:[], metrics:[], notifications:[], calendarItems:[], posts:[], dayPosts:[], input:'', processing:false, sending:false, transcribing:false}); this.workspaceKind = null; const user = s.user || {}; this.scope = String(user.tenantId || user.tenant_id || '') + ':' + String(user.id || user.email || ''); this.chatKey = 'mobile-chat:' + this.scope; this.snoozes = {}; this.setData({ loggedIn: true, userName: user.name || user.email || '', password: '', messages: wx.getStorageSync(this.chatKey) || [] }); this.startSync(); },
    async restore() { const epoch = this.epoch || 0; try {
        const s = await api.me();
        if (epoch !== (this.epoch || 0) || this.disposed) return;
        this.session(s);
        await this.refresh();
    }
    catch (e) {
        if (epoch === (this.epoch || 0)) this.setData({ error: e.message, loggedIn: false });
    } },
    signOut() { if (this.data.recording && this.recorder) { this.cancelVoice = true; this.recorder.stop(); } this.stopSync(); this.workspaceKind = null; this.inputCommandKey = null; this.actionKey = null; this.actionKeyScope = null; this.epoch = (this.epoch || 0) + 1; api.clearToken(); this.setData({ loggedIn: false, overview: {}, tasks: [], agents: [], posts: [], calendarItems: [], dayPosts: [], metrics: [], matters: [], snoozed: [], activeMatter: null, messages: [], notifications: [], workspaceNote: '', workspaceKind: '', starterWorkspace: null, undoVisible: false, queueAvailable: false, detail: null, sheet: null, userName: '', input: '', error: '', processing:false, sending:false, recording:false, transcribing:false }); },
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
            if (this.workspaceKind === 'demo') { this.loadDemo(); return; }
            if (!this.workspaceKind) { const kind = api.workspaceKind ? await api.workspaceKind() : 'legacy'; if (epoch !== (this.epoch || 0) || this.disposed) return; this.workspaceKind = kind; }
            if (this.workspaceKind === 'starter') {
                const queue = await api.request('starter-198/mobile/queue');
                if (epoch !== (this.epoch || 0) || this.disposed) return;
                this.snoozes = queue.snoozes || {};
                this.setData({ ...starter.project(queue.workspace, this.snoozes), workspaceKind: 'starter', error: '' });
                this.updateDay(); return;
            }
            this.setData({workspaceKind:'legacy',workspaceNote:''});
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
                workflowTaskId: post.taskId, kind: 'post'
            }));
            const calendarItems = posts;
            const allMatters = queue ? model.matters(queue, shooting) : [];
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
            this.setData({ overview, tasks, calendarItems, agents, posts, matters, snoozed, activeMatter: matters[0] || null, metrics, notifications: [], cardX: 0, updatedAt: overview.generatedAt ? new Date(overview.generatedAt).toLocaleTimeString() : new Date().toLocaleTimeString(), error: results[1].status === 'rejected' ? results[1].reason.message : '' });
            this.updateDay();
        }
        catch (e) {
            if (epoch === (this.epoch || 0)) {
                if (!api.token()) this.signOut();
                else if (e.status === 403 && (e.code === 'profile_not_enabled' || /profile_not_enabled/.test(e.message || ''))) this.loadDemo();
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
    loadDemo() { const projection = demo.project(this.data.week); projection.activeMatter = projection.matters[0] || null; this.workspaceKind = 'demo'; this.snoozes = {}; this.setData({...projection,error:'',cardX:0}); this.updateDay(); },
    changeWeek(e) { if (this.data.recording && this.recorder) {this.cancelVoice=true;this.recorder.stop();} this.setData({sending:false,transcribing:false,recording:false}); this.epoch = (this.epoch || 0) + 1; const offset = (this.weekOffset || 0) + Number(e.currentTarget.dataset.offset); this.weekOffset = offset; const week = model.week(Date.now(), offset); this.setData({ week, selectedDay: week.start, posts: [], calendarItems: [], dayPosts: [], tasks: [], metrics: [], matters: [], activeMatter: null, sheet: null, detail: null }); this.refresh(); },
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
        wx.showActionSheet({ itemList: ['1 小时后', '明天上午 9 点'], success: async r => {
            if (epoch !== (this.epoch || 0) || this.disposed) return;
            let until = Date.now() + 3600000;
            if (r.tapIndex === 1) { const tomorrow = new Date(Date.now() + 8 * 3600000); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1); tomorrow.setUTCHours(1, 0, 0, 0); until = tomorrow.getTime(); }
            await this.saveSnooze(item, until);
        } });
    },
    async saveSnooze(item, until) {
        if (this.data.processing) return;
        const epoch = this.epoch || 0;
        this.setData({ processing: true, error: '' });
        try {
            if (this.workspaceKind !== 'demo') await api.request(this.workspaceKind === 'starter' ? 'starter-198/mobile/snooze' : 'mobile-workbench/snooze', 'POST', { matterId: item.id, until });
            if (epoch !== (this.epoch || 0) || this.disposed) return;
            if (until) {
                this.snoozes[item.id] = until; this.lastSnooze = item.id;
                const matters = this.data.matters.filter(i => i.id !== item.id);
                this.setData({ matters, activeMatter: matters[0] || null, snoozed: [...this.data.snoozed.filter(i => i.id !== item.id), item], undoVisible: true });
            } else {
                delete this.snoozes[item.id];
                const matters = model.sortUrgency([...this.data.matters.filter(i => i.id !== item.id), item]);
                this.setData({ matters, activeMatter: matters[0] || null, snoozed: this.data.snoozed.filter(i => i.id !== item.id), undoVisible: false });
            }
        } catch (e) { if (epoch === (this.epoch || 0)) this.setData({ error: e.message }); }
        finally { if (epoch === (this.epoch || 0) && !this.disposed) this.setData({ processing: false }); }
    },
    async undoSnooze() { const item = this.data.snoozed.find(i => i.id === this.lastSnooze); if (item) await this.saveSnooze(item, 0); },
    showSnoozed() { this.setData({ sheet: '稍后处理', sheetItems: this.data.snoozed.map(i => ({ ...i, subtitle: i.reason, kind: 'matter' })) }); },
    viewMatter() { if (Date.now() - (this.lastGestureAt || 0) < 400) return; this.processMatter(); },
    processMatter() { const item = this.data.activeMatter; if (!item)
        return; if (item.type === 'starter') { this.setData({detail:{...item.starterItem,title:item.title,reason:item.reason,starter:true,actions:item.actions},sheet:null}); return; } if (item.type === 'shoot') {
        wx.navigateTo({ url: '/pages/index/index?taskId=' + encodeURIComponent(item.shootingId) });
        return;
    } this.setData({ detail: { ...item.task, title: item.title, reason: item.reason, approval: item.approval, type: item.type }, sheet: null }); this.loadTaskEvents(item.task); },
    openTask(e) { const task = this.data.tasks.find(t => t.id === e.currentTarget.dataset.id); if (task) {
        this.setData({ detail: task });
        if (!task.starter) this.loadTaskEvents(task);
    } },
    openNotification(e) { const event = this.data.notifications.find(i => i.id === e.currentTarget.dataset.id); if (event?.task_id)
        this.openTask({ currentTarget: { dataset: { id: event.task_id } } }); },
    openShooting() { if (this.workspaceKind === 'starter') { this.setData({error:'素材补拍需通过对应内容任务入口。'}); return; } wx.navigateTo({ url: '/pages/index/index' }); },
    async openMetric(e) { if (this.workspaceKind === 'starter') { this.setData({sheet:'当前周期工作记录（周统计尚未提供）',sheetItems:this.data.tasks.map(t=>({...t,subtitle:t.statusLabel,kind:'task'}))}); return; } const key = e.currentTarget.dataset.key; if (key === 'tasks' || key === 'completed')
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
        if (!task?.run_id || this.workspaceKind === 'demo') return;
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
    async decideApproval(e) { if (this.data.processing || !this.data.detail?.approval)
        return; const a = this.data.detail.approval; const decision = e.currentTarget.dataset.decision; const epoch = this.epoch || 0; wx.showModal({ title: decision === 'approved' ? '确认批准此事项？' : '退回此事项？', content: a.action_summary, success: async (r) => { if (!r.confirm || epoch !== (this.epoch || 0) || this.disposed)
            return; this.setData({ processing: true }); try {
            if (this.workspaceKind !== 'demo') await this.submitWorkbenchAction('approval_decision', a.id, a.subject_version || a.version || a.updated_at, { decision, note: '移动工作台确认' });
            if (epoch !== (this.epoch || 0) || this.disposed) return;
            if (this.workspaceKind === 'demo') { const matters=this.data.matters.filter(i=>i.id!=='approval:'+a.id); this.setData({detail:null,matters,activeMatter:matters[0]||null}); wx.showToast({title:decision==='approved'?'已批准（演示）':'已退回（演示）',icon:'none'}); }
            else { this.setData({ detail: null }); await this.refresh(); }
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
            if (this.workspaceKind !== 'demo') await this.submitWorkbenchAction('retry_task', task.id, task.task_version || task.version || task.updated_at, { instruction: '重试当前任务并重置下游', rerunDownstream: true });
            if (epoch !== (this.epoch || 0) || this.disposed) return;
            this.setData({ detail: null });
            if (this.workspaceKind === 'demo') { const matters=this.data.matters.filter(i=>i.id!=='task:'+task.id); this.setData({matters,activeMatter:matters[0]||null}); }
            else await this.refresh();
            wx.showToast({ title: this.workspaceKind === 'demo' ? '已重试（演示）' : '已提交恢复请求', icon: 'none' });
        }
        catch (e) {
            if (epoch === (this.epoch || 0)) this.setData({ error: e.message });
        }
        finally {
            if (epoch === (this.epoch || 0)) this.setData({ processing: false });
        } } }); },
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
    switchAssistant(e) { this.setData({ assistantMode: e.currentTarget.dataset.mode }); }, inputText(e) { this.inputCommandKey = null; this.setData({ input: e.detail.value }); }, askSuggestion(e) { this.setData({ input: e.currentTarget.dataset.text }); this.send(); },
    async send() { const input = this.data.input.trim(); if (!input || this.data.sending)
        return; const epoch = this.epoch || 0; const messages = [...this.data.messages, { id: 'm' + Date.now(), role: 'user', content: input }]; this.setData({ messages, input: '', sending: true, error: '' }); try {
        const context = JSON.stringify({ week: this.data.week, metrics: this.data.metrics, tasks: this.data.tasks, agents: this.data.agents });
        const answer = this.workspaceKind === 'starter' ? starter.answer(this.data.starterWorkspace, input) : this.workspaceKind === 'demo' ? demo.answer(input) : await api.chat([{ role: 'user', content: '以下为当前账号工作数据，仅据此回答实际进度；未提供数据明确说未知；任何执行请求仅提出操作建议，不宣称已执行。\n' + context }, ...messages.slice(-12).map(m => ({ role: m.role, content: m.content }))]);
        if (epoch !== (this.epoch || 0) || this.disposed)
            return;
        this.inputCommandKey = null;
        const next = [...messages, { id: 'm' + Date.now(), role: 'assistant', content: answer }];
        this.setData({ messages: next, chatAnchor: next[next.length - 1].id });
        wx.setStorageSync(this.chatKey, next.slice(-40));
    }
    catch (e) {
        if (epoch === (this.epoch || 0))
            this.setData({ error: e.message, input });
    }
    finally {
        if (epoch === (this.epoch || 0) && !this.disposed)
            this.setData({ sending: false });
    } },
    submitInstruction() {
        const input = this.data.input.trim();
        if (!input || this.data.sending || this.data.offline || this.workspaceKind !== 'starter') return;
        const epoch = this.epoch || 0;
        wx.showModal({title:'提交工作指令？',content:'这会交给后台 Agent 推进工作；没有工作周期时可能启动新周期。请核对：' + input,success:async r=>{
            if (!r.confirm || epoch !== (this.epoch || 0) || this.disposed) return;
            this.setData({sending:true,error:''});
            try {
                const result = await api.command({command:'submit_orchestrator_input',idempotencyKey:this.inputCommandKey || (this.inputCommandKey='mobile-input-'+Date.now()+'-'+Math.random().toString(36).slice(2)),payload:{input}});
                if (epoch !== (this.epoch || 0) || this.disposed) return;
                this.inputCommandKey=null;
                const messages=[...this.data.messages,{id:'u'+Date.now(),role:'user',content:input},{id:'a'+Date.now(),role:'assistant',content:result.message || '工作指令已提交，正在同步后台状态。'}];
                this.setData({messages,input:'',chatAnchor:messages[messages.length-1].id});
                wx.setStorageSync(this.chatKey,messages.slice(-40));
                await this.refresh();
            } catch(e) {if(epoch === (this.epoch || 0))this.setData({error:e.message});}
            finally {if(epoch === (this.epoch || 0) && !this.disposed)this.setData({sending:false});}
        }});
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
            const result = await api.request(this.workspaceKind === 'starter' ? 'starter-198/mobile/transcribe' : 'mobile-workbench/transcribe', 'POST', { audio });
            if (epoch === (this.epoch || 0) && !this.disposed)
                this.setData({ input: result.text });
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
