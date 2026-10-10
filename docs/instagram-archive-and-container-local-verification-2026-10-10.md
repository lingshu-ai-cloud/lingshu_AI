# Instagram 归档与容器本地核验

格式规则采用 Meta 官方 Reels 样例（2026-10-10 读取）：https://github.com/fbsamples/reels_publishing_apis/blob/main/insta_reels_publishing_api_sample/README.md 。这是版本化本地技术准入，账号权限和平台是否实际接收仍由独立检查证明。

归档转换升级 v2，关闭 edit list。读取归档时对实际文件字节重算 SHA，并解析 MP4 atoms、AVC 样本表：moov 必须在 mdat 前、不能有 edit list、唯一视频轨、样本必须在 mdat 内、同步样本必须对应 IDR。证明含版本、SHA、字节数和摘要，G6 再校验元数据、尺寸、时长、帧率、像素格式、扫描方式及码率。支持的归档是 H.264 MP4；不支持或损坏结构保持 unknown。110 MiB 本地上限比样例的 1 GB 更严格。旧 v1 归档不会继承新版资格。

正式本地验收先创建账号能力、承接绑定与周授权，再做初始 G5，随后真实 FFmpeg 转换、两个独立人工审核输入、G6 回执和正式归档发布证明。缺少 stream proof 仍不能通过。审核输入和 provider 能力是受控输入，没有对外发布。

Instagram 容器创建后立即保存 `ig-container:ID`，保存失败阻止 media_publish；发布前再核租约和源文件。直接发布、周发布和排期发布都接入持久化回调。lost response 保留原容器回执，恢复只读取该容器。即使容器状态为 PUBLISHED，没有最终媒体 ID 仍保持 unknown，不重建、不重新提交发布；容器 ID 不会被当成最终 post ID。

本地证据：归档/格式/G6 7 项通过；容器、周适配、排期、provider 恢复 4 项通过；IG lost-response 验收通过。完整 TypeScript 检查由主集成统一回收。没有真实平台发布、付费或部署。
