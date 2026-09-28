import type { Page } from '../../App';
import SocialContentWorkspace, { type SocialContentCreateRequest } from './SocialContentWorkspace';
import SocialContentLanding, { type SocialContentLaunchOptions } from './SocialContentLanding';

export default function SocialContentPlanningPage({
  onNavigate,
  onNavigateWithTask,
  taskOnly = false,
}: {
  taskOnly?: boolean;
  onNavigate: (page: Page) => void;
  onNavigateWithTask: (page: Page, taskId: string) => void;
}) {
  const startCreation = (options: SocialContentLaunchOptions) => {
    window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: {
      page: 'smartAssets', view: 'create', studioEntry: true,
      contentCreationRequest: { requestId: Date.now(), themeId: 'product_value', mode: 'instant', ...options } satisfies SocialContentCreateRequest,
    } }));
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[#f6f8f5]">
      <main className="mx-auto max-w-[1440px] space-y-5 px-4 py-5 sm:px-8 sm:py-7">
        {!taskOnly && <SocialContentLanding onStart={startCreation} />}

        <SocialContentWorkspace
          onNavigate={onNavigate}
          onNavigateWithTask={onNavigateWithTask}
        />
      </main>
    </div>
  );
}
