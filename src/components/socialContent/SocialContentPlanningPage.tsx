import { useEffect, useState } from 'react';
import type { Page } from '../../App';
import SocialContentWorkspace, { type SocialContentCreateRequest } from './SocialContentWorkspace';
import SocialContentLanding, { type SocialContentLaunchOptions } from './SocialContentLanding';

export default function SocialContentPlanningPage({
  onNavigate,
  onNavigateWithTask,
  initialCreateRequest,
}: {
  onNavigate: (page: Page) => void;
  onNavigateWithTask: (page: Page, taskId: string) => void;
  initialCreateRequest?: SocialContentCreateRequest | null;
}) {
  const [createRequest, setCreateRequest] = useState<SocialContentCreateRequest | null>(initialCreateRequest || null);

  useEffect(() => {
    if (initialCreateRequest) setCreateRequest(initialCreateRequest);
  }, [initialCreateRequest]);

  const startCreation = (options: SocialContentLaunchOptions) => {
    setCreateRequest({
      requestId: Date.now(),
      themeId: 'product_value',
      mode: 'instant',
      ...options,
    });
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[#f6f8f5]">
      <main className="mx-auto max-w-[1440px] space-y-5 px-4 py-5 sm:px-8 sm:py-7">
        <SocialContentLanding onStart={startCreation} />

        <SocialContentWorkspace
          onNavigate={onNavigate}
          onNavigateWithTask={onNavigateWithTask}
          defaultCreateMode="instant"
          createRequest={createRequest}
        />
      </main>
    </div>
  );
}
