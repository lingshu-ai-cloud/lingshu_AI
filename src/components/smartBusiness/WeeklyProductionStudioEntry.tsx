import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Spin } from 'antd';
import { ExternalLink } from 'lucide-react';
import { authHeader } from '../../lib/auth';
import { showActionFeedback } from '../../lib/actionFeedback';
import { dispatchDigitalEmployeeDeepLink, type DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import { readWeeklyContentProgressSnapshot } from '../../lib/weeklyContentProgressSnapshot';
import { weeklyProductionStudioLinks } from '../../lib/weeklyProductionDetail';

type Props = { data: DigitalEmployeeOverview; contentId: string; onOpened?: () => void; autoOpen?: boolean; onUnavailable?: () => void };

/** Navigation only: verify exact production ownership, then enter the existing Studio. */
export default function WeeklyProductionStudioEntry({ data, contentId, onOpened, autoOpen = false, onUnavailable }: Props) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const [choices, setChoices] = useState<ReturnType<typeof weeklyProductionStudioLinks>>([]);
  const choicesAuthorization = useRef<string | undefined>(undefined);
  const request = useRef<AbortController | null>(null);
  const unavailable = (description: string) => {
    setError(description);
    if (autoOpen) { showActionFeedback({ title: '制作台暂不可用', description, tone: 'warning' }); onUnavailable?.(); }
  };
  const navigate = (choice: ReturnType<typeof weeklyProductionStudioLinks>[number]) => {
    onOpened?.();
    dispatchDigitalEmployeeDeepLink(choice.link);
  };
  const openStudio = async () => {
    if (request.current && !request.current.signal.aborted) return;
    const controller = new AbortController(); request.current = controller;
    const headers = authHeader();
    setOpening(true); setError('');
    try {
      const snapshot = await readWeeklyContentProgressSnapshot({ data, contentId, headers, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (headers.Authorization !== authHeader().Authorization) { unavailable('登录身份已变化，请重新读取制作项目。'); return; }
      const links = weeklyProductionStudioLinks(snapshot.data, contentId, snapshot.projects);
      if (links.length === 1) navigate(links[0]!);
      else if (links.length > 1) { choicesAuthorization.current = headers.Authorization; setChoices(links); }
      else unavailable('此内容尚无可核验的制作项目，请在日历侧栏查看真实回执后重试。');
    } catch {
      if (!controller.signal.aborted) unavailable('制作项目暂未同步，未跳转到其他内容。请稍后重试。');
    } finally {
      if (request.current === controller) { request.current = null; if (!controller.signal.aborted) setOpening(false); }
    }
  };
  useEffect(() => {
    request.current?.abort(); request.current = null;
    setOpening(false); setError(''); setChoices([]); choicesAuthorization.current = undefined;
    if (autoOpen) void openStudio();
    return () => { request.current?.abort(); request.current = null; };
  }, [contentId, data.goal?.id, data.plan?.id, data.run?.id, autoOpen]);

  return <>
    {autoOpen ? <div role="status" className="flex items-center gap-2 p-4 text-sm text-text-secondary"><Spin size="small" />正在打开内容制作工作台…</div>
      : <div className="space-y-2"><Button type="primary" aria-label="进入内容制作" icon={<ExternalLink size={15} />} loading={opening} onClick={() => void openStudio()}>进入内容制作</Button>{error && <Alert type="warning" showIcon title={error} />}</div>}
    <Modal open={choices.length > 0} title="选择本条内容的制作版本" onCancel={() => { setChoices([]); if (autoOpen) onUnavailable?.(); }} footer={null} destroyOnHidden>
      <div className="space-y-3">{choices.map((choice, index) => <Button key={choice.projectId} block onClick={() => {
        setChoices([]);
        if (choicesAuthorization.current !== authHeader().Authorization) { unavailable('登录身份已变化，请重新读取制作项目。'); return; }
        navigate(choice);
      }}>制作版本 {index + 1}{choice.language ? ` · ${choice.language.toUpperCase()}` : ''}</Button>)}</div>
    </Modal>
  </>;
}
