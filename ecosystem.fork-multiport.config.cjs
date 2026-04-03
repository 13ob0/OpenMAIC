/**
 * PM2：多进程多端口（fork），配合 Nginx upstream least_conn
 *
 * 前置：pnpm build
 * 启动：pm2 start ecosystem.fork-multiport.config.cjs
 *
 * 将 deploy/nginx/openmaic.conf.example 中 upstream 改为多端口，
 * 或参考 deploy/nginx/openmaic-upstream-multiport.conf.example
 */
const ports = [1024, 1025, 1026];

module.exports = {
  apps: ports.map((port) => ({
    name: `openmaic-${port}`,
    cwd: __dirname,
    script: 'node_modules/next/dist/bin/next',
    args: 'start',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: port,
    },
    max_memory_restart: '1G',
  })),
};
