module.exports = {
  apps: [
    {
      name: 'pingme-help',
      script: './server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        PORT: 9999
      }
    }
  ]
};
