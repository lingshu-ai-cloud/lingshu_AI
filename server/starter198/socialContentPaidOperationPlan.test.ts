import { test } from 'node:test';
import assert from 'node:assert/strict';
test('enterprise authored first frame reserves image, image QA, provider duration and video QA together', async () => {
    const f = fixture();
    f.input.shots[0]!.materialRouting!.generation = { method: 'enterprise_authored_product_first_frame_i2v' } as any;
    f.ports.resolveBoundRoute = async r => ({ provider: 'actual-provider', model: 'actual-model', accountRef: 'verified-account', routeEvidenceRef: 'bound-runtime', usageBoundRef: 'enforced-request', maximumAttempts: 1, maximumUnits: { inputTokens: 10000, outputTokens: 2000, ...(r.stage === 'video' ? {providerSeconds: 4} : {}), ...(r.frameCount ? {frames: r.frameCount} : {}) } });
    f.seal();
    const result = await f.planner.plan(scope);
    assert.deepEqual(result.gaps, []);
    assert.deepEqual(result.plan!.paidOperations.map(o => o.stage), ['first_frame', 'first_frame_qa', 'video', 'video', 'video_qa', 'video_qa']);
    assert.equal(result.plan!.paidOperations.find(o => o.stage === 'video')!.maximumUnits.providerSeconds, 4);
    assert.equal(result.plan!.maximumCny, 10);
    f.ports.readProductFrameBounds = async () => null;
    assert.equal((await f.planner.plan(scope)).plan, null);
});
import { createSocialContentPaidOperationPlanner, paidProductionApprovalHash, paidProductionRecordHash, paidProductionHash, presenterGroupContractHash, type FrozenPaidProduction, type PaidOperationPlannerPorts } from './socialContentPaidOperationPlan.js';
const scope = { tenantId: 'tenant', taskId: 'task', runId: 'run', planHash: 'a'.repeat(64) };
function fixture() { const input: FrozenPaidProduction = { scope, baselineHash: 'b'.repeat(64), recordHash: '', approval: { approved: true, reviewRef: 'approved-review', sourceHash: '', planHash: scope.planHash }, authorization: { ref: 'owner-task-budget', maximumCny: 10 }, maximumRetries: 1, directedRetryShotIds:['S01'], scenes: [{ shotId: 'S01', durationSeconds: 3, spokenText: '' }], shots: [{ shotId: 'S01', sourceStrategy: 'aigc_product_scene_replication', fallbackSourceStrategy: null, sourceRefs: ['owned-material'], materialRouting: { generation: { method: 'reference_first_frame_product_replacement_i2v' } } as any }], assets: [], voice: { mode: 'none', lines: [], requiresClone: false, allowFallback: false, requiresAsr: false, reuseReceiptRef: null }, finalReview: 'local' }; const seal = () => { input.approval.sourceHash = paidProductionApprovalHash(input); input.recordHash = paidProductionRecordHash(input); }; seal(); const ports: PaidOperationPlannerPorts = { readFrozenProduction: async () => structuredClone(input), assertCurrent: async () => { }, readVerifiedLocalExecution: async (r) => ({ kind: r.stage === 'material_analysis_cache' ? 'analysis_cache' : r.stage.includes('audio_reuse') ? 'existing_audio' : 'existing_media', scopeHash: paidProductionHash(scope), inputContractHash: r.inputContractHash, receiptRef: r.stage === 'render_audio_reuse' ? r.sourceRef! : r.stage === 'material_analysis_cache' ? 'hash-bound-material-checkpoint' : 'real-local-check-receipt', sourceSha256: r.stage === 'material_analysis_cache' ? r.sourceRef! : 'f'.repeat(64), sourceRef: 'owned-material' }), readProductFrameBounds: async (r) => ({ inputContractHash: r.inputContractHash, evidenceRef: 'actual-bounded-frame-extraction-contract', firstFrameMaximumFrames: 4, videoMaximumFrames: 5 }), resolveBoundRoute: async (r) => ({ provider: 'actual-provider', model: 'actual-model', accountRef: 'verified-account', routeEvidenceRef: 'server-selected-runtime-route', usageBoundRef: 'enforced-provider-request-limits', maximumAttempts: 1, maximumUnits: { inputTokens: 10000, outputTokens: 2000, ...(r.durationSeconds ? { providerSeconds: r.durationSeconds } : {}), ...(r.frameCount ? { frames: r.frameCount } : {}), ...(r.text ? { characters: [...r.text].length } : {}) } }) }; return { input, seal, ports, planner: createSocialContentPaidOperationPlanner(ports) }; }
test('new product route reserves one directed video retry without repaying first frame and keeps the task cap', async () => { const f = fixture(); const result = await f.planner.plan(scope); assert.deepEqual(result.gaps, []); assert.deepEqual(result.plan!.paidOperations.map(o => o.stage), ['first_frame', 'first_frame_qa', 'video', 'video', 'video_qa', 'video_qa']); assert.equal(result.plan!.paidOperations.filter(o=>o.stage==='first_frame').length,1); assert.equal(new Set(result.plan!.paidOperations.map(o=>o.operationId)).size,6); assert.ok(result.plan!.paidOperations.every(o => /^[a-f0-9]{64}$/.test(o.inputContractHash))); assert.equal(result.plan!.maximumCny, 10); assert.equal(result.plan!.scope.runId,scope.runId); assert.equal(result.plan!.scope.taskId,scope.taskId); assert.deepEqual((await f.planner.plan(scope)).plan, result.plan); });
test('retry capacity alone cannot reserve a retry without a failed-QA shot authorization',async()=>{const f=fixture();f.input.directedRetryShotIds=[];f.seal();const result=await f.planner.plan(scope);assert.deepEqual(result.plan!.paidOperations.map(o=>o.stage),['first_frame','first_frame_qa','video','video_qa']);});
test('actual analysis batches generate analysis and review per batch without assuming a batch size', async () => { const f = fixture(); f.input.assets = [{ assetId: 'vid', contentHash: 'c'.repeat(64), type: 'video', verifiedAnalysisRef: null, analysisMode: 'qwen_batches', frameCount: 31, analysisBatchFrameCounts: [12, 12, 7] }, { assetId: 'img', contentHash: 'd'.repeat(64), type: 'image', verifiedAnalysisRef: null, analysisMode: 'image', frameCount: 1, analysisBatchFrameCounts: null }]; f.seal(); const result = await f.planner.plan(scope); assert.equal(result.requirements.filter(r => r.stage === 'material_video_analysis').length, 3); assert.equal(result.requirements.filter(r => r.stage === 'material_video_review').length, 3); assert.equal(result.requirements.filter(r => r.stage === 'material_image_analysis').length, 1); assert.equal(result.plan!.paidOperations.length, 13); f.input.assets[0]!.analysisBatchFrameCounts = null; f.seal(); assert.ok((await f.planner.plan(scope)).gaps.includes('material_analysis_batch_bound_missing')); });
test('presenter speech, voice clone, sentence fallback, ASR and explicit retries are all reserved intents', async () => {
    const f = fixture();
    f.input.shots[0]!.sourceStrategy = 'authorized_digital_presenter';
    f.input.scenes[0]!.spokenText = 'Exact hook';
    f.input.scenes[0]!.presenterSpeech = 'separate';
    f.input.scenes.push({ shotId: 'S02', durationSeconds: 3, spokenText: 'Exact body' });
    f.input.shots.push({ shotId: 'S02', sourceStrategy: 'customer_real_asset', fallbackSourceStrategy: null, sourceRefs: ['owned-material'] });
    f.input.voice = { mode: 'sentences', lines: ['Exact hook', 'Exact body'], requiresClone: true, allowFallback: true, requiresAsr: true, reuseReceiptRef: null };
    f.input.finalReview = 'paid';
    f.ports.resolveBoundRoute = async () => ({ provider: 'actual-provider', model: 'actual-model', accountRef: 'verified-account', routeEvidenceRef: 'bound-route', usageBoundRef: 'bound-usage', maximumUnits: { inputTokens: 50000, outputTokens: 1000 }, maximumAttempts: 2 });
    f.seal();
    const result = await f.planner.plan(scope);
    assert.deepEqual(result.gaps, []);
    for (const stage of ['presenter_video', 'presenter_tts', 'voice_clone', 'tts', 'tts_fallback', 'voice_asr', 'director_review'])
        assert.ok(result.plan!.paidOperations.some(o => o.stage === stage), stage);
    assert.equal(result.plan!.paidOperations.length, 18);
    assert.equal(new Set(result.plan!.paidOperations.map(o => o.operationId)).size, 18);
});
test('unknown providers, usage bounds and legacy paid supply do not become a client manifest', async () => { const f = fixture(); f.ports.resolveBoundRoute = async () => null; assert.equal((await f.planner.plan(scope)).plan, null); f.input.shots[0]!.materialRouting = undefined; f.seal(); assert.ok((await f.planner.plan(scope)).gaps.includes('paid_supply_route_not_planned:aigc_product_scene_replication')); });
test('approval/hash/scope drift, unsafe retry count and insufficient seconds fail closed', async () => { const f = fixture(); f.input.approval.approved = false; f.seal(); assert.equal((await f.planner.plan(scope)).plan, null); f.input.approval.approved = true; f.input.maximumRetries = 4; f.seal(); assert.equal((await f.planner.plan(scope)).plan, null); f.input.maximumRetries = 1; f.seal(); f.ports.resolveBoundRoute = async () => ({ provider: 'p', model: 'm', accountRef: 'a', routeEvidenceRef: 'route', usageBoundRef: 'usage', maximumAttempts: 1, maximumUnits: { providerSeconds: 1 } }); assert.ok((await f.planner.plan(scope)).gaps.some(s => s.startsWith('provider_usage_bound_insufficient'))); f.input.scenes[0]!.durationSeconds = 5; assert.ok((await f.planner.plan(scope)).gaps.includes('frozen_approved_production_unverified')); });
test('local scenes and canonical analysis/audio reuse produce no paid intents', async () => { const f = fixture(); f.input.shots[0]!.sourceStrategy = 'customer_real_asset'; f.input.assets = [{ assetId: 'v', contentHash: 'e'.repeat(64), type: 'video', verifiedAnalysisRef: 'hash-bound-material-checkpoint', analysisMode: 'qwen_batches', frameCount: null, analysisBatchFrameCounts: null }]; f.input.scenes[0]!.spokenText = 'Already voiced'; f.input.voice = { mode: 'reuse', lines: ['Already voiced'], requiresClone: false, allowFallback: false, requiresAsr: false, reuseReceiptRef: 'canonical-audio-receipt' }; f.seal(); const result = await f.planner.plan(scope); assert.deepEqual(result.gaps, []); assert.equal(result.plan!.paidOperations.length, 0); });
test('changed canonical snapshot during route planning stops admission', async () => {
    const f = fixture();
    let reads = 0;
    f.ports.readFrozenProduction = async () => {
        reads++;
        if (reads > 1) {
            f.input.authorization.maximumCny = 5;
            f.seal();
        }
        return structuredClone(f.input);
    };
    const result = await f.planner.plan(scope);
    assert.ok(result.gaps.includes('frozen_production_changed'));
    assert.equal(result.plan, null);
});
test('free-voice claim cannot hide frozen speech and supplied voice text cannot override baseline', async () => { const f = fixture(); f.input.scenes[0]!.spokenText = 'Must actually be spoken'; f.seal(); assert.ok((await f.planner.plan(scope)).gaps.includes('render_voice_route_missing')); f.input.voice.mode = 'continuous'; f.input.voice.lines = ['Client replacement not in frozen baseline']; f.seal(); assert.ok((await f.planner.plan(scope)).gaps.includes('voice_text_not_frozen_baseline')); });
test('customer image animation, motion graphics and licensed stock cannot claim free without actual local proof', async () => { for (const strategy of ['customer_product_image_animation', 'motion_graphics', 'licensed_stock_asset'] as const) {
    const f = fixture();
    f.input.shots[0]!.sourceStrategy = strategy;
    f.seal();
    f.ports.readVerifiedLocalExecution = async () => null;
    const result = await f.planner.plan(scope);
    assert.equal(result.plan, null);
    assert.ok(result.gaps.includes(`supply_route_execution_unverified:${strategy}`));
} });
test('presenter and render reused audio require real scope/input bound receipts and cannot hide clone/fallback', async () => { const f = fixture(); f.input.shots[0]!.sourceStrategy = 'authorized_digital_presenter'; f.input.scenes[0]!.spokenText = 'Exact line'; f.input.scenes[0]!.presenterSpeech = 'reused'; f.input.voice = { mode: 'reuse', lines: ['Exact line'], requiresClone: true, allowFallback: true, requiresAsr: false, reuseReceiptRef: 'real-audio' }; f.seal(); f.ports.readVerifiedLocalExecution = async () => null; const result = await f.planner.plan(scope); assert.equal(result.plan, null); assert.ok(result.gaps.includes('presenter_speech_reuse_receipt_missing')); assert.ok(result.gaps.includes('voice_reuse_receipt_missing')); assert.ok(result.gaps.includes('voice_reuse_route_inconsistent')); });
test('product QA extraction bounds cannot be guessed or borrowed from a different shot contract', async () => { const f = fixture(); f.ports.readProductFrameBounds = async () => null; assert.ok((await f.planner.plan(scope)).gaps.includes('product_frame_extract_bound_missing')); f.ports.readProductFrameBounds = async () => ({ inputContractHash: 'f'.repeat(64), evidenceRef: 'other-shot', firstFrameMaximumFrames: 1, videoMaximumFrames: 3 }); assert.equal((await f.planner.plan(scope)).plan, null); });
test('local proof must match scope, selected material and analysis cache bytes',async()=>{const f=fixture();f.input.shots[0]!.sourceStrategy='customer_real_asset';f.seal();f.ports.readVerifiedLocalExecution=async r=>({kind:'existing_media',scopeHash:'0'.repeat(64),inputContractHash:r.inputContractHash,receiptRef:'real',sourceSha256:'f'.repeat(64),sourceRef:'owned-material'});assert.equal((await f.planner.plan(scope)).plan,null);f.ports.readVerifiedLocalExecution=async r=>({kind:'existing_media',scopeHash:paidProductionHash(scope),inputContractHash:r.inputContractHash,receiptRef:'real',sourceSha256:'f'.repeat(64),sourceRef:'other-material'});assert.equal((await f.planner.plan(scope)).plan,null);});

test('budget cannot omit or substitute locked scene IDs even when scene counts match', async () => {
    for (const mismatch of ['missing', 'substituted'] as const) {
        const f = fixture();
        f.input.scenes.push({ shotId: 'S02', durationSeconds: 35, spokenText: '' });
        if (mismatch === 'substituted') f.input.shots.push({ ...f.input.shots[0]!, shotId: 'S03' });
        f.seal();
        let reads = 0;
        f.ports.resolveBoundRoute = async () => { reads++; return null; };
        f.ports.readVerifiedLocalExecution = async () => { reads++; return null; };
        f.ports.readProductFrameBounds = async () => { reads++; return null; };
        const result = await f.planner.plan(scope);
        assert.equal(result.plan, null);
        assert.deepEqual(result.gaps, ['scene_mapping_invalid']);
        assert.equal(reads, 0);
    }
});

test('low budget preserves all 37 locked shots and their 38 second duration', async () => {
    const f = fixture();
    f.input.authorization.maximumCny = 1;
    f.input.directedRetryShotIds = [];
    f.input.scenes = Array.from({ length: 37 }, (_, i) => ({ shotId: `S${i + 1}`, durationSeconds: i === 36 ? 2 : 1, spokenText: '' }));
    f.input.shots = f.input.scenes.map(scene => ({ shotId: scene.shotId, sourceStrategy: 'customer_real_asset', fallbackSourceStrategy: null, sourceRefs: ['owned-material'] }));
    f.seal();
    const original = structuredClone(f.input);
    const result = await f.planner.plan(scope);
    assert.deepEqual(result.gaps, []);
    assert.equal(result.plan!.maximumCny, 1);
    assert.equal(result.plan!.paidOperations.length, 0);
    assert.deepEqual(f.input, original);
    assert.equal(f.input.scenes.length, 37);
    assert.equal(f.input.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0), 38);
});

test('invalid locked duration blocks budget readers before any local or provider operation', async () => {
    for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const f = fixture();
        f.input.scenes[0]!.durationSeconds = duration;
        f.seal();
        let reads = 0;
        f.ports.resolveBoundRoute = async () => { reads++; return null; };
        f.ports.readProductFrameBounds = async () => { reads++; return null; };
        const result = await f.planner.plan(scope);
        assert.deepEqual(result.gaps, ['scene_contract_missing']);
        assert.equal(result.plan, null);
        assert.equal(reads, 0);
    }
});

test('five presenter scenes use three hashed mother-segment paid operations',async()=>{
 const f=fixture(), ids=['S01','S02','S03','S04','S05'];
 f.input.scenes=ids.map((shotId,index)=>({shotId,durationSeconds:index+1,spokenText:`Line ${index+1}`,presenterSpeech:'whole_track'}));
 f.input.shots=ids.map((shotId,index)=>({shotId,sourceStrategy:'authorized_digital_presenter',fallbackSourceStrategy:null,sourceRefs:[index<2?'presenter-a':index===2?'presenter-b':'presenter-c'],digitalHumanPlan:{presenterAssetIds:[index<2?'presenter-a':index===2?'presenter-b':'presenter-c']} as any}));
 const makeGroup=(shotIds:string[],presenterAssetId:string)=>{const scenes=f.input.scenes.filter(scene=>shotIds.includes(scene.shotId));const group={groupId:`group-${presenterAssetId}`,shotIds,durationSeconds:scenes.reduce((sum,scene)=>sum+scene.durationSeconds,0),spokenText:scenes.map(scene=>scene.spokenText).join(' '),presenterAssetId,contractHash:''};group.contractHash=presenterGroupContractHash(group);return group;};
 f.input.presenterGroups=[makeGroup(['S01','S02'],'presenter-a'),makeGroup(['S03'],'presenter-b'),makeGroup(['S04','S05'],'presenter-c')];
 f.input.voice={mode:'continuous',lines:f.input.scenes.map(scene=>scene.spokenText),requiresClone:false,allowFallback:false,requiresAsr:false,requiresAlignment:true,reuseReceiptRef:null};
 f.seal();
 const result=await f.planner.plan(scope);assert.deepEqual(result.gaps,[]);assert.ok(result.plan);
 const requirements=result.requirements.filter(item=>item.stage==='presenter_video');
 assert.equal(requirements.length,3);assert.deepEqual(requirements.map(item=>item.durationSeconds),[3,3,9]);assert.ok(requirements.every(item=>item.shotId===null&&item.presenterGroupId&&item.presenterGroupShotIds?.length));
 assert.equal(result.plan!.paidOperations.filter(item=>item.stage==='presenter_video').length,3);
 assert.equal(result.plan!.paidOperations.filter(item=>item.stage==='first_frame').length,3);
 assert.equal(result.plan!.paidOperations.filter(item=>item.stage==='first_frame_qa').length,3);
 assert.deepEqual(result.requirements.filter(item=>item.stage==='first_frame').map(item=>item.shotId),['group-presenter-a','group-presenter-b','group-presenter-c']);
 const changed=structuredClone(f.input);changed.presenterGroups![0]!.durationSeconds+=1;changed.approval.sourceHash=paidProductionApprovalHash(changed);changed.recordHash=paidProductionRecordHash(changed);f.ports.readFrozenProduction=async()=>changed;
 const rejected=await f.planner.plan(scope);assert.deepEqual(rejected.gaps,['presenter_group_contract_invalid']);
});
test('whole-track presenter continuation shots inherit frozen mother speech without requiring duplicate lines', async () => {
    const f = fixture();
    f.input.shots[0] = { shotId: 'S01', sourceStrategy: 'authorized_digital_presenter', fallbackSourceStrategy: null, sourceRefs: ['presenter-1'], digitalHumanPlan: { presenterAssetIds: ['presenter-1'] } } as any;
    f.input.scenes[0] = { shotId: 'S01', durationSeconds: 2, spokenText: 'Exact hook', presenterSpeech: 'whole_track' };
    f.input.shots.push({ shotId: 'S02', sourceStrategy: 'authorized_digital_presenter', fallbackSourceStrategy: null, sourceRefs: ['presenter-1'], digitalHumanPlan: { presenterAssetIds: ['presenter-1'] } } as any);
    f.input.scenes.push({ shotId: 'S02', durationSeconds: 1, spokenText: '', presenterSpeech: 'whole_track' });
    const group = { groupId: 'presenter-mother-1', shotIds: ['S01', 'S02'], durationSeconds: 3, spokenText: 'Exact hook ', presenterAssetId: 'presenter-1', contractHash: '' };
    group.contractHash = presenterGroupContractHash(group);
    f.input.presenterGroups = [group];
    f.input.voice = { mode: 'continuous', lines: ['Exact hook'], requiresClone: false, allowFallback: false, requiresAsr: false, requiresAlignment: true, reuseReceiptRef: null };
    f.ports.resolveBoundRoute = async r => ({ provider: 'actual-provider', model: 'actual-model', accountRef: 'verified-account', routeEvidenceRef: 'bound-route', usageBoundRef: 'bound-usage', maximumAttempts: 1, maximumUnits: { inputTokens: 50000, outputTokens: 1000, ...(r.durationSeconds ? { providerSeconds: r.durationSeconds } : {}), ...(r.frameCount ? { frames: r.frameCount } : {}), ...(r.text ? { characters: [...r.text].length } : {}) } });
    f.seal();
    const result = await f.planner.plan(scope);
    assert.deepEqual(result.gaps, []);
    assert.equal(result.plan!.paidOperations.filter(operation => operation.stage === 'presenter_video').length, 1);
    assert.equal(result.requirements.find(operation => operation.stage === 'presenter_video')?.presenterGroupId, group.groupId);

    f.input.presenterGroups[0]!.spokenText = ' ';
    f.input.scenes[0]!.spokenText = '';
    f.input.voice.lines = [];
    f.seal();
    assert.ok((await f.planner.plan(scope)).gaps.includes('presenter_group_contract_invalid'));
});
