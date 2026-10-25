// pm2 process file. From the repo root on the VM: pm2 startOrReload deploy/ecosystem.config.cjs
// Caddy serves apps/web/dist directly; only the game server needs a process.
const path = require("node:path");

const root = path.join(__dirname, "..");

module.exports = {
  apps: [
    {
      name: "game-server",
      cwd: path.join(root, "apps/server"),
      script: "npm",
      args: "run start",
      env: { NODE_ENV: "production" },
      max_restarts: 20,
    },
  ],
};
