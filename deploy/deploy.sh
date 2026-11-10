#!/usr/bin/env bash
# Обновить бота на сервере: ./deploy/deploy.sh [ssh-хост]   (по умолчанию — proxy из ~/.ssh/config)
# Копирует код и .env, ставит зависимости, перезапускает службу. data/ и node/ на сервере не трогает.
set -euo pipefail
HOST="${1:-proxy}"
DIR=/opt/xui-telegram-bot
cd "$(dirname "$0")/.."

rsync -az --delete \
  --exclude node_modules --exclude data --exclude node \
  --exclude .git --exclude .idea --exclude .DS_Store \
  ./ "$HOST:$DIR/"

ssh "$HOST" "set -e; cd $DIR
  PATH=$DIR/node/bin:\$PATH npm ci --omit=dev --no-audit --no-fund >/dev/null
  chmod 600 .env; chown -R xuibot:xuibot $DIR
  cp deploy/xui-telegram-bot.service /etc/systemd/system/ && systemctl daemon-reload
  systemctl restart xui-telegram-bot; sleep 5
  systemctl is-active xui-telegram-bot
  journalctl -u xui-telegram-bot -n 5 --no-pager -o cat"
