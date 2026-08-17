import type { CustomerProfile } from '../types/customer';

export function createMockCustomers(): CustomerProfile[] {
  const receivedAt = Date.now() - 90_000;
  const receivedTime = new Date(receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return [{
    id: 'mock-customer-conversation', name: 'Emily Carter', avatar: 'E', countryName: '美国', language: 'English', languageLocked: true,
    source: 'whatsapp', product: '', outboundProduct: '', estimatedValue: '待评估',
    stage: 'lead', intentScore: 50, intentSignals: ['新询盘'], handlingMode: 'ai_draft', handlingReason: '已收到测试询盘，等待 AI 建议',
    priority: 70, inboxReason: 'reply', lastActive: '刚刚', localTime: '10:30', orders: [], tags: ['Mock', '回复质量测试'],
    summary: 'Mock 客户刚刚发来第一条询盘，用于验证智能客服能否自动生成建议回复。', nextStep: '查看并确认 AI 建议回复', timeline: [{
      id: 'mock-initial-buyer-message',
      type: 'whatsapp',
      actor: 'buyer',
      title: '客户消息',
      body: 'Hi, I saw your products on Instagram. What do you have?',
      time: receivedTime,
      timestamp: receivedAt,
    }],
    hasUnread: true, lastActiveAt: receivedAt, isReal: false, isMock: true,
  }];
}
