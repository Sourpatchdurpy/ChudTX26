// pm2 process file. From the repo root on the VM: pm2 startOrReload deploy/ecosystem.config.cjs
// Uses `npm run start` in each workspace so hoisted binaries (tsx, next) resolve correctly.
// game-web is only included once apps/web exists (Part 1), so the server can deploy first.
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const hasWeb = fs.existsSync(path.join(root, "apps/web/package.json"));

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
    ...(hasWeb
      ? [
          {
            name: "game-web",
            cwd: path.join(root, "apps/web"),
            script: "npm",
            args: "run start",
            env: { NODE_ENV: "production" },
            max_restarts: 20,
          },
        ]
      : []),
  ],
};
