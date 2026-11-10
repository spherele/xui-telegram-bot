import { accountKey } from './xui.js';

export const DAY_MS = 86_400_000;

export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function fmtBytes(n) {
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let i = 0;
  while (Math.abs(n) >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return i === 0 ? `${n} Б` : `${n.toFixed(2)} ${units[i]}`;
}

export const used = (c) => c.up + c.down;

export function fmtExpiry(ms, tz, now = Date.now()) {
  if (ms === 0) return 'бессрочно ♾';
  if (ms < 0) return `${Math.floor(-ms / DAY_MS)} дн. с первого подключения`;
  const date = new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
  const left = ms - now;
  if (left <= 0) return `${date} — <b>истекла</b>`;
  const days = Math.floor(left / DAY_MS);
  const hours = Math.floor((left % DAY_MS) / 3_600_000);
  return `до ${date} (осталось ${days} дн. ${hours} ч.)`;
}

export function fmtTraffic(c) {
  if (c.totalBytes <= 0) return `${fmtBytes(used(c))} / ♾`;
  const pct = (used(c) / c.totalBytes) * 100;
  return `${fmtBytes(used(c))} / ${fmtBytes(c.totalBytes)} (${pct.toFixed(0)}%)`;
}

export function isActive(c, now = Date.now()) {
  if (!c.enable) return false;
  if (c.expiryTime > 0 && c.expiryTime <= now) return false;
  if (c.totalBytes > 0 && used(c) >= c.totalBytes) return false;
  return true;
}

/** Map<accountKey, Client[]> */
export function groupAccounts(clients) {
  const m = new Map();
  for (const c of clients) {
    const k = accountKey(c);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(c);
  }
  return m;
}

export const accountLabel = (list) => [...new Set(list.map((c) => c.email))].join(', ');

function fmtStatus(c, now = Date.now()) {
  if (!c.enable) return '🔴 отключён';
  if (c.expiryTime > 0 && c.expiryTime <= now) return '🔴 срок истёк';
  if (c.totalBytes > 0 && used(c) >= c.totalBytes) return '🔴 трафик закончился';
  return '🟢 активен';
}

export function fmtAccount(list, tz) {
  return list
    .map((c) => {
      const servers = c.inbounds?.filter((i) => i.enable).length;
      return (
        `👤 <b>${esc(c.email)}</b> — ${fmtStatus(c)}\n\n` +
        `📶 Трафик: ${fmtTraffic(c)}\n` +
        `📅 Срок: ${fmtExpiry(c.expiryTime, tz)}` +
        (servers ? `\n🌍 Подключений в подписке: ${servers}` : '')
      );
    })
    .join('\n\n');
}
