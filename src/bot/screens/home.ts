import { InlineKeyboard } from 'grammy';
import { clientState, usedBytes } from '../../domain/rules.js';
import type { Client } from '../../domain/types.js';
import { CB } from '../callbacks.js';
import type { View } from '../panel.js';
import { bar, card, esc, fmtBytes, fmtExpiry, hint, screen, title, withNotice } from '../ui/format.js';
import { type Ui, withSupport } from './common.js';

const STATE_LABEL = {
  active: '🟢 Активна',
  disabled: '🔴 Отключена',
  expired: '🔴 Срок истёк',
  depleted: '🔴 Трафик закончился',
} as const;

function trafficLines(c: Client): string[] {
  if (c.totalBytes <= 0) return [`📶 <b>${fmtBytes(usedBytes(c))}</b> · безлимит`];
  const pct = (usedBytes(c) / c.totalBytes) * 100;
  return [`📶 <b>${fmtBytes(usedBytes(c))}</b> из ${fmtBytes(c.totalBytes)}`, `${bar(pct)} ${pct.toFixed(0)}%`];
}

export function accountCard(c: Client, tz: string): string {
  const servers = c.inbounds.filter((i) => i.enable).length;
  return (
    `${title('👤', esc(c.email))}\n` +
    card(
      `<b>${STATE_LABEL[clientState(c)]}</b>`,
      ...trafficLines(c),
      `📅 ${fmtExpiry(c.expiryTime, tz)}`,
      servers ? `🌍 Серверов в подписке: ${servers}` : null,
    )
  );
}

function serverNames(ui: Ui): string[] {
  const { serverName, nodeNames } = ui.config;
  return [serverName, ...Object.values(nodeNames)].filter((n) => n && n !== 'Основной сервер');
}

export function welcomeView(ui: Ui, notice?: string): View {
  const name = ui.config.title ? ` в ${esc(ui.config.title)}` : '';
  const servers = serverNames(ui);
  const kb = new InlineKeyboard();
  if (ui.shop.enabled) kb.text('💳 Купить подписку', CB.tariffs).row();
  kb.text('🔑 У меня уже есть подписка', CB.have).row();
  kb.text('📡 Статус сервиса', CB.status);
  withSupport(ui, kb);
  return {
    text: withNotice(
      notice,
      screen(
        title('👋', `Добро пожаловать${name}!`),
        'Быстрый и стабильный VPN для телефона, компьютера и ТВ.',
        card(
          servers.length ? `🌍 Серверы: ${servers.map(esc).join(', ')}` : null,
          '📱 Все устройства — по одной ссылке',
          '🔔 Напомню, когда подписка подходит к концу',
        ),
        ui.shop.enabled
          ? '💳 <b>Нет подписки?</b> Оформите её прямо здесь.\n🔑 <b>Уже пользуетесь?</b> Привяжите подписку — увидите трафик и срок.'
          : '🔑 <b>Уже пользуетесь?</b> Привяжите подписку — увидите трафик и срок.',
        hint('Выберите действие ниже 👇'),
      ),
    ),
    keyboard: kb,
  };
}

/** Главный экран: приветствие для новых, карточки подписок для привязанных. */
export function homeView(ui: Ui, clients: Client[], notice?: string): View {
  if (!clients.length) return welcomeView(ui, notice);
  const kb = new InlineKeyboard();
  if (ui.config.subUrl) {
    for (const c of clients.filter((x) => x.subId)) {
      kb.text(clients.length > 1 ? `🔗 ${c.email}` : '🔗 Подписка и QR-код', CB.subscription(c.email)).row();
    }
  }
  if (ui.shop.enabled) kb.text('💳 Продлить / купить', CB.tariffs).row();
  kb.text('🔄 Обновить', CB.refresh).text('📡 Статус', CB.status).row();
  kb.text('➕ Ещё аккаунт', CB.addAccount).text('🔓 Отвязать', CB.unlinkList).row();
  withSupport(ui, kb);
  return {
    text: withNotice(
      notice,
      screen(
        clients.map((c) => accountCard(c, ui.config.tz)),
        hint('Нажмите «Обновить», чтобы увидеть свежие данные.'),
      ),
    ),
    keyboard: kb,
  };
}
