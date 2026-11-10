// Периодическая проверка: скоро истекает срок / заканчивается трафик.
// Уведомление отправляется один раз при переходе условия в «истину»;
// после продления (новый expiryTime) или сброса трафика — сработает снова.
import { InlineKeyboard } from 'grammy';
import { DAY_MS, esc, fmtBytes, fmtExpiry, used } from './format.js';

export function conditions(c, { days, trafficPercent }, tz, now = Date.now()) {
  const out = [];
  if (c.expiryTime > 0) {
    const left = c.expiryTime - now;
    if (left <= 0) {
      out.push([`exp0:${c.email}:${c.expiryTime}`, `⛔ Подписка <b>${esc(c.email)}</b> истекла. Продлите её, чтобы VPN снова заработал.`]);
    } else if (left <= days * DAY_MS) {
      out.push([`exp:${c.email}:${c.expiryTime}`, `⏰ Подписка <b>${esc(c.email)}</b> скоро закончится: ${fmtExpiry(c.expiryTime, tz, now)}.`]);
    }
  }
  if (c.totalBytes > 0) {
    const u = used(c);
    if (u >= c.totalBytes) {
      out.push([`trf0:${c.email}:${c.totalBytes}`, `⛔ Трафик <b>${esc(c.email)}</b> закончился (${fmtBytes(c.totalBytes)}).`]);
    } else if ((u / c.totalBytes) * 100 >= trafficPercent) {
      out.push([
        `trf:${c.email}:${c.totalBytes}`,
        `📶 У <b>${esc(c.email)}</b> осталось ${fmtBytes(c.totalBytes - u)} из ${fmtBytes(c.totalBytes)}.`,
      ]);
    }
  }
  return out;
}

export async function checkOnce({ api, xui, store, config }) {
  const clients = await xui.listClients(true);
  const prev = store.getNotified();
  const active = new Set();
  const outbox = new Map(); // tgId -> [text]
  for (const c of clients) {
    if (!c.tgId || !c.enable) continue;
    for (const [key, text] of conditions(c, config.notify, config.tz)) {
      active.add(key);
      if (prev.has(key)) continue;
      if (!outbox.has(c.tgId)) outbox.set(c.tgId, []);
      outbox.get(c.tgId).push(text);
    }
  }
  const kb = new InlineKeyboard().text('📊 Открыть', 'n:open').text('✖ Закрыть', 'n:close');
  for (const [tgId, texts] of outbox) {
    try {
      await api.sendMessage(tgId, [...new Set(texts)].join('\n\n'), { parse_mode: 'HTML', reply_markup: kb });
    } catch (e) {
      // пользователь не запускал бота / заблокировал — не повторяем каждые N минут
      console.warn(`Уведомление ${tgId}:`, e.description ?? e.message);
    }
  }
  store.setNotified(active);
  return outbox.size;
}

export function startNotifier(deps) {
  const { config } = deps;
  if (!config.notify.enabled) return () => {};
  const run = () => checkOnce(deps).catch((e) => console.error('Notifier:', e.message));
  const first = setTimeout(run, 15_000);
  const timer = setInterval(run, config.notify.intervalMin * 60_000);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
