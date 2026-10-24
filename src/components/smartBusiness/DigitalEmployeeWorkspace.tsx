import type { ReactNode } from 'react';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import type { Page } from '../../pageRegistry';
import DigitalEmployeeHomeWork from '../DigitalEmployeeHomeWork';
import type { AgentCalendarTask } from './AgentWeeklyCalendar';

type Props = {
  data: DigitalEmployeeOverview;
  calendarTasks?: AgentCalendarTask[];
  calendarDemo?: boolean;
  onRefresh?: () => void;
  onNavigate?: (page: Page) => void;
  onOpenContent?: (taskId?: string, socialContentTaskId?: string) => void;
  onOpenAgentSettings?: () => void;
  publishingCalendar?: ReactNode;
};

export default function DigitalEmployeeWorkspace({ data, onNavigate }: Props) {
  return <DigitalEmployeeHomeWork data={data} onNavigate={onNavigate}/>;
}
