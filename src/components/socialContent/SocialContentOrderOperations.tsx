import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Form, Input, InputNumber, Modal, Select, Space, Spin } from 'antd';
import { AUTH_TOKEN_CHANGED_EVENT, getToken } from '../../lib/auth';
import { SocialContentRequestError } from '../../lib/socialContentApi';
import { socialContentOrderOperationsApi as api, type TaskOrderPlanning } from '../../lib/socialContentOrderOperationsApi';

type Action = 'replace' | 'cancel' | 'increase';
const titles: Record<Action, string> = { replace: '替换未开始计划', cancel: '取消内容任务', increase: '追加本周创作目标' };
const retainedReasonLabels: Record<string, string> = { paid: '已发生费用', unknown: '外部结果或费用尚待核验', inFlight: '存在在途执行请求', leaseActive: '存在执行租约', reservation_missing: '创作名额记录待核验', already_delivered: '已有真实交付' };
export function retainedOrderReason(reason: string): string { return retainedReasonLabels[reason] || '存在需核验的执行记录'; }
const statusLabels: Record<string, string> = { draft: '草稿', needs_input: '待补充资料', plan_review: '待确认方案', producing: '制作中', asset_review: '待验收素材', packaging: '打包中', awaiting_publish: '待发布', awaiting_metrics: '待回收数据', reviewed: '已复盘', attention: '需处理', cancelling: '停止核验中', queued: '排队中', running: '执行中', completed: '已完成', delivered: '已交付', cancelled: '已取消', canceled: '已取消', failed: '失败', blocked: '受阻', paused: '暂停', pending: '待执行' };
export function orderParticipantStatus(status: string): string { return statusLabels[status] || '状态待核验'; }
export function cancellationRequest(snapshot: TaskOrderPlanning, taskId: string, reason: string) {
  return { taskId: snapshot.cancelTarget?.taskId || taskId, input: { expectedVersion: snapshot.cancelTarget?.taskVersion || snapshot.taskVersion, ...(snapshot.cancelTarget ? { expectedGroupHash: snapshot.cancelTarget.groupHash } : {}), reason } };
}

/** Reads never start work. A command and its inputs stay frozen across uncertain retries. */
export default function SocialContentOrderOperations({ taskId, onChanged }: { taskId: string; onChanged?: () => void }) {
  const { message } = App.useApp();
  const [snapshot, setSnapshot] = useState<TaskOrderPlanning | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [form] = Form.useForm();
  const pending = useRef<{ id: string; values: Record<string, unknown>; cancellation?: ReturnType<typeof cancellationRequest> } | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const changed = () => { generation.current++; setSnapshot(null); setAction(null); pending.current = null; setRefresh(v => v + 1); };
    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT, changed);
    return () => window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT, changed);
  }, []);
  useEffect(() => {
    const controller = new AbortController(), token = getToken(), epoch = ++generation.current;
    setSnapshot(null); setAction(null); pending.current = null; setLoading(true); setError('');
    void api.read(taskId, controller.signal).then(next => { if (epoch === generation.current && getToken() === token) setSnapshot(next); }).catch(cause => {
      if (!controller.signal.aborted && epoch === generation.current) setError(cause instanceof Error ? cause.message : '计划读取失败');
    }).finally(() => { if (epoch === generation.current) setLoading(false); });
    return () => controller.abort();
  }, [taskId, refresh]);
  const open = (next: Action) => {
    pending.current = null; form.resetFields();
    form.setFieldsValue({ newLimit: (snapshot?.planning?.limit || 0) + 1 });
    setError(''); setAction(next);
  };
  const submit = async () => {
    if (!snapshot || !action || busy) return;
    const values = pending.current?.values || await form.validateFields();
    pending.current ||= { id: crypto.randomUUID(), values, ...(action === 'cancel' ? { cancellation: cancellationRequest(snapshot, taskId, String(values.reason)) } : {}) };
    const commandId = pending.current.id, token = getToken(), epoch = generation.current;
    setBusy(true); setError('');
    try {
      let notice = '计划已更新；不会自动启动新生产。';
      if (action === 'cancel') {
        const request = pending.current.cancellation!;
        const result = await api.cancel(request.taskId, request.input, commandId);
        notice = `${result.item.executionStopped === false ? '停止请求已记录，等待核验。' : '后续执行已停止。'}${result.item.externalSettlementPending ? '外部结果或费用仍待核验。' : ''}${result.item.quotaReleased ? '安全释放创作名额；历史运行与费用保留。' : `名额未释放；${result.item.retainedReasons.map(retainedOrderReason).join('；') || '保留已发生的执行与费用记录。'}`}`;
      } else {
        if (!snapshot.scope || !snapshot.planning) throw new Error('该任务尚未关联可操作的周创作计划。');
        const command = { programId: snapshot.scope.programId, weekStart: snapshot.scope.weekStart, expectedRevision: snapshot.planning.revision, commandId, reason: String(values.reason) };
        if (action === 'replace') await api.replace({ ...command, selectedContentId: String(values.selectedContentId), replacementTaskId: String(values.replacementTaskId) });
        else await api.increase({ ...command, newLimit: Number(values.newLimit), confirmed: true });
      }
      if (epoch !== generation.current || getToken() !== token) return;
      void message.success(notice); pending.current = null; setAction(null); setRefresh(v => v + 1); onChanged?.();
    } catch (cause) {
      if (epoch !== generation.current || getToken() !== token) return;
      if (cause instanceof SocialContentRequestError && cause.status === 409) {
        pending.current = null; setAction(null); setRefresh(v => v + 1);
        void message.warning(`操作未完成：${cause.message}。已重新读取计划，请检查后重新确认。`);
      } else setError(cause instanceof Error ? cause.message : '操作未完成，可使用原命令重试');
    } finally { setBusy(false); }
  };
  const replaceable = snapshot?.planning?.orders.filter(order => order.replaceable) || [];
  const replacements = snapshot?.replacementTasks || [];
  return <section aria-label="内容计划操作" className="space-y-3 border-t border-border py-4">
    <Space wrap>
      <Button disabled={loading || busy || !!pending.current} onClick={() => setRefresh(v => v + 1)}>刷新计划</Button>
      <Button disabled={!replaceable.length || !replacements.length || busy || !!pending.current} onClick={() => open('replace')}>替换未开始计划</Button>
      <Button disabled={!snapshot?.planning || busy || !!pending.current} onClick={() => open('increase')}>追加本周目标</Button>
      <Button danger disabled={!snapshot?.cancelable || snapshot?.cancellationPending || busy || !!pending.current} onClick={() => open('cancel')}>{(snapshot?.cancelTarget?.participants.length || 0) > 1 ? '取消原任务及修订' : '取消此任务'}</Button>
    </Space>
    {loading && <Spin size="small" aria-label="读取计划" />}
    {snapshot?.planning && <p className="text-sm text-text-secondary">本周创作目标 {snapshot.planning.limit} 条 · 已关联 {snapshot.planning.orders.length} 条内容</p>}
    {snapshot && !snapshot.cancelable && snapshot.cancelBlockedReason && <p className="text-sm text-text-secondary">暂不可取消：{snapshot.cancelBlockedReason}</p>}
    {snapshot?.cancellationPending && <Alert type="warning" showIcon title="整体停止正在核验，请刷新计划查看结果；不要重新发起取消。" />}
    {snapshot?.cancellation && <div aria-label="整体取消核验结果" className="space-y-2">
      <Alert type={snapshot.cancellation.externalSettlementPending ? 'warning' : 'info'} showIcon title={snapshot.cancellation.executionStopped ? '后续执行已停止，历史运行与交付保留。' : '停止请求已记录，执行状态待核验。'} description={`${snapshot.cancellation.quotaReleased ? '创作名额已安全释放。' : '创作名额保留。'}${snapshot.cancellation.externalSettlementPending ? '外部结果、未知回执或费用仍待核验，不代表外部请求已取消。' : ''}`} />
      <ul className="space-y-2">{snapshot.cancellation.participants.map((participant, index) => {
        const identity = snapshot.cancelTarget?.participants.find(item => item.taskId === participant.taskId);
        return <li key={participant.taskId} className="text-sm"><span>{identity?.title || (index === 0 ? '原任务' : '修订任务')} · {orderParticipantStatus(participant.status)}</span>{participant.preservedStatus && <span> · 历史状态保留：{orderParticipantStatus(participant.preservedStatus)}</span>}{!!participant.retainedReasons.length && <p className="text-text-secondary">{participant.retainedReasons.map(retainedOrderReason).join('；')}</p>}</li>;
      })}</ul>
    </div>}
    {snapshot?.planning && (!replaceable.length || !replacements.length) && <p className="text-sm text-text-secondary">暂无可安全替换的计划与待承接草稿；执行中、已付费或结果未知的任务不作静默替换。</p>}
    {error && !action && <Alert type="error" showIcon title={error} />}
    <Modal title={action ? titles[action] : ''} open={!!action} width={560} maskClosable={false} closable={!busy && !pending.current} keyboard={!busy && !pending.current} confirmLoading={busy} okText={pending.current ? '使用原命令重试' : '确认'} onOk={() => void submit().catch(() => {})} onCancel={() => { if (!busy && !pending.current) setAction(null); }} cancelButtonProps={{ disabled: busy || !!pending.current }} okButtonProps={{ danger: action === 'cancel' }}>
      <div className="space-y-4">
        <Alert type="warning" showIcon title="历史运行、交付凭据和费用不会删除或清零；本操作不批准发布，也不自动启动新增内容。" />
        {action === 'cancel' && snapshot?.cancelTarget && <div><p>本次停止以下任务的后续执行；已完成交付保持原状，外部在途请求与未知回执继续核验。</p><ul className="space-y-2">{snapshot.cancelTarget.participants.map(participant => <li key={participant.taskId}>{participant.role === 'original' ? '原任务' : '修订任务'}：{participant.title} · {orderParticipantStatus(participant.status)}</li>)}</ul></div>}
        {error && <Alert type="error" showIcon title={error} />}
        {!!pending.current && !busy && <p role="status">上次操作的结果尚未确认，请使用原命令重试核验，不要重新发起操作。</p>}
        <Form form={form} layout="vertical" disabled={busy || !!pending.current}>
          {action === 'replace' && <><Form.Item name="selectedContentId" label="被替换的未开始计划" rules={[{ required: true }]}><Select options={replaceable.map(order => ({ value: order.contentId, label: order.title }))} /></Form.Item><Form.Item name="replacementTaskId" label="承接计划的真实草稿" rules={[{ required: true }]}><Select options={replacements.map(task => ({ value: task.taskId, label: task.title }))} /></Form.Item></>}
          {action === 'increase' && <Form.Item name="newLimit" label="本周新的创作总目标（条）" rules={[{ required: true, type: 'number', min: (snapshot?.planning?.limit || 0) + 1, max: 100 }]}><InputNumber min={(snapshot?.planning?.limit || 0) + 1} max={100} precision={0} /></Form.Item>}
          <Form.Item name="reason" label="操作原因" rules={[{ required: true, whitespace: true, message: '请填写原因以保留审计记录' }, { max: 500 }]}><Input.TextArea rows={3} maxLength={500} /></Form.Item>
        </Form>
      </div>
    </Modal>
  </section>;
}
