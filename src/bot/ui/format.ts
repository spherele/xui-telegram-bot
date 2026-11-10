// Единый стиль сообщений (Telegram HTML) и форматирование значений.
//
//   <b>🔹 Заголовок</b>
//
//   <blockquote>карточка с данными</blockquote>
//
//   <i>подсказка</i>
import { DAY_MS } from '../../domain/rules.js';

type Line = string | null | undefined | false;

export const esc = (s: unknown): string => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Заголовок экрана. */
export const title = (emoji: string, text: string): string => `<b>${emoji} ${text}</b>`;

/** Карточка-цитата; пустые строки отбрасываются. */
export const card = (...lines: Line[]): string => `<blockquote>${lines.filter(Boolean).join('\n')}</blockquote>`;

/** Подсказка курсивом. */
export const hint = (text: string): string => `<i>${text}</i>`;

const DIGITS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣'];
/** Нумерованные шаги. */
export const steps = (...items: string[]): string => items.map((s, i) => `${DIGITS[i] ?? `${i + 1}.`} ${s}`).join('\n');

/** Экран из блоков через пустую строку. */
export const screen = (...blocks: (Line | Line[])[]): string =>
  blocks
    .flat()
    .filter((b): b is string => !!b)
    .join('\n\n');

/** Плашка с результатом действия над экраном. */
export const withNotice = (notice: string | undefined, text: string): string =>
  notice ? screen(card(notice), text) : text;

export function bar(pct: number, width = 10): string {
  const filled = Math.round((Math.min(100, Math.max(0, pct)) / 100) * width);
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

export function fmtBytes(n: number): string {
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let i = 0;
  while (Math.abs(n) >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return i === 0 ? `${n} Б` : `${n.toFixed(2)} ${units[i]}`;
}

export function fmtDate(ms: number, tz: string, withTime = true): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(ms));
}

export const fmtTime = (ms: number, tz: string): string =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(ms));

export function fmtExpiry(ms: number, tz: string, now = Date.now()): string {
  if (ms === 0) return 'бессрочно ♾';
  if (ms < 0) return `${Math.floor(-ms / DAY_MS)} дн. с первого подключения`;
  const date = fmtDate(ms, tz);
  const left = ms - now;
  if (left <= 0) return `${date} — <b>истекла</b>`;
  const days = Math.floor(left / DAY_MS);
  const hours = Math.floor((left % DAY_MS) / 3_600_000);
  return `до ${date} (осталось ${days} дн. ${hours} ч.)`;
}

/** t.me/@name → t.me/name, @name → https://t.me/name */
export function normalizeTgUrl(url: string | null): string | null {
  if (!url) return null;
  if (/^@\w+$/.test(url)) return `https://t.me/${url.slice(1)}`;
  return url.replace(/(t\.me\/)@/i, '$1');
}
