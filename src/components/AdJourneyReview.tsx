import { Alert, Collapse } from 'antd';
import { META_AD_JOURNEYS, META_COMMON_CONFIRMATIONS } from '../../shared/metaAdJourney';
import type { MetaAdGoal } from '../../shared/metaAdObjectives';
export default function AdJourneyReview({ goal }: { goal: string }) {
  const journey = META_AD_JOURNEYS[goal as MetaAdGoal];
  if (!journey) return null;
  return <section aria-label="确认与自动处理范围">
    <h4>你只需确认</h4><p>{[...META_COMMON_CONFIRMATIONS, ...journey.user].join('；')}。</p>
    <h4>系统自动处理</h4><p>{journey.automatic.join('；')}。无需查找平台编号，不重复填写已保存的信息。</p>
    <Collapse size="small" items={[{ key: 'chain', label: '查看客户体验与验收标准', children: <><p>{journey.customer}</p><p>结果：{journey.result}。</p><p>系统检查条件：{journey.prerequisites.join('；')}。</p></> }]}/>
    <Alert type="info" showIcon title="保存草稿后创建的广告保持暂停" description="请核对页面上的投放内容与预算。创建完成后可查看平台回执；启用投放、调整预算或更新授权时，会明确展示影响范围。"/>
  </section>;
}
