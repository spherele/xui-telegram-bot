import { InlineKeyboard } from 'grammy';
import { isActive } from '../../domain/rules.js';
import type { Client, Order } from '../../domain/types.js';
import type { Stats } from '../../services/accounts.js';
import { CB } from '../callbacks.js';
import type { View } from '../panel.js';
import { card, esc, hint, screen, title } from '../ui/format.js';
import type { Ui } from './common.js';
import * as shop from './shop.js';

const menuKb = () => new InlineKeyboard().text('« Меню', CB.home);
const out = (text: string): View => ({ text, keyboard: menuKb() });

const row = (c: Client) =>
  `${isActive(c) ? '🟢' : '🔴'} <code>${esc(c.email)}</code> · ${c.tgId ? `tg <code>${c.tgId}</code>` : 'не привязан'}`;

export const usageView = (usage: string): View => out(`Использование: <code>${esc(usage)}</code>`);

export const adminErrorView = (e: Error): View => out(`⚠️ ${esc(e.message)}`);

export function statsView(s: Stats, orders: Order[]): View {
  const count = (st: Order['status']) => orders.filter((o) => o.status === st).length;
  return out(
    screen(
      title('📈', 'Статистика'),
      card(
        `Клиентов в панели: <b>${s.clients}</b>`,
        `Активных: <b>${s.active}</b>`,
        `Привязано к Telegram: <b>${s.linked}</b> (пользователей: ${s.users})`,
      ),
      card(
        `Заявок: <b>${orders.length}</b>`,
        `Ждут проверки: <b>${count('pending')}</b>`,
        `Оплачено: <b>${count('done')}</b>`,
      ),
    ),
  );
}

export function findView(found: Client[]): View {
  if (!found.length) return out('🔎 Ничего не найдено.');
  return out(
    screen(
      title('🔎', `Найдено: ${found.length}`),
      found.slice(0, 30).map(row).join('\n') + (found.length > 30 ? '\n…' : ''),
    ),
  );
}

export const linkedView = (c: Client): View => out(screen(title('✅', `Привязано к ${c.tgId}`), row(c)));
export const unlinkedView = (c: Client): View => out(screen(title('✅', 'Отвязано'), row({ ...c, tgId: 0 })));
export const clientNotFoundView = (): View => out('Клиент с таким email не найден.');

export function openOrdersView(ui: Ui, orders: Order[]): View {
  if (!orders.length) return out('🧾 Заявок, ожидающих проверки, нет.');
  return out(
    screen(
      title('🧾', `Ждут проверки: ${orders.length}`),
      orders
        .slice(-20)
        .map((o) => shop.openOrderLine(ui, o))
        .join('\n'),
      hint('Подтвердить или отклонить — кнопками в сообщении с чеком.'),
    ),
  );
}
