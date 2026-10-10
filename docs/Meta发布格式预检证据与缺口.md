# Meta 实际发布格式预检证据与缺口

核对日期：2026-10-10。仅采用 Meta 自己的官方文档、官方示例仓库与 Meta Postman 集合。第三方搜索摘要不作为放行依据。

## 实际接口

- Instagram：`server/integrations/social.ts:737` 调用 `POST /{igUserId}/media`，参数 `media_type=REELS` 与 `video_url`，随后 `media_publish`；默认 Graph 版本 v25.0，可由配置覆盖。
- Facebook：同文件 648 行调用 `POST graph-video/{version}/{pageId}/videos`，multipart 的 `source` 上传真实文件；该代码不走 `video_reels`，不能套用 Facebook Reels 的规格。

## 可读取的一手规格

- [Meta 官方 Reels 示例](https://github.com/fbsamples/reels_publishing_apis/blob/main/insta_reels_publishing_api_sample/README.md)：IG Reels 的容器为 MOV/MP4，视频为 H.264/HEVC，帧率 23–60 fps，横向像素不超过 1920，宽高比 0.01–10，时长 3–900 秒，视频码率上限 25 Mbps。还要求 AAC、音频采样不超过 48 kHz、单/双声道、渐进扫描、封闭 GOP、4:2:0 和 MP4 结构约束。
- [Meta 官方 Postman 集合](https://www.postman.com/meta/instagram/folder/y6xustx/reels-publishing) 对容器、编解码、帧率、宽度、时长与码率给出对应约束。
- 上述示例与集合提及 1 GB，但当前 [IG User Media 参考](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/) 在本次读取返回 HTTP 429，无法确认最新接口的完整文件上限。本实现不把示例的 1 GB 当作当前放行承诺。
- [Page Videos 参考](https://developers.facebook.com/docs/graph-api/reference/page/videos/) 和 [Video API Publishing](https://developers.facebook.com/docs/video-api/guides/publishing/) 同样返回 HTTP 429。**Facebook 精确 Page Videos 发布规格仍未完成核验**。Reels、广告和客户端推荐值不替代它。

## 实际观测与执行边界

`inspectSocialOwnedVideo` 对当前归档的 owned bytes 作完整视频解码。新增流字段只来自同一 FFmpeg 输入头：视频/音频码率、音频采样/声道、像素格式和明确扫描模式；缺字段保存 null。音频字段属于输入流描述，当前 `-map 0:v:0` 不证明整条音轨全解码。未观测的 GOP、moov/edit lists 不由模板参数推断。

`weeklyMetaFormat` 对已确认基本规则的真实违规输出 blocked；其余 IG 情况保持 unknown，并明确当前规则、流结构和发布派生物缺口。Facebook 保持 Page Videos 精确规则 unknown，不输出 passed。

## 原成片与实际提交派生物

`server/publishing/platformPublisher.ts:172` 的 `instagramCompatibleVideo` 在本地文件发布时另外转码生成 `.instagram.mp4`；598 行调用它，608 行传入其公开 URL。当前派生物未作为独立 owned file 持久化 SHA/血缘/G6。若已有 `videoUrl` 则跳过转换。仅从预检原成片不能证明最终发给 Meta 的字节相同。

最小后续架构：在明确目标平台的生产/包装阶段生成并归档派生物，保存 SHA、来源成片和转换版本；发布 assignment 冻结该真实 fileRef/hash；G6 对该字节执行检测并冻结规则与凭据；publisher 只提交该归档字节，不在网络效果前隐式改写媒体。本轮不改 publisher、不发布、不自动转码或付费。

## 已接入的 Instagram 归档包装路径（2026-10-10）

用户在真实视频工作区明确“准备 Instagram 发布包装”，后端只进行本地 FFmpeg 包装与企业自有文件归档，不请求模型、不派付费生产、不发布，也不计为新增母版。准备记录冻结目标租户/项目/周包版本/发布任务、原成片与原文件 SHA、真实原 G4/G5 审计摘要、转换版本、包装文件 SHA 和实际解码元数据。相同原请求可只读恢复，其他意图不能替换同一冻结目标的记录。

包装改动了画面与编码，须对实际包装文件独立进行技术七项、创意六项人工审核。记录明确技术审核人/人工编导角色及观察说明，不能继承原成片的 G4/G5 通过结论。源审计、包装文件字节、检查项与状态漂移都将拒绝读取为可用凭据。原成片仍保留其原始来源和审核流程。

G6 的 `fileRef/fileSha256` 保留原成片身份；`instagramDelivery` 提供真实包装身份与独立审核记录，格式检查的 `metadata.fileSha256` 必须对应包装文件。新 Instagram 发布派单的 lineage 必须冻结包装、独立审核及真实 G6 回执，默认发布端读取同一份归档字节，不再在发送阶段偷偷再生成另一文件。历史未知请求仍只核对原请求状态。

包装完成不代表 Meta 格式全部通过。当前官方文件上限和闭合 GOP、MP4 edit-list/moov 等完整结构证据仍未核实，格式结果保持 unknown；没有真实 G6 通过回执时，新 Instagram 发布派单和外部发送仍被阻止。Facebook 当前 `/page/videos` 精确格式规则也仍待核实。
