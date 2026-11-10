#!/usr/bin/env bash
# Обновить бота на сервере: ./deploy/deploy.sh [ssh-хост]   (по умолчанию — proxy из ~/.ssh/config)
# Собирает TypeScript и прогоняет тесты локально, копирует dist + .env, ставит prod-зависимости,
# перезапускает службу. data/ и node/ на сервере не трогает.
set -euo pipefail
HOST="${1:-proxy}"
DIR=/opt/xui-telegram-bot
cd "$(dirname "$0")/.."

npm run check >/dev/null || { echo "Проверки (prettier, eslint, тесты) не прошли — деплой отменён"; exit 1; }

rsync -az --delete \
  --exclude node_modules --exclude data --exclude node \
  --exclude .git --exclude .idea --exclude .DS_Store \
  --exclude 'dist/test' --exclude '*.map' \
  ./ "$HOST:$DIR/"

ssh "$HOST" "set -e; cd $DIR
  PATH=$DIR/node/bin:\$PATH npm ci --omit=dev --no-audit --no-fund >/dev/null
  chmod 600 .env; chown -R xuibot:xuibot $DIR
  cp deploy/xui-telegram-bot.service /etc/systemd/system/ && systemctl daemon-reload
  systemctl restart xui-telegram-bot; sleep 5
  systemctl is-active xui-telegram-bot
  journalctl -u xui-telegram-bot -n 6 --no-pager -o cat"
