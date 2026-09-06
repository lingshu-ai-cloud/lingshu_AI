import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright-core';
import { createBrowserReadSession } from './browserReadSession.js';
import type { AgentProductionTarget } from '../../src/lib/agentProductionSession.js';
export interface BrowserProductionTarget extends AgentProductionTarget { userId: string; revision?: string }

export interface BrowserScope { tenantId: string; runId: string; taskId: string }
export interface BrowserFrame {
  type: 'frame'; image: string; sequence: number; capturedAt: string;
  width: number; height: number; executing: boolean;
}
export type BrowserPacket = BrowserFrame | { type: 'status'; state: 'ready' | 'executing' | 'closed' | 'error'; message: string };
type Listener = (packet: BrowserPacket) => void;
type Telemetry = (scope: BrowserScope, action: { kind: 'click' | 'navigation'; label: string; x?: number; y?: number; viewportWidth: number; viewportHeight: number }) => Promise<void>;
type PendingAction = { id: string; consumed: boolean; clicked: () => void; finish: (result: unknown) => void; result: Promise<unknown> };
interface Session {
  scope: BrowserScope; context: BrowserContext; page: Page; cdp: CDPSession;
  listeners: Set<Listener>; frame?: BrowserFrame; frameSequence: number; lastFrameAt: number;
  touchedAt: number; pending?: PendingAction; executing: boolean; closed: boolean;
  read: () => Promise<BrowserProductionTarget>; refresh?: Promise<void>; workspaceKey?: string; navigationKey?: string;
  credential: ReturnType<typeof createBrowserReadSession>;
  watchTimer?: ReturnType<typeof setInterval>;
  flushTimer?: ReturnType<typeof setTimeout>; queuedFrame?: { image: string; capturedAt: string };
}
const keyFor = (scope: BrowserScope) => JSON.stringify([scope.tenantId, scope.runId, scope.taskId]);

export function browserExecutionEnabled() { return process.env.DIGITAL_EMPLOYEE_BROWSER_EXECUTION === 'true'; }

/** Isolated browser contexts, one task-scoped single-use action binding each.
 * Viewer connections are read-only; only scheduled work arms an action. */
export class AgentBrowserSessions {
  private browser?: Promise<Browser>;
  private sessions = new Map<string, Promise<Session>>();
  private telemetry?: Telemetry;
  private housekeeping: ReturnType<typeof setInterval>;
  constructor(private options: { executablePath?: string; maxSessions?: number; appOrigin?: string } = {}) {
    this.housekeeping = setInterval(() => { void this.sweep(); }, 30_000);
    this.housekeeping.unref();
  }
  setTelemetry(callback: Telemetry) { this.telemetry = callback; }
  private launch() {
    if (!this.browser) {
      const candidates = [this.options.executablePath, process.env.AGENT_BROWSER_EXECUTABLE_PATH,
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
      const executablePath = candidates.find((file): file is string => Boolean(file && fs.existsSync(file)));
      this.browser = chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), chromiumSandbox: true })
        .then(browser => { browser.on('disconnected', () => { this.browser = undefined; }); return browser; })
        .catch(() => { this.browser = undefined; throw new Error('浏览器执行器不可用，请配置 Chrome / Chromium 路径后重试'); });
    }
    return this.browser;
  }
  private broadcast(session: Session, packet: BrowserPacket) { for (const listener of session.listeners) listener(packet); }
  private async ensure(scope: BrowserScope, read: Session['read']): Promise<Session> {
    const key = keyFor(scope);
    const existing = this.sessions.get(key);
    if (existing) { const session = await existing; session.read = read; session.touchedAt = Date.now(); return session; }
    const limit = this.options.maxSessions ?? Math.max(1, Math.min(24, Number(process.env.AGENT_BROWSER_MAX_SESSIONS) || 12));
    if (this.sessions.size >= limit) {
      const idle = (await Promise.allSettled(this.sessions.values())).flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
        .filter(session => !session.executing && !session.listeners.size).sort((a, b) => a.touchedAt - b.touchedAt)[0];
      if (idle) await idle.context.close();
      if (this.sessions.size >= limit) throw new Error('浏览器窗口已满，请关闭暂不查看的监控窗口后重试');
    }
    const creation = this.create(scope, read).catch(error => { this.sessions.delete(key); throw error; });
    this.sessions.set(key, creation);
    return creation;
  }
  private async create(scope: BrowserScope, read: Session['read']): Promise<Session> {
    const browser = await this.launch();
    const context = await browser.newContext({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1, acceptDownloads: false, serviceWorkers: 'block' });
    try {
      const target = await read();
      const credential = createBrowserReadSession({ tenantId: scope.tenantId, userId: target.userId, role: target.link.page === 'conversion' ? 'customer_service' : target.link.page === 'enterprise' ? 'admin' : 'social_operator' });
      context.on('close', credential.revoke);
      const appOrigin = new URL(this.options.appOrigin || process.env.AGENT_BROWSER_APP_ORIGIN || `http://127.0.0.1:${process.env.PORT || 8790}`).origin;
      await context.route('**/*', route => {
        const request = route.request();
        const url = new URL(request.url());
        if (!['GET', 'HEAD'].includes(request.method())) return route.abort();
        if (url.origin !== appOrigin) {
          if (url.protocol === 'https:' && ['image', 'media', 'font'].includes(request.resourceType())) return route.continue();
          return route.abort();
        }
        return route.continue();
      });
      await context.addInitScript(({ token, initialTarget }) => {
        localStorage.setItem('overseas_token', token);
        const params = new URLSearchParams(location.search);
        const next = { ...initialTarget, projectId: params.get('project') || undefined, customerId: params.get('customer') || undefined, stage: params.get('stage') || undefined };
        next.link = { ...initialTarget.link, view: params.get('view') === 'publish' ? 'publish' : initialTarget.link.view, page: params.get('page') as typeof initialTarget.link.page || initialTarget.link.page };
        (window as any).__agentProductionTarget = next;
        // Only a real pointer event draws the cursor; no task HTML is injected.
        document.addEventListener('DOMContentLoaded', () => {
          const pointer = document.createElement('div');
          pointer.setAttribute('aria-hidden', 'true');
          pointer.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:none;width:24px;height:30px;filter:drop-shadow(0 2px 2px #0008)';
          pointer.innerHTML = '<svg viewBox="0 0 24 30"><path d="M2 1L21 17L12 18L8 27Z" fill="white" stroke="#17243b" stroke-width="2"/></svg>';
          document.body.append(pointer);
          document.addEventListener('pointermove', event => { if (!event.isTrusted) return; pointer.style.display = 'block'; pointer.style.left = `${event.clientX}px`; pointer.style.top = `${event.clientY}px`; }, true);
          document.addEventListener('click', event => {
            if (!event.isTrusted) return;
            void (window as any).agentTelemetry({ kind: 'click', label: (event.target as HTMLElement).closest('button')?.textContent || '点击生产页面', x: event.clientX, y: event.clientY });
          }, true);
        });
      }, { token: credential.token, initialTarget: target });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      const session: Session = { scope, context, page, cdp, listeners: new Set(), frameSequence: 0, lastFrameAt: 0, touchedAt: Date.now(), executing: false, closed: false, read, credential };
      await page.exposeBinding('agentExecute', ({ frame }, id: unknown) => {
        const pending = session.pending;
        if (frame !== page.mainFrame() || !pending || pending.id !== id || pending.consumed || session.closed) throw new Error('task_action_not_armed');
        pending.consumed = true;
        pending.clicked();
        return pending.result;
      });
      await page.exposeBinding('agentTelemetry', async ({ frame }, action: Record<string, unknown>) => {
        if (frame !== page.mainFrame() || action.kind !== 'click' || !Number.isFinite(action.x) || !Number.isFinite(action.y)) return;
        await this.telemetry?.(scope, { kind: 'click', label: String(action.label || '点击工作页面').slice(0, 200), x: Number(action.x), y: Number(action.y), viewportWidth: 1100, viewportHeight: 700 });
      });
      page.on('close', () => { session.closed = true; if (session.watchTimer) clearInterval(session.watchTimer); if (session.flushTimer) clearTimeout(session.flushTimer); this.sessions.delete(keyFor(scope)); this.broadcast(session, { type: 'status', state: 'closed', message: '浏览器会话已关闭' }); });
      cdp.on('Page.screencastFrame', event => {
        void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
        session.queuedFrame = { image: event.data, capturedAt: new Date().toISOString() };
        if (session.flushTimer) return;
        // Coalesce intermediate frames but always deliver the final frame after
        // a page becomes still. Dropping it would leave the viewer on old content.
        session.flushTimer = setTimeout(() => {
          session.flushTimer = undefined;
          if (session.closed || !session.queuedFrame) return;
          session.lastFrameAt = Date.now();
          session.frame = { type: 'frame', ...session.queuedFrame, sequence: ++session.frameSequence, width: 1100, height: 700, executing: session.executing };
          session.queuedFrame = undefined;
          this.broadcast(session, session.frame);
        }, Math.max(0, 100 - (Date.now() - session.lastFrameAt)));
      });
      await this.refresh(session, target);
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 75, maxWidth: 1100, maxHeight: 700, everyNthFrame: 1 });
      // Initial still is also a real screenshot, never an artifact substituted for a browser frame.
      if (!session.frame) session.frame = { type: 'frame', image: (await page.screenshot({ type: 'jpeg', quality: 75 })).toString('base64'), sequence: ++session.frameSequence, capturedAt: new Date().toISOString(), width: 1100, height: 700, executing: false };
      await this.telemetry?.(scope, { kind: 'navigation', label: `打开业务页面：${target.link.page === 'conversion' ? '客服会话' : target.link.page === 'scheduled' ? '定时任务' : 'AI 智能创作'}`, viewportWidth: 1100, viewportHeight: 700 });
      return session;
    } catch (error) { await context.close(); throw error; }
  }
  private refresh(session: Session, initialTarget?: BrowserProductionTarget) {
    if (session.refresh) return session.refresh;
    session.refresh = (async () => {
      session.credential.touch();
      const target = initialTarget || await session.read();
      const appOrigin = this.options.appOrigin || process.env.AGENT_BROWSER_APP_ORIGIN || `http://127.0.0.1:${process.env.PORT || 8790}`;
      const url = new URL('/', appOrigin);
      url.searchParams.set('page', target.link.page);
      url.searchParams.set('agentSession', '1');
      if (target.link.view) url.searchParams.set('view', target.link.view);
      if (target.projectId) url.searchParams.set('project', target.projectId);
      if (target.customerId) url.searchParams.set('customer', target.customerId);
      if (target.stage) url.searchParams.set('stage', target.stage);
      const navigationKey = [target.link.page, target.link.view, target.projectId, target.customerId].join(':');
      const key = JSON.stringify(target);
      if (session.navigationKey !== navigationKey) {
        await session.page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        session.navigationKey = navigationKey;
      } else if (session.workspaceKey !== key) {
        await session.page.evaluate(target => {
          (window as any).__agentProductionTarget = target;
          window.dispatchEvent(new CustomEvent('lingshu:agent-business-refresh'));
        }, target);
      }
      session.workspaceKey = key;
    })().finally(() => { session.refresh = undefined; });
    return session.refresh;
  }

  async watch(scope: BrowserScope, read: Session['read'], listener: Listener): Promise<() => void> {
    const session = await this.ensure(scope, read);
    session.listeners.add(listener);
    listener({ type: 'status', state: session.executing ? 'executing' : 'ready', message: session.executing ? '浏览器正在执行任务' : '已连接任务浏览器' });
    if (session.frame) listener(session.frame);
    session.watchTimer ??= setInterval(() => { session.touchedAt = Date.now(); if (!session.executing) void this.refresh(session).catch(() => this.broadcast(session, { type: 'status', state: 'error', message: '任务工作页面暂时无法更新' })); }, 5_000);
    return () => { session.listeners.delete(listener); if (!session.listeners.size) { clearInterval(session.watchTimer); session.watchTimer = undefined; } session.touchedAt = Date.now(); };
  }
  async perform<T>(scope: BrowserScope, read: Session['read'], label: string, execute: () => Promise<T>): Promise<T> {
    const session = await this.ensure(scope, read);
    if (session.pending || session.executing) throw new Error('该任务浏览器已有步骤执行中');
    session.executing = true;
    let clicked!: () => void, finish!: (result: unknown) => void;
    const clickSignal = new Promise<void>(resolve => { clicked = resolve; });
    const result = new Promise<unknown>(resolve => { finish = resolve; });
    const pending: PendingAction = { id: randomUUID(), consumed: false, clicked, finish, result };
    session.pending = pending;
    this.broadcast(session, { type: 'status', state: 'executing', message: label });
    try {
      await this.refresh(session);
      const target = await session.read();
      const surface = target.link.page === 'conversion' ? 'customer' : target.link.page === 'scheduled' ? 'scheduler' : 'studio';
      await session.page.evaluate(action => {
        (window as any).__agentProductionAction = action;
        window.dispatchEvent(new CustomEvent('lingshu:agent-action'));
      }, { id: pending.id, label, surface });
      const button = session.page.locator(`[data-agent-action="${surface}-primary"]`).filter({ visible: true }).first();
      await button.waitFor({ state: 'visible', timeout: 30_000 });
      await session.page.waitForFunction(selector => { const button = document.querySelector(selector) as HTMLButtonElement | null; return button && !button.disabled; }, `[data-agent-action="${surface}-primary"]`, { timeout: 30_000 });
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      if (!box) throw new Error('任务执行按钮不可见');
      // Actual browser input. Locator.click performs trusted mouse input with
      // actionability checks; it rechecks layout after asynchronous page loads.
      await session.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
      await button.click({ timeout: 30_000 });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([clickSignal, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('浏览器点击未触发任务，已停止执行')), 10_000); })]); }
      finally { if (timeout) clearTimeout(timeout); }
      // This continuation retains the caller's run lock. The browser binding
      // only releases the click gate, so it cannot escape/reacquire that lock.
      const value = await execute();
      try {
        pending.finish({});
        await this.refresh(session);
        await session.page.evaluate(() => { (window as any).__agentProductionAction = undefined; window.dispatchEvent(new CustomEvent('lingshu:agent-action')); });
        this.broadcast(session, { type: 'status', state: 'ready', message: '本次步骤已完成' });
      } catch {
        pending.finish({});
        // A broken viewer must not turn a successful operation into a retry.
        this.broadcast(session, { type: 'status', state: 'error', message: '任务步骤已执行，工作画面更新失败，请重连查看' });
      }
      return value;
    } catch (error) {
      const message = error instanceof Error ? error.message : '浏览器任务执行失败';
      pending.finish({ error: message });
      this.broadcast(session, { type: 'status', state: 'error', message });
      throw error;
    } finally {
      session.pending = undefined; session.executing = false; session.touchedAt = Date.now();
    }
  }
  private async sweep() {
    for (const promise of this.sessions.values()) {
      const session = await promise.catch(() => null);
      if (session && !session.executing && !session.listeners.size && Date.now() - session.touchedAt > 120_000) await session.context.close();
    }
  }
  async close() {
    clearInterval(this.housekeeping);
    for (const promise of this.sessions.values()) { const session = await promise.catch(() => null); if (session) await session.context.close(); }
    this.sessions.clear();
    const browser = await this.browser?.catch(() => null); await browser?.close(); this.browser = undefined;
  }
}

export const agentBrowserSessions = new AgentBrowserSessions();
