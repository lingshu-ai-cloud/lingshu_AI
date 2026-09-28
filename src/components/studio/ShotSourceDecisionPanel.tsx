import { ChevronDown, Camera, FolderOpen, UserRound } from 'lucide-react';
export default function ShotSourceDecisionPanel({ disabled, shootingBusy, shootingScheduled, error, onDigitalHuman, onMaterials, onShoot }: {
  disabled?: boolean; shootingBusy?: boolean; shootingScheduled?: boolean; error?: string;
  onDigitalHuman: () => void; onMaterials: () => void; onShoot: () => void;
}) {
  return <section aria-label="分镜素材来源" className="space-y-2">
    {[
      { title: '企业数字人', description: '选择企业人物，调整口播、模型与画面效果', icon: UserRound, onClick: onDigitalHuman },
      { title: '企业素材库', description: '选择已有素材，或上传企业视频和图片', icon: FolderOpen, onClick: onMaterials },
      { title: '列入待拍清单', description: shootingScheduled ? '已列入清单，上传后自动回填当前分镜' : '创建当前分镜的拍摄任务，上传后自动回填', icon: Camera, onClick: onShoot },
    ].map(item => <button key={item.title} type="button" disabled={disabled || shootingBusy} onClick={item.onClick} aria-haspopup={item.title === '列入待拍清单' ? undefined : 'dialog'} className="flex w-full items-center gap-3 rounded-xl border border-border bg-white px-3 py-3 text-left transition hover:border-emerald-300 hover:bg-emerald-50/40 disabled:opacity-50">
      <item.icon size={18} className="shrink-0 text-emerald-700" /><span className="min-w-0 flex-1"><span className="block text-xs font-black text-text-primary">{item.title === '列入待拍清单' && shootingBusy ? '正在创建待拍任务…' : item.title}</span><span className="mt-1 block text-[10px] leading-4 text-text-muted">{item.description}</span></span><ChevronDown size={14} className="text-text-muted" />
    </button>)}
    {shootingScheduled && <a href="?page=socialInspiration&view=shooting" className="block text-right text-[10px] font-bold text-emerald-700 underline">打开待拍清单</a>}
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
  </section>;
}
