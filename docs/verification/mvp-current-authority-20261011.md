# 当前 MVP 权威快照与统一执行建议

读取时间：2026-10-11 06:35:21 UTC / 14:35:21 Asia/Shanghai。只读核验；未修改原工作树、业务记录、授权、账本或人工验收，未调用供应商、发布或部署。

权威本地根目录：`/Users/julia1/.codex/.chatgpt-projects/g-p-6ac46f113a0c8191968cd499b8c020f6/local-integrated-flow`。以下是本地持久业务证据，不是生产数据库。实现试点 fixture 数据不参与选择。

## 唯一推荐 scope

推荐继续当前已有单条社媒任务；A/B/C 采用同一个 task 的正式版本与新冻结执行包，不能拼接旧候选，也不能把旧 run 的媒体冒称新 run 生成。

| 字段 | 当前记录 |
| --- | --- |
| tenant | `local_tenant_customer_1b2913131e2c46deab66172228c4df0a` |
| company / product | GUIANFA美妆供应链 / `GUIANFA-RS-001` 云朵泡沫卸妆蜜 |
| social task / record | `socialtask_e4f1688c319adfc5397fc4ec` / `starter_social_content_tasks_694cc0bbf4394a3fa04b861c5185b471` |
| current task version / status | `51` / `asset_review` |
| current run / workflow task | `5a7b4d34e5cf4da` / `531124265d74d6d`；两者 `waiting_external` |
| current execution job | `101d7abcae33425`，`succeeded`；只是旧本地制作完成，不代表创意或审核通过 |
| goal / plan | `397a99d7ca3f651` / `b0b876bbacbd398` |
| platform / language / ratio | TikTok / English / 9:16；尚无正式发布账号绑定，`targetAccountRef=null` |
| presenter | 销售睡衣版 / `presenter-f281e943169413c9b5525072`，assetVersion `4` |
| provider avatar / voice | `c83918263eea8d3670a0f8c11e52809d` / `bb17551cd3714310bcfd5dab31ead2c7` |
| Studio companion | `studio_projects_b504f9321cf64a6bbba81222b74e0ac3`，spec.socialContentTaskId 明确指向本 task；workflowRunId/taskId 空，不能当完整冻结绑定 |
| current enterprise facts | `enterprise-facts-v5-e9838185570f`，revision `5`，SHA `e9838185570f8b748135a78c670d35c569fc36032aa298b2c3944d0af0ab65c6` |

Studio companion selectedProductIds/productInfo 为空，CTA 显示 Messenger，而正式 task CTA 为 `DM us for a private-label cleansing quote.`。经营/编导必须在正式重制版本统一这些字段；本审计没有替用户写入。当前旧成片的事实版本为 v2，不能以其替代现在 v5。

## 旧 A/B 报告的适用范围

20261011 A/B 报告描述的是重置前快照。当前 studio_projects 有 8 条，旧 `b251759…` 与 `1f987e…` 均不在当前集合。企业 profile 已确认美妆行业、GUIANFA、北美 B2B 美妆目标和产品选择；照明企业与护肤目录冲突已在当前持久记录解除。allowGeneratedVisuals 当前为 true，旧报告 false 已失效。画像配置是 b2b_launch/b2b_starting，但当前 employee config operatingMaturity=growing、assessment.answers={}：真实“零基础”经营历史仍未独立证明。

当前 `studio_projects_8d273cba26344d8bbf3234ba1d0d545d` 是另一批次 RS-001 / YouTube 草稿；其 workflow run `workflow_runs_1c740048e6074d9789726a53ad57efef`、task `workflow_tasks_1a38554ee7c54840837f6c224dfafa44` 均 cancelled。禁止把它和本 task 的 TikTok媒体直接当同一scope。

旧 A Zihan、旧 B RS-014 / 5.10–5.97秒镜头、旧 33.58秒参考均不属于当前推荐制作包。旧报价仅作历史资料，不证明当前订单价格或授权。

## 参考与产品字节

参考记录 `trend_videos_31733a08ae1142a0a636ff48d03991f8`，来源 `https://www.tiktok.com/@yuchengcosmeticsfactory/video/7693862311907396877`，38秒。

- 权威根相对路径：`data/media/tenants/local_tenant_customer_1b2913131e2c46deab66172228c4df0a/reference-videos/trend_videos_31733a08ae1142a0a636ff48d03991f8.mp4`。
- 实际读取 3,065,569 字节，SHA256 `18c7f2ba2ff769378a8e410551128e1314ff7bf01c1e5a35c4c5d07dbf28c9e1`；与当前分析来源 hash 相符。
- Source `socialsrc_ebf8cd6a8d6703ce1a6ab8ca`：仅分析镜头功能、节奏、钩子和转化结构；源记录 source_version 空，正式包必须冻结上述字节 hash及分析版本 `3096c359761d`。原人物、声音、文案和品牌不得复制；原视频像素不进成片、不默认上传模型。

产品原图相对路径 `data/media/tenants/local_tenant_customer_1b2913131e2c46deab66172228c4df0a/rongshang-products/rongshang-product-01.png`，实读 158,396 字节，SHA256 `c9673dc0eb6fc0be4dff188ae7a23c520dcfc07054e71f483d666a7608178548`。

可用确认事实：产品名称/SKU、卸妆类别、100ml、货盘记录；价格及卖点必须引用当前产品资料，避免把零售表价格当 B2B报价。工厂研发/产能/认证/MOQ/交期/客户案例没有证据则不用。产品图片登记为当前租户上传、owned、tenant用途；登记不能自行扩展为已完整证明第三方模型处理和公开广告用途。

## 已有媒体与复用边界

两段真实 HeyGen completed receipts 在同 tenant、同 social task 的旧 blocked run `14a815e3996abb4` / job `2a2739fad1389f3`。为避免抄录错误，正式复用应按下列 providerTaskId/request fingerprint查询原记录。

| material / provider task | 实际文件字节 / SHA256 | 记录时长 |
| --- | --- | --- |
| `social-presenter-e41327dee7e91ef82314c313` / `7ef8a9d6a47e30f4bf6f5a1cf3589bbc` | 1,872,862 / `84f55b1b9bdc7e97580222400dafccad18f7307706b737f1736378585ec7eebb` | 4.6498s |
| `social-presenter-1021fbfe9ffa25f6e5bf1141` / `0494d2456d66c846b32fe8ee1272c5da` | 28,846,171 / `2159dd010771d14a7421935ed7396d91bbca7531665316b76ba11026eb681a15` | 72.96s |

路径在权威根 `data/media/object-storage/materials/tenants/<base64-tenant>/<materialId>.mp4`，两个文件的流式SHA均与正式receipt一致。优先人工/技术检查4.65秒钩子片段；第二段异常长，只在台词、音画与用途匹配时裁取。不得重复提交相同输入；按原 fingerprint、人物版本、scope、SHA记录正式复用 adoption，原成本不清零。当前冻结script_baseline.version39和replication_script.version1791682349667的shot1台词为 “Beauty brand owners, stop launching products based on only on guesswork.”。原provider job `studio_social_presenter_jobs_373eb0835258487ab657dd7e2b85140a` 绑定shot `replication-reference-shot-1`，fingerprint/request ID `social-presenter:332609530994fc620d7ebb5dfd2b74e97aa0e65831d947ecf09120c37e4121d9`。按现有adapter stableKey的原字段顺序，使用该台词、assetVersion4、原持久visual_control、原tenant/task/shot/provider、空profile/consistency、operationId undefined重算，精确命中该fingerprint。这证明原提交文本与当前冻结shot1一致；job仍未保存完整请求正文，实际声音/口型须UI听验收。可优先保留原音轨配该原句，不能更换句子/修正重复语法后沿用旧口型。原人物/居家背景与参考美妆店/展厅动作不完全相同，不能把文本相同当强动作复刻通过。人物 defaults 记录成人确认、HeyGen/Ark处理授权与 digital_presenter/voice_synthesis/person_replacement用途、声明/consent引用；本审计只验证字段及同租户绑定，没有独立读取底层签署文件，引用已脱敏。

同租户材料共85条：2 HeyGen、66 system_safe_motion_graphics、8 Pexels、7 TikTok参考、1 tenant_upload、1 local_compositor。没有真实 Seedance/Seedream 关键镜头记录。说明卡、Pexels库存和参考像素不能替代必须真实生成的关键 AIGC 镜头。

已有候选成片 `socialart_c8024da489b01a203354128e` / file `socialfile_fc41facffbfde917e05c8d3e`：36.67秒，实际7,126,617字节，SHA256 `54335eaa40b60ea4437f6ff3d07552f50fd91096ca1731906b41e0c21108fc25`，本地文件已验证。路径为 `data/media/object-storage/social-content-sources/tenants/<base64-tenant>/<SHA>.mp4`。status=review_required；technical scenes失败（37镜超过32检查上限）、replicationEvaluation.failed、archive quality=repair_required。由说明卡/产品动效构成，不等于已融合真实HeyGen；不能批准或发布。

## B 具体关键镜头审查方案

只使用上述同租户RS-001自有产品原图（冻结原图SHA），制作一个**非事实产品hero镜头**：中性无标识摄影背景、正面包装特写、稳定产品位置、轻微镜头推进/光线变化。不使用外部参考原像素，不加入工厂/产线/实验室/证书/顾客、功效演示、手部取用或夸大承诺；不得改产品形状、颜色、标签文字。此镜头承担产品身份展示，不称工厂实证或原参考动作等价。

建议沿现有Studio分镜首帧→单镜视频入口：首帧模型 `doubao-seedream-5-0-pro-260628`，单张9:16原生1152×2048、仅自有原图输入，优先现有exact_source_pixels产品层保护；若现有正式门禁判定可直接使用自有首帧，则复用经过QA的本地产品像素合成，省去图片付费阶段，不能绕过首次首帧身份检测。视频模型 `doubao-seedance-2-0-fast-260128`，4秒、720p、9:16、无音频；现有Studio适配器firstFrame存在时 `generate_audio=false`，4秒是供应商生成时长，成片可裁取2–4秒，不用裁剪时长计算费用。模型/提示词由执行Agent决定，账户quote由专职Agent只读核验，不把公开价冒称订单价。

冻结输入包含原图SHA、首帧SHA/版本、提示词hash、模型/baseURL、ratio/resolution/providerDuration、generateAudio=false和统一scope。提交前核当前报价、账本剩余与实际已发生费用；同pool累计，unknown恢复原provider task，不换requestID再POST。产品身份/标签/形状或运动失败只返工这一镜，并保留原预算预占。无真实B生成回执时只能保留本地审查草稿，不能报告完整MVP通过。

## 预算、授权与账号

当前 task brief 给出全片¥10，其中制作¥8.5、返工¥1.5；本轮用户明确要求完成MVP、allowGeneratedVisuals=true和当前brief可作为范围制作授权依据，不因缺通用authorization JSON重复审批。同范围内的供应商/模型/提示词选择由Agent负责。不能把旧 A ¥5专属口播预算挪给B，或把制作授权扩大到公开发布/生产部署；本轮仍禁止付费和外发。当前 legacy admission账本 limit¥41.88、reserved¥31.88、剩余预占空间¥10，8项（7 HeyGen、1 ASR）；是预占账本，不是实付账单，也不是供应商硬限额。旧 blocked job记录下一镜因预算不足被拦截。配置预算变量存在，但A/B分项池默认目录不存在，没有发现当前具体B stage grant与真实quote的持久证据。

现成片 recordedProviderCostCny=0只统计其本次已记录媒体调用，不能抵消旧 HeyGen生成支出；真实账单需要原taskID核账。旧A余额/公开价格为20261010历史预检，本审计未外部刷新。B账户专属报价、余额与可执行预算分项仍未证明。通用B pool缺失是当前对应付费入口技术准入未齐，不是要求用户再次授权同一制作范围。无需客户选择模型；当前价格、账单与硬预算控制由管理员/执行Agent只读核查，确实超预算或用途权利缺口才统一例外处理。

allowRealPublishing=false；social_accounts只有另一租户的Facebook测试账号，当前租户没有正式 OAuth账号。不能借账号、不能将 local-tiktok规划ID当正式发布权限。制作、人工质量验收、发布、部署授权相互独立。

## 可执行统一方案及需要人的例外

经营/编导内部先冻结当前 task的正式重制版本及Studio companion投影，以8–12个语义镜头形成精简英文片：已生成数字人钩子→真实产品原图/包装事实→一段与RS001身份一致的关键非人物镜头→单一private-label CTA。参考结构只用于分析，不复制原文案/人物/像素；删去无法证实的工厂和功效承诺。8–12镜是推荐改编，需独立创意标准，不能伪称与38秒37镜原片完全等价。

立即可继续：本地验证现有媒体字节/解码、台词/人物/音色/口型、产品事实与声明引用，冻结镜头fingerprints、原attempt复用合同、有限重合成草稿、技术QA、三栏过程页面及费用区分。不得将此有限草稿称为完整MVP通过。

需要人的真实例外：有权限业务审核员完成最终人工创意验收；必要权利的权威签署/用途依据由内部业务负责人核验；管理员核原HeyGen账单、当前quote与硬预算控制，预算入口未齐由内部负责人准备具体执行包，不重复索要已经有效的制作范围授权。正式账号/发布授权由账号负责人提供；本轮禁止外发和付费，未要求客户承担模型/提示词/跨Agent协调。产品归属冲突已解除，不再重复询问旧三选一。

## 源快照 SHA256

| 权威根相对文件 | SHA256 |
| --- | --- |
| `data/local-store/studio_projects.json` | `f1cbda18032c7e521d55c341c6cd6b9e95cd5c4e263b36fb3c3adc7ce4ce22e5` |
| `data/local-store/tenant_profiles.json` | `405e095df5e52893153dcde73efc6afd5f97ed883e447feabfd8cbc85d13e415` |
| `data/local-store/workflow_tasks.json` | `cc3683c8d69fc951be680167a70064b74d911295bc4922cd032125f2cf079fc6` |
| `data/local-store/workflow_runs.json` | `c16567e65355879410b0866853ccf1761f08007722821e56dfc5e9e6b738d611` |
| `data/local-store/studio_production_defaults.json` | `7b867f5bdc4fe8b4b0ca075f857d0eacd5e053ee0fffa6bbe487dcaa92b629fe` |
| `data/local-store/starter_social_content_tasks.json` | `177269a2948719c21b1965a9894cafce5a3738135b0a5393d86012fc5c753a18` |
| `data/local-store/starter_social_content_artifacts.json` | `aa4bb7f902c2454a2d336597a1eb77748cf74eb966b5e558dba6c1d1b491536d` |
| `data/local-store/starter_social_task_sources.json` | `317e8e4a99f4fb609026ba2fdc81af8fa8c9d833929ccdd025fe6a552bc6497b` |
| `data/local-store/social_accounts.json` | `bcaeafe5c2065cd3c2e24a20027cad6a180af7a52bc8a353a3b7d532e12f9734` |
| `data/local-store/digital_employee_configs.json` | `eb6fceac2f51ca9c36750eca099fe6be90c990418a35cbda63b613901cd1fffb` |
| `data/local-store/content_execution_jobs.json` | `5978893a1ad3e56aaa07bf43b376f3da65b7f723379a1e3e25cddfd1e976bd0a` |
| `data/materials.json` | `87058a40a3e6238b19acfaa8c4c37432f32032a4b329e1c7a5e2d41358ba4d20` |
| `data/studio-paid-budget/ledger.json` | `c5e46f42e29991995a7a8a2a5d662cf4ae0e1f9a5c139e3871d0fdddaad27a36` |
| `data/local-store/studio_social_presenter_jobs.json` | `a9169ba4a15a5ce6c63812646df9caf0750162581230e80da084899c98cb9944` |

### 实际修订接入后的状态

上述快照属于修订前证据。2026-10-11 正式执行修订接入命令后，原 task 当前为 **v53 / asset_review / run 为空**，保留有效 `_productionRevision`。旧等待运行已由 prepare 围栏取消；旧媒体、供应商回执和审核记录仍保留。

原产品正面 PNG 已通过正式文件/素材/任务来源入口登记；文件记录为 `starter_social_content_files_64d3dc75d5ed4702934c8d2a639cca7a`，usage=source，SHA256 `c9673dc0eb6fc0be4dff188ae7a23c520dcfc07054e71f483d666a7608178548`，与原字节一致。新运行启动被 `social_content_task_not_startable` 拦截：素材来源登记将 prepare 的 attention 状态重算为 asset_review，旧公共启动门禁不接受此状态。恢复须从当前 marker/版本继续正式 start，不能重复 prepare/intake。

当前仍显示旧 37 镜 baseline；新的 8 镜 baseline 与新 Graph job **尚未冻结**。未 dispatch worker，未产生本轮新付费生成、人工创意审批或公开发布。实际接入日志与只读后检为任务外 `work/mvp-final-recheck/revision-execute.log`、`post-execute-preflight.json`；备份位于同目录 `backups/`。`cc5e387` 已修复冻结分镜供给合同投影，但启动状态恢复仍在验证，不能把代码测试通过当作当前 MVP 成片通过。

随后正式恢复启动成功，取代上述中间状态：当前 **v56 / run `5cfd395dcace5f0` / Graph job `bce9542ffe0db4a` / 8 镜**，修订 planHash `86c960361e86e96defab66a4c90768cd137ef22a6e697c109fdb70125fadc603`。执行回执为任务外 `work/mvp-final-recheck/execution-receipt.json`；未 dispatch worker、未付费生成。Studio 新草稿接入遇到 `formal_business_identity_changed`，尚未创建，正在核对实际运行集合与身份 schema。新 baseline 冻结成功不等于供应商媒体完成或创意审核通过。

后续 Studio 草稿已真实创建：`studio_projects_6021eb6c405b44b295dd323827b89094`，同 v56/run，8 镜逐镜 fingerprint 读回通过。此前身份报错来自环境加载前间接初始化存储，已经修正，并非运行集合名称错误。实际创建日志为任务外 `studio-create-execute.log`。

原音色 Starfish hook 已进行一次真实提交，供应商返回成功并归档原音轨与完整响应。内部回执 `bc31aa16e075e35724f0608d94387445ecc7b2a55c4a13b5c4b0b3eb468b888e` 为 accepted，供应商 request_id=null（官方允许），报告时长 5.485714285714286 秒。真实音频 probe 超过本次 4 秒 hook 上限，因此未标 completed、未驱动 IV 视频。不能因该验收失败重复 POST；当前进行原音轨时长/静音分析。实际费用尚无账单证据，不能填 0 或把预算预占当已结算。未发生新的数字人视频生成、人工创意批准或发布。

### 自然原声重新定时与单任务恢复（当前状态）

正式修订执行回执 `work/mvp-final-recheck/retimed-execution-receipt.json` 将任务冻结为 **v61 / run `f865c9796bdddc6` / Graph job `f7481cbe9d3da8f`**，planHash `1b36d5febf7c56573f540aa3e610d380d60582dcda3d6b5ead9d9cfb34abcae6`。保留完整自然 hook，S01 为 5.6 秒，S04 为 4 秒，总片 24 秒。旧 v56 job 已正式取消；原供应商记录不改写。当前 Studio 草稿为 `studio_projects_fef2bd29da1142a2bf9a79b48a8dad71`，创建与读回证据 `studio-retimed-create.log`。

`adopt-natural-hook-execute.json` 证明完整原声已通过正式复用入口绑定当前 v61/run/person/voice。新复用回执 `7570f4f65226601f1b67657d4366521b5ca013c2aa03d85cbafe6ce8a73a0b6d`，probe 5.485729 秒、媒体 SHA256 `72e4c5ffcf72b2625cfdd459b279c622cf4a83e5f2ff0705440ddb0e977b32c3`；paidCalls=0、新 TTS 预占=0、原 accepted 回执保持不变。此证据证明音频复用，不证明数字人视频完成。

总授权仍为 ¥10；正式从返工分配移入 ¥0.9 后，制作 ¥9.4、返工保留 ¥0.6。A池 ¥4.3、B池 ¥4.6、独立质检分配 ¥0.5，均非实际结算账单。Ark 当前账户模型价格/余额原始 DOM 与截图已经保存在 `ark-pricing-evidence/`，Qwen 所属 Dashscope 的账户费用仍需单独核验，不使用 Ark 余额替代。

可信 worker 新增 `allowedJobIds`，只认领及恢复指定 job；全局并发仍统计其他正在运行的任务，空列表不操作任何 job，构造时复制列表避免后续扩大范围。`scoped-worker-tests.log` 18/18 通过，包括其他租户排队任务和过期 running 任务保持原状态、空列表拒绝执行。真实 Graph worker 尚未 dispatch，须先完成 S01/S04 供应商媒体及绑定质检证据，再使用当前原 job 恢复。尚无本轮最终成片、人工创意批准、真实发布或指标闭环证据。
