import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isPredominantlyChineseText } from '../../src/lib/messageLanguage.js';

const source = fs.readFileSync('src/components/ConversionPage.tsx', 'utf8');

assert.doesNotMatch(
  source,
  /disabled=\{!customerServiceStatus\s*\|\|\s*customerServiceSaving\}/,
  'a transient status-loading failure must not permanently disable the customer-service switch',
);
assert.match(source, /aria-label=\{previewOpen \? '隐藏目标语言译文' : '显示目标语言译文'\}/, 'the composer must expose the target-language translation toggle');
assert.match(source, /aria-label="添加表情"/, 'the composer must expose an emoji picker button');
assert.match(source, /<EmojiPicker[\s\S]{0,500}onEmojiClick=\{\(emojiData: EmojiClickData\) => insertEmoji\(emojiData\.emoji\)\}/, 'the full emoji picker must insert into the reply input');
assert.doesNotMatch(source, /const REPLY_EMOJIS\s*=/, 'the emoji picker must not be limited to a short hard-coded list');
assert.match(source, /<Input\.TextArea[\s\S]{0,250}data-customer-reply-input[\s\S]{0,500}variant="borderless"/, 'the reply textarea must use the shared borderless input inside the focusable composer');
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
assert.match(
  source,
  /placeholder="输入中文回复…"/,
  'the composer should make Chinese the default editing language',
);
assert.match(
  source,
  /source: '简体中文', target: replyLanguage\(customer\)/,
  'translation preview and sending must translate Chinese into the customer target language',
);
assert.match(
  source,
  /const body = translatedInput\.trim\(\) \|\| await translateReplyToCustomerLanguage\(selected, input\)/,
  'sending a Chinese manual reply must use the same target-language translation path',
);
assert.match(
  source,
  /translatedBody: restoreText\.trim\(\) && restoreText\.trim\(\) !== eventBody\.trim\(\) \? restoreText\.trim\(\) : undefined/,
  'a sent target-language reply must retain the Chinese text that the operator edited',
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

const translatedDraftMappings = source.match(/typeof data\?\.translatedDraft === 'string'/g) ?? [];
assert.ok(
  translatedDraftMappings.length >= 2,
  'handoff and normal AI replies must both use the Chinese translation returned for editing',
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

assert.match(
  source,
  /真实客户 · 通道未连接/,
  'real customers must not be described as reachable when WhatsApp is unavailable',
);
assert.match(
  source,
  /disabled=\{sending \|\| !channelReady/,
  'the real-send action must remain disabled until the provider channel is ready',
);
assert.match(
  source,
  /\.catch\(error => \{[\s\S]{0,180}removeTimelineEvent\(customer\.id, event\.id\);[\s\S]{0,220}hasUnread: true[\s\S]{0,120}pendingDraft: restoreText/,
  'a provider failure must remove the optimistic message and restore the customer draft/todo state',
);
assert.match(
  source,
  /\.then\(async result => \{[\s\S]{0,520}persistCustomerPatch\(customer\.id, \{ lastActive: '刚刚', hasUnread: false/,
  'a customer todo may only be completed after the provider confirms the send',
);

console.log('customer reply UI translation contract tests passed');
