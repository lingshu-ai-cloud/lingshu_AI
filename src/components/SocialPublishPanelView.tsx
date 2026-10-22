import { lazy } from 'react';
import { Alert, Button, Checkbox, Drawer, Input, Modal, Segmented, Tabs } from 'antd';
import { AlertCircle, ChevronLeft, CheckCircle2, Film, Loader2, Copy, PlayCircle, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { LsPageHeader } from './ui/LsPageHeader';
import { SocialPlatformIcon } from './SocialPlatformIcon';
import ContentLibrary from './ContentLibrary';
import type { useSocialPublishPanelController } from './TrafficPage';
import { PLATFORM_META } from './publishing/publishPlatformMeta';
import { PUBLISH_STATUS_META, dateTimeLocalValue, readStoredPublishDraft, titleFromVideoPath, type DeliveryMode, type PublishPlatform } from '../lib/publishQueueState';

const CalendarPlanner = lazy(() => import('./publishing/CalendarPlanner').then(module => ({ default: module.CalendarPlanner })));

export default function SocialPublishPanelView({ controller }: { controller: ReturnType<typeof useSocialPublishPanelController> }) {
  const {
    draft, onReturnToPreview, storageScope, videoInputRef, publishSettingsRef, connectedAccounts, activeItem,
    activePreviewUrl, activeCalendarPost, pendingCalendarItems, selectedTargetAccountIds, selectedConnectedAccounts, selectedPlatforms, visiblePlatforms,
    connectedAccountIds, totalAssignments, publishableItems, immediateItems, scheduledItems, flexibleItems, publishableAssignments,
    updateItem, selectedQueueItems, allQueueItemsSelected, toggleAllQueueItems, setDeliveryMode, scheduleForCalendarDate, openPendingContent,
    saveCurrentContent, schedulePendingContent, openCalendarPost, toggleAccount, togglePlatform, selectAllAccounts, applyContentToAll,
    duplicatePublishItem, removePublishItem, addSelectedVideoFiles, addSystemFinishedVideo, requestPublishConfirmation, publishConfirmed, previewRatio,
    setWorkspaceTab, setActiveItemId, setPublishConfirmationOpen, setSystemLibraryOpen, workspaceTab, accounts, items,
    loading, uploadingVideos, savingContent, publishing, publishConfirmationOpen, systemLibraryOpen, notice,
    error, calendarRefreshKey,
  } = controller;
  return (
    <div className="px-4 pb-5 pt-3 sm:px-6">
      <div className="mx-auto max-w-[1600px] space-y-4">
        <LsPageHeader title="内容发布" description="安排发布时间，确认平台账号，并跟进真实发布回执。"/>
        <Tabs aria-label="发布工作区" activeKey={workspaceTab} onChange={value => setWorkspaceTab(value as 'schedule' | 'publish')} items={[{ key: 'schedule', label: '内容日历' }, { key: 'publish', label: '新建发布' }]}/>

        {workspaceTab === 'schedule' ? (
        <section id="publishing-calendar" className="scroll-mt-5">
          <CalendarPlanner
            refreshKey={calendarRefreshKey}
            onCreate={scheduleForCalendarDate}
            onOpenPost={openCalendarPost}
            pendingItems={pendingCalendarItems}
            onOpenPending={openPendingContent}
            onSchedulePending={schedulePendingContent}
          />
        </section>
        ) : (
        <>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="space-y-4">
        <section data-lingshu-guide="publishing-workbench" className="rounded-lg border border-border bg-white p-4">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-text-primary">发布队列</h3>
                <p className="mt-1 text-xs text-text-muted">所有产出版本 {items.length} 条 · 已选 {selectedQueueItems.length} 条 · {totalAssignments} 个发布目标</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo"
                  multiple
                  className="hidden"
                  onChange={event => void addSelectedVideoFiles(event.target.files)}
                />
                <Button onClick={() => videoInputRef.current?.click()} loading={uploadingVideos} icon={<Upload size={14}/>}>上传视频</Button>
                <Button onClick={() => setSystemLibraryOpen(true)} icon={<Film size={14}/>}>选择系统成片</Button>
                <button
                  type="button"
                  onClick={applyContentToAll}
                  disabled={!activeItem || items.every(item => item.id === activeItem.id || ['publishing', 'provider_processing', 'scheduled', 'published'].includes(item.status))}
                  title="复制当前视频的标题、发布配文、分平台文案、首评和询盘追踪设置；不会覆盖视频文件、平台账号和发布时间"
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-accent/30 bg-accent-glow px-3 text-xs font-bold text-accent hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Copy size={13} /> 应用到全部视频
                </button>
                <button type="button" onClick={toggleAllQueueItems} className="inline-flex h-9 w-24 items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-xs font-bold text-emerald-700">
                  <CheckCircle2 size={13} />
                  {allQueueItemsSelected ? '取消全选' : '全选'}
                </button>
              </div>
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {items.map((item, index) => {
                const active = item.id === activeItem?.id;
                const status = PUBLISH_STATUS_META[item.status];
                const hasVideo = Boolean(item.videoPath.trim());
                const targetCount = item.targetAccountIds.filter(id => connectedAccountIds.has(id)).length;
                return (
                  <div key={item.id} className={`flex min-w-0 items-center gap-2 rounded-xl border p-2 transition-colors ${active ? 'border-accent bg-accent-glow' : 'border-border bg-surface'}`}>
                    <input
                      type="checkbox"
                      checked={item.selected}
                      onChange={event => updateItem(item.id, { selected: event.target.checked })}
                      disabled={!hasVideo}
                      aria-label={`选择素材 ${item.title || index + 1}`}
                      className="h-4 w-4 flex-shrink-0 rounded border-border text-emerald-600"
                    />
                    <button type="button" onClick={() => setActiveItemId(item.id)} className="min-w-0 flex-1 px-1.5 py-1 text-left">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-text-muted">{String(index + 1).padStart(2, '0')}</span>
                        <span className="min-w-0 flex-1 truncate text-sm font-bold text-text-primary">{item.title || titleFromVideoPath(item.videoPath) || '待填写视频'}</span>
                        <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${hasVideo ? status.className : 'bg-amber-50 text-amber-700'}`}>{hasVideo ? status.label : '未生成成片'}</span>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-text-muted">
                        {item.videoPath || '请返回内容创作生成该版本成片'} · {targetCount} 个账号 · {item.deliveryMode === 'now' ? '立即发布' : item.deliveryMode === 'flexible' ? '时间待定' : item.scheduledAt ? `定点 ${new Date(item.scheduledAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '待选定点时间'}
                      </p>
                      {item.error && <p className="mt-1 truncate text-[11px] font-semibold text-red-600" title={item.error}>{item.error}</p>}
                    </button>
                    <div className="flex flex-shrink-0 items-center gap-1">
                      <button type="button" onClick={() => duplicatePublishItem(item)} className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-white hover:text-text-primary" title="复制配置"><Copy size={12} /></button>
                      <button type="button" onClick={() => removePublishItem(item.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-red-50 hover:text-red-600" title="删除视频"><Trash2 size={12} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </section>

        <section data-lingshu-guide="publish-accounts" className="rounded-2xl border border-border bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-text-primary">平台账号选择</h3>
                <p className="mt-1 text-xs text-text-muted">当前视频已选择 {selectedConnectedAccounts.length} 个账号，覆盖 {selectedPlatforms.length} 个平台</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(PLATFORM_META).map(([platform, meta]) => {
                  const platformAccounts = connectedAccounts.filter(account => account.platform === platform);
                  const selected = platformAccounts.length > 0 && platformAccounts.every(account => selectedTargetAccountIds.includes(account.id));
                  return (
                    <button key={platform} type="button" disabled={!platformAccounts.length} onClick={() => togglePlatform(platform as PublishPlatform)} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold disabled:opacity-40 ${selected ? 'border-accent bg-accent-glow text-accent' : 'border-border text-text-secondary'}`}>
                      <SocialPlatformIcon platform={platform} size={15} /> {platformAccounts.length}
                    </button>
                  );
                })}
                <button type="button" onClick={selectAllAccounts} className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold text-text-secondary">全选</button>
              </div>
            </div>

          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {loading ? (
              <div className="col-span-full flex items-center justify-center gap-2 rounded-xl border border-border bg-surface py-10 text-sm text-text-muted">
                <Loader2 size={16} className="animate-spin" /> 正在读取已授权账号...
              </div>
            ) : accounts.length === 0 ? (
              <div className="col-span-full rounded-xl border border-dashed border-border bg-surface px-4 py-8 text-center">
                <p className="text-sm font-bold text-text-primary">还没有已连接账号</p>
                <p className="mt-1 text-xs text-text-muted">请先进入集成中心完成 YouTube / TikTok / Instagram / Facebook 授权。</p>
              </div>
            ) : accounts.map(account => {
              const meta = PLATFORM_META[account.platform];
              const directPostUnavailable = account.platform === 'tiktok';
              const active = !directPostUnavailable && selectedTargetAccountIds.includes(account.id);
              return (
                <button key={account.id} type="button" onClick={() => toggleAccount(account.id)} disabled={account.status !== 'connected' || directPostUnavailable} className={`rounded-xl border p-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-55 ${active ? 'border-accent bg-accent-glow shadow-sm' : 'border-border bg-surface hover:border-border-bright'}`}>
                  <div className="flex items-center justify-between gap-3">
                    {account.avatarUrl ? (
                      <img src={account.avatarUrl} alt={account.title} className="h-10 w-10 shrink-0 rounded-xl object-cover" />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: meta.color }}>
                        <SocialPlatformIcon platform={account.platform} size={20} />
                      </span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${account.status === 'connected' && !directPostUnavailable ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-text-muted'}`}>
                      {directPostUnavailable ? '直发审核中' : account.status === 'connected' ? '已连接' : '需重新授权'}
                    </span>
                  </div>
                  <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-bold text-text-primary"><SocialPlatformIcon platform={account.platform} size={16} /> {meta.label}</p>
                  <p className="mt-1 truncate text-xs font-semibold text-text-secondary">{account.handle || account.title}</p>
                  <p className="mt-2 text-xs text-text-muted">{meta.format}</p>
                </button>
              );
            })}
          </div>
        </section>

            <section id="publishing-content-editor" className="scroll-mt-24 rounded-2xl border border-border bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-text-primary">发布内容编辑</h3>
                  <p className="mt-1 text-xs text-text-muted">一份文案和 Tag 作为所有平台的发布原稿；平台只处理账号、媒体格式和发布时间。</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {visiblePlatforms.map(platform => <span key={platform} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[10px] font-semibold text-text-secondary"><SocialPlatformIcon platform={platform} size={12}/>{PLATFORM_META[platform].label}</span>)}
                </div>
              </div>
              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">素材文件</span>
                  <Input value={activeItem?.videoPath || ''} onChange={event => activeItem && updateItem(activeItem.id, { videoPath: event.target.value, status: 'draft', error: undefined })} placeholder="已上传或生成的视频文件" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">作品标题</span>
                  <Input value={activeItem?.title || ''} onChange={event => activeItem && updateItem(activeItem.id, { title: event.target.value, status: 'draft', error: undefined })} placeholder="发布标题" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">统一发布文案 + Tag</span>
                  <Input.TextArea value={activeItem?.description || ''} onChange={event => activeItem && updateItem(activeItem.id, { description: event.target.value, status: 'draft', error: undefined })} rows={5} placeholder="输入最终发布文案，并在末尾保留同一组 #Tag；所有平台原样使用" />
                  <span className="mt-1.5 block text-[11px] text-text-muted">只在内容计划中替换商品名、品牌名、企业名等已绑定事实；认证、价格、交期和功效不能自动替换。</span>
                </label>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/80 p-3">
                  <label className="flex cursor-pointer items-start gap-3">
                    <Checkbox aria-label="附带 WhatsApp 询盘链接" checked={activeItem?.trackWaLink ?? true} onChange={event => activeItem && updateItem(activeItem.id, { trackWaLink: event.target.checked, status: 'draft' })} className="mt-1" />
                    <span>
                      <span className="flex items-center gap-1.5 text-xs font-black text-emerald-900"><SocialPlatformIcon platform="whatsapp" size={15} /> 已附带 WhatsApp 询盘链接</span>
                      <span className="mt-1 block text-[11px] leading-5 text-emerald-800">发布时自动生成短追踪码。买家首条消息带码后，客户来源会精确归因到这条内容。</span>
                    </span>
                  </label>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                  <p className="text-[11px] text-text-muted">
                    {activeCalendarPost
                      ? '保存只更新内容，日历中的发布时间和锁定状态保持不变。'
                      : '保存后进入待发布内容；立即发布、时间待定和定点排期互不混用。'}
                  </p>
                  <Button
                    type="primary"
                    onClick={() => void saveCurrentContent()}
                    disabled={savingContent || !activeItem || activeItem.status === 'publishing' || activeItem.status === 'provider_processing' || activeItem.status === 'scheduled' || activeItem.status === 'published'}
                    loading={savingContent}
                    icon={<CheckCircle2 size={14}/>}
                  >
                    {savingContent
                      ? '正在保存...'
                      : activeCalendarPost
                        ? activeItem?.status === 'ready' ? '日历修改已保存' : '保存日历修改'
                      : activeItem?.status === 'ready' ? '已保存到待发布内容' : '保存并加入待发布内容'}
                  </Button>
                  {error && <p role="status" className="w-full text-right text-[11px] font-semibold text-red-600">{error}</p>}
                </div>
              </div>
            </section>
          </section>

          <aside ref={publishSettingsRef} className="scroll-mt-24 rounded-2xl border border-border bg-white p-4 shadow-sm xl:sticky xl:top-4 xl:max-h-[calc(100dvh-7rem)] xl:overflow-y-auto">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-text-primary">发布设置</h3>
              <button
                type="button"
                onClick={() => onReturnToPreview?.(activeItem?.sourceProjectId || draft?.sourceProjectId || readStoredPublishDraft(storageScope)?.sourceProjectId)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold text-text-secondary hover:border-accent hover:text-accent"
              >
                <ChevronLeft size={12} /> 返回成片预览
              </button>
            </div>
            <div data-lingshu-guide="publish-mode" className="mt-4 rounded-2xl border border-border bg-surface p-3">
              <p className="text-[11px] font-bold text-text-secondary">当前视频的发布方式</p>
              <Segmented className="mt-2" block aria-label="发布方式" value={activeItem?.deliveryMode || 'flexible'} disabled={activeCalendarPost} onChange={value => setDeliveryMode(value as DeliveryMode)} options={[{ value: 'now', label: '立即发布' }, { value: 'flexible', label: '时间待定' }, { value: 'schedule', label: '定点排期' }]}/>
              {activeItem?.deliveryMode === 'schedule' && (
                <label className="mt-3 block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">计划发布时间</span>
                  <input
                    type="datetime-local"
                    min={dateTimeLocalValue(new Date(Date.now() + 5 * 60_000))}
                    value={activeItem.scheduledAt}
                    disabled={activeCalendarPost}
                    onChange={event => updateItem(activeItem.id, { scheduledAt: event.target.value, status: 'draft', error: undefined })}
                    className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-xs outline-none focus:border-violet-400 disabled:cursor-not-allowed disabled:bg-slate-100"
                  />
                </label>
              )}
              <p className="mt-2 text-[10px] leading-4 text-text-muted">
                {activeCalendarPost
                  ? activeItem?.deliveryMode === 'schedule'
                    ? '这条内容使用定点排期，拖动不会改变锁定时间。'
                    : '这条内容已选好时间；可在日历拖到其他日期，时分保持不变。'
                  : activeItem?.deliveryMode === 'now'
                    ? '确认发布后立即提交平台，不进入日历。'
                    : activeItem?.deliveryMode === 'flexible'
                      ? '先保存到待发布内容，拖入日历时再选择具体时间。'
                      : '保存完整日期和时间，拖入日历后按这个唯一时间执行。'}
              </p>
            </div>
            <div id="publishing-video-preview" className="mt-4 scroll-mt-24 rounded-2xl border border-border bg-surface p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-text-primary">发布预览</span>
                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-accent shadow-sm">{previewRatio}</span>
              </div>
              <div className="flex justify-center">
                <div className="relative w-full overflow-hidden rounded-xl border border-border bg-black shadow-inner" style={{ aspectRatio: previewRatio === '16:9' ? '16 / 9' : '9 / 16', maxWidth: previewRatio === '16:9' ? 260 : 150 }}>
                  {activePreviewUrl ? (
                    <video
                      key={activePreviewUrl}
                      src={activePreviewUrl}
                      controls
                      playsInline
                      preload="metadata"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 text-white/70">
                      <PlayCircle size={22} />
                      <span className="mt-2 text-[10px] font-bold">上传视频后自动预览</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <label className="mt-4 block">
              <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">首条评论</span>
              <textarea value={activeItem?.firstComment || ''} onChange={event => activeItem && updateItem(activeItem.id, { firstComment: event.target.value, status: 'draft' })} rows={3} placeholder="hashtags、wa.me 链接或补充说明。平台不支持时会记录 warning。" className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2.5 text-xs outline-none focus:border-accent" />
            </label>

            <div className="mt-5 rounded-xl border border-green-100 bg-green-50 p-3">
              <div className="flex items-center gap-2 text-xs font-bold text-green-700">
                <ShieldCheck size={14} />
                发布前检查
              </div>
              <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-green-800">
                <li>队列：{items.length} 条视频，{immediateItems.length} 条立即发布，{flexibleItems.length} 条时间待定，{scheduledItems.length} 条定点排期</li>
                <li>目标：{totalAssignments} 个账号任务，覆盖 {new Set(items.flatMap(item => connectedAccounts.filter(account => item.targetAccountIds.includes(account.id)).map(account => account.platform))).size} 个平台</li>
                <li>当前视频追踪链接：{activeItem?.trackWaLink ? '开启' : '关闭'}</li>
              </ul>
            </div>
            {accounts.some(account => account.platform === 'tiktok' && account.status === 'connected') && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] leading-5 text-amber-800">
                TikTok Direct Post 正式审核尚未完成，当前账号不会作为直发目标；请先生成和核对内容，待平台批准且完整发布设置上线后再由用户主动提交。
              </div>
            )}

            {notice && <div className="mt-4 flex items-start gap-2 rounded-xl border border-green-100 bg-green-50 px-3 py-2 text-xs text-green-700"><CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" /><span>{notice}</span></div>}
            {error && <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600"><AlertCircle size={14} className="mt-0.5 flex-shrink-0" /><span>{error}</span></div>}

            <Button type="primary" block onClick={requestPublishConfirmation} disabled={loading || publishableItems.length === 0} loading={publishing} icon={<CheckCircle2 size={16}/>} className="mt-5" style={{ height: 'auto', minHeight: 40, whiteSpace: 'normal' }}>
              {publishing
                ? '正在提交已确认的发布任务...'
                  : `发布已确定时间的内容 · ${publishableItems.length} 条 / ${publishableAssignments} 个账号目标`}
            </Button>
          </aside>
        </div>
        <Modal title="确认发布这些内容？" open={publishConfirmationOpen} onCancel={() => setPublishConfirmationOpen(false)} onOk={() => void publishConfirmed()} confirmLoading={publishing} okText="确认真实发布" cancelText="返回检查" mask={{ closable: !publishing }} closable={!publishing} destroyOnHidden>
          <p className="text-sm leading-6 text-text-secondary">立即发布会直接调用已授权平台账号；定点排期会在锁定时间自动提交。时间待定内容需要先在日历选择时间。</p>
          <dl className="my-4 grid grid-cols-2 divide-x divide-border border-y border-border py-4"><div><dt className="text-xs text-text-secondary">立即真实发布</dt><dd className="mt-1 text-xl font-semibold">{immediateItems.length} 条</dd></div><div className="pl-4"><dt className="text-xs text-text-secondary">已确认定时提交</dt><dd className="mt-1 text-xl font-semibold">{scheduledItems.length} 条</dd></div></dl>
          <Alert type="info" showIcon title={`共 ${publishableAssignments} 个账号目标`} description="失败项会保留在队列中，可修改后重试；平台受理不等同于已公开发布。"/>
        </Modal>
        <Drawer title="选择系统生成成片" open={systemLibraryOpen} onClose={() => setSystemLibraryOpen(false)} size="large" destroyOnHidden styles={{ body: { padding: 0 } }}>
          <ContentLibrary onPublish={addSystemFinishedVideo} />
        </Drawer>
        </>
        )}
      </div>
    </div>
  );
}
