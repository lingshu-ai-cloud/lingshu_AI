import { Router } from 'express';
import { callLLM } from '../agents/llm.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { retrieveContext } from '../knowledge/retrieve.js';
import { buildKnowledgePromptBlock } from '../knowledge/promptBlocks.js';
import { buildStrategyPromptBlock, retrieveResponseStrategies, strategyEvidence } from '../knowledge/strategyRetrieve.js';
import { aggregateKnowledgeMisses } from '../knowledge/misses.js';
import { recordStyleMemory } from '../knowledge/styleMemory.js';
import { getNightModeMorningBriefing,getWhatsAppCustomers } from '../whatsapp/historyImport.js';
import { analyzeMessengerCustomerTags, getMessengerCustomers, patchMessengerCustomer, sendTenantMessengerText,upsertMessengerMessage } from '../messenger/conversations.js';
import { analyzeInstagramCustomerTags, getInstagramCustomers, patchInstagramCustomer,upsertInstagramMessage } from '../instagram/conversations.js';
import { sendTenantInstagramText } from '../instagram/send.js';
import {createCustomerChannelSendRequestService,resolveCustomerChannelOutboxContext} from '../digitalEmployees/customerChannelSendRequests.js';
import {store} from '../storage/index.js';
import {createCustomerManualTakeoverService} from '../customerService/customerManualTakeover.js';
import {createCustomerManualTakeoverRouter} from './customerManualTakeover.js';
import { customerServicePolicy, customerServiceStatus, readTenantEnterpriseProfile } from './enterprise.js';
import { readCustomerMessagingAuthorization } from '../digitalEmployees/customerMessagingPolicy.js';

export const customerSuggestionsRouter = Router();
customerSuggestionsRouter.use(requireAuth);

const manualTakeoverService=createCustomerManualTakeoverService(store);

async function maybeRecordStyleMemory(req: any, tenantId: string, customerId: string, finalBody: string) {
  const memory = req.body?.styleMemory;
  if (!memory || typeof memory !== 'object') return;
  await recordStyleMemory({
    tenantId,
    customerId,
    triggerMessage: String(memory.triggerMessage || ''),
    draftOriginal: String(memory.draftOriginal || ''),
    finalSent: String(memory.finalSent || finalBody || ''),
    edited: Boolean(memory.edited),
    category: String(memory.category || 'reply'),
    strategyIds: Array.isArray(memory.strategyIds) ? memory.strategyIds.map(String) : [],
    nodeId: String(memory.nodeId || ''),
    riskLevel: String(memory.riskLevel || ''),
    diffTags: Array.isArray(memory.diffTags) ? memory.diffTags.map(String) : [],
    interventionType: String(memory.interventionType || ''),
    outcome3Turn: String(memory.outcome3Turn || ''),
    outcome24h: String(memory.outcome24h || ''),
    finalOutcome: String(memory.finalOutcome || ''),
  }).catch(error => console.warn('[style-memory:record-failed]', error));
}

customerSuggestionsRouter.get('/', requireAuth, (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const source = String(req.query.source || '');
  if (source && source !== 'messenger' && source !== 'instagram') {
    res.json({ items: [], source });
    return;
  }
  const items = source === 'messenger' ? getMessengerCustomers(tenantId)
    : source === 'instagram' ? getInstagramCustomers(tenantId)
      : [...getMessengerCustomers(tenantId), ...getInstagramCustomers(tenantId)].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  res.json({ items, source: source || 'all' });
});

function customerChannel(tenantId: string, id: string): 'instagram' | 'messenger' | null {
  if (id.startsWith('instagram_')) return getInstagramCustomers(tenantId).some(item => item.id === id) ? 'instagram' : null;
  return getMessengerCustomers(tenantId).some(item => item.id === id) ? 'messenger' : null;
}

customerSuggestionsRouter.get('/templates', (_req, res) => {
  res.json({ items: [] });
});

customerSuggestionsRouter.post('/:id/context-tags', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  try {
    const id = String(req.params.id);
    const channel = customerChannel(tenantId, id);
    const customer = channel === 'instagram' ? await analyzeInstagramCustomerTags(tenantId, id)
      : channel === 'messenger' ? await analyzeMessengerCustomerTags(tenantId, id) : null;
    if (!customer) { res.status(404).json({ error: 'customer_not_found' }); return; }
    res.json({ customer });
  } catch (error) {
    res.status(503).json({ error: 'context_tag_analysis_failed', message: error instanceof Error ? error.message : '标签分析失败，请重试' });
  }
});

customerSuggestionsRouter.get('/knowledge-misses/briefing', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const items = await aggregateKnowledgeMisses(tenantId, 7);
  res.json({ items });
});

customerSuggestionsRouter.get('/night-mode/briefing', requireAuth, (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  res.json({ item: getNightModeMorningBriefing(tenantId) });
});

customerSuggestionsRouter.post('/knowledge-misses/recompute', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const items = await aggregateKnowledgeMisses(tenantId, 7);
  res.json({ ok: true, items });
});

function manualCustomerChannel(tenantId:string,id:string){return getWhatsAppCustomers(tenantId).some(c=>c.id===id)?'whatsapp' as const:customerChannel(tenantId,id);}
customerSuggestionsRouter.use('/:id/manual-active',createCustomerManualTakeoverRouter({service:manualTakeoverService,resolveChannel:manualCustomerChannel}));

customerSuggestionsRouter.patch('/:id', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const customerId = String(req.params.id || '');
  if (!customerId) {
    res.status(400).json({ error: 'customer_id_required' });
    return;
  }
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'orders')) {
    res.status(422).json({ error: '请通过订单台账登记和更新订单，客户备注不再接受订单状态修改', code: 'use_order_ledger' }); return;
  }
  const patch = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  const customer = customerChannel(tenantId, customerId) === 'instagram'
    ? patchInstagramCustomer(tenantId, customerId, patch)
    : patchMessengerCustomer(tenantId, customerId, patch);
  if (!customer) {
    res.status(404).json({ error: 'customer_not_found' });
    return;
  }
  res.json({ ok: true });
});

customerSuggestionsRouter.post('/:id/source-attribution', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const customerId = String(req.params.id || '');
  const postId = String(req.body?.postId || '');
  if (!customerId || !postId) {
    res.status(400).json({ error: 'customer_id_and_post_id_required' });
    return;
  }
  const channel = customerChannel(tenantId, customerId);
  const patch = {
    sourcePostId: postId,
    sourcePostPlatform: channel === 'instagram' ? 'instagram' : 'facebook',
  };
  const customer = channel === 'instagram' ? patchInstagramCustomer(tenantId, customerId, patch)
    : patchMessengerCustomer(tenantId, customerId, patch);
  if (!customer) {
    res.status(404).json({ error: 'attribution_candidate_not_found' });
    return;
  }
  res.json({
    ok: true,
    source: customer.source,
    sourcePostId: customer.sourcePostId,
    sourceTrackCode: customer.sourceTrackCode,
    sourcePostTitle: customer.sourcePostTitle,
    sourcePostPlatform: customer.sourcePostPlatform,
  });
});

customerSuggestionsRouter.get('/:id/outbox/context',requireAuth,async(req,res)=>{
 const{tenantId,userId}=res.locals as AuthLocals;const customerId=String(req.params.id||'');const channel=customerChannel(tenantId,customerId);if(!channel){res.status(404).json({error:'customer_not_found'});return;}
 const customer=channel==='instagram'?getInstagramCustomers(tenantId).find(c=>c.id===customerId):getMessengerCustomers(tenantId).find(c=>c.id===customerId);
 try{const item=await resolveCustomerChannelOutboxContext(store,{tenantId,actorUserId:userId,customerId,channel,nativeAccountId:String(channel==='instagram'?customer?.instagramAccountId:customer?.pageId)});res.json({item});}catch(error){const code=error instanceof Error?error.message:'channel_send_context_unavailable';res.status(/forbidden$/.test(code)?403:409).json({error:code});}
});

customerSuggestionsRouter.get('/:id/outbox/:requestId',requireAuth,async(req,res)=>{
 const {tenantId,userId}=res.locals as AuthLocals;const customerId=String(req.params.id||''),requestId=String(req.params.requestId||'');
 if(!/^[a-zA-Z0-9_-]{8,120}$/.test(requestId)){res.status(400).json({error:'channel_send_request_id_required'});return;}
 const channel=customerChannel(tenantId,customerId);if(!channel){res.status(404).json({error:'customer_not_found'});return;}
 try{const item=await createCustomerChannelSendRequestService(store).get(tenantId,userId,channel,requestId);if(!item||item.customerId!==customerId){res.status(404).json({error:'channel_send_request_not_found'});return;}res.json({item});}catch(error){const code=error instanceof Error?error.message:'channel_send_request_read_failed';res.status(/forbidden$/.test(code)?403:409).json({error:code});}
});

customerSuggestionsRouter.post('/:id/outbox/:requestId/reconcile',requireAuth,async(req,res)=>{
 const{tenantId,userId}=res.locals as AuthLocals;const customerId=String(req.params.id||''),requestId=String(req.params.requestId||'');if(req.body!==undefined&&(!req.body||Array.isArray(req.body)||typeof req.body!=='object'||Object.keys(req.body).length)){res.status(400).json({error:'channel_send_reconcile_body_invalid'});return;}
 const channel=customerChannel(tenantId,customerId);if(!channel){res.status(404).json({error:'customer_not_found'});return;}
 const customer=channel==='instagram'?getInstagramCustomers(tenantId).find(c=>c.id===customerId):getMessengerCustomers(tenantId).find(c=>c.id===customerId);
 try{const item=await createCustomerChannelSendRequestService(store).repairHistory({tenantId,actorUserId:userId,channel,requestId,customerId,recordHistory:(receipt,body,account)=>{if(channel==='instagram'){if(customer?.instagramAccountId!==account.providerAccountId||customer?.instagramUserId!==receipt.recipientId)throw Error('channel_send_history_customer_drift');upsertInstagramMessage({tenantId,instagramAccountId:String(account.providerAccountId),userId:receipt.recipientId,messageId:receipt.messageId,body,timestamp:Date.parse(receipt.acceptedAt),actor:'seller',sendStatus:'sent'});}else{if(customer?.pageId!==account.providerAccountId||customer?.messengerUserId!==receipt.recipientId)throw Error('channel_send_history_customer_drift');upsertMessengerMessage({tenantId,pageId:String(account.providerAccountId),userId:receipt.recipientId,messageId:receipt.messageId,body,timestamp:Date.parse(receipt.acceptedAt),actor:'seller',sendStatus:'sent'});}}});res.json({item,messagesSent:0});}catch(error){const code=error instanceof Error?error.message:'channel_send_history_writeback_failed';res.status(/forbidden$/.test(code)?403:409).json({error:code,requestId});}
});

customerSuggestionsRouter.post('/:id/outbox', requireAuth, async (req, res) => {
  const { tenantId,userId } = res.locals as AuthLocals;
  const customerId = String(req.params.id || '');
  const body = String(req.body?.body || '').trim();
  const requestId=typeof req.body?.requestId==='string'?req.body.requestId.trim():'';
  if(!/^[a-zA-Z0-9_-]{8,120}$/.test(requestId)){res.status(400).json({error:'channel_send_request_id_required'});return;}
  if (!customerId || !body) {
    res.status(400).json({ error: 'customer_id_and_body_required' });
    return;
  }
  const channel = customerChannel(tenantId, customerId);
  if (!channel) { res.status(404).json({ error: 'customer_not_found' }); return; }
  if (req.body?.auto === true) {
    const status = customerServiceStatus(await readTenantEnterpriseProfile(tenantId));
    const messagingAuthorization = await readCustomerMessagingAuthorization(tenantId, channel);
    if (!status.autoReplyReady || !messagingAuthorization.inboundAutoSendAllowed) {
      res.status(409).json({ error: 'auto_reply_not_authorized', message: '当前只提供建议回复，不能自动发送。' });
      return;
    }
  }
  if (req.body?.outsideWindow) {
    res.status(409).json({ error: `${channel}_window_closed`, message: `距客户上次互动已超过 24 小时，当前不能直接发送普通 ${channel === 'instagram' ? 'Instagram 私信' : 'Messenger 消息'}。` });
    return;
  }
  try {
    const send=()=>channel==='instagram'?sendTenantInstagramText({tenantId,customerId,body,requestId,actorUserId:userId}):sendTenantMessengerText({tenantId,customerId,body,requestId,actorUserId:userId});
    const receipt=req.body?.auto===true?await manualTakeoverService.withAutoSendPermission({tenantId,customerId,channel},send):await manualTakeoverService.withHumanSendPermission({tenantId,customerId,channel,actorUserId:userId},send);
    await maybeRecordStyleMemory(req, tenantId, customerId, body);
    const item=await createCustomerChannelSendRequestService(store).get(tenantId,userId,channel,requestId);
    res.json({
      item,
      ok: true,
      outboxId: receipt.messageId,requestId:receipt.requestId,
      providerMessageIds: [receipt.messageId],
      status: 'sent',
      sentAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error&&/^(provider_identity_gap|provider_response_save_gap|channel_send_request_)/.test(error.message)?error.message:`${channel}_send_failed`,requestId,
      message: error instanceof Error ? error.message : `${channel} send failed`,
    });
  }
});

interface CustomerHint {
  name: string;
  stage: string;
  intentScore: number;
  product: string;
  timeline: string[];
}

const SYSTEM_PROMPT = `你是灵枢 AI「我的客户」里的转化助手。
请返回 2 到 3 条给中国商家看的主动建议。
每条建议一句话，动作明确，可以继续转成 Messenger 回复草稿。
不要写完整的客户回复，不要编号、Markdown 或解释。`;

customerSuggestionsRouter.get('/:id/suggestions', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  if (!customerServicePolicy(await readTenantEnterpriseProfile(tenantId)).enabled) {
    res.status(409).json({ items: [], error: 'conversation_suggestions_disabled', message: '请先在 Agent 设置中开启会话建议。' });
    return;
  }
  const id = String(req.params.id ?? '');
  const customer = id.startsWith('instagram_')
    ? getInstagramCustomers(tenantId).find(item => item.id === id)
    : getMessengerCustomers(tenantId).find(item => item.id === id);
  if (!customer) {
    res.status(404).json({ items: [], error: 'customer_not_found' });
    return;
  }
  const customerTimeline = Array.isArray(customer.timeline) ? customer.timeline.slice(-8) : [];
  const hint: CustomerHint = {
    name: String(customer.name || ('instagramUserId' in customer ? customer.instagramUserId : customer.messengerUserId) || '客户'),
    stage: String(customer.stage || 'inquiry'),
    intentScore: Number(customer.intentScore || 0),
    product: String(customer.outboundProduct || customer.product || ''),
    timeline: customerTimeline.map((item: any) => String(item.body || '')).filter(Boolean),
  };
  const fallback = fallbackSuggestions(hint);
  const conversation = customerTimeline.map((item: any) => ({
    role: item.actor === 'buyer' ? 'buyer' as const : 'seller' as const,
    text: String(item.body || ''),
  })).filter((item: { text: string }) => item.text);
  const latestMessage = [...conversation].reverse().find(item => item.role === 'buyer')?.text || hint.product || hint.stage;
  const context = await retrieveContext(tenantId, {
    id,
    name: hint.name,
    stage: hint.stage,
    product: hint.product,
  }, latestMessage, { conversation });
  const strategies = await retrieveResponseStrategies(tenantId, {
    latestMessage,
    conversation,
    stage: hint.stage,
    intent: 'suggestion',
    firstTurn: conversation.filter((turn: { role: string }) => turn.role === 'buyer').length <= 1,
    knowledgeMiss: context.knowledgeMiss,
    productAvailable: context.products.length > 0,
    sentiment: context.sentiment,
  });

  const prompt = [
    `Customer: ${hint.name}`,
    `Stage: ${hint.stage}`,
    `Intent score: ${hint.intentScore}`,
    `Product: ${hint.product}`,
    'Recent timeline:',
    hint.timeline.map(item => `- ${item}`).join('\n'),
    '',
    buildKnowledgePromptBlock(context),
    buildStrategyPromptBlock(strategies),
    '',
    'Return only 2-3 short suggestions, one per line.',
  ].join('\n');

  try {
    const raw = await callLLM(prompt, { systemPrompt: SYSTEM_PROMPT });
    const items = parseSuggestions(raw);
    res.json({ items: items.length > 0 ? items : fallback, evidence: [...context.evidence, ...strategyEvidence(strategies)] });
  } catch {
    res.json({ items: fallback, evidence: [...context.evidence, ...strategyEvidence(strategies)] });
  }
});

function fallbackSuggestions(hint: CustomerHint): string[] {
  if (hint.stage === 'call_request') {
    return [
      `生成一条给 ${hint.name} 的通话承接回复，并询问方便通话的时间。`,
      `整理一份围绕 ${hint.product} 和采购数量的简短通话简报。`,
      '确认经理会亲自跟进，先把客户稳住。',
    ];
  }

  if (hint.stage === 'silent60' || hint.stage === 'silent30') {
    return [
      `给 ${hint.name} 写一条自然的老客唤醒消息，给对方一个回复理由。`,
      `围绕 ${hint.product} 推荐一个不催促的跟进角度。`,
      '询问客户是否还需要样品或新版目录。',
    ];
  }

  if (hint.intentScore >= 75) {
    return [
      `为 ${hint.product} 生成一条简洁的报价跟进。`,
      '用一条消息确认数量、目的港和包装偏好。',
      '把客户自然推进到样品确认，不要显得催促。',
    ];
  }

  return [
    `继续让 ${hint.name} 由 AI 自动接待，并补问一个客资问题。`,
    `发送一条轻量目录回复，围绕 ${hint.product} 引导客户说出需求。`,
    '先询问目标采购数量，再决定是否转人工跟进。',
  ];
}

function parseSuggestions(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*[-*0-9.)]+\s*/, '').trim())
    .map(line => line.replace(/^["'`]+|["'`]+$/g, '').trim())
    .filter(Boolean)
    .slice(0, 3);
}
