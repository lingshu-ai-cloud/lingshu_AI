import { Button } from 'antd';
import type { Page } from '../../pageRegistry';
import { useAdPlanNavigation, useAdPlanTasks } from '../../lib/useAdPlanNavigation';
import { AdAccountDirectoryProvider } from '../AdAccountDirectory';
import AdPlanManagement from '../AdPlanManagement';

/** Same list, filters and metric reads as plan management; no budget writes in the overview. */
export default function BusinessAdsOverview({ onNavigate }: { onNavigate?: (page: Page) => void }) {
  const navigation = useAdPlanNavigation();
  const list = useAdPlanTasks(navigation.identity);
  const open = (id: string) => { navigation.select(id); onNavigate?.('adsPlans'); };
  const openAI = (id: string) => { navigation.select(id); onNavigate?.('adsManaged'); };
  return <AdAccountDirectoryProvider key={navigation.identity} onOpenCreative={() => onNavigate?.('adsCreatives')}>
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-text-secondary">与计划管理使用同一目录及近 7 天成效；币种、目标和读取状态按原计划展示。</p>
        <Button loading={list.loading} onClick={list.retry}>刷新计划</Button>
      </div>
      <AdPlanManagement tasks={list.items || []} loading={list.loading} error={list.error} readOnly
        onOpen={open} onAI={openAI} onUpdate={list.retry}/>
    </div>
  </AdAccountDirectoryProvider>;
}
