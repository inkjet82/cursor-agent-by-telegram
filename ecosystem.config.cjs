const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "cursor-tg-bot",
      script: "dist/index.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
      error_file: path.join(__dirname, "data", "pm2-error.log"),
      out_file: path.join(__dirname, "data", "pm2-out.log"),
      merge_logs: true,
      time: true,
    },
  ],
};
