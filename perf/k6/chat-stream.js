/**
 * k6: POST /api/chat（SSE，会拉满上游 LLM）
 *
 * 指标: http_req_waiting ≈ TTFB；http_req_duration = 完整流结束时间
 *
 * 环境变量:
 *   BASE_URL                 默认 http://10.1.20.245:2024
 *   API_KEY                  可选；省略则依赖服务端 resolveApiKey（须 requiresApiKey: false）
 *   MODEL                    可选模型字符串
 *   CHAT_PROMPT              短提示（控制费用，默认 "Reply with exactly: OK"）
 *   CHAT_MAX_VUS             最大 VU（默认 5）
 *   CHAT_SHARED_ITERATIONS   总迭代次数上限（默认 30，防止误跑爆配额）
 *   CHAT_SLEEP_MS            每轮迭代间隔（默认 500）
 *
 * 示例:
 *   k6 run perf/k6/chat-stream.js
 *   k6 run -e API_KEY=sk-... -e CHAT_MAX_VUS=10 -e CHAT_SHARED_ITERATIONS=50 perf/k6/chat-stream.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Counter } from 'k6/metrics';

const errorRate = new Rate('chat_errors');
const sseDataLines = new Counter('sse_data_lines');

const baseUrl = (__ENV.BASE_URL || 'http://10.1.20.245:2024').replace(/\/$/, '');
const maxVus = Number(__ENV.CHAT_MAX_VUS || 5);
const sharedIterations = Number(__ENV.CHAT_SHARED_ITERATIONS || 30);
const sleepMs = Number(__ENV.CHAT_SLEEP_MS || 500);
const prompt = __ENV.CHAT_PROMPT || 'Reply with exactly: OK';

function buildPayload() {
  const apiKey = __ENV.API_KEY || '';
  return JSON.stringify({
    messages: [
      {
        id: 'perf-user-1',
        role: 'user',
        parts: [{ type: 'text', text: prompt }],
      },
    ],
    storeState: {
      stage: null,
      scenes: [],
      currentSceneId: null,
      mode: 'autonomous',
      whiteboardOpen: false,
    },
    config: {
      agentIds: ['default-1'],
      sessionType: 'qa',
    },
    apiKey,
    ...(__ENV.MODEL ? { model: __ENV.MODEL } : {}),
    requiresApiKey: false,
  });
}

const payload = buildPayload();

export const options = {
  scenarios: {
    chat_sse: {
      executor: 'shared-iterations',
      vus: maxVus,
      iterations: sharedIterations,
      maxDuration: '45m',
    },
  },
  thresholds: {
    // 全链路依赖上游，仅作粗阈值；失败多为 429/5xx/超时
    http_req_failed: ['rate<0.15'],
    http_req_waiting: ['p(95)<30000'],
    chat_errors: ['rate<0.15'],
  },
};

export default function () {
  const params = {
    headers: { 'Content-Type': 'application/json' },
    timeout: '120s',
    tags: { name: 'chat_sse' },
  };

  const res = http.post(`${baseUrl}/api/chat`, payload, params);

  const body = res.body || '';
  const dataLineMatches = body.match(/^data: /gm);
  if (dataLineMatches) {
    sseDataLines.add(dataLineMatches.length);
  }

  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'content-type sse': (r) =>
      (r.headers['Content-Type'] || '').includes('text/event-stream'),
    'has data event': () => body.includes('data:'),
  });

  errorRate.add(!ok);
  sleep(sleepMs / 1000);
}
