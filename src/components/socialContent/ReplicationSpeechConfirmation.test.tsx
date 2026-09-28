import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReplicationSpeechConfirmation from './ReplicationSpeechConfirmation';
const error = '原片有 6 个产品位，当前已选择 3 个企业产品，已完成 3 个映射。';
const html = renderToStaticMarkup(<ReplicationSpeechConfirmation
  headerActions={<><button>查看其他制作</button><button>新建任务</button></>}
  lines={[{id:'speech-1',source:'Hello',draft:'Hello',time:'0–1s'}]}
  productOptions={[{id:'product-1',label:'企业产品 A'}]} selectedProductIds={[]}
  productSlots={[{shotId:'slot-1',sourceLabel:'reference product',time:'0–1s'}]}
  productAssignments={{}} productTerms={{}} brand="" shots={[]} voices={[]} selectedVoice="v1"
  speed={1.15} onSpeedChange={() => {}} onVoiceChange={() => {}} onVoiceUpload={() => {}} voiceCapabilityMessage=""
  onDraftChange={() => {}} busy={false} status="" notice="旧的试听提示"
  confirmationError={error} onProductSelectionChange={() => {}} onProductMappingChange={() => {}} onProductTermChange={() => {}}
  onPreview={async () => ''} onConfirm={async () => {}}
/>);
assert.ok(html.includes('role="alert"'), 'confirmation failure has an accessible alert');
assert.ok(html.includes(error), 'old audition notice cannot hide confirmation error');
assert.ok(html.indexOf(error) < html.indexOf('<footer'), 'error stays outside scroll panel next to confirmation footer');
assert.ok(html.includes('主推产品与替换映射'), 'product selection is embedded in the speech confirmation sidebar');
assert.ok(html.includes('在右侧选择产品'), 'confirmation errors focus the embedded product selector');
assert.ok(!html.includes('确认替换'), 'obsolete replacement step is not rendered');
assert.ok(!html.includes('修改产品映射'), 'the workflow no longer navigates to a separate mapping step');
assert.ok(html.includes('查看其他制作') && html.includes('新建任务'), 'replication navigation remains available on speech confirmation');
console.log('Speech confirmation visible error feedback passed');
