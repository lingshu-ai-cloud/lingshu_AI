import fs from 'node:fs';
import path from 'node:path';
import { evaluateMaterialGoldSet, type MaterialGoldQuery } from '../server/videoProduction/materialQualityLearning.js';
import {
  assessMarketingExperiment,
  assessVoiceListeningSet,
  type MarketingExperimentResult,
  type VoiceListeningSample,
} from '../server/videoProduction/voiceQualityLearning.js';

const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : '';
if (!inputPath || !fs.existsSync(inputPath)) {
  console.error('用法：pnpm quality:social-video-eval <evaluation.json>');
  process.exitCode = 2;
} else {
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as {
    materialQueries?: MaterialGoldQuery[];
    voiceListeningSamples?: VoiceListeningSample[];
    marketingExperiments?: MarketingExperimentResult[];
  };
  const output = {
    schemaVersion: 'social-video-quality-evaluation.v1',
    evaluatedAt: new Date().toISOString(),
    material: evaluateMaterialGoldSet(input.materialQueries ?? []),
    voiceListening: assessVoiceListeningSet(input.voiceListeningSamples ?? []),
    marketingExperiments: (input.marketingExperiments ?? []).map(experiment => ({
      experimentId: experiment.experimentId,
      ...assessMarketingExperiment(experiment),
    })),
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

