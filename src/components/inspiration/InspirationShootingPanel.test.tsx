import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { InspirationShootingPanel } from './InspirationShootingPanel';

test('shooting panel presents derived needs and keeps capture behind the supplied callback', () => {
  const markup = renderToStaticMarkup(<InspirationShootingPanel
    needs={[{
      id: 'need-1', priority: '高', title: '产品包装特写', suggestion: '补拍包装',
      count: 2, sourceVideos: ['参考 A'], platform: 'tiktok', ratio: '9:16',
    }]}
    scriptGapTasks={[]}
    materialCount={3}
    uploadingMaterial={false}
    onUploadExisting={() => { throw new Error('render must not upload'); }}
    onCaptureStart={() => { throw new Error('render must not capture'); }}
    onUploadCaptured={() => { throw new Error('render must not upload'); }}
  />);
  assert.match(markup, /筛选待拍清单/);
  assert.match(markup, /产品包装特写/);
  assert.match(markup, /补拍包装/);
  assert.match(markup, /可选实拍/);
  assert.match(markup, /已入库素材/);
  assert.doesNotMatch(markup, /返回分镜/);
});
