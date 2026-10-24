# 客服渠道隔离误触复核与加固（2026-10-24）

当前目录 `/Users/julia1/Documents/ChatGPT/1024客服`，分支 `feature/customer-service-20261024`，HEAD `89b175109149d4551aeb3ce590fe9c42c46bf23c`。工作区包含其他客服 UI/标签修改，已保留；本轮未提交、推送或合入基线。

结论：当前测试入口和本地预览默认阻断真实客户渠道。测试子进程、worker、底层 TCP/TLS、HTTP 客户端以及浏览器连接均已补齐阻断与回归证据。已授权的 Qwen 草稿/翻译保持可用，客户入站、传输、审批目录和回执继续使用原隔离模拟流程。本轮负例只使用保留域名或本地探针，没有重新访问真实渠道地址。

## 误触根因与历史证据边界

1. 旧命令 `node --import guard tsx/dist/cli.mjs --test ...` 只明确保护启动器。tsx 启动测试子进程时，原 execArgv 未可靠传递，子进程没有安装 guard。负例直接 POST 到 `graph.facebook.com/v25.0/messages`，断言出现 Missing expected rejection。
2. 当时负例源代码只有 URL 和 method=POST，没有凭据、收件人或消息正文，不构成可发送的客户消息请求；历史没有保存渠道响应或网络抓包，因此无法补造服务端处理结果，也不能把历史描述成“所有渠道请求均被拦截”。
3. 原 guard 只包装 fetch/http/https；undici 的独立入口、原始 Socket/TLS 和任意子进程没有完整覆盖。预览还依赖人工记住命令行 preload；`configureNetworkProxy` 会执行 curl/nc 探测。因此此前“预览已预加载 guard”不足以证明所有出网入口均隔离。该发现修正了前一份验收记录的隔离结论，不影响已保存的模型响应及模拟发送账本事实。

## 本轮修复

| 边界 | 当前行为 |
| --- | --- |
| 默认测试命令 | customer-isolation、customer-pipeline、customer-service、whatsapp-onboarding 统一使用原生 Node 测试启动器；NODE_OPTIONS 中固定预加载 guard，先于 TS 测试模块执行 |
| 原完整客服回归 | 将旧命令链展开为相同的 39 个测试文件，交给隔离启动器；没有删减原用例，不再依赖操作者手动设置 NODE_OPTIONS |
| Node 后代进程 | spawn/spawnSync、execFile/execFileSync、fork 强制注入 preload；调用方传 env={} 仍继承；孙进程同样受保护 |
| Worker | eval 和文件 worker 都先导入 guard，再运行入口；清空 execArgv/env 不会取消隔离 |
| 非 Node 子进程 | curl、shell、任意外部可执行文件默认拒绝。唯一必要例外是从当前 tsx 依赖解析出的精确 esbuild 二进制、匹配版本的 `--service=<version> --ping` 固定编译协议；不开放任意命令或参数 |
| Node 网络 | fetch、Request、http(s) request/get、net.Socket.connect、tls.connect 均默认拒绝外部地址；axios、独立 undici、HTTP/2 因相应 HTTP/TCP 层受控；URL+options 覆盖也会重新校验目标 |
| 本地服务 | 仅允许当前进程实际监听的 loopback 端口；其他本地端口/代理不能用来绕过。fetch 禁止自动重定向 |
| 本地预览启动 | server/index 的第一个导入同步安装隔离，先于业务适配器，避免 top-level await 让并列模块抢先执行；本地预览强制 web role、停后台 worker/PocketBase 自动启动，默认只监听 loopback；缺少合法开发环境则失败退出 |
| ESM/CJS 双加载 | guard 重复加载不会重复包装或覆盖已安装实例；tsx 的 ESM 与同步 require 共用同一进程级 AI 作用域，既不丢失已授权许可，也不额外扩大许可 |
| 启动探测 | 隔离进程跳过 curl/nc 外网探测和代理自动安装；回归检查连“尝试调用探测子进程”都没有发生 |
| 浏览器 | 本地 Vite 预览返回 CSP connect-src self+指定本地 HMR WebSocket、form-action self；真实 AI 从后端调用，不需要浏览器连接外部模型或渠道 |
| AI 许可 | 仅开发、本地预览、REAL_AI 开关同时开启时，授权操作可调用配置的 Qwen chat/completions HTTPS POST。禁止重定向、其他路径/域名/方法；只在实际 fetch 内临时允许对应 AI 主机的 TLS。操作结束后，排队的异步后代也不能继续取得许可 |

这属于受信应用进程和浏览器连接边界的防护，不是操作系统级防火墙，也不宣称能约束恶意 native addon、被替换的编译器或工作区外任意程序。没有放宽操作系统/部署权限或真实渠道授权。

## 防止回归测试再次误触

新增测试专用下层 canary：在主 guard 之前安装，若拒绝请求逃过主 guard，下层只记录并抛出 `isolation_canary_reached`，不会连接真实主机。正常负例路径断言 canary 命中为 0；并验证 Node 后代继承这层测试保护。负例目标为保留域 `customer-channel.invalid`，真实渠道域名仅用于不发请求的许可判定。

另用一次纯内存 canary 自检验证：即使测试代码捕获逃逸异常，子进程退出仍强制失败；该自检不执行网络 I/O。所有测试进程退出时检查 canary，不能吞掉异常后误报通过。

测试覆盖：fetch/Request、axios、独立 undici、http/https/get、HTTP/2、原始 net/tls、URL options 替换、重定向、非本进程监听的代理端口、空 env 子进程、fork/孙进程、eval/文件 worker、原 tsx CLI --test、遗漏 guard preload 的预览启动及并列模块执行顺序、ESM/CJS AI 许可一致性、curl/shell、启动探测及 CSP。

## 运行中的本地预览证据

- 后端以 `node --import tsx tmp/customer-service-preview/start-backend.mjs` 启动，故意没有 guard CLI 参数；实际隔离自动安装，version=2、defaultPolicy=deny、后台任务关闭。
- 实际后端固定自检：fetch/http/https/net/tls/curl/shell/空 env Node 子进程共 8/8 阻断，错误码 `ISOLATED_NETWORK_BLOCKED`。自检不接受外部目标参数；入口仍受原 loopback、Origin、本地账号及非支持会话写权限约束。
- Chrome 实际检查：fetch、XHR、WebSocket、EventSource 4/4 产生 CSP connect-src 阻断事件，截图 `tmp/customer-service-preview/isolation-audit-browser.png`。检查后已恢复登录的客服预览。
- 正式客服 enabled=false、canAutoSend=false；WhatsApp/Messenger/Instagram providerReady、tenantAuthorized、backgroundWorkerEnabled 均为 false。
- 原真实草稿请求 `25fbcf3d-8157-4332-97e2-cf1d1c591f7c` 及其完整模拟会话保留；生成次数 1、模拟传输次数 1，界面仍为已送达，没有为了验隔离而重发。
- 新 guard 下单独验证一次真实翻译：`请发成分表。` → `Please send the ingredient list.`，qwen-plus、HTTP 200、48 tokens；requestId `175712ba-3426-9c35-b028-b7f86ebc8367`。隔离 session `b4ab9db594cc20b95b6c06ea`，未发送客户消息、未覆盖原批准正文，未重跑已验证的草稿。
- 同步启动及双加载修复后，再验证 `收到。` → `Received.`，qwen-plus、HTTP 200、41 tokens；requestId `844a9de6-1992-9b1a-9b1a-105c49076d47`。两次独立验证共 89 tokens，没有对结果未知的请求盲目重提。

## 命令与证据

- `pnpm run test:customer-isolation`：无 preload 启动 1 项 + 隔离回归 9 项通过，无跳过，canary 命中 0。
- `pnpm run test:customer-pipeline`：91/91 通过，无跳过，包含原入站、接管、审批、账本及模拟恢复。
- `pnpm run test:customer-service`：67/67 通过，无跳过；使用默认命令，不额外手工注入 NODE_OPTIONS。
- `pnpm run test:whatsapp-onboarding`：12/12 通过，无跳过；连接/发送边界使用既有 stub，没有访问真实渠道。
- `pnpm run lint`、`ARCHITECTURE_BASE_REF=89b17510 pnpm run check:architecture`、`pnpm run build`、`git diff --check`：通过，构建保留既有 chunk 提示。

日志 `tmp/customer-service-preview/isolation-audit-*.log`；运行 JSON `isolation-audit-runtime.json`；源文件/日志/截图 SHA-256 清单 `isolation-audit-manifest.json`。这些运行证据没有密钥、请求授权头或真实收件人。

关键实现文件：`scripts/customer-isolated-test-guard.mjs`、`customer-isolated-processes.mjs`、`customer-isolation-canary.mjs`、`run-customer-isolated-tests.mjs`、`customer-preview-ai-scope.mjs`、`server/runtime/localCustomerPreviewIsolation.ts`、`server/lib/networkEnvironment.ts`、`server/routes/localCustomerSimulation.ts`、`vite.config.ts`。测试包含缺少 preload、空 env 和旧启动器复现路径。
