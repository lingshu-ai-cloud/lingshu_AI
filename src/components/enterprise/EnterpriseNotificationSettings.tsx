import { useState } from 'react';
import { Input } from 'antd';
import { Bell, Loader2, Plus, X } from 'lucide-react';
import { authHeader } from '../../lib/auth';
import type { NotificationChannel, NotificationReceiver, NotificationSettings } from './enterpriseProfileTypes';
import { Field, Toggle } from './EnterpriseFormControls';

const CHANNEL_OPTIONS: Array<{ value: NotificationChannel; label: string }> = [
  { value: 'wecom', label: '企业微信' },
  { value: 'dingtalk', label: '钉钉' },
  { value: 'feishu', label: '飞书' },
  { value: 'sms', label: '短信' },
];

const inputCls = 'w-full';

interface Props {
  notifications: NotificationSettings;
  highlighted: boolean;
  onChange: (update: (current: NotificationSettings) => NotificationSettings) => void;
}

export default function EnterpriseNotificationSettings({ notifications, highlighted, onChange }: Props) {
  const [testing, setTesting] = useState('');
  const [message, setMessage] = useState('');
  const [messageError, setMessageError] = useState(false);
  const completed = Boolean(notifications.receivers.length >= 1 && notifications.lastTestAt);

  const addReceiver = () => onChange(current => ({
    ...current,
    receivers: [...current.receivers, { name: '', channel: 'wecom', target: '' }],
  }));

  const updateReceiver = (index: number, patch: Partial<NotificationReceiver>) => onChange(current => ({
    ...current,
    receivers: current.receivers.map((item, i) => i === index ? { ...item, ...patch } : item),
  }));

  const removeReceiver = (index: number) => onChange(current => ({
    ...current,
    receivers: current.receivers.filter((_, i) => i !== index),
  }));

  const testReceiver = async (receiver: NotificationReceiver, index: number) => {
    if (!receiver.target.trim()) {
      setMessageError(true);
      setMessage('请先填写接收目标');
      return;
    }
    setTesting(String(index));
    setMessage('');
    setMessageError(false);
    try {
      const result = await fetch('/api/overseas/enterprise/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ receiver }),
      }).then(r => r.json());
      if (result.error) throw new Error(result.error);
      onChange(current => result.notifications ?? { ...current, lastTestAt: result.lastTestAt || new Date().toISOString() });
      setMessage('测试提醒已发送');
    } catch (error) {
      setMessageError(true);
      setMessage(error instanceof Error ? error.message : '测试提醒发送失败');
    } finally {
      setTesting('');
    }
  };

  const setNightModeEnabled = (enabled: boolean) => {
    if (enabled && !notifications.nightMode?.enabled) {
      const ok = window.confirm([
        '开启夜班后，系统会在非工作时间继续按全局 AI 参与程度处理消息：',
        '',
        '· 全局为“只提醒我”时，夜间仍只提醒',
        '· 全局为“草稿需确认”时，夜间仍只生成草稿',
        '· 只有全局已允许自动回复时，夜间才可能发送已审批 FAQ 原文',
        '',
        '夜班不会扩大自动发送权限。需要人工确认的消息会进入次日晨报。',
      ].join('\n'));
      if (!ok) return;
    }
    onChange(current => ({ ...current, nightMode: { enabled, autoCategories: 'approved' } }));
  };

  return (
    <section id="notifications" className={`py-5 transition-all ${highlighted ? 'rounded-lg ring-2 ring-sky-300 ring-offset-4' : ''}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bell size={14} className="text-text-secondary" />
          <h3 className="text-sm font-semibold text-text-primary">通知接收方式</h3>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${completed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          {completed ? '已完成' : '未完成'}
        </span>
      </div>
      <p className="mb-4 text-[11px] leading-relaxed text-text-muted">大单、客户要通话时，提醒发给谁</p>
      <div className="space-y-3">
        {notifications.receivers.map((receiver, index) => (
          <div key={index} className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-white p-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_130px_minmax(0,1.3fr)_auto_auto]">
            <Input className={inputCls} value={receiver.name} onChange={e => updateReceiver(index, { name: e.target.value })} placeholder="接收人姓名" />
            <select className={inputCls} value={receiver.channel} onChange={e => updateReceiver(index, { channel: e.target.value as NotificationChannel })}>
              {CHANNEL_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <Input className="w-full sm:col-span-2 xl:col-span-1" value={receiver.target} onChange={e => updateReceiver(index, { target: e.target.value })} placeholder="Webhook / 手机号 / 账号" />
            <div className="grid grid-cols-[1fr_auto] gap-2 sm:col-span-2 xl:contents">
              <button type="button" onClick={() => void testReceiver(receiver, index)} disabled={testing === String(index)} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white disabled:opacity-60">
                {testing === String(index) ? <Loader2 size={12} className="animate-spin" /> : <Bell size={12} />}测试
              </button>
              <button type="button" onClick={() => removeReceiver(index)} aria-label={`删除接收人 ${receiver.name || index + 1}`} title="删除接收人" className="flex min-h-10 items-center justify-center rounded-lg border border-border bg-white px-3 text-text-muted hover:text-red"><X size={13} /></button>
            </div>
          </div>
        ))}
        <button type="button" onClick={addReceiver} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary hover:bg-surface-2">
          <Plus size={12} />添加接收人
        </button>
        {message && <p className={`text-xs font-bold ${messageError ? 'text-red-600' : 'text-emerald-700'}`}>{message}</p>}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Field label="工作开始时间">
          <Input className={inputCls} type="time" value={notifications.workHours.start ?? '09:00'} onChange={e => onChange(current => ({ ...current, workHours: { ...current.workHours, start: e.target.value } }))} />
        </Field>
        <Field label="工作结束时间">
          <Input className={inputCls} type="time" value={notifications.workHours.end ?? '22:00'} onChange={e => onChange(current => ({ ...current, workHours: { ...current.workHours, end: e.target.value } }))} />
        </Field>
        <div className="sm:col-span-2 xl:col-span-1">
          <Field label="非工作时段">
            <div className="flex h-10 items-center gap-2 rounded-lg border border-border bg-white px-3">
              <Toggle checked={notifications.quietOutsideHours ?? true} onChange={checked => onChange(current => ({ ...current, quietOutsideHours: checked }))} />
              <span className="text-xs text-text-secondary">仅记录不即时推送</span>
            </div>
          </Field>
        </div>
      </div>
      <div data-lingshu-guide="enterprise-night-mode" className="mt-4 flex items-start justify-between gap-4 border-t border-border pt-4">
        <p className="text-xs font-semibold text-text-primary">非工作时间继续接待</p>
        <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 text-xs font-bold text-text-secondary">
          <Toggle checked={Boolean(notifications.nightMode?.enabled)} onChange={setNightModeEnabled} />
          {notifications.nightMode?.enabled ? '已开启' : '未开启'}
        </label>
      </div>
    </section>
  );
}
