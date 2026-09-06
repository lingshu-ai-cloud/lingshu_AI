import { store } from '../storage/index.js';
import type { DataStore } from '../storage/datastore.js';
import { nextReviewWeek, normalizeTodo, todoIssues, type ReviewTodo, type ReviewTodoBoard } from '../../src/lib/reviewTodos.js';
import { withDigitalEmployeeRunLock } from './runControl.js';
export const REVIEW_TODO_COLLECTION = 'review_todo_boards';
type Row = { id: string; tenant_id: string; week: string; auto_assign: boolean; payload: ReviewTodoBoard };
export type AllocateReviewTodos = (tenantId: string, userId: string, board: ReviewTodoBoard) => Promise<string>;
const parse = (row: Row): ReviewTodoBoard => typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
// Shares the application's single-active-worker locking model. Schedule and
// manual dispatch enter the same queue, including saves and deletions.
export class ReviewTodoService {
  constructor(private db: DataStore = store) {}
  async get(tenantId: string, week = nextReviewWeek()): Promise<ReviewTodoBoard> {
    const rows = await this.db.list<Row>(REVIEW_TODO_COLLECTION, { where: { tenant_id: tenantId, week }, perPage: 1 });
    const history = await this.db.list<Row>(REVIEW_TODO_COLLECTION, { where: { tenant_id: tenantId }, sort: '-week', perPage: 52 });
    const recentWeeks = history.items.map(row => ({ week: row.week, pending: parse(row).items.filter(i => i.status !== 'assigned').length }));
    return rows.items[0] ? { ...parse(rows.items[0]), id: rows.items[0].id, recentWeeks } : { id: '', revision: 0, sourceGoalId: '', week, targetGoalId: '', autoAssign: false, scheduledAt: `${week}T09:00:00+08:00`, items: [], lastError: '', recentWeeks };
  }
  private async write(tenantId: string, board: ReviewTodoBoard): Promise<ReviewTodoBoard> {
    const next = { ...board, revision: board.revision + 1 };
    const fields = { tenant_id: tenantId, week: next.week, auto_assign: next.autoAssign, payload: next };
    if (board.id) { if (!await this.db.update(REVIEW_TODO_COLLECTION, board.id, fields)) throw Error('待办保存失败，请重试'); }
    else { const row = await this.db.create<Row>(REVIEW_TODO_COLLECTION, fields); if (!row) throw Error('待办存储不可用'); next.id = row.id; }
    return next;
  }
  async save(tenantId: string, raw: ReviewTodoBoard, userId = ''): Promise<ReviewTodoBoard> {
    return withDigitalEmployeeRunLock(tenantId, 'review-todos', async () => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.week) || new Date(`${raw.week}T00:00:00Z`).getUTCDay() !== 1) throw Error('请选择周一作为下周周期');
      const old = await this.get(tenantId, raw.week);
      if (old.revision !== raw.revision) throw Error('待办已更新，请刷新后重试');
      if (!Array.isArray(raw.items) || raw.items.length > 50) throw Error('最多保存 50 条待办');
      const assigned = old.items.filter(i => i.status === 'assigned');
      if (assigned.some(i => !raw.items.some(n => n.id === i.id))) throw Error('已分配待办请在目标中调整，不能删除');
      const items = raw.items.map(i => normalizeTodo(i, old.items.find(p => p.id === i.id)));
      if (new Set(items.map(i => i.id)).size !== items.length) throw Error('存在重复待办');
      const source = await this.db.getById<{tenant_id: string}>('weekly_goals', raw.sourceGoalId);
      if (!source || source.tenant_id !== tenantId) throw Error('请先选择当前企业的复盘目标');
      if (raw.targetGoalId) { const target = await this.db.getById<{tenant_id:string;starts_at:string}>('weekly_goals', raw.targetGoalId); if (!target || target.tenant_id !== tenantId || target.starts_at !== raw.week) throw Error('目标必须属于当前企业且从指定周一开始'); }
      if (raw.autoAssign && process.env.DIGITAL_EMPLOYEE_RUNTIME_ENABLED === 'false') throw Error('自动分配服务当前已关闭，请手动分配');
      const scheduledAt = `${raw.week}T09:00:00+08:00`;
      if (raw.autoAssign && !items.some(i => i.status !== 'assigned')) throw Error('请先添加待分配任务');
      if (raw.autoAssign && Date.parse(scheduledAt) <= Date.now()) throw Error('预约时间已过，请立即分配或选择下一周');
      if (raw.autoAssign && items.filter(i => i.status !== 'assigned').some(i => todoIssues(i).length)) throw Error('请补全执行要求和验收条件后开启预约');
      return this.write(tenantId, { ...old, sourceGoalId: raw.sourceGoalId, targetGoalId: old.items.some(i => i.status === 'assigned') ? old.targetGoalId : String(raw.targetGoalId || '').trim().slice(0, 80), authorizedBy: userId || old.authorizedBy, autoAssign: raw.autoAssign === true, scheduledAt, items, lastError: '' });
    });
  }
  async dispatch(tenantId: string, userId: string, week: string, allocate: AllocateReviewTodos, revision?: number): Promise<ReviewTodoBoard> {
    return withDigitalEmployeeRunLock(tenantId, 'review-todos', async () => {
      let board = await this.get(tenantId, week);
      if (revision !== undefined && board.revision !== revision) throw Error('待办已更新，请刷新后再分配');
      if (!board.items.some(i => i.status !== 'assigned')) return board;
      const invalid = board.items.filter(i => i.status !== 'assigned').flatMap(i => todoIssues(i).map(reason => `${i.title}：${reason}`));
      try {
        if (invalid.length) throw Error(invalid.join('；'));
        const goalId = await allocate(tenantId, userId, board);
        board = { ...board, targetGoalId: goalId, autoAssign: false, lastError: '', items: board.items.map(i => ({ ...i, status: 'assigned', reason: '', assignedGoalId: goalId })) };
      } catch (error) {
        const reason = error instanceof Error ? error.message : '分配失败，请重试';
        board = { ...board, autoAssign: false, lastError: reason, items: board.items.map(i => i.status === 'assigned' ? i : { ...i, status: 'needs_input', reason }) };
      }
      return this.write(tenantId, board);
    });
  }
  async runDue(allocate: AllocateReviewTodos, now = new Date()) {
    // Load pages before mutation so disabling schedules cannot skip later pages.
    const due: Row[] = [];
    for (let page = 1; ; page++) { const rows = await this.db.list<Row>(REVIEW_TODO_COLLECTION, { where: { auto_assign: true }, page, perPage: 100 }); due.push(...rows.items); if (page >= rows.totalPages) break; }
    for (const row of due) {
      const board = parse(row);
      if (Date.parse(board.scheduledAt) > now.getTime()) continue;
      try { await withDigitalEmployeeRunLock(row.tenant_id, 'review-todos', async () => {
        const current = await this.get(row.tenant_id, row.week);
        if (current.autoAssign && Date.parse(current.scheduledAt) <= now.getTime()) await this.dispatch(row.tenant_id, current.authorizedBy || '', row.week, allocate);
      }); } catch (error) { console.error('[review-todos] scheduled allocation failed', row.id, (error as Error).message); }
    }
  }
}
export const reviewTodoService = new ReviewTodoService();
