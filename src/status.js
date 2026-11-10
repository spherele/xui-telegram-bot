// Форматирование статуса VPN-сервиса для пользователей (без IP и технических деталей).
import { esc } from './format.js';

const load = (cpu) => (cpu < 50 ? 'низкая' : cpu < 80 ? 'средняя' : 'высокая');

export function fmtServiceStatus(st, { serverName, nodeNames = {}, tz }) {
  const servers = st.servers.map((s, i) => ({ ...s, name: i === 0 ? serverName : nodeNames[s.name] ?? nodeNames[`#${i - 1}`] ?? s.name }));
  const up = servers.filter((s) => s.online).length;
  const head =
    up === servers.length
      ? '🟢 <b>Все серверы работают</b>'
      : up === 0
        ? '🔴 <b>Сервис временно недоступен</b> — уже чиним'
        : '🟡 <b>Часть серверов недоступна</b> — остальные работают';

  const rows = servers.map((s) => {
    if (!s.online) return `🔴 <b>${esc(s.name)}</b> — недоступен`;
    const ping = s.latencyMs ? ` · ${s.latencyMs} мс` : '';
    return `🟢 <b>${esc(s.name)}</b> — работает${ping}\n     нагрузка: ${load(s.cpu)}`;
  });

  const time = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(
    new Date(st.at),
  );
  return (
    `📡 <b>Статус сервиса</b>\n\n${head}\n\n${rows.join('\n')}` +
    (st.onlineUsers != null ? `\n\n👥 Сейчас онлайн: ${st.onlineUsers}` : '') +
    `\n\n<i>Обновлено в ${time}</i>`
  );
}
