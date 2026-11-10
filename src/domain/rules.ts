// Чистые бизнес-правила: без I/O, легко тестируются.
import type { Client, Purchase, Tariff } from './types.js';

export const DAY_MS = 86_400_000;
export const GB = 1024 ** 3;

export const usedBytes = (c: Pick<Client, 'up' | 'down'>): number => c.up + c.down;

export type ClientState = 'active' | 'disabled' | 'expired' | 'depleted';

export function clientState(c: Client, now = Date.now()): ClientState {
  if (!c.enable) return 'disabled';
  if (c.expiryTime > 0 && c.expiryTime <= now) return 'expired';
  if (c.totalBytes > 0 && usedBytes(c) >= c.totalBytes) return 'depleted';
  return 'active';
}

export const isActive = (c: Client, now = Date.now()): boolean => clientState(c, now) === 'active';

type Duration = Pick<Purchase, 'days'>;
type Volume = Pick<Purchase, 'gb'>;

/** Новый срок при продлении. */
export function extendedExpiry(current: number, p: Duration, now = Date.now()): number {
  const add = p.days * DAY_MS;
  if (current > 0) return Math.max(current, now) + add; // истёкшая — от сегодня
  if (current < 0) return current - add; // срок ещё не начался — добавляем длительность
  return 0; // бессрочная остаётся бессрочной
}

export const purchaseBytes = (p: Volume): number => (p.gb > 0 ? p.gb * GB : 0);

/** Месяцев в сроке — для помесячных доплат: 30 дн. → 1, 90 → 3, 365 → 12. */
export const monthsIn = (days: number): number => Math.max(1, Math.round(days / 30));

export const tariffPurchase = (t: Tariff): Purchase => ({ ...t, months: monthsIn(t.days) });

export const customPurchase = (months: number, monthPrice: number): Purchase => ({
  name: `${months} мес.`,
  days: months * 30,
  months,
  price: months * monthPrice,
  gb: 0,
});

/** Сумма к оплате: базовая цена + доплата за white-list за каждый месяц. */
export const purchaseTotal = (p: Purchase, whitelist: boolean, whitelistMonthPrice: number): number =>
  p.price + (whitelist ? whitelistMonthPrice * p.months : 0);

/** Инбаунды подписки после покупки: white-list добавляется или убирается, остальное не трогаем. */
export function inboundsWith(base: readonly number[], whitelistIds: readonly number[], whitelist: boolean): number[] {
  const wl = new Set(whitelistIds);
  const rest = base.filter((id) => !wl.has(id));
  return whitelist ? [...rest, ...whitelistIds] : rest;
}

// ---------- уведомления ----------

export type AlertKind = 'expired' | 'expiring' | 'depleted' | 'traffic_low';

export interface Alert {
  /** Ключ дедупликации: уведомление уходит, когда ключ появляется впервые. */
  key: string;
  kind: AlertKind;
  client: Client;
}

export interface AlertThresholds {
  days: number;
  trafficPercent: number;
}

/**
 * Активные условия для клиента. Ключи включают expiryTime/totalBytes,
 * поэтому после продления или смены лимита уведомление сработает снова.
 */
export function alertsFor(c: Client, t: AlertThresholds, now = Date.now()): Alert[] {
  const out: Alert[] = [];
  if (c.expiryTime > 0) {
    const left = c.expiryTime - now;
    if (left <= 0) out.push({ key: `exp0:${c.email}:${c.expiryTime}`, kind: 'expired', client: c });
    else if (left <= t.days * DAY_MS) out.push({ key: `exp:${c.email}:${c.expiryTime}`, kind: 'expiring', client: c });
  }
  if (c.totalBytes > 0) {
    const u = usedBytes(c);
    if (u >= c.totalBytes) out.push({ key: `trf0:${c.email}:${c.totalBytes}`, kind: 'depleted', client: c });
    else if ((u / c.totalBytes) * 100 >= t.trafficPercent)
      out.push({ key: `trf:${c.email}:${c.totalBytes}`, kind: 'traffic_low', client: c });
  }
  return out;
}
