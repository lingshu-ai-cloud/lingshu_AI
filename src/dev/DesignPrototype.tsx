import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bell,
  Bot,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clapperboard,
  Compass,
  ExternalLink,
  FileText,
  Film,
  Home,
  Image as ImageIcon,
  Info,
  Layers3,
  Link2,
  LockKeyhole,
  Menu,
  MoreHorizontal,
  Palette,
  Play,
  Plus,
  Ruler,
  Save,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Type,
  Users,
  Video,
  WandSparkles,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import productImage from '../assets/covers/mock-39.png';
import resultImage from '../assets/covers/mock-11.png';
import inspirationImage from '../assets/covers/mock-1.png';
import kitchenImage from '../assets/covers/mock-28.png';
import './designPrototype.css';

type Screen = 'home' | 'inspiration' | 'create' | 'remix' | 'agents' | 'system';

const navItems: Array<{ id: Screen; label: string; caption: string; icon: typeof Home }> = [
  { id: 'home', label: '经营首页', caption: '结论与下一步', icon: Home },
  { id: 'inspiration', label: '灵感中心', caption: '真实内容洞察', icon: Compass },
  { id: 'create', label: '内容制作', caption: '两种制作入口', icon: Clapperboard },
  { id: 'remix', label: '爆款任务', caption: '逐镜执行与验收', icon: WandSparkles },
  { id: 'agents', label: 'Agent 设置', caption: '边界与审批', icon: Bot },
  { id: 'system', label: 'UI 规范', caption: '组件与 Token', icon: Layers3 },
];

const agentStates = [
  { name: '经营 Agent', task: '已确认本周经营目标', progress: '3/3', tone: 'violet', state: '已完成' },
  { name: '编导 Agent', task: '正在验收第 4 镜头', progress: '4/6', tone: 'blue', state: '运行中' },
  { name: '内容 Agent', task: '正在合成产品特写', progress: '5/6', tone: 'mint', state: '运行中' },
  { name: '客服 Agent', task: '今日询盘已完成分级', progress: '12/12', tone: 'orange', state: '已完成' },
];

function BrandMark() {
  return (
    <span className="dp-brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function StatusPill({ children, tone = 'success' }: { children: React.ReactNode; tone?: 'success' | 'running' | 'attention' }) {
  return <span className={`dp-status dp-status--${tone}`}><span className="dp-status-dot" />{children}</span>;
}

function IconButton({ label, children }: { label: string; children: React.ReactNode }) {
  return <button type="button" className="dp-icon-button" aria-label={label}>{children}</button>;
}

function Dashboard() {
  return (
    <div className="dp-screen-enter">
      <header className="dp-page-heading">
        <div>
          <div className="dp-eyebrow">经营工作台 · 9 月 24 日</div>
          <h1>今天只需要确认一件事</h1>
          <p>AI 正在推进本周内容计划，异常与结果会在这里汇总，不需要逐个查看 Agent 日志。</p>
        </div>
        <div className="dp-heading-meta">
          <StatusPill tone="running">2 个 Agent 运行中</StatusPill>
          <span>刚刚更新</span>
        </div>
      </header>

      <section className="dp-priority-grid" aria-label="今日优先事项">
        <article className="dp-next-action">
          <div className="dp-next-copy">
            <span className="dp-section-label"><CircleAlert size={15} /> 唯一下一步</span>
            <h2>确认这条产品事实，视频就能继续完成</h2>
            <p>编导 Agent 发现“72 小时留香”尚未在企业资料中获得证明。确认后将继续制作；若不确定，会自动改为安全表达。</p>
            <span className="dp-priority-note">因存在制作阻塞，待确认事项已提升到 Agent 状态之前</span>
            <div className="dp-impact-row">
              <span><Target size={15} /> 影响 1 条视频 · 镜头 04</span>
              <span>预计 12 分钟完成</span>
            </div>
          </div>
          <div className="dp-next-actions">
            <button type="button" className="dp-primary-button">确认事实边界 <ChevronRight size={17} /></button>
            <button type="button" className="dp-text-button">查看判断依据</button>
          </div>
        </article>

        <article className="dp-product-card">
          <div className="dp-product-image-wrap">
            <img src={productImage} alt="晨露香氛产品图" />
            <span className="dp-image-source"><Check size={12} /> 企业已确认</span>
          </div>
          <div className="dp-product-copy">
            <div>
              <span className="dp-section-label">本周主推商品</span>
              <h3>晨露木质香氛</h3>
            </div>
            <button type="button" className="dp-more-button" aria-label="更多商品操作"><MoreHorizontal size={18} /></button>
          </div>
          <dl className="dp-product-facts">
            <div><dt>目标市场</dt><dd>英国 · TikTok</dd></div>
            <div><dt>可用事实</dt><dd>8 条已确认</dd></div>
          </dl>
        </article>
      </section>

      <section className="dp-section">
        <div className="dp-section-heading">
          <div><span className="dp-eyebrow">实时协作</span><h2>四个 Agent 正在做什么</h2></div>
          <button type="button" className="dp-text-button">查看全部任务 <ChevronRight size={15} /></button>
        </div>
        <div className="dp-agent-grid">
          {agentStates.map((agent) => (
            <button type="button" className={`dp-agent-card dp-agent-card--${agent.tone}`} key={agent.name}>
              <div className="dp-agent-card-top">
                <span className="dp-agent-icon"><Bot size={18} /></span>
                <span className="dp-agent-state">{agent.state}</span>
              </div>
              <strong>{agent.name}</strong>
              <p>{agent.task}</p>
              <div className="dp-agent-progress"><span style={{ width: agent.progress === '4/6' ? '67%' : agent.progress === '5/6' ? '83%' : '100%' }} /><b>{agent.progress}</b></div>
            </button>
          ))}
        </div>
      </section>

      <section className="dp-bottom-grid">
        <article className="dp-result-card">
          <div className="dp-result-image"><img src={resultImage} alt="便携风扇短视频成片封面" /><button type="button" aria-label="播放成片"><Play size={18} fill="currentColor" /></button></div>
          <div className="dp-result-copy">
            <div><StatusPill>已完成</StatusPill><span className="dp-muted">今天 09:42</span></div>
            <h3>便携风扇 · 夏日户外场景</h3>
            <p>6 个镜头全部通过表达与技术验收，等待发布授权。</p>
            <button type="button" className="dp-secondary-button">预览并决定发布</button>
          </div>
        </article>
        <aside className="dp-insight-card">
          <div className="dp-insight-icon"><Sparkles size={18} /></div>
          <span className="dp-section-label">经营洞察</span>
          <h3>“真实使用场景”比纯产品特写更容易留住用户</h3>
          <p>最近 7 天的 12 条内容中，带人物使用场景的视频平均完整播放率高 18%。</p>
          <button type="button" className="dp-text-button">交给编导 Agent <ChevronRight size={15} /></button>
        </aside>
      </section>
    </div>
  );
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return (
    <header className="dp-page-heading dp-page-heading--compact">
      <div>
        <div className="dp-eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="dp-page-action">{action}</div>}
    </header>
  );
}

const inspirationCards = [
  {
    title: '反差开场：先质疑，再展示真实使用感',
    account: '@beautyreview · TikTok UK',
    image: inspirationImage,
    signal: '48 小时互动增速 2.4×',
    relevance: '高度相关',
    transfer: '结构可迁移',
    source: '外部公开内容',
  },
  {
    title: '生活化场景承接产品卖点，弱化广告感',
    account: '@homefinds · Instagram US',
    image: kitchenImage,
    signal: '完整播放率高于基线 31%',
    relevance: '场景相关',
    transfer: '需替换证据',
    source: '对标账号',
  },
  {
    title: '人物口播 + 产品特写的三段式节奏',
    account: '@summerkit · TikTok DE',
    image: resultImage,
    signal: '最近 7 天持续起量',
    relevance: '受众相关',
    transfer: '可零素材实现',
    source: '行业发现',
  },
];

function InspirationCenter() {
  const [view, setView] = useState('related');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const insightTabs = [
    ['recent', '最近发现'],
    ['rising', '正在起量'],
    ['related', '高度相关'],
    ['novel', '创新参考'],
  ];
  return (
    <div className="dp-screen-enter">
      <PageHeading
        eyebrow="灵感发现"
        title="把值得借鉴的内容，变成可追溯的创作依据"
        description="系统按产品、市场与受众持续发现内容；来源事实、AI 解读和权利边界始终分开呈现。"
        action={<button type="button" className="dp-secondary-button" onClick={() => setDrawerOpen(true)}><SlidersHorizontal size={16} /> 调整发现范围</button>}
      />
      <div className="dp-level-tabs" aria-label="灵感中心一级导航">
        <button type="button" className="active">灵感发现</button>
        <button type="button">我的素材 <span>36</span></button>
        <button type="button">拍摄任务 <span>2</span></button>
      </div>
      <section className="dp-scope-bar">
        <div><span className="dp-scope-icon"><Target size={17} /></span><div><b>晨露木质香氛 · 英国</b><span>美妆生活方式 · TikTok · 女性 25–34 岁</span></div></div>
        <span className="dp-demo-data">演示范围</span>
      </section>
      <div className="dp-view-toolbar">
        <div className="dp-subtabs" role="tablist" aria-label="灵感排序视图">
          {insightTabs.map(([id, label]) => <button type="button" role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} key={id} onClick={() => setView(id)}>{label}</button>)}
        </div>
        <div className="dp-query-summary"><strong>为你找到 126 条</strong><span>第 1 / 5 页 · 同一查询快照</span></div>
      </div>
      <section className="dp-inspiration-grid">
        {inspirationCards.map((card, index) => (
          <article className="dp-inspiration-card" key={card.title}>
            <div className="dp-inspiration-media">
              <img src={card.image} alt="演示灵感视频封面" />
              <span className="dp-media-kind"><Video size={13} /> {card.source}</span>
              <span className="dp-duration">00:{index === 0 ? '24' : index === 1 ? '18' : '31'}</span>
            </div>
            <div className="dp-inspiration-body">
              <span className="dp-account">{card.account}</span>
              <h2>{card.title}</h2>
              <div className="dp-evidence-grid">
                <div><span>表现信号</span><strong>{card.signal}</strong></div>
                <div><span>与本商品</span><strong>{card.relevance}</strong></div>
                <div><span>迁移判断</span><strong>{card.transfer}</strong></div>
              </div>
              <div className="dp-analysis-note"><Sparkles size={15} /><p><b>AI 解读</b> 开头用真实疑问制造停留，产品证明在第 6 秒以后出现。</p></div>
              <div className="dp-card-actions"><span><ShieldCheck size={14} /> 可分析引用，发布前需重做</span><button type="button" className="dp-secondary-button">用于创作</button></div>
            </div>
          </article>
        ))}
      </section>
      <div className="dp-pagination"><button type="button" disabled>上一页</button><button type="button" className="active">1</button><button type="button">2</button><button type="button">3</button><span>…</span><button type="button">5</button><button type="button">下一页</button></div>

      {drawerOpen && <>
        <button type="button" className="dp-drawer-scrim" aria-label="关闭发现范围" onClick={() => setDrawerOpen(false)} />
        <aside className="dp-scope-drawer" role="dialog" aria-modal="true" aria-labelledby="scope-title">
          <header><div><span className="dp-eyebrow">发现设置</span><h2 id="scope-title">调整发现范围</h2></div><button type="button" className="dp-icon-button" aria-label="关闭" onClick={() => setDrawerOpen(false)}><X size={19} /></button></header>
          <div className="dp-drawer-content">
            <label>产品<select defaultValue="perfume"><option value="perfume">晨露木质香氛</option></select></label>
            <div className="dp-field-pair"><label>市场<select defaultValue="uk"><option value="uk">英国</option></select></label><label>语言<select defaultValue="en"><option value="en">英语</option></select></label></div>
            <label>目标受众<input defaultValue="25–34 岁、重视生活氛围感的女性" /></label>
            <label>场景簇<div className="dp-chip-input"><span>通勤 <X size={12} /></span><span>约会 <X size={12} /></span><span>礼物 <X size={12} /></span><button type="button"><Plus size={14} /> 添加</button></div></label>
            <label>对标账号或视频<div className="dp-input-with-icon"><Link2 size={16} /><input placeholder="粘贴公开账号或视频链接" /></div></label>
            <label>排除内容<textarea defaultValue="夸大留香时间；未经证实的成分功效；仿冒品牌表达" /></label>
            <div className="dp-sample-card"><strong>保存前预估</strong><div><span>预计可获得</span><b>80–160 条 / 周</b></div><div><span>包含字段</span><b>封面、字幕、互动信号、来源</b></div><div><span>分析成本</span><b>约 ¥18 / 周</b></div></div>
          </div>
          <footer><button type="button" className="dp-text-button" onClick={() => setDrawerOpen(false)}>取消</button><button type="button" className="dp-primary-button" onClick={() => setDrawerOpen(false)}>保存并重新发现</button></footer>
        </aside>
      </>}
    </div>
  );
}

function ContextStrip() {
  return (
    <div className="dp-context-strip">
      <div><span>产品</span><b>晨露木质香氛</b></div>
      <div><span>市场 / 语言</span><b>英国 / 英语</b></div>
      <div><span>平台</span><b>TikTok</b></div>
      <div><span>目标</span><b>新品认知</b></div>
      <button type="button">查看上下文 <ChevronRight size={14} /></button>
    </div>
  );
}

function MaterialWorkflow({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState(0);
  const steps = ['资料输入', '脚本确认', '制作', '预览', '交付'];
  return (
    <div className="dp-screen-enter">
      <button type="button" className="dp-back-button" onClick={onBack}><ArrowLeft size={16} /> 返回内容制作</button>
      <PageHeading eyebrow="素材加工 · 新任务" title="系统已盘点现有资料，可以从零完成这条视频" description="你只需确认系统读到的产品事实；画面、数字人、配音和剪辑方案由内容 Agent 负责。" action={<StatusPill tone="running">准备中 · 1/5</StatusPill>} />
      <ContextStrip />
      <ol className="dp-stepper">
        {steps.map((label, index) => <li className={index < step ? 'done' : index === step ? 'active' : ''} key={label}><span>{index < step ? <Check size={14} /> : index + 1}</span><b>{label}</b></li>)}
      </ol>
      <section className="dp-workflow-grid">
        <div className="dp-workflow-main">
          <div className="dp-panel-heading"><div><span className="dp-eyebrow">系统判断</span><h2>3 类资料已就绪，2 类由系统补齐</h2></div><StatusPill>可自动完成</StatusPill></div>
          <div className="dp-source-list">
            <article><span className="dp-source-icon ready"><ImageIcon size={19} /></span><div><strong>产品图片 · 6 张</strong><p>来自企业知识库，已确认可用于公开内容。</p></div><StatusPill>已就绪</StatusPill></article>
            <article><span className="dp-source-icon ready"><FileText size={19} /></span><div><strong>产品事实 · 8 条</strong><p>香调、容量、适用场景已确认；留香时间仍待核实。</p></div><button type="button" className="dp-text-button">查看事实</button></article>
            <article><span className="dp-source-icon auto"><Users size={19} /></span><div><strong>人物出镜</strong><p>没有真人素材，将使用已授权数字人和英语配音。</p></div><span className="dp-auto-tag">系统补齐</span></article>
            <article><span className="dp-source-icon auto"><Film size={19} /></span><div><strong>生活方式场景</strong><p>使用可商用素材库，不生成虚构使用效果。</p></div><span className="dp-auto-tag">系统补齐</span></article>
          </div>
          <article className="dp-truth-card"><AlertTriangle size={18} /><div><strong>有 1 条事实需要你决定</strong><p>“72 小时留香”缺少证明。你可以确认已有检测报告，或让系统自动改成“持久留香”。</p></div><button type="button" className="dp-secondary-button">选择安全表达</button></article>
        </div>
        <aside className="dp-route-card">
          <span className="dp-section-label"><Zap size={14} /> 推荐制作路线</span>
          <h2>产品锚定生成</h2>
          <p>保持真实产品外观，用产品动效、数字人和授权场景完成 20 秒竖版视频。</p>
          <div className="dp-route-preview"><img src={productImage} alt="产品锚定生成预览" /><span>真实产品图作为视觉锚点</span></div>
          <dl><div><dt>预计耗时</dt><dd>18 分钟</dd></div><div><dt>预计成本</dt><dd>¥12–18</dd></div><div><dt>需要补拍</dt><dd>不需要</dd></div></dl>
        </aside>
      </section>
      <section className="dp-sticky-action">
        <div><strong>下一步：确认资料与安全表达</strong><span>确认不等于授权发布，成片完成后仍需预览。</span></div>
        <button type="button" className="dp-primary-button" onClick={() => setStep((value) => Math.min(4, value + 1))}>{step === 0 ? '确认并生成脚本' : step === 1 ? '确认脚本并开始制作' : step === 2 ? '查看制作预览' : step === 3 ? '确认交付版本' : '查看交付记录'} <ChevronRight size={17} /></button>
      </section>
    </div>
  );
}

function ContentCreation() {
  const [workflowOpen, setWorkflowOpen] = useState(false);
  if (workflowOpen) return <MaterialWorkflow onBack={() => setWorkflowOpen(false)} />;
  return (
    <div className="dp-screen-enter">
      <PageHeading eyebrow="内容制作" title="从你的产品出发，选择一种制作方式" description="有没有素材都可以开始。立即生成和每周生成只决定执行频率，不改变制作逻辑。" />
      <ContextStrip />
      <section className="dp-mode-grid">
        <article className="dp-mode-card dp-mode-card--mint">
          <div className="dp-mode-visual"><img src={productImage} alt="素材加工产品示例" /><span><ImageIcon size={17} /> 有素材就加工，没有也能从零制作</span></div>
          <div className="dp-mode-body"><span className="dp-section-label">方式一</span><h2>素材加工</h2><p>从产品图片、视频、商品页或已确认事实出发，系统自动补齐人物、场景、配音和剪辑。</p><ul><li><Check size={15} /> 支持零素材启动</li><li><Check size={15} /> 只重做需要修改的镜头</li><li><Check size={15} /> 不要求选择模型和提示词</li></ul><button type="button" className="dp-primary-button" onClick={() => setWorkflowOpen(true)}>使用素材加工 <ChevronRight size={17} /></button></div>
        </article>
        <article className="dp-mode-card dp-mode-card--coral">
          <div className="dp-mode-visual"><img src={inspirationImage} alt="爆款裂变参考视频示例" /><span><WandSparkles size={17} /> 参考结构，不复制内容</span></div>
          <div className="dp-mode-body"><span className="dp-section-label">方式二</span><h2>爆款裂变</h2><p>导入参考视频或让系统从灵感库推荐，逐镜分析有效结构，再用你的真实产品内容重新表达。</p><ul><li><Check size={15} /> 逐镜判断零素材可行性</li><li><Check size={15} /> 结构还原与原创差异分开验收</li><li><Check size={15} /> 权利或事实不足时明确阻断</li></ul><button type="button" className="dp-secondary-button">使用爆款裂变 <ChevronRight size={17} /></button></div>
        </article>
      </section>
      <section className="dp-frequency-card">
        <div><CalendarDays size={20} /><div><strong>什么时候执行？</strong><span>选择制作方式后再决定，不会变成第三种内容类型。</span></div></div>
        <div className="dp-frequency-options"><button type="button" className="active"><Zap size={15} /> 立即生成</button><button type="button"><CalendarDays size={15} /> 每周生成</button></div>
      </section>
    </div>
  );
}

const shots = [
  { id: '01', time: '0–3s', purpose: '黄金钩子', reference: '质疑常见香水只留香一小时', customer: '“下午的约会，不该只剩早上的香味。”', status: '完整实现', tone: 'success' },
  { id: '02', time: '3–6s', purpose: '产品建立', reference: '手持产品近景转场', customer: '真实产品图生成微距旋转动效', status: '完整实现', tone: 'success' },
  { id: '03', time: '6–10s', purpose: '使用场景', reference: '真人在约会前使用', customer: '授权数字人 + 产品特写组合', status: '功能等价', tone: 'running' },
  { id: '04', time: '10–14s', purpose: '关键证明', reference: '字幕强调 72 小时留香', customer: '检测依据不足，等待安全改写', status: '缺事实已阻断', tone: 'attention' },
];

function RemixTask() {
  const [selected, setSelected] = useState('04');
  return (
    <div className="dp-screen-enter">
      <PageHeading eyebrow="爆款裂变 · 任务 LS-240924-08" title="正在把参考视频拆成你的产品版本" description="编导负责结构与表达，内容 Agent 负责素材与制作；单个镜头有问题时，只返工受影响部分。" action={<StatusPill tone="attention">等待确认 · 已完成 3/6</StatusPill>} />
      <ContextStrip />
      <section className="dp-stage-track" aria-label="任务阶段">
        {['参考分析', '导演方案', '执行计划', '逐镜制作', '成片验收'].map((label, index) => <div className={index < 3 ? 'done' : index === 3 ? 'active' : ''} key={label}><span>{index < 3 ? <Check size={13} /> : index + 1}</span><b>{label}</b></div>)}
      </section>
      <section className="dp-hook-layout">
        <article className="dp-hook-card">
          <div className="dp-panel-heading"><div><span className="dp-eyebrow">前三秒黄金钩子</span><h2>系统已采用主钩子</h2></div><span className="dp-auto-tag">托管模式 · 自动采用</span></div>
          <div className="dp-main-hook"><span>主钩子</span><strong>“下午的约会，不该只剩早上的香味。”</strong><p>采用原因：不依赖未经确认的时长数据，同时保留参考内容的“反常识质疑”结构。</p></div>
          <div className="dp-alt-hooks"><button type="button"><span>备选 A</span><b>你的香水，能撑过一整天吗？</b></button><button type="button"><span>备选 B</span><b>从通勤到晚餐，只带这一瓶。</b></button></div>
        </article>
        <aside className="dp-score-card"><span className="dp-section-label">独立验收，不合并总分</span><div><span>结构还原度</span><strong>86%</strong><small>节奏、镜头作用、信息顺序</small></div><div><span>原创差异度</span><strong>74%</strong><small>文案、人物、场景、证据替换</small></div><button type="button" className="dp-text-button">查看检查依据 <ExternalLink size={14} /></button></aside>
      </section>
      <div className="dp-section-heading dp-shot-heading"><div><span className="dp-eyebrow">逐镜执行</span><h2>只处理需要你介入的镜头</h2></div><span className="dp-muted">点击镜头查看事实、来源与替代方案</span></div>
      <section className="dp-shot-list">
        {shots.map((shot) => <button type="button" className={`dp-shot-row ${selected === shot.id ? 'active' : ''}`} onClick={() => setSelected(shot.id)} key={shot.id}>
          <span className="dp-shot-number">{shot.id}<small>{shot.time}</small></span>
          <span><small>镜头作用</small><b>{shot.purpose}</b></span>
          <span><small>参考内容</small><b>{shot.reference}</b></span>
          <span><small>客户版本</small><b>{shot.customer}</b></span>
          <StatusPill tone={shot.tone as 'success' | 'running' | 'attention'}>{shot.status}</StatusPill>
          <ChevronRight size={17} />
        </button>)}
      </section>
      {selected === '04' && <section className="dp-blocked-detail">
        <div className="dp-blocked-icon"><LockKeyhole size={21} /></div>
        <div><span className="dp-section-label">镜头 04 · 事实边界</span><h2>不能把未证实的“72 小时”写进成片</h2><p>知识库只有内部销售话术，没有检测报告或公开来源。系统已暂停这个镜头，其他镜头继续制作。</p><div className="dp-evidence-tags"><span>来源：内部销售话术</span><span>证据强度：不足</span><span>影响：仅镜头 04</span></div></div>
        <div className="dp-blocked-actions"><button type="button" className="dp-primary-button">改为“持久留香”</button><button type="button" className="dp-text-button">补充检测报告</button></div>
      </section>}
      <section className="dp-sticky-action"><div><strong>其他 5 个镜头仍在制作</strong><span>事实确认后只重做镜头 04，预计增加 4 分钟。</span></div><button type="button" className="dp-secondary-button"><Play size={16} /> 预览当前版本</button></section>
    </div>
  );
}

const settingTabs = ['通用设置', '经营 Agent', '编导 Agent', '内容 Agent', '客服 Agent'];

function AgentSettings() {
  const [tab, setTab] = useState('通用设置');
  const [saved, setSaved] = useState(true);
  return (
    <div className="dp-screen-enter dp-settings-page">
      <PageHeading eyebrow="智能体管理" title="先定边界，再让 Agent 自主工作" description="通用规则只设置一次；每个 Agent 页面只保留自己的工作流、对外动作和审批红线。" action={<span className={saved ? 'dp-saved-state' : 'dp-unsaved-state'}>{saved ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}{saved ? '所有更改已保存' : '有未保存更改'}</span>} />
      <div className="dp-settings-tabs" role="tablist">{settingTabs.map((label) => <button type="button" role="tab" aria-selected={tab === label} className={tab === label ? 'active' : ''} key={label} onClick={() => setTab(label)}>{label}</button>)}</div>
      <section className="dp-settings-layout">
        <aside className="dp-recommendation-card"><span className="dp-section-label"><Sparkles size={14} /> 推荐配置摘要</span><h2>{tab === '通用设置' ? '托管执行，关键动作审批' : `${tab} 采用推荐边界`}</h2><ul><li><Check size={14} /> 日常内部动作自动执行</li><li><Check size={14} /> 对外发布与发送前审批</li><li><Check size={14} /> 事实、权利、预算降级时停下</li></ul><button type="button" className="dp-text-button">为什么这样推荐？</button></aside>
        <div className="dp-settings-form">
          {tab === '通用设置' ? <>
            <section><div className="dp-form-section-heading"><div><h2>参与方式</h2><p>决定系统什么时候主动工作、什么时候需要找你。</p></div><StatusPill>推荐</StatusPill></div><div className="dp-choice-grid"><button type="button"><span className="dp-radio" /><b>辅助建议</b><small>每一步都由用户发起</small></button><button type="button" className="active"><span className="dp-radio" /><b>托管执行</b><small>按边界主动推进任务</small></button></div></section>
            <section><div className="dp-form-section-heading"><div><h2>默认审批负责人</h2><p>只有需要审批时才通知对应负责人。</p></div></div><label>负责人<select defaultValue="jiejie" onChange={() => setSaved(false)}><option value="jiejie">洁洁 · 管理员</option><option value="content">内容负责人</option></select></label></section>
            <section><div className="dp-form-section-heading"><div><h2>统一红线</h2><p>以下规则对所有 Agent 生效，不能被单个工作流覆盖。</p></div><span className="dp-required"><LockKeyhole size={12} /> 强制</span></div><div className="dp-rule-list"><label><input type="checkbox" defaultChecked disabled /><span><b>未经确认的事实不得对外使用</b><small>包括参数、价格、效果、认证与客户案例。</small></span></label><label><input type="checkbox" defaultChecked disabled /><span><b>发布、发送与付费动作必须有真实回执</b><small>任务完成不等于对外动作成功。</small></span></label></div></section>
          </> : <>
            <section><div className="dp-form-section-heading"><div><h2>{tab} 的工作流</h2><p>这些设置只影响当前 Agent，不重复通用参与方式与负责人。</p></div></div><label>工作范围<select defaultValue="recommended" onChange={() => setSaved(false)}><option value="recommended">使用系统推荐范围</option><option value="custom">自定义工作范围</option></select></label><label>自动化边界<textarea defaultValue={tab === '编导 Agent' ? '自动完成参考分析、导演方案和执行计划审核；事实或经营目标降级时暂停。' : '低风险内部动作自动执行；对外动作和高风险例外进入审批。'} onChange={() => setSaved(false)} /></label></section>
            {tab === '编导 Agent' && <section><div className="dp-form-section-heading"><div><h2>灵感发现范围</h2><p>引用灵感中心的版本化范围，不在这里维护第二套关键词。</p></div></div><div className="dp-linked-scope"><Compass size={18} /><div><b>英国香氛 · TikTok v4</b><span>12 个对标账号 · 6 个场景簇 · 今天 08:00 更新</span></div><button type="button" className="dp-secondary-button">查看范围</button></div></section>}
            <section><div className="dp-form-section-heading"><div><h2>需要审批的动作</h2><p>高风险动作无法关闭；其他动作可按团队职责调整。</p></div></div><div className="dp-rule-list"><label><input type="checkbox" defaultChecked disabled /><span><b>改变已确认经营目标</b><small>强制审批</small></span></label><label><input type="checkbox" defaultChecked onChange={() => setSaved(false)} /><span><b>预算超出任务上限</b><small>通知默认审批负责人</small></span></label></div></section>
          </>}
        </div>
      </section>
      <div className="dp-settings-save"><div>{saved ? <><CheckCircle2 size={16} /> 当前配置已生效</> : <><CircleAlert size={16} /> 更改尚未保存</>}</div><button type="button" className="dp-primary-button" disabled={saved} onClick={() => setSaved(true)}><Save size={16} /> 保存设置</button></div>
    </div>
  );
}

function SystemSpec() {
  const colors = [
    ['森林绿', '#173D31', '标题与品牌底色'], ['交互绿', '#117F51', '主操作与运行'], ['暖米白', '#FFF5DE', '待确认与提醒'], ['珊瑚橙', '#DF765B', '洞察与装饰'], ['画布灰', '#F4F7F2', '应用背景'], ['边框灰', '#DDE7E1', '结构分隔'],
  ];
  return (
    <div className="dp-screen-enter">
      <PageHeading eyebrow="灵枢 UI v1.0" title="一套服务于“清楚、可信、可控”的界面系统" description="字体、间距、色彩和组件都围绕同一注意力顺序：先结论，再对象，再行动，最后才是证据与历史。" action={<button type="button" className="dp-secondary-button"><FileText size={15} /> 查看完整设计规范</button>} />
      <section className="dp-spec-grid">
        <article className="dp-spec-panel dp-type-panel"><div className="dp-spec-heading"><Type size={18} /><div><h2>字体与层级</h2><p>系统字体优先，关键正文不小于 14px。</p></div></div><div className="dp-type-samples"><div><span>Display · 40 / 46</span><b>经营结果，一眼读懂</b></div><div><span>H1 · 30 / 38</span><b>页面主任务标题</b></div><div><span>H2 · 22 / 30</span><b>重要区块标题</b></div><div><span>Body · 14 / 22</span><p>正文只解释当前判断、影响和下一步，避免堆叠技术原理。</p></div></div></article>
        <article className="dp-spec-panel"><div className="dp-spec-heading"><Palette size={18} /><div><h2>颜色 Token</h2><p>颜色不单独表达含义，状态始终带文字。</p></div></div><div className="dp-color-list">{colors.map(([name, value, usage]) => <div key={name}><span style={{ background: value }} /><b>{name}<small>{value}</small></b><em>{usage}</em></div>)}</div></article>
        <article className="dp-spec-panel"><div className="dp-spec-heading"><Ruler size={18} /><div><h2>间距与圆角</h2><p>4px 基准，14 / 18px 两级容器圆角。</p></div></div><div className="dp-spacing-scale">{[4, 8, 12, 16, 24, 32, 48].map((space) => <div key={space}><span style={{ width: space }} /><b>{space}</b></div>)}</div><div className="dp-radius-samples"><div>10<small>控件</small></div><div>14<small>卡片</small></div><div>18<small>重点面板</small></div></div></article>
      </section>
      <section className="dp-component-section"><div className="dp-section-heading"><div><span className="dp-eyebrow">核心组件</span><h2>一套状态语言贯穿所有页面</h2></div><span className="dp-muted">展示默认、焦点、禁用和反馈状态</span></div><div className="dp-component-grid">
        <article><span className="dp-component-name">Button</span><div className="dp-component-demo dp-button-demo"><button type="button" className="dp-primary-button">开始制作</button><button type="button" className="dp-secondary-button">查看依据</button><button type="button" className="dp-text-button">稍后处理</button><button type="button" className="dp-primary-button" disabled>正在处理…</button></div></article>
        <article><span className="dp-component-name">Status Pill</span><div className="dp-component-demo"><StatusPill>已完成</StatusPill><StatusPill tone="running">运行中</StatusPill><StatusPill tone="attention">等待确认</StatusPill><span className="dp-offline-pill"><WifiOff size={13} /> 连接中断 · 保留 09:42 状态</span></div></article>
        <article><span className="dp-component-name">State Notice</span><div className="dp-state-notice"><CircleAlert size={18} /><div><b>镜头 04 缺少事实依据</b><p>选择安全表达，或补充检测报告后继续。</p></div><button type="button">处理</button></div></article>
        <article><span className="dp-component-name">Input</span><div className="dp-component-demo dp-input-demo"><label>产品名称<input defaultValue="晨露木质香氛" /></label><label>错误状态<input aria-invalid="true" defaultValue="72 小时留香" /><small>请提供依据或改用安全表达</small></label></div></article>
      </div></section>
      <section className="dp-anatomy-panel"><div><span className="dp-eyebrow">卡片结构</span><h2>每张卡只回答一个问题</h2><p>名称与状态 → 当前结论 → 最少证据 → 唯一操作。低频动作进入更多菜单。</p></div><div className="dp-anatomy-card"><span className="dp-anatomy-index">01</span><strong>对象与状态</strong><span className="dp-anatomy-index">02</span><strong>当前结论</strong><span className="dp-anatomy-index">03</span><strong>证据摘要</strong><span className="dp-anatomy-index">04</span><strong>下一步</strong></div></section>
    </div>
  );
}

export default function DesignPrototype() {
  const [screen, setScreen] = useState<Screen>('home');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = '前端设计规范与交互原型 · 灵枢 AI';
    return () => { document.title = previousTitle; };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 860px)');
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!isMobile || !mobileNavOpen) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileNavOpen(false);
        requestAnimationFrame(() => menuButtonRef.current?.focus());
        return;
      }
      if (event.key !== 'Tab' || !sidebarRef.current) return;
      const focusable = Array.from(sidebarRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], select, input, textarea'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMobile, mobileNavOpen]);

  const navigate = (next: Screen) => {
    setScreen(next);
    setMobileNavOpen(false);
    window.scrollTo({ top: 0 });
    requestAnimationFrame(() => mainRef.current?.focus());
  };

  const closeMobileNav = () => {
    setMobileNavOpen(false);
    requestAnimationFrame(() => menuButtonRef.current?.focus());
  };

  const renderScreen = () => {
    if (screen === 'inspiration') return <InspirationCenter />;
    if (screen === 'create') return <ContentCreation />;
    if (screen === 'remix') return <RemixTask />;
    if (screen === 'agents') return <AgentSettings />;
    if (screen === 'system') return <SystemSpec />;
    return <Dashboard />;
  };

  return (
    <div className="dp-root">
      <a className="dp-skip-link" href="#prototype-main">跳到主要内容</a>
      {mobileNavOpen && <button type="button" className="dp-nav-scrim" aria-label="关闭导航" onClick={closeMobileNav} />}
      <aside ref={sidebarRef} className={`dp-sidebar ${mobileNavOpen ? 'is-open' : ''}`} inert={isMobile && !mobileNavOpen ? true : undefined} aria-label="原型导航">
        <div className="dp-brand"><BrandMark /><div><strong>灵枢 AI</strong><span>经营工作台</span></div><button ref={closeButtonRef} type="button" className="dp-icon-button dp-close-nav" aria-label="关闭导航" onClick={closeMobileNav}><X size={19} /></button></div>
        <nav aria-label="原型页面">
          <span className="dp-nav-group">核心工作流</span>
          {navItems.slice(0, 4).map((item) => <button key={item.id} type="button" className={screen === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><item.icon size={18} /><span><strong>{item.label}</strong><small>{item.caption}</small></span>{screen === item.id && <span className="dp-nav-active" />}</button>)}
          <span className="dp-nav-group dp-nav-group--spaced">设计与管理</span>
          {navItems.slice(4).map((item) => <button key={item.id} type="button" className={screen === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><item.icon size={18} /><span><strong>{item.label}</strong><small>{item.caption}</small></span>{screen === item.id && <span className="dp-nav-active" />}</button>)}
        </nav>
        <div className="dp-sidebar-footer"><div className="dp-avatar">J</div><div><strong>洁洁</strong><span>管理员</span></div><ChevronDown size={15} /></div>
      </aside>

      <div className="dp-app">
        <header className="dp-topbar">
          <button ref={menuButtonRef} type="button" className="dp-mobile-menu" aria-label="打开导航" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}><Menu size={20} /></button>
          <div className="dp-crumb"><span>灵枢 AI</span><ChevronRight size={14} /><strong>{navItems.find((item) => item.id === screen)?.label}</strong></div>
          <div className="dp-top-actions"><span className="dp-prototype-badge"><Info size={13} /> 参考预览</span><span className="dp-healthy"><Activity size={14} /> 系统运行正常</span><IconButton label="通知"><Bell size={18} /></IconButton><IconButton label="设置"><Settings2 size={18} /></IconButton></div>
        </header>
        <main ref={mainRef} id="prototype-main" className="dp-main" tabIndex={-1}>
          {renderScreen()}
        </main>
      </div>
    </div>
  );
}
