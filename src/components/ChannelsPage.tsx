import { SocialConnectionPanel, YouTubeConnectionPanel } from './YouTubeIntegration';
import UserSocialAppCredentials from './UserSocialAppCredentials';
import MessengerConnectionPanel from './MessengerConnectionPanel';
import { LsPageHeader } from './ui/LsPageHeader';

export default function ChannelsPage() {
  return (
    <main
      className="h-full overflow-y-auto bg-surface p-4 pb-28 sm:p-6 md:pb-6"
      data-lingshu-guide="channel-connections"
    >
      <div className="mx-auto max-w-[1440px] space-y-5">
      <LsPageHeader title="发布渠道" description="连接平台账号，核对授权状态与发布能力。" />
      <UserSocialAppCredentials />
      <div className="grid items-stretch gap-4 xl:grid-cols-2">
        <YouTubeConnectionPanel />
        <SocialConnectionPanel platform="instagram" />
        <SocialConnectionPanel platform="facebook" />
        <SocialConnectionPanel platform="tiktok" />
        <MessengerConnectionPanel />
      </div>
      </div>
    </main>
  );
}
