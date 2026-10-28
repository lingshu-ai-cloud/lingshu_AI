import { CalendarRange, ChevronRight } from 'lucide-react';
import { openAssistantWeeklyPlan } from '../../lib/assistantWeeklyPlanEvents';
import './assistantWorkBookmark.css';

/** The weekly bookmark opens the shared assistant confirmation modal. */
export default function AssistantWorkBookmark() {
  return <button type="button" className="assistant-work-bookmark" aria-label="打开本周运营计划" aria-haspopup="dialog" onClick={openAssistantWeeklyPlan}>
    <CalendarRange size={17} aria-hidden="true"/>
    <span>本周运营计划</span>
    <ChevronRight size={14} aria-hidden="true"/>
  </button>;
}
