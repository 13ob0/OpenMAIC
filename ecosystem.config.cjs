/**
 * PM2：Next.js 生产启动（cluster + 单端口）
 *
 * 前置：pnpm build
 * 启动：pm2 start ecosystem.config.cjs
 *
 * Nginx 可继续 proxy_pass 到本文件中的 PORT（默认 1024）。
 * 详见 deploy/README.md
 */
module.exports = {
  apps: [
    {
      name: 'openmaic',
      cwd: __dirname,
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 1024,
      },
      max_memory_restart: '1G',
      exp_backoff_restart_delay: 100,
    },
  ],
};
