# Runway 人物替换：10 秒内独立流程

实现日期：2026-09-21。开发目录：`lingshu-director-integration`。

## 范围和入口

内容制作 →「案例视频换人物」。

上传 MP4/MOV（大于 0 秒、不超过 10 秒、最大 40MB），选择已有授权且包含参考图的企业人物，生成关键帧并检查，确认后生成视频，完成后在线播放及下载。当前面向单人连续镜头，不接入灵感爬取、自动拆镜或整条创作链路。

形象替换目标为面容、身份和发型；原服装、动作、场景与产品作为保持目标。最终视觉效果需人工验收，不能保证背景或产品逐像素不变。声音保留原片音轨，包括原人物声音、配乐和环境音；不进行声音替换。

## 本地配置

在后端实际加载的本地环境配置中设置以下变量，重启本地后端。不要将密钥提交到版本库。

```dotenv
RUNWAY_API_KEY=<通过安全方式填写>
RUNWAY_SWAP_ENABLED=true
RUNWAY_SWAP_IMAGE_CNY=<单次关键帧生成的人民币估价>
RUNWAY_SWAP_VIDEO_CNY_PER_SECOND=<每秒视频生成的人民币估价>
RUNWAY_SWAP_BUDGET_CNY=<本轮累计人民币预算上限>
```

估价与预算必须为正数，未配置时不允许调用付费生成。当前开发环境未检测到 Runway 密钥，尚未进行真实供应商样片验收。预算为本地累计准入预占，覆盖本功能关键帧与视频，不是供应商账单硬上限，也不包含其他模块；失败或未知任务不自动退回预占。已有任务刷新不需重新开启生成开关。

## 实现

- 使用企业 `studio_production_defaults` 中当前租户已授权的人物参考图片；不接受前端传入任意人物 URL。
- FFmpeg 服务端读取实际视频时长，拒绝超过 10 秒，不静默裁剪。规范为最高 1080×1080 包围框内的等比尺寸、30fps；不足 2 秒尾帧补齐，输出时裁回原时长。
- Runway `gen4_image` 输入原片首帧和企业人物参考图，生成替换关键帧。用户检查实际将使用的关键帧后才进入视频生成。
- Runway `aleph2` 使用 `videoUri` 与 `keyframes: [{ uri, seconds: 0 }]`，通过临时上传 URI 输入素材。
- 视频结果下载到本地，校验时长与画幅；重新使用原片音轨合成，原片无音轨则输出保持无声。音频转码为 AAC，不承诺二进制原样复制。
- 素材和任务存于 `data/person-swap/<租户哈希>/<任务UUID>/`，只通过鉴权路由读取；已加入 Git 忽略。任务可在刷新页面或重启服务后恢复查看。
- 阶段提交前持久化状态并加文件锁。未得到供应商任务 ID 时保持结果未知，不自动重试付费请求；已知任务仅查询或重新导入生成结果。服务崩溃遗留锁需核对任务和账单后人工处理。
- 独立本地试用采用文件持久化，无数据库迁移。多实例部署前需要共享存储、任务协调及数据清理策略；本次没有部署。

## 验证

```sh
npx tsx --test server/routes/personSwap.test.ts
npm run lint
npm run build
```

集成测试使用模拟 Runway 返回和真实 FFmpeg，覆盖视频输入→关键帧→确认→视频→原音轨合成、超长/无效输入、无声源、短片恢复、租户隔离、重复付费防护、未知提交、累计预算和接口参数。

测试素材为程序生成的色块与音频，不代表真人替换质量。真实验收仍需 Runway 配置、预算、10 秒内单人案例及可用企业人物参考图。

官方接口依据：
- https://github.com/runwayml/sdk-node/blob/main/src/resources/video-to-video.ts
- https://github.com/runwayml/sdk-node/blob/main/src/resources/text-to-image.ts
- https://github.com/runwayml/sdk-node/blob/main/src/resources/uploads.ts
