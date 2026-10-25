# Deploy runbook (Vultr + Caddy + pm2)

Copy-paste steps for Part 3. The game server can go live before the web app exists:
`deploy.sh` and `ecosystem.config.cjs` skip `apps/web` until Part 1 pushes it, then
include it automatically on the next deploy.

## 1. Create the VM (once)
1. Claim credits at **mlh.link/vultr**.
2. Create a **Cloud Compute** instance: **Ubuntu 24.04**, **2 vCPU / 4 GB**, region **Dallas**, and add your SSH public key.
3. Note the IP. Below it's `VM_IP`.

## 2. First-time setup (on the VM, as root)
```bash
ssh root@VM_IP
git clone https://github.com/Sourpatchdurpy/ChudTX26.git /opt/game
bash /opt/game/deploy/setup-vultr.sh          # Node 24, pm2, Caddy, firewall (22/80/443)

cd /opt/game
cp .env.example .env                           # keep AI_MODE=stub for now
cp deploy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy

bash deploy/deploy.sh                          # npm ci, (web build), pm2 start, health check
pm2 startup systemd                            # as root this sets up boot autostart directly
pm2 save
```

## 3. Check it from your laptop
```bash
curl http://VM_IP/health                       # {"ok":true,"aiMode":"stub"}
```
Until Part 1 deploys the web app, `http://VM_IP/` returns 502. That's expected: only `/health` and `/socket.io` are live.
Full stub-AI game over the internet (about 5 minutes with real timers):
```bash
npm run smoke -w @game/server -- --url http://VM_IP
```

## 4. Redeploy
```bash
ssh root@VM_IP "cd /opt/game && bash deploy/deploy.sh"
```
`deploy.sh` pulls `main` itself. **After C5 (9:30am), redeploy only for critical fixes.**

## 5. Real AI (later, ask the team first)
The deployed game runs on **Part 4's** Muse key (team decision). Part 4 SSHes in and edits `/opt/game/.env` themselves. Never send the key to anyone.
- `MODEL_API_KEY=...` and `MUSE_BUDGET_USD=...` (Part 4 picks the cap)
- `AI_MODE=muse`, then `pm2 restart game-server`
- `curl http://VM_IP/health` should now say `"aiMode":"muse"`. Bots refuse to run against it without `--allow-muse`.

## 6. Domain + HTTPS (once the .tech name is registered)
1. At the registrar, add `A` records for `@` and `www` pointing to `VM_IP`.
2. Wait until `dig +short amuse-us.tech` prints `VM_IP`.
3. In `/etc/caddy/Caddyfile`, delete the `:80 { ... }` block, uncomment the domain block and put in the real name.
4. `systemctl reload caddy`. Caddy gets certificates automatically; check `https://amuse-us.tech/health`.

## Troubleshooting
| Symptom | Check |
|---|---|
| `/health` fails through Caddy | `curl localhost:4000/health` on the VM; `pm2 logs game-server --lines 50` |
| 502 on `/` | the web app isn't deployed yet, or `pm2 logs game-web` |
| Caddy errors | `journalctl -u caddy --no-pager -n 50`; `caddy validate --config /etc/caddy/Caddyfile` |
| Can't connect at all | `ufw status` (needs 80/443), and any Vultr firewall group on the instance |
| Server crash-looping | `pm2 describe game-server`; usually a bad `.env` or `content/question-bank.json` |
