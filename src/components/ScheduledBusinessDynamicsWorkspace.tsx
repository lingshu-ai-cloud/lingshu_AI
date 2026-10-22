import type { ReactNode } from 'react';
import { AlertTriangle, Building2, CircleDollarSign, ExternalLink, Globe2, Loader, RefreshCw, Search, TrendingUp } from 'lucide-react';
import type { AgentTaskGroup } from './scheduledTaskTemplates';

export interface BusinessDynamicsPayload {
  generatedAt?: string;
  cached?: boolean;
  profile?: {
    companyName?: string;
    industry?: string;
    markets?: string[];
    products?: string[];
    pricingRule?: string;
    completion?: number;
    completionTotal?: number;
    missingFields?: string[];
    aiAccessEnabled?: boolean;
  };
  quote?: {
    baseCurrency?: string;
    sourceDate?: string;
    rates?: Array<{ code: string; rate: number; market: string }>;
    productPriceRange?: string;
    moq?: string;
    minMargin?: string;
    recommendation?: string;
  };
  intelligence?: {
    status?: 'ready' | 'profile_incomplete' | 'unavailable';
    summary?: string;
    signals?: Array<{ market: string; title: string; impact: string; action: string; risk: 'low' | 'medium' | 'high'; sourceTitle?: string; sourceUrl?: string }>;
    sources?: Array<{ title: string; url: string }>;
    error?: string;
  };
}

interface Props {
  businessDynamics: BusinessDynamicsPayload | null;
  businessDynamicsLoading: boolean;
  businessDynamicsError: string;
  formatTime: (value?: string) => string;
  onRefresh: () => void;
  renderAutomationTemplates: (group: AgentTaskGroup) => ReactNode;
}

export default function ScheduledBusinessDynamicsWorkspace({ businessDynamics, businessDynamicsLoading, businessDynamicsError, formatTime, onRefresh, renderAutomationTemplates }: Props) {
  const profile = businessDynamics?.profile;
  const quote = businessDynamics?.quote;
  const intelligence = businessDynamics?.intelligence;
  const rates = quote?.rates ?? [];
  const signals = intelligence?.signals ?? [];
  const sources = intelligence?.sources ?? [];
  const missingFields = profile?.missingFields ?? [];
  const statusLabel = businessDynamicsLoading
    ? '正在生成经营动态'
    : intelligence?.status === 'ready'
    ? '外部检索已接入'
    : intelligence?.status === 'profile_incomplete'
      ? '等待企业资料'
      : '外部检索暂不可用';
  const summaryCards = [
    { label: '报价币种', value: rates.length || 0, desc: rates.map(rate => rate.code).join(' / ') || '等待实时汇率', icon: CircleDollarSign },
    { label: '主要市场', value: profile?.markets?.length || 0, desc: profile?.markets?.join('、') || '企业中心未配置', icon: Globe2 },
    { label: '行业动态', value: signals.length || 0, desc: intelligence?.status === 'ready' ? '最近 30 天公开动态' : statusLabel, icon: TrendingUp },
    { label: '企业资料', value: `${profile?.completion ?? 0}/${profile?.completionTotal ?? 6}`, desc: missingFields.length ? `缺少：${missingFields.join('、')}` : '经营分析依据已就绪', icon: Building2 },
  ];

  return (
    <div className="mb-6 space-y-4">
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-gray-900">企业经营画像 + 外部市场检索</p>
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${intelligence?.status === 'ready' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>{statusLabel}</span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              企业中心提供内部事实，公开检索补充当前市场变化；生成时间 {formatTime(businessDynamics?.generatedAt)}{businessDynamics?.cached ? ' · 缓存结果' : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'enterprise' } }))}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              <Building2 size={14} /> 企业中心
            </button>
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={businessDynamicsLoading}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              <RefreshCw size={14} className={businessDynamicsLoading ? 'animate-spin' : ''} /> 刷新动态
            </button>
          </div>
        </div>
        {businessDynamicsError && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertTriangle size={14} /> {businessDynamicsError}
          </div>
        )}
        {!businessDynamicsLoading && intelligence && intelligence.status !== 'ready' && (
          <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
            <p className="font-semibold">{intelligence.summary || statusLabel}</p>
            <p className="mt-0.5 text-amber-700">最近生成：{formatTime(businessDynamics?.generatedAt)}。可点击“刷新动态”重试；若持续失败，请检查外部检索服务配置与网络状态。</p>
          </div>
        )}
        {missingFields.length > 0 && !businessDynamicsLoading && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
            <p className="text-xs text-amber-800">缺少 {missingFields.join('、')}，当前动态只能生成部分结果。</p>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'enterprise' } }))}
              className="text-xs font-medium text-amber-800 hover:underline"
            >
              去补充资料
            </button>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {summaryCards.map(card => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-2 text-xs text-gray-500"><Icon size={14} className="text-green-600" /> {card.label}</div>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{businessDynamicsLoading ? '—' : card.value}</p>
              <p className="mt-1 truncate text-xs text-gray-500" title={card.desc}>{card.desc}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[0.9fr_1.4fr]">
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">报价监控</p>
              <p className="mt-0.5 text-xs text-gray-500">1 USD 基准 · 数据日期 {quote?.sourceDate || '待更新'}</p>
            </div>
            <CircleDollarSign size={18} className="text-green-600" />
          </div>
          {businessDynamicsLoading ? (
            <div className="flex h-24 items-center justify-center text-xs text-gray-400"><Loader size={16} className="mr-2 animate-spin" />正在读取汇率和报价规则</div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {rates.map(rate => (
                  <div key={rate.code} className="rounded-lg bg-gray-50 px-3 py-2">
                    <p className="text-[11px] text-gray-400">{rate.market}</p>
                    <p className="mt-1 text-sm font-semibold text-gray-900">{rate.code} {rate.rate >= 1000 ? rate.rate.toFixed(0) : rate.rate.toFixed(4)}</p>
                  </div>
                ))}
                {rates.length === 0 && <p className="py-4 text-center text-xs text-gray-400 sm:col-span-2">实时汇率暂不可用</p>}
              </div>
              <div className="mt-3 space-y-2 border-t border-gray-100 pt-3 text-xs">
                <div className="flex justify-between gap-3"><span className="text-gray-500">价格区间</span><span className="text-right font-medium text-gray-800">{quote?.productPriceRange || '未配置'}</span></div>
                <div className="flex justify-between gap-3"><span className="text-gray-500">MOQ</span><span className="text-right font-medium text-gray-800">{quote?.moq || '未配置'}</span></div>
                <div className="flex justify-between gap-3"><span className="text-gray-500">最低毛利</span><span className="text-right font-medium text-gray-800">{quote?.minMargin || '未配置'}</span></div>
              </div>
              <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs leading-relaxed text-green-800">{quote?.recommendation}</p>
            </>
          )}
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">主要市场行业动态</p>
              <p className="mt-0.5 text-xs text-gray-500">只展示与报价、需求、合规、渠道或竞争相关的公开事实</p>
            </div>
            <Search size={18} className="text-green-600" />
          </div>
          {businessDynamicsLoading ? (
            <div className="flex h-40 items-center justify-center text-xs text-gray-400"><Loader size={16} className="mr-2 animate-spin" />正在结合企业资料检索外部动态</div>
          ) : (
            <>
              <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-700">{intelligence?.summary || '暂无可用经营判断'}</p>
              <div className="mt-3 space-y-2">
                {signals.slice(0, 4).map((signal, index) => (
                  <div key={`${signal.market}-${index}`} className="rounded-lg border border-gray-100 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium text-green-700">{signal.market}</p>
                        <p className="mt-0.5 text-xs font-semibold leading-relaxed text-gray-900">{signal.title}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${signal.risk === 'high' ? 'bg-red-50 text-red-700' : signal.risk === 'medium' ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>
                        {signal.risk === 'high' ? '高关注' : signal.risk === 'medium' ? '需关注' : '机会'}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-gray-500">影响：{signal.impact}</p>
                    <p className="mt-1 text-xs leading-relaxed text-gray-700">建议：{signal.action}</p>
                  </div>
                ))}
                {signals.length === 0 && <p className="py-5 text-center text-xs text-gray-400">补充企业中心行业与主要市场后，可生成针对性动态。</p>}
              </div>
              {sources.length > 0 && (
                <div className="mt-3 border-t border-gray-100 pt-3">
                  <p className="mb-2 text-[11px] font-medium text-gray-500">公开来源</p>
                  <div className="flex flex-wrap gap-2">
                    {sources.slice(0, 6).map(source => (
                      <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="inline-flex max-w-[240px] items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:border-green-200 hover:text-green-700">
                        <span className="truncate">{source.title}</span><ExternalLink size={10} className="shrink-0" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1.05fr]">
        {renderAutomationTemplates('conversion')}
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm font-semibold text-gray-900">经营动态生成链路</p>
          <div className="mt-3 space-y-3">
            {[
              '读取企业中心：行业、产品、主要市场与报价边界',
              '刷新汇率，并检索最近 30 天公开市场与行业动态',
              '形成带来源的报价提醒、风险判断和 7 天行动建议',
            ].map((step, index) => (
              <div key={step} className="flex items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-50 text-xs font-semibold text-green-700">{index + 1}</span>
                <div className="flex-1 rounded-lg bg-gray-50 px-3 py-2"><p className="text-xs font-medium text-gray-800">{step}</p></div>
              </div>
            ))}
          </div>
          <p className="mt-4 rounded-lg border border-green-100 bg-green-50 p-3 text-xs leading-relaxed text-green-800">定时任务产出可导出 PDF，也可以继续交给首页、我的社媒或我的客户拆解执行。</p>
        </section>
      </div>
    </div>
  );
}
