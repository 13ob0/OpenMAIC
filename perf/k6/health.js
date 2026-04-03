/**
 * k6: GET /api/health
 *
 * 环境变量:
 *   BASE_URL       默认 http://10.1.20.245:2024
 *   SCENARIO       load | spike | soak（默认 load）
 *   SOAK_DURATION  soak 场景时长（默认 10m，正式浸泡可设 2h）
 *
 * 示例:
 *   k6 run perf/k6/health.js
 *   k6 run -e SCENARIO=spike perf/k6/health.js
 *   k6 run -e SCENARIO=soak -e SOAK_DURATION=2h perf/k6/health.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');
const baseUrl = (__ENV.BASE_URL || 'http://10.1.20.245:2024').replace(/\/$/, '');
const scenario = (__ENV.SCENARIO || 'load').toLowerCase();

const soakDuration = __ENV.SOAK_DURATION || '10m';

const scenarioMap = {
  load: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '1m', target: 10 },
      { duration: '3m', target: 50 },
      { duration: '3m', target: 100 },
      { duration: '2m', target: 0 },
    ],
    gracefulRampDown: '30s',
  },
  spike: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '30s', target: 10 },
      { duration: '10s', target: 100 },
      { duration: '2m', target: 100 },
      { duration: '1m', target: 0 },
    ],
    gracefulRampDown: '20s',
  },
  soak: {
    executor: 'constant-vus',
    vus: 20,
    duration: soakDuration,
  },
};

const activeScenario = scenarioMap[scenario] || scenarioMap.load;

export const options = {
  scenarios: {
    health: activeScenario,
  },
  thresholds: {
    // 同机房 health 可收紧；跨机或 CI 可适当放宽
    http_req_failed: ['rate<0.001'],
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    errors: ['rate<0.001'],
  },
};

export default function () {
  const res = http.get(`${baseUrl}/api/health`, {
    tags: { name: 'health' },
  });
  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'body has status ok': (r) => {
      try {
        const j = JSON.parse(r.body);
        // apiSuccess spreads fields: { success: true, status: 'ok', version, ... }
        return j.success === true && j.status === 'ok';
      } catch {
        return false;
      }
    },
  });
  errorRate.add(!ok);
  sleep(0.05);
}
