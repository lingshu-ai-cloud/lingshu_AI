# 图文策划与首版生成故障恢复

适用范围：灵小枢图文复刻的持久化执行任务。先定位租户、内容任务、图片任务、执行作业和原始输入版本；不得仅凭页面文案判断供应商是否收到请求。

## 排查顺序

0. 若入口先报“服务暂时不可用”，先用原内容任务 ID 与幂等键查写入是否已成功，再查预览后端日志和 `data/local-store/*.json.lock/owner.json`。健康检查只证明 HTTP 进程存活，不证明本地集合可写。`local_store_reconciliation_required` 是维护状态，不是供应商失败；不要新建平行任务、删锁或重复付费。按 `scripts/local-store-lock-recovery.md` 先只读检查，再取得唯一写入权后以快照哈希执行受控恢复。
1. 只读查看 `content_execution_jobs` 的状态、`last_error`、`provider_state`、`provider_receipts` 和 `image.planning` 检查点，再核对图片任务的 `productionRuntime.nodes`、`generationJobs` 与 `outputs`。展示层必须使用稳定错误码，不泄露密钥或供应商原始响应。
2. 策划节点 `director_brief` 已完成且 `image.planning` 检查点为 `completed` 时，保留并复用策划结果；不要重建任务或再次调用策划。若策划检查点为 `started`、`outcome_unknown` 或已有未知供应商回执，先核对供应商结果和持久化产物，禁止盲目重复调用。
3. 图片节点报告 `OPENAI_API_KEY is not configured` 时，检查实际执行 worker 的运行配置与授权密钥是否存在，禁止输出、复制或记录密钥。源码从配置检查开始，必须在新增或领取付费图片作业之前停止；界面显示服务配置缺失。配置恢复后，先核对原图片作业、provider receipt 和已有产物，再通过受控恢复流程继续原任务，不得新建平行任务。
4. 旧版本可能在密钥缺失前已领取图片作业并错误标为 `outcome_unknown`。仅凭报错文字不能修改历史记录：应同时核对原任务输入指纹、所有 provider 回执、供应商结果及任务产物；无法证明未提交时保持未知状态并人工核对。恢复必须使用保留审计的受控操作，不能直接改 JSON、删除回执或批量重试。
5. 如果供应商已接受、结果未知或产物下载失败，先核对原请求和费用回执；在结果确认前禁止重提。任何重试都要沿用原任务授权及允许的预算，不能把入队或策划完成当成图片已生成。

## 本次本地事故记录（2026-10-28）

- 租户 `local_tenant_customer_aurelia_beauty`，内容任务 `socialtask_682a0e2eef838454c50afc6f`，图片任务 `imgb1ad621c31c5`，执行作业 `e9c24628916ae02`。
- `image.planning` 已完成，`director_brief` 与 `render_spec` 已完成；没有图片产物。执行作业最后错误为 `OPENAI_API_KEY is not configured`，provider 状态 `none`、回执为空。图片子作业 `43f6a492-eb43-430e-b433-efc0e7e89ab5` 被旧代码标为 `outcome_unknown`，该历史状态尚未改写。
- 原因：旧代码在调用图片适配器前就将“供应商可能已开始”置为真，密钥检查却在适配器内部发生，导致本地缺配置也被记录为未知付费结果。新代码在创建付费作业前检查配置，并将该明确的配置异常识别为未提交；历史数据仍需按上面的回执核对规则处置。
- 此记录仅证明本地作业的状态与源码缺陷，不证明供应商账号、配额或真实生成链路可用。

## 本地预览写锁事故（2026-10-28）

- 19:51（北京时间）后端在 `shared/contracts/videoCreationPlan.ts` 热更新时退出并重启；同一时刻 `data/local-store/durable_operation_leases.json.lock/owner.json` 留下已退出 PID 62618 的写锁。随后的持久化写入持续返回 `local_store_atomic_lock_busy_reconciliation_required`；周任务详情请求未捕获该错误，在 20:31 引发后端退出。Vite 代理短时 `ECONNREFUSED`，健康接口恢复 200，但业务写入仍不可用。图文入口因此显示笼统的“服务暂时不可用”。
- 源码处理：热更新重启在后端进程组持有本地集合锁时延后；周任务详情捕获并返回稳定 503 错误；图文/内容任务入口映射为 `local_store_reconciliation_required`，客户端提示沿用原任务恢复。图文费用上限/余额核验不再作为生产门禁；真实付费调用开关、订阅/额度及未知回执防重放仍独立生效。
- 首次只读扫描拒绝执行：同一工作区仍有 19 个可能写入的进程。用户授权后，仅停止本仓库预览服务及 5 组旧浏览器自动化会话；因 LaunchAgent 自动拉起预览，先临时 `bootout gui/501/com.lingshu-ai.local-preview`。复扫确认无写入者且无拒绝理由，按快照哈希 `8cf4893973f654b83638c6fc9fd7ade44c2b8f58d8d27dbfca3ee4bf0132f33e` 执行受控恢复，操作 ID `c8fc345c-2ceb-4ff8-ac59-a297b599a78d`，审计目录 `data/acceptance/local-store-lock-recovery/c8fc345c-2ceb-4ff8-ac59-a297b599a78d`。业务 JSON 的 SHA-256 前后均为 `723b28bc925a9ff47828614d2098fb6c62d0b93734aeacd1355e25e9999556f3`；旧锁已隔离，原路径不存在。随后重新 `bootstrap` 同一 LaunchAgent，前端及 `/api/overseas/ready` 返回 200。未重试原任务、未调用图片生成；健康检查仍不等于业务写入或真实供应商链路验收，原任务需沿用原 ID 单独验证。

## 周计划关联问题

同一账号的周目标 `weekly_goals_2e822694f01c45f6a3f5077ebf729e87` 仍为草稿，未创建周运营 run。经只读复算，完整档案按确认当时的哈希规则排除后来新增的三个空 onboarding 字段和空 `socialStrategy.primaryPlatforms` 后，与已确认摘要完全一致；周计划冻结的业务快照也与当前完整档案的同一版本一致。此前直接把精简快照按完整档案规则计算，以及新默认字段改变旧摘要，导致误拦截。修复只允许这些字段为空时复算整个旧摘要，并要求完整档案由用户确认、版本一致且业务快照精确匹配；资料真正变化仍应阻断。没有改写用户资料或确认记录。当前账号数据的离线零付费预检已通过，真实启动和外部制作尚未验证。

## 产品抠图与分析状态规则（2026-10-29）

- 本地事故：Aurelia 的 `GUIANFA-RS-004` 已有同租户、同产品、同原图哈希的透明抠图 `enterprise-b0c0cddb-8d6b-4915-8d79-7362afadce76`，字节、哈希和透明像素均可读取；原图素材分析却是 `failed`，记录错误 `404 Model not exist.`。内容任务 `socialtask_3e0f6780037f38b6077b991f` / 作业 `f0c2ae7cb89033e` 被旧逻辑误报为 `social_image_product_asset_processing`。这些记录是故障证据，不得直接修改 JSON 或假称图片生成成功。
- 规则：抠图就绪与原图分析是两个独立状态。单条产品图制作只以同租户、同产品、同原图版本的透明图字节、哈希和透明像素核验为抠图门槛；分析失败不得伪装成“仍在抠图”。周任务若要求分析完成，失败须返回稳定 `social_image_product_analysis_failed`，保留原作业和回执；不要在每次生产重试时自动重发已经失败的分析请求。
- 恢复：先检查素材记录中的 `segmentAnalysisStatus` / `segmentAnalysisError` 和透明图校验结果。分析服务修复后，在素材库明确重新分析；再从原任务继续，先核对付费检查点与供应商回执。没有再次授权或唯一写入权时，不新建任务、不直接改状态、不盲重试付费生成。
