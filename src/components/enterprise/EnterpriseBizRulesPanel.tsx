import { Input } from 'antd';
import { FileText, ShieldCheck } from 'lucide-react';
import { Field, KnowledgeCard } from './EnterpriseFormControls';
import type { BargainPolicy, BizRules, ProductItem } from './enterpriseProfileTypes';

const inputCls = 'w-full';

interface Props {
  bizRules: BizRules | undefined;
  products: ProductItem[];
  completed: boolean;
  highlighted: boolean;
  onChange: (field: keyof BizRules, value: string) => void;
}

export default function EnterpriseBizRulesPanel({ bizRules, products, completed, highlighted, onChange }: Props) {
  return (
  <KnowledgeCard id="biz-rules" icon={ShieldCheck} title="报价与业务规则" purpose="决定 AI 回复客户时的分寸——它能说什么、不能说什么" completed={completed} highlight={highlighted}>
    {!completed && <p className="mb-4 rounded-lg bg-sky-50 px-3 py-2 text-xs font-bold text-sky-800">补充样品、付款和交期后，AI 转人工时会替销售整理好询价条件。</p>}
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-sm font-semibold text-amber-900">客户询价 → 标记“等待人工报价”</p>
        <p className="mt-1 text-xs leading-5 text-amber-800">AI 不回复价格，也不发送“稍后报价”占位消息；系统提醒销售查看数量、规格和包装要求后亲自回复。</p>
      </div>
      <div className="rounded-lg border border-border bg-surface-2/50 p-4">
        <p className="text-sm font-semibold text-text-primary">业务资料</p>
        <p className="mt-1 text-[11px] text-text-muted">与“产品资料 → 资质文书”同步显示，同一文件不重复上传。</p>
        <div className="mt-3 space-y-1">{products.flatMap(product => (product.documents ?? []).map(file => ({ product: product.name || '未命名产品', file }))).map(({ product, file }, index) => <div key={`${file.name}-${index}`} className="flex items-center gap-2 rounded bg-white px-2 py-1.5 text-[11px]"><FileText size={12} className="text-text-muted" /><span className="min-w-0 flex-1 truncate">{file.name}</span><span className="text-text-muted">{product}</span></div>)}</div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="内部参考价格（不会自动发给客户）">
          <Input className={inputCls} value={bizRules?.priceRange ?? ''} onChange={e => onChange('priceRange', e.target.value)} placeholder="$5 - $500 USD，仅供销售参考" />
        </Field>
        <Field label="客户问 MOQ 时，AI 应怎么说">
          <Input className={inputCls} value={bizRules?.moq ?? ''} onChange={e => onChange('moq', e.target.value)} placeholder="常规 50 件起，支持混批" />
        </Field>
        <Field label="样品是否免费、运费谁出">
          <Input className={inputCls} value={bizRules?.samplePolicy ?? ''} onChange={e => onChange('samplePolicy', e.target.value)} placeholder="样品可付费申请，运费由买家承担" />
        </Field>
        <Field label="付款方式和节点">
          <Input className={inputCls} value={bizRules?.paymentTerms ?? ''} onChange={e => onChange('paymentTerms', e.target.value)} placeholder="T/T 30% 预付，尾款出货前结清" />
        </Field>
        <Field label="交期怎么表述">
          <Input className={inputCls} value={bizRules?.leadTime ?? ''} onChange={e => onChange('leadTime', e.target.value)} placeholder="样品 3-7 天，大货 20-35 天" />
        </Field>
        <Field label="议价底线说明">
          <Input className={inputCls} value={bizRules?.bargainFloor ?? ''} onChange={e => onChange('bargainFloor', e.target.value)} placeholder="可小幅让利，但不承诺低于成本线" />
        </Field>
      </div>
      <Field label="销售议价偏好（仅用于内部建议）：">
        <div className="flex flex-wrap gap-2">
          {[
            { value: 'no' as BargainPolicy, label: '不议价' },
            { value: 'limited' as BargainPolicy, label: '有限让步' },
            { value: 'open' as BargainPolicy, label: '开放协商' },
          ].map(option => (
            <button key={option.value} type="button" onClick={() => onChange('bargainPolicy', option.value)} className={`rounded-lg border px-3 py-2 text-xs font-bold ${bizRules?.bargainPolicy === option.value ? 'border-slate-950 bg-slate-950 text-white' : 'border-border bg-white text-text-secondary'}`}>
              {option.label}
            </button>
          ))}
        </div>
      </Field>
    </div>
  </KnowledgeCard>
  );
}
