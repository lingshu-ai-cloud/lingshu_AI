import type { AssistantDecisionDeepLink } from '../../lib/assistantDecisionApi';

export function dispatchAssistantDecisionDeepLink(link?: AssistantDecisionDeepLink): void {
  if (!link || typeof window === 'undefined') return;
  const opensPresenterOnboarding = link.page === 'digitalEmployees'
    && link.businessRef?.taskKey === 'presenter_setup_required';
  const opensArkCertification = link.page === 'enterprise'
    && link.businessRef?.taskKey === 'ark_presenter_setup_required';
  if (opensPresenterOnboarding) {
    try {
      window.sessionStorage.setItem('lingshu:open-digital-employee-guide', 'presenter');
    } catch { /* The live event below handles browsers with storage disabled. */ }
  }
  if (opensArkCertification) {
    try {
      window.localStorage.setItem('lingshu:enterprise:initial-view', 'presenters');
      if (typeof link.businessRef?.entityId === 'string') {
        window.sessionStorage.setItem('lingshu:enterprise:ark-presenter-id', link.businessRef.entityId);
      }
    } catch { /* The live event below still selects the knowledge-base view. */ }
  }
  const detail = {
    ...link,
    ...(link.runId ? { workflowRunId: link.runId } : {}),
    ...(link.taskId ? { workflowTaskId: link.taskId } : {}),
    ...(typeof link.businessRef?.contentId === 'string' ? {
      socialContentTaskId: link.businessRef.contentId,
      socialContentPage: link.page,
    } : {}),
  };
  window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail }));
  if (opensArkCertification) {
    const openPresenters = () => window.dispatchEvent(new CustomEvent(
      'lingshu:enterprise-view', { detail: { view: 'presenters' } },
    ));
    openPresenters();
    window.requestAnimationFrame?.(openPresenters);
  }
  if (opensPresenterOnboarding) {
    const openGuide = () => window.dispatchEvent(new CustomEvent(
      'lingshu:open-digital-employee-guide', { detail: { step: 'presenter' } },
    ));
    openGuide();
    window.requestAnimationFrame?.(openGuide);
  }
}
