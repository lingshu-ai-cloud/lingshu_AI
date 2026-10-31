import {
  CURRENT_PRODUCT_POINT_RATES,
  CUSTOMER_PRODUCT_POINT_SCALE,
  PRODUCT_POINT_PRICE_BOOK_VERSION,
  PRODUCT_POINT_SECTIONS,
} from '../../shared/pointsPolicy.js';
import { INTERNAL_COST_POINTS_PER_CNY, internalCostPointsFromCny } from './privateUnitEconomics.js';

export type PaidApiCredentialState = 'configured' | 'missing' | 'tenant_scoped';

export type PaidApiEstimate = {
  label: string;
  amount: number | null;
  currency: 'CNY' | 'USD';
  unit: string;
  source: string;
  internalCostPoints: number | null;
};

export type PaidApiInventoryItem = {
  id: string;
  provider: string;
  api: string;
  productAreas: string[];
  capabilities: string[];
  billingUnits: string[];
  credentialState: PaidApiCredentialState;
  credentialKeys: string[];
  pricingBasis: string;
  pricingEvidence: string;
  estimates: PaidApiEstimate[];
};

type Env = NodeJS.ProcessEnv;

const present = (env: Env, key: string): boolean => Boolean(env[key]?.trim());
const credentialState = (env: Env, keys: string[], mode: 'any' | 'all' = 'any'): PaidApiCredentialState => {
  const found = keys.map(key => present(env, key));
  return (mode === 'all' ? found.every(Boolean) : found.some(Boolean)) ? 'configured' : 'missing';
};
const optionalPositive = (env: Env, key: string, fallback?: number): number | null => {
  const raw = env[key]?.trim();
  const value = raw ? Number(raw) : fallback;
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : null;
};
const estimate = (
  label: string,
  amount: number | null,
  currency: 'CNY' | 'USD',
  unit: string,
  source: string,
): PaidApiEstimate => ({
  label,
  amount,
  currency,
  unit,
  source,
  internalCostPoints: currency === 'CNY' && amount !== null ? internalCostPointsFromCny(amount) : null,
});

export function paidApiInventory(env: Env = process.env): PaidApiInventoryItem[] {
  const qwenKeys = ['DASHSCOPE_API_KEY', 'DASHSCOPE_API_KEY_FILE'];
  return [
    {
      id: 'openai-responses-images', provider: 'OpenAI', api: 'Responses / Images API',
      productAreas: ['图文爆款复刻', '图片生成', '视觉证据分析'],
      capabilities: ['文本推理', '视觉理解', '图片生成'], billingUnits: ['输入/输出 Token', '生成图片'],
      credentialState: credentialState(env, ['OPENAI_API_KEY']), credentialKeys: ['OPENAI_API_KEY'],
      pricingBasis: '供应商回执', pricingEvidence: '按实际模型、Token 和图片规格保存回执；价格变化不修改用户产品积分。',
      estimates: [estimate('实际调用', null, 'USD', 'provider receipt', '供应商美元回执 × 审计汇率')],
    },
    {
      id: 'qwen-text-vl-search', provider: '阿里云百炼 / 千问', api: 'Qwen Text、VL、Search',
      productAreas: ['灵小枢', '周计划', '素材分析', '社媒检索'],
      capabilities: ['文本推理', '视觉理解', '联网检索'], billingUnits: ['输入 Token', '输出 Token', '检索调用'],
      credentialState: credentialState(env, qwenKeys), credentialKeys: qwenKeys,
      pricingBasis: '已验证账号价或官方公开价', pricingEvidence: '结算前绑定模型、账号、有效期和价格证据；过期价格不能授权新请求。',
      estimates: [estimate('实际调用', null, 'CNY', 'verified tariff', '已验证费率 × 实际 Token/调用量')],
    },
    {
      id: 'qwen-speech', provider: '阿里云百炼 / 千问', api: 'Qwen ASR / TTS',
      productAreas: ['口播转写', '统一音色', '数字人音频'],
      capabilities: ['语音识别', '语音合成'], billingUnits: ['音频时长', '文本字符或 Token'],
      credentialState: credentialState(env, qwenKeys), credentialKeys: qwenKeys,
      pricingBasis: '官方公开价或账号价', pricingEvidence: '使用短时有效的价格证据；只按实际成功处理量结算内部成本。',
      estimates: [estimate('实际调用', null, 'CNY', 'verified tariff', '官方/账号费率 × 实际音频或文本用量')],
    },
    {
      id: 'wan-video', provider: '阿里云百炼 / 万相', api: 'Wan 图生视频',
      productAreas: ['AI 视频补镜', '图生视频'],
      capabilities: ['首帧图生视频'], billingUnits: ['生成视频秒数'],
      credentialState: credentialState(env, qwenKeys), credentialKeys: qwenKeys,
      pricingBasis: '官方公开价', pricingEvidence: '从官方定价页解析指定模型、区域、分辨率和音频条件，按秒形成证据。',
      estimates: [estimate('实际调用', null, 'CNY', 'video second', '已验证官方单价 × 成功生成秒数')],
    },
    {
      id: 'gemini-multimodal', provider: 'Google', api: 'Gemini API',
      productAreas: ['视频理解', '分镜质检', '人物连续性检查'],
      capabilities: ['多模态理解', '视频分析', '文本推理'], billingUnits: ['输入/输出 Token', '媒体输入'],
      credentialState: credentialState(env, ['GEMINI_API_KEY']), credentialKeys: ['GEMINI_API_KEY'],
      pricingBasis: '供应商回执', pricingEvidence: '按实际模型和媒体输入保存美元回执并使用审计汇率换算。',
      estimates: [estimate('实际调用', null, 'USD', 'provider receipt', '供应商美元回执 × 审计汇率')],
    },
    {
      id: 'google-veo', provider: 'Google', api: 'Veo Video Generation',
      productAreas: ['AI 视频补镜'], capabilities: ['生成式视频'], billingUnits: ['生成视频或秒数'],
      credentialState: credentialState(env, ['GEMINI_API_KEY']), credentialKeys: ['GEMINI_API_KEY'],
      pricingBasis: '受控成本估算/回执', pricingEvidence: '预算准入使用受控人民币估算，最终成本以供应商回执为准。',
      estimates: [estimate('一次生成估算', optionalPositive(env, 'SOCIAL_VEO_ESTIMATED_COST_CNY'), 'CNY', 'generation', 'SOCIAL_VEO_ESTIMATED_COST_CNY')],
    },
    {
      id: 'heygen-avatar', provider: 'HeyGen', api: 'Avatar / Digital Twin API',
      productAreas: ['数字人口播', '图片数字人', '本人数字人'],
      capabilities: ['数字人视频', '数字人创建', '口型驱动'], billingUnits: ['视频秒数', '创建任务'],
      credentialState: credentialState(env, ['HEYGEN_API_KEY']), credentialKeys: ['HEYGEN_API_KEY'],
      pricingBasis: '官方美元价格 + 审计汇率或账号估算', pricingEvidence: '价格证据绑定官方页面和外汇来源；环境估算仅用于准入预算。',
      estimates: [
        estimate('数字人视频估算', optionalPositive(env, 'HEYGEN_ESTIMATED_CNY_PER_SECOND'), 'CNY', 'second', 'HEYGEN_ESTIMATED_CNY_PER_SECOND'),
        estimate('图片数字人视频估算', optionalPositive(env, 'HEYGEN_PHOTO_ESTIMATED_CNY_PER_SECOND'), 'CNY', 'second', 'HEYGEN_PHOTO_ESTIMATED_CNY_PER_SECOND'),
      ],
    },
    {
      id: 'minimax-speech', provider: 'MiniMax', api: 'Speech / Voice Clone API',
      productAreas: ['统一音色', '音色克隆'], capabilities: ['语音合成', '音色克隆'], billingUnits: ['字符', '音频时长', '克隆任务'],
      credentialState: credentialState(env, ['MINIMAX_API_KEY', 'MINIMAX_API_TOKEN']), credentialKeys: ['MINIMAX_API_KEY', 'MINIMAX_API_TOKEN'],
      pricingBasis: '供应商回执', pricingEvidence: '按实际模型和成功合成/克隆用量记录，不用固定估算替代回执。',
      estimates: [estimate('实际调用', null, 'CNY', 'provider receipt', '供应商人民币回执')],
    },
    {
      id: 'seedream-image', provider: '火山引擎', api: 'Seedream Image Generation',
      productAreas: ['图片生成', '数字人首帧', '视频首帧'], capabilities: ['图片生成', '参考图生成'], billingUnits: ['输入图片', '输出图片'],
      credentialState: credentialState(env, ['SEEDREAM_API_KEY', 'SEEDANCE_API_KEY']), credentialKeys: ['SEEDREAM_API_KEY', 'SEEDANCE_API_KEY'],
      pricingBasis: '官方公开价或受控估算', pricingEvidence: '优先使用绑定区域、模型和账号的官方价格证据。',
      estimates: [estimate('首帧估算', optionalPositive(env, 'SEEDREAM_FIRST_FRAME_ESTIMATED_CNY', 0.22), 'CNY', 'image', 'SEEDREAM_FIRST_FRAME_ESTIMATED_CNY（默认 0.22）')],
    },
    {
      id: 'seedance-video', provider: '火山引擎', api: 'Seedance Video Generation',
      productAreas: ['AI 视频补镜', '参考视频复刻'], capabilities: ['文生视频', '图生视频', '参考视频生成'], billingUnits: ['生成视频秒数', 'Token'],
      credentialState: credentialState(env, ['SEEDANCE_API_KEY']), credentialKeys: ['SEEDANCE_API_KEY'],
      pricingBasis: '已验证账号价或受控估算', pricingEvidence: '预算按分辨率/模型费率，生产结算按受理回执和实际生成量。',
      estimates: [
        estimate('480P 每秒估算', optionalPositive(env, 'SEEDANCE_ESTIMATED_CNY_PER_SECOND_480P', 0.9), 'CNY', 'second', 'SEEDANCE_ESTIMATED_CNY_PER_SECOND_480P（默认 0.9）'),
        estimate('720P 每秒估算', optionalPositive(env, 'SEEDANCE_ESTIMATED_CNY_PER_SECOND_720P', 1.5), 'CNY', 'second', 'SEEDANCE_ESTIMATED_CNY_PER_SECOND_720P（默认 1.5）'),
      ],
    },
    {
      id: 'runway-act-two', provider: 'Runway', api: 'Act-Two API',
      productAreas: ['数字人参考动作', '表演驱动'], capabilities: ['动作驱动视频'], billingUnits: ['Credit', '生成视频秒数'],
      credentialState: credentialState(env, ['RUNWAYML_API_SECRET']), credentialKeys: ['RUNWAYML_API_SECRET'],
      pricingBasis: '管理员配置的账号成本', pricingEvidence: '必须同时配置每 Credit 成本和每秒估算，缺项不能进入付费生产。',
      estimates: [
        estimate('每 Credit', optionalPositive(env, 'RUNWAY_ACT_TWO_CNY_PER_CREDIT'), 'CNY', 'credit', 'RUNWAY_ACT_TWO_CNY_PER_CREDIT'),
        estimate('每秒估算', optionalPositive(env, 'RUNWAY_ACT_TWO_ESTIMATED_CNY_PER_SECOND'), 'CNY', 'second', 'RUNWAY_ACT_TWO_ESTIMATED_CNY_PER_SECOND'),
      ],
    },
    {
      id: 'apify-collection', provider: 'Apify', api: 'Actors / Dataset API',
      productAreas: ['爆款采集', '社媒参考库', '竞品监测'], capabilities: ['TikTok/Instagram/Facebook/LinkedIn/YouTube 采集'], billingUnits: ['结果数', '下载事件', '存储与流量'],
      credentialState: credentialState(env, ['APIFY_TOKEN']), credentialKeys: ['APIFY_TOKEN'],
      pricingBasis: 'Pay-per-event 账号价格', pricingEvidence: '以 Actor PPE、账号服务费率和预付余额证据控制每次采集。',
      estimates: [estimate('实际采集', null, 'USD', 'PPE receipt', '账号事件价 × 实际事件 + 存储/流量')],
    },
    {
      id: 'volcengine-assets-voice', provider: '火山引擎', api: 'Ark Assets / Voice API',
      productAreas: ['媒体资产', '语音服务'], capabilities: ['资产上传', '语音处理'], billingUnits: ['资产/请求', '音频用量'],
      credentialState: credentialState(env, ['VOLCENGINE_ACCESS_KEY_ID', 'VOLCENGINE_SECRET_ACCESS_KEY'], 'all'),
      credentialKeys: ['VOLCENGINE_ACCESS_KEY_ID', 'VOLCENGINE_SECRET_ACCESS_KEY', 'VOLCENGINE_VOICE_API_KEY'],
      pricingBasis: '供应商回执', pricingEvidence: '分别按资产与语音服务的实际回执核算。',
      estimates: [estimate('实际调用', null, 'CNY', 'provider receipt', '供应商人民币回执')],
    },
    {
      id: 'generic-digital-human', provider: '可配置数字人供应商', api: 'Digital Human Runtime API',
      productAreas: ['数字人口播备用链路'], capabilities: ['口型同步', '数字人视频生成'], billingUnits: ['任务', '视频秒数'],
      credentialState: credentialState(env, ['DIGITAL_HUMAN_API_KEY']), credentialKeys: ['DIGITAL_HUMAN_API_URL', 'DIGITAL_HUMAN_API_KEY'],
      pricingBasis: '供应商回执', pricingEvidence: '供应商由 DIGITAL_HUMAN_PROVIDER 选择；未绑定成本证据时不得当作正式结算价格。',
      estimates: [estimate('实际调用', null, 'CNY', 'provider receipt', '所选数字人供应商回执')],
    },
    {
      id: 'object-storage', provider: '腾讯云 COS / Cloudflare R2 / S3 兼容存储', api: 'Object Storage API',
      productAreas: ['素材库', '生成资产', '成片交付', '消息备份'], capabilities: ['对象上传下载', '分块上传', '公网交付'], billingUnits: ['存储量', '请求数', '外网流量'],
      credentialState: (
        (present(env, 'OBJECT_STORAGE_ACCESS_KEY_ID') || present(env, 'R2_ACCESS_KEY_ID') || present(env, 'COS_SECRET_ID'))
        && (present(env, 'OBJECT_STORAGE_SECRET_ACCESS_KEY') || present(env, 'R2_SECRET_ACCESS_KEY') || present(env, 'COS_SECRET_KEY'))
      ) ? 'configured' : 'missing',
      credentialKeys: ['OBJECT_STORAGE_*', 'COS_*', 'R2_*'],
      pricingBasis: '云账号账单', pricingEvidence: '存储、请求与流量按云账号实际账单核算；本地开发存储不计外部 API 成本。',
      estimates: [estimate('实际用量', null, 'CNY', 'storage/request/traffic receipt', '云存储人民币账单')],
    },
    {
      id: 'un-comtrade', provider: 'United Nations', api: 'UN Comtrade API',
      productAreas: ['市场研究', '贸易数据洞察'], capabilities: ['进出口统计查询'], billingUnits: ['API 查询/订阅额度'],
      credentialState: credentialState(env, ['UN_COMTRADE_API_KEY']), credentialKeys: ['UN_COMTRADE_API_KEY'],
      pricingBasis: '订阅账号与额度', pricingEvidence: '有密钥时使用订阅接口；无密钥时只使用受限公开预览，不假定付费额度。',
      estimates: [estimate('订阅查询', null, 'USD', 'subscription receipt', '订阅账单 × 审计汇率')],
    },
    {
      id: 'google-translation', provider: 'Google Cloud', api: 'Cloud Translation API',
      productAreas: ['脚本翻译', '多语内容'], capabilities: ['机器翻译'], billingUnits: ['字符数'],
      credentialState: 'tenant_scoped', credentialKeys: ['租户插件密钥'],
      pricingBasis: '租户账号价格/回执', pricingEvidence: '密钥由租户插件配置，不从服务端环境变量推断可用状态。',
      estimates: [estimate('实际翻译', null, 'USD', 'characters', '供应商美元回执 × 审计汇率')],
    },
  ];
}

export function developerApiEconomicsSnapshot(env: Env = process.env) {
  const apis = paidApiInventory(env);
  return {
    generatedAt: new Date().toISOString(),
    access: 'platform_admin_only' as const,
    rules: {
      customerPriceBookVersion: PRODUCT_POINT_PRICE_BOOK_VERSION,
      customerProductPointScale: CUSTOMER_PRODUCT_POINT_SCALE,
      internalCostPointsPerCny: INTERNAL_COST_POINTS_PER_CNY,
      providerCostFormula: '供应商金额 × 审计汇率 = 人民币成本；人民币成本 × 1,000 = 内部成本积分（向上取整）',
      customerSettlementFormula: '按产品功能结果预留；按实际成功交付量结算；失败或未使用部分释放',
      separationRule: '内部成本积分只用于成本、预算和毛利核算；用户积分按产品价值定价，不随供应商或模型切换。',
    },
    summary: {
      paidApiCount: apis.length,
      configuredCount: apis.filter(item => item.credentialState === 'configured').length,
      missingCount: apis.filter(item => item.credentialState === 'missing').length,
      tenantScopedCount: apis.filter(item => item.credentialState === 'tenant_scoped').length,
    },
    apis,
    productPointSections: PRODUCT_POINT_SECTIONS,
    productPointRates: CURRENT_PRODUCT_POINT_RATES,
    excludedCosts: [
      'Meta、Google、TikTok 的广告媒体消耗属于投放预算，不等同于 API 调用费。',
      '本地素材复用、纯检索和打开既有结果不产生生成积分。',
      'YouTube Data、社媒 OAuth 与广告管理 API 的配额/媒体消耗不作为生成 API 积分；媒体预算单独核算。',
      'ExchangeRate-API 等只读汇率来源只提供审计证据，不作为用户付费 API 项目展示。',
    ],
  };
}
