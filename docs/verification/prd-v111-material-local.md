# PRD v1.11 素材路由本地验收

日期：2026-10-10。此记录描述本地代码和受控执行证据，不表示真实付费供应商端到端已验收。

## 已实现

- 正式内容任务读取企业素材库并输出 `assetSupplyPlan.inventoryAudit`，保留真实字节版本、产品、规格、授权证据和缺口；素材库读取失败返回明确服务错误，不能伪装成空库。
- 编导的 `primaryHook`、`uniqueVisualMechanism`、`explicitAudioVisualSync` 标记将粗略的普通镜头判定升级为关键镜头，走高保真 AIGC。
- 真人口播优先已授权数字人，不能被普通工厂或人物库存替代。
- 普通非主讲素材库检索无结果时转为非事实性视频生成，冻结新的路由并由同一个真实执行器消费；不要求用户拍摄。
- 新素材消费者可携带 `assetRequirement`，严格按主体、动作、场景、证据要求、画幅、时长和授权范围确定共享身份；不同需求不能误共享。
- 结构化新请求上传后，系统读取字节绑定自动检查凭据，并以 `content_agent` 身份存储检查结果。合格请求直接进入 accepted；新增消费者重新读取实际素材并检查，不需要用户点击人工核验。缺少授权、事实或质量证据时明确异常，不能假定通过。
- 旧版本无结构化要求的请求保留其原合同，避免静默修改已执行周包。

## 接入合同

新消费者字段 `assetRequirement`：`subjectRef / action / scene / evidenceRequirement / aspectRatio / minimumDurationSeconds / authorizationScope`。同一个共享请求的消费者必须采用完全一致的语义身份。

自动检查读取服务端 `automaticEvidence` 端口，默认读取素材的 `provenance.weeklyAutomaticMaterialEvidence`。凭据必须绑定当前 sha256，含主体、动作、场景、事实要求、画幅、时长、授权范围、真实授权引用、质量结果和分析模型。上传完成、文件名和自由文本不能替代这些证据。

当前新自动检查合同已有实际 HTTP 服务和生产准入消费路径；仍须由实际上传分析/生成质检 producer 写入上述机器凭据，才能让未带该凭据的历史素材自动通过。未写入的素材如实进入异常，不通过界面模拟核验。

## 本地验证

日志：`/tmp/prd-v111-material-local-tests.log`。46 项通过，覆盖路由、实际执行器继续、共享身份、五消费者自动通过、存储机器凭据读取、新消费者自动准入和旧版回归。实际字节读取仍由现有 materializeSocialContentCloudMaterial 执行，重复消费重新验证哈希。未调用付费供应商、未发布外部视频。
