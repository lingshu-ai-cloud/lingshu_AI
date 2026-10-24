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
assert.match(source, /className="ls-assistant-composer__add-tile"[^>]*onClick=\{guideToViralVideo\}/, '首页方框入口用于选择爆款复刻参考');
assert.match(source, /aria-label="选择爆款视频进行复刻"/, '方框入口提供可读名称');
assert.match(source, /className="ls-assistant-composer__editing"[\s\S]{0,300}ls-assistant-composer__add-tile[\s\S]{0,500}<textarea/, '爆款入口和文本输入必须使用独立网格列，避免方框覆盖占位文案');
assert.match(source, /document\.getElementById\('creator-home-library'\)/, '入口定位同页爆款视频区');
assert.match(source, /message\.info\(\{ key: 'choose-viral-video'/, '入口点击给出明确引导');
assert.match(source, /prefers-reduced-motion: reduce/, '减少动态效果时禁用平滑滚动');
assert.match(source, /aria-label="添加附件"/, '底部参考素材入口仍可使用');
assert.match(source, /data-assistant-attachments="pending"/, '选择后必须显示紧凑附件条');
assert.match(source, /file\.name/, '附件条必须显示文件名');
assert.match(source, /formatAssistantAttachmentSize\(file\.size\)/, '附件条必须显示文件大小');
assert.match(source, /aria-label=\{`移除附件/, '附件条必须提供移除操作');
assert.match(source, /待随消息上传/, '选择文件不得伪装成已经上传成功');
assert.match(source, /rows=\{1\}/, '输入框默认一行');
assert.match(source, /max-h-\[88px\]/, '输入框最多扩展到三行');
assert.match(source, /accept="image\/\*,video\/\*,audio\/\*"/, '入口只能选择真实素材上传链路支持的格式');

console.log('assistant composer tests passed');
