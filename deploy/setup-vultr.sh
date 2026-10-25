#!/usr/bin/env bash
# One-time setup for a fresh Vultr Ubuntu 24.04 VM. Run as root: bash setup-vultr.sh
# Installs Node 24 LTS, pm2 and Caddy, and opens the firewall. Review before running.
set -euo pipefail

apt-get update
apt-get install -y curl git ufw debian-keyring debian-archive-keyring apt-transport-https gnupg

# Node.js 24 LTS (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs
npm install -g pm2

# Caddy (official apt repo)
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy

# Firewall: SSH, HTTP, HTTPS only (the app ports 3000/4000 stay private behind Caddy)
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "Done. Next:"
echo "  git clone <repo> /opt/game && cd /opt/game"
echo "  cp .env.example .env   (keep AI_MODE=stub; Part 4 adds MODEL_API_KEY themselves later)"
echo "  cp deploy/Caddyfile /etc/caddy/Caddyfile && systemctl reload caddy"
echo "  bash deploy/deploy.sh && pm2 save && pm2 startup"
