import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import WeeklyMaterialGapCards from './WeeklyMaterialGapCards';

test('weekly gap cards keep preview and upload actions together without the product-shot lecture', () => {
  const html = renderToStaticMarkup(createElement(WeeklyMaterialGapCards, { onUpload: () => {}, gaps: [{
    requirementId: '1:ref:s-2', video: '视频 1：新品展会', product: '卸妆蜜', shot: 2,
    footage: '产品陈列实拍（参考画面：一排产品包装）', minimumSeconds: 3, productId: 'sku-1',
    materialType: 'product', referenceThumbnailUrl: '/api/ref/thumb', referenceVideoUrl: '/api/ref/media-url',
    shotFirstFrameRef: '/api/ref/frame', shotStartSeconds: 2,
  }] }));
  assert.match(html, /播放视频 1：新品展会参考视频/);
  assert.match(html, /查看镜头 2 截图/);
  assert.match(html, /上传视频 1：新品展会镜头 2 素材/);
  assert.doesNotMatch(html, /不能把产品图片自动当作实拍视频/);
  assert.doesNotMatch(html, /参考画面：一排产品包装|逐项任务与判断依据/);
});

test('weekly gap cards show the shot total but only one next shot per video', () => {
  const gap = { requirementId: 'one', video: '视频 1：新品展会', product: '', shot: 1,
    footage: '展会实拍', minimumSeconds: 2, productId: null, materialType: 'general' as const,
    referenceThumbnailUrl: null, referenceVideoUrl: '/api/overseas/videos/ref/media-url',
    shotFirstFrameRef: null, shotStartSeconds: 0 };
  const gaps = Array.from({ length: 58 }, (_, index) => ({ ...gap, requirementId: `shot-${index}`, shot: index + 1,
    video: index < 50 ? '视频 1：新品展会' : '视频 2：工厂生产' }));
  const html = renderToStaticMarkup(createElement(WeeklyMaterialGapCards, { gaps, onUpload: () => {} }));
  assert.match(html, /涉及 2 条视频、58 个待匹配镜头/);
  assert.match(html, /镜头 1 · 缺展会实拍/);
  assert.match(html, /镜头 51 · 缺展会实拍/);
  assert.doesNotMatch(html, /镜头 2 · 缺展会实拍/);
  assert.doesNotMatch(html, /上一组|下一组/);
});

test('six videos are shown together and pagination starts with the seventh', () => {
  const gap = { requirementId: 'one', video: '', product: '', shot: 1,
    footage: '展会实拍', minimumSeconds: 2, productId: null, materialType: 'general' as const,
    referenceThumbnailUrl: null, referenceVideoUrl: '/api/overseas/videos/ref/media-url',
    shotFirstFrameRef: null, shotStartSeconds: 0 };
  const gaps = Array.from({ length: 7 }, (_, index) => ({ ...gap, requirementId: `shot-${index}`, video: `视频 ${index + 1}` }));
  const html = renderToStaticMarkup(createElement(WeeklyMaterialGapCards, { gaps, onUpload: () => {} }));
  assert.match(html, /视频 6/);
  assert.doesNotMatch(html, /视频 7<\/strong>/);
  assert.match(html, /下一组/);
});
