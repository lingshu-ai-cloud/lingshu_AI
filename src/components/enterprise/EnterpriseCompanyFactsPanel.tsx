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
      <Field label="主营业务" hint="新手配置已填写的主营业务可在此维护。"><Input value={company.primaryBusiness || ''} onChange={e => onFieldChange('primaryBusiness', e.target.value)} /></Field>
      <Field label="公司简介（选填）" hint="已有新手配置资料会直接带入，无需重复录入。"><Input.TextArea rows={3} value={company.description} onChange={e => onFieldChange('description', e.target.value)} /></Field>
    </KnowledgeCard>
    </>
  );
}
