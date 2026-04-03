# OpenMAIC 生产部署说明

## 架构概要

- **Nginx**：对外监听（示例 `2024`），反向代理到本机 Next.js。
- **Next.js**：`pnpm build` 后 `pnpm start`（或由 **PM2** 托管多进程）。
- **长请求 / SSE**：必须在 Nginx 层设置足够超时并关闭 SSE 路径的缓冲，见 [`nginx/openmaic.conf.example`](nginx/openmaic.conf.example)。

## Nginx

1. 复制并编辑示例配置：

   - [`nginx/openmaic.conf.example`](nginx/openmaic.conf.example) — 单上游端口（可与 PM2 cluster 单端口配合）。
   - 多端口 upstream 片段：[`nginx/openmaic-upstream-multiport.conf.example`](nginx/openmaic-upstream-multiport.conf.example)。

2. 校验并重载：

   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```

3. **HTTPS**：若在外层终止 TLS，请保留 `X-Forwarded-Proto`；若 Next 需原始 Host，可追加 `proxy_set_header X-Forwarded-Host $host;`（按域名策略调整）。

## PM2（可选）

| 文件 | 说明 |
|------|------|
| [ecosystem.config.cjs](../ecosystem.config.cjs) | `cluster` + 默认 `PORT=1024`，与单端口 Nginx 配合 |
| [ecosystem.fork-multiport.config.cjs](../ecosystem.fork-multiport.config.cjs) | 多端口 fork，需 Nginx `upstream` 多 `server` |

```bash
pnpm install
pnpm build
pm2 start ecosystem.config.cjs
pm2 save
```

## 课堂生成与多实例（必读）

以下能力与 **单机磁盘** 或 **单进程内存** 绑定，**多机或多 PM2 worker 并发写同一目录**时可能出现竞态或状态不一致：

- 本地目录：`data/classrooms`、`data/classroom-jobs`（见 `lib/server/classroom-storage.ts`）。
- 进程内任务表：`runningJobs`（见 `lib/server/classroom-job-runner.ts`）。

**建议**：

- 以 **无状态 API**（如 `/api/chat`、`/api/health`）为主的横向扩展相对安全。
- 若生产大量使用 **课堂生成 / 任务轮询** API：使用 **单写实例**、**外置队列 + 单 worker**，或对相关路径做 **Nginx 粘性 / 独立子域** 指到固定实例。

## 性能测试

见仓库 [`perf/README.md`](../perf/README.md)。经 Nginx 暴露的端口压测可覆盖超时与缓冲行为；需对比瓶颈时可同时测 **直连 Next 端口** 与 **经 Nginx**。
