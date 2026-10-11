import http from 'node:http';
import assert from 'node:assert/strict';

const key = 'sk-openmaic-security-lab-fake';
const models = new Set(['lab-approved', 'lab-unapproved']);
const calls = [];
const json = (res, status, value) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/__lab/stats') {
    return json(res, 200, { calls });
  }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    return json(res, 404, { error: { message: 'Unknown lab endpoint' } });
  }
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 256 * 1024) return json(res, 413, { error: { message: 'Lab body limit' } });
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const serverCredentialUsed = req.headers.authorization === `Bearer ${key}`;
    calls.push({ model: body.model, stream: body.stream === true, serverCredentialUsed });
    if (!serverCredentialUsed) {
      return json(res, 401, { error: { message: 'Only the fake lab credential is accepted' } });
    }
    if (!models.has(body.model)) {
      return json(res, 404, { error: { message: 'Lab model does not exist' } });
    }
    const content = JSON.stringify([{ type: 'text', content: 'LOCAL LAB RESPONSE' }]);
    const common = { id: 'chatcmpl-lab', created: 1, model: body.model };
    if (body.stream === true) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const event = (delta, finish_reason) =>
        `data: ${JSON.stringify({ ...common, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
      res.write(event({ role: 'assistant', content }, null));
      res.write(event({}, 'stop'));
      res.end('data: [DONE]\n\n');
    } else {
      json(res, 200, {
        ...common,
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }
  } catch {
    if (!res.headersSent) json(res, 400, { error: { message: 'Invalid lab request' } });
    else res.end();
  }
});

if (process.argv.includes('--self-test')) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const root = `http://127.0.0.1:${server.address().port}`;
    for (const [model, status, stream] of [
      ['lab-approved', 200, false],
      ['lab-unapproved', 200, true],
      ['lab-missing', 404, false],
    ]) {
      const response = await fetch(`${root}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, stream }),
      });
      assert.equal(response.status, status);
      const text = await response.text();
      if (status === 200) assert.ok(text.includes('LOCAL LAB RESPONSE'));
      if (stream) assert.ok(text.includes('[DONE]'));
    }
    const denied = await fetch(`${root}/v1/chat/completions`, {
      method: 'POST',
      body: JSON.stringify({ model: 'lab-approved' }),
    });
    assert.equal(denied.status, 401);
    await denied.text();
    const stats = await (await fetch(`${root}/__lab/stats`)).json();
    assert.equal(stats.calls.length, 4);
    console.log('PASS: mock JSON, SSE, model rejection, credential check and call recording');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
} else {
  server.listen(18080, '127.0.0.1', () => {
    console.log('Local fake provider: http://127.0.0.1:18080/v1');
    console.log('Call records: http://127.0.0.1:18080/__lab/stats');
  });
}
