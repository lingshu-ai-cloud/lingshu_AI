import { Input } from 'antd';
import { Building2, Globe2 } from 'lucide-react';
import { Field, KnowledgeCard, OptionSelector } from './EnterpriseFormControls';
import { CATEGORY_OPTIONS, COMPANY_TYPE_OPTIONS, LANGUAGE_OPTIONS, MARKET_OPTIONS } from './enterpriseProfileNormalization';
import type { Profile } from './enterpriseProfileTypes';

const inputCls = 'w-full';

interface Props {
  company: Profile['company'];
  marketCompleted: boolean;
  companyCompleted: boolean;
  highlighted: boolean;
  onFieldChange: (field: string, value: string) => void;
}

export default function EnterpriseCompanyFactsPanel({ company, marketCompleted, companyCompleted, highlighted, onFieldChange }: Props) {
  return (
    <>
    <KnowledgeCard id="enterprise-language-settings" highlight={highlighted} icon={Globe2} title="目标市场与语言" purpose="决定 AI 说什么语言、按哪个时区建议联系时间" completed={marketCompleted}>
      <div className="space-y-4">
        <Field label="主要市场">
          <OptionSelector value={company.mainMarkets} options={MARKET_OPTIONS} onChange={value => onFieldChange('mainMarkets', value)} placeholder="选择目标市场" />
        </Field>
        <Field label="主要语言">
          <OptionSelector value={company.primaryLanguages ?? ''} options={LANGUAGE_OPTIONS} onChange={value => onFieldChange('primaryLanguages', value)} placeholder="选择主要语言" />
        </Field>
      </div>
    </KnowledgeCard>
    <KnowledgeCard icon={Building2} title="企业基本资料" purpose="供内容、客服和数字员工识别企业身份" completed={companyCompleted} stat={companyCompleted ? '基础资料已填写' : '请填写名称、行业和企业类型'}>
      <div className="grid grid-cols-2 gap-4">
        <Field label="公司名称">
          <Input className={inputCls} value={company.name} onChange={e => onFieldChange('name', e.target.value)} placeholder="示例贸易有限公司" />
        </Field>
        <Field label="行业类目">
          <OptionSelector value={company.industry} options={CATEGORY_OPTIONS} onChange={value => onFieldChange('industry', value)} placeholder="选择行业类目" />
        </Field>
        <Field label="企业类型">
          <OptionSelector value={company.companyType ?? ''} options={COMPANY_TYPE_OPTIONS} multiple={false} onChange={value => onFieldChange('companyType', value)} placeholder="选择企业类型" />
        </Field>
      </div>
    </KnowledgeCard>
    </>
  );
}
