import { useState } from 'react';
import type { Page } from '../../App';
import type { SocialContentThemeId } from '../../../shared/contracts/socialContentWorkflow';
import SocialContentWorkspace, { type SocialContentCreateRequest } from './SocialContentWorkspace';
import SocialContentLanding from './SocialContentLanding';

export default function SocialContentPlanningPage({
  onNavigate,
  onNavigateWithTask,
}: {
  onNavigate: (page: Page) => void;
  onNavigateWithTask: (page: Page, taskId: string) => void;
}) {
  const [createRequest, setCreateRequest] = useState<SocialContentCreateRequest | null>(null);

  const startWithTheme = (themeId: SocialContentThemeId | '') => {
    setCreateRequest({ requestId: Date.now(), themeId, mode: 'instant' });
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[#f6f8f5]">
      <main className="mx-auto max-w-[1440px] space-y-5 px-4 py-5 sm:px-8 sm:py-7">
        <SocialContentLanding onStart={startWithTheme} />

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
