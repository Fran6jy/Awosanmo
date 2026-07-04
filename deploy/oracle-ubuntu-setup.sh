#!/usr/bin/env bash
set -euo pipefail

APP_USER="${APP_USER:-awosanmo}"
APP_DIR="${APP_DIR:-/opt/awosanmo}"
DATA_DIR="${DATA_DIR:-/var/lib/awosanmo}"
SWAP_FILE="${SWAP_FILE:-/swapfile}"
SWAP_SIZE="${SWAP_SIZE:-2G}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash deploy/oracle-ubuntu-setup.sh"
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl gnupg git nginx sqlite3 ufw certbot python3-certbot-nginx

install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi

. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
usermod -aG docker "$APP_USER"
install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR" "$DATA_DIR" "$DATA_DIR/backups"

if [ ! -f "$SWAP_FILE" ]; then
  fallocate -l "$SWAP_SIZE" "$SWAP_FILE"
  chmod 600 "$SWAP_FILE"
  mkswap "$SWAP_FILE"
  swapon "$SWAP_FILE"
  echo "$SWAP_FILE none swap sw 0 0" >> /etc/fstab
fi

cat >/etc/sysctl.d/99-awosanmo.conf <<'EOF'
vm.swappiness=20
vm.vfs_cache_pressure=80
fs.file-max=1048576
net.core.somaxconn=1024
EOF
sysctl --system

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 51413/tcp
ufw allow 51413/udp
ufw --force enable

echo "Oracle base setup complete."
echo "Next: copy the repo to $APP_DIR, create .env, then run:"
echo "  cd $APP_DIR && docker compose -f docker-compose.prod.yml up -d --build"
