import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { testShopify } from '../integrations/shopify.js';
import { callLLM } from '../agents/llm.js';
import type { AuthLocals } from '../middleware/auth.js';
import { randomUUID } from 'node:crypto';
import { decryptCredential, encryptCredential, isCredentialEnvelope } from '../security/credentialEnvelope.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.join(__dirname, '../../data/plugin-configs/tenants');

export interface Plugin {
  id: string;
  pluginKey: string;  // 'shopify' | 'exchangerate' | 'translate' | 'tiktok_ads' | ...
  name: string;
  nameZh: string;
  category: 'ecommerce' | 'social' | 'tool' | 'ai';
  description: string;
  icon: string;       // emoji
  status: 'installed' | 'not_installed' | 'error';
  config: Record<string, string>;
  installedAt?: string;
}

interface StoredPlugin extends Omit<Plugin, 'config'> {
  configCipher: string;
  configKeys: string[];
}

const PLUGIN_CATALOG: Omit<Plugin, 'status' | 'config' | 'installedAt'>[] = [
  { id: 'shopify', pluginKey: 'shopify', name: 'Shopify', nameZh: 'Shopify 店铺', category: 'ecommerce', description: '同步 Shopify 订单、商品和客户数据，AI 自动分析店铺经营数据', icon: '🛍️' },
  { id: 'exchangerate', pluginKey: 'exchangerate', name: 'Exchange Rate', nameZh: '实时汇率', category: 'tool', description: '实时获取 USD/CNY/SAR/AED/VND/MYR/IDR 汇率，自动换算报价', icon: '💱' },
  { id: 'translate', pluginKey: 'translate', name: 'AI Translation', nameZh: 'AI 多语言翻译', category: 'ai', description: '支持阿拉伯语、马来语、印尼语、英语等跨境主流语言互译', icon: '🌐' },
  { id: 'tiktok', pluginKey: 'tiktok', name: 'TikTok', nameZh: 'TikTok', category: 'social', description: '连接 TikTok 账号，读取视频、评论和互动数据，并支持我的社媒一键发布短视频', icon: '🎵' },
  { id: 'google_translate', pluginKey: 'google_translate', name: 'Google Translate', nameZh: 'Google 翻译', category: 'tool', description: '调用 Google Cloud Translation API 实现高质量多语言翻译', icon: '🔤' },
  { id: 'amazon', pluginKey: 'amazon', name: 'Amazon SP-API', nameZh: 'Amazon 卖家', category: 'ecommerce', description: '同步 Amazon 订单和库存数据（需要卖家账号授权）', icon: '📦' },
  { id: 'instagram', pluginKey: 'instagram', name: 'Instagram', nameZh: 'Instagram', category: 'social', description: '连接 Instagram 专业账号，读取 Reels、评论和互动数据，并支持内容发布', icon: '📷' },
  { id: 'facebook', pluginKey: 'facebook', name: 'Facebook', nameZh: 'Facebook', category: 'social', description: '连接 Facebook Page，读取主页视频和评论，并支持将 AI 生成内容发布到主页', icon: '👍' },
];

async function fetchExchangeRates() {
  const r = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
  if (!r.ok) throw new Error(`exchange rate api ${r.status}`);
  const data = await r.json() as { provider?: string; base?: string; date?: string; rates?: Record<string, number> };
  if (!data?.rates?.CNY || !data.rates.SAR || !data.rates.AED) throw new Error('invalid exchange rate payload');
  return { ...data, rates: data.rates, source: 'live' as const };
}

export function pluginTenantConfigFile(tenantId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(tenantId)) throw new Error('invalid_tenant_id');
  return path.join(DATA_ROOT, `${tenantId}.json`);
}

function pluginCredentialContext(tenantId: string, pluginKey: string) {
  return { scope: 'plugin_config' as const, tenantId, recordId: pluginKey, platform: pluginKey, field: 'configCipher' };
}

function decodeConfig(tenantId: string, record: StoredPlugin): Record<string, string> {
  const decrypted = decryptCredential(record.configCipher, pluginCredentialContext(tenantId, record.pluginKey));
  if (!decrypted.ok) return {};
  try {
    const parsed = JSON.parse(decrypted.value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
      .filter(([key, value]) => /^[a-zA-Z0-9_.-]{1,100}$/.test(key) && typeof value === 'string')
      .map(([key, value]) => [key, String(value).slice(0, 20_000)]));
  } catch { return {}; }
}

function load(tenantId: string): Plugin[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(pluginTenantConfigFile(tenantId), 'utf8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const record = value as StoredPlugin;
      if (!record.id || !record.pluginKey || !isCredentialEnvelope(record.configCipher)) return [];
      const { configCipher: _configCipher, configKeys: _configKeys, ...plugin } = record;
      return [{ ...plugin, config: decodeConfig(tenantId, record) } as Plugin];
    });
  } catch { return []; }
}

function save(tenantId: string, plugins: Plugin[]) {
  const file = pluginTenantConfigFile(tenantId);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const stored: StoredPlugin[] = plugins.map(({ config, ...plugin }) => ({
    ...plugin,
    configCipher: encryptCredential(JSON.stringify(config), pluginCredentialContext(tenantId, plugin.pluginKey)),
    configKeys: Object.keys(config).sort(),
  }));
  const temporary = `${file}.${process.pid}-${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(stored, null, 2), { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

export function pluginPublicView(plugin: Plugin): Plugin & { configuredFields: string[] } {
  const configuredFields = Object.keys(plugin.config).sort();
  return { ...plugin, config: Object.fromEntries(configuredFields.map(key => [key, ''])), configuredFields };
}

function mergeWithCatalog(installed: Plugin[]): Array<Plugin & { installed: boolean; configuredFields?: string[] }> {
  return PLUGIN_CATALOG.map(cat => {
    const inst = installed.find(p => p.pluginKey === cat.pluginKey);
    return inst
      ? { ...pluginPublicView(inst), installed: true }
      : { ...cat, status: 'not_installed' as const, config: {}, installed: false };
  });
}

export const pluginsRouter = Router();

pluginsRouter.get('/', (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  res.json(mergeWithCatalog(load(tenantId)));
});

pluginsRouter.post('/:key/install', (req: Request, res: Response) => {
  const { tenantId } = res.locals as AuthLocals;
  const plugins = load(tenantId);
  const cat = PLUGIN_CATALOG.find(p => p.pluginKey === req.params.key);
  if (!cat) { res.status(404).json({ error: 'unknown plugin' }); return; }
  if (plugins.find(p => p.pluginKey === req.params.key)) { res.status(409).json({ error: 'already installed' }); return; }
  const plugin: Plugin = { ...cat, status: 'installed', config: {}, installedAt: new Date().toISOString() };
  plugins.push(plugin);
  save(tenantId, plugins);
  res.json(pluginPublicView(plugin));
});

pluginsRouter.put('/:key/config', (req: Request, res: Response) => {
  const { tenantId } = res.locals as AuthLocals;
  const plugins = load(tenantId);
  const idx = plugins.findIndex(p => p.pluginKey === req.params.key);
  if (idx === -1) { res.status(404).json({ error: 'not installed' }); return; }
  const patch = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {};
  const config = { ...plugins[idx].config };
  for (const [key, value] of Object.entries(patch)) {
    if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) continue;
    if (value === null) { delete config[key]; continue; }
    if (typeof value !== 'string' || !value.trim()) continue;
    if (value.length > 20_000) { res.status(413).json({ error: 'plugin_config_value_too_large' }); return; }
    config[key] = value.trim();
  }
  plugins[idx].config = config;
  save(tenantId, plugins);
  res.json(pluginPublicView(plugins[idx]));
});

pluginsRouter.delete('/:key', (req: Request, res: Response) => {
  const { tenantId } = res.locals as AuthLocals;
  save(tenantId, load(tenantId).filter(p => p.pluginKey !== req.params.key));
  res.json({ ok: true });
});

pluginsRouter.post('/:key/test', async (req: Request, res: Response) => {
  const { tenantId } = res.locals as AuthLocals;
  const plugin = load(tenantId).find(p => p.pluginKey === req.params.key);
  if (!plugin) { res.status(404).json({ error: 'not installed' }); return; }

  try {
    switch (plugin.pluginKey) {
      case 'shopify': {
        const result = await testShopify(plugin.config as any);
        updateStatus(tenantId, plugin.id, result.ok ? 'installed' : 'error');
        res.json(result);
        break;
      }
      case 'exchangerate': {
        const data = await fetchExchangeRates();
        updateStatus(tenantId, plugin.id, 'installed');
        res.json({
          ok: true,
          source: data.source,
          message: data.source === 'live' ? '连接成功' : '连接成功',
          rates: { CNY: data.rates.CNY, SAR: data.rates.SAR, AED: data.rates.AED },
        });
        break;
      }
      case 'translate':
        await callLLM('Reply with OK only.', { backend: 'qwen', systemPrompt: 'This is a connectivity check.' });
        updateStatus(tenantId, plugin.id, 'installed');
        res.json({ ok: true, source: 'qwen', message: '千问翻译引擎连接成功' });
        break;
      case 'google_translate': {
        const apiKey = plugin.config.apiKey;
        if (!apiKey) throw new Error('请先配置 Google Cloud Translation API Key');
        const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: 'hello', target: 'zh' }),
        });
        if (!response.ok) throw new Error(`Google Translate API ${response.status}`);
        updateStatus(tenantId, plugin.id, 'installed');
        res.json({ ok: true, source: 'google', message: 'Google 翻译连接成功' });
        break;
      }
      default:
        res.json({ ok: false, message: '该插件需要配置 API Key 后测试' });
    }
  } catch (err: any) {
    updateStatus(tenantId, plugin.id, 'error');
    res.status(500).json({ ok: false, error: err.message });
  }
});

function updateStatus(tenantId: string, id: string, status: Plugin['status']) {
  const plugins = load(tenantId);
  const idx = plugins.findIndex(p => p.id === id);
  if (idx !== -1) { plugins[idx].status = status; save(tenantId, plugins); }
}

// Exchange rate shortcut
pluginsRouter.get('/exchangerate/rates', async (_req, res) => {
  try { res.json(await fetchExchangeRates()); }
  catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : '汇率服务不可用' }); }
});

pluginsRouter.post('/translate/run', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  const source = String(req.body?.source || 'auto');
  const target = String(req.body?.target || '').trim();
  if (!text || !target) { res.status(400).json({ error: 'text and target required' }); return; }
  try {
    const translatedText = await callLLM(text, {
      backend: 'qwen',
      systemPrompt: `Translate from ${source} to ${target}. Return only the translation, without explanation or quotation marks. Preserve names, numbers and formatting.`,
    });
    res.json({ ok: true, source: 'qwen', translatedText: translatedText.trim() });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : '翻译服务不可用' });
  }
});
