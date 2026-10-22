import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Input, Modal, Popconfirm, Select, Table, Tag } from 'antd';
import { Plus, Trash2, UserRoundCog, Users, ShieldCheck } from 'lucide-react';
import { authApi, type EmployeeAccount, type OrganizationRole } from '../lib/auth';
import PageShell from './WorkspacePageShell';

export function OrganizationPermissionsPage() {
  const roleDefinitions: Array<{ id: OrganizationRole; name: string; scope: string }> = [
    { id: 'super_admin', name: '超级管理员', scope: '全部系统权限，可以添加和管理管理员' },
    { id: 'admin', name: '管理员', scope: '管理组织成员、系统集成与全部业务数据' },
    { id: 'social_operator', name: '社媒运营专员', scope: '使用社媒运营、智能素材、账号管理与定时任务' },
    { id: 'customer_service', name: '客户服务专员', scope: '使用客户会话、客户资料、订单管理与定时任务' },
  ];
  const [members, setMembers] = useState<EmployeeAccount[]>([]);
  const [currentRole, setCurrentRole] = useState<OrganizationRole>('customer_service');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [memberBusy, setMemberBusy] = useState('');
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<OrganizationRole>('social_operator');

  useEffect(() => {
    let active = true;
    Promise.all([authApi.employees(), authApi.me()])
      .then(([employees, session]) => {
        if (!active) return;
        setMembers(employees);
        setCurrentRole(session?.user.role || 'customer_service');
      })
      .catch(reason => active && setError(reason instanceof Error ? reason.message : '成员列表加载失败'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const canManage = currentRole === 'super_admin';
  const roleOptions = roleDefinitions.filter(item => item.id !== 'super_admin').map(item => ({ value: item.id, label: item.name }));
  const submitMember = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || saving) return;
    setSaving(true); setError('');
    try {
      const employee = await authApi.addEmployee({ name, email, password, role });
      setMembers(items => [...items, employee]);
      setAdding(false); setName(''); setEmail(''); setPassword(''); setRole('social_operator');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '添加成员失败'); }
    finally { setSaving(false); }
  };

  const updateRole = async (member: EmployeeAccount, nextRole: OrganizationRole) => {
    if (!canManage || member.isCurrent || memberBusy) return;
    setMemberBusy(member.id); setError('');
    try {
      await authApi.updateEmployeeRole(member.id, nextRole);
      setMembers(items => items.map(item => item.id === member.id ? { ...item, role: nextRole } : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : '角色更新失败'); }
    finally { setMemberBusy(''); }
  };

  const removeMember = async (member: EmployeeAccount) => {
    if (!canManage || member.isCurrent || memberBusy) return;
    setMemberBusy(member.id); setError('');
    try { await authApi.deleteEmployee(member.id); setMembers(items => items.filter(item => item.id !== member.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '成员移除失败'); }
    finally { setMemberBusy(''); }
  };

  const roles = roleDefinitions.map(definition => ({
    ...definition,
    count: members.filter(member => member.role === definition.id).length,
  }));
  const closeMemberEditor = () => {
    if (saving) return;
    setAdding(false);
    setPassword('');
  };
  return (
    <PageShell icon={<UserRoundCog size={14} />} title="组织与权限" description="管理组织成员、角色权限和数据访问范围。">
      <div className="mb-6 flex flex-wrap gap-x-8 gap-y-3 border-b border-border pb-4 text-sm">
        <span className="inline-flex items-center gap-2 text-text-secondary"><Users size={16} />组织成员 <strong className="text-xl tabular-nums text-text-primary">{loading ? '—' : members.length}</strong></span>
        <span className="inline-flex items-center gap-2 text-text-secondary"><ShieldCheck size={16} />预设角色 <strong className="text-xl tabular-nums text-text-primary">{roles.length}</strong></span>
        {!loading && !canManage && <Tag>当前为只读权限</Tag>}
      </div>
      <section className="overflow-hidden rounded-lg border border-border bg-white">
        <div className="border-b border-border px-5 py-4"><h2 className="text-base font-semibold text-text-primary">角色权限</h2><p className="mt-1 text-sm text-text-muted">新成员加入后按角色获得最小必要权限；只有超级管理员可以添加管理员。</p></div>
        <Table rowKey="id" dataSource={roles} pagination={false} scroll={{ x: 620 }} columns={[
          { title: '角色', dataIndex: 'name', width: 180 },
          { title: '数据与功能范围', dataIndex: 'scope' },
          { title: '成员', dataIndex: 'count', width: 90, render: (count: number) => loading ? '—' : `${count} 人` },
        ]} />
      </section>
      <section className="mt-6 overflow-hidden rounded-lg border border-border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div><h2 className="text-base font-semibold text-text-primary">企业成员</h2><p className="mt-1 text-sm text-text-muted">同一企业、同一角色共享对应业务数据，企业之间保持隔离。</p></div>
          {canManage && <Button type="primary" icon={<Plus size={15} />} onClick={() => { setError(''); setAdding(true); }}>添加成员</Button>}
        </div>
        {error && !adding && <Alert className="m-4" type="error" showIcon title={error} />}
        <Table<EmployeeAccount> rowKey="id" dataSource={members} loading={loading} scroll={{ x: 640 }}
          pagination={members.length > 10 ? { defaultPageSize: 10, showSizeChanger: true, showTotal: total => `共 ${total} 位成员` } : false}
          locale={{ emptyText: '暂无企业成员' }} columns={[
            { title: '成员', key: 'member', render: (_, member) => <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 font-semibold text-emerald-700" aria-hidden="true">{(member.name || member.email)[0]?.toUpperCase()}</span>
              <div className="min-w-0"><p className="font-medium text-text-primary">{member.name || member.email.split('@')[0]}{member.isCurrent && <Tag className="ml-2" color="success">当前账号</Tag>}</p><p className="text-xs text-text-muted">{member.email}</p></div>
            </div> },
            { title: '角色', key: 'role', width: 210, render: (_, member) => canManage && !member.isCurrent
              ? <Select aria-label={`${member.name || member.email} 的角色`} className="w-full" value={member.role} disabled={Boolean(memberBusy)} loading={memberBusy === member.id}
                  options={member.role === 'super_admin' ? [{ value: 'super_admin', label: '超级管理员', disabled: true }, ...roleOptions] : roleOptions}
                  onChange={nextRole => void updateRole(member, nextRole)} />
              : roleDefinitions.find(item => item.id === member.role)?.name || member.role },
            { title: '操作', key: 'actions', width: 100, render: (_, member) => canManage && !member.isCurrent
              ? <Popconfirm title="移除成员？" description={`确认移除 ${member.name || member.email}？该成员将失去企业访问权限。`} okText="移除" cancelText="取消" okButtonProps={{ danger: true }}
                  onConfirm={() => removeMember(member)} disabled={Boolean(memberBusy)}>
                  <Button danger type="text" icon={<Trash2 size={15} />} disabled={Boolean(memberBusy)} aria-label={`移除成员 ${member.name || member.email}`}>移除</Button>
                </Popconfirm>
              : <span className="text-text-muted">—</span> },
          ]} />
      </section>
      <Modal open={adding && canManage} title="添加企业成员" onCancel={closeMemberEditor} destroyOnHidden width={560}
        closable={!saving} keyboard={!saving} mask={{ closable: !saving }}
        footer={<><Button onClick={closeMemberEditor} disabled={saving}>取消</Button><Button type="primary" htmlType="submit" form="organization-member-form" loading={saving}>创建账号</Button></>}>
        <p className="mb-5 text-sm text-text-muted">为成员创建登录账号，并分配最小必要权限。</p>
        <form id="organization-member-form" onSubmit={submitMember} autoComplete="off" className="space-y-4">
          <label className="block text-sm text-text-secondary">成员姓名<Input className="mt-2" value={name} onChange={event => setName(event.target.value)} name="organization-member-name" autoComplete="off" data-1p-ignore data-lpignore="true" disabled={saving} /></label>
          <label className="block text-sm text-text-secondary">登录邮箱 <span className="text-rose-600">*</span><Input className="mt-2" required type="email" value={email} onChange={event => setEmail(event.target.value)} name="organization-member-email" autoComplete="off" data-1p-ignore data-lpignore="true" disabled={saving} /></label>
          <label className="block text-sm text-text-secondary">初始密码 <span className="text-rose-600">*</span><Input.Password className="mt-2" required minLength={8} value={password} onChange={event => setPassword(event.target.value)} name="organization-member-initial-password" autoComplete="new-password" data-1p-ignore data-lpignore="true" placeholder="至少 8 位" disabled={saving} /></label>
          <label className="block text-sm text-text-secondary">角色<Select aria-label="新成员角色" className="mt-2 w-full" value={role} onChange={setRole} options={roleOptions} disabled={saving} /></label>
          {error && <Alert type="error" showIcon title={error} />}
        </form>
      </Modal>
    </PageShell>
  );
}
