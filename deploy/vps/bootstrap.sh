#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 VPS, as root or through sudo from
# the provider's default user (OVH's Ubuntu images log in as `ubuntu`):
#
#   curl -fsSL https://raw.githubusercontent.com/ArashKeshtgar/ControlPanel/main/deploy/vps/bootstrap.sh -o bootstrap.sh
#   less bootstrap.sh          # read it first
#   sudo bash bootstrap.sh
#
# It needs your SSH public key on the server (every provider installs it when
# you pick a key while creating the server). The key is copied from the
# account that ran sudo, or from root.
#
# What it does: updates the system, creates the `deploy` user with your key,
# turns off root and password logins over SSH, firewall (22, 80, 443 only),
# fail2ban, automatic security updates, swap, Docker, the /srv folders, and
# an SSH key GitHub can use if a repo ever becomes private.
#
# KEEP THIS SESSION OPEN until you've logged in as deploy from a second
# terminal: if something went wrong with the key, this session is the way back.
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
TIMEZONE="${TIMEZONE:-America/Toronto}"
SWAP_SIZE="${SWAP_SIZE:-4G}"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m%s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root."
. /etc/os-release
[[ "$ID" == "ubuntu" ]] || die "Written for Ubuntu (24.04); this is $PRETTY_NAME."
# The SQL Server image only exists for x86-64; an ARM server can't run it.
[[ "$(uname -m)" == "x86_64" ]] || die "SQL Server needs an x86-64 server; this one is $(uname -m)."
# The key you logged in with: from the sudo caller (e.g. ubuntu), else root.
KEYS_FROM=/root/.ssh/authorized_keys
if [[ -n "${SUDO_USER:-}" && "$SUDO_USER" != root ]]; then
  KEYS_FROM="$(getent passwd "$SUDO_USER" | cut -d: -f6)/.ssh/authorized_keys"
fi
[[ -s "$KEYS_FROM" ]] || die "No key in $KEYS_FROM; add your public key first, or you'd lock yourself out."

log "System update"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get -y install ca-certificates curl git ufw fail2ban unattended-upgrades

timedatectl set-timezone "$TIMEZONE"

log "User $DEPLOY_USER"
if ! id "$DEPLOY_USER" &>/dev/null; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG sudo "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$KEYS_FROM" "/home/$DEPLOY_USER/.ssh/authorized_keys"
if passwd -S "$DEPLOY_USER" | grep -q ' L '; then
  echo "Choose a password for $DEPLOY_USER (sudo asks for it; SSH never will):"
  passwd "$DEPLOY_USER"
fi

log "SSH: keys only, no root"
# sshd keeps the FIRST value it reads, and cloud images ship
# 50-cloud-init.conf with PasswordAuthentication yes: this file has to sort
# before it, and the old name is removed in case an earlier run left it.
rm -f /etc/ssh/sshd_config.d/99-hardening.conf
cat > /etc/ssh/sshd_config.d/00-hardening.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
X11Forwarding no
EOF
sshd -t
systemctl reload ssh
sshd -T | grep -qx 'passwordauthentication no' || die "sshd still accepts passwords; check /etc/ssh/sshd_config.d/."

log "Firewall"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
# Docker bypasses ufw for published ports; compose.vps.yml publishes
# nothing but Caddy's 80/443, so this is still the whole picture.

log "fail2ban (SSH)"
cat > /etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled = true
maxretry = 5
findtime = 10m
bantime = 1h
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

log "Automatic security updates"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

log "Swap ($SWAP_SIZE)"
if ! swapon --show | grep -q .; then
  fallocate -l "$SWAP_SIZE" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
  sysctl -p /etc/sysctl.d/99-swappiness.conf
fi

log "Docker (official apt repository)"
if ! command -v docker &>/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
# Container logs would otherwise grow until the disk is full.
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "local",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
systemctl restart docker
# Note: the docker group is root-equivalent; deploy is already a sudoer.
usermod -aG docker "$DEPLOY_USER"

log "Folders"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" /srv/portfolio /srv/backups /srv/backups/import
# SQL Server in its container runs as uid 10001 and writes backups here.
install -d -o 10001 -g "$DEPLOY_USER" -m 775 /srv/backups/mssql

log "GitHub key for $DEPLOY_USER"
KEY="/home/$DEPLOY_USER/.ssh/id_ed25519"
if [[ ! -f "$KEY" ]]; then
  sudo -u "$DEPLOY_USER" ssh-keygen -t ed25519 -N "" -C "$DEPLOY_USER@$(hostname)" -f "$KEY"
fi

cat <<EOF

Done. This server's SSH host key (compare it with what ssh shows you the
first time you connect, and with VPS_KNOWN_HOSTS later):
  $(ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub)

Next:
  1. From your PC, in a NEW terminal:  ssh $DEPLOY_USER@<server-ip>
     Only after that works, close this session.
     If the server came with a default user (ubuntu), remove it then:
       sudo deluser --remove-home ubuntu && sudo rm -f /etc/sudoers.d/90-cloud-init-users
  2. Continue with deploy/vps/README.md, step 4 (clone and .env).

Public key of $DEPLOY_USER (only needed if a repo becomes private -> add it
on GitHub as that repo's read-only deploy key):
$(cat "$KEY.pub")
EOF
