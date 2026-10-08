import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { KeyRound, Loader2, Plus, Trash2, UserRound, UsersRound, X } from 'lucide-react';
import { authApi, type EmployeeAccount, type OrganizationRole } from '../lib/auth';
import { useModalFocus } from '../hooks/useModalFocus';

interface Props { open: boolean; onClose: () => void; onLogout?: () => void; canManageEmployees?: boolean }
const field = 'ui-field !rounded-md';

export default function AccountSettingsModal({ open, onClose, onLogout, canManageEmployees = false }: Props) {
  const [tab, setTab] = useState<'password' | 'employees'>('password');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState('');
  const [employees, setEmployees] = useState<EmployeeAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [initialPassword, setInitialPassword] = useState('');
  const [employeeRole, setEmployeeRole] = useState<OrganizationRole>('social_operator');
  const dialogRef = useModalFocus<HTMLDivElement>({
    open,
    onClose,
    closeOnEscape: () => !saving,
  });

  useEffect(() => {
    if (!open || tab !== 'employees') return;
    setLoading(true); setError('');
    authApi.employees().then(setEmployees).catch(e => setError(e instanceof Error ? e.message : '员工列表加载失败')).finally(() => setLoading(false));
  }, [open, tab]);

  useEffect(() => {
    if (!canManageEmployees && tab === 'employees') setTab('password');
  }, [canManageEmployees, tab]);

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    if (next.length < 8) { setError('新密码至少需要 8 位'); return; }
    if (next !== confirm) { setError('两次输入的新密码不一致'); return; }
    if (current === next) { setError('新密码不能与当前密码相同'); return; }
    setSaving(true);
    try { await authApi.changePassword(current, next, confirm); setChanged(true); }
    catch (e) { setError(e instanceof Error ? e.message : '修改密码失败'); }
    finally { setSaving(false); }
  };

  const submitEmployee = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setSaving(true);
    try {
      const employee = await authApi.addEmployee({ name, email, password: initialPassword, role: employeeRole });
      setEmployees(items => [...items, employee]); setAdding(false); setName(''); setEmail(''); setInitialPassword('');
    } catch (e) { setError(e instanceof Error ? e.message : '添加员工失败'); }
    finally { setSaving(false); }
  };

  const remove = async (employee: EmployeeAccount) => {
    if (!window.confirm(`确认移除员工 ${employee.name || employee.email}？`)) return;
    try { await authApi.deleteEmployee(employee.id); setEmployees(items => items.filter(item => item.id !== employee.id)); }
    catch (e) { setError(e instanceof Error ? e.message : '删除员工失败'); }
  };

  return <AnimatePresence>{open && <motion.div role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/35 p-0 sm:items-center sm:p-4" onMouseDown={e => { if (e.target === e.currentTarget && !saving) onClose(); }}>
    <motion.div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="account-settings-title" initial={{ opacity: 0, y: 12, scale: .99 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: .99 }} className="flex max-h-[92dvh] w-full max-w-[760px] flex-col overflow-hidden rounded-t-lg border border-border bg-white shadow-xl sm:h-[580px] sm:flex-row sm:rounded-lg">
      <aside className="w-full shrink-0 border-b border-border bg-surface-2 px-4 pt-4 sm:w-48 sm:border-b-0 sm:border-r sm:p-4">
        <p id="account-settings-title" className="px-1 pb-3 text-base font-bold text-text-primary sm:px-2 sm:pb-4">账号设置</p>
        <div className={`grid gap-4 sm:block ${canManageEmployees ? 'grid-cols-2' : 'grid-cols-1'}`} role="tablist" aria-label="账号设置分类">
        <button type="button" role="tab" aria-selected={tab === 'password'} onClick={() => { setTab('password'); setError(''); }} className={`flex w-full items-center justify-center gap-2 border-b-2 px-2 py-2.5 text-sm font-semibold transition-colors sm:mb-1 sm:justify-start sm:rounded-md sm:border-b-0 sm:border-l-2 sm:px-3 ${tab === 'password' ? 'border-accent bg-white text-text-primary' : 'border-transparent text-text-muted hover:bg-white/70 hover:text-text-secondary'}`}><KeyRound size={16} />修改密码</button>
        {canManageEmployees && <button type="button" role="tab" aria-selected={tab === 'employees'} onClick={() => { setTab('employees'); setError(''); }} className={`flex w-full items-center justify-center gap-2 border-b-2 px-2 py-2.5 text-sm font-semibold transition-colors sm:justify-start sm:rounded-md sm:border-b-0 sm:border-l-2 sm:px-3 ${tab === 'employees' ? 'border-accent bg-white text-text-primary' : 'border-transparent text-text-muted hover:bg-white/70 hover:text-text-secondary'}`}><UsersRound size={16} />员工管理</button>}
        </div>
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6">
        <div className="flex justify-between gap-4"><div><h2 className="text-lg font-bold text-text-primary">{tab === 'password' ? '修改密码' : '员工管理'}</h2><p className="mt-1 text-xs text-text-muted">{tab === 'password' ? '修改后需要使用新密码重新登录。' : '管理同一企业下的员工登录账号。'}</p></div><button type="button" data-modal-initial-focus onClick={onClose} aria-label="关闭账号设置" className="h-8 w-8 shrink-0 rounded-md p-1.5 text-text-muted hover:bg-surface-2"><X size={17} /></button></div>
        {error && <p role="alert" className="mt-4 border-l-2 border-red bg-red/5 px-3 py-2 text-xs font-medium text-red">{error}</p>}
        {tab === 'password' ? changed ? <div className="mt-8"><div role="status" className="border-l-2 border-accent bg-accent-glow p-4 text-sm font-semibold text-accent">密码修改成功，请使用新密码重新登录。</div><button type="button" onClick={onLogout} className="btn-primary mt-4">重新登录</button></div> : <form onSubmit={submitPassword} className="mt-6 max-w-md space-y-4">
          {[['当前密码', current, setCurrent], ['新密码', next, setNext], ['确认新密码', confirm, setConfirm]].map(([label, value, setter]) => <label key={String(label)} className="block"><span className="mb-1.5 block text-xs font-semibold text-text-secondary">{String(label)}</span><input required type="password" value={String(value)} onChange={e => (setter as typeof setCurrent)(e.target.value)} className={field} autoComplete={label === '当前密码' ? 'current-password' : 'new-password'} /></label>)}
          <button disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-60">{saving && <Loader2 size={14} className="animate-spin" />}确认修改</button>
        </form> : <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
          <div className="mb-4 flex justify-end"><button type="button" onClick={() => setAdding(value => !value)} className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-xs font-bold text-white"><Plus size={14} />添加员工</button></div>
          {adding && <form name="lingshu-add-employee" autoComplete="off" onSubmit={submitEmployee} className="mb-4 grid grid-cols-1 gap-3 border-y border-border bg-surface-2 p-4 sm:grid-cols-2">
            <input value={name} onChange={e => setName(e.target.value)} name="employee-display-name" autoComplete="off" data-1p-ignore data-lpignore="true" placeholder="员工姓名" className={field} />
            <input required type="email" value={email} onChange={e => setEmail(e.target.value)} name="employee-invite-email" autoComplete="off" data-1p-ignore data-lpignore="true" placeholder="登录邮箱" className={field} />
            <select value={employeeRole} onChange={e => setEmployeeRole(e.target.value as OrganizationRole)} className={`${field} ui-select sm:col-span-2`}>
              <option value="admin">管理员</option>
              <option value="social_operator">社媒运营专员</option>
              <option value="customer_service">客户服务专员</option>
            </select>
            <input required minLength={8} type="password" value={initialPassword} onChange={e => setInitialPassword(e.target.value)} name="employee-initial-password" autoComplete="new-password" data-1p-ignore data-lpignore="true" placeholder="初始密码（至少 8 位）" className={`${field} sm:col-span-2`} />
            <p className="text-[11px] text-text-muted sm:col-span-2">请为新员工设置独立初始密码，不要使用当前账号或管理员密码。</p>
            <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={() => { setAdding(false); setName(''); setEmail(''); setInitialPassword(''); }} className="rounded-md px-3 py-2 text-xs font-semibold text-text-muted hover:bg-white">取消</button><button disabled={saving} className="rounded-md bg-accent px-4 py-2 text-xs font-bold text-white">保存员工</button></div>
          </form>}
          {loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-accent" /></div> : <div className="divide-y divide-border border-y border-border">{employees.map(employee => <div key={employee.id} className="flex items-center gap-3 px-1 py-3 sm:px-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-glow text-accent"><UserRound size={17} /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-text-primary">{employee.name || employee.email.split('@')[0]} {employee.isCurrent && <span className="ml-1 text-[10px] text-accent">当前账号</span>}</p><p className="truncate text-xs text-text-muted">{employee.email}</p></div>{!employee.isCurrent && <button type="button" onClick={() => void remove(employee)} className="rounded-md p-2 text-text-muted hover:bg-red/5 hover:text-red" title="移除员工" aria-label={`移除员工 ${employee.name || employee.email}`}><Trash2 size={15} /></button>}</div>)}{employees.length === 0 && <p className="py-12 text-center text-sm text-text-muted">暂无员工账号</p>}</div>}
        </div>}
      </section>
    </motion.div>
  </motion.div>}</AnimatePresence>;
}
