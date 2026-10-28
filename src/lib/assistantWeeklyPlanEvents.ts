export const ASSISTANT_WEEKLY_PLAN_OPEN_EVENT = 'lingshu:assistant-open-weekly-plan';

export function openAssistantWeeklyPlan() {
  window.dispatchEvent(new CustomEvent(ASSISTANT_WEEKLY_PLAN_OPEN_EVENT));
}
