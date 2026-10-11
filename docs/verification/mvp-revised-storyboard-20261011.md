# MVP 英文修订制作包（2026-10-11）

状态：编导 proposal / 技术预排。不是制作授权、持久冻结、人工批准或可发布成片；未修改原任务、账本和媒体，未调用付费供应商。本包以 `mvp-current-authority-20261011.md` 为权威快照，正式采用前重新读取并比对版本。

## 统一身份与修订理由

- tenant：`local_tenant_customer_1b2913131e2c46deab66172228c4df0a`。
- task：`socialtask_e4f1688c319adfc5397fc4ec`，当前51、asset_review；run：`5a7b4d34e5cf4da`。本方案尚无新 run，不冒称该 run 已执行修订。
- 产品：GUIANFA-RS-001 云朵泡沫卸妆蜜；TikTok / English / 9:16；targetAccountRef=null。
- 当前事实：`enterprise-facts-v5-e9838185570f`，revision5，SHA `e9838185570f8b748135a78c670d35c569fc36032aa298b2c3944d0af0ab65c6`。
- 旧 baseline39 / replication_script1791682349667 对应旧v2事实，含37镜、其他品类与未经当前资料证实的工厂/定制配方话术。本包明确提出新脚本；不得在旧冻结版本上静默删改。
- 参考38s、分析3096c359761d、原视频SHA `18c7f2ba2ff769378a8e410551128e1314ff7bf01c1e5a35c4c5d07dbf28c9e1`，仅用于镜头功能/节奏分析。8镜是功能改编，不是逐镜动作等价；原人物、声音、像素、品牌与原文案不复制。旧hook虽然已生成，仍需独立核查其文案使用边界，不能以已付费作为权利证据。

## 来源、事实与媒体账

F1：权威 `data/local-store/tenant_profiles.json` 当前租户 `profile.products.items[id=GUIANFA-RS-001]`：品牌GUIANFA、产品中文名、类别卸妆、attributes.净含量100ml；来源文件“融尚货盘报价表_零售价7.14.pdf”页1。英文 “Cloud Foam Makeup Remover” 为本包工作译名，正式品牌英文名缺失则不用它替换包装文字。原图标签像素保持原样。

F2：同记录 `profile.company.description` 和 `profile.strategy.focusProducts/focusMarkets`，支持“产品展示及合作沟通”和面向北美B2B采购。`profile.socialStrategy` 有oem_odm合作意向，但不证明具体MOQ、配方定制能力、认证、交期和工厂事实。本包只邀请询价，不承诺一定可定制。

F3：当前task.brief.callToAction 精确为 `DM us for a private-label cleansing quote.`，预算和brandNotes见原task。Studio companion的Messenger CTA须在正式采用时由经营/编导统一，不能混入本片。

M1：旧同task run `14a815e3996abb4` HeyGen `social-presenter-e41327dee7e91ef82314c313`，provider task `7ef8a9d6a47e30f4bf6f5a1cf3589bbc`；4.6498s；SHA `84f55b1b9bdc7e97580222400dafccad18f7307706b737f1736378585ec7eebb`。原request fingerprint `social-presenter:332609530994fc620d7ebb5dfd2b74e97aa0e65831d947ecf09120c37e4121d9`，人物assetVersion4。旧媒体复用，不计本run新生成。其口播提交文本与旧shot1匹配，但已付费不等于本轮口型、权利或创意通过。

M2：RS001原图 `data/media/tenants/<tenant>/rongshang-products/rongshang-product-01.png`，158396字节，SHA `c9673dc0eb6fc0be4dff188ae7a23c520dcfc07054e71f483d666a7608178548`。只有正面原图，没有背标、开盖、真实泡沫/使用/工厂图；禁止裁一个正面图后标为背标或使用证明。owned/tenant登记不自动证明第三方处理及广告用途的签署权利。

B1：尚无真实Seedance/Seedream结果。拟生成4s/720p/9:16/无音频的产品hero：保护M2形状、颜色、标签和产品位置，中性背景、轻微推进/光线变化；禁止手部接触、泡沫功效、工厂/客户/证书。首帧QA→真实供应商receipt→下载hash→身份及动作QA通过后才替换B1位置。使用现有exact_source_pixels保护路径；不把参考原像素上传模型。模型/报价沿当前权威方案，由执行Agent核当前账号quote，不沿用历史公开价格。

M3：72.96s HeyGen SHA `2159dd010771d14a7421935ed7396d91bbca7531665316b76ba11026eb681a15` 暂不采用。其分析时间线重叠/空档失败；完整提交台词与本修订未建立逐句对应，不能任意截38秒或倍速压缩。旧36.67s说明卡成片同样不作为B1或新版成片。

## 推荐24秒 / 8镜英文预排

时间均为成片时间，不套用参考ASR到M1。S01暂分配4秒给新短镜A1，仅作预排，不是尚未生成的真实时长；新语音probe后由编导重排边界并保存新manifest，不强拉伸凑秒。各镜字幕是精确拟用文本；所有新版配音均是拟稿，没有目标人物/音色的新生成证据。

| 镜头 / 时间 | 精确英文屏幕文本 | 拟用声音 | 画面、来源与缺口 |
| --- | --- | --- | --- |
| S01 / 0–4 | `Beauty brand owners:` / `stop guessing your next product launch.` | **新短镜A1**：`Beauty brand owners: stop guessing your next product launch.`；当前缺生成媒体 | 沿原授权人物/音色版本做新的自然英文短镜；不用旧M1配新词，不宣称店铺动作等价。旧M1不进入高质量候选。 |
| S02 / 4–6 | `GUIANFA` | `Meet GUIANFA.` | M2清楚整包，单次切入，保留真实标签像素。F1品牌；不用系统说明卡替代产品。 |
| S03 / 6–9 | `Cloud Foam Makeup Remover` / `100 mL` | `A hundred milliliters.` | M2正面轻微推近，F1类别与容量；工作译名正式采用前核对。不假造另一视角/质地。 |
| S04 / 9–13 | `A closer look` | 无新口播，授权BGM短桥接 | **B1真实生成hero位置**，4秒。真实回执及QA未齐则该镜未完成；不以静物动画填充后声称MVP完成。 |
| S05 / 13–16 | `Product: GUIANFA-RS-001` | `Explore this product.` | M2较小整包+SKU，F1采购识别。SKU文字是图外信息，不伪装包装印字。 |
| S06 / 16–18.5 | `Your market. Your requirements.` | `Tell us your market and requirements.` | M2保持，采购需求文字F2；属于询问，不保证流行/销量/定制能力。 |
| S07 / 18.5–21 | `Let's discuss a cleansing product quote` | 无口播，音乐短过渡 | M2构图为CTA过渡；F2/F3询价，无价格/MOQ/交期保证。 |
| S08 / 21–24 | `DM us for a private-label cleansing quote.` | `DM us for a private-label cleansing quote.` | M2清晰整包，精确task CTA，不添加Messenger账号/虚构二维码。 |

S02–S08是拟稿，没有新声音或B1生成证据；S03/S08真录可能超过预排，先测自然语速，再由编导缩写同义非事实文案/调整总长至20–24秒，不能截尾或极端加速。S07可与S08合并字幕呈现但保留连续语义切点。当前只有类别、容量、品牌足够稳妥，不延长为38秒以堆重复图；此稿缺强产品差异卖点，不预先声称高转化或创意通过。


### 已执行本地免费时长探测与字幕落地

2026-10-11 使用 macOS Samantha `/usr/bin/say -r 160` 逐句生成任务外临时AIFF并用FFmpeg读时长，输出 `/tmp/mvp-voice-timing-UFHD3Y`。这是系统声音的预排参考，**不是目标HeyGen音色的准确生成时长、真实供应商回执或最终口播**；原始权威媒体不改动。正式目标语音仍必须probe/听验，不把下列测量套成目标音频词级时间。

| 镜 | 最终拟用口播 | 本地完整文件测量 | 槽长 / 剩余空间 | 执行决定 |
| --- | --- | --- | --- | --- |
| S01 | `Beauty brand owners: stop guessing your next product launch.` | 3.49s | 4s / 0.51s | 新短镜A1完整句，开场不追加停顿/口播，生成超过4s则重排，不加速嘴部。 |
| S02 | `Meet GUIANFA.` | 0.86s | 2s / 1.14s | GUIANFA读法需品牌/目标声音听验，不能因为系统读法短就直接认定正确。 |
| S03 | `A hundred milliliters.` | 1.26s | 3s / 1.74s | 产品英文名屏幕呈现，不在3秒内同时朗读长名称+容量，解决超时。 |
| S05 | `Explore this product.` | 1.27s | 3s / 1.73s | SKU只做采购识别文字，不读“RS zero zero one”，减少僵硬感；无新增功效。 |
| S06 | `Tell us your market and requirements.` | 1.99s | 2.5s / 0.51s | 独立自然短句，留换气；实际目标语音过长则借S07空隙，字幕相应新manifest。 |
| S08 | `DM us for a private-label cleansing quote.` | 2.41s | 3s / 0.59s | 精确当前task CTA，不追加重复结尾，不冒读不存在的账号名。 |

S04和S07无新口播；其余新句合计本地测量11.28s，不代表所有音频拼接后已生成。S07保留询价屏幕过渡，S08才完整说CTA，避免连续两次重复询价。非人物镜头新旁白可一次生成整段（句间停顿由真实音频测量后对齐），无需为每个视觉切点提交独立TTS订单；A1人声是否可同时承担片外旁白需目标端口/报价证明，不能假定收费免费。严禁把免费系统声音冒作最终授权品牌音色。

720×1280布局预排：有效区域x=58–662、y=154–998；标题优先y=170–285，字幕基线区y=845–980；商品主图控制在y=320–810，M1/A1人物脸部无遮挡。S01上标题 `Beauty brand owners:`，下方两行 `stop guessing your` / `next product launch.`，完整句意而非假卡拉OK词级高亮。S03上两行 `Cloud Foam` / `Makeup Remover`（44px），右下短标 `100 mL`（40px），不把文字烧到产品标签上。S05采购编号 `GUIANFA-RS-001`（36px），人物口播字幕仅 `Explore this product.`（44px）。S08两行 `DM us for a private-label` / `cleansing quote.`（44px）；300px缩略读验后必要时使用更宽留白或适度增字，不靠缩小到不可读塞满。文本白色/深色高对比、轻描边或半透明底，字体必须授权。上述坐标是制作提案，需实际帧/OCR/手机尺寸截图验证，不声称已有真实页面验收。

### 长口播不能提供本版免费的完整英文短句

只读代码 `server/starter198/socialContentDigitalPresenterAdapter.ts` 中stableKey包含script与visualControl；execute当前取 `baselineScene.narration || voiceover || script || caption`。权威baseline39第二镜narration/voiceover为空，script是中文导演动作描述、negative prompts和参考首帧路径。以原tenant/task/shot/person资产数值version4、原job.visual_control、空profile/consistency、provider heygen、该script原文按adapter字段顺序重算SHA，精确命中72.96s job的 `social-presenter:393b51832d103a1037c87c8248bb0d045997d0472b8e44051c5425545a440c86`。这证明当时提交的是导演指令串，不是当前新版自然英文配音稿。

原receipt与hash证明文件可恢复，不证明台词适用。没有可信目标音轨的英文句子ASR/词级边界与本版文本对应，所以**不从长片剪出本版口播**，不使用参考视频sourceWords替代该长片timing。S01必须新短镜；S02/S03/S05/S06/S08必须新旁白或正式有权录制，Q_audio计入预算。正式生产前还应由实现负责人修复“空spoken取导演script”的准入问题，本次只记录证据不修改主实现。

参考38秒不是新片强制时长。原task固定预算/目标不等于授权静默改变旧single_source_fidelity脚本；正式采用20–24秒/8镜改编必须由经营/编导保存新制作版本及fidelity偏离说明。若业务权威版本明确要求38秒，记录该冲突，补足真实信息/合法资产后重新编排，不能用静物填时间。开盖、真实泡沫/使用、背标、其他角度及工厂资料当前均缺，不纳入镜头。

## 原hook语法与口型处理决定

原句 `based on only on guesswork` 有重复介词，影响英语专业感；M1可以作为工程复用审查素材，尚不推荐直接作为高质量发布版。推荐发布候选新句为 `Beauty brand owners: stop guessing your next product launch.`，但这是**新脚本输入**，需要新人物生成或有权使用的重新录制；不能配该新句到旧口型。当前禁止付费，因此不执行这个动作。

**高质量候选不保留原语法错误来省成本。** 旧M1保留为不合格候选及恢复/账单证据，不删除，不纳入本表S01。没有新A1时此制作包保持未完成；如内部需要复用工程审查，另导出明确标缺陷的原声/原字幕草片，不“润色字幕”遮掩。当前baseline.sourceWords标的是参考视频的qwen_filetrans时间，不是M1音轨的词级测量；即使提交句相同，也不能用参考时间剪掉第二个on。若后续对M1取得可信词级测量并独立听验，可考虑切产品B-roll覆盖画面切点，但必须实际证明剪后语音连贯/无音节截断；在此之前不假切。更改字幕/台词需要新版本，不能冒称baseline39未改变。

## 声画制作规格与可自主准备项

720×1280、25fps、H.264/AAC48kHz，20–24秒目标，优先24秒预排。新生成与旧M1统一色彩和响度；M1原测mean −23.4dB、peak −6.3dB，不直接以平均音量当LUFS。按实际响度测量尝试−16 LUFS综合、true peak≤−1dBTP，听验后决定，BGM duck到不影响词义，不使用不明授权音乐。S04保持无人物口型音轨。

字幕预留左右8%、顶部12%、底部22%作为本次保守工作安全区，正式平台规则另核；最多两行、对比充足、不能挡脸/包装，长CTA需实际手机尺寸读验。镜1只做可审查短语字幕，不能造逐词同步。转场以硬切为主、少量100–150ms淡切，连续时间线从0到最终probe确认的20–24秒、无间隙/重叠；不以多次近重复裁切伪装更多素材。

可自主完成：原媒体hash/解码与抽帧、英文拟稿、scope/文件映射、首帧保护技术预排、声音测量、时间线和字幕布局检查、既有资产复用adoption草案。任务外审查输出必须注明 `old-media reuse / proposal / B1 missing / creative unapproved`，且不写入canonical artifact或humanConfirmed。原产品图和M1不变更。

## 预算、调用及恢复

task总预算¥10，制作¥8.5、返工预留¥1.5。本方案新增动作严格限于A1一条短数字人镜头+B1一条4秒产品hero（可用保护后的自有首帧时不新增首帧付费）。有效价格核验后记录 Q_A1、Q_B1、可选 Q_firstframe、其他配音/ASR Q_audio及已有成本 C_existing；制作准入必须 C_existing+Q_A1+Q_B1+Q_firstframe+Q_audio ≤ ¥8.5，同时保留¥1.5返工并满足总累计≤¥10及分项池授权。报价缺失不填猜测值，不宣称足够预算；超限由内部先减去非必要额外生成，不能降级A1错误英语或拿静物替B1。原HeyGen及ASR实际账单未核，不把旧媒体成本清零；legacy reserved账本不是实付也不是供应商硬限额。A专属¥5不能划给B。当前B专属quote、余额、stage grant和当前预算池未齐，管理员/执行Agent负责核实；本轮禁止付费，技术准备不代表准入已过。

正式采用建立新的scope/version及每镜fingerprint：tenant/task/new run、事实v5、脚本/字幕hash、M1原receipt/fingerprint/SHA与adoption、M2 SHA、首帧SHA、B模型/参数/提示hash/4s计费时长、voice/person版本和授权来源。预算前置扣除/预占按原幂等请求，unknown只查询原provider task；下载失败重试原结果，不重新POST。B身份失败仅返工S04，累计预算不重置。新hook输入另计费用并占同池，不能凭改变requestID绕过原预占或unknown。

## 验收门禁与交接

技术：逐资产hash一致、媒体完整解码、最终20–24秒时间线连续、8镜均被检测、无黑帧/异常静音/字幕截断、音画同步和CTA可读。使用现有inspectRenderedVisuals/inspectRenderedScenes及音频检测，不能把固定passed注入作为此片证据；128镜新上限不代表旧失败片自动通过。

独立创意：首秒人物与诉求可辨；第三秒理解B2B选品问题；9秒内清楚是哪一件产品；B1产品标签/形状不漂移；无不支持的工厂/功效/销量等事实；用语自然、口播连贯、节奏不靠重复图灌时长、CTA只一个。缺A1/B1或原hook语法未改善应明确建议修改，不能默认可发布。人物口型需动态带音审核，抽帧仅证明可见结构，没有真人批准。

业务：通过正式G4/G5、事实v5与新脚本/媒体sourceHash绑定、独立初审和有权限内部人的最终创意验收记录。三栏工作台显示同task/new run/version、完整脚本/素材/逐镜实际进度，以及预估/预占/实付分别展示；未知账单不补零。此proposal不是这些记录。

发布：当前无本租户正式TikTok账号绑定，allowRealPublishing=false；不发布、不借其他租户账号。真实B镜头、修订版自然英文hook、人工创意审核及正式平台回执缺任一项，完整MVP仍未完成。
