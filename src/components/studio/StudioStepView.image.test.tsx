import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderStudioStep } from './StudioStepView';
import type { StudioStepViewInputs } from './studioStepViewInputs';

function renderMode(contentMode: 'poster' | 'video') {
  const values: Record<string, unknown> = {
    step: 'mode', contentMode, mode: 'material', ratio: '4:5', provider: 'qwen', duration: 15,
    script: '', productInfo: '', audience: '', productSearch: '', lang: 'en',
    selectedProductOptions: [], selectedProductIds: [], productOptions: [], productCategories: [],
    selectedVisualClips: [], selectedClips: [], materials: [], selected: [],
    availableCooperationRoutes: [], enterpriseRouteStrategies: {},
    referenceProducts: [], referenceSpeechPlan: { lines: [], error: '' },
    activeVideoTheme: { title: '产品介绍', painPoint: '' }, voiceLangs: ['en'],
    visibleRatios: ['1:1', '4:5'], showAdvancedSetup: true,
    selectedVideoCount: 0, selectedImageCount: 0, effectiveSelectedDuration: 0,
    unknownDurationCount: 0, ratioCompatibleCount: 0,
  };
  const input = new Proxy(values, { get: (target, key: string) => key in target ? target[key] : key.startsWith('set') ? () => {} : key.endsWith('Ref') ? { current: null } : undefined }) as unknown as StudioStepViewInputs;
  return renderToStaticMarkup(renderStudioStep(input));
}

test('image settings omit video-only durations, narration, music and cooperation route', () => {
  const html = renderMode('poster');
  assert.doesNotMatch(html, /有效时长|时长未知|目标时长|口播|配乐|合作路线/);
  assert.match(html, /画面比例/);
  assert.match(html, /从素材库选择/);
});

test('video settings retain duration, narration and music controls', () => {
  const html = renderMode('video');
  assert.match(html, /有效时长/);
  assert.match(html, /目标时长/);
  assert.match(html, /配乐/);
});
