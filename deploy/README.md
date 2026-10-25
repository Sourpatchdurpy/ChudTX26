# Deploy runbook (Vultr + Caddy + pm2)

Live at **https://amuse-us.tech** (VM `45.32.201.97`, below `VM_IP`).
- **Game server:** run by pm2 on :4000. Caddy proxies `/socket.io` and `/health` to it.
- **Frontend:** Part 4's Vite app in `apps/web`. `deploy.sh` builds it into `/opt/game/apps/web/dist`, and Caddy serves those files directly (no web process). The browser connects to Socket.IO on the same HTTPS origin.

## 1. Create the VM (once)
1. Claim credits at **mlh.link/vultr**.
2. Create a **Cloud Compute** instance: **Ubuntu 24.04**, **2 vCPU / 4 GB**, region **Dallas**, and add your SSH public key.
3. At the registrar, point `A` records for `@` and `www` at the VM's IP.

## 2. First-time setup (on the VM, as root)
```bash
ssh root@VM_IP
git clone https://github.com/Sourpatchdurpy/ChudTX26.git /opt/game
bash /opt/game/deploy/setup-vultr.sh          # Node 24, pm2, Caddy, firewall (22/80/443)

cd /opt/game
cp .env.example .env                           # keep AI_MODE=stub for now
bash deploy/deploy.sh                          # npm ci, frontend build, pm2 start, health check
cp deploy/Caddyfile /etc/caddy/Caddyfile       # needs the domain's A records already pointing here
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
pm2 startup systemd                            # as root this sets up boot autostart directly
pm2 save
```

## 3. Check it from your laptop
```bash
curl https://amuse-us.tech/health              # {"ok":true,"aiMode":"stub"}
```
Open https://amuse-us.tech in a browser for the frontend.
Full stub-AI game over the internet (about 5 minutes with real timers):
```bash
npm run smoke -w @game/server -- --url https://amuse-us.tech
```

## 4. Redeploy
```bash
ssh root@VM_IP "cd /opt/game && bash deploy/deploy.sh"
```
- `deploy.sh` pulls `main` itself. If the frontend build or typecheck fails, it stops, and the previous version keeps running.
- When `deploy/Caddyfile` changes, also run `cp deploy/Caddyfile /etc/caddy/Caddyfile && systemctl reload caddy`.
- This merge changes the frontend directory to `apps/web/dist`, so update Caddy on the first redeploy. If an older deployment has a `game-web` pm2 process, remove it with `pm2 delete game-web && pm2 save`; static hosting replaces it.
- **After C5 (9:30am), redeploy only for critical fixes.**

## 5. Real AI (later, ask the team first)
The deployed game runs on **Part 4's** Muse key (team decision). Part 4 SSHes in and edits `/opt/game/.env` themselves. Never send the key to anyone.
- `MODEL_API_KEY=...` and `MUSE_BUDGET_USD=...` (Part 4 picks the cap)
- `AI_MODE=muse`, then `pm2 restart game-server`
- `curl https://amuse-us.tech/health` should now say `"aiMode":"muse"`. Bots refuse to run against it without `--allow-muse`.

## Troubleshooting
| Symptom | Check |
|---|---|
| `/health` fails | `curl localhost:4000/health` on the VM; `pm2 logs game-server --lines 50` |
| Blank page or 404 on `/` | `ls /opt/game/apps/web/dist` (re-run `deploy.sh`); is `/etc/caddy/Caddyfile` the current `deploy/Caddyfile`? |
| 502 on `/` | the VM still has the old Caddyfile (proxies to :3000); copy the new one and reload Caddy |
| Caddy or HTTPS errors | `journalctl -u caddy --no-pager -n 50`; `caddy validate --config /etc/caddy/Caddyfile` |
| Can't connect at all | `ufw status` (needs 80/443), and any Vultr firewall group on the instance |
| Server crash-looping | `pm2 describe game-server`; usually a bad `.env` or `content/question-bank.json` |
