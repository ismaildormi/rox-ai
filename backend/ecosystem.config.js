// ROX AI — pm2 process manager config
//
// This is what makes "start automatically and recover from common
// errors" true without any custom supervisor code: pm2 restarts a
// crashed process on its own (autorestart), backs off if it keeps
// crashing (exp_backoff_restart_delay) instead of hot-looping, and
// `pm2 startup` (see `rox setup`) makes both processes come back after
// a server reboot with no manual step.
//
// Run through the CLI (`./cli/rox.js start`, not `pm2 start` directly)
// so start/stop/health/backup all agree on the same two process names.

module.exports = {
  apps: [
    {
      name: 'rox-api',
      script: './server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '15s',        // a crash within 15s of start counts toward max_restarts
      restart_delay: 2000,
      exp_backoff_restart_delay: 100, // 100ms, 200ms, 400ms... on repeated crashes
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production' },
      out_file: '../logs/rox-api.out.log',
      error_file: '../logs/rox-api.err.log',
      time: true,
    },
    {
      name: 'rox-worker',
      script: './worker.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '15s',
      restart_delay: 2000,
      exp_backoff_restart_delay: 100,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production' },
      out_file: '../logs/rox-worker.out.log',
      error_file: '../logs/rox-worker.err.log',
      time: true,
    },
  ],
};
