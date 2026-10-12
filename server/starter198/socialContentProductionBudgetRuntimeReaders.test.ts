import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createProductionBudgetRuntimeReaders } from './socialContentProductionBudgetRuntimeReaders.js';
import type { StoredSocialScriptBaseline } from './socialContentScriptBaseline.js';
import type { SocialProductionAsset } from './socialContentProductionPlan.js';
import type { InternalSocialContentFormula } from './socialContentThemes.js';
import { runVisualFfmpeg } from '../lib/renderVisualQuality.js';
const baseline = { themeId: 'product_value', formulaReference: null, language: 'en', scenes: [{ voiceover: 'Meet GUIANFA.', narration: 'Meet GUIANFA.' }, { voiceover: 'DM us.', narration: 'DM us.' }] } as StoredSocialScriptBaseline;
test('real Studio sentence splitting and shared frozen direction determine clone/fallback/ASR', async () => {
    const native = await createProductionBudgetRuntimeReaders({ tenantId:'tenant', env: { MINIMAX_API_KEY: 'fixture-only', TTS_REQUIRE_MINIMAX: 'true', TTS_ASR_QA_ENABLED: 'false' } }).readVoicePlan!(baseline);
    assert.equal(native?.mode, 'continuous');
    assert.equal(native?.requiresClone, false);
    assert.equal(native?.allowFallback, false);
    assert.equal(native?.requiresAsr, false);
    assert.deepEqual(native?.lines, ['Meet GUIANFA. DM us.']);
    const formula = { formulaId: 'f', version: '1', direction: { voiceover: { voice: 'custom:owned' } } } as InternalSocialContentFormula;
    const custom = await createProductionBudgetRuntimeReaders({ tenantId:'tenant', formula, env: { DASHSCOPE_API_KEY: 'fixture-only' } }).readVoicePlan!({ ...baseline, formulaReference: { formulaId: 'f', version: '1' } });
    assert.equal(custom?.requiresClone, true);
    assert.equal(custom?.allowFallback, false);
    assert.equal(custom?.requiresAsr, true);
    assert.equal(await createProductionBudgetRuntimeReaders({ formula }).readVoicePlan!({ ...baseline, formulaReference: { formulaId: 'f', version: '2' } }), null);
});
test('strategy name does not fabricate a free execution receipt', async () => {
    assert.equal(await createProductionBudgetRuntimeReaders().readVerifiedLocalExecution!({} as never), null);
});
test('actual offline proxy extraction counts batches and rejects changed source bytes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-reader-test-'));
    try {
        const file = path.join(dir, 'owned.mp4');
        const made = await runVisualFfmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=160x240:rate=6', '-t', '1', '-c:v', 'libx264', '-y', file], false, { timeoutMs: 30000 });
        assert.equal(made.ok, true);
        const sha = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
        const asset = { id: 'owned', type: 'video', localPath: file, contentHash: sha } as SocialProductionAsset;
        const frames = await createProductionBudgetRuntimeReaders({ tenantId:'tenant', env: {} }).readAnalysisFrames!(asset);
        assert.ok(frames && frames.frameCount > 0);
        assert.equal(frames.batchFrameCounts.reduce((a, b) => a + b, 0), frames.frameCount);
        await assert.rejects(createProductionBudgetRuntimeReaders().readAnalysisFrames!({ ...asset, contentHash: '0'.repeat(64) }), /source_changed/);
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
test('new paid plan freezes available mainland Qwen native route instead of borrowing international MiniMax CNY price', async () => {
 const readers=createProductionBudgetRuntimeReaders({tenantId:'tenant',env:{MINIMAX_API_KEY:'controlled-only',DASHSCOPE_API_KEY:'controlled-only',TTS_ASR_QA_ENABLED:'false'}});
 const voice=await readers.readVoicePlan!(baseline);assert.ok(voice);assert.equal(voice.allowFallback,false);
 const text=voice.lines.join(' ');
 const route=await readers.resolveBoundRoute!({key:'voice:0:tts',stage:'tts',shotId:null,sourceRef:null,durationSeconds:null,text,frameCount:null,inputContractHash:'a'.repeat(64)});
 assert.equal(route?.provider,'qwen');assert.equal(route?.model,'qwen3-tts-flash');assert.equal(route?.maximumUnits.characters,text.length);
 assert.equal(await readers.resolveBoundRoute!({key:'voice:0:tts',stage:'tts',shotId:null,sourceRef:null,durationSeconds:null,text:'rewritten text',frameCount:null,inputContractHash:'a'.repeat(64)}),null);
});

test('Chinese continuous narration uses the exact shared Studio request text instead of inserting scene spaces',async()=>{
 const readers=createProductionBudgetRuntimeReaders({tenantId:'tenant',env:{DASHSCOPE_API_KEY:'controlled-only',TTS_ASR_QA_ENABLED:'false'}});
 const b={...baseline,language:'zh' as const,scenes:[{voiceover:'欢迎了解。',narration:'欢迎了解。'},{voiceover:'联系我们。',narration:'联系我们。'}]} as StoredSocialScriptBaseline;
 const voice=await readers.readVoicePlan!(b);assert.ok(voice);assert.equal(voice.mode,'continuous');assert.deepEqual(voice.lines,['欢迎了解。联系我们。']);
 const req={key:'voice:0:tts',stage:'tts',shotId:null,sourceRef:null,durationSeconds:null,text:voice.lines.join(' '),frameCount:null,inputContractHash:'a'.repeat(64)};
 assert.ok(await readers.resolveBoundRoute!(req));assert.equal(await readers.resolveBoundRoute!({...req,text:'欢迎了解。 联系我们。'}),null);
});

test('ASR and alignment quotes use the frozen film duration instead of the provider 300 second ceiling',async()=>{
 const readers=createProductionBudgetRuntimeReaders({tenantId:'tenant',frozenTrackSeconds:38,requiresMeasuredAlignment:true,
  env:{DASHSCOPE_API_KEY:'controlled-only',TTS_ASR_QA_ENABLED:'true'}});
 await readers.readVoicePlan!(baseline);
 const alignment=await readers.resolveBoundRoute!({key:'voice:alignment',stage:'voice_alignment',shotId:null,sourceRef:null,durationSeconds:null,text:'Meet GUIANFA. DM us.',frameCount:null,inputContractHash:'a'.repeat(64)});
 const asr=await readers.resolveBoundRoute!({key:'voice:asr',stage:'voice_asr',shotId:null,sourceRef:null,durationSeconds:null,text:'Meet GUIANFA. DM us.',frameCount:null,inputContractHash:'b'.repeat(64)});
 assert.equal(alignment?.maximumUnits.audioSeconds,38);
 assert.equal(asr?.maximumUnits.audioSeconds,38);
});
