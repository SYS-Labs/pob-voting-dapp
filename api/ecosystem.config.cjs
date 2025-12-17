/**
 * PM2 Ecosystem Configuration
 *
 * Manages backend services for the PoB Forum API
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs           # Start all services
 *   pm2 start ecosystem.config.cjs --only forum-api  # Start specific service
 *   pm2 stop all                             # Stop all services
 *   pm2 restart all                          # Restart all services
 *   pm2 logs                                 # View logs
 *   pm2 monit                                # Monitor services
 */

module.exports = {
  apps: [
    {
      name: 'forum-indexer',
      script: 'dist/indexer/index.js',
      cwd: '/sandbox/api',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      node_args: '--env-file=/sandbox/api/.env',  // Load .env file using Node's native flag
      env: {
        NODE_ENV: 'production',
      },
      env_development: {
        NODE_ENV: 'development',
      },
      error_file: './logs/indexer-error.log',
      out_file: './logs/indexer-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
    {
      name: 'forum-api',
      script: 'dist/api/index.js',
      cwd: '/sandbox/api',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      node_args: '--env-file=/sandbox/api/.env',  // Load .env file using Node's native flag
      env: {
        NODE_ENV: 'production',
        API_PORT: 4000,
      },
      env_development: {
        NODE_ENV: 'development',
      },
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
    {
      name: 'forum-workers',
      script: 'dist/workers/index.js',
      cwd: '/sandbox/api',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G', // Workers may need more memory for AI operations
      node_args: '--env-file=/sandbox/api/.env',  // Load .env file using Node's native flag
      env: {
        NODE_ENV: 'production',
        WORKER_INTERVAL: 15000,
        BATCH_SIZE: 10,
      },
      env_development: {
        NODE_ENV: 'development',
        WORKER_INTERVAL: 30000, // Faster in dev
      },
      error_file: './logs/workers-error.log',
      out_file: './logs/workers-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
