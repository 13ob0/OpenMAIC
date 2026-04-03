# OpenMAIC 性能测试（k6）

目标默认地址：`http://10.1.20.245:2024`（可通过 `BASE_URL` 覆盖）。

## 安装 k6

- Windows：见 [k6 安装文档](https://grafana.com/docs/k6/latest/set-up/install-k6/)（如 `choco install k6` 或官方安装包）
- macOS：`brew install k6`
- Linux：按发行版安装 `.deb`/`.rpm`

验证：`k6 version`

## 快速开始

```bash
# 仅探活（无上游 LLM，适合先跑）
set BASE_URL=http://10.1.20.245:2024
k6 run perf/k6/health.js
```

### Health 场景切换

通过环境变量 `SCENARIO`：

| 值 | 说明 |
|----|------|
| `load`（默认） | 阶梯升压 VUs，约 8 分钟 |
| `spike` | 短时尖峰 VUs |
| `soak` | 长时低负载；时长由 `SOAK_DURATION` 控制（默认 `10m`，正式建议 `2h`） |

```bash
k6 run -e SCENARIO=spike perf/k6/health.js
k6 run -e SCENARIO=soak -e SOAK_DURATION=2h perf/k6/health.js
```

### Chat（SSE，会调用上游 LLM）

**会产生费用与配额消耗**，请先设短提示与低并发。

```bash
k6 run -e BASE_URL=http://10.1.20.245:2024 ^
  -e API_KEY=your-key ^
  -e MODEL=openai/gpt-4o-mini ^
  -e CHAT_MAX_VUS=5 ^
  -e CHAT_SHARED_ITERATIONS=30 ^
  perf/k6/chat-stream.js
```

若 Key 仅配置在服务端，可省略 `API_KEY`（脚本默认 `requiresApiKey: false`，依赖服务端 `resolveApiKey`）。

## 输出 JSON（可选）

```bash
k6 run --out json=perf/results/health-summary.json perf/k6/health.js
```

建议将 `perf/results/` 加入本地忽略（见 `.gitignore`），勿提交含敏感路径的日志。

## 脚本说明

| 文件 | 用途 |
|------|------|
| [perf/k6/health.js](k6/health.js) | `GET /api/health` 阶梯 / 尖峰 / 浸泡 |
| [perf/k6/chat-stream.js](k6/chat-stream.js) | `POST /api/chat` SSE，采集 TTFB 与完整流耗时 |

## Nginx 与直连 Next 对比验证

生产环境若经 **Nginx** 对外（示例端口 `2024`）再反代到本机 Next（如 `1024`），压测时应至少验证：

1. **`BASE_URL` 指向 Nginx**（如 `http://<host>:2024`），使结果包含代理超时、缓冲行为。
2. **回归长流**：对 `/api/chat` 或 `maxDuration` 较大的流式接口做一次手工或 k6 试跑，确认 **无 504**（若 Nginx `proxy_read_timeout` 过短会先于此处失败）。
3. **可选对照**：同一脚本将 `BASE_URL` 改为 `http://127.0.0.1:1024`（仅服务器本机、且防火墙允许时）对比 p95，用于区分瓶颈在 **Nginx** 还是 **Next/上游 LLM**。

Nginx 示例配置见 [deploy/nginx/openmaic.conf.example](../deploy/nginx/openmaic.conf.example)。

## 相关文档

- [ENV_CHECKLIST.md](ENV_CHECKLIST.md) — 压测前核对项
- [server-observe.md](server-observe.md) — 目标机观测建议
- [REPORT_TEMPLATE.md](REPORT_TEMPLATE.md) — 报告模板
- [deploy/README.md](../deploy/README.md) — Nginx / PM2 / 多实例说明
