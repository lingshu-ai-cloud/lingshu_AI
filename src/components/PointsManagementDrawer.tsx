import { Empty, Modal, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { BrainCircuit, ChartNoAxesCombined, Film, Headphones, Megaphone, Search, Star } from 'lucide-react';
import {
  CURRENT_PRODUCT_POINT_RATES,
  PRODUCT_FEATURE_POINT_RATES,
  PRODUCT_POINT_SECTIONS,
  type ProductPointRate,
  type ProductPointSection,
} from '../../shared/pointsPolicy';
import PointsValue from './ui/PointsValue';

const sectionIcon: Record<ProductPointSection, typeof Film> = {
  business_operations: ChartNoAxesCombined,
  insight_planning: Search,
  content_production: Film,
  traffic_growth: Megaphone,
  customer_service: Headphones,
  knowledge_assistant: BrainCircuit,
};

const unitLabel = (rate: ProductPointRate) => ({
  second: '/ 秒',
  action: '/ 次',
  item: '/ 条',
  conversation: '/ 轮',
  document: '/ 份',
})[rate.unit];

export default function PointsManagementDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const columns: ColumnsType<ProductPointRate> = [
    {
      title: '产品板块', dataIndex: 'section', key: 'section', width: 112,
      render: section => PRODUCT_POINT_SECTIONS.find(item => item.id === section)?.label || section,
    },
    {
      title: '产品功能', key: 'feature', width: 210,
      render: (_, rate) => <div><strong className="text-text-primary">{rate.feature}</strong><p className="mt-0.5 text-xs text-text-secondary">{rate.description}</p></div>,
    },
    { title: '积分', key: 'points', width: 142, render: (_, rate) => <PointsValue value={rate.points} estimated={rate.estimated} suffix={unitLabel(rate)}/> },
    { title: '结算说明', dataIndex: 'note', key: 'note', render: value => <span className="text-xs leading-5 text-text-secondary">{value}</span> },
  ];

  return <Modal
    open={open}
    onCancel={onClose}
    title={<span className="inline-flex items-center gap-2"><Star size={18} className="text-amber-500" fill="currentColor" aria-hidden="true"/>积分管理</span>}
    footer={null}
    width={920}
    centered
    styles={{ body: { maxHeight: '78vh', overflowY: 'auto' } }}
  >
    <div className="space-y-6">
      <section aria-labelledby="points-overview-title">
        <div className="border-b border-border pb-3">
          <h2 id="points-overview-title" className="text-base font-semibold text-text-primary">本期功能消耗</h2>
          <p className="mt-1 text-xs text-text-secondary">覆盖智能经营、灵感策划、内容制作、投流、客服、知识与灵小枢；只按产品功能归集，不展示底层模型或服务商。</p>
        </div>
        <div className="mt-3 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {PRODUCT_POINT_SECTIONS.map(section => {
            const Icon = sectionIcon[section.id];
            const rates = CURRENT_PRODUCT_POINT_RATES.filter(rate => rate.section === section.id);
            return <article key={section.id} className="min-w-0 bg-white p-4">
              <div className="flex items-center gap-2 text-text-primary"><Icon size={16}/><strong className="text-sm">{section.label}</strong></div>
              <p className="mt-2 min-h-10 text-xs leading-5 text-text-secondary">{section.description}</p>
              <p className="mt-3 text-xs font-semibold text-text-primary">{section.chargeState === 'active' ? `${rates.length} 项功能规则` : '当前暂无扣积分功能'}</p>
            </article>;
          })}
        </div>
        <Empty className="my-5" image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已结算的产品功能消耗"/>
      </section>

      <section aria-labelledby="points-path-title">
        <h2 id="points-path-title" className="text-base font-semibold text-text-primary">全系统产品功能积分规则</h2>
        <p className="mt-1 text-xs text-text-secondary">“约”表示首版建议值；正式生效前可统一调价，但同一产品功能不会因内部模型切换而改变口径。</p>
        <Table<ProductPointRate>
          className="mt-3"
          rowKey="id"
          columns={columns}
          dataSource={[...PRODUCT_FEATURE_POINT_RATES]}
          size="small"
          scroll={{ x: 760 }}
          pagination={{
            pageSize: 6,
            showSizeChanger: false,
            showTotal: total => `共 ${total} 项功能规则`,
            hideOnSinglePage: true,
          }}
        />
      </section>

      <section aria-labelledby="points-settlement-title">
        <h2 id="points-settlement-title" className="text-base font-semibold text-text-primary">消耗与结算规则</h2>
        <ol className="mt-3 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
          <li className="bg-white p-4"><Tag>1</Tag><strong className="mt-2 block text-sm">按产品动作预留</strong><p className="mt-1 text-xs leading-5 text-text-secondary">只对明确触发的生成、分析或建议预留积分；浏览、筛选、检索和打开已有结果不扣积分。</p></li>
          <li className="bg-white p-4"><Tag>2</Tag><strong className="mt-2 block text-sm">按成功结果结算</strong><p className="mt-1 text-xs leading-5 text-text-secondary">按成功交付的秒数、条数、轮次、文档或业务动作结算。</p></li>
          <li className="bg-white p-4"><Tag>3</Tag><strong className="mt-2 block text-sm">内部调用不重复扣分</strong><p className="mt-1 text-xs leading-5 text-text-secondary">同一业务动作中的多 Agent、多模型、校验、修复和系统重试合并为一次结算。</p></li>
          <li className="bg-white p-4"><Tag>4</Tag><strong className="mt-2 block text-sm">失败与差额退回</strong><p className="mt-1 text-xs leading-5 text-text-secondary">未成功交付不扣积分；实际交付少于预留时自动退回差额。</p></li>
        </ol>
        <p className="mt-3 text-xs leading-5 text-text-secondary">同一产品功能的用户价格保持一致。Token 数、底层技术路线、模型或服务商只用于内部成本与容量管理，不成为用户账单项目。</p>
      </section>
    </div>
  </Modal>;
}
