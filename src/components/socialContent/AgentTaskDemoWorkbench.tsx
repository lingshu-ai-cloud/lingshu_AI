import { Film, Mic2, Music2, PlayCircle } from 'lucide-react';
import ReplicationWorkbenchHeader from './ReplicationWorkbenchHeader';

export type AgentTaskDemoShot = {
  id: string;
  title: string;
  time: string;
  narration: string;
  visual: string;
  mediaUrl?: string;
};

export default function AgentTaskDemoWorkbench({
  activeStep,
  title,
  shots,
  referenceVideoUrl,
  audioUrl,
  outputVideoUrl,
  onStepChange,
  onTitleChange,
  onTitleCommit,
  titleStatus = 'idle',
  onEdit,
}: {
  activeStep: number;
  title: string;
  shots: AgentTaskDemoShot[];
  referenceVideoUrl?: string;
  audioUrl?: string;
  outputVideoUrl?: string;
  onStepChange: (step: number) => void;
  onTitleChange?: (title: string) => void;
  onTitleCommit?: () => void;
  titleStatus?: 'idle' | 'saving' | 'saved' | 'error';
  onEdit: () => void;
}) {
  const visibleStep = Math.max(0, Math.min(activeStep, 2));
  const sourceVideo = outputVideoUrl || referenceVideoUrl;
  const stageLabels = ['口播确认', '分镜制作', '成片交付'] as const;
  return <div className="flex h-full min-h-0 flex-col bg-slate-50" data-testid="agent-task-demo-workbench">
    <ReplicationWorkbenchHeader
      activeStep={visibleStep}
      title={title}
      onStepChange={onStepChange}
      editableTitle={Boolean(onTitleChange)}
      onTitleChange={onTitleChange}
      onTitleCommit={onTitleCommit}
      titleStatus={titleStatus}
      actions={<div className="flex items-center gap-2">
        <label className="text-xs font-semibold text-text-secondary" htmlFor="agent-task-view-mode">查看方式</label>
        <select id="agent-task-view-mode" aria-label="任务查看模式" value="demo" onChange={event => { if (event.target.value === 'edit') onEdit(); }} className="h-9 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-800">
          <option value="demo">演示模式</option>
          <option value="edit">编辑模式</option>
        </select>
      </div>}
    />
    <div className="border-b border-blue-100 bg-blue-50 px-5 py-2 text-xs text-blue-800">
      演示模式会读取这条 Agent 任务已经生成的真实口播、分镜、音频与成片；除草稿名称外，不会修改生产数据。
    </div>

    {visibleStep === 0 && <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)_minmax(260px,0.7fr)]">
      <section className="min-h-0 overflow-y-auto border-r border-border bg-white p-4">
        <div className="mb-3 flex items-center gap-2"><Mic2 size={16} className="text-emerald-700"/><h2 className="font-semibold">有效口播 · {shots.length} 段</h2></div>
        <div className="space-y-2">{shots.map((shot, index) => <article key={shot.id} className="rounded-xl border border-border p-3">
          <div className="flex items-center justify-between text-[11px] text-text-muted"><span>口播 {index + 1}</span><span>{shot.time}</span></div>
          <p className="mt-2 text-sm leading-6 text-text-primary">{shot.narration || '该分镜无口播'}</p>
        </article>)}</div>
      </section>
      <section className="min-h-0 bg-slate-950 p-4 text-white">
        <div className="mb-3 flex items-center gap-2 text-xs font-bold"><PlayCircle size={16}/>对标视频与画面</div>
        {referenceVideoUrl ? <video src={referenceVideoUrl} controls playsInline className="max-h-[68vh] w-full rounded-xl object-contain"/> : <p className="rounded-xl border border-white/20 p-4 text-xs text-slate-300">该任务暂未保存可播放的对标视频。</p>}
      </section>
      <aside className="min-h-0 overflow-y-auto bg-white p-4">
        <div className="mb-3 flex items-center gap-2"><Music2 size={16} className="text-emerald-700"/><h2 className="font-semibold">有效音频</h2></div>
        {audioUrl ? <audio src={audioUrl} controls preload="metadata" className="w-full"/> : <p className="rounded-xl border border-dashed border-border p-3 text-xs text-text-muted">尚无独立配音文件，可在编辑模式生成配音。</p>}
        <button type="button" onClick={onEdit} className="mt-5 w-full rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white">切换到编辑模式</button>
      </aside>
    </div>}

    {visibleStep === 1 && <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mb-4 flex items-center gap-2"><Film size={17} className="text-emerald-700"/><h2 className="font-semibold">有效分镜 · {shots.length} 镜</h2></div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{shots.map((shot, index) => <article key={shot.id} className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <div className="aspect-video bg-slate-950">{shot.mediaUrl ? <video src={shot.mediaUrl} muted playsInline preload="metadata" className="h-full w-full object-contain"/> : referenceVideoUrl ? <video src={referenceVideoUrl} muted playsInline preload="metadata" className="h-full w-full object-cover"/> : <div className="flex h-full items-center justify-center text-xs text-slate-400">暂无镜头预览</div>}</div>
        <div className="p-3"><div className="flex justify-between text-xs font-bold"><span>分镜 {index + 1} · {shot.title}</span><span className="text-text-muted">{shot.time}</span></div><p className="mt-2 line-clamp-3 text-xs leading-5 text-text-secondary">{shot.visual}</p></div>
      </article>)}</div>
    </div>}

    {visibleStep === 2 && <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="flex min-h-0 items-center justify-center rounded-xl bg-slate-950 p-4">{sourceVideo ? <video src={sourceVideo} controls playsInline className="max-h-full max-w-full rounded-lg"/> : <p className="text-sm text-slate-300">任务已有生产记录，但当前没有可播放的成片文件。</p>}</section>
      <aside className="rounded-xl border border-border bg-white p-5"><h2 className="font-semibold">交付版本</h2><p className="mt-3 text-xs leading-6 text-text-secondary">当前展示 Agent 已生成的版本。进入编辑模式修改后，使用“确认修改并生成新版本”保留原版本并创建新的交付成片。</p>{audioUrl && <audio src={audioUrl} controls preload="metadata" className="mt-5 w-full"/>}<button type="button" onClick={onEdit} className="mt-5 w-full rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white">切换到编辑模式</button></aside>
    </div>}
    <footer className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-t border-border bg-white px-5 py-2.5">
      <p className="text-xs font-medium text-text-secondary" aria-live="polite">当前：{stageLabels[visibleStep]}</p>
      <div className="flex items-center gap-2">
        <button type="button" disabled={visibleStep === 0} onClick={() => onStepChange(visibleStep - 1)} className="min-h-11 rounded-lg border border-border bg-white px-4 text-xs font-semibold text-text-secondary disabled:cursor-not-allowed disabled:opacity-40">上一步</button>
        <button type="button" disabled={visibleStep === 2} onClick={() => onStepChange(visibleStep + 1)} className="min-h-11 rounded-lg bg-accent px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300">下一步</button>
      </div>
    </footer>
  </div>;
}
