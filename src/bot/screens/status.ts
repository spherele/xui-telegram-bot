// Статус сервиса для пользователей — без IP и технических деталей.
import { InlineKeyboard } from 'grammy';
import type { ServiceStatus } from '../../domain/types.js';
import { CB } from '../callbacks.js';
import type { View } from '../panel.js';
import { card, esc, fmtTime, hint, screen, title } from '../ui/format.js';
import { backKb } from './common.js';

const load = (cpu: number) => (cpu < 50 ? '🟢 низкая' : cpu < 80 ? '🟡 средняя' : '🟠 высокая');

export interface StatusNames {
  serverName: string;
  nodeNames: Record<string, string>;
  tz: string;
}

export function statusText(st: ServiceStatus, { serverName, nodeNames, tz }: StatusNames): string {
  const servers = st.servers.map((s, i) => ({
    ...s,
    name: i === 0 ? serverName : (nodeNames[s.name ?? ''] ?? nodeNames[`#${i - 1}`] ?? s.name ?? 'Сервер'),
  }));
  const up = servers.filter((s) => s.online).length;
  const head =
    up === servers.length
      ? '🟢 <b>Все серверы работают</b>'
      : up === 0
        ? '🔴 <b>Сервис временно недоступен</b>\nМы уже занимаемся проблемой.'
        : '🟡 <b>Часть серверов недоступна</b>\nОстальные работают — переключитесь на них в приложении.';
  const rows = servers.map((s) =>
    s.online
      ? card(
          `<b>${esc(s.name)}</b>`,
          `Работает${s.latencyMs ? ` · ${s.latencyMs} мс` : ''}`,
          `Нагрузка: ${load(s.cpu)}`,
        )
      : card(`<b>${esc(s.name)}</b>`, '🔴 Недоступен'),
  );
  return screen(
    title('📡', 'Статус сервиса'),
    head,
    rows.join('\n'),
    st.onlineUsers != null ? `👥 Сейчас онлайн: <b>${st.onlineUsers}</b>` : null,
    hint(`Обновлено в ${fmtTime(st.at, tz)}`),
  );
}

export const statusView = (st: ServiceStatus, names: StatusNames): View => ({
  text: statusText(st, names),
  keyboard: new InlineKeyboard().text('🔄 Обновить', CB.statusRefresh).text('« Назад', CB.home),
});

export const statusErrorView = (): View => ({
  text: screen(title('📡', 'Статус сервиса'), '⚠️ Не удалось получить статус, попробуйте позже.'),
  keyboard: backKb(),
});
