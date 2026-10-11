import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSuite, scenarios } from './reproduce.mjs';

if (!globalThis.Bun) throw new Error('Run with Bun: bun security-lab/compare.mjs');
const lab = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(lab);
const artifacts = path.join(lab, 'artifacts');
const output = path.join(artifacts, `report-${Date.now()}`);
await mkdir(output, { recursive: true });
const report = {
  startedAt: new Date().toISOString(),
  bunVersion: Bun.version,
  status: 'BLOCKED',
  scope: 'Real route handler integration over HTTP; no Next bootstrap, middleware or database',
  before: { branch: 'main', results: [] },
  after: { branch: 'fix/fix-p0-model-probing-and-api-proxy-abuse', results: [] },
  errors: [],
};
const processes = new Set();
let originalRef;
let originalDetached = false;
let switched = false;
async function git(args, { allowFailure = false } = {}) {
  const child = Bun.spawn(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const code = await child.exited;
  if (code !== 0 && !allowFailure) throw new Error(`git ${args.join(' ')}: ${stderr.trim()}`);
  return { code, text: stdout.trim() };
}

function start(command, cwd, env, name) {
  const log = path.join(output, `${name}.log`);
  const fd = openSync(log, 'w');
  const child = Bun.spawn(command, { cwd, env, stdout: fd, stderr: fd, stdin: 'ignore' });
  const item = { child, fd, log };
  processes.add(item);
  return item;
}
async function stop(item) {
  if (!processes.has(item)) return;
  if (item.child.exitCode === null) {
    if (process.platform === 'win32') {
      // Next may spawn a worker. Stop only the tree started by this run.
      const killer = Bun.spawn(['taskkill', '/PID', String(item.child.pid), '/T', '/F'], {
        stdout: 'ignore',
        stderr: 'ignore',
      });
      await killer.exited;
    } else {
      item.child.kill('SIGTERM');
    }
    await Promise.race([item.child.exited, Bun.sleep(5000)]);
    if (item.child.exitCode === null) {
      item.child.kill('SIGKILL');
      await item.child.exited;
    }
  }
  closeSync(item.fd);
  processes.delete(item);
}
async function portOpen(port) {
  try {
    const socket = await Bun.connect({
      hostname: '127.0.0.1',
      port,
      socket: { data() {}, error() {}, close() {} },
    });
    socket.end();
    return true;
  } catch {
    return false;
  }
}
async function ready(url, item, limit = 180000) {
  const deadline = Date.now() + limit;
  while (Date.now() < deadline) {
    if (item.child.exitCode !== null) throw new Error(await startupFailure(item));
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      await response.text();
      if (response.ok) return;
    } catch {
      /* Wait for compilation or startup. */
    }
    await Bun.sleep(1000);
  }
  throw new Error(await startupFailure(item, '服务启动超时'));
}
async function startupFailure(item, reason = '服务提前退出') {
  let log = '';
  try {
    log = await readFile(item.log, 'utf8');
  } catch {
    /* Log may not exist yet. */
  }
  const details = [];
  if (log.includes('DATABASE_URL is not set')) details.push('应用缺少 DATABASE_URL 配置');
  const packages = [
    ...new Set(
      [...log.matchAll(/Can't resolve '(@openmaic\/[a-zA-Z0-9-]+)'/g)].map((match) => match[1]),
    ),
  ];
  if (packages.length) details.push(`缺少工作区包构建产物: ${packages.join(', ')}`);
  return `${reason}${details.length ? `：${details.join('；')}` : ''}，检查 ${item.log}`;
}
function markdown() {
  const cell = (value) =>
    String(value ?? '未执行')
      .replaceAll('|', '\\|')
      .replaceAll('\n', ' ');
  const describe = (value) =>
    value
      ? `HTTP ${value.status ?? '无响应'} / 上游 ${value.upstream.length} / 输出 ${value.outputObserved ? '有' : '无'} / ${value.passed ? 'PASS' : 'FAIL'}`
      : 'NOT_RUN';
  const lines = [
    '# OpenMAIC 模型授权路由处理器集成测试报告',
    '',
    `运行状态：**${report.status}**`,
    '',
    `开始：${report.startedAt}；结束：${report.finishedAt}；Bun：${report.bunVersion}`,
    '',
    `修复前：\`${report.before.branch}\`，提交 \`${report.before.commit ?? '未读取'}\`。`,
    '',
    `修复后：\`${report.after.branch}\`，提交 \`${report.after.commit ?? '未读取'}\`。`,
    '',
    '使用本机模拟模型服务及虚拟凭据，不进行真实付费模型调用。HTTP 200 必须同时有目标型号的上游调用和模型输出；修复后的拒绝必须是 HTTP 403 且没有新增上游调用。',
    '',
    '测试通过轻量 Bun HTTP 服务调用当前分支的真实 POST 路由处理器，保留真实模型解析、匿名身份、授权规则、聊天编排及 AI SDK 调用。未启动完整 Next 应用、instrumentation、middleware 或数据库；工作区配置为空。此报告不等同于完整部署的端到端测试。',
    '',
    '| 场景 | main 修复前 | 修复分支 |',
    '| --- | --- | --- |',
    ...scenarios.map(
      (scenario) =>
        `| ${scenario.label} | ${cell(describe(report.before.results.find((r) => r.id === scenario.id)))} | ${cell(describe(report.after.results.find((r) => r.id === scenario.id)))} |`,
    ),
    '',
    '## 失败与阻塞详情',
    '',
    ...[
      ...report.errors,
      ...['before', 'after'].flatMap((name) =>
        report[name].results.flatMap((result) =>
          result.failures.map((failure) => `${report[name].branch} / ${result.label}: ${failure}`),
        ),
      ),
    ].map((error) => `- ${cell(error)}`),
  ];
  if (
    !report.errors.length &&
    [...report.before.results, ...report.after.results].every((result) => result.passed)
  )
    lines.push('未记录失败。');
  lines.push(
    '',
    '## 判定范围',
    '',
    report.status === 'PASS'
      ? '六项修复前预期和六项修复后预期均满足，本次覆盖的未授权型号探测与聊天调用被阻断。'
      : '本次运行未证明修复完整通过；NOT_RUN、启动失败和依赖缺失不能作为漏洞已修复的证据。',
    '',
    '授权型号在匿名测试环境中仍可调用。该结果不证明所有反向代理滥用均已阻断；用户访问授权、配额和费用控制仍由部署方实现。未覆盖 Pi、YAML 槽位、工作区设置和模型选择界面。',
    '',
    '在原工作区切换两个分支，复用已有依赖，直接加载分支内 TypeScript 和工作区包源码。测试子进程禁用 .env 自动加载，DATABASE_URL 为空；现有 .env.local 不被读取或修改。',
    '',
    '完整请求、最多 16000 字符的响应和每次请求的上游记录见同目录 report.json；服务日志见 *.log。',
    '',
  );
  return lines.join('\n');
}

try {
  if (process.argv.includes('--prepare'))
    throw new Error('现在无需准备快照；直接运行 bun security-lab/compare.mjs');
  const trackedChanges = (await git(['status', '--porcelain', '--untracked-files=no'])).text;
  if (trackedChanges)
    throw new Error(
      '存在未提交的已跟踪文件更改，请先自行提交或保存；脚本不会自动 stash 或丢弃更改',
    );
  const branch = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true });
  originalDetached = branch.code !== 0;
  originalRef = originalDetached ? (await git(['rev-parse', 'HEAD'])).text : branch.text;
  for (const name of ['before', 'after']) {
    report[name].commit = (
      await git(['rev-parse', '--verify', `${report[name].branch}^{commit}`])
    ).text;
  }
  const beforeLock = (await git(['show', `${report.before.commit}:pnpm-lock.yaml`])).text;
  const afterLock = (await git(['show', `${report.after.commit}:pnpm-lock.yaml`])).text;
  if (beforeLock !== afterLock) throw new Error('两个分支依赖锁不同，不能直接复用依赖做接口对比');
  if (!(await Bun.file(path.join(root, 'node_modules/next/package.json')).exists()))
    throw new Error('现有项目第三方依赖未就绪，请先按项目常规方式安装依赖');
  for (const filename of ['openmaic.yml', 'server-providers.yml']) {
    if (await Bun.file(path.join(root, filename)).exists())
      throw new Error(
        `${filename} 会优先于模拟供应商配置；此脚本需要旧式环境变量配置路径，请在适合该测试的工作区运行`,
      );
  }
  const blockers = [];
  const env = {};
  for (const name of [
    'PATH',
    'Path',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'HOME',
    'USERPROFILE',
    'LOCALAPPDATA',
    'APPDATA',
    'COMSPEC',
    'PATHEXT',
    'SystemDrive',
  ]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  const template = await readFile(path.join(lab, 'env.example'), 'utf8');
  for (const line of template.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const equal = line.indexOf('=');
    if (equal > 0) env[line.slice(0, equal)] = line.slice(equal + 1);
  }
  env.NEXT_TELEMETRY_DISABLED = '1';
  env.NODE_ENV = 'development';
  env.DATABASE_URL = '';
  if (
    env.OPENAI_BASE_URL !== 'http://127.0.0.1:18080/v1' ||
    env.OPENAI_API_KEY !== 'sk-openmaic-security-lab-fake'
  )
    throw new Error('实验只能使用固定本机上游与虚拟凭据');
  for (const port of [3000, 18080])
    if (await portOpen(port)) blockers.push(`端口 ${port} 已被占用；脚本不会停止已有服务`);
  if (blockers.length) throw new Error(blockers.join('；'));
  // Preserve the mock entry across branch switches, even if security-lab is tracked on only one branch.
  const mockEntry = path.join(output, 'mock-runtime.mjs');
  await writeFile(mockEntry, await readFile(path.join(lab, 'mock-provider.mjs'), 'utf8'));
  const routeEntry = path.join(output, 'route-runtime.mjs');
  await writeFile(routeEntry, await readFile(path.join(lab, 'route-server.mjs'), 'utf8'));
  report.status = 'FAIL';
  const mock = start([process.execPath, '--no-env-file', mockEntry], output, env, 'mock');
  await ready('http://127.0.0.1:18080/__lab/stats', mock, 10000);
  for (const [name, expected] of [
    ['before', 'vulnerable'],
    ['after', 'fixed'],
  ]) {
    let app;
    try {
      console.log(`切换到 ${report[name].branch} 并测试接口`);
      await git(['switch', report[name].branch]);
      switched = true;
      if ((await git(['rev-parse', 'HEAD'])).text !== report[name].commit)
        throw new Error('分支提交在测试期间发生变化，请重新运行');
      const cwd = root;
      app = start([process.execPath, '--no-env-file', routeEntry, root], cwd, env, name);
      await ready('http://127.0.0.1:3000/__lab/health', app);
      report[name].results = await runSuite(expected);
    } catch (error) {
      report.errors.push(`${report[name].branch}: ${error.message}`);
    } finally {
      if (app) await stop(app);
    }
  }
  const before = report.before.results;
  const after = report.after.results;
  const unauthorized = after.find((result) => result.id === 'probe-unapproved');
  const missing = after.find((result) => result.id === 'probe-missing');
  if (
    unauthorized?.status === 403 &&
    missing?.status === 403 &&
    unauthorized.response !== missing.response
  )
    report.errors.push('修复后两种探测的拒绝响应内容不一致');
  if (
    !report.errors.length &&
    before.length === scenarios.length &&
    after.length === scenarios.length &&
    [...before, ...after].every((result) => result.passed)
  )
    report.status = 'PASS';
} catch (error) {
  report.errors.push(error.message);
} finally {
  for (const item of [...processes]) await stop(item);
  if (switched && originalRef) {
    try {
      await git(originalDetached ? ['switch', '--detach', originalRef] : ['switch', originalRef]);
      report.restoredOriginalBranch = true;
    } catch (error) {
      report.restoredOriginalBranch = false;
      report.errors.push(`恢复原分支失败: ${error.message}`);
      if (report.status === 'PASS') report.status = 'FAIL';
    }
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(output, 'report.md'), markdown());
  await writeFile(
    path.join(artifacts, 'latest-report.json'),
    JSON.stringify({ directory: output, status: report.status }, null, 2),
  );
  console.log(markdown());
  console.log(`报告文件: ${path.join(output, 'report.md')}`);
  process.exitCode = report.status === 'PASS' ? 0 : report.status === 'BLOCKED' ? 2 : 1;
}
