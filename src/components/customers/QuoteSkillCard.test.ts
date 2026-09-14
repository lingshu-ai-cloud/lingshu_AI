import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

test('智能报价位于客户侧栏，经人工确认和预览后才能发送 WhatsApp 卡片', () => {
  const card = read('src/components/customers/QuoteSkillCard.tsx');
  const conversion = read('src/components/ConversionPage.tsx');
  const api = read('src/lib/quoteSkillApi.ts');
  assert.match(conversion, /customer-info-rail[\s\S]*?<QuoteSkillCard[\s\S]*?onInsertReply=/, '智能报价必须嵌入当前客户侧栏');
  assert.doesNotMatch(conversion, /报价中心|quote-center|page=quote/i, '不得增加独立报价入口');
  assert.match(card, /quoteSkillApi\.confirm\(draft\.id, draft\.revision\)/, '确认必须携带当前版本');
  assert.match(card, /quoteSkillApi\.card\(draft\.id\)/, '发送前必须生成客户卡片预览');
  assert.match(card, /confirmed && !sent[\s\S]*发送到 WhatsApp/, '只有已确认且未发送的版本才能发送');
  assert.match(card, /\['状态'[\s\S]*\['总额'[\s\S]*\['数量'[\s\S]*\['有效期'/, '默认摘要只展示四项关键口径');
  assert.match(card, /quoteSkillApi\.sendCard\(draft\.id\)/, '正式发送必须通过报价卡发送接口');
  assert.match(card, /customerWhatsAppName: customer\.whatsappProfileName/, '客户可见报价必须使用 WhatsApp 公开昵称');
  assert.doesNotMatch(card, /customerName: customer\.name/, '内部客户名称不得进入报价卡');
  assert.match(card, /aria-label="企业知识库产品"/, '编辑报价时必须可从企业知识库选择产品');
  assert.match(card, /productName: product\.name[\s\S]*sku: product\.sku[\s\S]*unitPrice:/, '选中产品后必须带入目录报价字段');
  assert.match(api, /catalog: \(\) => request<\{ items: QuoteCatalogProduct\[\] \}>\('\/catalog'\)/, '产品选择必须从受保护的报价目录接口读取');
  assert.match(api, /expectedRevision/, '报价更新必须使用乐观并发版本');
  assert.match(api, /send-card/, '客户端必须调用受保护的 WhatsApp 卡片发送接口');
});
