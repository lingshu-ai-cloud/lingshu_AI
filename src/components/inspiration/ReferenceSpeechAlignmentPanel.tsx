import { recordOf } from '../../../shared/benchmarkAnalysis';

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const rows = (value: unknown) => Array.isArray(value) ? value.map(recordOf) : [];
const seconds = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(3)}s` : '未知';
const list = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean) : [];
const labels: Record<string, string> = {
  word: '逐词时间戳', point: '词起点时间戳（无时长）', phrase: '句级时间戳',
  coarse: '粗时间窗口', unavailable: '暂无词级时间戳',
};
const presenterRoles: Record<string, string> = {
  sales_presenter: '主讲口播', presenter_action: '人物动作',
  background: '背景人物', none: '无人', unknown: '待自动识别',
};
const productionRoutes: Record<string, string> = {
  reference_frame_presenter: '按对标镜头生成人物视频',
  library_match: '匹配素材库', aigc_video: 'AIGC 视频生成',
  non_presenter_library_match: '匹配素材库（仅非主讲画面）',
  non_presenter_aigc_video: 'AIGC 视频生成（非主讲画面）',
};
const personPresence: Record<string, string> = {
  person: '人物可见', hands_only: '仅手部可见', none: '未见人物', unknown: '待自动识别',
};

function ProductionRouting({ shot }: { shot: Record<string, unknown> }) {
  // This is separate from the Content Agent's productionRouting requirements.
  // Historic presenter roles and criticality cannot supply a production route.
  const routing = recordOf(shot.referenceProductionRouting);
  const route = text(routing.route);
  const ready = routing.state === 'ready' && Boolean(productionRoutes[route]);
  const role = text(routing.observedPresenterRole);
  const presence = text(routing.personPresence);
  const identity = recordOf(routing.identityLock);
  const constraints = recordOf(routing.constraints);
  const identityRequired = ready && identity.required === true;
  const nonPresenterOnly = ready && constraints.nonPresenterBrollOnly === true;
  const identityLabel = identityRequired ? '需要锁定同一人物'
    : ready && (presence === 'none' || presence === 'hands_only' || nonPresenterOnly) ? '不要求主讲身份锁定'
      : '待自动识别';
  const tier = ready ? ['library_match', 'non_presenter_library_match'].includes(route) ? '素材复用'
    : routing.tier === 'high' ? '高还原生成' : routing.tier === 'standard' ? '标准生成' : '未分配' : '待自动识别';
  const source = recordOf(routing.source);
  return <div data-reference-production-route className="mt-2 rounded-lg border border-border bg-white p-3 text-[11px] leading-5" aria-label="人物连续性与生产方式">
    <p className="font-semibold text-text-primary">人物连续性与生产方式</p>
    <p className="mt-1 text-text-secondary">人物可见性：{ready ? personPresence[presence] || '待自动识别' : '待自动识别'}
      {ready && presenterRoles[role] && role !== 'unknown' && <span> · {presenterRoles[role]}</span>}</p>
    <p className="break-words text-text-secondary">人物连续性：{ready ? text(routing.personContinuityId)
      || (role === 'background' ? '背景人物无需绑定主讲身份' : presence === 'none' || presence === 'hands_only' ? '无可识别的连续人物' : '待自动识别') : '待自动识别'}</p>
    <p className="text-text-secondary">身份锁定：{identityLabel}</p>
    {identityRequired && <p className="break-words text-text-muted">原片人物：{text(identity.sourcePersonId) || '未记录'} · 同组镜头：{list(identity.samePersonShotIds).join('、') || '未记录'}
      <span> · 目标人物：{text(identity.targetPresenterAssetId) || '待自动绑定'}</span></p>}
    <p className="text-text-secondary">生产路由：{ready ? productionRoutes[route] : '待自动识别'}</p>
    <p className="text-text-secondary">生产档位：{tier}</p>
    {ready && <>
      <p className="mt-1 text-text-secondary">路由依据：{text(routing.reason) || '未记录判断理由'}</p>
      {list(routing.evidence).map((evidence, index) => <p key={index} className="text-text-muted">人物与路由证据：{evidence}</p>)}
      {constraints.mustUseReferenceFrames === true && <p className="text-text-muted">使用对标原片参考帧重建人物动作与镜头。</p>}
      {nonPresenterOnly && <p className="text-text-muted">当前素材需求仅包含非主讲画面。</p>}
      <p className="break-words text-[10px] text-text-muted">人物识别来源：{text(source.model) || '未记录'} · {text(source.provenance) || '未记录'}</p>
    </>}
    {!ready && <p className="mt-1 text-text-muted">路由依据：{text(routing.reason) || '人物连续性与生产方式待自动识别。'}</p>}
  </div>;
}

function AlignmentMeta({ value }: { value: unknown }) {
  const alignment = recordOf(value);
  const confidence = typeof alignment.confidence === 'number' && Number.isFinite(alignment.confidence)
    ? `${Math.round(alignment.confidence * 100)}%` : '来源未提供';
  return <p className="mt-1 break-words text-[10px] leading-5 text-text-muted">
    {labels[text(alignment.timingPrecision)] || '暂无词级时间戳'} · 来源：{list(alignment.provenance).join('、') || '未记录'} · 置信度：{confidence}
    {typeof alignment.timestampResolutionMs === 'number' && <span> · 时间戳分辨率 {alignment.timestampResolutionMs}ms</span>}
    <span> · 时钟误差{typeof alignment.accuracyMs === 'number' ? ` ≤ ${alignment.accuracyMs}ms` : '未验证'}</span>
  </p>;
}

export default function ReferenceSpeechAlignmentPanel({ details, transcript }: { details: unknown; transcript?: unknown }) {
  const shots = rows(details);
  const timed = shots.filter(shot => rows(recordOf(shot.speechAlignment).words).length > 0).length;
  if (!shots.length) return null;
  return <section data-reference-speech-alignment aria-label="口播时间戳与动作卡点" className="mb-4 rounded-lg border border-border bg-white p-4">
    <h3 className="text-sm font-black text-text-primary">口播时间戳与动作卡点</h3>
    <p className="mt-2 text-xs leading-5 text-text-secondary">{timed}/{shots.length} 镜有词级证据。词时间戳保留原始来源，跨镜词只在一个镜头中显示；词级对齐本身不代表动作与台词同步。</p>
    {!timed && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs leading-5 text-amber-800">当前分析暂无真实词级时间戳，粗窗口口播不能用于动作与台词卡点判断。</p>}
    <div className="mt-3 space-y-2">{shots.map((shot, index) => {
      const alignment = recordOf(shot.speechAlignment);
      const words = rows(alignment.words);
      const critical = recordOf(shot.criticalShot);
      const hasDecision = ['critical', 'non_critical'].includes(text(critical.classification));
      const hasSyncEvidence = words.some(word => word.syncEligible === true);
      const actionEvents = rows(critical.actionEvents);
      const syncPoints = rows(critical.syncPoints).flatMap(point => {
        const eventIndex = Number(point.eventIndex);
        const event = Number.isInteger(eventIndex) ? actionEvents[eventIndex] : undefined;
        const selected = list(point.wordIds).map(id => words.find(word => word.wordId === id));
        const syncTime = typeof point.syncTime === 'number' && Number.isFinite(point.syncTime) ? point.syncTime : null;
        const eventStart = typeof event?.start === 'number' ? event.start : NaN;
        const eventEnd = typeof event?.end === 'number' ? event.end : NaN;
        return event && selected.length && syncTime !== null && syncTime >= eventStart && syncTime <= eventEnd
          && selected.every(word => word?.syncEligible === true && typeof word.start === 'number'
            && typeof word.end === 'number' && word.end > word.start && word.start <= eventEnd && word.end >= eventStart)
          && selected.some(word => typeof word?.start === 'number' && typeof word.end === 'number' && syncTime >= word.start && syncTime <= word.end)
          ? [{ event, selected: selected as Record<string, unknown>[], eventIndex, reason: text(point.reason), syncTime: point.syncTime,
            timeRange: recordOf(point.timeRange) }] : [];
      });
      const sync = hasDecision && hasSyncEvidence && typeof critical.explicitAudioVisualSync === 'boolean'
        ? critical.explicitAudioVisualSync ? syncPoints.length ? '已识别明确同步点' : '未知（暂无合法同步点证据）'
          : '未识别明确同步点' : '未知（暂无模型判断证据）';
      const dialogue = words.length ? text(shot.dialogue) : '';
      const beats = rows(shot.beats);
      return <details key={text(shot.shotId) || index} open={index === 0} className="rounded-lg border border-border bg-[#fbfcfa] p-3">
        <summary className="cursor-pointer text-xs leading-6"><strong>第 {index + 1} 镜 · {text(shot.time || shot.timestamp) || '镜头时间未知'}</strong>
          <span className={`ml-2 rounded px-2 py-1 text-[10px] ${hasDecision && critical.classification === 'critical' ? 'bg-violet-50 text-violet-700' : 'bg-surface-2 text-text-secondary'}`}>关键性：{hasDecision ? critical.classification === 'critical' ? '关键镜头' : '非关键镜头' : '待自动识别'}</span>
          <span className="block break-words text-text-primary">真实口播：{dialogue || '暂无已对齐词语（不据此推断无口播）'}</span>
        </summary>
        <AlignmentMeta value={alignment} />
        <ProductionRouting shot={shot} />
        <p className="mt-2 text-xs leading-5 text-text-secondary">动作与台词卡点：{sync}</p>
        {hasDecision && <div className="mt-1 text-[11px] leading-5 text-text-secondary"><p>千问关键性判断：{text(critical.reason) || '未记录判断理由'}</p>
          {list(critical.evidence).map((item, evidenceIndex) => <p key={evidenceIndex}>证据：{item}</p>)}
          <p className="break-words text-[10px] text-text-muted">判断来源：{text(critical.model) || text(critical.provenance) || '千问（模型信息未记录）'}</p>
        </div>}
        {syncPoints.length > 0 && <div className="mt-2 space-y-2 rounded-lg bg-violet-50 p-2 text-[11px] leading-5" aria-label="千问动作与台词同步点">{syncPoints.map((point, pointIndex) => <div key={pointIndex}>
          <p className="font-semibold text-violet-800">卡点 {pointIndex + 1} · 时间交集锚点 {seconds(point.syncTime)}：{point.selected.map(word => text(word.text)).join(' ')}</p>
          <p>口播原始时间：{point.selected.map(word => `${text(word.text)} ${seconds(word.start)}–${seconds(word.end)}`).join('；')}</p>
          {typeof point.timeRange.start === 'number' && typeof point.timeRange.end === 'number' && <p>真实交集范围：{seconds(point.timeRange.start)}–{seconds(point.timeRange.end)}</p>}
          <p>抽帧动作观察窗：{seconds(point.event.start)}–{seconds(point.event.end)} · {text(point.event.action)}</p>
          {point.reason && <p>千问同步依据：{point.reason}</p>}
          <p className="text-text-muted">对齐来源：千问判断语义关联，系统投影词时钟与抽帧观察窗的真实交集；锚点用于定位，时钟误差仍未验证。</p>
        </div>)}</div>}
        {actionEvents.length > 0 && <details className="mt-2 text-[11px]"><summary className="cursor-pointer font-semibold text-accent">千问抽帧动作观察 · {actionEvents.length} 事件</summary><div className="mt-2 space-y-2">{actionEvents.map((event, eventIndex) => <div key={eventIndex} className="leading-5">
          <p>{seconds(event.start)}–{seconds(event.end)} · {text(event.action)}</p>
          <p className="text-text-muted">依据原片抽帧：{Array.isArray(event.evidenceFrameSeconds) ? event.evidenceFrameSeconds.map(seconds).join('、') : '未记录'}</p>
        </div>)}</div></details>}
        {words.length > 0 && <details className="mt-2 text-[11px]"><summary className="cursor-pointer font-semibold text-accent">逐词时间戳 · {words.length} 词</summary><div className="mt-2 flex flex-wrap gap-2">{words.map((word, wordIndex) => <span key={text(word.wordId) || wordIndex} className="rounded border border-border bg-white px-2 py-1" title={word.boundaryCrossing === true ? '跨越镜头边界，原始词时间保留' : undefined}>{text(word.text)} <span className="text-[10px] text-text-muted">{seconds(word.start)}–{seconds(word.end)}{word.timingPrecision === 'point' ? ' · 仅起点' : ''}{word.boundaryCrossing === true ? ' · 跨镜词' : ''}{word.syncEligible === false ? ' · 不用于同步判断' : ''}</span></span>)}</div></details>}
        {beats.length > 0 && <div className="mt-3 space-y-2 border-l-2 border-accent/30 pl-3">{beats.map((beat, beatIndex) => <div key={text(beat.beatId) || beatIndex} className="text-[11px] leading-5"><p><strong>{text(beat.time) || `${seconds(beat.start)}–${seconds(beat.end)}`}</strong> · 动作：{text(beat.action) || '暂无动作观察'}</p><p>对应词语：{rows(recordOf(beat.speechAlignment).words).length ? text(beat.dialogue) || '暂无' : '暂无词级证据'}</p><AlignmentMeta value={beat.speechAlignment} /></div>)}</div>}
        {!words.length && <details className="mt-2 text-[11px]"><summary className="cursor-pointer text-text-muted">查看粗时间窗证据</summary>{rows(alignment.coarseEvidence).map((segment, segmentIndex) => <p key={segmentIndex} className="mt-1">{seconds(segment.start)}–{seconds(segment.end)}：{text(segment.text)}（粗窗口，未分配逐镜台词）</p>)}{!rows(alignment.coarseEvidence).length && <p className="mt-1">{text(recordOf(transcript).text) ? '原片转写已保存，尚未对齐此镜头的词时间戳。' : '尚无可用转写证据。'}</p>}</details>}
      </details>;
    })}</div>
  </section>;
}
