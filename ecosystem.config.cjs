// PM2 process file. Each bot is an independent process with its own logs and restarts.
//   pm2 start ecosystem.config.cjs        start all four
//   pm2 restart lyss-community            restart one bot
//   pm2 save && pm2 startup               start on boot
// Do not also run these bots under Docker Compose.

const bots = [
  { name: 'lyss-tickets', dir: 'tickets-bot' },
  { name: 'lyss-guard', dir: 'guard-bot' },
  { name: 'lyss-community', dir: 'community-bot' },
  { name: 'alyss', dir: 'ai-bot' },
];

module.exports = {
  apps: bots.map(({ name, dir }) => ({
    name,
    cwd: `${__dirname}/${dir}`,
    script: 'src/index.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    exp_backoff_restart_delay: 2000,
    max_restarts: 20,
    min_uptime: '30s',
    max_memory_restart: '400M',
    kill_timeout: 10000,
    out_file: `${__dirname}/logs/${name}.out.log`,
    error_file: `${__dirname}/logs/${name}.err.log`,
    time: true,
    env: { NODE_ENV: 'production' },
  })),
};
