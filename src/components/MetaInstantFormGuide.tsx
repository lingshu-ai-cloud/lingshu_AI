import { Alert, Collapse } from 'antd';
import './metaInstantFormGuide.css';
const preparation = [
  { item: '获客内容与语言', detail: '写清客户提交后能得到什么，例如产品目录、报价或样品咨询；表单语言与目标市场一致。', where: 'Meta 表单' },
  { item: '联系方式与采购问题', detail: '确认姓名、工作邮箱或电话等联系字段。按需增加公司、目标产品、预计采购数量；只问实际会用于跟进的问题。', where: 'Meta 表单' },
  { item: '隐私说明', detail: '准备可访问的企业隐私政策链接，核对信息用途及必要的告知或同意内容。', where: 'Meta 表单' },
  { item: '提交后的提示与按钮', detail: '按需填写提交成功提示；如提供目录或网站入口，核对按钮和链接。后续联系由企业自行安排。', where: 'Meta 表单' },
  { item: '主页、版本与条款', detail: '选定拥有该表单的 Facebook 主页，完成线索广告条款并发布表单。修改已发布版本时按 Meta 当前入口操作；若无法直接编辑，复制并发布新版本。', where: 'Meta 平台' },
];
export default function MetaInstantFormGuide() {
  return <section className="ads-instant-form-guide" aria-label="Meta 即时表单示例与创建准备">
    <Collapse items={[{ key: 'prepare', label: '查看表单创建准备清单', children: <dl className="ads-instant-form-checklist">{preparation.map(item => <div key={item.item}><dt>{item.item} · {item.where}</dt><dd>{item.detail}</dd></div>)}</dl> }]}/>
    <Alert type="info" showIcon title="已有有效表单由系统自动关联" description="系统读取所选主页的已发布表单。唯一候选直接关联；多个候选按名称、语言和问题摘要确认业务版本，不填写表单编号。首次没有表单时仍需准备真实业务内容和隐私说明；当前不代签条款或自动发布新表单。"/>
  </section>;
}
