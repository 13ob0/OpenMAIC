# OpenMAIC 模型授权路由处理器集成测试

使用 Bun 启动轻量 HTTP 服务，加载当前分支真实的 `/api/verify-model` 和 `/api/chat` 路由处理器。先测试 `main`，再切换到 `fix/fix-p0-model-probing-and-api-proxy-abuse`，收集相同请求的响应和上游调用证据，生成可直接放入 PR 的对比报告，最后恢复原分支。

不启动完整 Next 应用，不加载 instrumentation 或 middleware，不连接数据库。测试保留真实匿名身份、模型解析、授权规则、聊天编排及 AI SDK 调用，仅将模型供应商替换为本机模拟服务。报告明确标为路由处理器集成测试，不等同于完整部署的端到端验证。

## 执行

在仓库根目录运行：

```powershell
bun security-lab/compare.mjs
```

需要 Bun、Git 和已安装的项目第三方依赖。无需配置 `DATABASE_URL`、启动 PostgreSQL、构建完整应用或预先构建工作区包；轻量服务通过 Bun 加载对应分支的 TypeScript 源码，包括本地工作区包源码。

两个本地分支必须存在，修复已经提交到指定修复分支，且本机 3000 和 18080 端口空闲。请先停止已占用这些端口的开发服务器。已跟踪文件存在未提交更改时脚本停止，不自动 stash、不丢弃修改、不强制切换分支。两个分支的依赖锁必须一致，脚本复用同一份已有依赖，不重新安装。

## 测试流程

1. 记录原分支和两个目标分支的提交 SHA。
2. 启动本机模拟模型服务。
3. 切换到 `main`，加载该分支的真实路由处理器，发送六个 HTTP 请求并收集结果。
4. 停止该服务，切换到修复分支，重新加载路由处理器，发送相同请求并收集结果。
5. 停止本次启动的服务，恢复原分支，输出报告。

每个分支的路由加载在独立子进程中完成，不复用上一个分支的模块缓存。`route-server.mjs` 的 HTTP 转发层只将请求转换为真实 `NextRequest`，调用路由的 `POST` 并原样返回响应；不重写授权结果，也不 mock 路由、模型解析、身份或聊天生成函数。

## 环境变量

脚本只读取 `security-lab/env.example`，测试子进程使用 `--no-env-file` 禁止自动读取 `.env.local`，不会继承真实供应商凭据。无论原终端是否配置数据库，测试子进程的 `DATABASE_URL` 均为空。

```dotenv
DATABASE_URL=
OPENAI_API_KEY=sk-openmaic-security-lab-fake
OPENAI_BASE_URL=http://127.0.0.1:18080/v1
OPENAI_MODELS=lab-approved
DEFAULT_MODEL=openai:lab-approved
MODEL_FALLBACK=
MODEL_ROUTES=
ACCESS_CODE=
OPENMAIC_CONFIG=
```

模拟上游支持 `lab-approved` 和 `lab-unapproved`，部署只授权 `lab-approved`，`lab-missing` 不存在。所有推理在本机完成，不使用真实模型凭据或产生模型费用。

当前测试限定旧式环境变量配置路径，使用默认匿名身份且不加载工作区保存配置。如果工作区存在 `openmaic.yml` 或 `server-providers.yml`，文件配置可能优先于模拟环境，脚本停止并提示，不移动或覆盖这些文件。

## 预期对比

| 场景 | main 修复前 | 修复分支 |
| --- | --- | --- |
| 验证授权型号 `openai:lab-approved` | HTTP 200，上游调用且有模型输出 | HTTP 200，上游调用且有模型输出 |
| 验证可用但未授权型号 `openai:lab-unapproved` | HTTP 200，上游调用且有模型输出 | HTTP 403，无上游调用 |
| 验证不存在型号 `openai:lab-missing` | HTTP 500，上游返回不存在错误 | HTTP 403，无上游调用 |
| `{provider: "openai", model: "lab-unapproved"}` | HTTP 200，使用服务端凭据调用未授权型号 | HTTP 403，无上游调用 |
| 伪造 `/api/chat` 请求体的型号 | HTTP 200，SSE 含模型输出 | HTTP 403，无上游调用 |
| 伪造 `x-model-routes` 的 `chat-adapter` 型号 | HTTP 200，SSE 含模型输出 | HTTP 403，无上游调用 |

请求不提供模型 API key；上游记录的 `serverCredentialUsed: true` 证明使用了服务端虚拟凭据。HTTP 200 还必须同时有目标型号的上游调用和 `LOCAL LAB RESPONSE` 输出。HTTP 403 必须同时满足没有新增上游调用，避免“表面拒绝、实际仍产生推理费用”。可用但未授权型号与不存在型号的拒绝响应应一致。

单项失败不会阻止其余请求被记录。只测试以上固定型号，不进行批量枚举。

## 输出到 PR 的报告

运行结束在终端显示对比表，同时生成：

```text
security-lab/artifacts/report-时间戳/
  report.md       可直接粘贴到 PR 的对比报告
  report.json     请求、响应、上游记录和失败原因
  before.log     main 路由处理器服务日志
  after.log      修复分支路由处理器服务日志
  mock.log       模拟上游日志
```

`security-lab/artifacts/latest-report.json` 指向最近报告。PowerShell 查看：

```powershell
$latest = Get-Content security-lab/artifacts/latest-report.json -Raw | ConvertFrom-Json
Get-Content (Join-Path $latest.directory 'report.md')
```

将 `report.md` 完整内容粘贴到 PR。需要原始证据时，同时附上 `report.json` 和日志。报告记录实际分支 SHA，不预填成功结果；每条响应最多保留 16000 个字符，截断会标记。报告目录已忽略提交。

| 状态 | 退出码 | 含义 |
| --- | --- | --- |
| PASS | 0 | 两个分支的全部预期满足 |
| FAIL | 1 | 路由加载、请求、证据校验或原分支恢复失败 |
| BLOCKED | 2 | 分支、依赖、文件配置或端口条件不满足 |

失败也输出报告，NOT_RUN 表示未执行，不能视为通过。

## 测试边界与调试

本测试证明相应路由处理器的型号授权行为，不能证明部署的 middleware、访问码、反向代理、启动配置或数据库工作区权限已安全。Pi 聊天、YAML 槽位及 fallback、工作区引用和模型选择界面也未被这六项请求覆盖。

授权型号在匿名测试环境中仍可调用。因此，通过本测试不能声称所有模型反向代理滥用已被消除；用户访问授权、配额及费用控制仍由部署方实现。

`route-server.mjs` 是仅供本机测试的适配层，不用于部署。它没有生产访问控制。自动对比结束时会关闭本次启动的所有服务。

有轻量服务和模拟模型服务运行时，可分别调试单版本：`bun security-lab/reproduce.mjs vulnerable` 或 `bun security-lab/reproduce.mjs fixed`。`bun security-lab/self-test.mjs` 仅验证测试工具对模拟应用的判定逻辑，不能作为真实分支通过的证据。
