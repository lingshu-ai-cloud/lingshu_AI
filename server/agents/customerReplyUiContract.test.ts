import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isPredominantlyChineseText } from '../../src/lib/messageLanguage.js';

const source = fs.readFileSync('src/components/ConversionPage.tsx', 'utf8');
const chatSource = fs.readFileSync('src/components/customers/ConversionChatThread.tsx', 'utf8');
const railSource = fs.readFileSync('src/components/customers/ConversionCustomerRail.tsx', 'utf8');
const replySource = fs.readFileSync('src/components/customers/customerReplyPreparation.ts', 'utf8');

assert.doesNotMatch(
  source,
  /disabled=\{!customerServiceStatus\s*\|\|\s*customerServiceSaving\}/,
  'a transient status-loading failure must not permanently disable the customer-service switch',
);
assert.match(chatSource, /aria-label=\{previewOpen \? '隐藏目标语言译文' : '显示目标语言译文'\}/, 'the composer must expose the target-language translation toggle');
assert.match(chatSource, /aria-label="添加表情"/, 'the composer must expose an emoji picker button');
assert.match(chatSource, /<EmojiPicker[\s\S]{0,500}onEmojiClick=\{\(emojiData: EmojiClickData\) => insertEmoji\(emojiData\.emoji\)\}/, 'the full emoji picker must insert into the reply input');
assert.doesNotMatch(chatSource, /const REPLY_EMOJIS\s*=/, 'the emoji picker must not be limited to a short hard-coded list');
assert.match(chatSource, /<Input\.TextArea[\s\S]{0,250}data-customer-reply-input[\s\S]{0,500}variant="borderless"/, 'the reply textarea must use the shared borderless input inside the focusable composer');
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
  chatSource,
  /placeholder="输入中文回复…"/,
  'the composer should make Chinese the default editing language',
);
assert.match(
  replySource,
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
  railSource,
  /blocked_auto: hasReplyReady \? '查看草稿' : '生成建议'/,
  'a blocked-auto card must not claim that an absent draft can be viewed',
);
assert.match(
  chatSource,
  /\[data-draft-suggestion\][\s\S]{0,100}scrollIntoView\(\{ behavior: getScrollBehavior\(\), block: 'center' \}\)/,
  'a newly generated draft must scroll into the visible conversation area',
);

const basicInfoSource = fs.readFileSync('src/components/customers/widgets/BasicInfoWidget.tsx', 'utf8');
assert.match(
  basicInfoSource,
  /aria-label="模拟客户采购阶段"/,
  'the blank simulation customer must expose an editable procurement stage',
);

const translatedDraftMappings = replySource.match(/typeof data\?\.translatedDraft === 'string'/g) ?? [];
assert.ok(
  translatedDraftMappings.length >= 2,
  'handoff and normal AI replies must both use the Chinese translation returned for editing',
);
assert.doesNotMatch(
  chatSource,
  /const translation\s*=.*fallbackCustomerReplyZh/,
  'the timeline must not label a generic fallback sentence as the translation of an unrelated AI reply',
);
assert.match(
  source,
  /queueSend\(selected, body, input, null, draftMeta\?\.knowledgeMiss \? draftMeta : null\)/,
  'a manual reply must retain its Chinese input alongside the translated target-language body',
);
assert.match(
  source,
  /queueSend\(selected, body, draftSuggestion, null, draftMeta\)/,
  'an approved AI draft must retain its Chinese text alongside the translated target-language body',
);
assert.equal(
  isPredominantlyChineseText('We mainly carry 商品1. Is that what you are looking for?'),
  false,
  'an English reply containing a Chinese product name must stay in English',
);
assert.equal(isPredominantlyChineseText('帮我确认一下 MOQ 和交期'), true);

assert.match(
  chatSource,
  /customer\.isMock \? <Tag color="purple"[\s\S]{0,220}channelReady \? '通道已连接' : '通道未连接'/,
  'real customers must not be described as reachable when WhatsApp is unavailable',
);
assert.match(
  chatSource,
  /disabled=\{sending \|\| !channelReady/,
  'the real-send action must remain disabled until the provider channel is ready',
);
assert.match(
  source,
  /\.catch\(error => \{[\s\S]{0,600}updateTimelineEvent\(customer\.id,event\.id,\{sendStatus:'unknown'\}\)/,
  'an uncertain provider response must retain the original event as unknown for receipt recovery',
);
assert.match(
  source,
  /\.then\(async result => \{[\s\S]{0,900}if\(!\['sent','delivered'\]\.includes\(result\.status\|\|''\)\)[\s\S]{0,900}persistCustomerPatch\(customer\.id, \{ lastActive: '刚刚', hasUnread: false/,
  'a customer todo may only be completed after the provider confirms the send',
);

console.log('customer reply UI translation contract tests passed');
