// Периодическая проверка сроков и трафика. Уведомление отправляется один раз,
// когда условие становится истинным (см. alertsFor — ключи дедупликации).
import { type Alert, type AlertThresholds, alertsFor } from '../domain/rules.js';
import type { TelegramId } from '../domain/types.js';
import type { StateStore } from '../infra/store.js';
import type { ClientRepository } from './clients.js';

/** Доставка уведомлений — реализуется слоем бота. */
export type AlertSender = (tgId: TelegramId, alerts: Alert[]) => Promise<void>;

export class NotificationService {
  constructor(
    private readonly clients: ClientRepository,
    private readonly store: StateStore,
    private readonly thresholds: AlertThresholds,
    private readonly send: AlertSender,
  ) {}

  /** Возвращает число пользователей, которым ушли уведомления. */
  async checkOnce(now = Date.now()): Promise<number> {
    const clients = await this.clients.list(true);
    const prev = this.store.getNotified();
    const active = new Set<string>();
    const outbox = new Map<TelegramId, Alert[]>();
    for (const c of clients) {
      if (!c.tgId || !c.enable) continue;
      for (const a of alertsFor(c, this.thresholds, now)) {
        active.add(a.key);
        if (prev.has(a.key)) continue;
        outbox.set(c.tgId, [...(outbox.get(c.tgId) ?? []), a]);
      }
    }
    for (const [tgId, alerts] of outbox) {
      // пользователь мог не запускать бота / заблокировать — не повторяем каждые N минут
      await this.send(tgId, alerts).catch((e: unknown) => {
        console.warn(`Уведомление ${tgId}:`, (e as Error).message);
      });
    }
    this.store.setNotified(active);
    return outbox.size;
  }

  start(intervalMin: number): () => void {
    const run = () =>
      void this.checkOnce().catch((e: unknown) => {
        console.error('Notifier:', (e as Error).message);
      });
    const first = setTimeout(run, 15_000);
    const timer = setInterval(run, intervalMin * 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }
}
