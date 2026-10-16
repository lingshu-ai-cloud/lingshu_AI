# 项目本地视频下载组件

仅由开发者显式执行，不在服务启动、任务执行或恢复时自动安装：

```sh
node scripts/prepare-video-downloader.mjs
# 可显式选择已经安装的 Python >=3.10：
node scripts/prepare-video-downloader.mjs --python /absolute/path/to/python3
```

脚本只在本仓库 `.venv-video-downloader/` 建立隔离环境，从官方 PyPI 安装固定版本 `yt-dlp==2026.8.19`，按 requirements 中的完整 SHA256 校验 wheel，不安装系统包、不改共享 bundled Python、不读取 cookies。重复执行仍使用同一隔离环境和固定版本。已有不完整或软链接目录拒绝覆盖，保留待检查。

正常重载新代码后，下载器按“明确指定的 `YT_DLP_PYTHON` → 本项目隔离环境 → bundled Python → `PYTHON` → python3”顺序进行真实 import 核验。准备依赖不会修改运行中进程的环境或代码，也不会重启服务、派单、重试任务、释放额度或请求媒体。

这次只补齐最小 Python 下载组件；不代表任意站点可访问、已获素材权利、已具有登录态，也不提供或绕过平台的 JavaScript challenge。其他可选依赖与站点限制须单独核验，不能以 import/版本通过代替真实视频交付。

来源：[官方安装说明](https://github.com/yt-dlp/yt-dlp/wiki/Installation)、[固定版本 PyPI 元数据](https://pypi.org/pypi/yt-dlp/2026.8.19/json)。该版本要求 Python >=3.10；项目准备验证使用隔离 Python 3.12。
