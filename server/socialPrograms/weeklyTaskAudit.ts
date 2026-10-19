import type { DataStore } from '../storage/datastore.js';
import type { WeeklyExecutionTask } from '../../shared/contracts/socialProgram.js';
import { readWeeklyCustomerChannelReadiness } from '../runtime/socialWeeklyCustomerChannelAdapter.js';
import { readWeeklyPreproductionExecutionGate, listWeeklyPreproductionJobs } from '../runtime/weeklyPreproductionProducer.js';
import { WEEKLY_CANDIDATE_POSTANALYSIS_PROGRESS, type WeeklyCandidatePostAnalysisProgress } from '../runtime/weeklyCandidatePostAnalysis.js';
import { readCustomerMessagingAuthorization } from '../digitalEmployees/customerMessagingPolicy.js';
import { readWeeklyExistingFactSource } from './weeklyExistingFactSource.js';
import { WEEKLY_WHATSAPP_MOCK_RUNS } from './weeklyWhatsAppMock.js';
import { socialRequestHash } from '../starter198/socialContentValidation.js';
import { socialJson, socialObject } from '../starter198/socialContentValidation.js';
import type { EnterpriseProfile } from '../routes/enterprise.js';
import { weeklyTaskRequirements } from './weeklyTaskRequirements.js';
import {readWeeklyCtaContact} from './weeklyCtaContact.js';
import {readWeeklyPublicationProductSelectionChoices} from './weeklyPublicationProductSelection.js';
import {readWeeklyAutomationTemplate} from './weeklyAutomationTemplate.js';
const CONTENT_FOOTAGE_BLOCKERS=new Set(['weekly_product_footage_required','product_footage_shot_review_required','product_footage_material_unreadable','product_footage_bytes_changed']);
const CONTENT_VOICE_BLOCKER=/^user_input_required:(weekly_default_voice_(?:registry_missing|identity_missing|authorization_missing:[^\s:]+|source_missing|source_mismatch|binding_missing|binding_mismatch)|multiple_presenter_voices_require_separate_audio_tracks)$/;
async function currentContentInterventionBlocker(store:DataStore,task:WeeklyExecutionTask):Promise<string|null>{
    if(!task.publicationTaskId||!['material_preparation','material_readiness','script','storyboard','asset_generation','video_generation','quality_check'].includes(task.schedule.stepKind))return null;
    const key=`weekly-production:${task.packageId}:${task.packageVersion}:${task.publicationTaskId}`;
    const content=await store.list<import('../storage/datastore.js').Record_>('starter_social_content_tasks',{where:{tenant_id:task.tenantId,create_idempotency_key:key},perPage:2});
    if(content.totalItems!==1||content.items.length!==1)return null;
    const row=content.items[0]!,contentTaskId=String(row.task_id||''),runId=String(row.run_id||'');
    if(!contentTaskId||!runId||!['paused','attention','needs_input','producing'].includes(String(row.status)))return null;
    const jobs=await store.list<import('../storage/datastore.js').Record_>('content_execution_jobs',{where:{tenant_id:task.tenantId,task_id:contentTaskId,run_id:runId},perPage:2});
    if(jobs.totalItems!==1||jobs.items.length!==1)return null;
    const job=jobs.items[0]!,error=String(job.last_error||'');
    if(job.status!=='blocked'||!String(job.task_type||'').startsWith('social_content_weekly'))return null;
    const code=[...CONTENT_FOOTAGE_BLOCKERS].find(candidate=>error===candidate||error.endsWith(`:${candidate}`));
    return code??CONTENT_VOICE_BLOCKER.exec(error)?.[1]??null;
}
export function weeklyBlockerAction(code: string, task?: WeeklyExecutionTask) {
    if(code==='weekly_product_footage_required'||code==='product_footage_shot_review_required')
        return {label:'当前样片的具体产品镜头缺少已核验同品实拍；进入原任务详情补充候选，上传本身不等于审核通过',action:'product_footage',userRequired:true};
    if(code==='product_footage_material_unreadable'||code==='product_footage_bytes_changed')
        return {label:'当前样片已绑定的同品实拍字节无法复核或发生变化；系统须核对原素材与回执，不要求提前上传另一段视频',action:'technical_recovery',userRequired:false};
    if(code.startsWith('weekly_default_voice_authorization_missing:'))
        return {label:'当前样片实际使用的默认人物声音缺少企业授权；进入原任务详情核对该人物与声音绑定，不静默换人或换声',action:'presenter_voice',userRequired:true};
    if(['weekly_default_voice_identity_missing','weekly_default_voice_source_missing','weekly_default_voice_binding_missing'].includes(code))
        return {label:'当前样片已进入人物声音阶段，但默认人物、声音来源或正式绑定缺失；进入原任务详情补齐实际资产',action:'presenter_voice',userRequired:true};
    if(['weekly_default_voice_registry_missing','weekly_default_voice_source_mismatch','weekly_default_voice_binding_mismatch','multiple_presenter_voices_require_separate_audio_tracks'].includes(code))
        return {label:'当前样片的人物声音登记、绑定或音轨规划不一致；系统须核对原资产和冻结计划，不要求用户重复上传',action:'technical_recovery',userRequired:false};
    if(code==='weekly_preproduction_original_submitted_unknown_no_replay')return {label:'原账号五条采集请求已提交，但供应商结果未知；系统仅核对原操作与账单，禁止再次提交或购买',action:'technical_recovery',userRequired:false};
    if(code==='weekly_preproduction_original_accepted_needs_get')return {label:'原账号五条采集请求已有接受回执；系统须沿原 run 核对数据集与视频，不得重新提交或购买',action:'technical_recovery',userRequired:false};
    if(code==='weekly_postanalysis_canonical_media_intervention_required')
        return {label:'原候选缺少可核验的规范视频定位；需系统从原采集回执补齐下载与本地媒体绑定，不要求企业上传一段未知的对标视频，也不能将元数据当作成片参考',action:'technical_recovery',userRequired:false};
    if(code==='weekly_postanalysis_canonical_evidence_intervention_required')
        return {label:'规范视频定位存在，但真实字节、哈希或来源回执尚未核验；需系统恢复原媒体证据，不重新购买或冒充分析完成',action:'technical_recovery',userRequired:false};
    if(code==='weekly_postanalysis_exact_analysis_authorization_required')
        return {label:'原视频精析尚缺独立费用授权与可核验执行合同；当前任务卡没有对应确认入口，需系统接线后再由用户明确授权，不能借用采集或语义精析预算',action:'technical_recovery',userRequired:false};
    if(code==='weekly_postanalysis_exact_analysis_original_receipt_pending')
        return {label:'原视频精析请求的供应商结果仍待对账；系统只能核验原请求，不能重提、重复计费或把未知结果当作通过',action:'technical_recovery',userRequired:false};
    if(code==='candidate_context_semantic_budget_authorization_required')
        return {label:'候选上下文已准备，语义精析尚缺独立的人民币费用授权；当前周任务卡尚未接入可核验的额度确认入口，系统须先接线，授权前不得付费请求',action:'technical_recovery',userRequired:false};
    if(code.startsWith('weekly_candidate_semantic_budget_'))
        return {label:'语义精析预算合同或原付费请求需系统核验；保留原费用占用，不要求用户上传素材或重复签发',action:'technical_recovery',userRequired:false};
    if (code === 'daily_collection_limit_reached')
        return { label: '原采集运行对应业务日的已授权额度已耗尽；保留原采集与费用记录，不自动跨日补采、重试或要求重填企业资料', action: 'collection_service', userRequired: false };
    if (code === 'weekly_preproduction_collection_credentials_required')
        return { label: '采集受阻／待干预：在安全配置入口绑定采集服务凭据；任务卡不收集密钥，也不会自动重提未知供应商请求', action: 'collection_service', userRequired: true };
    if(code==='weekly_preproduction_collection_budget_authorization_required')
        return {label:'采集受阻／待干预：明确批准本周账号采集的人民币费用上限；条数配额、单片预算和账户余额均不能代替付费授权',action:'collection_service',userRequired:true};
    if(code==='weekly_preproduction_collection_cost_ceiling_unverified')
        return {label:'采集受阻／待干预：系统须核验当前 Apify Actor 的最坏费用上界并持久化付费预约；仅填写金额不会触发采集',action:'technical_recovery',userRequired:false};
    if(code==='weekly_preproduction_collection_budget_authorization_unverified')
        return {label:'采集预算授权记录或账号范围暂无法核验；系统应读取原签发与撤销状态，不得重新付费提交',action:'technical_recovery',userRequired:false};
    if(code==='weekly_preproduction_collection_dataset_cost_unverified')
        return {label:'Apify 运行后的数据集读取费用尚无可核验上界；系统不得读取或开启新的付费运行',action:'technical_recovery',userRequired:false};
    if (code === 'weekly_qualified_quota_exhausted')
        return { label: '本周仍不足五条互异合格母版，原采集业务日的已授权额度已耗尽；保留原采集与费用记录，不自动跨日补采或冒充已可编导', action: 'collection_service', userRequired: false };
    if (code === 'weekly_qualified_admission_unverified')
        return { label: '本周五条互异合格母版尚未核齐；系统继续核验原候选分析与已授权的同日补采，不把元数据或历史视频冒充合格母版', action: 'candidate_analysis', userRequired: false };
    if (code === 'weekly_production_product_selection_required')
        return { label: '从当前周任务选择实际展示商品；可明确用于全部发布任务，或按母版组逐组选择，不从采集选品或货盘顺序推断', action: 'publication_product', userRequired: true };
    if (code === 'weekly_production_product_selection_read_failed')
        return { label: '发布选品记录或企业商品资料暂无法核验；请系统恢复后重新读取，不要重复签发', action: 'technical_recovery', userRequired: false };
    if (code === 'weekly_production_product_selection_incomplete_group')
        return { label: '同母版组的选品签发中断；请在原任务卡按相同商品恢复缺失回执，补齐前不可生产', action: 'publication_product', userRequired: false };
    if (code === 'weekly_production_product_selection_group_conflict')
        return { label: '同母版组已有互相冲突的产品回执；请系统核验原签发，不得覆盖或继续生产', action: 'technical_recovery', userRequired: false };
    if (code === 'weekly_production_product_selection_pending_operation')
        return { label: '原选品签发操作已落盘但回执缺失；按原商品与原母版组恢复，不能改选或重新发起新操作', action: 'publication_product', userRequired: false };
    if (code === 'weekly_cta_contact_required')
        return { label: '从当前任务卡填写企业 WhatsApp 联系号码；填写只解决联系方式缺项', action: 'cta_contact', userRequired: true };
    if (code === 'weekly_cta_sample_evidence_required')
        return { label: '联系号码已记录；选中商品的免费样品承诺仍待可核验证据，不得用于成片', action: 'sample_policy', userRequired: true };
    if (code === 'weekly_cta_contact_read_failed')
        return { label: 'CTA 联系记录暂无法核验；请等待系统恢复并重新读取，不要重复填写号码', action: 'technical_recovery', userRequired: false };
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
    if(code==='weekly_product_footage_required'||code==='product_footage_shot_review_required')return 'user_input';
    if(code==='product_footage_material_unreadable'||code==='product_footage_bytes_changed')return 'technical';
    if(code.startsWith('weekly_default_voice_authorization_missing:')||['weekly_default_voice_identity_missing','weekly_default_voice_source_missing','weekly_default_voice_binding_missing'].includes(code))return 'user_input';
    if(['weekly_default_voice_registry_missing','weekly_default_voice_source_mismatch','weekly_default_voice_binding_mismatch','multiple_presenter_voices_require_separate_audio_tracks'].includes(code))return 'technical';
    if(['weekly_postanalysis_canonical_media_intervention_required','weekly_postanalysis_canonical_evidence_intervention_required','weekly_postanalysis_exact_analysis_authorization_required','weekly_postanalysis_exact_analysis_original_receipt_pending'].includes(code)||code.startsWith('weekly_candidate_semantic_budget_'))return 'technical';
    if(code==='candidate_context_semantic_budget_authorization_required')return 'technical';
    if (code === 'weekly_preproduction_collection_credentials_required')return 'user_input';
    if(code==='weekly_preproduction_collection_budget_authorization_required')return 'user_input';
    if(code==='weekly_preproduction_collection_cost_ceiling_unverified')return 'technical';
    if(code==='weekly_preproduction_collection_budget_authorization_unverified'||code==='weekly_preproduction_collection_dataset_cost_unverified')return 'technical';
    if (['daily_collection_limit_reached', 'weekly_qualified_quota_exhausted', 'weekly_qualified_admission_unverified'].includes(code))return 'technical';
    if (code === 'weekly_production_product_selection_required')return 'user_input';
    if (code === 'weekly_production_product_selection_read_failed')return 'technical';
    if (code === 'weekly_production_product_selection_incomplete_group')return 'technical';
    if (code === 'weekly_production_product_selection_group_conflict')return 'technical';
    if (code === 'weekly_production_product_selection_pending_operation')return 'technical';
    if (code === 'weekly_cta_contact_read_failed')return 'technical';
    if (code==='weekly_cta_contact_required'||code==='weekly_cta_sample_evidence_required')return 'user_input';
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
/** Read-only candidate detail for the current, signed producer attempt only.
 * A stale attempt or a partial page must never become a user instruction. */
async function currentPostAnalysisBlockers(store:DataStore,task:WeeklyExecutionTask,jobId:string):Promise<string[]>{
    const jobs=await listWeeklyPreproductionJobs({store,tenantId:task.tenantId,programId:task.programId,packageId:task.packageId,packageVersion:task.packageVersion});
    const job=jobs.find(item=>item.jobId===jobId&&item.activeForConsumer&&item.consumerTaskId===task.taskId&&item.status==='blocked');
    const runRefs=job?.resultRefs.filter(ref=>ref.type==='social_discovery_run')??[];
    if(runRefs.length!==1)return [];
    const rows=await store.list<import('../storage/datastore.js').Record_>(WEEKLY_CANDIDATE_POSTANALYSIS_PROGRESS,{where:{tenant_id:task.tenantId,job_id:jobId,run_id:runRefs[0]!.id},perPage:20});
    if(rows.totalItems!==rows.items.length||rows.totalItems>10)return [];
    const codes:string[]=[];
    for(const row of rows.items){
        const item=row.payload as WeeklyCandidatePostAnalysisProgress;
        if(!item||row.id!==item.id||row.record_hash!==item.recordHash||item.recordHash!==socialRequestHash({...item,recordHash:''})||item.tenantId!==task.tenantId||item.programId!==task.programId||item.packageId!==task.packageId||item.packageVersion!==task.packageVersion||item.jobId!==jobId||item.runId!==runRefs[0]!.id||row.candidate_id!==item.candidateId)return [];
        if(((item.state==='blocked'||item.state==='pending'||item.state==='semantic_pending')&&['weekly_postanalysis_canonical_media_intervention_required','weekly_postanalysis_canonical_evidence_intervention_required','weekly_postanalysis_exact_analysis_authorization_required','weekly_postanalysis_exact_analysis_original_receipt_pending','candidate_context_semantic_budget_authorization_required'].includes(item.code))||(item.state==='blocked'&&item.code.startsWith('weekly_candidate_semantic_budget_')))codes.push(item.code);
    }
    return [...new Set(codes)];
}
/** Read-only audit of every durable node, not the merged calendar cards. No provider calls. */
export async function auditWeeklyTasks(store: DataStore, tasks: WeeklyExecutionTask[]) {
    const byId = new Map(tasks.map(t => [t.taskId, t])), observed = new Map<string, string[]>();
    const preproductionEvidence=new Map<string,Awaited<ReturnType<typeof readWeeklyPreproductionExecutionGate>>>();
    const factGaps = new Map<string, string>();
    const profiles = new Map<string, EnterpriseProfile | null>();
    const channels = new Map<string, Awaited<ReturnType<typeof readCustomerMessagingAuthorization>>>();
    const ctaContacts=new Map<string,Awaited<ReturnType<typeof readWeeklyCtaContact>>|null>();
    const ctaContactReadFailures=new Set<string>();
    const publicationSelections=new Map<string,Awaited<ReturnType<typeof readWeeklyPublicationProductSelectionChoices>>|null>();
    const publicationSelectionReadFailures=new Set<string>();
    for (const task of tasks) {
        const ctaKey=`${task.tenantId}:${task.programId}:${task.packageId}:${task.packageVersion}`;
        const selectionTask=Boolean(task.publicationTaskId&&['material_preparation','material_readiness','script','storyboard','asset_generation','video_generation'].includes(task.schedule.stepKind)&&!['succeeded','cancelled'].includes(task.status));
        if(selectionTask&&!publicationSelections.has(ctaKey)&&!publicationSelectionReadFailures.has(ctaKey)){
            const scope={tenantId:task.tenantId,programId:task.programId,packageId:task.packageId,packageVersion:task.packageVersion};
            try{
                const adopted=await readWeeklyAutomationTemplate(store,scope);
                publicationSelections.set(ctaKey,adopted?await readWeeklyPublicationProductSelectionChoices(store,scope):null);
            }catch{publicationSelectionReadFailures.add(ctaKey);}
        }
        if(!ctaContacts.has(ctaKey)){
            const item=await readWeeklyCtaContact(store,{tenantId:task.tenantId,programId:task.programId,packageId:task.packageId,packageVersion:task.packageVersion}).catch(()=>{ctaContactReadFailures.add(ctaKey);return null;});
            ctaContacts.set(ctaKey,item);
        }
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
        const contentInterventionBlocker=await currentContentInterventionBlocker(store,task);
        if(contentInterventionBlocker&&!codes.includes(contentInterventionBlocker))codes.push(contentInterventionBlocker);
        if(selectionTask){
            const selection=publicationSelections.get(ctaKey);
            const selected=selection?.publications.find(p=>p.publicationTaskId===task.publicationTaskId);
            for(let i=codes.length-1;i>=0;i--)if(['weekly_production_product_selection_required','weekly_production_product_selection_read_failed','weekly_production_product_selection_incomplete_group','weekly_production_product_selection_group_conflict','weekly_production_product_selection_pending_operation'].includes(codes[i]!))codes.splice(i,1);
            if(publicationSelectionReadFailures.has(ctaKey)||selection&&!selected)codes.push('weekly_production_product_selection_read_failed');
            else if(selection&&selected){
                const group=selection.publications.filter(p=>p.motherContentId===selected.motherContentId);
                const signed=[...new Set(group.map(p=>p.selectedProductId).filter(Boolean))];
                if(signed.length>1)codes.push('weekly_production_product_selection_group_conflict');
                else if(group.some(p=>p.pendingOperation))codes.push('weekly_production_product_selection_pending_operation');
                else if(selected.selectedProductId===null)codes.push(signed.length?'weekly_production_product_selection_incomplete_group':'weekly_production_product_selection_required');
            }
        }
        if (['business_outline', 'benchmark_collection'].includes(task.schedule.stepKind) && task.status!=='cancelled') {
            const gate = await readWeeklyPreproductionExecutionGate(store, task);
            preproductionEvidence.set(task.taskId,gate);
            if(task.schedule.stepKind==='benchmark_collection'&&task.status==='blocked'&&gate.producerStatus==='blocked'&&['weekly_preproduction_collection_credentials_required','weekly_preproduction_collection_budget_authorization_required','weekly_preproduction_collection_budget_authorization_unverified','weekly_preproduction_collection_cost_ceiling_unverified','weekly_preproduction_collection_dataset_cost_unverified'].includes(gate.code??'')){
                // The verified current producer job supersedes older collection
                // advice in this read model only. Keep the original task intact.
                for(let i=codes.length-1;i>=0;i--)if(['business_dispatch_required','weekly_preproduction_collection_credentials_required','weekly_preproduction_collection_budget_authorization_required','weekly_preproduction_collection_budget_authorization_unverified','weekly_preproduction_collection_cost_ceiling_unverified','weekly_preproduction_collection_dataset_cost_unverified'].includes(codes[i]!))codes.splice(i,1);
            }
            if (task.status!=='succeeded'&&!gate.ready && gate.code && !codes.includes(gate.code))
                codes.push(gate.code);
            if(task.schedule.stepKind==='benchmark_collection'&&task.status==='blocked'&&gate.producerStatus==='blocked'&&gate.jobId&&['weekly_qualified_admission_unverified','weekly_qualified_quota_exhausted'].includes(gate.code??'')){
                try{for(const code of await currentPostAnalysisBlockers(store,task,gate.jobId))if(!codes.includes(code))codes.push(code);}
                catch{/* Keep the signed producer blocker; a diagnostic read must not invent an intervention. */}
            }
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
        const ctaView=ctaContacts.get(ctaKey);
        const ctaCodes=['cta_required','weekly_production_cta_evidence_required','weekly_cta_contact_required','weekly_cta_sample_evidence_required','weekly_cta_contact_read_failed'];
        if(codes.some(code=>ctaCodes.includes(code))){
            // A saved number, a revoked confirmer, or a damaged receipt can
            // change the current action without changing the historical task.
            // Re-project the entire CTA reason family to avoid stale advice.
            for(let i=codes.length-1;i>=0;i--)if(ctaCodes.includes(codes[i]!))codes.splice(i,1);
            if(ctaContactReadFailures.has(ctaKey))codes.push('weekly_cta_contact_read_failed');
            else if(ctaView)codes.push(ctaView.status==='recorded'?'weekly_cta_sample_evidence_required':'weekly_cta_contact_required');
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
        const ctaContact=ctaContacts.get(`${t.tenantId}:${t.programId}:${t.packageId}:${t.packageVersion}`)??null;
        const requiredActions = roots(t.taskId).map(reason => ({ code: reason.code, taskId: reason.taskId, channel: byId.get(reason.taskId)?.inputSnapshot.customerChannel ?? null, ...weeklyBlockerAction(reason.code, byId.get(reason.taskId)),...(reason.code==='weekly_cta_contact_required'||reason.code==='weekly_cta_sample_evidence_required'?{contactStatus:ctaContact?.status??'missing'}:{}) }));
        const currentPreproduction=preproductionEvidence.get(t.taskId)??null;
        return { taskId: t.taskId, step: t.schedule.stepKind, actor: t.schedule.responsibleActor, channel: t.inputSnapshot.customerChannel ?? null, date: typeof t.inputSnapshot?.calendarAssignmentDate === 'string' ? t.inputSnapshot.calendarAssignmentDate : null, status: t.status, attempt: t.attempt, scheduledStartAt: t.schedule.estimatedStartAt, actualStartedAt: t.schedule.actualStartedAt, lastObservedAt: t.lastError?.occurredAt ?? null, resultRefs: t.resultRefs, ownReasons: (observed.get(t.taskId) ?? []).map(code => ({ code, category: classifyWeeklyBlocker(code) })), waitingFor: t.dependsOnTaskIds.filter(id => byId.get(id)?.status !== 'succeeded'), rootCauses: roots(t.taskId), requiredActions,ctaContactStatus:ctaContactReadFailures.has(`${t.tenantId}:${t.programId}:${t.packageId}:${t.packageVersion}`)?'unavailable':ctaContact?.status??'missing', requirementDiagnostics: weeklyTaskRequirements(t, profiles.get(t.tenantId) ?? null), whatsappMock: mock,currentPreproduction };
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
