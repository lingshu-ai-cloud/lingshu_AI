import { useState } from 'react';
import type { DigitalEmployeeConfig } from '../lib/digitalEmployees';
import { digitalEmployeeApi } from '../lib/digitalEmployees';
import { OnboardingPanel } from './smartBusiness/DigitalEmployeeOnboardingPanel';
import { OnboardingGuideTitleContext } from './smartBusiness/DigitalEmployeeOnboardingSteps';

/** The home entry uses the same draft, CAS and confirmation contract as the business workspace. */
export default function HomeIntroduction({ open, onClose, onComplete, initialConfig, initialStep = 'start' }: {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
  initialConfig: DigitalEmployeeConfig;
  initialStep?: 'start' | 'products' | 'presenter';
}) {
  const [busy, setBusy] = useState(false);
  if (!open) return null;

  return <OnboardingGuideTitleContext.Provider value="让灵小枢认识我"><OnboardingPanel
    initial={initialConfig}
    initialStep={initialStep}
    readiness={[]}
    busy={busy}
    dismissible
    onClose={onClose}
    onOpenReadiness={() => {}}
    onSave={async config => {
      if (busy) return false;
      setBusy(true);
      try {
        // The existing endpoint checks the saved draft revision and fact version
        // before accepting this explicit, user-confirmed profile.
        await digitalEmployeeApi.completeOnboarding(config);
        onComplete();
        return true;
      } finally {
        setBusy(false);
      }
    }}
  /></OnboardingGuideTitleContext.Provider>;
}
