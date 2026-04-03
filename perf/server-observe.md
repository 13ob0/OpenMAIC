# 目标机（10.1.20.245）观测建议

压测时在**服务端**抽样，才能区分 **Node/Next 自身** 与 **上游 LLM**。客户端 k6 指标无法替代下列观测。

## 1. 资源

| 项 | 工具/命令 | 说明 |
|----|-----------|------|
| CPU / 内存 | `top`、`htop`、任务管理器；Docker 则用 `docker stats` | 关注 Node 进程是否单核打满 |
| 磁盘 I/O | `iostat -x 1`（Linux） | 若压测 `/api/generate-classroom` 等写 `data/` 时关注 |
| 打开文件数 | `lsof -p <pid> \| wc -l` 或 `/proc/<pid>/fd` | 高并发 SSE 时 FD 是否逼近 `ulimit -n` |

## 2. 日志时间对齐

- 使用 **UTC 或同一时区**，记录压测窗口起止时间（与 k6 报告中的 `time` 一致）。
- Next.js：查看运行实例标准输出中的 `[Chat API]`、`Processing request` 等（见应用内 `createLogger`）。
- 若前有 **Nginx/Caddy**：记录 `upstream_response_time`、`status`，区分 **499/502/504**。

## 3. 与 k6 对齐

1. 记录压测命令与 **BASE_URL**、**SCENARIO**、**CHAT_MAX_VUS** 等参数。
2. 在目标机记录 **进程启动时间**（避免把旧日志算进本次）。
3. 若使用 systemd / PM2：记录 **重启次数**（Soak 时关注泄漏导致的 OOM 重启）。

## 4. 可选：短期采集脚本

Linux 上可在压测窗口内每秒一行：

```bash
PID=<node_pid>
while true; do date -Iseconds; ps -p "$PID" -o %cpu,rss=; sleep 1; done >> /tmp/openmaic-perf-observe.log
```

（将输出与 k6 JSON 导出文件一并存档，便于报告中的瓶颈归因。）
