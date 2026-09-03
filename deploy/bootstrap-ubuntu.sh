#!/usr/bin/env bash
set -euo pipefail

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required. Please run this script on Ubuntu as a sudo user."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  cat >&2 <<'EOF'
Docker Engine is not installed. This bootstrap script intentionally refuses to
download and execute a remote installer as root.

Install Docker Engine and the Compose plugin from Docker's official apt
repository in a reviewed change window. Verify the repository signing-key
fingerprint and pin an approved package version according to:
  https://docs.docker.com/engine/install/ubuntu/

Re-run this script only after `docker` is installed.
EOF
  exit 1
fi
docker compose version >/dev/null 2>&1 || {
  echo "The reviewed Docker Compose plugin is required; no package was installed." >&2
  exit 1
}
echo "==> Existing Docker Engine and Compose plugin detected"

echo "==> Updating reviewed Ubuntu packages"
sudo apt update
sudo apt install -y git ca-certificates ufw openssl

echo "==> Adding current user to docker group"
sudo usermod -aG docker "$USER"

echo "==> Opening firewall ports 22, 80 and 443"
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

echo
echo "Server bootstrap is done."
echo "Important: close this SSH window and log in again before running docker commands."
