import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseTemplate,checkTemplate} from './infra-prep-config-check.mjs';
const template=fs.readFileSync(new URL('../deploy/production-infrastructure.env.example',import.meta.url),'utf8');
test('preparation placeholder template has no connections or deployment',()=>{const r=checkTemplate(parseTemplate(template));assert.equal(r.ok,true);assert.equal(r.serviceConnections,0);assert.equal(r.deploymentExecuted,false);});
test('production fallback, side effect workers and apply each fail closed',()=>{for(const [key,value] of [['DATA_BACKEND','pocketbase'],['QUEUE_BACKEND','local'],['DISABLE_LOCAL_AUTH_FALLBACK','false'],['ENABLE_LOCAL_DEV_FALLBACK','true'],['PROCESS_ROLE','worker'],['MIGRATION_APPLY','true'],['FOLLOWUP_WORKER_ENABLED','true'],['PUBLISH_SCHEDULER_ENABLED','true']])assert.equal(checkTemplate({...parseTemplate(template),[key]:value}).ok,false,key);});
test('real-looking credentials and endpoints never accepted or echoed',()=>{for(const [key,value] of [['DATABASE_URL','postgresql://u:synthetic-secret@real.example:5432/db'],['REDIS_URL','rediss://:synthetic-secret@real.example:6379'],['PB_ADMIN_PASSWORD','synthetic-secret'],['APIFY_TOKEN','synthetic-secret']]){const r=checkTemplate({...parseTemplate(template),[key]:value});assert.equal(r.ok,false,key);assert.equal(JSON.stringify(r).includes('synthetic-secret'),false);}});
test('parser rejects duplicates, executable substitution and unsupported dotenv syntax',()=>{for(const text of ['A=1\nA=2','A=$(whoami)','A=`whoami`','export A=1'])assert.throws(()=>parseTemplate(text));});

test('manifest example cannot be mistaken for a completed consistent recovery point',()=>{const m=JSON.parse(fs.readFileSync(new URL('../deploy/production-backup-manifest.example.json',import.meta.url)));assert.equal(m.admissionStopped,false);assert.equal(m.postBackupWrites,true);assert.equal(m.consistentRecoveryPoint,false);assert.equal(m.postgres.sha256,'REPLACE_64_HEX_SHA256');assert.equal(m.redis.sha256,'REPLACE_64_HEX_SHA256');});
