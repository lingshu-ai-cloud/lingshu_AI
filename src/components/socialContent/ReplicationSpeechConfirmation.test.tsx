import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReplicationSpeechConfirmation from './ReplicationSpeechConfirmation';
const error = '原片有 6 个产品位，当前已选择 3 个企业产品，已完成 3 个映射。';
const html = renderToStaticMarkup(<ReplicationSpeechConfirmation
  lines={[{id:'speech-1',source:'Hello',draft:'Hello',time:'0–1s'}]}
  products={[]} brand="" shots={[]} voices={[]} selectedVoice="v1"
  speed={1.15} onSpeedChange={() => {}} onVoiceChange={() => {}} onVoiceUpload={() => {}} voiceCapabilityMessage=""
  onDraftChange={() => {}} busy={false} status="" notice="旧的试听提示"
  confirmationError={error} onBack={() => {}} onPreview={async () => ''} onConfirm={async () => {}}
/>);
assert.ok(html.includes('role="alert"'), 'confirmation failure has an accessible alert');
assert.ok(html.includes(error), 'old audition notice cannot hide confirmation error');
assert.ok(html.indexOf(error) < html.indexOf('<footer'), 'error stays outside scroll panel next to confirmation footer');
assert.ok(html.includes('修改产品映射'), 'user can return to fix mapping');
console.log('Speech confirmation visible error feedback passed');
