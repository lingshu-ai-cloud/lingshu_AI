# Instagram 周任务正式发布的本地验收缺口

日期：2026-10-10。范围为本地服务与受控输入；没有调用真实发布端点。

## 当前证据

`server/publishing/weeklyPlatformAcceptanceInstagram.test.ts` 使用真实拥有的源视频、实际 FFmpeg 转换、文件归档、归档 SHA256 以及正式打包审核服务。两个审核通过输入明确为受控本地输入，不能证明人工内容质量或平台接收。

测试确认：归档文件与源文件 SHA256 不同；两个审核记录绑定归档 SHA256；打包审核缺口为空；正式 G6 的 `platform_format` 仍为 `unknown`，原因包含 `instagram_reels_current_file_limit_unverified` 和 `instagram_reels_stream_structure_unverified`。提交正式 G6 后没有通过回执，正式 `createInstagramDeliveryPublicationProof` 拒绝创建证明，assignment 和发布 attempt 均为零。

因此，当前 Instagram 正式 assignment/package 的成功路径尚未具备完整证据。不能把 adapter 的账号能力可用，或另一个平台的成功，计为 Instagram 周发布完成。

## 修复所需证据

1. 对实际归档的发布字节读取流结构：MP4 atoms/edit lists、封闭 GOP、视频/音频解码与编码参数；该证据必须绑定归档 SHA256，而非源文件或预期编码命令。
2. 使用明确版本、来源和更新时间的 Instagram 发布规则，定义该版本可本地验证的文件上限和格式条件。不能把旧示例的上限直接当现行平台许可，也不能仅凭转换命令认定流结构通过。
3. G6 只在这些证据完整、有效并绑定当前归档、独立审核和周任务时通过；证据缺失或漂移继续阻塞。
4. 再补归档审核→G6→正式用户批准→assignment/package→默认 Instagram adapter 的受控本地成功链，以及归档、审核、账号或规则漂移时零发送的负向测试。

不得通过无条件 `passed`、替换 G6、绕过正式 assignment 证明，或伪造 provider 回执消除缺口。

## 已运行

命令（仓库根目录）：

```sh
tsx --test server/publishing/weeklyPlatformAcceptanceInstagram.test.ts server/publishing/tiktokWeeklyPublishingAdapter.test.ts server/publishing/weeklyFormalPublicationBoundary.integration.test.ts
```

结果：3/3 通过，约 6.84 秒。TikTok adapter 的实际正式绑定与受控发布成功、正式消费者丢失/漂移禁止发送，以及原 unknown attempt 只恢复不重发均通过。本次 Instagram 通过的是上述阻塞行为验收，不能记为发布成功。
