import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

if (!globalThis.Bun) throw new Error('Run this integration harness with Bun');
const root = path.resolve(process.argv[2] || process.cwd());
process.chdir(root);

// This harness does not import instrumentation.ts or bootstrap any database.
// Use the real anonymous-owner path with no workspace persistence.
process.env.DATABASE_URL = '';
process.env.OWNER_SINGLE_USER = '';
process.env.OWNER_SINGLE_USER_ID = '';
process.env.PERSISTENCE_SHARED_OWNER_ID = '';
if (
  process.env.OPENAI_API_KEY !== 'sk-openmaic-security-lab-fake' ||
  process.env.OPENAI_BASE_URL !== 'http://127.0.0.1:18080/v1'
) {
  throw new Error('Harness requires the fixed local fake provider configuration');
}

// Resolve this branch's actual TypeScript source, including workspace packages.
// No route, identity, authorization, orchestration or AI SDK function is mocked.
Bun.plugin({
  name: 'security-lab-branch-source',
  setup(builder) {
    builder.onResolve({ filter: /^@\// }, (args) => {
      const base = path.join(root, args.path.slice(2));
      for (const candidate of [
        base + '.ts',
        base + '.tsx',
        base + '.js',
        path.join(base, 'index.ts'),
      ]) {
        if (existsSync(candidate)) return { path: candidate };
      }
    });
    builder.onResolve({ filter: /^@openmaic\// }, (args) => {
      const match = /^@openmaic\/([^/]+)(?:\/(.+))?$/.exec(args.path);
      if (!match) return;
      const directory = path.join(root, 'packages/@openmaic', match[1]);
      const subpath = match[2] || 'index';
      for (const candidate of [
        path.join(directory, 'src', subpath + '.ts'),
        path.join(directory, 'src', subpath, 'index.ts'),
      ]) {
        if (existsSync(candidate)) return { path: candidate };
      }
    });
  },
});

const require = createRequire(path.join(root, 'package.json'));
const { NextRequest } = await import(pathToFileURL(require.resolve('next/server')).href);
const { POST: verify } = await import(
  pathToFileURL(path.join(root, 'app/api/verify-model/route.ts')).href
);
const { POST: chat } = await import(pathToFileURL(path.join(root, 'app/api/chat/route.ts')).href);
const routes = new Map([
  ['/api/verify-model', verify],
  ['/api/chat', chat],
]);

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 3000,
  async fetch(request) {
    const route = new URL(request.url).pathname;
    if (request.method === 'GET' && route === '/__lab/health') {
      return Response.json({
        status: 'ok',
        scope: 'real-route-handler-integration',
        database: false,
      });
    }
    const handler = routes.get(route);
    if (!handler) return new Response('Not found', { status: 404 });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    try {
      return await handler(new NextRequest(request));
    } catch (error) {
      console.error('Real route handler failed:', error);
      return Response.json({ error: 'Route handler integration failure' }, { status: 500 });
    }
  },
});
console.log(`Real route handler integration harness: ${server.url}; database disabled`);
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.stop(true);
    process.exit(0);
  });
}
