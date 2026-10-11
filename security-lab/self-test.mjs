import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSuite } from './reproduce.mjs';

// Harness test only: the app below is a fixture, not either OpenMAIC branch.
if (!globalThis.Bun) throw new Error('Run with Bun');
const lab = path.dirname(fileURLToPath(import.meta.url));
let mode = 'vulnerable';
let app;
const mock = Bun.spawn([process.execPath, path.join(lab, 'mock-provider.mjs')], {
  stdout: 'inherit',
  stderr: 'inherit',
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (mock.exitCode !== null) throw new Error('Mock failed to start; check port 18080');
    try {
      ready = (await fetch('http://127.0.0.1:18080/__lab/stats')).ok;
    } catch {
      /* Starting. */
    }
    if (ready) break;
    await Bun.sleep(100);
  }
  assert.ok(ready, 'Mock must be ready');
  app = Bun.serve({
    hostname: '127.0.0.1',
    port: 3000,
    async fetch(request) {
      const body = await request.json();
      const chat = new URL(request.url).pathname === '/api/chat';
      const routed = request.headers.get('x-model-routes');
      const ref = routed ? JSON.parse(routed)['chat-adapter'].model : body.model;
      const model = ref.split(':').at(-1);
      const denied = mode !== 'vulnerable' && model !== 'lab-approved';
      if (denied && mode === 'fixed')
        return Response.json({ error: 'Unauthorized lab model' }, { status: 403 });
      const upstream = await fetch('http://127.0.0.1:18080/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer sk-openmaic-security-lab-fake',
        },
        body: JSON.stringify({ model, stream: false }),
      });
      const response = await upstream.json();
      if (denied) return Response.json({ error: 'Unauthorized lab model' }, { status: 403 });
      if (!upstream.ok) return Response.json({ error: 'Model not found' }, { status: 500 });
      const text = response.choices[0].message.content;
      return chat
        ? new Response(`data: ${text}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
        : Response.json({ response: text });
    },
  });
  const before = await runSuite('vulnerable');
  assert.equal(before.length, 6);
  assert.ok(before.every((result) => result.passed));
  mode = 'fixed';
  const after = await runSuite('fixed');
  assert.ok(after.every((result) => result.passed));
  mode = 'broken';
  const broken = await runSuite('fixed');
  assert.equal(broken.length, 6, 'Failures must not abort remaining scenarios');
  assert.equal(
    broken.filter((result) => !result.passed).length,
    5,
    '403 with upstream use must fail',
  );
  console.log(
    'PASS: Bun harness detects vulnerable/fixed fixtures and rejects hidden upstream use. This does not verify OpenMAIC branches.',
  );
} finally {
  app?.stop(true);
  mock.kill();
  await mock.exited;
}
