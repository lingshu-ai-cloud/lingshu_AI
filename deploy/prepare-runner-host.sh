#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root: sudo bash deploy/prepare-runner-host.sh <environment>" >&2
  exit 1
fi

deploy_environment="${1:-}"
case "$deploy_environment" in
  internal|presales|production) ;;
  *) echo "Environment must be internal, presales, or production." >&2; exit 2 ;;
esac

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git gnupg jq tar unzip

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

if ! id actions-runner >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash actions-runner
fi

usermod -aG docker actions-runner
install -d -o actions-runner -g actions-runner -m 0750 /opt/actions-runner
install -d -o actions-runner -g actions-runner -m 0750 "/opt/lingshu/${deploy_environment}"
install -d -o actions-runner -g actions-runner -m 0750 "/opt/lingshu/${deploy_environment}/backups"
install -d -o actions-runner -g actions-runner -m 0750 "/opt/lingshu/${deploy_environment}/data"

docker volume create "lingshu_${deploy_environment}_pb_data" >/dev/null
docker volume create "lingshu_${deploy_environment}_caddy_data" >/dev/null
docker volume create "lingshu_${deploy_environment}_caddy_config" >/dev/null

echo "Host preparation complete for ${deploy_environment}."
echo "Next: register the GitHub Actions runner with the custom label: ${deploy_environment}"
echo "Then create /opt/lingshu/${deploy_environment}/.env.runtime with owner actions-runner and mode 600."
