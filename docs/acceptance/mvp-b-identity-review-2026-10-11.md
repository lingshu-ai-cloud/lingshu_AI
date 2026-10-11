# 会话 B 统一身份复核与条件镜头方案

核查日期：2026-10-11（Asia/Shanghai）。规则基线：5bd6708，第 11–12 节及 AGENTS.md。仅读取权威业务记录、A 报告及 A 最新聊天；未改业务记录、未提交媒体请求、未提交 Git。

## 结论

B独立复核与A提交99eb1df一致：uniqueExecutableCandidate=null。b251是唯一可追溯的workflow候选；1f987不在当前local-authority记录，RS-014首帧禁止默认使用或拼接。企业事实、经营画像、生成授权及账号身份冲突尚未消解。业务负责人须选择“授权b251护肤MVP / 改用照明产品 / 独立护肤tenant”之一；经营和编导冻结新包之前，RS-001只属条件镜头草案，不能执行。

## 权威身份

| 字段 | 已读取记录及结论 |
| --- | --- |
| tenant | local_tenant_customer_1b2913131e2c46deab66172228c4df0a |
| project | studio_projects_b251759707fa43a499a5dc48f070843f，studio_projects.json；draft |
| goal / plan | weekly_goals_fb391d9625644f26bcc956c0dd71d3aa v1；weekly_plans_7b3d362d7fa6489993ad2f6de492b7ec approved |
| run | workflow_runs_4f7c1a1b054146b3925ad0aac87b308b，waiting_human |
| task | workflow_tasks_4d563d4969114a51b1cb31aa1a93a953，task_version=9、correction_version=8，failed，business_refs 指向 b251 |
| lineage hash | cabcf191bd1320b30c6fa8201850a96426387c20dd37454e3867b014b5720b12（记录原值，未把它当作所有事实当前有效证明） |
| assembly / content | video-1；content_order_1::en；ba298763-d937-493b-aa01-eb6ca2aea024 |
| account | contentOrder.accountId=local-tiktok-local_tenant_customer_1b2913131e2c46deab66172228c4df0a，label=宏昱智能光学照明。social_accounts.json 未有本 tenant 的真实 OAuth 账号记录；不能借另一租户账号 |
| product | selectedProductIds=[GUIANFA-RS-001]，云朵泡沫卸妆蜜；B 不用 RS-014 |
| facts | tenant_profiles.json：enterprise-facts-v9-88565ce43ae0，revision9，contentHash=88565ce43ae0847b267f69955ce97102a0b027214bc25c80d262ef01ad74d000 |
| config | digital_employee_configs_9691fd7375964ac5a038830c0fcb6621 v1，facts_version=8056d48b71b94e20513c50a5，allowGeneratedVisuals=false、allowRealPublishing=false |
| spec hash | 当前 spec 按 Python json.dumps(ensure_ascii=False,sort_keys=True,separators=(逗号,冒号)) 的 UTF-8 SHA256：a41096c47727ac52c69713abded7e87187b290d10599698a8d4c710cced99a86；仅审计语义快照，不是服务器执行 fingerprint |

明确冲突：当前 company.name/description 是照明企业，routeStrategies 的买家是越南灯具经销商、工程采购与设计承包商；products.items 却包含护肤目录。goal 是护肤工厂研发、生产和质检能力验证。config 仍绑定旧 company=11 与旧 facts。不能把账号标签改名便视作冲突消除，也不能凭 profile 的 b2b_launch / config 的 starting 认定零基础已核实：operatingAssessment.answers 为空，缺实际画像问答。

## 参考、产品字节及权利

参考 trend_videos_192e76d4b21244c4a2922e60672c95f2，来源 https://www.tiktok.com/@yuchengcosmeticsfactory/video/7449962848203181354，33.58s。本次已确认权威目录实际存在 data/media/tenants/local_tenant_customer_1b2913131e2c46deab66172228c4df0a/reference-videos/trend_videos_192e76d4b21244c4a2922e60672c95f2.mp4，SHA256=501ec2c4d39ce67630448eff7001e2f911561e962533ca1bdb6aa10e6d2388e9。上轮因当时目录状态未定位物理文件的结论已被本次字节读取纠正。reference_only / mayUseInProduction=false，默认不向供应商提交原片像素或进入成片。

RS-001 产品原图 data/media/tenants/local_tenant_customer_1b2913131e2c46deab66172228c4df0a/rongshang-products/rongshang-product-01.png 实存，SHA256=c9673dc0eb6fc0be4dff188ae7a23c520dcfc07054e71f483d666a7608178548。project.evidenceSnapshot 的资产授权是 owned、scope=tenant、evidence=企业知识库当前租户上传。这是登记归属，不足以自行扩成第三方模型处理、改编和公开广告的完整授权；未取得有效授权人/用途/期限/撤销状态，不伪造授权。产品目录来源融尚货盘报价表，价格、功效与工厂能力不能由模型补造。

## 编导与素材 Agent 的自主方案

选择同项目 slot-2 / replication-5099cf72ca69f1efe3702806：原参考 5.10–5.97s，0.87 秒，固定机位双手持产品正面近景。这是产品关键镜头，不能称前三秒钩子。原钩子仍为 shot_1 的 0–5.10 秒玻璃门互动与向右移动人物；A 的中性背景问题口播是改编，须在统一编导版本说明钩子结构如何变化。

B 只改编展示方式：将原片灰盒与银袋替换成同任务 RS-001 实物包装，不搬原品牌、字幕、背景和声音。现 slot-2 storyboardSourcePlans.mode=local、localFlowTestOnly=true，不是已冻结真实 AIGC 路线。正式路由和计划需由编导/经营负责人修复并持久化到新的统一版本；B 不擅自更新业务记录。

条件模型选择：首帧使用方舟 doubao-seedream-5-0-pro-260628，1 张 9:16、原生1152×2048（2359296像素，约235.9万）单图；产品原图作身份参考。若可保留像素产品层，优先锁定产品原像素，只生成手部/中性背景层，禁止把标签重新绘制后宣称身份无损。确认首帧后，再由 doubao-seedance-2-0-fast-260128 作无音频图生视频，720p、9:16、最短可用时长，成片裁取 0.87 秒。实际模型/时长支持、原生路径预算及账户权限仍需预检；暂不提交。

首帧提示词草案：竖屏固定近景，只见双手及企业参考图中的 GUIANFA-RS-001 云朵泡沫卸妆蜜实物包装。产品正面朝镜头居中，双手从左右下沿稳定持握，不遮挡主标签。产品形状、开口、比例、颜色和文字严格以参考图为准，不添加另一件产品或把包装换为面膜盒。背景使用无标识中性摄影棚，柔和真实光线。没有真人出镜脸、实验室、生产线、证书、客户或功效演示。生成层不得改写产品像素。

视频提示词草案：固定镜头，首帧的产品与双手保持同一位置和接触关系，仅有微小自然持握运动；包装正面持续对镜头，标签不变形、不跳字。终态与起态相同。禁止开盖、泵压、挤出、滴液、旋转、拿取、手指穿模、增加产品、品牌和文字；无音频。原参考没有足够动作证据支撑上述新增演示，不生成它们。

局部返工仅限 slot-2：产品像素失真先修首帧，视频手指/接触/形变失败只重做此镜；不得重做 A 或已通过镜头。新输入版本/请求键仍累计同一 B 预算；unknown 恢复原 provider task，不新 POST。是否最终可采用由独立质检和 MVP 最终人工验收决定，不能自填 humanConfirmed。

## 官方公开计价与账号计价

2026-10-11 查询[火山方舟官方模型价格](https://docs.volcengine.com/docs/ark/model-pricing?lang=zh)：Seedream 5.0 pro 首张输入图免费、第 2 张起 ¥0.02/张；单图输出≤261万像素 ¥0.30/张、超过 ¥0.60/张；所以上述单输入单输出首帧公开刊例估算 ¥0.30。若额外输入构图图，则至少 ¥0.32；不能忽略输入图费用。官方规格页列出精确 model ID：[Seedream 规格](https://docs.volcengine.com/docs/ark/seedream-4-0-5-0?lang=zh)。

同一官方价格页列出 Seedance 2.0 fast 480p/720p 不含视频输入 ¥37/百万视频 tokens、含视频 ¥22/百万；75折活动截至北京时间 2026-10-07 14:00，本次不沿用已过期折扣。单张首帧属于不含视频输入。视频费用必须使用官方计算器/接口 usage 与实际输出尺寸、时长核算，不能将 0.87 秒剪辑时长当作供应商生成时长计费，也不能套用论坛每秒价格。

以上仅公开刊例：官方明确价格仅供规格参考、实际费用以下单为准。当前账户专属单价、资源包抵扣、余额、账单尚未核实，账号价格=unknown。B/全片预算和付费范围授权尚未给出；A ¥5 为数字人口播预算，不可挪用。未核账户价格与同一预算预占前停在计划阶段，不要求客户决定模型和提示词。

## 当前八项口径

本次未运行受控测试；读取历史合同结论不等于本次通过。未生成媒体、未付费调用、创意未通过、未发布、无平台回执、无指标回收；生产 ready:true 未核验。当前报告可供统一执行包审查，缺身份/事实/权利/预算时对应外部调用保持阻塞。
