import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { assistantFileHtml, renderAssistantFile } from './renderFile';

test('document renderer escapes all input and does not execute or load remote HTML', () => {
  const html = assistantFileHtml({ title: '<script>alert(1)</script>', content: '<img src="http://private-server/secret">\n| 内容 | 负责人 |\n| --- | --- |\n| 支持范围 | 待确认 |', format: 'pdf' });
  assert.doesNotMatch(html, /<script>|<img/); assert.match(html, /&lt;script&gt;/); assert.match(html, /<table>/);
});

test('real renderer creates viewable bilingual PDF and decodable JPG with actual content', { timeout: 60000 }, async () => {
  const title = '支持范围与时间安排 / Support Scope & Timeline';
  const content = '## 结论 / Summary\n本摘要仅整理当前已确认的信息，尚未确认的交付日期不得作为承诺。\nThis summary includes confirmed information only. Delivery dates remain subject to approval.\n## 下一步 / Next steps\n1. 确认设备数量和支持范围。\n2. Confirm equipment quantity and support scope.\n| 项目 / Item | 状态 / Status |\n| --- | --- |\n| 远程支持 / Remote support | 待确认 / To be confirmed |\n| 现场支持 / On-site support | 待确认 / To be confirmed |';
  const pdf = await renderAssistantFile({ title, content, format: 'pdf' }); assert.equal(pdf.subarray(0, 5).toString(), '%PDF-'); assert.ok(pdf.length > 10000);
  const jpg = await renderAssistantFile({ title: '客户支持业务路线图', content: '## 需求确认\n确认设备数量、现场条件和支持范围。\n## 方案审核\n确认负责人、费用和交付日期。\n## 交付验收\n按已确认范围交付，记录客户验收结果。', format: 'jpg', diagram: true });
  const metadata = await sharp(jpg).metadata(); assert.equal(metadata.format, 'jpeg'); assert.ok(metadata.width! >= 1120); assert.ok(metadata.height! > 300);
  await fs.mkdir('/tmp/lingshu-file-proof', { recursive: true });
  await fs.writeFile('/tmp/lingshu-file-proof/acceptance.pdf', pdf); await fs.writeFile('/tmp/lingshu-file-proof/roadmap.jpg', jpg);
});
