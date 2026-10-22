import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExistingSourceDraftDialogContent } from './ExistingSourceDraftDialog';

test('an existing-source prompt presents both deliberate draft choices', () => {
  const html = renderToStaticMarkup(<ExistingSourceDraftDialogContent
    title="产品介绍素材" matchCount={2} poster=""
    onResume={() => { throw new Error('render must not resume'); }}
    onCreate={() => { throw new Error('render must not create'); }}
  />);
  assert.match(html, /检测到 2 条历史草稿/);
  assert.match(html, /继续编辑已有草稿/);
  assert.match(html, /新建作品集/);
  assert.match(html, /data-modal-initial-focus/);
  assert.match(html, /来源视频素材封面|opacity-35/);
});
