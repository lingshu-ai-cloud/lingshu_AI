import '../server/loadEnvironment.js';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { localAccountRecordsFile, readLocalAccountRecords, writeLocalAccountRecords } from '../server/lib/localAccountStore.js';
import { createLocalDataTenant, getLocalTenant, updateLocalDataTenant } from '../server/lib/localTenants.js';
import { runWithDataAuthority } from '../server/storage/dataAuthority.js';
import { store } from '../server/storage/index.js';
import { updateTenantEnterpriseProfile } from '../server/routes/enterprise.js';
import { buildSocialCrawlStrategy } from '../shared/socialInspirationStrategy.js';
import { readLocalMaterials, saveLocalMaterials } from '../server/lib/materialLibrary.js';
import { analysisFileRevision } from '../server/lib/materialLibraryAnalysis.js';
import { buildMaterialScriptAnalysis } from '../shared/materialScriptAnalysis.js';

const EMAIL = String(process.env.BEAUTY_SHOWCASE_EMAIL || 'beauty-showcase@local.test').trim().toLowerCase();
const PASSWORD = String(process.env.BEAUTY_SHOWCASE_PASSWORD || '');
const TENANT_ID = 'local_tenant_customer_aurelia_beauty';
const USER_ID = 'local_user_customer_aurelia_beauty';
const COMPANY = 'Aurelia 澄光美研有限公司';
const BATCH = 'beauty_showcase_v2';
const mediaRoot = path.resolve(process.cwd(), 'data', 'media');
const assetRelativeDir = path.posix.join('tenants', TENANT_ID);
const assetDir = path.join(mediaRoot, assetRelativeDir);

if (PASSWORD && PASSWORD.length < 10) throw new Error('BEAUTY_SHOWCASE_PASSWORD must contain at least 10 characters when provided');
if (EMAIL === 'lingshu-admin@local.test') throw new Error('Beauty showcase must never use the administrator account');

type Product = {
  sku: string;
  name: string;
  shortName: string;
  category: string;
  color: string;
  accent: string;
  highlights: string;
  scene: string;
  hook: string;
};

const products: Product[] = [
  { sku: 'AB-SERUM-01', name: '积雪草屏障修护精华', shortName: 'BARRIER SERUM', category: '面部精华', color: '#dff1e8', accent: '#2c6652', highlights: '轻薄水感质地；适合日常保湿修护步骤；无香型', scene: '敏感泛红后的晚间护肤', hook: '一滴精华在镜面上快速铺开，前三秒直接展示流动质地' },
  { sku: 'AB-SPF-02', name: '清透防晒乳 SPF50+', shortName: 'DAILY SUNSCREEN', category: '防晒', color: '#fff0c9', accent: '#d0872e', highlights: '轻薄肤感；适合妆前使用；SPF50+ PA++++', scene: '通勤前快速防晒', hook: '左右手背涂抹对比，首秒出现半边推开画面' },
  { sku: 'AB-CLEAN-03', name: '氨基酸云朵洁面慕斯', shortName: 'CLOUD CLEANSER', category: '洁面', color: '#dff2fa', accent: '#3283a7', highlights: '按压泡沫；温和清洁；易冲洗', scene: '早晨快速洁面', hook: '按压瞬间形成绵密泡沫，用体积变化制造开场反差' },
  { sku: 'AB-LIP-04', name: '丝绒持色唇釉 04 枫糖棕', shortName: 'VELVET LIP TINT', category: '彩妆', color: '#f6d7d5', accent: '#9d3f43', highlights: '枫糖棕色；丝绒妆效；薄涂与叠涂均可', scene: '通勤妆容快速提气色', hook: '白卡上一笔显色，从空白到高饱和色块' },
  { sku: 'AB-CREAM-05', name: '神经酰胺锁水面霜', shortName: 'CERAMIDE CREAM', category: '面霜', color: '#eee5fb', accent: '#7654a8', highlights: '绵密乳霜质地；夜间保湿步骤；无香型', scene: '睡前锁水护肤', hook: '挖取面霜后倒置勺面，展示绵密挂壁质地' },
];

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function svgFor(product: Product, index: number): string {
  const shapes = index % 2 === 0
    ? `<rect x="256" y="350" width="208" height="520" rx="70" fill="white" opacity=".96"/><rect x="306" y="280" width="108" height="100" rx="24" fill="${product.accent}"/>`
    : `<rect x="235" y="390" width="250" height="420" rx="38" fill="white" opacity=".96"/><rect x="285" y="315" width="150" height="95" rx="22" fill="${product.accent}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${product.color}"/><stop offset="1" stop-color="#ffffff"/></linearGradient><filter id="shadow"><feDropShadow dx="0" dy="24" stdDeviation="28" flood-opacity=".16"/></filter></defs>
    <rect width="720" height="1280" fill="url(#bg)"/><circle cx="100" cy="220" r="180" fill="${product.accent}" opacity=".08"/><circle cx="650" cy="1030" r="250" fill="${product.accent}" opacity=".1"/>
    <g filter="url(#shadow)">${shapes}</g>
    <text x="360" y="120" text-anchor="middle" font-family="Arial,sans-serif" font-size="25" letter-spacing="6" fill="${product.accent}">AURELIA LAB</text>
    <text x="360" y="930" text-anchor="middle" font-family="Arial,sans-serif" font-size="34" font-weight="700" fill="${product.accent}">${product.shortName}</text>
    <text x="360" y="980" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" letter-spacing="3" fill="#52605c">REAL PRODUCT FOOTAGE</text>
    <rect x="110" y="1055" width="500" height="2" fill="${product.accent}" opacity=".25"/><text x="360" y="1110" text-anchor="middle" font-family="Arial,sans-serif" font-size="21" fill="#42514c">${product.scene}</text>
  </svg>`;
}

type OpenBeautyMaterialSource = {
  id: string;
  name: string;
  downloadUrl: string;
  sourceUrl: string;
  creator: string;
  licenseName: 'CC0 1.0' | 'CC BY 2.0';
  licenseUrl: string;
  description: string;
  shotFunction: 'hook' | 'demonstration' | 'proof' | 'closing';
  tags: string[];
};

const openBeautyMaterialSources: OpenBeautyMaterialSource[] = [
  {
    id: 'korean-cosmetics',
    name: '韩系护肤品组合陈列',
    downloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Korean_cosmetic_products.jpg/1280px-Korean_cosmetic_products.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Korean_cosmetic_products.jpg',
    creator: 'Jmh65890',
    licenseName: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    description: '多件护肤产品组合陈列，可用于产品矩阵、合集和开场铺陈。',
    shotFunction: 'hook',
    tags: ['美妆', '护肤品', '产品组合', '陈列', '开场'],
  },
  {
    id: 'pink-cosmetic-jar',
    name: '粉色面霜罐产品静物',
    downloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/Cosmetic_jar_with_light_pink_product_displayed_on_a_textured_background.jpg/1280px-Cosmetic_jar_with_light_pink_product_displayed_on_a_textured_background.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Cosmetic_jar_with_light_pink_product_displayed_on_a_textured_background.jpg',
    creator: 'Shixart1985',
    licenseName: 'CC BY 2.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
    description: '打开的面霜罐和粉色质地静物，可用于面霜质地与包装展示。',
    shotFunction: 'demonstration',
    tags: ['美妆', '面霜', '质地', '产品静物', '包装'],
  },
  {
    id: 'cucumber-mask',
    name: '黄瓜与绿色面膜护理场景',
    downloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Cucumber_slices_placed_beside_a_green_facial_mask_and_a_skincare_applicator_on_a_light_pink_background.jpg/1280px-Cucumber_slices_placed_beside_a_green_facial_mask_and_a_skincare_applicator_on_a_light_pink_background.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Cucumber_slices_placed_beside_a_green_facial_mask_and_a_skincare_applicator_on_a_light_pink_background.jpg',
    creator: 'Shixart1985',
    licenseName: 'CC BY 2.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
    description: '黄瓜片、绿色面膜与涂抹工具的护理场景，可用于步骤和成分氛围画面。',
    shotFunction: 'demonstration',
    tags: ['美妆', '面膜', '黄瓜', '护理步骤', '涂抹工具'],
  },
  {
    id: 'holding-skincare-jar',
    name: '手持打开的护肤罐使用场景',
    downloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/Person_holding_an_open_jar_of_natural_skincare_product_in_a_cozy_setting_during_daylight.jpg/1280px-Person_holding_an_open_jar_of_natural_skincare_product_in_a_cozy_setting_during_daylight.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Person_holding_an_open_jar_of_natural_skincare_product_in_a_cozy_setting_during_daylight.jpg',
    creator: 'Shixart1985',
    licenseName: 'CC BY 2.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
    description: '自然光环境下手持打开的护肤罐，可用于真人使用和生活方式画面。',
    shotFunction: 'proof',
    tags: ['美妆', '护肤', '手持产品', '真人使用', '生活方式'],
  },
  {
    id: 'makeup-brushes',
    name: '多款化妆刷工具陈列',
    downloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/22/Various_makeup_brushes.jpg/1280px-Various_makeup_brushes.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Various_makeup_brushes.jpg',
    creator: 'Shixart1985',
    licenseName: 'CC BY 2.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
    description: '多款化妆刷静物陈列，可用于彩妆工具、教程和收尾清单画面。',
    shotFunction: 'closing',
    tags: ['美妆', '化妆刷', '彩妆工具', '教程', '陈列'],
  },
];

const tiktokSources = [
  'https://www.tiktok.com/@theordinary/video/7655750764610014472',
  'https://www.tiktok.com/@theordinary/video/7655425971251694855',
  'https://www.tiktok.com/@cerave/video/7655436089930403086',
  'https://www.tiktok.com/@cerave/video/7655435142575475981',
  'https://www.tiktok.com/@theordinary/video/7654315226526977288',
];

type DownloadedMaterial = OpenBeautyMaterialSource & { file: string; width: number; height: number; bytes: number };
type CrawledTikTok = {
  sourceUrl: string;
  title: string;
  authorName: string;
  authorUrl: string;
  thumbnailFile: string;
  videoFile: string;
  duration: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  tags: string[];
};

async function fetchBuffer(url: string): Promise<Buffer> {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LingshuLocalShowcase/1.0)' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch (fetchError) {
    const result = spawnSync('/usr/bin/curl', [
      '--location', '--fail', '--silent', '--show-error', '--retry', '3', '--retry-all-errors', '--max-time', '45',
      '--user-agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36',
      url,
    ], { encoding: null, maxBuffer: 100 * 1024 * 1024 });
    if (result.status !== 0 || !result.stdout?.length) {
      const reason = fetchError instanceof Error ? fetchError.message : String(fetchError);
      throw new Error(`Fetch failed for ${url}: ${reason}; curl=${String(result.stderr || '').trim()}`);
    }
    return result.stdout;
  }
}

function curlBuffer(url: string, extraArgs: string[] = []): Buffer {
  const result = spawnSync('/usr/bin/curl', [
    '--http1.1', '--location', '--fail', '--silent', '--show-error', '--retry', '3', '--retry-all-errors', '--max-time', '60',
    '--user-agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36',
    ...extraArgs,
    url,
  ], { encoding: null, maxBuffer: 100 * 1024 * 1024 });
  if (result.status !== 0 || !result.stdout?.length) throw new Error(`curl failed for ${url}: ${String(result.stderr || '').trim()}`);
  return result.stdout;
}

function crawlTikTokPage(sourceUrl: string, cookieFile: string): Buffer {
  return curlBuffer(sourceUrl, ['--cookie-jar', cookieFile, '--cookie', cookieFile]);
}

function crawlTikTokPlayback(playbackUrl: string, cookieFile: string): Buffer {
  return curlBuffer(playbackUrl, ['--referer', 'https://www.tiktok.com/', '--cookie', cookieFile, '--header', 'Range: bytes=0-']);
}

async function ensureProductAssets(): Promise<string[]> {
  fs.mkdirSync(assetDir, { recursive: true });
  const output: string[] = [];
  for (const [index, product] of products.entries()) {
    const posterFile = path.join(assetDir, `beauty-${index + 1}.png`);
    const obsoleteMockVideo = path.join(assetDir, `beauty-${index + 1}.mp4`);
    if (fs.existsSync(obsoleteMockVideo)) fs.unlinkSync(obsoleteMockVideo);
    await sharp(Buffer.from(svgFor(product, index))).png().toFile(posterFile);
    output.push(posterFile);
  }
  return output;
}

async function crawlOpenBeautyMaterials(): Promise<DownloadedMaterial[]> {
  const results: DownloadedMaterial[] = [];
  for (const source of openBeautyMaterialSources) {
    const file = path.join(assetDir, `open-beauty-${source.id}.jpg`);
    fs.writeFileSync(file, await fetchBuffer(source.downloadUrl));
    const metadata = await sharp(file).metadata();
    if (!metadata.width || !metadata.height) throw new Error(`Invalid open beauty material: ${source.sourceUrl}`);
    results.push({ ...source, file, width: metadata.width, height: metadata.height, bytes: fs.statSync(file).size });
  }
  return results;
}

function firstMetric(html: string, key: string): number {
  const pattern = new RegExp(`"${key}":(?:"(\\d+)"|(\\d+))`, 'g');
  for (const match of html.matchAll(pattern)) {
    const value = Number(match[1] || match[2] || 0);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return 0;
}

function tiktokDuration(html: string): number {
  const playAddress = html.indexOf('"playAddr"');
  const searchArea = playAddress > 0 ? html.slice(Math.max(0, playAddress - 12_000), playAddress) : html;
  const values = Array.from(searchArea.matchAll(/"duration":(\d+)/g)).map(match => Number(match[1])).filter(value => value >= 3 && value <= 600);
  return values.at(-1) || 15;
}

function tiktokPlaybackUrl(html: string): string {
  const match = html.match(/"playAddr":("(?:\\.|[^"\\])*")/);
  if (!match?.[1]) throw new Error('TikTok page does not expose a public playback URL');
  const url = JSON.parse(match[1]) as string;
  if (!/^https:\/\//i.test(url)) throw new Error('TikTok playback URL is invalid');
  return url;
}

function readableMetric(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`;
  return String(value || '—');
}

async function crawlTikTokReferences(): Promise<CrawledTikTok[]> {
  const results: CrawledTikTok[] = [];
  for (const [index, sourceUrl] of tiktokSources.entries()) {
    const cookieFile = path.join(assetDir, `.tiktok-crawl-${index + 1}.cookies`);
    const [oembedBody, pageBody] = await Promise.all([
      Promise.resolve(curlBuffer(`https://www.tiktok.com/oembed?url=${encodeURIComponent(sourceUrl)}`)),
      Promise.resolve(crawlTikTokPage(sourceUrl, cookieFile)),
    ]);
    const oembed = JSON.parse(oembedBody.toString('utf8')) as { title?: string; author_name?: string; author_url?: string; thumbnail_url?: string };
    if (!oembed.title || !oembed.author_name || !oembed.thumbnail_url) throw new Error(`TikTok public metadata is incomplete for ${sourceUrl}`);
    const html = pageBody.toString('utf8');
    const thumbnailFile = path.join(assetDir, `tiktok-reference-${index + 1}.jpg`);
    const videoFile = path.join(assetDir, `tiktok-reference-${index + 1}.mp4`);
    fs.writeFileSync(thumbnailFile, await fetchBuffer(oembed.thumbnail_url));
    const cachedVideo = fs.existsSync(videoFile) ? fs.readFileSync(videoFile) : Buffer.alloc(0);
    const videoBuffer = cachedVideo.length >= 50_000 && cachedVideo.subarray(0, 64).includes(Buffer.from('ftyp'))
      ? cachedVideo
      : crawlTikTokPlayback(tiktokPlaybackUrl(html), cookieFile);
    if (fs.existsSync(cookieFile)) fs.unlinkSync(cookieFile);
    if (videoBuffer.length < 50_000 || !videoBuffer.subarray(0, 64).includes(Buffer.from('ftyp'))) {
      throw new Error(`TikTok playback media is invalid for ${sourceUrl}`);
    }
    fs.writeFileSync(videoFile, videoBuffer);
    const tags = Array.from(oembed.title.matchAll(/#([\p{L}\p{N}_]+)/gu)).map(match => match[1]).filter(Boolean).slice(0, 8) as string[];
    results.push({
      sourceUrl,
      title: oembed.title.trim(),
      authorName: oembed.author_name.trim(),
      authorUrl: oembed.author_url || sourceUrl.replace(/\/video\/.+$/, ''),
      thumbnailFile,
      videoFile,
      duration: tiktokDuration(html),
      views: firstMetric(html, 'playCount'),
      likes: firstMetric(html, 'diggCount'),
      comments: firstMetric(html, 'commentCount'),
      shares: firstMetric(html, 'shareCount'),
      tags,
    });
  }
  return results;
}

function ensureAccount(): void {
  const now = new Date().toISOString();
  const tenant = {
    id: TENANT_ID,
    name: COMPANY,
    companyName: COMPANY,
    contactName: '吴小姐（全链路试用）',
    contact: 'beauty-showcase@local.test',
    industry: '美妆护肤',
    notes: '本地美妆全链路试用专用账号，与管理员账号完全隔离。',
    inviteCode: '',
    subscriptionStatus: 'active',
    subscriptionPlan: 'customer',
    subscriptionExpiresAt: null,
    createdAt: getLocalTenant(TENANT_ID)?.createdAt || now,
    registeredAt: now,
    registeredEmail: EMAIL,
  };
  if (getLocalTenant(TENANT_ID)) updateLocalDataTenant(TENANT_ID, tenant);
  else createLocalDataTenant(tenant);

  const file = localAccountRecordsFile();
  const accounts = readLocalAccountRecords(file);
  const existingAccount = accounts.find(item => item.email === EMAIL || item.userId === USER_ID);
  if (!PASSWORD && existingAccount) return;
  if (!PASSWORD) throw new Error('BEAUTY_SHOWCASE_PASSWORD is required when creating the showcase account for the first time');
  const salt = randomBytes(16).toString('hex');
  const next = {
    userId: USER_ID,
    tenantId: TENANT_ID,
    email: EMAIL,
    name: 'Aurelia 美妆试用账号',
    accountType: 'customer' as const,
    role: 'admin' as const,
    salt,
    passwordHash: scryptSync(PASSWORD, salt, 64).toString('hex'),
    createdAt: existingAccount?.createdAt || now,
  };
  writeLocalAccountRecords(file, [...accounts.filter(item => item.email !== EMAIL && item.userId !== USER_ID), next]);
}

function tiktokMetadataAnalysis(item: CrawledTikTok) {
  const views = readableMetric(item.views);
  return {
    source: 'tiktok-public-page', sourceType: 'external_reference', contentFormat: 'video', views,
    keyword: item.tags.join(' ') || 'beauty skincare', crawlRule: 'TikTok 美妆公开视频链接直采', sourceAccount: item.authorUrl, sourceAccountName: item.authorName,
    analysisSource: 'tiktok-public-metadata', analysisQuality: 'metadata', analysisMode: 'strategy', requestedAnalysisMode: 'exact', downloadStatus: 'queued', videoFetchStatus: 'public_embed', geminiStatus: 'queued', analyzedAt: new Date().toISOString(),
    analysisLayers: [
      { level: 'L0', status: 'complete', scope: 'TikTok 公开标题、作者、封面、时长与互动指标', confidence: 0.98 },
      { level: 'L1', status: 'pending', scope: '全片画面、字幕与镜头切分', confidence: null },
      { level: 'L2', status: 'pending', scope: '结构、节奏、钩子与证明位置', confidence: null },
      { level: 'L3', status: 'pending', scope: '逐镜复刻说明和差异化边界', confidence: null },
      { level: 'L4', status: 'pending', scope: '等待真实制作结果回流', confidence: null },
    ],
    publicMetrics: { plays: item.views, likes: item.likes, comments: item.comments, shares: item.shares, observedAt: new Date().toISOString() },
    publicBaseline: { sampleSize: 0, status: 'pending', method: '当前只采集单条公开指标，尚未建立同账号基线' },
    candidateEvidence: {
      relevance: { level: 'high', reasons: [`标题与标签包含美妆/护肤主题：${item.tags.join('、') || item.title}`] },
      momentum: { level: item.views >= 10_000 ? 'high_performance' : 'observed', reasons: [`TikTok 公开播放量：${views}；仅陈述本次采集快照，不声称正在起量`], confidence: 0.8 },
      transferability: { level: 'pending_review', mechanisms: ['公开标题主题', '封面构图', '互动指标'], limitations: ['必须先完成全片精确分析；不得下载、剪入或重发原作者媒体'] },
    },
    rightsStatus: { mayAnalyze: true, mayUseOriginalMedia: false, mayAdapt: true, note: '公开视频仅作为分析与重新拍摄参考；原视频、原声音、人物和品牌素材不可直接进入成片。' },
    gemini: {
      theme: `TikTok 公开美妆参考：${item.title}`,
      hooks: [`先核对原视频前三秒，再围绕「${item.title}」拆解可见钩子`],
      sellingPoints: item.tags.map(tag => `公开标签：#${tag}`),
      mood: '仅完成公开元数据采集，等待编导 Agent 全片精确分析',
      structure: '标题与封面参考 → 全片分析待执行 → 生成差异化复刻脚本',
      baseRequirements: '不得直接复用原片、原声、原字幕、原人物或原品牌素材；只能在完成全片分析后重新拍摄和重做表达。',
      recommendedScriptType: 'storyboard',
    },
    referencePreviewFile: path.posix.join(assetRelativeDir, path.basename(item.videoFile)),
    provenance: { sourceUrl: item.sourceUrl, authorUrl: item.authorUrl, crawledVia: ['TikTok oEmbed', 'TikTok public page'], thumbnailCachedForReference: true, videoCachedForReferenceAnalysisOnly: true },
  };
}

async function seedBusinessAndContent(productPosters: string[], materials: DownloadedMaterial[], tiktokVideos: CrawledTikTok[]): Promise<void> {
  await updateTenantEnterpriseProfile(TENANT_ID, {
    digitalEmployeeOnboarding: { profileConfirmedAt: new Date().toISOString(), productSelectionConfirmedAt: new Date().toISOString(), continuedWithoutProducts: false },
    company: { name: COMPANY, industry: '美妆护肤', companyType: '品牌', mainMarkets: '美国、加拿大', primaryLanguages: '英语', socialPlatformExperience: 'TikTok、Instagram Reels、YouTube Shorts', founded: '2019', description: '专注敏感肌日常护肤与通勤彩妆的消费品牌，产品由合规代工厂生产，强调真实质地、清晰用法和不过度承诺。' },
    socialStrategy: { enabledRoutes: ['consumer_retail'], routeStrategies: { consumer_retail: { targetBuyerRoles: ['18-35岁关注成分与肤感的消费者'], primaryCta: '进入官网查看产品和使用方式' } }, manuallyEditedFields: [] },
    products: {
      categories: '护肤、洁面、防晒、彩妆', priceRange: 'US$16-32', moq: '现货零售；渠道合作另议', certifications: '产品档案已留存；具体市场合规资料按 SKU 提供',
      highlights: '真实质地演示、简单日常步骤、避免夸大功效',
      items: products.map((product, index) => ({
        sku: product.sku, name: product.name, category: product.category, brand: 'Aurelia', retailPrice: ['24.00', '22.00', '18.00', '16.00', '28.00'][index], priceRange: `US$${['24', '22', '18', '16', '28'][index]}`, moq: '1件', certifications: '以产品页面与实物标签为准', highlights: product.highlights,
        imageUrl: `/media/${assetRelativeDir}/beauty-${index + 1}.png`, attributes: { 核心场景: product.scene, 内容边界: '只表达已确认的质地、用法和产品信息，不承诺治疗或永久效果' },
      })),
    },
    brand: { tone: '直白、克制、像懂护肤的朋友', style: '明亮真实、近景质地、步骤清楚', taboos: '禁止医疗化表述、永久效果、绝对化承诺、伪造前后对比', usp: '让小白也能看懂的真实质地与日常步骤', preferredLanguages: '英语' },
    strategy: { currentGoal: '用高质量短视频提高美妆产品的收藏、站内搜索和官网访问', focusProducts: products.map(item => item.name).join('、'), focusMarkets: '美国', excludedMarkets: '', pricingStrategy: '中端日常美妆', minMargin: '按产品核算', agentAutonomy: '事实和权利问题必须确认；内容结构可自动推进', aiAutonomy: 'draft' },
    customers: { targetProfiles: '18-35岁关注成分、肤感和简单步骤的美国消费者', highValueSignals: '询问成分、肤质适配、使用顺序、购买链接', lowQualitySignals: '索要无法验证的疗效保证', commonQuestions: '敏感肌日常怎么用；妆前会不会搓泥；质地厚不厚；早晚使用顺序；如何选择色号', followupStyle: '先回答用法和可见事实，再引导查看产品页面' },
    operations: { leadTime: '美国现货订单通常 2 个工作日内处理', customization: '不对消费者提供定制；渠道合作需单独确认', logistics: '美国和加拿大可配送，时效以结账页为准', paymentTerms: '官网在线支付', riskNotes: '不同肤质体验不同；涉及敏感或不适请停止使用并咨询专业人士' },
  }, USER_ID);

  const existingVideos = await store.list<Record<string, unknown>>('trend_videos', { where: { tenantId: TENANT_ID }, page: 1, perPage: 200 });
  for (const record of existingVideos.items.filter(item => /^beauty_showcase_v\d+$/.test(String(item.seedBatchId || '')))) await store.delete('trend_videos', String(record.id));
  for (const [index, item] of tiktokVideos.entries()) {
    const relativePoster = path.posix.join(assetRelativeDir, path.basename(item.thumbnailFile));
    await store.create('trend_videos', {
      tenantId: TENANT_ID,
      platform: 'tiktok',
      title: item.title,
      thumbnailUrl: `/media/${relativePoster}`,
      videoFileId: path.posix.join(assetRelativeDir, path.basename(item.videoFile)),
      duration: item.duration,
      sourceUrl: item.sourceUrl,
      tags: JSON.stringify(Array.from(new Set(['美妆', '护肤', ...item.tags]))),
      aiAnalysis: JSON.stringify(tiktokMetadataAnalysis(item)),
      status: 'pending',
      crawledAt: new Date(Date.now() - index * 60_000).toISOString(),
      contentFormat: 'video',
      sourceType: 'tiktok_public_reference',
      seedBatchId: BATCH,
    });
  }

  const oldMaterials = readLocalMaterials().filter(item => !(item.tenantId === TENANT_ID && /^beauty_showcase_v\d+$/.test(String(item.seedBatchId || ''))));
  const manifestSha256 = createHash('sha256').update(JSON.stringify(openBeautyMaterialSources)).digest('hex');
  const seededMaterials = materials.map((source, index) => {
    const file = path.posix.join(assetRelativeDir, path.basename(source.file));
    const attributionText = source.licenseName === 'CC0 1.0'
      ? `${source.name} — ${source.creator}，通过 Wikimedia Commons，CC0 1.0`
      : `${source.name} — ${source.creator}，通过 Wikimedia Commons，${source.licenseName}`;
    const material = {
      id: `beauty-open-material-${index + 1}`, tenantId: TENANT_ID, name: source.name, folder: '开放许可美妆素材', type: 'image' as const,
      duration: 0, width: source.width, height: source.height, size: `${Math.ceil(source.bytes / 1024)} KB`, file, url: `/media/${file}`, poster: `/media/${file}`,
      scope: 'own' as const, usage: 'editable' as const, sourceType: 'licensed_stock', sourceName: source.name, sourceProvider: 'Wikimedia Commons', sourceCreator: source.creator,
      sourceUrl: source.sourceUrl, licenseEvidence: source.sourceUrl, licenseName: source.licenseName, licenseUrl: source.licenseUrl, attributionText,
      licenseEvidenceCapturedAt: new Date().toISOString(), licenseEvidenceTextSha256: createHash('sha256').update(`${source.sourceUrl}|${source.creator}|${source.licenseName}|${source.licenseUrl}`).digest('hex'),
      importBatchId: BATCH, manifestSha256, importedAt: new Date().toISOString(),
      commercialUseApproved: true, derivativesApproved: true, rawLibraryUseApproved: true,
      provenance: { source: 'wikimedia_commons', sourceUrl: source.sourceUrl, downloadUrl: source.downloadUrl, creator: source.creator, license: source.licenseName, retrievedAt: new Date().toISOString(), resizedThumbnail: true },
      industry: 'beauty_skincare', shotFunction: source.shotFunction, applicability: 'industry_specific',
      tags: [...source.tags, 'enterprise_common'].join(','), productId: '', productName: undefined,
      segmentAnalysisStatus: 'completed' as const, segmentAnalysisError: '', visualObservations: [source.description, `图片来自 ${source.creator}`, `许可：${source.licenseName}`],
      segments: [
        { id: `beauty-open-material-${index + 1}-s1`, start: 0, end: 1, duration: 1, subject: source.tags.slice(0, 3), action: source.description, productVisible: true, productClarity: 'high', shot: '产品静物/使用场景', angle: '平视', composition: '以原图构图为准', camera: '静态图片', environment: '美妆产品场景', quality: 0.9, ocrText: '', hasPerson: index === 3, hasLogo: false, logoText: [], recommendedFunctions: [source.shotFunction], authenticity: '只描述图片中可见内容；关联产品仅用于检索，不把外部产品误认为客户实物', confidence: 0.92, needsReview: false },
      ],
      sourceRevision: sha256(source.file), createdAt: new Date(Date.now() - index * 60_000).toISOString(), seedBatchId: BATCH,
    };
    const revision = analysisFileRevision(material);
    return {
      ...material,
      analysisSourceRevision: revision,
      scriptAnalysis: buildMaterialScriptAnalysis({ materialId: material.id, name: material.name, sourceRevision: revision, duration: material.duration, segments: material.segments, visualObservations: material.visualObservations }),
    };
  });
  saveLocalMaterials([...oldMaterials, ...seededMaterials]);

  const previousScopes = await store.list<Record<string, unknown>>('social_discovery_scopes', { where: { tenant_id: TENANT_ID, status: 'active' }, page: 1, perPage: 20 });
  for (const record of previousScopes.items) await store.update('social_discovery_scopes', String(record.id), { status: 'retired', updated_at: new Date().toISOString() });
  const strategy = buildSocialCrawlStrategy({
    businessGoal: '发现适合美国消费者、能用真实产品素材安全复刻的美妆短视频', productTerms: products.map(item => item.name), market: '美国', language: '英语', companyRole: 'brand', audienceRole: 'consumer', platforms: ['tiktok', 'instagram', 'youtube'], lookbackDays: 7, resultLimit: 30,
    sceneClusters: products.map(item => ({ label: item.scene, productTask: item.name, demandDimension: 'scene', queryVariants: [`${item.name} ${item.scene}`], evidence: ['product', 'user'], status: 'approved' })),
  });
  strategy.keywordSet.createdBy = 'user';
  strategy.createdBy = 'user';
  await store.create('social_discovery_scopes', { tenant_id: TENANT_ID, keyword_set_id: strategy.keywordSet.keywordSetId, version: 1, status: 'active', payload: strategy, created_by: USER_ID, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });

  const [videoCheck, scopeCheck] = await Promise.all([
    store.list<Record<string, unknown>>('trend_videos', { where: { tenantId: TENANT_ID }, page: 1, perPage: 100 }),
    store.list<Record<string, unknown>>('social_discovery_scopes', { where: { tenant_id: TENANT_ID, status: 'active' }, page: 1, perPage: 10 }),
  ]);
  const seededVideoCheck = videoCheck.items.filter(item => item.seedBatchId === BATCH && item.platform === 'tiktok' && /^https:\/\/www\.tiktok\.com\//.test(String(item.sourceUrl || '')));
  const materialCheck = readLocalMaterials().filter(item => item.tenantId === TENANT_ID && item.seedBatchId === BATCH && item.sourceProvider === 'Wikimedia Commons');
  if (seededVideoCheck.length !== 5 || materialCheck.length !== 5 || scopeCheck.items.length !== 1) throw new Error(`Beauty showcase verification failed: videos=${seededVideoCheck.length}, materials=${materialCheck.length}, scopes=${scopeCheck.items.length}`);
  if (videoCheck.items.some(item => item.tenantId === 'local_tenant_admin_lingshu-admin_local_test')) throw new Error('Beauty records leaked into administrator tenant');
}

ensureAccount();
const [productPosters, materials, tiktokVideos] = await Promise.all([
  ensureProductAssets(),
  crawlOpenBeautyMaterials(),
  crawlTikTokReferences(),
]);
await runWithDataAuthority('local', () => seedBusinessAndContent(productPosters, materials, tiktokVideos));

console.log(JSON.stringify({ ok: true, email: EMAIL, tenantId: TENANT_ID, company: COMPANY, products: products.length, inspirationVideos: 5, materials: 5 }, null, 2));
