import { Router, type NextFunction, type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { testShopify } from '../integrations/shopify.js';
import { callLLM } from '../agents/llm.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdminUser } from '../lib/demoAccounts.js';
import {
  mutatePluginRegistry,
  PluginRegistryUnavailableError,
  readPluginRegistry,
  type StoredPlugin,
} from '../lib/pluginRegistry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.NODE_ENV === 'test' && process.env.PLUGINS_DATA_FILE
  ? path.resolve(process.env.PLUGINS_DATA_FILE)
  : path.join(__dirname, '../../data/plugins.json');

export type Plugin = StoredPlugin;

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

const TENANT_USABLE_PLUGIN_KEYS = new Set(['exchangerate', 'translate']);

async function fetchExchangeRates() {
  const r = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
  if (!r.ok) throw new Error(`exchange rate api ${r.status}`);
  const data = await r.json() as { provider?: string; base?: string; date?: string; rates?: Record<string, number> };
  if (!data?.rates?.CNY || !data.rates.SAR || !data.rates.AED) throw new Error('invalid exchange rate payload');
  return { ...data, rates: data.rates, source: 'live' as const };
}

export function pluginToPublic(
  plugin: Plugin,
  installed = true,
  options: { managementAllowed?: boolean; tenantUsable?: boolean } = {},
) {
  const managementAllowed = options.managementAllowed === true;
  return {
    id: plugin.id,
    pluginKey: plugin.pluginKey,
    name: plugin.name,
    nameZh: plugin.nameZh,
    category: plugin.category,
    description: plugin.description,
    icon: plugin.icon,
    status: plugin.status,
    ...(managementAllowed && plugin.installedAt ? { installedAt: plugin.installedAt } : {}),
    installed,
    managementAllowed,
    tenantUsable: options.tenantUsable === true,
    configuredFields: managementAllowed
      ? Object.entries(plugin.config)
        .filter(([, value]) => String(value || '').trim().length > 0)
        .map(([key]) => key)
      : [],
  };
}

function mergeWithCatalog(installed: Plugin[], managementAllowed: boolean) {
  return PLUGIN_CATALOG.map(cat => {
    const tenantUsable = TENANT_USABLE_PLUGIN_KEYS.has(cat.pluginKey);
    if (!managementAllowed) {
      return { ...cat, status: tenantUsable ? 'installed' as const : 'not_installed' as const, installed: tenantUsable, managementAllowed: false, tenantUsable, configuredFields: [] as string[] };
    }
    const inst = installed.find(p => p.pluginKey === cat.pluginKey);
    return inst
      ? pluginToPublic(inst, true, { managementAllowed, tenantUsable })
      : { ...cat, status: 'not_installed' as const, installed: false, managementAllowed, tenantUsable, configuredFields: [] as string[] };
  });
}

export const pluginsRouter = Router();

async function requireInternalAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }
  next();
}

function registryUnavailable(res: Response, error: unknown): void {
  console.error('[plugin-registry]', {
    errorType: error instanceof Error ? error.name : 'UnknownError',
  });
  res.status(503).json({ error: 'plugin_registry_unavailable' });
}

function configPatch(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  return entries.every(([, item]) => typeof item === 'string') ? Object.fromEntries(entries) : null;
}

// Every plugin endpoint requires a signed-in tenant. Global plugin
// configuration remains internal-only; tenant-facing utility calls stay
// available until they move behind the capability/quota service.
pluginsRouter.use(requireAuth);

pluginsRouter.get('/', async (req, res) => {
  const managementAllowed = Boolean(await requireAdminUser(req));
  try {
    res.json(mergeWithCatalog(managementAllowed ? readPluginRegistry(DATA) : [], managementAllowed));
  } catch (error) {
    registryUnavailable(res, error);
  }
});

pluginsRouter.post('/:key/install', requireInternalAdmin, async (req: Request, res: Response) => {
  const cat = PLUGIN_CATALOG.find(p => p.pluginKey === req.params.key);
  if (!cat) { res.status(404).json({ error: 'unknown plugin' }); return; }
  try {
    const plugin = await mutatePluginRegistry(DATA, plugins => {
      if (plugins.find(p => p.pluginKey === req.params.key)) throw Object.assign(new Error('already installed'), { status: 409 });
      const created: Plugin = { ...cat, status: 'installed', config: {}, installedAt: new Date().toISOString() };
      return { plugins: [...plugins, created], result: created };
    });
    res.json(pluginToPublic(plugin, true, { managementAllowed: true, tenantUsable: TENANT_USABLE_PLUGIN_KEYS.has(plugin.pluginKey) }));
  } catch (error) {
    if ((error as { cause?: { status?: number } })?.cause?.status === 409) res.status(409).json({ error: 'already installed' });
    else registryUnavailable(res, error);
  }
});

pluginsRouter.put('/:key/config', requireInternalAdmin, async (req: Request, res: Response) => {
  const patch = configPatch(req.body);
  if (!patch) { res.status(400).json({ error: 'invalid_plugin_config' }); return; }
  try {
    const plugin = await mutatePluginRegistry(DATA, plugins => {
      const idx = plugins.findIndex(p => p.pluginKey === req.params.key);
      if (idx === -1) throw Object.assign(new Error('not installed'), { status: 404 });
      const updated = { ...plugins[idx], config: { ...plugins[idx].config, ...patch } };
      return { plugins: plugins.map((item, index) => index === idx ? updated : item), result: updated };
    });
    res.json(pluginToPublic(plugin, true, { managementAllowed: true, tenantUsable: TENANT_USABLE_PLUGIN_KEYS.has(plugin.pluginKey) }));
  } catch (error) {
    if ((error as { cause?: { status?: number } })?.cause?.status === 404) res.status(404).json({ error: 'not installed' });
    else registryUnavailable(res, error);
  }
});

pluginsRouter.delete('/:key', requireInternalAdmin, async (req: Request, res: Response) => {
  try {
    await mutatePluginRegistry(DATA, plugins => ({ plugins: plugins.filter(p => p.pluginKey !== req.params.key), result: undefined }));
    res.json({ ok: true });
  } catch (error) {
    registryUnavailable(res, error);
  }
});

pluginsRouter.post('/:key/test', requireInternalAdmin, async (req: Request, res: Response) => {
  let plugin: Plugin | undefined;
  try {
    plugin = readPluginRegistry(DATA).find(p => p.pluginKey === req.params.key);
    if (!plugin) { res.status(404).json({ error: 'not installed' }); return; }
  } catch (error) {
    registryUnavailable(res, error);
    return;
  }

  try {
    switch (plugin.pluginKey) {
      case 'shopify': {
        const result = await testShopify(plugin.config as any);
        await updateStatus(plugin.id, result.ok ? 'installed' : 'error');
        res.json(result);
        break;
      }
      case 'exchangerate': {
        const data = await fetchExchangeRates();
        await updateStatus(plugin.id, 'installed');
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
        await updateStatus(plugin.id, 'installed');
        res.json({ ok: true, source: 'qwen', message: '千问翻译引擎连接成功' });
        break;
      case 'google_translate': {
        const apiKey = plugin.config.apiKey;
        if (!apiKey) throw new Error('请先配置 Google Cloud Translation API Key');
        const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: 'hello', target: 'zh' }),
        });
        if (!response.ok) throw new Error(`Google Translate API ${response.status}`);
        await updateStatus(plugin.id, 'installed');
        res.json({ ok: true, source: 'google', message: 'Google 翻译连接成功' });
        break;
      }
      default:
        res.json({ ok: false, message: '该插件需要配置 API Key 后测试' });
    }
  } catch (error) {
    if (error instanceof PluginRegistryUnavailableError) { registryUnavailable(res, error); return; }
    try { await updateStatus(plugin.id, 'error'); }
    catch (registryError) { registryUnavailable(res, registryError); return; }
    console.error('[plugin-test]', { pluginKey: plugin.pluginKey, errorType: error instanceof Error ? error.name : 'UnknownError' });
    res.status(502).json({ ok: false, error: 'plugin_test_failed', message: '插件连接测试失败' });
  }
});

async function updateStatus(id: string, status: Plugin['status']) {
  await mutatePluginRegistry(DATA, plugins => ({
    plugins: plugins.map(plugin => plugin.id === id ? { ...plugin, status } : plugin),
    result: undefined,
  }));
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
    console.error('[plugin-translate]', { errorType: error instanceof Error ? error.name : 'UnknownError' });
    res.status(502).json({ error: 'translation_service_unavailable', message: '翻译服务不可用' });
  }
});
