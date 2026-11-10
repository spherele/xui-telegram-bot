// Тексты уведомлений о сроке и трафике.
import { InlineKeyboard } from 'grammy';
import { type Alert, usedBytes } from '../../domain/rules.js';
import { CB } from '../callbacks.js';
import { bar, card, esc, fmtBytes, fmtExpiry, screen, title } from '../ui/format.js';

function alertText(a: Alert, tz: string): string {
  const c = a.client;
  const who = `👤 <b>${esc(c.email)}</b>`;
  switch (a.kind) {
    case 'expired':
      return screen(title('⛔', 'Подписка истекла'), card(who, 'VPN отключён до продления.'));
    case 'expiring':
      return screen(title('⏰', 'Подписка скоро закончится'), card(who, `📅 ${fmtExpiry(c.expiryTime, tz)}`));
    case 'depleted':
      return screen(
        title('⛔', 'Трафик закончился'),
        card(who, `📶 ${fmtBytes(c.totalBytes)} израсходовано полностью`),
      );
    case 'traffic_low': {
      const u = usedBytes(c);
      return screen(
        title('📶', 'Трафик заканчивается'),
        card(
          who,
          `Осталось <b>${fmtBytes(c.totalBytes - u)}</b> из ${fmtBytes(c.totalBytes)}`,
          bar((u / c.totalBytes) * 100),
        ),
      );
    }
  }
}

export const alertsText = (alerts: Alert[], tz: string): string =>
  [...new Set(alerts.map((a) => alertText(a, tz)))].join('\n\n');

/** Кнопки отдельных сообщений-уведомлений. */
export const notifyKeyboard = (): InlineKeyboard =>
  new InlineKeyboard().text('📊 Открыть меню', CB.notifyOpen).text('✖ Закрыть', CB.notifyClose);
