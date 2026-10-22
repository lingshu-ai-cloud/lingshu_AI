import { Drawer } from 'antd';
import { Download, Loader, X } from 'lucide-react';
import { suggestedActions, type NextAction } from './scheduledTaskActions';
import type { TaskTemplate } from './scheduledTaskTemplates';
import type { taskWorkspace } from './scheduledTaskWorkspaces';
import type { ScheduledTask } from './ScheduledPage';

interface Notice { taskId: string; message: string; error: boolean }

interface Props {
  resultTask: ScheduledTask | null;
  resultWorkspace: ReturnType<typeof taskWorkspace> | null;
  resultTemplate: TaskTemplate | null;
  resultText: string;
  workspaceMessage: string;
  setWorkspaceMessage: (message: string) => void;
  exportingId: string | null;
  exportNotice: Notice | null;
  runNotice: Notice | null;
  closeResultPanel: () => void;
  formatTime: (value?: string) => string;
  exportPdf: (task: ScheduledTask) => Promise<void>;
  goToAgent: (action: NextAction) => void;
}

export default function ScheduledTaskResultDrawer({ resultTask, resultWorkspace, resultTemplate, resultText, workspaceMessage, setWorkspaceMessage, exportingId, exportNotice, runNotice, closeResultPanel, formatTime, exportPdf, goToAgent }: Props) {
  if (!resultTask) return null;
  return (
  <Drawer open title={resultWorkspace?.title ?? resultTask.name} onClose={closeResultPanel} size={640} styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}>
      <div className="px-5 py-4 border-b border-gray-100 flex items-start gap-3">
        <div className="text-3xl w-11 h-11 rounded-xl bg-gray-50 flex items-center justify-center flex-shrink-0">
          {resultTemplate?.icon ?? '⚙️'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 id="scheduled-result-dialog-title" className="text-sm font-semibold text-gray-900 truncate">{resultWorkspace?.title ?? resultTask.name}</h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 font-medium">任务页面</span>
          </div>
          <p className="text-xs text-gray-700 mt-1 truncate">{resultTask.name}</p>
          <p className="text-xs text-gray-500 mt-1">
            {resultTask.cronLabel} · 上次执行 {formatTime(resultTask.lastRun)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void exportPdf(resultTask); }}
          disabled={exportingId === resultTask.id || !resultTask.lastRun || !resultTask.lastResult}
          title={!resultTask.lastRun || !resultTask.lastResult ? '任务执行完成后可导出 PDF' : '导出任务报告'}
          className="h-8 px-3 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5"
        >
          {exportingId === resultTask.id ? <Loader size={12} className="animate-spin" /> : <Download size={12} />}
          导出 PDF
        </button>
        <button type="button" data-modal-initial-focus aria-label="关闭任务详情" onClick={closeResultPanel} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
          <X size={16} />
        </button>
      </div>

      {exportNotice?.taskId === resultTask.id && (
        <div role="status" aria-live="polite" className={`mx-5 mt-3 rounded-lg border px-3 py-2 text-xs font-medium ${exportNotice.error ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'}`}>
          {exportNotice.message}
        </div>
      )}
      {runNotice?.taskId === resultTask.id && (
        <div role="status" aria-live="assertive" className={`mx-5 mt-3 rounded-lg border px-3 py-2 text-xs font-medium ${runNotice.error ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'}`}>
          {runNotice.message}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {resultWorkspace && (
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs font-semibold text-gray-800 mb-3">交互页面</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {resultWorkspace.cards.map(card => (
                <div key={card.label} className="min-h-[98px] rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5">
                  <p className="text-[11px] text-gray-400">{card.label}</p>
                  <p className="text-sm font-semibold text-gray-900 mt-1 break-words">{card.value}</p>
                  <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{card.desc}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {resultWorkspace.actions.map(action => (
                <button
                  key={action}
                  type="button"
                  onClick={() => setWorkspaceMessage(`${action}已准备，可结合任务产出继续处理。`)}
                  className="h-9 rounded-lg border border-gray-200 text-[11px] text-gray-600 hover:bg-gray-50 px-2"
                >
                  {action}
                </button>
              ))}
            </div>
            {workspaceMessage && (
              <div className="mt-3 rounded-lg bg-green-50 border border-green-100 px-3 py-2 text-xs text-green-800 leading-relaxed">
                {workspaceMessage}
              </div>
            )}
          </section>
        )}

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold text-gray-800 mb-3">建议下一步</p>
          <div className="space-y-2">
            {suggestedActions(resultTask, resultText).map((action, index) => (
              <div key={action.label} className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
                <span className="w-5 h-5 rounded-full bg-green-50 text-green-700 text-[10px] font-semibold flex items-center justify-center flex-shrink-0">{index + 1}</span>
                <p className="text-xs text-gray-600 leading-relaxed flex-1">{action.label}</p>
                <button
                  type="button"
                  data-demo-target={index === 0 ? 'automation_workflow_agent' : undefined}
                  onClick={() => goToAgent(action)}
                  className="h-7 px-2.5 rounded-lg bg-white border border-gray-200 text-[11px] text-gray-600 hover:border-green-200 hover:text-green-700 hover:bg-green-50 flex-shrink-0"
                >
                  去{action.agentLabel}
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold text-gray-800 mb-3">任务信息</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-gray-50 px-3 py-2">
              <p className="text-gray-400">类型</p>
              <p className="text-gray-700 font-medium mt-0.5">{resultTemplate?.name ?? resultTask.taskType}</p>
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2">
              <p className="text-gray-400">状态</p>
              <p className="text-gray-700 font-medium mt-0.5">{resultTask.enabled ? '已启用' : '已停用'}</p>
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2">
              <p className="text-gray-400">频率</p>
              <p className="text-gray-700 font-medium mt-0.5">{resultTask.cronLabel}</p>
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2">
              <p className="text-gray-400">创建时间</p>
              <p className="text-gray-700 font-medium mt-0.5">{formatTime(resultTask.createdAt)}</p>
            </div>
          </div>
        </section>
      </div>

      <div className="border-t border-gray-100 p-4 flex justify-end">
        <button type="button" onClick={closeResultPanel} className="px-4 py-2.5 border border-gray-200 rounded-xl text-xs text-gray-600 hover:bg-gray-50">
          关闭
        </button>
      </div>
  </Drawer>
  );
}
