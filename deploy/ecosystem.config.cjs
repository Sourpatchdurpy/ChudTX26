// pm2 process file. From the repo root on the VM: pm2 startOrReload deploy/ecosystem.config.cjs
// Uses `npm run start` in each workspace so hoisted binaries (tsx, next) resolve correctly.
module.exports = {
  apps: [
    {
      name: "game-server",
      cwd: "./apps/server",
      script: "npm",
      args: "run start",
      env: { NODE_ENV: "production" },
      max_restarts: 20,
    },
    {
      name: "game-web",
      cwd: "./apps/web",
      script: "npm",
      args: "run start",
      env: { NODE_ENV: "production" },
      max_restarts: 20,
    },
  ],
};
