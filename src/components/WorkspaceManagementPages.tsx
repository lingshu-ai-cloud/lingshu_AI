import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  BrainCircuit, FileText, Search, Sparkles, ShieldCheck, UserRoundCog,
  Users, LockKeyhole, Database, Clock3, Plus, Trash2, Loader2,
} from 'lucide-react';
import { authApi, authHeader, type EmployeeAccount, type OrganizationRole } from '../lib/auth';

type ScriptItem = {
  id: string;
  title?: string;
  content?: string;
  status?: string;
  type?: string;
  created?: string;
  createdAt?: string;
};

function PageShell({ icon, title, description, children }: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col bg-white">
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-5">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">{icon}</span>
        <span className="text-sm font-semibold text-text-primary">{title}</span>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto bg-surface px-6 py-6">
        <div className="mx-auto max-w-6xl">
          <p className="mb-5 text-sm text-text-muted">{description}</p>
          {children}
        </div>
      </main>
    </div>
  );
}

export function ScriptLibraryPage() {
  const [items, setItems] = useState<ScriptItem[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetch('/api/overseas/scripts?perPage=200', { headers: authHeader() })
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(data => setItems(Array.isArray(data.items) ? data.items : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter(item => `${item.title || ''} ${item.content || ''}`.toLowerCase().includes(keyword));
  }, [items, query]);

  return (
    <PageShell icon={<FileText size={14} />} title="脚本库" description="统一保存、检索和复用社媒脚本，让成熟内容能够持续迭代。">
      <div className="mb-4 flex items-center gap-3 rounded-2xl border border-border bg-white p-3 shadow-sm">
        <Search size={16} className="text-text-muted" />
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索脚本标题或正文" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text-muted" />
        <span className="text-xs font-semibold text-text-muted">{filtered.length} 个脚本</span>
      </div>
      {loading ? (
        <div className="rounded-2xl border border-border bg-white p-10 text-center text-sm text-text-muted">正在读取脚本…</div>
      ) : filtered.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(item => (
            <article key={item.id} className="rounded-2xl border border-border bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <h2 className="line-clamp-2 text-sm font-bold text-text-primary">{item.title || '未命名脚本'}</h2>
                <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">{item.status || item.type || '草稿'}</span>
              </div>
              <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-text-secondary">{item.content || '暂无脚本正文'}</p>
              <p className="mt-4 flex items-center gap-1 text-[10px] text-text-muted"><Clock3 size={11} />{item.createdAt || item.created || '时间未记录'}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-white p-12 text-center">
          <Sparkles size={28} className="mx-auto text-emerald-500" />
          <h2 className="mt-3 text-sm font-bold text-text-primary">脚本库暂为空</h2>
          <p className="mt-1 text-xs text-text-muted">从灵感大屏或智能素材生成脚本后，将在这里统一管理。</p>
        </div>
      )}
    </PageShell>
  );
}

export function AgentMemoryPage() {
  const memories = [
    { title: '品牌与企业事实', desc: '企业定位、产品信息、能力边界与合规事实。', icon: Database },
    { title: '客户偏好', desc: '客户关注点、沟通语言、采购阶段与历史反馈。', icon: Users },
    { title: '内容经验', desc: '高表现选题、脚本结构、素材组合和平台反馈。', icon: Sparkles },
    { title: '行为规则', desc: '报价、回复、发布与人工确认的长期执行规则。', icon: ShieldCheck },
  ];
  return (
    <PageShell icon={<BrainCircuit size={14} />} title="智能体记忆" description="查看和治理智能体长期使用的业务记忆，明确来源、用途与可见范围。">
      <div className="grid gap-4 md:grid-cols-2">
        {memories.map(({ title, desc, icon: Icon }) => (
          <section key={title} className="rounded-2xl border border-border bg-white p-5 shadow-sm">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><Icon size={18} /></div>
            <h2 className="mt-4 text-sm font-bold text-text-primary">{title}</h2>
            <p className="mt-1 text-xs leading-5 text-text-muted">{desc}</p>
            <div className="mt-4 rounded-xl bg-surface px-3 py-2 text-[11px] font-semibold text-text-muted">记忆记录将在后续数据接入后显示</div>
          </section>
        ))}
      </div>
    </PageShell>
  );
}

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
  const submitMember = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const employee = await authApi.addEmployee({ name, email, password, role });
      setMembers(items => [...items, employee]);
      setAdding(false); setName(''); setEmail(''); setPassword(''); setRole('social_operator');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '添加成员失败'); }
    finally { setSaving(false); }
  };

  const updateRole = async (member: EmployeeAccount, nextRole: OrganizationRole) => {
    setError('');
    try {
      await authApi.updateEmployeeRole(member.id, nextRole);
      setMembers(items => items.map(item => item.id === member.id ? { ...item, role: nextRole } : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : '角色更新失败'); }
  };

  const removeMember = async (member: EmployeeAccount) => {
    if (!window.confirm(`确认移除成员 ${member.name || member.email}？`)) return;
    setError('');
    try { await authApi.deleteEmployee(member.id); setMembers(items => items.filter(item => item.id !== member.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '成员移除失败'); }
  };

  const roles = roleDefinitions.map(definition => ({
    ...definition,
    count: members.filter(member => member.role === definition.id).length,
  }));
  return (
    <PageShell icon={<UserRoundCog size={14} />} title="组织与权限" description="管理组织成员、角色权限和数据访问范围。">
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-white p-4"><Users size={18} className="text-emerald-600" /><p className="mt-3 text-2xl font-bold text-text-primary">{members.length}</p><p className="text-xs text-text-muted">组织成员</p></div>
        <div className="rounded-2xl border border-border bg-white p-4"><ShieldCheck size={18} className="text-emerald-600" /><p className="mt-3 text-2xl font-bold text-text-primary">{roles.length}</p><p className="text-xs text-text-muted">预设角色</p></div>
        <div className="rounded-2xl border border-border bg-white p-4"><LockKeyhole size={18} className="text-emerald-600" /><p className="mt-3 text-2xl font-bold text-text-primary">0</p><p className="text-xs text-text-muted">待处理邀请</p></div>
      </div>
      <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <div className="border-b border-border px-5 py-4"><h2 className="text-sm font-bold text-text-primary">角色权限</h2><p className="mt-1 text-xs text-text-muted">新成员加入后按角色获得最小必要权限；只有超级管理员可以添加管理员。</p></div>
        {roles.map(role => (
          <div key={role.name} className="flex items-center gap-4 border-b border-border px-5 py-4 last:border-0">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface text-text-muted"><ShieldCheck size={16} /></span>
            <div className="min-w-0 flex-1"><p className="text-sm font-bold text-text-primary">{role.name}</p><p className="truncate text-xs text-text-muted">{role.scope}</p></div>
            <span className="text-xs font-semibold text-text-muted">{role.count} 人</span>
          </div>
        ))}
      </section>
      <section className="mt-4 overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div><h2 className="text-sm font-bold text-text-primary">企业成员</h2><p className="mt-1 text-xs text-text-muted">同一企业、同一角色共享对应业务数据，企业之间保持隔离。</p></div>
          {canManage && <button type="button" onClick={() => setAdding(value => !value)} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white"><Plus size={14} />添加成员</button>}
        </div>
        {error && <p className="m-4 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">{error}</p>}
        {adding && canManage && <form onSubmit={submitMember} autoComplete="off" className="grid gap-3 border-b border-border bg-surface p-4 md:grid-cols-2">
          <input value={name} onChange={event => setName(event.target.value)} name="organization-member-name" autoComplete="off" data-1p-ignore data-lpignore="true" placeholder="成员姓名" className="rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500" />
          <input required type="email" value={email} onChange={event => setEmail(event.target.value)} name="organization-member-email" autoComplete="off" data-1p-ignore data-lpignore="true" placeholder="登录邮箱" className="rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500" />
          <input required minLength={8} type="password" value={password} onChange={event => setPassword(event.target.value)} name="organization-member-initial-password" autoComplete="new-password" data-1p-ignore data-lpignore="true" placeholder="初始密码（至少 8 位）" className="rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500" />
          <select value={role} onChange={event => setRole(event.target.value as OrganizationRole)} className="rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500">
            <option value="admin">管理员</option><option value="social_operator">社媒运营专员</option><option value="customer_service">客户服务专员</option>
          </select>
          <div className="flex justify-end gap-2 md:col-span-2"><button type="button" onClick={() => setAdding(false)} className="px-3 py-2 text-xs font-bold text-text-muted">取消</button><button disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-60">{saving && <Loader2 size={13} className="animate-spin" />}创建账号</button></div>
        </form>}
        {loading ? <div className="flex justify-center p-8"><Loader2 className="animate-spin text-emerald-600" /></div> : members.map(member => (
          <div key={member.id} className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3 last:border-0">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-sm font-black text-emerald-700">{(member.name || member.email)[0]?.toUpperCase()}</span>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-text-primary">{member.name || member.email.split('@')[0]}{member.isCurrent && <span className="ml-2 text-[10px] text-emerald-600">当前账号</span>}</p><p className="truncate text-xs text-text-muted">{member.email}</p></div>
            {canManage && !member.isCurrent ? <select value={member.role} onChange={event => void updateRole(member, event.target.value as OrganizationRole)} className="rounded-lg border border-border bg-white px-2 py-1.5 text-xs font-semibold"><option value="admin">管理员</option><option value="social_operator">社媒运营专员</option><option value="customer_service">客户服务专员</option></select> : <span className="text-xs font-semibold text-text-muted">{roleDefinitions.find(item => item.id === member.role)?.name}</span>}
            {canManage && !member.isCurrent && <button type="button" onClick={() => void removeMember(member)} title="移除成员" className="rounded-lg p-2 text-text-muted hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>}
          </div>
        ))}
      </section>
    </PageShell>
  );
}
