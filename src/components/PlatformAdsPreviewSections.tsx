import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bot,
  Check,
  CircleHelp,
  Clock3,
  Megaphone,
  ShieldCheck,
  Sparkles,
  Target,
  Wallet,
} from 'lucide-react';

interface ChannelPreview {
  name: string;
  mark: string;
  color: string;
  description: string;
}

export function PlatformAdsPerformancePreview({ channels, onOpenAccounts, onOpenManaged }: {
  channels: ChannelPreview[];
  onOpenAccounts: () => void;
  onOpenManaged: () => void;
}) {
  const metrics = [
    { title: '有效视频观看', sub: '平台有效观看 · 尚未接入', icon: Megaphone, tone: 'primary' },
    { title: '单次有效观看成本', sub: '实际 CPV / 目标 CPV', icon: BarChart3 },
    { title: '有效观看率', sub: '有效观看 / 视频展示', icon: BarChart3 },
    { title: '广告消耗', sub: '实际消耗 / 计划预算', icon: Wallet },
    { title: '预算进度', sub: '时间进度 / 消耗进度', icon: Clock3 },
  ];
  return <>
    <section className="ads-goal-bar">
      <div className="ads-goal-icon"><Target size={18} /></div>
      <div><span>当前优化目标</span><strong>有效视频观看</strong><small>以合理观看成本，让更多目标用户真正看到内容</small></div>
      <div className="ads-inline"><span className="ads-pill neutral">目标待配置</span><select aria-label="表现日期范围"><option>近 7 天</option><option>近 30 天</option><option>今天</option></select></div>
    </section>
    <div className="ads-north-star-note">
      <div><Sparkles size={15} /><span>默认北极星指标</span><strong>目标成本内的有效视频观看量</strong></div>
      <p>各平台观看定义不同，统一用于决策时保留 TikTok、Meta 与 YouTube 的原始观看口径。</p>
    </div>
    <div className="ads-metrics ads-metrics-north-star">
      {metrics.map(({ title, sub, icon: Icon, tone }) => <section className={`ads-card ads-metric ${tone ? `ads-metric-${tone}` : ''}`} key={title}>
        <div>{title}<Icon size={17} /></div><strong>—</strong><small>{sub}</small>
      </section>)}
    </div>
    <section className="ads-hero ads-hero-compact">
      <div className="ads-hero-copy">
        <span className="ads-pill"><Sparkles size={13} />完成数据准备</span>
        <h2>连接账户，开始衡量视频放量效果。</h2>
        <p>同步视频计划、有效观看、消耗与互动数据，灵枢才能判断放量效率并给出素材建议。</p>
        <button onClick={onOpenAccounts}>开始连接账户 <ArrowRight size={16} /></button>
      </div>
      <div className="ads-readiness">
        {[['1', '广告账户', 'Meta · TikTok · Google'], ['2', '视频与主页', '确认投放身份和素材'], ['3', '观看成本目标', '用于判断放量效率']].map(([number, title, description]) => <div key={number}>
          <span>{number}</span><p><strong>{title}</strong><small>{description}</small></p>
        </div>)}
      </div>
    </section>
    <div className="ads-overview-grid">
      <section className="ads-card">
        <div className="ads-section-title"><h2>投放渠道 <span className="ads-count">0 / 4</span></h2><button className="ads-text-button" onClick={onOpenAccounts}>管理连接 <ArrowUpRight size={14} /></button></div>
        <div className="ads-channel-list">{channels.map(channel => <div className="ads-channel-row" key={channel.name}>
          <span className="ads-channel-logo" style={{ color: channel.color }}>{channel.mark}</span>
          <div><strong>{channel.name}</strong><small>{channel.description}</small></div><span className="ads-muted">未连接</span>
          <button className="ads-button small" onClick={onOpenAccounts}>连接</button>
        </div>)}</div>
        <div className="ads-footnote"><CircleHelp size={14} />Facebook 与 Instagram 使用 Meta 广告账户，可统一连接。</div>
      </section>
      <section className="ads-card ads-assistant">
        <div className="ads-section-title"><h2><Sparkles size={18} />AI 优化建议</h2><span className="ads-pill neutral">等待数据</span></div>
        <div className="ads-assistant-symbol"><Bot size={32} /></div><h3>先连接，再发现增长机会</h3>
        <p>有了真实投放数据，AI 才能为你分析预算节奏、观看质量和视频素材表现。</p>
        <div className="ads-check-item"><Check size={14} />每条建议附带数据依据</div>
        <div className="ads-check-item"><Check size={14} />关键调整由你确认</div>
        <button className="ads-text-button" onClick={onOpenManaged}>了解 AI 托管 <ArrowRight size={15} /></button>
      </section>
    </div>
    <section className="ads-start">
      <div><h2>三步，开启第一轮投放</h2><p>从已有内容出发，让创作与投放形成闭环。</p></div>
      {[['01', '连接账户', '授权渠道与投放身份'], ['02', '创建计划', '选择目标、素材和预算'], ['03', '持续优化', '看数、获得建议、迭代内容']].map(([number, title, description]) => <div className="ads-start-step" key={number}>
        <span>{number}</span><div><strong>{title}</strong><small>{description}</small></div>
      </div>)}
    </section>
  </>;
}

export function PlatformAdsManagedPreview({ mode, onModeChange }: { mode: string; onModeChange: (mode: string) => void }) {
  const modes = [
    { name: '建议模式', label: '先了解，再决策', desc: 'AI 分析表现、提出优化方案，由你决定如何操作。', icon: Sparkles },
    { name: '审批模式', label: '你确认，AI 执行', desc: '每项调整先展示影响范围，批准后才交给平台执行。', icon: ShieldCheck },
    { name: '托管模式', label: '在授权范围内执行', desc: '按预算上限和允许动作持续优化，越界时请求审批。', icon: Bot },
  ];
  return <>
    <section className="ads-managed-hero"><span className="ads-pill"><Bot size={14} />你的数字投流员工</span><h2>你定目标和边界，AI 持续关注投放。</h2><p>从建议开始，逐步授权。每一次预算调整，都有依据、有记录。</p></section>
    <div className="ads-autonomy-path" aria-label="AI 托管启用路径">
      {[['1', '数据就绪', '连接账户并积累样本'], ['2', '建议模式', 'AI 只分析不执行'], ['3', '审批模式', '用户确认后执行'], ['4', '有限托管', '仅在授权范围内执行']].map(([number, label, description], index) => <div key={number} className={index === 0 ? 'current' : ''}>
        <span>{number}</span><p><strong>{label}</strong><small>{description}</small></p>
      </div>)}
    </div>
    <div className="ads-mode-grid">{modes.map(({ name, label, desc, icon: Icon }) => <button className={`ads-card ads-mode ${mode === name ? 'selected' : ''}`} key={name} onClick={() => onModeChange(name)} aria-pressed={mode === name}>
      <div><Icon size={23} /><span className="ads-radio">{mode === name && <Check size={12} />}</span></div><h3>{name}</h3><strong>{label}</strong><p>{desc}</p>
    </button>)}</div>
    <section className="ads-card ads-guardrails">
      <div className="ads-section-title"><h2><ShieldCheck size={18} />{mode} · 运行边界</h2><span className="ads-pill neutral">尚未启用</span></div>
      <div className="ads-guard-grid">{[
        ['预算控制', '总额与日限额、币种、单次调整幅度'], ['操作权限', '指定账户、允许动作与授权有效期'],
        ['观察与审批', '样本要求、观察期和越界审批'], ['执行可追溯', '调整原因、前后值与平台执行结果'],
      ].map(([title, description]) => <div key={title}><strong>{title}</strong><p>{description}</p></div>)}</div>
      <div className="ads-footnote"><Clock3 size={15} />当前仅预览模式说明；账户、预算规则和执行服务接入后才能启用托管。</div>
    </section>
    <div className="ads-managed-grid">
      <section className="ads-card"><div className="ads-section-title"><h2>待审批</h2><span className="ads-count">0</span></div><div className="ads-mini-empty"><ShieldCheck size={24} /><strong>暂无待审批动作</strong><p>建议达到执行条件后，会显示原因、影响对象、修改前后值和有效期。</p></div></section>
      <section className="ads-card"><div className="ads-section-title"><h2>执行记录</h2><button className="ads-text-button">查看全部</button></div><div className="ads-mini-empty"><Clock3 size={24} /><strong>尚无执行记录</strong><p>账户接入后记录发现、决策、审批、平台回执和后续观察结果。</p></div></section>
    </div>
  </>;
}
