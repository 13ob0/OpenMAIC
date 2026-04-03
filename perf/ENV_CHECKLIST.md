# 压测前环境核对清单（内网 OpenMAIC）

在运行 [k6 脚本目录](k6/) 下脚本前，请逐项确认。

## 网络与访问

- [ ] 压测机与目标 `10.1.20.245` **二层/路由互通**（同网段或经 VPN/专线）
- [ ] 防火墙/安全组放行 **源 → 10.1.20.245:2024**（TCP）
- [ ] 无透明代理对 SSE 做缓冲截断（必要时对 `/api/chat` 关闭缓冲）
- [ ] 从压测机执行：`curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/api/health"` 返回 `200`

## 时间与对齐

- [ ] 压测机与目标机 **NTP 同步**（误差建议 &lt; 1s），便于对照访问日志与应用日志

## 环境变量（k6）

| 变量 | 说明 | 示例 |
|------|------|------|
| `BASE_URL` | 服务根 URL，**无尾部斜杠** | `http://10.1.20.245:2024` |
| `SCENARIO` | health 脚本场景：`load` / `spike` / `soak` | `load` |
| `SOAK_DURATION` | soak 场景持续时间 | `2h`（正式浸泡）或 `10m`（试跑） |
| `API_KEY` | `/api/chat` 用（可选；可与服务端环境变量二选一） | （保密） |
| `MODEL` | 模型字符串（可选） | `openai/gpt-4o-mini` |
| `CHAT_PROMPT` | 短提示，控制输出长度与费用 | `Reply with exactly: OK` |
| `CHAT_MAX_VUS` 等 | 见 [perf/README.md](README.md) | |

## 合规

- [ ] 已获得对 **目标环境** 做压测的书面/流程授权
- [ ] **非生产** 或已窗口通知；避免对共享上游 Key 做无上限 `/api/chat` 压测
