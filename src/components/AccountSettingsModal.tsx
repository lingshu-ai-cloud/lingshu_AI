import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tabs, Tag } from 'antd';
import { Plus, Trash2 } from 'lucide-react';
import { authApi, type EmployeeAccount, type OrganizationRole } from '../lib/auth';

interface Props { open: boolean; onClose: () => void; onLogout?: () => void; canManageEmployees?: boolean }

export default function AccountSettingsModal({ open, onClose, onLogout, canManageEmployees = false }: Props) {
  const [tab, setTab] = useState('password');
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState('');
  const [employees, setEmployees] = useState<EmployeeAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [employeeForm] = Form.useForm();
  const [passwordForm] = Form.useForm();

  useEffect(() => {
    if (!open || tab !== 'employees' || !canManageEmployees) return;
    let active = true;
    setLoading(true); setError('');
    authApi.employees().then(value => { if (active) setEmployees(value); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : '员工列表加载失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, tab, canManageEmployees]);

  useEffect(() => {
    if (!canManageEmployees && tab === 'employees') setTab('password');
  }, [canManageEmployees, tab]);

  const submitPassword = async ({ current, next, confirm }: { current: string; next: string; confirm: string }) => {
    setError(''); setSaving(true);
    try { await authApi.changePassword(current, next, confirm); setChanged(true); passwordForm.resetFields(); }
    catch (e) { setError(e instanceof Error ? e.message : '修改密码失败'); }
    finally { setSaving(false); }
  };
  const submitEmployee = async (values: { name: string; email: string; password: string; role: OrganizationRole }) => {
    setError(''); setSaving(true);
    try {
      const employee = await authApi.addEmployee(values);
      setEmployees(items => [...items, employee]); setAdding(false); employeeForm.resetFields();
    } catch (e) { setError(e instanceof Error ? e.message : '添加员工失败'); }
    finally { setSaving(false); }
  };
  const remove = async (employee: EmployeeAccount) => {
    try { await authApi.deleteEmployee(employee.id); setEmployees(items => items.filter(item => item.id !== employee.id)); }
    catch (e) { setError(e instanceof Error ? e.message : '删除员工失败'); }
  };

  return <Modal open={open} onCancel={onClose} title="账号设置" width={720} footer={null} mask={{ closable: false }} keyboard={!saving} closable={!saving} styles={{ body: { maxHeight: '72dvh', overflowY: 'auto' } }} afterClose={() => { passwordForm.resetFields(); employeeForm.resetFields(); setError(''); setAdding(false); }}>
    {error && <Alert type="error" title={error} showIcon className="mb-4" />}
    <Tabs activeKey={tab} onChange={key => { if (!saving) { setTab(key); setError(''); } }} items={[
      { key: 'password', label: '修改密码', children: changed
        ? <Space orientation="vertical"><Alert type="success" showIcon title="密码修改成功" description="请使用新密码重新登录。" /><Button type="primary" onClick={onLogout}>重新登录</Button></Space>
        : <Form form={passwordForm} layout="vertical" onFinish={submitPassword} style={{ maxWidth: 440 }} disabled={saving}>
          <p className="mb-5 text-sm text-text-muted">修改后需要使用新密码重新登录。</p>
          <Form.Item name="current" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }]}><Input.Password autoComplete="current-password" /></Form.Item>
          <Form.Item name="next" label="新密码" dependencies={['current']} rules={[{ required: true, min: 8, message: '新密码至少需要 8 位' }, ({ getFieldValue }) => ({ validator: (_, value) => !value || value !== getFieldValue('current') ? Promise.resolve() : Promise.reject(new Error('新密码不能与当前密码相同')) })]}><Input.Password autoComplete="new-password" /></Form.Item>
          <Form.Item name="confirm" label="确认新密码" dependencies={['next']} rules={[{ required: true, message: '请再次输入新密码' }, ({ getFieldValue }) => ({ validator: (_, value) => !value || value === getFieldValue('next') ? Promise.resolve() : Promise.reject(new Error('两次输入的新密码不一致')) })]}><Input.Password autoComplete="new-password" /></Form.Item>
          <Button type="primary" htmlType="submit" loading={saving}>确认修改</Button>
        </Form> },
      ...(canManageEmployees ? [{ key: 'employees', label: '员工管理', children: <>
        <div className="mb-4 flex items-center justify-between gap-3"><p className="text-sm text-text-muted">同一企业下的员工登录账号</p><Button icon={<Plus size={15} />} onClick={() => setAdding(true)} disabled={saving}>添加员工</Button></div>
        {adding && <Form form={employeeForm} layout="vertical" onFinish={submitEmployee} initialValues={{ role: 'social_operator' }} autoComplete="off" disabled={saving} className="mb-5 rounded-lg border border-border bg-surface-2 p-4">
          <div className="grid gap-x-4 sm:grid-cols-2"><Form.Item name="name" label="员工姓名"><Input autoComplete="off" /></Form.Item><Form.Item name="email" label="登录邮箱" rules={[{ required: true, type: 'email', message: '请输入有效的邮箱' }]}><Input autoComplete="off" /></Form.Item></div>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}><Select options={[{ value: 'admin', label: '管理员' }, { value: 'social_operator', label: '社媒运营专员' }, { value: 'customer_service', label: '客户服务专员' }]} /></Form.Item>
          <Form.Item name="password" label="初始密码" extra="为员工设置独立密码，不要复用管理员密码。" rules={[{ required: true, min: 8, message: '初始密码至少需要 8 位' }]}><Input.Password autoComplete="new-password" /></Form.Item>
          <Space><Button onClick={() => { setAdding(false); employeeForm.resetFields(); }}>取消</Button><Button type="primary" htmlType="submit" loading={saving}>保存员工</Button></Space>
        </Form>}
        <Table rowKey="id" dataSource={employees} loading={loading} size="middle" pagination={employees.length > 10 ? { pageSize: 10 } : false} scroll={{ x: 480 }} locale={{ emptyText: '暂无员工账号' }} columns={[
          { title: '员工', dataIndex: 'name', render: (_, item) => <span>{item.name || item.email.split('@')[0]} {item.isCurrent && <Tag>当前账号</Tag>}</span> },
          { title: '登录邮箱', dataIndex: 'email' },
          { title: '操作', key: 'actions', width: 72, render: (_, item) => !item.isCurrent && <Popconfirm title={`移除员工 ${item.name || item.email}？`} description="移除后该员工将无法访问企业空间。" okText="移除" okButtonProps={{ danger: true }} onConfirm={() => remove(item)}><Button danger type="text" icon={<Trash2 size={15} />} aria-label={`移除员工 ${item.name || item.email}`} /></Popconfirm> },
        ]} />
      </> }] : []),
    ]} />
  </Modal>;
}
