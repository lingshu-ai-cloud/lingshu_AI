import assert from 'node:assert/strict';
import test from 'node:test';
import { assessMarketingExperiment, assessVoiceListeningSet, voiceLearningReadiness } from './voiceQualityLearning.js';

test('technical audio alone cannot enter the learned tenant voice/style library', () => {
  const result = voiceLearningReadiness({ technicalPassed: true });
  assert.equal(result.status, 'technical_only');
  assert.equal(result.canPromoteToTenantStyleLibrary, false);
});

test('listening admission requires enough native votes and quality dimensions', () => {
  const samples = Array.from({ length: 30 }, (_, index) => ({
    sampleId: `sample-${index}`, language: 'zh', voiceProfileId: 'minimax:voice-1', votes: 8,
    mos: 4.3, naturalness: 4.2, personality: 4.1, marketingNaturalness: 4, trust: 4.2,
    pronunciationErrors: 0, evaluatedWords: 30,
  }));
  assert.equal(assessVoiceListeningSet(samples).passed, true);
});

test('marketing promotion rejects a small or statistically weak uplift', () => {
  const result = assessMarketingExperiment({
    experimentId: 'exp-1',
    control: { impressions: 2_000, conversions: 100, negativeEvents: 5 },
    treatment: { impressions: 2_000, conversions: 103, negativeEvents: 5 },
  });
  assert.equal(result.passed, false);
});
