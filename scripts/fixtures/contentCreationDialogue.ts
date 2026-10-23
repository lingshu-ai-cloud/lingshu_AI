import type { CreationEvidencePorts } from '../../server/assistantContext/contentCreationDialogue.js';
export function creationDialogueFixture() {
  const analysis = { analysisMode: 'exact', analysisRunId: 'offline-fixture-run', analysisQuality: 'full', geminiStatus: 'analyzed', gemini: {
    theme: '受控夹具产品介绍', hooks: ['观察开场动作'], structure: '开场 → 工厂 → 产品',
    scriptDetails15s: [{ time: '0-3', visual: '手持产品展示包装', purpose: '开场钩子', materialType: 'product', narrativeRole: 'hook', classificationEvidence: '受控夹具逐镜观察', needsReview: false }],
  } };
  const reference: Record<string, unknown> = { id: 'fixture-video', tenantId: 'fixture', title: '受控夹具 · 爆款参考', platform: 'tiktok', sourceUrl: 'https://www.tiktok.com/@fixture/video/123', duration: 3, status: 'analyzed', aiAnalysis: JSON.stringify(analysis), crawledAt: '2026-10-24T00:00:00Z' };
  const profile = { company: { name: '受控夹具企业' }, products: { items: [{ id: 'fixture-product', name: '样品杯', highlights: '杯身为白色' }, { id: 'fixture-product-2', name: '样品盖', highlights: '外观为圆形' }] } };
  const materials = [0, 1, 2].map(index => ({ id: `fixture-material-${index}`, tenantId: 'fixture', name: `受控夹具 · ${index < 2 ? '工厂' : '产品'}片段 ${index + 1}`, type: 'video', productId: index === 2 ? 'fixture-product' : '', segments: [{ id: `segment-${index}`, start: 0, end: 3, needsReview: false, materialType: index < 2 ? 'factory' : 'product', productVisible: index === 2, action: index < 2 ? '机器正在装配杯身' : '白色杯身正面', observedFacts: index < 2 ? '机器正在装配杯身' : '白色杯身正面' }] }));
  const ports: CreationEvidencePorts = { reference: async (tenant, id) => id === reference.id && tenant === reference.tenantId ? reference : null, profile: async () => profile, materials: async () => ({ items: materials, status: 'ready' }), presenters: async () => [] };
  return { reference, profile, materials, ports };
}
