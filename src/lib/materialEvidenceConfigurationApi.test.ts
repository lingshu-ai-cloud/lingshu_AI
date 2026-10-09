import assert from 'node:assert/strict';
import test from 'node:test';
import type {WeeklyMaterialEvidenceConfiguration,WeeklyAgentPlanningState} from '../../shared/contracts/socialProgram';
import {saveMaterialEvidenceConfigurationApi,validateMaterialConfigurationPlanningResult,materialConfigurationIdentity} from './materialEvidenceConfigurationApi';
const handoffRef={inspirationId:'actual-reference',version:'2',recordHash:'actual-source-hash'};
const decisions=[{requirementId:'actual-requirement',classification:'human_irreplaceable' as const,reason:'需要本企业真实产品，不能借用他人产品作证',shotUsage:'产品细节镜头，展示已确认工艺'}];
const input={programId:'program/a',packageId:'package/a',packageVersion:3,slotId:'slot',expectedPlanningVersion:4,expectedHandoffRef:handoffRef,decisions};
const configuration={schemaVersion:'weekly-material-evidence-configuration.v1',configurationId:'config',version:4,programId:input.programId,scope:{packageId:input.packageId,packageVersion:3,slotId:'slot'},handoffRef,decisions,recordHash:'configuration-hash'} as WeeklyMaterialEvidenceConfiguration;
const storage={getItem:()=>null,setItem:()=>{},removeItem:()=>{},clear:()=>{},key:()=>null,length:0} satisfies Storage;
test('configuration request sends only explicit human decisions and optimistic scope, never activation or caller evidence',async()=>{
 const previousFetch=globalThis.fetch,previousStorage=globalThis.localStorage;Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});
 globalThis.fetch=async(url,init)=>{assert.equal(String(url),'/api/overseas/social-programs/program%2Fa/operating-packages/package%2Fa/material-evidence-configuration');assert.deepEqual(JSON.parse(String(init?.body)),{packageVersion:3,slotId:'slot',expectedPlanningVersion:4,decisions});return Response.json({item:configuration,reanalysisRequired:true});};
 try{assert.deepEqual(await saveMaterialEvidenceConfigurationApi(input),configuration);}finally{globalThis.fetch=previousFetch;Object.defineProperty(globalThis,'localStorage',{configurable:true,value:previousStorage});}
});
test('foreign source receipt and generated classification fail closed',async()=>{
 const previousFetch=globalThis.fetch,previousStorage=globalThis.localStorage;Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({item:{...configuration,handoffRef:{...handoffRef,recordHash:'changed'}},reanalysisRequired:true});};
 try{await assert.rejects(saveMaterialEvidenceConfigurationApi(input),/实际来源/);await assert.rejects(saveMaterialEvidenceConfigurationApi({...input,decisions:[{...decisions[0],classification:'generatable_non_evidentiary'}] as any}),/逐项/);assert.equal(calls,1);}finally{globalThis.fetch=previousFetch;Object.defineProperty(globalThis,'localStorage',{configurable:true,value:previousStorage});}
});
test('reanalysis must actually freeze the saved configuration and source at a newer editable planning version',()=>{
 const plan={programId:input.programId,packageId:input.packageId,packageVersion:3,version:5,status:'director_analyzing',directorAnalyses:[{slotId:'slot',materialEvidenceRequirements:{scope:configuration.scope,handoffRef,configurationRef:{id:'config',version:4,recordHash:configuration.recordHash},items:[{requirementId:'actual-requirement',classification:'human_irreplaceable'}]}}]} as WeeklyAgentPlanningState;
 const scope={programId:input.programId,packageId:input.packageId,packageVersion:3,expectedPlanningVersion:4,configurations:[configuration]};
 assert.doesNotThrow(()=>validateMaterialConfigurationPlanningResult(scope,plan));
 assert.throws(()=>validateMaterialConfigurationPlanningResult(scope,{...plan,packageVersion:9}),/其它来源/);
 const changed=structuredClone(plan);changed.directorAnalyses[0].materialEvidenceRequirements!.configurationRef!.recordHash='changed';assert.throws(()=>validateMaterialConfigurationPlanningResult(scope,changed),/尚未核验/);
 assert.notEqual(materialConfigurationIdentity({programId:input.programId,packageId:input.packageId,version:3,agentPlanning:plan}),materialConfigurationIdentity({programId:input.programId,packageId:input.packageId,version:3,agentPlanning:changed}));
});
