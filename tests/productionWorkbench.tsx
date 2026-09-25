// Development-only interaction fixture. It never calls production or model APIs.
import React from 'react';
import { createRoot } from 'react-dom/client';
import AiCreateStudio from '../src/components/AiCreateStudio';
import '../src/index.css';
const project = { id: 'ui-test-draft', title: '交互测试草稿', status: 'draft', createdAt: '2026-09-12', updatedAt: '2026-09-12', spec: {
  mode: 'product', contentMode: 'video', ratio: '9:16', platform: 'tiktok', lang: 'zh', activeVoiceLang: 'zh', duration: 6,
  productInfo: '测试设备', selectedProductIds: ['product-test'], productSelectMode: 'single', activeAssemblyId: 'video-1', assemblyName: '测试版本', voiceoverMode: 'none',
  script: '[0s-3s]\n画面：设备全景 口播：这是设备介绍。\n\n[3s-6s]\n画面：产品细节 口播：查看产品细节。',
  storyboardAssignments: {}, storyboardSourcePlans: {}, selected: [],
} };
let defaults = { preference: 'auto', defaultPresenterId: 'alice', presenters: [{ id: 'alice', name: '测试讲解人', avatarId: 'fixture-only', voiceId: 'fixture-only', authorized: true, supportsAlpha: false }] };
const tasks: any[] = [];
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
  if (!path.includes('/api/')) return nativeFetch(input, init);
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  if (path.includes('/enterprise/profile')) return json({ company: { name: '测试企业' }, products: { categories: '设备', items: [{ id: 'product-test', name: '测试设备', category: '设备' }] }, socialStrategy: { preferredLanguage: 'zh', businessLanguages: ['zh'] } });
  if (path.includes('/production/capabilities')) return json({ configured: false, reason: '交互测试不连接供应商', costPerSecond: null, tools: [
    { id: 'heygen', label: 'HeyGen 人物口播', execution: false, reason: '交互测试不连接供应商' },
    { id: 'runway_kling_motion', label: 'Kling', execution: false, reason: 'Kling 尚未注册真实执行适配器' },
    { id: 'runway_seedance', label: 'Seedance（SD）', execution: false, reason: 'Seedance 参考人物服务未启用' },
    { id: 'runway_act_two', label: 'Runway', execution: false, reason: 'Runway 未配置' },
    { id: 'local_head_pipeline', label: '自有模型 · 本地逐帧处理', execution: false, reason: '本地处理器未启用' },
    { id: 'self_hosted_video', label: '自有数字人模型', execution: false, reason: '自有模型尚未注册真实执行适配器' },
  ] });
  if (path.includes('/production/defaults')) { if (init?.method === 'POST') defaults = body; return json(defaults); }
  if (path.includes('/production/jobs')) return json([]);
  if (path.endsWith('/projects')) { if (init?.method === 'POST') { Object.assign(project, body); return json({ ok: true, project }); } return json([project]); }
  if (path.endsWith('/shooting-tasks')) { if (init?.method === 'POST') { const task = { ...body, id: crypto.randomUUID(), origin: 'script_gap', uploadedMaterialIds: [], createdAt: new Date().toISOString() }; tasks.push(task); return json(task); } return json(tasks); }
  if (path.includes('/capabilities')) return json({ customVoice: { upload: true, synthesis: false, engines: {} }, transcription: { available: false } });
  if (init?.method === 'POST') return json({ ok: false, error: '交互测试禁止外部生成调用' }, 503);
  return json([]);
};
localStorage.setItem('ow_studio_open_project', JSON.stringify({ projectId: project.id, shooting: true, at: Date.now() }));
createRoot(document.getElementById('root')!).render(<div style={{ height: '100vh' }}><AiCreateStudio /></div>);
