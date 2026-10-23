import { useState } from 'react';
import { Alert, Button, Form, Input, Modal, Radio, Space, Tabs } from 'antd';
import { authApi } from '../lib/auth';
import { useAppearance } from '../lib/appearance';

interface Props { open: boolean; onClose: () => void; onLogout?: () => void }

export default function AccountSettingsModal({ open, onClose, onLogout }: Props) {
  const { preference, appearance, setPreference } = useAppearance();
  const [tab, setTab] = useState('password');
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState('');
  const [passwordForm] = Form.useForm();

  const submitPassword = async ({ current, next, confirm }: { current: string; next: string; confirm: string }) => {
    setError(''); setSaving(true);
    try { await authApi.changePassword(current, next, confirm); setChanged(true); passwordForm.resetFields(); }
    catch (e) { setError(e instanceof Error ? e.message : '修改密码失败'); }
    finally { setSaving(false); }
  };
  return <Modal open={open} onCancel={onClose} title="账号设置" width={720} footer={null} mask={{ closable: false }} keyboard={!saving} closable={!saving} styles={{ body: { maxHeight: '72dvh', overflowY: 'auto' } }} afterClose={() => { passwordForm.resetFields(); setError(''); }}>
    {error && <Alert type="error" title={error} showIcon className="mb-4" />}
    <Tabs activeKey={tab} onChange={key => { if (!saving) { setTab(key); setError(''); } }} items={[
      { key: 'appearance', label: '外观', children: <div className="space-y-4">
        <p className="text-sm text-text-secondary">当前为{appearance === 'dark' ? '夜间' : '日间'}模式。自动模式按北京时间 20:00–次日 08:00 开启夜间模式。</p>
        <Radio.Group value={preference} onChange={event => setPreference(event.target.value)} aria-label="外观模式">
          <Radio value="auto">自动切换</Radio>
          <Radio value="light">始终日间（关闭夜间）</Radio>
          <Radio value="dark">始终夜间</Radio>
        </Radio.Group>
      </div> },
      { key: 'password', label: '修改密码', children: changed
        ? <Space orientation="vertical"><Alert type="success" showIcon title="密码修改成功" description="请使用新密码重新登录。" /><Button type="primary" onClick={onLogout}>重新登录</Button></Space>
        : <Form form={passwordForm} layout="vertical" onFinish={submitPassword} style={{ maxWidth: 440 }} disabled={saving}>
          <p className="mb-5 text-sm text-text-muted">修改后需要使用新密码重新登录。</p>
          <Form.Item name="current" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }]}><Input.Password autoComplete="current-password" /></Form.Item>
          <Form.Item name="next" label="新密码" dependencies={['current']} rules={[{ required: true, min: 8, message: '新密码至少需要 8 位' }, ({ getFieldValue }) => ({ validator: (_, value) => !value || value !== getFieldValue('current') ? Promise.resolve() : Promise.reject(new Error('新密码不能与当前密码相同')) })]}><Input.Password autoComplete="new-password" /></Form.Item>
          <Form.Item name="confirm" label="确认新密码" dependencies={['next']} rules={[{ required: true, message: '请再次输入新密码' }, ({ getFieldValue }) => ({ validator: (_, value) => !value || value === getFieldValue('next') ? Promise.resolve() : Promise.reject(new Error('两次输入的新密码不一致')) })]}><Input.Password autoComplete="new-password" /></Form.Item>
          <Button type="primary" htmlType="submit" loading={saving}>确认修改</Button>
        </Form> },
    ]} />
  </Modal>;
}
