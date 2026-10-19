import type {DataStore,Record_} from '../storage/datastore.js';
import {resolveDigitalEmployeeConfiguration,type EnterpriseFactsProfile} from '../digitalEmployees/configuration.js';
import {normalizeDigitalEmployeeConfig,type DigitalEmployeeConfig} from '../digitalEmployees/domain.js';
import {SocialProgramError} from './service.js';
export async function readWeeklyCustomerSettings(store:DataStore,tenantId:string){
 const rows=await store.list<Record_>('digital_employee_configs',{where:{tenant_id:tenantId},sort:'-config_version',perPage:2});
 const row=rows.items[0];
 if(!row||row.tenant_id!==tenantId||!row.config||typeof row.config!=='object'||Array.isArray(row.config)||!Number.isSafeInteger(row.config_version)||Number(row.config_version)<1)throw new SocialProgramError('customer_configuration_required',409,'请先保留现有基础配置；不创建虚构的企业配置。');
 const config=row.config as Record<string,unknown>;
 return {row,public:{configVersion:Number(row.config_version),enabled:Array.isArray(config.enabledWorkflows)&&config.enabledWorkflows.some(w=>w==='customer_segmentation'||w==='batch_followup'),allowRealCustomerMessages:config.allowRealCustomerMessages===true}};
}
/** Only these two explicit settings may change. Existing content/publish consent stays intact. */
export async function updateWeeklyCustomerSettings(store:DataStore,tenantId:string,actor:string,input:{expectedConfigVersion:number;enabled:boolean;allowRealCustomerMessages:boolean},profile:EnterpriseFactsProfile){
 const current=await readWeeklyCustomerSettings(store,tenantId);
 if(current.public.configVersion!==input.expectedConfigVersion)throw new SocialProgramError('customer_configuration_changed',409,'客服配置已变化，请重新读取。');
 if(!store.compareAndSwap)throw new SocialProgramError('customer_configuration_atomic_write_required',503,'当前存储暂不支持安全更新客服配置。');
 if(!input.enabled&&input.allowRealCustomerMessages)throw new SocialProgramError('customer_configuration_invalid',400,'未启用客服时不能授予真实消息许可。');
 const config=normalizeDigitalEmployeeConfig(current.row.config as Partial<DigitalEmployeeConfig>),workflows=config.enabledWorkflows;
 const nextWorkflows=input.enabled?[...new Set([...workflows,...(['customer_segmentation','batch_followup'] as const)])]:workflows.filter(w=>w!=='customer_segmentation'&&w!=='batch_followup');
 const versions=await store.list<Record_>('digital_employee_config_versions',{where:{tenant_id:tenantId},sort:'-config_version',perPage:1});
 const nextVersion=Math.max(input.expectedConfigVersion,Number(versions.items[0]?.config_version??0))+1;
 if(!Number.isSafeInteger(nextVersion))throw new SocialProgramError('customer_configuration_version_invalid',409,'客服配置版本留痕无法核验。');
 const now=new Date().toISOString(),resolved=resolveDigitalEmployeeConfiguration({config:{...config,enabledWorkflows:nextWorkflows,allowRealCustomerMessages:input.allowRealCustomerMessages},enterpriseProfile:profile,configVersion:nextVersion,boundAt:now});
 const audit={tenant_id:tenantId,config_version:resolved.configVersion,policy_version:resolved.policyVersion,facts_version:resolved.knowledgeBinding.factsVersion,config:resolved.config,knowledge_binding:resolved.knowledgeBinding,runtime_policy:resolved.runtimePolicy,created_by:actor,created_at:now,status:'proposed',source:'weekly_task_details'};
 const receipt=await store.create<Record_>('digital_employee_config_versions',audit);
 if(!receipt)throw new SocialProgramError('customer_configuration_audit_failed',503,'客服配置尚未留痕，未更新权限。');
 const saved=await store.compareAndSwap('digital_employee_configs',current.row.id,{tenant_id:tenantId,config_version:input.expectedConfigVersion,config:current.row.config},{config:resolved.config,config_version:resolved.configVersion,policy_version:resolved.policyVersion,facts_version:resolved.knowledgeBinding.factsVersion,effective_config:{configVersion:resolved.configVersion,policyVersion:resolved.policyVersion,knowledgeBinding:resolved.knowledgeBinding,runtimePolicy:resolved.runtimePolicy},updated_by:actor,updated_at:now});
 if(!saved)throw new SocialProgramError('customer_configuration_changed',409,'客服配置已变化；候选留痕不代表权限已生效，请重新读取。');
 await store.update('digital_employee_config_versions',receipt.id,{status:'active'});
 return (await readWeeklyCustomerSettings(store,tenantId)).public;
}
