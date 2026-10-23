import { readAiStudioApplicationSources } from '../../tests/fixtures/aiStudioApplicationSources.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readAiStudioApplicationSources();

assert.doesNotMatch(source, /const POSTER_MODES/, '图片工作流不得恢复为素材、复刻、产品三种旧模式');
assert.match(source, /const IMAGE_DELIVERABLE_OPTIONS/, '图片工作流必须让用户选择成品类型');
assert.match(source, /planImageProduction\(materials/, '图片制作方法必须由内容 Agent 根据统一素材能力自动规划');
assert.match(source, /posterImageReviewStatus === 'accepted'/, '生成图片必须经过明确复核才能进入可交付状态');
assert.match(source, /reviewGeneratedImage\(posterImageMaterialId\)/, '图片人工复核必须写回统一素材记录');
assert.match(source, /materialRightsConfirmed/, '用户上传的生图素材必须明确确认商业使用、改编和 AI 处理授权');

console.log('AI image workflow contract tests passed');
