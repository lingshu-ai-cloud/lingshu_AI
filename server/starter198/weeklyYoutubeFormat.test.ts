import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyQualityAuditFixture} from '../runtime/weeklyContentQualityAudit.fixture.js';
import {checkWeeklyYoutubeFormat} from './weeklyYoutubeFormat.js';
import {inspectSocialOwnedVideo} from './socialOwnedVideoMetadata.js';
import {openSocialArtifactPreviewMedia} from './socialArtifactMedia.js';
import {socialRequestHash} from './socialContentValidation.js';
import type {SocialOwnedVideoMetadata} from '../../shared/contracts/socialWeeklyG6Review.js';

test('YouTube measures actual small low-framerate MP4 without imposing TikTok dimensions or framerate',async t=>{
 const f=await prepareWeeklyQualityAuditFixture();t.after(f.cleanup);
 const media=await openSocialArtifactPreviewMedia({repository:f.repository,tenantId:'t',taskId:'content',artifactId:'artifact'}),parts:Buffer[]=[];
 for await(const chunk of media.body)parts.push(Buffer.from(chunk));
 const metadata=await inspectSocialOwnedVideo(Buffer.concat(parts));assert.ok(metadata);
 assert.equal(metadata.width,160);assert.equal(metadata.framesPerSecond,10);
 assert.equal(checkWeeklyYoutubeFormat(metadata).status,'passed');
 assert.equal(checkWeeklyYoutubeFormat({...metadata,width:360}).status,'unknown','tampered probe output cannot pass');
 const extend=(delta:Partial<SocialOwnedVideoMetadata>)=>{const {recordHash:_,...body}=metadata;const next={...body,...delta};return {...next,recordHash:socialRequestHash(next)};};
 assert.equal(checkWeeklyYoutubeFormat(extend({durationSeconds:901})).status,'unknown','long video needs actual account eligibility');
 assert.equal(checkWeeklyYoutubeFormat(extend({durationSeconds:43201})).status,'blocked','known global duration ceiling applies even without eligibility');
 assert.equal(checkWeeklyYoutubeFormat(extend({bytes:256_000_000_001})).status,'blocked');
 assert.equal(checkWeeklyYoutubeFormat(null).status,'unknown');
});
