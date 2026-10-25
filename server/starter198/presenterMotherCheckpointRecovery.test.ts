import test from 'node:test';import assert from 'node:assert/strict';
import {canReusePresenterMotherCheckpoint,assertPresenterMotherRecoveryReadOnly} from './presenterMotherCheckpointRecovery.js';
test('only missing retained parent bytes reenter; write fence never authorizes new spend',async()=>{
 assert.equal(await canReusePresenterMotherCheckpoint(async()=>{}),true);
 assert.equal(await canReusePresenterMotherCheckpoint(async()=>{throw Error('presenter_mother_cached_qa_bytes_unavailable');}),false);
 for(const code of ['presenter_mother_cached_qa_unverified','presenter_mother_cached_frozen_audio_bytes_changed'])await assert.rejects(canReusePresenterMotherCheckpoint(async()=>{throw Error(code);}),new RegExp(code));
 assert.throws(assertPresenterMotherRecoveryReadOnly,/requires_existing_receipt/);
});
