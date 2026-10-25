import assert from 'node:assert/strict';
import test from 'node:test';
import { socialContentTaskCover } from './socialContentTaskCover.js';
const row={id:'a',tenant_id:'tenant',task_id:'task',artifact_kind:'short_video',status:'review_required',updated_at:'2026-10-26T00:00:00Z',content:{mediaStorage:{cover:{fileId:`socialfile_${'a'.repeat(24)}`,sha256:'a'.repeat(64)}}}};
test('cover is the current task final render archived cover, with exact tenant and task ownership',()=>{
  assert.match(socialContentTaskCover([row],'tenant','task')!,/files\/socialfile_a{24}$/);
  assert.equal(socialContentTaskCover([row],'other','task'),null);
  assert.equal(socialContentTaskCover([row],'tenant','another'),null);
  assert.equal(socialContentTaskCover([{...row,status:'superseded'}],'tenant','task'),null);
  assert.equal(socialContentTaskCover([{...row,content:{referenceThumbnailUrl:'https://example.com/ref.jpg'}}],'tenant','task'),null);
  assert.equal(socialContentTaskCover([{...row,content:{mediaStorage:{cover:{url:'https://example.com/cover.jpg'}}}}],'tenant','task'),null);
  const newer={...row,id:'b',updated_at:'2026-10-27T00:00:00Z',content:{mediaStorage:{}}};
  assert.equal(socialContentTaskCover([row,newer],'tenant','task'),null,'do not silently use an older version cover');
});
