import type { CustomerProfile } from '../types/customer';

/** Local quotation conversations: no real channel identifiers or recipients. */
export function createQuoteMockCustomers(): CustomerProfile[] {
  const scenarios = [
    { name: 'Alex · 完整询盘', whatsappProfileName: 'Alex', country: '美国', language: 'English', product: 'CNC aluminum bracket', goal: '提取数量、材料、交期、目的地和贸易术语，核对目录价格或人工补价', messages: [
      'Hi, we are sourcing CNC aluminum brackets for an assembly project. Can you help with a quotation?',
      'Certainly. Please share your quantity, material, delivery location and target date.',
      'Please quote 500 pcs CNC aluminum bracket, material 6061 aluminum. Delivery to Los Angeles. FOB Shanghai, within 30 days. Export cartons. Payment terms: 30% deposit, 70% before shipment. Drawing revision B2.',
    ] },
    { name: '陈女士 · 待补信息', whatsappProfileName: '陈女士', country: '中国', language: '中文', product: '', goal: '缺少产品、数量和交付信息时，先生成澄清问题', messages: [
      '你好，我们有一个新项目，想了解一下你们的产品价格。',
      '您好，请问需要哪款产品，预计采购多少？',
      '型号还没确定，数量也要等工程师确认，可以先给我报价吗？',
    ] },
    { name: 'Emma · 小批量试单', whatsappProfileName: 'Emma', country: '英国', language: 'English', product: 'CNC aluminum bracket', goal: '检查小批量需求；若匹配目录设有 MOQ，应提示起订量限制', messages: [
      'We would like to test samples before placing a bulk order.',
      'What quantity and specification do you need for the trial?',
      'Please quote 2 pcs CNC aluminum bracket, material 6061 aluminum. Delivery to London. DAP, within 14 days. We can pay 100% in advance. Is this below your MOQ?',
    ] },
    { name: '王经理 · 非标定制', whatsappProfileName: '王经理', country: '中国', language: '中文', product: '定制检测治具 QTEST-X9', goal: '目录无可核验价格时保持待人工报价，可手填单价后确认', messages: [
      '我们想做一批非标检测治具，需要按图纸加工。',
      '请提供数量、材质和交付要求，我们核算后报价。',
      '请报价 80 件定制检测治具 QTEST-X9，材料 SUS304，图纸版本 C3。目的地：苏州。EXW，交期 25 天，付款方式为 30% 预付款、70% 发货前付清。',
    ] },
    { name: 'Daniel · 改量议价', whatsappProfileName: 'Daniel', country: '德国', language: 'English', product: 'CNC aluminum bracket', goal: '调试改量提取和报价新版本；客户目标价不应成为目录单价', messages: [
      'Please quote 200 pcs CNC aluminum bracket in 6061 aluminum, delivery to Berlin. DAP, within 30 days. Payment: 30% deposit and 70% before shipment.',
      'Thanks. We will review the specification and prepare a quotation.',
      'Please revise the quotation: we now need 1000 pcs instead of the earlier quantity. Our target is USD 8 per piece, subject to your approval. Same specification and delivery terms.',
    ] },
  ];
  return scenarios.map((scenario, index) => {
    const id = `mock-quote-debug-${index + 1}`;
    const timestamp = Date.now() - index * 60_000;
    return {
      id, name: scenario.name, whatsappProfileName: scenario.whatsappProfileName, avatar: scenario.name.slice(0, 1), countryName: scenario.country,
      language: scenario.language, languageLocked: true, source: 'whatsapp',
      product: scenario.product, outboundProduct: scenario.product, estimatedValue: '待报价',
      stage: 'inquiry', intentScore: 85 - index * 5, intentSignals: ['报价调试模拟询盘'],
      handlingMode: 'human_needed', handlingReason: scenario.goal, isReal: false, isMock: true,
      hasUnread: true, priority: 90 - index, inboxReason: 'reply', lastActive: '刚刚', lastActiveAt: timestamp,
      localTime: '', orders: [], tags: ['模拟客户', '报价调试'], summary: scenario.goal,
      nextStep: '打开报价能力卡，生成报价草稿',
      simulation: { checkpoint: scenario.name, goal: scenario.goal, expectedBehavior: scenario.goal, editable: true },
      timeline: scenario.messages.map((body, messageIndex) => ({
        id: `${id}-message-${messageIndex}`, type: 'whatsapp', actor: messageIndex === 1 ? 'seller' : 'buyer',
        title: messageIndex === 1 ? '我的回复' : '客户消息', body,
        timestamp: timestamp - (2 - messageIndex) * 60_000,
        time: new Date(timestamp - (2 - messageIndex) * 60_000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      })),
    };
  });
}
