import { Select } from 'antd';
import { AD_COUNTRY_CODES, adCountryName } from '../../shared/metaAdJourney';
export default function AdCountrySelect({ value, onChange }: { value: string[]; onChange: (countries: string[]) => void }) {
  const codes = [...new Set([...AD_COUNTRY_CODES, ...value])];
  return <label>投放国家或地区<Select aria-label="投放国家或地区" mode="multiple" style={{ width: '100%' }} value={value} placeholder="确认客户所在国家或地区，不默认选择" optionFilterProp="label" onChange={onChange} options={codes.map(code => ({ value: code, label: adCountryName(code) }))}/></label>;
}
