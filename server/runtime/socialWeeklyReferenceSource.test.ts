import test from 'node:test';import assert from 'node:assert/strict';
import {prepareWeeklyQualityAuditFixture} from './weeklyContentQualityAudit.fixture.js';
import {readWeeklyReferenceSources,weeklyReferenceResolver} from './socialWeeklyReferenceSource.js';
test('selected reference reader preserves catalog identity and rights; source edits invalidate version',async t=>{
 const f=await prepareWeeklyQualityAuditFixture();t.after(f.cleanup);
 const row=await f.store.create('trend_videos',{tenantId:'t',sourceUrl:'https://example.test/reference',title:'参考',duration:6,aiAnalysis:{analysisMode:'exact',analysisQuality:'video',gemini:{scriptDetails15s:[{time:'0-3',purpose:'转场',visual:'装饰图形',confidence:.98},{time:'3-6',purpose:'转场',visual:'装饰动画',confidence:.98}]}}});assert.ok(row);
 const handoff={inspirationId:row.id,rights:{mayAnalyze:true,mayAdapt:true},source:{sourceUrl:'https://example.test/reference'}};
 const analysis={benchmarkAccountRefs:[],benchmarkEvidenceRefs:[]};
 const authority={referenceSelection:{selected:[{candidateId:row.id}]},selectedHandoffs:[handoff]};
 const first=await readWeeklyReferenceSources(f.store,'t',authority,analysis);assert.equal(first.length,1);
 const source={sourceId:'actual-source',sourceRef:first[0]!.sourceRef,sourceVersion:first[0]!.sourceVersion,createdAt:new Date().toISOString()};
 const resolved=await weeklyReferenceResolver(first)({tenantId:'t',themeId:'product_value',verifiedContext:{productName:null,facts:[],source:'none',confidence:0},referenceSources:[source]});assert.ok(resolved);assert.equal(resolved.referenceVideoAnalysis.referenceRecordId,row.id);
 await f.store.update('trend_videos',row.id,{title:'changed'});const changed=await readWeeklyReferenceSources(f.store,'t',authority,analysis);assert.notEqual(changed[0]!.sourceVersion,source.sourceVersion);
 await assert.rejects(weeklyReferenceResolver(changed)({tenantId:'t',themeId:'product_value',verifiedContext:{productName:null,facts:[],source:'none',confidence:0},referenceSources:[source]}),{code:'weekly_reference_version_changed'});
 handoff.rights.mayAdapt=false;await assert.rejects(readWeeklyReferenceSources(f.store,'t',authority,analysis),{code:'weekly_reference_rights_changed'});
 await assert.rejects(readWeeklyReferenceSources(f.store,'foreign',{...authority,selectedHandoffs:[{...handoff,rights:{mayAnalyze:true,mayAdapt:true}}]},analysis),{code:'weekly_reference_catalog_identity_changed'});
});
