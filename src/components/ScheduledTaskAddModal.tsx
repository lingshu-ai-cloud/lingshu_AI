import type { Dispatch, SetStateAction } from 'react';
import { Button, Modal } from 'antd';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckCircle, ChevronDown, Clock, Play } from 'lucide-react';
import { discoveryKeywords } from '../../shared/socialDiscoveryKeywords';
import type { SocialCrawlStrategy } from '../../shared/contracts/socialContentWorkflow';
import { normalizeKeywordInput, type KeywordPlatform } from '../lib/keywordInput';
import { SocialPlatformIcon } from './SocialPlatformIcon';
import { scheduleLabel, templateSchedule, WEEKDAYS, type TaskTemplate } from './scheduledTaskTemplates';

interface Props {
  showAdd: boolean;
  closeAddModal: () => void;
  creatingTasks: boolean;
  activeGroupLabel: string;
  groupedTemplates: Array<{ id: string; label: string; desc: string; templates: TaskTemplate[] }>;
  selectedTemplateIds: string[];
  setSelectedTemplateIds: Dispatch<SetStateAction<string[]>>;
  selectedTemplates: TaskTemplate[];
  selectedTemplate: TaskTemplate | null;
  customName: string;
  setCustomName: Dispatch<SetStateAction<string>>;
  discoveryScope: SocialCrawlStrategy | null;
  keywordTemplatesCount: number;
  taskKeywords: string;
  setTaskKeywords: Dispatch<SetStateAction<string>>;
  keywordReviewReady: boolean;
  keywordReviewConfirmed: boolean;
  keywordReviews: Array<{ platform: KeywordPlatform; review: ReturnType<typeof normalizeKeywordInput> }>;
  keywordSignature: string;
  setConfirmedKeywordSignature: Dispatch<SetStateAction<string>>;
  setCreateError: Dispatch<SetStateAction<string>>;
  createError: string;
  scheduleOpen: boolean;
  setScheduleOpen: Dispatch<SetStateAction<boolean>>;
  scheduleTime: string;
  setScheduleTime: Dispatch<SetStateAction<string>>;
  scheduleDays: string[];
  setScheduleDays: Dispatch<SetStateAction<string[]>>;
  runAfterCreate: boolean;
  setRunAfterCreate: Dispatch<SetStateAction<boolean>>;
  createTask: () => Promise<void>;
}

export default function ScheduledTaskAddModal({
  showAdd, closeAddModal, creatingTasks, activeGroupLabel, groupedTemplates,
  selectedTemplateIds, setSelectedTemplateIds, selectedTemplates, selectedTemplate,
  customName, setCustomName, discoveryScope, keywordTemplatesCount, taskKeywords,
  setTaskKeywords, keywordReviewReady, keywordReviewConfirmed, keywordReviews,
  keywordSignature, setConfirmedKeywordSignature, setCreateError, createError,
  scheduleOpen, setScheduleOpen, scheduleTime, setScheduleTime, scheduleDays,
  setScheduleDays, runAfterCreate, setRunAfterCreate, createTask,
}: Props) {
  if (!showAdd) return null;
  return (
  <Modal open title="新建定时任务" width={640} onCancel={closeAddModal} footer={null} mask={{ closable: false }} closable={!creatingTasks} keyboard={!creatingTasks} styles={{ body: { maxHeight: '70dvh', overflowY: 'auto' } }}>
      <p className="mb-4 text-sm text-text-muted">{activeGroupLabel}</p>

      <p className="text-xs text-gray-500 mb-3 font-medium">选择任务模板</p>
      <div className="space-y-5 mb-5">
        {groupedTemplates.map(group => (
          <section key={group.id}>
            <div className="flex items-center justify-between mb-2 px-0.5">
              <div>
                <h4 className="text-xs font-semibold text-gray-800">{group.label}</h4>
                <p className="text-[10px] text-gray-400 mt-0.5">{group.desc}</p>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-gray-100 text-[10px] text-gray-500">{group.templates.length} 个</span>
            </div>
            <div className="space-y-2">
            {group.templates.map(tmpl => (
          <button
            type="button"
            key={tmpl.templateId}
            data-demo-target={showAdd && selectedTemplateIds.length === 0 && tmpl.templateId === 'youtube_video_keyword_crawl' ? 'scheduled_run' : undefined}
            onClick={() => {
              const selected = selectedTemplateIds.includes(tmpl.templateId);
              setSelectedTemplateIds(current => selected
                ? current.filter(id => id !== tmpl.templateId)
                : [...current, tmpl.templateId]);
              if (selectedTemplateIds.length === 0 && !selected) {
                const schedule = templateSchedule(tmpl);
                setScheduleTime(schedule.time);
                setScheduleDays(schedule.days);
                if (tmpl.config && 'keywords' in tmpl.config) setTaskKeywords(String(tmpl.config.keywords || 'foundation'));
                setConfirmedKeywordSignature('');
                setCreateError('');
                setScheduleOpen(false);
              }
              if (selected && selectedTemplateIds.length === 1) setCustomName('');
            }}
            className={`w-full p-3 rounded-xl border-2 text-left flex items-start gap-3 transition-all ${selectedTemplateIds.includes(tmpl.templateId) ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-gray-300'}`}
          >
            <span className="text-2xl">{tmpl.icon}</span>
            <div>
              <div className="text-sm font-medium text-gray-900">{tmpl.name}</div>
              <div className="text-xs text-gray-500 mt-0.5">{tmpl.desc}</div>
              <div className="text-xs text-gray-400 mt-1 flex items-center gap-1"><Clock size={10} /> {tmpl.cronLabel}</div>
            </div>
            {selectedTemplateIds.includes(tmpl.templateId) && <CheckCircle size={16} className="text-green-500 ml-auto mt-0.5 flex-shrink-0" />}
          </button>
            ))}
            </div>
          </section>
        ))}
      </div>

      {selectedTemplates.length > 0 && selectedTemplate && (
        <>
          {selectedTemplates.length === 1 ? <div className="mb-4">
            <label className="block text-xs font-medium text-gray-700 mb-1.5">任务名称</label>
            <input
              value={customName}
              onChange={e => setCustomName(e.target.value)}
              placeholder={selectedTemplate.name}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-400"
            />
          </div> : (
            <div className="mb-4 rounded-xl border border-green-100 bg-green-50 px-3.5 py-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-green-800">已选择 {selectedTemplates.length} 个任务</p>
                <p className="text-[10px] text-green-600 mt-0.5">将使用各模板默认名称，并应用同一执行频率</p>
              </div>
              <button type="button" onClick={() => setSelectedTemplateIds([])} className="text-[11px] text-green-700 hover:text-green-900">清空</button>
            </div>
          )}
          {discoveryScope && selectedTemplates.some(template => template.taskType === 'video_keyword_crawl') && <div className="mb-4 rounded-xl bg-green-50 p-3 text-xs text-green-900"><p>发现范围：{discoveryScope.keywordSet.name} · v{discoveryScope.keywordSet.version}</p><p className="mt-2">{discoveryKeywords(discoveryScope).join('、')}</p><p className="mt-2">这是独立专项任务：每次读取灵感中心最新关键词，但平台、时间和数量按本任务单独执行、单独计数。</p></div>}
          {keywordTemplatesCount > 0 && (
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-700 mb-1.5">采集关键词</label>
              <textarea
                value={taskKeywords}
                onChange={event => {
                  setTaskKeywords(event.target.value);
                  setConfirmedKeywordSignature('');
                  setCreateError('');
                }}
                placeholder={'可粘贴脏格式，例如：\n##foundation，Bahja Care عناية بهجة'}
                rows={3}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm leading-5 resize-none focus:outline-none focus:border-green-400"
              />
              <p className="text-[10px] text-gray-400 mt-1.5">支持逗号、空格、换行、全角符号、标签链接及混合语种，系统会先清洗再提交。</p>

              <div className={`mt-3 rounded-xl border p-3 ${keywordReviewReady ? 'border-green-100 bg-green-50/70' : 'border-amber-200 bg-amber-50'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-gray-800">自动清洗结果</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">请确认以下内容，确认后才会创建并执行任务。</p>
                  </div>
                  {keywordReviewConfirmed && <span className="flex items-center gap-1 text-[10px] font-medium text-green-700"><CheckCircle size={13} /> 已确认</span>}
                </div>
                <div className="mt-2.5 space-y-2.5">
                  {keywordReviews.map(({ platform, review }) => (
                    <div key={platform}>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <SocialPlatformIcon platform={platform} size={13} />
                        <span className="text-[10px] font-medium text-gray-600 capitalize">{platform}</span>
                      </div>
                      {review.items.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {review.items.map(item => <span key={item} className="max-w-full break-all px-2 py-1 rounded-full bg-white border border-green-200 text-[11px] text-green-800">{item}</span>)}
                        </div>
                      ) : (
                        <p className="flex items-center gap-1 text-[11px] text-amber-700"><AlertTriangle size={13} /> 没有识别到可用关键词，请修改输入。</p>
                      )}
                      {[...review.changes, ...review.warnings].length > 0 && (
                        <ul className="mt-2 space-y-0.5 text-[10px] text-gray-500">
                          {[...review.changes, ...review.warnings].map(message => <li key={message}>· {message}</li>)}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!keywordReviewReady) return;
                    setConfirmedKeywordSignature(keywordSignature);
                    setCreateError('');
                  }}
                  disabled={!keywordReviewReady || keywordReviewConfirmed}
                  className="mt-3 w-full py-2 rounded-lg border border-green-300 bg-white text-xs font-medium text-green-700 disabled:opacity-50"
                >
                  {keywordReviewConfirmed ? '已确认清洗结果' : `确认使用以上 ${keywordReviews.reduce((sum, item) => sum + item.review.items.length, 0)} 个关键词`}
                </button>
              </div>
            </div>
          )}
          <div className="mb-5">
            <label className="block text-xs font-medium text-gray-700 mb-1.5">执行频率</label>
            <div className="rounded-xl border border-gray-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setScheduleOpen(open => !open)}
                className="w-full px-3.5 py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
              >
                <span className="flex items-center gap-2 text-sm text-gray-800">
                  <Clock size={14} className="text-green-600" />
                  {scheduleLabel(scheduleTime, scheduleDays)}
                </span>
                <ChevronDown size={16} className={`text-gray-400 transition-transform ${scheduleOpen ? 'rotate-180' : ''}`} />
              </button>
              <AnimatePresence initial={false}>
                {scheduleOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden border-t border-gray-100"
                  >
                    <div className="p-3.5 bg-gray-50/70 space-y-3">
                      <div>
                        <p className="text-[11px] text-gray-500 mb-2">执行日期</p>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => setScheduleDays([])}
                            className={`px-3 py-1.5 rounded-full border text-xs transition-colors ${scheduleDays.length === 0 ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}
                          >
                            每天
                          </button>
                          {WEEKDAYS.map(day => {
                            const selected = scheduleDays.includes(day.value);
                            return (
                              <button
                                type="button"
                                key={day.value}
                                onClick={() => setScheduleDays(current => selected ? current.filter(value => value !== day.value) : [...current, day.value])}
                                className={`px-3 py-1.5 rounded-full border text-xs transition-colors ${selected ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}
                              >
                                {day.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-[11px] text-gray-500">当日时点</p>
                          <p className="text-[10px] text-gray-400 mt-0.5">北京时间</p>
                        </div>
                        <input
                          type="time"
                          value={scheduleTime}
                          onChange={event => setScheduleTime(event.target.value || '08:00')}
                          className="w-36 px-3 py-2 border border-gray-200 bg-white rounded-lg text-sm focus:outline-none focus:border-green-400"
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          {selectedTemplates.some(template => ['video_keyword_crawl', 'image_post_crawl', 'competitor_account_crawl'].includes(template.taskType)) && (
            <button
              type="button"
              onClick={() => setRunAfterCreate(value => !value)}
              className={`mb-4 w-full rounded-xl border px-3.5 py-3 flex items-center justify-between text-left transition-colors ${runAfterCreate ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white'}`}
            >
              <span className="flex items-center gap-2.5">
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${runAfterCreate ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-400'}`}><Play size={14} /></span>
                <span>
                  <span className="block text-xs font-medium text-gray-800">创建后立即执行一次</span>
                  <span className="block text-[10px] text-gray-500 mt-0.5">确认参数没有问题后，直接启动爬虫并返回本次结果</span>
                </span>
              </span>
              <span className={`w-9 h-5 rounded-full p-0.5 transition-colors ${runAfterCreate ? 'bg-green-600' : 'bg-gray-300'}`}><span className={`block w-4 h-4 rounded-full bg-white transition-transform ${runAfterCreate ? 'translate-x-4' : ''}`} /></span>
            </button>
          )}
        </>
      )}

      {createError && <p className="mb-3 flex items-start gap-1.5 text-xs text-red-600"><AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />{createError}</p>}
      <div className="flex gap-3">
        <Button onClick={closeAddModal} disabled={creatingTasks} className="flex-1">取消</Button>
        <Button
          type="primary"
          data-demo-target={showAdd && selectedTemplates.length > 0 ? 'scheduled_run' : undefined}
          onClick={createTask}
          disabled={selectedTemplates.length === 0 || creatingTasks || !keywordReviewConfirmed}
          className="flex-1" loading={creatingTasks}
        >
          {creatingTasks
            ? (runAfterCreate ? '正在创建并执行…' : '正在创建…')
            : selectedTemplates.length > 1
              ? `${runAfterCreate ? '创建并执行' : '创建'} ${selectedTemplates.length} 个任务`
              : runAfterCreate && ['video_keyword_crawl', 'image_post_crawl', 'competitor_account_crawl'].includes(selectedTemplate?.taskType || '')
                ? '创建并执行任务'
                : '创建任务'}
        </Button>
      </div>
  </Modal>
  );
}
