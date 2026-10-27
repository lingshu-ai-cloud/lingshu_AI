import { useState } from 'react';
import { Tag } from 'antd';
import type { LocalBusinessPreview } from '../../shared/localBusinessPreview';
import BusinessOverviewDetailDrawer, { type BusinessOverviewDetail } from '../components/smartBusiness/BusinessOverviewDetailDrawer';
export function LocalBusinessWeek({ library }: { library: LocalBusinessPreview }) {
  const [detail, setDetail] = useState<BusinessOverviewDetail | null>(null);
  const count = Math.min(3, library.products.length) * 6;
  const metrics = [['待验收成片', '3 条'], ['本周计划视频', `${count} 条`], ['本周视频总时长', `${count * 30} 秒`], ['本周成本范围', '¥270–360'], ['预计制作成本', '¥306.00'], ['已结算成本', '¥96.00']];
  return <section className="flex flex-col bg-white" aria-label="本周任务驾驶舱">
    <div className="weekly-command-header flex flex-wrap items-start justify-between gap-3 px-6 pb-4 pt-5"><div><div className="flex items-center gap-2"><h2 className="text-xl font-semibold">周经营计划</h2><Tag>本周排期</Tag></div><p className="mt-2 text-sm text-text-secondary">{library.companyName} · 产品目录 {library.productCount} 项 · 主推 {library.products.slice(0, 3).map(item => item.name).join('、')}</p></div></div>
    <div className="weekly-command-metrics grid auto-rows-[112px] gap-x-6 gap-y-6 px-6 pb-6 pt-3 sm:grid-cols-3">{metrics.map(([label, value]) => <button type="button" key={label} aria-label={`查看${label}`} className="text-left" onClick={() => setDetail({ title: label, summary: `${library.companyName}本周内容计划与产品安排。`, rows: [['当前指标', value], ['产品目录', `${library.productCount} 项`], ...library.products.slice(0, 3).map(product => ['重点产品', product.name] as [string, string])] })}><div className="ant-statistic-title">{label}</div><div className="ant-statistic-content">{value}</div></button>)}</div>
    <BusinessOverviewDetailDrawer detail={detail} onClose={() => setDetail(null)}/>
  </section>;
}
export function LocalBusinessInterpretation({ library }: { library: LocalBusinessPreview }) {
  return <section aria-label="经营解读" className="mt-3 border-t border-border pt-3"><h2 className="text-base font-semibold">经营解读</h2><div className="mt-3 space-y-2 text-sm leading-6"><p><strong>当前重点：</strong>围绕{library.products.slice(0, 2).map(item => item.name).join('与')}，完善产品演示、采购解答和工厂交付三类内容。</p><p><strong>市场方向：</strong>优先覆盖{library.markets}，将产品卖点、使用场景和供货合作入口放在同一内容链路中。</p><p><strong>下一步：</strong>先处理待验收成片，再比较上轮内容表现与付费流曝光，持续补充采购客户常见问题。</p></div></section>;
}
