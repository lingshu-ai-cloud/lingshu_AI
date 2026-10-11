import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {digitalHumanProviderReadiness,requiredCapabilityIssues,runtimeCapabilities,sentenceReplicationReadiness} from '../server/runtime/readiness';
import {classifyWorkerHeartbeat} from '../server/runtime/socialOperatingObservability';

// Configuration audit only. No server/index, worker startup, DB, supplier,
// subprocess, dotenv file read, or network calls. Credential files are checked only by the readiness boolean helper. Values are never serialized.
const variables=[
 'NODE_ENV','PROCESS_ROLE','PROCESS_ROLE_SPLIT_ENABLED','REQUIRED_CAPABILITIES','OVERSEAS_LLM_BACKEND','DASHSCOPE_API_KEY','DASHSCOPE_API_KEY_FILE','GEMINI_API_KEY',
 'MINIMAX_API_KEY','PIPER_BIN','XTTS_BIN','SEEDANCE_VIDEO_ENABLED','SEEDANCE_SENTENCE_ENABLED','SEEDANCE_REFERENCE_ENABLED','SEEDANCE_API_KEY','SEEDANCE_MODEL','SEEDREAM_API_KEY','GEMINI_VIDEO_ENABLED',
 'HEYGEN_GENERATION_ENABLED','HEYGEN_API_KEY','DIGITAL_HUMAN_API_URL','DIGITAL_HUMAN_API_KEY','RUNWAY_ACT_TWO_ENABLED','RUNWAYML_API_SECRET','RUNWAY_ACT_TWO_CNY_PER_CREDIT','RUNWAY_ACT_TWO_ESTIMATED_CNY_PER_SECOND','SEEDANCE_REFERENCE_ESTIMATED_CNY_PER_SECOND','DIGITAL_HUMAN_REFERENCE_MAX_CNY_PER_SHOT','DIGITAL_HUMAN_REFERENCE_MONTHLY_BUDGET_CNY',
 'OBJECT_STORAGE_DRIVER','OBJECT_STORAGE_ENDPOINT','OBJECT_STORAGE_ACCESS_KEY_ID','OBJECT_STORAGE_SECRET_ACCESS_KEY','OBJECT_STORAGE_BUCKET_NAME','R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_NAME','COS_ENDPOINT','COS_REGION','COS_SECRET_ID','COS_SECRET_KEY','COS_BUCKET','LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL',
 'DIGITAL_HUMAN_VISUAL_QA_PYTHON','DIGITAL_HUMAN_SEMANTIC_QA_ENABLED','QWEN_DIGITAL_HUMAN_QA_MODEL','DIGITAL_HUMAN_SYNCNET_QA_ENABLED','DIGITAL_HUMAN_SYNCNET_QA_PYTHON','DIGITAL_HUMAN_SYNCNET_DIR','MATERIAL_CLEANUP_PYTHON','MATERIAL_CLEANUP_SCRIPT',
 'STARTER_PUBLICATION_PACKAGE_WORKER_ENABLED','STARTER_QUOTE_ARTIFACT_WORKER_ENABLED','STARTER_198_ORCHESTRATOR_WORKER_ENABLED','PUBLISH_SCHEDULER_ENABLED','QUOTE_SKILL_ENABLED','TENANT_PLATFORM_APP_KEY',
 'DATA_BACKEND','QUEUE_BACKEND','DATABASE_URL','REDIS_URL','PB_URL','PB_ADMIN_EMAIL','PB_ADMIN_PASSWORD','APP_BUILD_SHA','GIT_COMMIT_SHA','COMMIT_SHA','WORKER_HEARTBEAT_MAX_AGE_MS','WORKER_HEARTBEAT_INTERVAL_MS',
];
const original={...process.env};
const configuredProduction=process.env.NODE_ENV==='production';
try{
 // Evaluate the production policy even if the caller is a developer shell.
 process.env.NODE_ENV='production';
 // Avoid echoing arbitrary values in unsupported backend/unknown-capability reasons.
 if(!['qwen','gemini',''].includes(String(process.env.OVERSEAS_LLM_BACKEND??'')))process.env.OVERSEAS_LLM_BACKEND='unsupported';
 const known=new Set(['text_generation','qwen_generation','tts','video_generation','digital_human','digital_human_quality','digital_human_auto_release','material_cleanup','starter_workers','scheduled_publishing','quote','platform_ads']);
 const names=String(process.env.REQUIRED_CAPABILITIES??'').split(/[\s,;]+/).filter(Boolean);
 const unknownRequiredCount=names.filter(n=>!known.has(n)).length;
 if(names.length)process.env.REQUIRED_CAPABILITIES=[...names.filter(n=>known.has(n)),...(unknownRequiredCount?['unknown']:[])].join(',');
 const roles=Object.fromEntries((['web','worker','all'] as const).map(role=>{const capabilities=runtimeCapabilities(role);return[role,{capabilities,issues:requiredCapabilityIssues(capabilities),backgroundStarted:false}];}));
 const sourceHashes=Object.fromEntries(await Promise.all(['server/runtime/readiness.ts','server/runtime/socialOperatingObservability.ts','server/runtime/backgroundJobs.ts','docker-compose.yml'].map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')])));
 console.log(JSON.stringify({kind:'production_configuration_only',ready:false,runtimeEvidenceObserved:false,configurationReady:Object.values(roles).every(role=>role.issues.length===0)&&unknownRequiredCount===0,issues:unknownRequiredCount?['unknown_required_capability_redacted']:[],configuredProduction,forcedProductionPolicy:true,unknownRequiredCount,environmentPresence:Object.fromEntries(variables.map(n=>[n,Boolean(String(original[n]??'').trim())])),roles,digitalHumanProviders:digitalHumanProviderReadiness(),sentenceProviders:{seedance:sentenceReplicationReadiness(process.env,'seedance'),heygen:sentenceReplicationReadiness(process.env,'heygen')},workerEvidence:{observed:false,heartbeatBoundaryExamples:{missing:classifyWorkerHeartbeat(null,new Date('2026-10-10T00:00:00Z')),future:classifyWorkerHeartbeat('2026-10-11T00:00:00Z',new Date('2026-10-10T00:00:00Z'))}},dependencyEvidence:{databaseObserved:false,queueObserved:false,credentialValidityObserved:false,qaToolchainExecuted:false},sourceHashes},null,2));
}finally{for(const key of Object.keys(process.env))if(!(key in original))delete process.env[key];Object.assign(process.env,original);}
