import { SocialConnectionPanel, YouTubeConnectionPanel } from './YouTubeIntegration';
import UserSocialAppCredentials, { WhatsAppConnectionPanel } from './UserSocialAppCredentials';

export default function ChannelsPage() {
  return (
    <main
      className="h-full overflow-y-auto bg-[#f8faf7] p-4 pb-28 sm:p-6 md:pb-6"
      data-lingshu-guide="channel-connections"
    >
      <UserSocialAppCredentials />
      <div className="grid items-stretch gap-4 xl:grid-cols-2">
        <YouTubeConnectionPanel />
        <SocialConnectionPanel platform="instagram" />
        <SocialConnectionPanel platform="facebook" />
        <SocialConnectionPanel platform="tiktok" />
        <WhatsAppConnectionPanel />
      </div>
    </main>
  );
}
