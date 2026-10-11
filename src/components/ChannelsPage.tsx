import { useEffect, useRef, type ReactNode } from 'react';
import { SocialConnectionPanel, YouTubeConnectionPanel } from './YouTubeIntegration';
import UserSocialAppCredentials from './UserSocialAppCredentials';
import MessengerConnectionPanel from './MessengerConnectionPanel';
import {readAccountBindingNavigation} from '../lib/accountBindingNavigation';
import { LsPageHeader } from './ui/LsPageHeader';

export default function ChannelsPage() {
  const target=readAccountBindingNavigation();
  const focus=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(target){focus.current?.scrollIntoView({behavior:'smooth',block:'center'});focus.current?.focus({preventScroll:true});}},[target?.platform,target?.accountId,target?.consumerIds.join('|')]);
  const panel=(platform:string,child:ReactNode)=><div ref={target?.platform===platform?focus:undefined} tabIndex={target?.platform===platform?-1:undefined} data-channel-platform={platform} className={target?.platform===platform?'rounded-xl ring-2 ring-emerald-500 ring-offset-2':''}>{child}{target?.platform===platform&&<p role="status" className="m-3 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-900">来自周任务：请连接并核验 {platform}{target.accountId?` 账号 ${target.accountId}`:''}，完成后将恢复 {target.consumerIds.length} 个原发布消费者。此页面不会新建发布任务。</p>}</div>;
  return (
    <main
      className="h-full overflow-y-auto bg-surface p-4 pb-28 sm:p-6 md:pb-6"
      data-lingshu-guide="channel-connections"
    >
      <div className="mx-auto max-w-[1440px] space-y-5">
      <LsPageHeader title="发布渠道" description="连接平台账号，核对授权状态与发布能力。" />
      <UserSocialAppCredentials />
      <div className="grid items-stretch gap-4 xl:grid-cols-2">
        {panel('youtube',<YouTubeConnectionPanel />)}
        {panel('instagram',<SocialConnectionPanel platform="instagram" />)}
        {panel('facebook',<SocialConnectionPanel platform="facebook" />)}
        {panel('tiktok',<SocialConnectionPanel platform="tiktok" />)}
        {panel('messenger',<MessengerConnectionPanel />)}
      </div>
      </div>
    </main>
  );
}
