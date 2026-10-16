import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDiscoverySourceFailure, discoveryRunFailureCode } from './sourceFailure.js';

test('provider billing denial is precise without exposing raw response or commands',()=>{
 const raw='yt-dlp cookie fallback failed; Apify YouTube video start HTTP 402: {"error":{"type":"not-enough-usage-to-run-paid-actor","message":"private billing information"}}';
 assert.equal(classifyDiscoverySourceFailure(raw),'provider_budget_exhausted');
 assert.equal(discoveryRunFailureCode({error:raw}),'provider_budget_exhausted');
 assert.equal(discoveryRunFailureCode({failureDetails:[{error:'YouTube source failed'},{error:raw}]}),'provider_budget_exhausted');
});
test('auth, media, rate and other errors stay distinct without creating successful results',()=>{
 assert.equal(classifyDiscoverySourceFailure('exact_analysis_retryable: 404 Model not exist.'),'model_unavailable');
 assert.equal(classifyDiscoverySourceFailure('model_not_found'),'model_unavailable');
 assert.equal(classifyDiscoverySourceFailure('HTTP 404 video unavailable'),'source_media_unavailable');
 assert.equal(classifyDiscoverySourceFailure('Apify HTTP 401 invalid token'),'provider_authorization_required');
 assert.equal(classifyDiscoverySourceFailure('HTTP 429 rate limit'),'source_rate_limited');
 assert.equal(classifyDiscoverySourceFailure('yt-dlp cookie fallback failed'),'source_media_unavailable');
 assert.equal(classifyDiscoverySourceFailure('network connection reset'),'source_failed');
 assert.equal(classifyDiscoverySourceFailure('video_downloader_not_installed: Python yt-dlp module is required'),'downloader_missing');
 assert.equal(classifyDiscoverySourceFailure("No module named 'yt_dlp'"),'downloader_missing');
 assert.equal(classifyDiscoverySourceFailure('spawn yt-dlp ENOENT'),'downloader_missing');
});
