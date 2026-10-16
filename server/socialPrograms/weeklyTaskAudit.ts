import type { DataStore } from '../storage/datastore.js';
import type { WeeklyExecutionTask } from '../../shared/contracts/socialProgram.js';
import { readWeeklyCustomerChannelReadiness } from '../runtime/socialWeeklyCustomerChannelAdapter.js';
import { readWeeklyPreproductionExecutionGate } from '../runtime/weeklyPreproductionProducer.js';
import { readCustomerMessagingAuthorization } from '../digitalEmployees/customerMessagingPolicy.js';
import { readWeeklyExistingFactSource } from './weeklyExistingFactSource.js';
import { WEEKLY_WHATSAPP_MOCK_RUNS } from './weeklyWhatsAppMock.js';
import { socialRequestHash } from '../starter198/socialContentValidation.js';
import { socialJson, socialObject } from '../starter198/socialContentValidation.js';
import type { EnterpriseProfile } from '../routes/enterprise.js';
import { weeklyTaskRequirements } from './weeklyTaskRequirements.js';
export function weeklyBlockerAction(code: string, task?: WeeklyExecutionTask) {
    if (code === 'weekly_candidate_context_required')
        return { label: '已有真实视频及分镜；请为此候选选择已有商品与目标受众，绑定可信资料，不必重填产品、不重新分析视频。未选择前不推断商品身份或开启制作', action: 'candidate_analysis', userRequired: true };
    if (code === 'weekly_candidate_context_review_required')
        return { label: '已有商品上下文已留痕，但相关性、复刻资源或素材映射尚无充分证据；系统需完成真实适配评估，缺值不是低分，不要求用户直接批准通过，不重采集或重复计费', action: 'candidate_analysis', userRequired: false };
    if (code === 'model_unavailable')
        return { label: '原候选视频已保留，但当前分析模型不存在或账号/地域不可访问；需核验模型配置，不重采集、不把元数据当交付，也不重新提交未知请求，历史费用保留', action: 'candidate_analysis', userRequired: false };
    const channelValue = task?.inputSnapshot.customerChannel;
    const channel = channelValue === 'whatsapp' ? 'WhatsApp' : channelValue === 'messenger' ? 'Messenger' : channelValue === 'instagram' ? 'Instagram' : /whatsapp/.test(code) ? 'WhatsApp' : /messenger/.test(code) ? 'Messenger' : /instagram/.test(code) ? 'Instagram' : '当前渠道';
    if (['weekly_candidate_analysis_pending', 'weekly_candidate_analysis_unavailable'].includes(code))
        return { label: '原采集 attempt 已有候选，等待后台对原候选下载、分析并核验；不重采集、不增加采集额度，未知分析费用保留', action: 'candidate_analysis', userRequired: false };
    if (['weekly_candidate_analysis_original_receipt_pending', 'original_receipt_pending'].includes(code))
        return { label: '原候选分析已提交但回执尚未核清，等待核验原请求；不得重新发送或再次计费，费用未知占用保留', action: 'candidate_analysis', userRequired: false };
    if (['weekly_candidate_analysis_review_required', 'analysis_review_required'].includes(code))
        return { label: '原 attempt 已有候选，需在灵感中心核对该候选的真实分析与审核要求；不能用补授权或重采集冒充分析通过，未知费用保留', action: 'candidate_analysis', userRequired: true };
    if (['weekly_candidate_quality_insufficient', 'quality_insufficient'].includes(code))
        return { label: '原候选分析质量不足，请查看真实分析结果与不足项；未达到标准不能交付下游，不自动重采集、提高额度或释放未知费用', action: 'candidate_analysis', userRequired: true };
    if (['weekly_candidate_source_scope_changed', 'weekly_candidate_owned_media_changed', 'weekly_candidate_reassessment_source_changed'].includes(code))
        return { label: '原候选范围或媒体证据已变化，系统需核对原来源与分析回执；不能借用其他候选或重发未知分析请求，原费用保留', action: 'candidate_analysis', userRequired: false };
    if (['provider_budget_exhausted', 'weekly_preproduction_provider_budget_exhausted'].includes(code))
        return { label: '采集服务额度不足，需要补充服务额度或配置可用采集服务；已请求的每日采集数量及未知费用占用保留，不重填企业产品资料、不生成模拟采集结果', action: 'collection_service', userRequired: false };
    if (code === 'downloader_missing')
        return { label: '原 attempt 已有候选，但本机缺少视频下载组件 yt-dlp，需系统配置后恢复原候选分析；不是企业资料缺失或视频永久不可用，未知请求不得重复提交', action: 'candidate_analysis', userRequired: false };
    if (code === 'provider_authorization_required')
        return { label: '采集服务凭据失效或未配置，需恢复对应服务连接；不是社媒发布或客服消息授权', action: 'collection_service', userRequired: false };
    if (code === 'source_rate_limited')
        return { label: '采集来源限流，系统需按原运行核验回执与退避恢复，不重复提交未知请求', action: 'collection_service', userRequired: false };
    if (code === 'source_media_unavailable')
        return { label: '原候选的真实视频暂不可用，请在灵感中心核对原参考与可访问媒体；仅元数据不算分析交付，不重采集或释放未知费用', action: 'candidate_analysis', userRequired: true };
    if (code === 'source_failed')
        return { label: '原采集运行失败，需核验具体来源回执后恢复；已有记录和费用保留', action: 'collection_service', userRequired: false };
    if (/rights|license/.test(code))
        return { label: '补充当前步骤实际使用素材的来源与使用权证明，不影响其他独立分支', action: 'enterprise_products', userRequired: true };
    if (code === 'weekly_existing_facts_hash_changed')
        return { label: '已有企业与产品资料的版本不一致，需在知识库核对后保存；不必重新录入全部产品', action: 'enterprise_facts', userRequired: true };
    if (/confirmed_facts|enterprise_facts|existing_facts/.test(code))
        return { label: '核对企业知识库中的真实企业与产品资料', action: 'enterprise_facts', userRequired: true };
    if (/business_goal|outline_goal/.test(code))
        return { label: '生产目标绑定尚未恢复；需将真实转化入口门禁限定到对外发送分支，不要求为内容生产提前授权 WhatsApp', action: 'technical_recovery', userRequired: false };
    if (code==='conversion_route_required')
        return {label:'正式对外联系前补充真实转化入口；Mock 不能作为真实联系地址',action:'channel',userRequired:true};
    if (/provider_not_ready|configuration_inactive|customer_agent_not_enabled|background_worker_disabled|customer.*binding_missing|customer.*run_missing/.test(code))
        return { label: `${channel} 真实执行配置或消费者待系统恢复；不要求重新批准默认模板`, action: 'technical_recovery', userRequired: false };
    if (/authorization|not_authorized|provider_not_ready|account_not_ready|whatsapp_not_configured/.test(code))
        return { label: `${channel} 真实分支需补充账号连接及消息权限；不影响独立 Mock 或内容生产`, action: 'channel', userRequired: true };
    if (/initial_capacity|business_dispatch|preproduction_authority|capacity_plan|automation_policy|metric_targets_required/.test(code))
        return { label: '由系统采用已确认模板并恢复排期、绑定或派单，不要求重复确认默认值', action: 'technical_recovery', userRequired: false };
    if(code==='fact_refs_required')return {label:'绑定已有可信企业与产品资料；只在来源缺失或版本不一致时要求补充',action:'enterprise_facts',userRequired:false};
    return { label: code, action: 'production', userRequired: classifyWeeklyBlocker(code) === 'user_input' };
}
export function classifyWeeklyBlocker(code: string): 'user_input' | 'technical' | 'upstream' {
    if (code === 'weekly_candidate_context_required') return 'user_input';
    if (code.startsWith('upstream:'))
        return 'upstream';
    if (['weekly_candidate_analysis_review_required', 'analysis_review_required', 'weekly_candidate_quality_insufficient', 'quality_insufficient'].includes(code)) return 'user_input';
    if (/^weekly_candidate_/.test(code) || code === 'original_receipt_pending') return 'technical';
    if (['provider_budget_exhausted', 'weekly_preproduction_provider_budget_exhausted'].includes(code)) return 'technical';
    if (['model_unavailable', 'downloader_missing', 'provider_authorization_required', 'source_rate_limited', 'source_failed'].includes(code)) return 'technical';
    if (code === 'source_media_unavailable') return 'user_input';
    if (/provider_not_ready|configuration_inactive|customer_agent_not_enabled|background_worker_disabled|customer.*binding_missing|customer.*run_missing/.test(code))return 'technical';
    if(/initial_capacity|business_dispatch|preproduction_authority|capacity_plan|automation_policy|metric_targets_required|fact_refs_required|business_goal_unavailable|outline_goal_not_ready/.test(code))return 'technical';
    if (/required|unavailable|not_authorized|not_approved|not_ready|binding_missing|account_ambiguous|business_dispatch|business_goal|capacity_plan|automation_policy|configuration_inactive|customer_agent_not_enabled/.test(code) && !/worker|adapter|storage|consumer/.test(code))
        return 'user_input';
    return 'technical';
}
/** Read-only audit of every durable node, not the merged calendar cards. No provider calls. */
export async function auditWeeklyTasks(store: DataStore, tasks: WeeklyExecutionTask[]) {
    const byId = new Map(tasks.map(t => [t.taskId, t])), observed = new Map<string, string[]>();
    const preproductionEvidence=new Map<string,Awaited<ReturnType<typeof readWeeklyPreproductionExecutionGate>>>();
    const factGaps = new Map<string, string>();
    const profiles = new Map<string, EnterpriseProfile | null>();
    const channels = new Map<string, Awaited<ReturnType<typeof readCustomerMessagingAuthorization>>>();
    for (const task of tasks) {
        if (!profiles.has(task.tenantId)) {
            const found = await store.list<any>('tenant_profiles', { where: { tenant_id: task.tenantId }, perPage: 2 });
            profiles.set(task.tenantId, found.totalItems === 1 && found.items.length === 1 && found.items[0].tenant_id === task.tenantId ? socialObject(socialJson(found.items[0].profile)) as unknown as EnterpriseProfile : null);
        }
        const codes = [...task.ownBlockingReasons];
        if (['business_outline', 'benchmark_collection', 'material_preparation', 'material_readiness', 'script', 'storyboard', 'asset_generation', 'video_generation'].includes(task.schedule.stepKind) && !['succeeded', 'cancelled'].includes(task.status)) {
            if (!factGaps.has(task.tenantId)) {
                try {
                    await readWeeklyExistingFactSource(store, task.tenantId);
                    factGaps.set(task.tenantId, '');
                }
                catch (e) {
                    factGaps.set(task.tenantId, e && typeof e === 'object' && 'code' in e ? String(e.code) : 'weekly_existing_facts_unverified');
                }
            }
            const gap = factGaps.get(task.tenantId)!;
            // Keep the durable historical error intact; the current read-model
            // must not ask the user to repair a hash that is now verified.
            if (!gap) {
                for (let i = codes.length - 1; i >= 0; i--) if (['weekly_existing_facts_hash_changed', 'weekly_existing_facts_unverified'].includes(codes[i]!)) codes.splice(i, 1);
            }
            if (gap && !codes.includes(gap))
                codes.push(gap);
        }
        if (task.lastError && !codes.includes(task.lastError.code) && !(factGaps.get(task.tenantId) === '' && ['weekly_existing_facts_hash_changed', 'weekly_existing_facts_unverified'].includes(task.lastError.code)))
            codes.push(task.lastError.code);
        if (['business_outline', 'benchmark_collection'].includes(task.schedule.stepKind) && task.status!=='cancelled') {
            const gate = await readWeeklyPreproductionExecutionGate(store, task);
            preproductionEvidence.set(task.taskId,gate);
            if (task.status!=='succeeded'&&!gate.ready && gate.code && !codes.includes(gate.code))
                codes.push(gate.code);
        }
        if (task.schedule.stepKind === 'customer_channel_readiness' && !['succeeded', 'cancelled'].includes(task.status)) {
            const channel = task.inputSnapshot.customerChannel;
            if (channel === 'whatsapp' || channel === 'messenger' || channel === 'instagram') {
                const key = `${task.tenantId}:${channel}`;
                if (!channels.has(key))
                    channels.set(key, await readCustomerMessagingAuthorization(task.tenantId, channel, { dataStore: store }));
                for (const code of channels.get(key)!.reasons)
                    if (!codes.includes(code))
                        codes.push(code);
            }
            try {
                await readWeeklyCustomerChannelReadiness(store, task);
            }
            catch (e) {
                const code = e instanceof Error ? e.message : 'weekly_customer_channel_unavailable';
                if (!codes.includes(code))
                    codes.push(code);
            }
        }
        observed.set(task.taskId, codes);
    }
    const memo = new Map<string, Array<{
        taskId: string;
        code: string;
        category: ReturnType<typeof classifyWeeklyBlocker>;
    }>>();
    function roots(id: string, path = new Set<string>()): Array<{
        taskId: string;
        code: string;
        category: ReturnType<typeof classifyWeeklyBlocker>;
    }> {
        if (path.has(id))
            return [{ taskId: id, code: 'weekly_dependency_cycle', category: 'technical' }];
        if (memo.has(id))
            return memo.get(id)!;
        const task = byId.get(id);
        if (!task)
            return [{ taskId: id, code: 'weekly_dependency_missing', category: 'technical' }];
        if (task.status === 'succeeded')
            return [];
        const next = new Set(path).add(id), out = (observed.get(id) ?? []).map(code => ({ taskId: id, code, category: classifyWeeklyBlocker(code) }));
        for (const parent of task.dependsOnTaskIds)
            out.push(...roots(parent, next));
        const result = [...new Map(out.map(v => [`${v.taskId}:${v.code}`, v])).values()];
        memo.set(id, result);
        return result;
    }
    const items = await Promise.all(tasks.map(async (t) => {
        const records = t.inputSnapshot.customerChannel === 'whatsapp' ? await store.list<any>(WEEKLY_WHATSAPP_MOCK_RUNS, { where: { tenant_id: t.tenantId, program_id: t.programId, package_id: t.packageId, package_version: t.packageVersion, task_id: t.taskId }, perPage: 2 }) : null;
        const p = records?.items[0]?.payload;
        const mock = p && records?.totalItems === 1 && p.scope.consumerTaskId === t.taskId && p.scope.consumerInputHash === socialRequestHash(t.inputSnapshot) && p.simulated === true && p.realAuthorization === false && p.businessDelivery === false && p.recordHash === socialRequestHash({ ...p, recordHash: '' }) ? { status: p.status, createdAt: p.createdAt, realAuthorization: false, businessDelivery: false } : null;
        const requiredActions = roots(t.taskId).map(reason => ({ code: reason.code, taskId: reason.taskId, channel: byId.get(reason.taskId)?.inputSnapshot.customerChannel ?? null, ...weeklyBlockerAction(reason.code, byId.get(reason.taskId)) }));
        const currentPreproduction=preproductionEvidence.get(t.taskId)??null;
        return { taskId: t.taskId, step: t.schedule.stepKind, actor: t.schedule.responsibleActor, channel: t.inputSnapshot.customerChannel ?? null, date: typeof t.inputSnapshot?.calendarAssignmentDate === 'string' ? t.inputSnapshot.calendarAssignmentDate : null, status: t.status, attempt: t.attempt, scheduledStartAt: t.schedule.estimatedStartAt, actualStartedAt: t.schedule.actualStartedAt, lastObservedAt: t.lastError?.occurredAt ?? null, resultRefs: t.resultRefs, ownReasons: (observed.get(t.taskId) ?? []).map(code => ({ code, category: classifyWeeklyBlocker(code) })), waitingFor: t.dependsOnTaskIds.filter(id => byId.get(id)?.status !== 'succeeded'), rootCauses: roots(t.taskId), requiredActions, requirementDiagnostics: weeklyTaskRequirements(t, profiles.get(t.tenantId) ?? null), whatsappMock: mock,currentPreproduction };
    }));
    const byStep: Record<string, {
        total: number;
        statuses: Record<string, number>;
    }> = {}, rootCounts: Record<string, number> = {};
    for (const item of items) {
        const step = byStep[item.step] ??= { total: 0, statuses: {} };
        step.total++;
        step.statuses[item.status] = (step.statuses[item.status] ?? 0) + 1;
        for (const code of new Set(item.rootCauses.map(r => r.code)))
            rootCounts[code] = (rootCounts[code] ?? 0) + 1;
    }
    return { auditedAt: new Date().toISOString(), total: items.length, byStep, rootCounts, items };
}
