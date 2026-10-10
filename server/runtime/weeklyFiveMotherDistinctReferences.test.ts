import {diagnoseOwnedReference} from '../socialPrograms/ownedReferenceDiagnosis.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import type {SocialInspirationHandoff} from '../../shared/contracts/socialContentWorkflow.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {ownedReferenceSupply} from '../socialPrograms/ownedReferenceSupply.js';
import {listSocialDiscoverySupply} from '../socialDiscovery/supply.js';
import {prepareFiveMotherDistinctReferenceSeeds} from './weeklyFiveMotherDistinctReferences.fixture.js';
for(const ownedPercent of [40,20] as const)test(`H${ownedPercent} five distinct controlled source bytes preserve verified speech and historical four-metric ownership`,async t=>{
 const {f,referenceIds,sourceSpeeches,ownedReferenceIds}=await prepareFiveMotherDistinctReferenceSeeds(t,{ownedPercent});
 const hashes=referenceIds.map((id,index)=>{const row=f.tables.trend_videos!.find(r=>r.id===id)!;const analysis=JSON.parse(String(row.aiAnalysis));assert.equal((row.referenceVerifiedSpeech as any).lines[0].text,sourceSpeeches[index]);assert.ok(analysis.contentSha256);return analysis.contentSha256;});
 assert.equal(new Set(hashes).size,5);assert.equal(ownedReferenceIds.length,ownedPercent/20);
 const videos=await listSocialDiscoverySupply({tenantId:'t',dataStore:f.store,filters:{candidateType:'video',decision:'accepted',businessModel:'b2b',sort:'score',perPage:100}});
 const supply=await ownedReferenceSupply(f.store,'t','p',videos.items,new Date('2026-10-02T00:00:00Z'));
 for(const pair of supply){const handoff=f.tables.starter_social_inspiration_handoff_versions!.find(row=>(row.payload as any).inspirationId===pair.video.candidateId)!;const payload=handoff.payload as SocialInspirationHandoff;assert.equal(handoff.record_hash,socialRequestHash(payload));const diagnosis=diagnoseOwnedReference({policy:{profile:'b2b_established',allocationUnit:'mother_content',ownedPercent,externalPercent:100-ownedPercent},performance:pair.historicalPerformance,handoff:payload,handoffRef:{inspirationId:payload.inspirationId,version:String(payload.version??payload.analysisVersion),recordHash:String(handoff.record_hash)},now:new Date('2026-10-02T00:00:00Z')});assert.equal(diagnosis.toneStatus,'verified');assert.equal(diagnosis.performanceStatus,'complete');assert.equal(diagnosis.acquisitionConclusion,'not_measured');}
 assert.deepEqual(supply.map(pair=>pair.video.candidateId).sort(),ownedReferenceIds.slice().sort());
 assert.equal(new Set(referenceIds.map(id=>f.tables.trend_videos!.find(r=>r.id===id)!.sourceUrl)).size,5);
 for(const id of ownedReferenceIds){const row=f.tables.social_channel_metric_snapshots!.find(r=>r.external_content_id===id)!;assert.ok(row);assert.deepEqual(Object.keys((row.snapshot as any).metrics).sort(),['comments','likes','shares','views']);}
});
