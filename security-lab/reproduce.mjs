import { fileURLToPath } from 'node:url';

export const scenarios = [
  { id: 'approved-control', label: '授权型号对照', model: 'lab-approved', allowed: true },
  { id: 'probe-unapproved', label: '探测可用但未授权型号', model: 'lab-unapproved' },
  { id: 'probe-missing', label: '探测不存在型号', model: 'lab-missing', missing: true },
  { id: 'saved-provider', label: '保存供应商引用绕过', model: 'lab-unapproved', saved: true },
  { id: 'chat-body', label: '伪造聊天模型字段', model: 'lab-unapproved', chat: true },
  {
    id: 'chat-route',
    label: '伪造聊天阶段路由',
    model: 'lab-unapproved',
    chat: true,
    routed: true,
  },
];

function chatBody(model) {
  return {
    model,
    apiKey: '',
    messages: [
      {
        id: 'lab-question',
        role: 'user',
        parts: [{ type: 'text', text: 'Say LOCAL LAB RESPONSE.' }],
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
      agentIds: ['lab-teacher'],
      sessionType: 'qa',
      agentConfigs: [
        {
          id: 'lab-teacher',
          name: 'Lab Teacher',
          role: 'teacher',
          persona: 'Answer briefly.',
          avatar: '',
          color: '#000000',
          allowedActions: [],
          priority: 1,
        },
      ],
    },
  };
}

export async function runSuite(expected, { timeout = 120000 } = {}) {
  if (!['vulnerable', 'fixed'].includes(expected)) throw new Error('Expected vulnerable or fixed');
  const stats = async () => {
    const response = await fetch('http://127.0.0.1:18080/__lab/stats', {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Mock stats HTTP ${response.status}`);
    return (await response.json()).calls;
  };
  const results = [];
  for (const scenario of scenarios) {
    const route = scenario.chat ? '/api/chat' : '/api/verify-model';
    const body = scenario.chat
      ? chatBody(`openai:${scenario.routed ? 'lab-approved' : scenario.model}`)
      : scenario.saved
        ? { provider: 'openai', model: scenario.model }
        : { model: `openai:${scenario.model}` };
    const headers = { 'content-type': 'application/json' };
    if (scenario.routed)
      headers['x-model-routes'] = JSON.stringify({
        'chat-adapter': { model: 'openai:lab-unapproved' },
      });
    const result = {
      id: scenario.id,
      label: scenario.label,
      request: { path: route, body, headers },
      expectedStatus:
        expected === 'fixed' && !scenario.allowed ? 403 : scenario.missing ? 500 : 200,
      status: null,
      upstream: [],
      outputObserved: false,
      passed: false,
      failures: [],
    };
    let before;
    try {
      before = (await stats()).length;
      const response = await fetch(`http://127.0.0.1:3000${route}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
      result.status = response.status;
      const text = await response.text();
      result.response = text.slice(0, 16000);
      result.responseTruncated = text.length > 16000;
      result.outputObserved = text.includes('LOCAL LAB RESPONSE');
    } catch (error) {
      result.failures.push(`请求失败: ${error.message}`);
    } finally {
      if (before !== undefined) {
        try {
          result.upstream = (await stats()).slice(before);
        } catch (error) {
          result.failures.push(`上游记录读取失败: ${error.message}`);
        }
      }
    }
    if (result.status !== result.expectedStatus)
      result.failures.push(`期望 HTTP ${result.expectedStatus}，实际 ${result.status}`);
    if (expected === 'fixed' && !scenario.allowed) {
      if (result.upstream.length !== 0) result.failures.push('拒绝请求仍然调用了上游');
      if (result.outputObserved) result.failures.push('拒绝请求仍然返回了模型输出');
    } else {
      if (!result.upstream.length) result.failures.push('没有观察到上游推理调用');
      if (
        !result.upstream.every((call) => call.serverCredentialUsed && call.model === scenario.model)
      )
        result.failures.push('上游型号或虚拟服务端凭据不匹配');
      if (!scenario.missing && !result.outputObserved) result.failures.push('没有观察到模型输出');
    }
    result.passed = result.failures.length === 0;
    results.push(result);
    console.log(
      `${result.passed ? 'PASS' : 'FAIL'} ${scenario.label}: HTTP ${result.status}, 上游 ${result.upstream.length}`,
    );
  }
  return results;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const results = await runSuite(process.argv[2]);
  console.log(JSON.stringify(results, null, 2));
  process.exitCode = results.every((result) => result.passed) ? 0 : 1;
}
