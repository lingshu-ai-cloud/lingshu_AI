#!/usr/bin/env node
// Offline template contract only: no dotenv, runtime imports, env lookup or sockets.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export const auditBase = '73c78766c985871cd925453aeb5f3e937ec8b3f7';
export function parseTemplate(text) {
  const env = Object.create(null);
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw Error(`invalid_template_line:${i + 1}`);
    const [, key, value] = match;
    if (Object.hasOwn(env, key)) throw Error(`duplicate_key:${key}`);
    if (/[\x00-\x1f`$]/.test(value)) throw Error(`unsafe_template_value:${key}`);
    env[key] = value;
  }
  return env;
}
export function checkTemplate(env) {
  const issues=[];
  const exact={NODE_ENV:'production',DATA_BACKEND:'postgres',DATABASE_SSL_MODE:'verify-full',QUEUE_BACKEND:'bullmq',PROCESS_ROLE_SPLIT_ENABLED:'true',PROCESS_ROLE:'web',DISABLE_LOCAL_AUTH_FALLBACK:'true',ENABLE_LOCAL_DEV_FALLBACK:'false',RUNTIME_SCHEMA_REPAIR_ENABLED:'false',MIGRATION_APPLY:'false',MIGRATION_COPY_FILES:'false'};
  for(const [key,value] of Object.entries(exact))if(env[key]!==value)issues.push(`required_setting:${key}`);
  for(const key of ['PUBLISH_SCHEDULER_ENABLED','FOLLOWUP_WORKER_ENABLED','STARTER_198_ORCHESTRATOR_WORKER_ENABLED','STARTER_PUBLICATION_PACKAGE_WORKER_ENABLED','STARTER_QUOTE_ARTIFACT_WORKER_ENABLED','DIGITAL_EMPLOYEE_RUNTIME_ENABLED','AGENT_NOTIFICATION_OUTBOX_WORKER_ENABLED','SOCIAL_WEEKLY_REVIEW_WORKER_ENABLED','SOCIAL_WEEKLY_EXECUTION_WORKER_ENABLED','SOCIAL_WEEKLY_PUBLISHING_WORKER_ENABLED','SOCIAL_WEEKLY_REAL_PUBLISHING_ENABLED','SOCIAL_ENGAGEMENT_INGESTION_WORKER_ENABLED','PLATFORM_ADS_AUTOMATION_ENABLED','PB_VIDEO_BACKFILL_ENABLED','INSTAGRAM_CONTENT_PUBLISH_ENABLED','HEYGEN_GENERATION_ENABLED','SEEDANCE_VIDEO_ENABLED','SOCIAL_AI_VISUAL_ENABLED','QUOTE_SKILL_ENABLED'])if(env[key]!=='false')issues.push(`preparation_switch:${key}`);
  if(env.CRAWLER_OPS_WORKER_ENABLED!=='0')issues.push('preparation_switch:CRAWLER_OPS_WORKER_ENABLED');
  for(const key of ['PB_ADMIN_EMAIL','PB_ADMIN_PASSWORD','WORKBENCH_ADMIN_EMAIL','WORKBENCH_ADMIN_PASSWORD','RENDER_TOKEN_SECRET','TENANT_PLATFORM_APP_KEY','SUPPORT_ACCESS_SECRET','ASSET_ACCESS_SECRET','OAUTH_STATE_SECRET','PRODUCT_API_KEY_PEPPER','OBJECT_STORAGE_REGION','OBJECT_STORAGE_ACCESS_KEY_ID','OBJECT_STORAGE_SECRET_ACCESS_KEY','OBJECT_STORAGE_BUCKET_NAME','BULLMQ_PREFIX','MIGRATION_RUN_ID'])if(!/^REPLACE_[A-Z_]+$/.test(env[key]||''))issues.push(`placeholder_required:${key}`);
  for(const [key,protocol,host] of [['DATABASE_URL','postgresql:','postgres.invalid'],['REDIS_URL','rediss:','redis.invalid'],['OBJECT_STORAGE_ENDPOINT','https:','objects.invalid']]){
    try{const url=new URL(env[key]);if(url.protocol!==protocol||url.hostname!==host)issues.push(`template_endpoint:${key}`);if(key!=='OBJECT_STORAGE_ENDPOINT'&&url.password!=='REPLACE_PASSWORD')issues.push(`placeholder_required:${key}`);}catch{issues.push(`template_endpoint:${key}`);}
  }
  for(const key of ['DASHSCOPE_API_KEY','GEMINI_API_KEY','APIFY_TOKEN','YOUTUBE_API_KEY'])if(env[key]!=='')issues.push(`provider_must_be_empty:${key}`);
  return {ok:issues.length===0,scope:'offline_placeholder_template_only',auditBase,issues,serviceConnections:0,deploymentExecuted:false};
}
export function main(argv) {
  if(argv.length>1){console.error('Usage: node scripts/infra-prep-config-check.mjs [template-path]');return 64;}
  try{const result=checkTemplate(parseTemplate(fs.readFileSync(argv[0]||'deploy/production-infrastructure.env.example','utf8')));console.log(JSON.stringify(result,null,2));return result.ok?0:1;}catch{console.error('template_parse_failed; no configuration values printed');return 1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)process.exitCode=main(process.argv.slice(2));
