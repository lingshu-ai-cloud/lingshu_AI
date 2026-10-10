import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ASSISTANT_ATTACHMENT_LIMIT,
  assistantAttachmentKind,
  formatAssistantAttachmentSize,
  mergeAssistantAttachments,
} from './AssistantComposer';

function file(name: string, type: string, size = 10, lastModified = 1): File {
  return { name, type, size, lastModified } as File;
}

assert.equal(assistantAttachmentKind(file('photo.PNG', '')), 'image');
assert.equal(assistantAttachmentKind(file('voice.bin', 'audio/wav')), 'audio');
assert.equal(assistantAttachmentKind(file('notes.pdf', 'application/pdf')), null);
assert.equal(formatAssistantAttachmentSize(1024), '1.0 KB');
assert.equal(formatAssistantAttachmentSize(12 * 1024 * 1024), '12 MB');

const initial = [file('a.png', 'image/png')];
const merged = mergeAssistantAttachments(initial, [
  initial[0],
  file('b.mp4', 'video/mp4'),
  file('c.mp3', 'audio/mpeg'),
  file('d.jpg', 'image/jpeg'),
]);
assert.equal(merged.files.length, ASSISTANT_ATTACHMENT_LIMIT);
assert.match(merged.error || '', /最多添加 3 个附件/);

const invalid = mergeAssistantAttachments([], [file('report.pdf', 'application/pdf')]);
assert.deepEqual(invalid.files, []);
assert.match(invalid.error || '', /不是可上传/);

const source = fs.readFileSync(new URL('./AssistantComposer.tsx', import.meta.url), 'utf8');
assert.match(source, /data-assistant-attachments="pending"/, '选择后必须显示紧凑附件条');
assert.match(source, /file\.name/, '附件条必须显示文件名');
assert.match(source, /formatAssistantAttachmentSize\(file\.size\)/, '附件条必须显示文件大小');
assert.match(source, /aria-label=\{`移除附件/, '附件条必须提供移除操作');
assert.match(source, /待随消息上传/, '选择文件不得伪装成已经上传成功');
assert.match(source, /rows=\{1\}/, '输入框默认一行');
assert.match(source, /max-h-\[88px\]/, '输入框最多扩展到三行');
assert.match(source, /accept="image\/\*,video\/\*,audio\/\*"/, '入口只能选择真实素材上传链路支持的格式');

console.log('assistant composer tests passed');
