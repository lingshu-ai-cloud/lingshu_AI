import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isPredominantlyChineseText } from '../../src/lib/messageLanguage.js';

const source = fs.readFileSync('src/components/ConversionPage.tsx', 'utf8');

assert.doesNotMatch(
  source,
  /disabled=\{!customerServiceStatus\s*\|\|\s*customerServiceSaving\}/,
  'a transient status-loading failure must not permanently disable the customer-service switch',
);
assert.doesNotMatch(source, /title="翻译润色"|<Languages\b/, 'the non-responsive composer action must stay removed');
assert.match(source, /aria-label="添加表情"/, 'the composer must expose an emoji picker button');
assert.match(source, /aria-label=\{`插入 \$\{emoji\}`\}[\s\S]{0,200}insertEmoji\(emoji\)/, 'emoji choices must insert into the reply input');
assert.match(source, /data-customer-reply-input[\s\S]{0,500}border-0[\s\S]{0,500}focus:shadow-none/, 'the reply textarea must not show the global green focus frame');
assert.match(source, /const openCustomer = \(id: string\)[\s\S]{0,220}customer\?\.hasUnread[\s\S]{0,120}persistCustomerPatch\(id, \{ hasUnread: false \}\)/, 'opening a conversation must clear and persist its unread indicator');
assert.match(
  source,
  /attempt\s*<\s*4/,
  'customer-service status loading must retry transient startup failures',
);
assert.doesNotMatch(
  source,
  /if \(selected\.isMock\)\s*\{\s*setDraftSuggestion\(null\);\s*setDraftMeta\(null\);/,
  'a mock customer timeline update must not erase the draft that was just generated',
);
assert.doesNotMatch(
  source,
  /placeholder=["{]?[`'"]输入中文回复/,
  'the composer placeholder must not imply that foreign-language replies should be written in Chinese only',
);
assert.match(
  source,
  /placeholder=\{`输入回复（中文或\$\{replyLanguage\(customer\)\}）…`\}/,
  'the composer should show the actual customer reply language',
);
assert.match(
  source,
  /translated\.trim\(\) === text\.trim\(\) \? '' : translated/,
  'editing an already foreign-language draft must not show the same text again as a translation preview',
);
assert.match(
  source,
  /if \(selected\.pendingDraft\?\.trim\(\)\)[\s\S]{0,180}setDraftSuggestion\(selected\.pendingDraft\.trim\(\)\)/,
  'a pending AI draft must be restored when the customer is revisited',
);
assert.match(
  source,
  /body: JSON\.stringify\(\{ pendingDraft: pendingDraft \?\? null \}\)/,
  'AI drafts must be persisted so a page refresh does not lose them',
);
assert.match(
  source,
  /blocked_auto: hasReplyReady \? '查看草稿' : '生成建议'/,
  'a blocked-auto card must not claim that an absent draft can be viewed',
);
assert.match(
  source,
  /\[data-draft-suggestion\][\s\S]{0,100}scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/,
  'a newly generated draft must scroll into the visible conversation area',
);

const basicInfoSource = fs.readFileSync('src/components/customers/widgets/BasicInfoWidget.tsx', 'utf8');
assert.match(
  basicInfoSource,
  /aria-label="模拟客户采购阶段"/,
  'the blank simulation customer must expose an editable procurement stage',
);

const translatedDraftMappings = source.match(/translatedDraft:\s*typeof data\.translatedDraft/g) ?? [];
assert.ok(
  translatedDraftMappings.length >= 2,
  'handoff and normal AI replies must both reuse the translation returned for that exact draft',
);
assert.doesNotMatch(
  source,
  /const translation\s*=.*fallbackCustomerReplyZh/,
  'the timeline must not label a generic fallback sentence as the translation of an unrelated AI reply',
);
const forwardedTranslations = source.match(/translatedBody:\s*result\.translatedDraft/g) ?? [];
assert.ok(
  forwardedTranslations.length >= 2,
  'handoff bridges and normal automatically sent replies must retain their matching Chinese translation',
);
assert.equal(
  isPredominantlyChineseText('We mainly carry 商品1. Is that what you are looking for?'),
  false,
  'an English reply containing a Chinese product name must stay in English',
);
assert.equal(isPredominantlyChineseText('帮我确认一下 MOQ 和交期'), true);

console.log('customer reply UI translation contract tests passed');
