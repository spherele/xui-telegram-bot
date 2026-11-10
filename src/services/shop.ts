// Магазин: тариф → ожидание чека → заявка → решение админа → создание/продление клиента.
import type { ShopConfig } from '../config.js';
import { DAY_MS, extendedExpiry, tariffBytes } from '../domain/rules.js';
import type { AdminMessageRef, Order, PendingPayment, Tariff, TelegramId } from '../domain/types.js';
import type { StateStore } from '../infra/store.js';
import type { ClientRepository } from './clients.js';

/** Выбранный тариф ждёт чек не дольше суток. */
const PENDING_TTL_MS = DAY_MS;

export interface Customer {
  uid: TelegramId;
  name: string;
  username: string | null;
}

/** Уже проверенный на тип и размер файл чека. */
export interface ReceiptFile {
  type: 'photo' | 'document';
  fileId: string;
  fileUid: string;
  info: string | null;
}

export type StartPaymentResult =
  | { kind: 'ok'; pending: PendingPayment }
  | { kind: 'waiting'; order: Order }
  | { kind: 'unavailable' }
  | { kind: 'target_not_found' };

export type SubmitResult =
  { kind: 'created'; order: Order } | { kind: 'duplicate' } | { kind: 'waiting'; order: Order };

export type DecisionResult =
  | { kind: 'not_found' }
  | { kind: 'already'; order: Order }
  | { kind: 'rejected'; order: Order }
  | { kind: 'approved'; order: Order; email: string; expiryTime: number }
  | { kind: 'error'; order: Order; error: Error };

const OPEN: ReadonlySet<Order['status']> = new Set(['pending', 'processing']);

export class ShopService {
  constructor(
    private readonly cfg: ShopConfig,
    private readonly adminCount: number,
    private readonly store: StateStore,
    private readonly clients: ClientRepository,
  ) {}

  get enabled(): boolean {
    return this.cfg.tariffs.length > 0 && !!this.cfg.paymentDetails && this.adminCount > 0;
  }

  get tariffs(): readonly Tariff[] {
    return this.cfg.tariffs;
  }

  get paymentDetails(): string {
    return this.cfg.paymentDetails;
  }

  price(t: Tariff): string {
    return `${t.price} ${this.cfg.currency}`;
  }

  // ---------- пользователь ----------

  openOrderOf(uid: TelegramId): Order | null {
    return this.store.orders().find((o) => o.uid === uid && OPEN.has(o.status)) ?? null;
  }

  pendingOf(uid: TelegramId): PendingPayment | null {
    const p = this.store.getPending(uid);
    return p && Date.now() - p.at < PENDING_TTL_MS ? p : null;
  }

  /** targetEmail — продлеваемая подписка пользователя; null — новая. */
  async startPayment(uid: TelegramId, tariffIndex: number, targetEmail: string | null): Promise<StartPaymentResult> {
    const tariff = this.cfg.tariffs[tariffIndex];
    if (!tariff || !this.enabled) return { kind: 'unavailable' };
    const waiting = this.openOrderOf(uid);
    if (waiting) return { kind: 'waiting', order: waiting };
    if (targetEmail !== null) {
      const own = await this.clients.byTgId(uid);
      if (!own.some((c) => c.email === targetEmail)) return { kind: 'target_not_found' };
    }
    const pending: PendingPayment = { tariff, target: targetEmail, at: Date.now() };
    this.store.setPending(uid, pending);
    return { kind: 'ok', pending };
  }

  cancel(uid: TelegramId): void {
    this.store.setPending(uid, null);
  }

  submit(customer: Customer, pending: PendingPayment, file: ReceiptFile, comment: string | null): SubmitResult {
    // тот же файл нельзя использовать повторно — кроме отклонённых заявок
    if (
      this.store.orders().some((o) => o.fileUid === file.fileUid && o.status !== 'rejected' && o.status !== 'failed')
    ) {
      return { kind: 'duplicate' };
    }
    const waiting = this.openOrderOf(customer.uid);
    if (waiting) {
      this.store.setPending(customer.uid, null);
      return { kind: 'waiting', order: waiting };
    }
    const order = this.store.createOrder({
      uid: customer.uid,
      name: customer.name,
      username: customer.username,
      tariff: pending.tariff,
      target: pending.target,
      fileUid: file.fileUid,
      fileInfo: file.info,
      comment,
    });
    return { kind: 'created', order };
  }

  /** Заявка доставлена админам — сохраняем ссылки на сообщения и закрываем ожидание чека. */
  delivered(orderId: number, msgs: AdminMessageRef[]): Order {
    const order = this.store.updateOrder(orderId, { adminMsgs: msgs });
    this.store.setPending(order.uid, null);
    return order;
  }

  undeliverable(orderId: number): void {
    this.store.updateOrder(orderId, { status: 'failed' });
  }

  // ---------- админ ----------

  openOrders(): Order[] {
    return this.store.orders().filter((o) => o.status === 'pending');
  }

  allOrders(): Order[] {
    return this.store.orders();
  }

  async decide(orderId: number, adminId: TelegramId, approve: boolean): Promise<DecisionResult> {
    const order = this.store.getOrder(orderId);
    if (!order) return { kind: 'not_found' };
    if (order.status !== 'pending') return { kind: 'already', order };
    // помечаем синхронно — повторное нажатие увидит 'processing'
    this.store.updateOrder(orderId, { status: 'processing' });

    if (!approve) {
      return {
        kind: 'rejected',
        order: this.store.updateOrder(orderId, { status: 'rejected', decidedBy: adminId, decidedAt: Date.now() }),
      };
    }
    try {
      const { email, expiryTime } = await this.fulfill(order);
      const done = this.store.updateOrder(orderId, {
        status: 'done',
        email,
        decidedBy: adminId,
        decidedAt: Date.now(),
      });
      return { kind: 'approved', order: done, email, expiryTime };
    } catch (e) {
      return { kind: 'error', order: this.store.updateOrder(orderId, { status: 'pending' }), error: e as Error };
    }
  }

  private async fulfill(o: Order): Promise<{ email: string; expiryTime: number }> {
    const totalBytes = tariffBytes(o.tariff);
    if (!o.target) {
      const base = (o.username ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '') || `tg${o.uid}`;
      const email = await this.clients.uniqueEmail(base);
      const expiryTime = Date.now() + o.tariff.days * DAY_MS;
      await this.clients.create({
        email,
        tgId: o.uid,
        expiryTime,
        totalBytes,
        inboundIds: this.cfg.inboundIds.length ? this.cfg.inboundIds : await this.clients.enabledInboundIds(),
        limitIp: this.cfg.limitIp,
        group: this.cfg.group,
        comment: `Telegram, заявка №${o.id}`,
      });
      return { email, expiryTime };
    }
    const c = await this.clients.byEmail(o.target);
    if (!c) throw new Error(`Клиент ${o.target} не найден`);
    const expiryTime = extendedExpiry(c.expiryTime, o.tariff);
    const changes: Record<string, unknown> = { enable: true };
    if (expiryTime !== c.expiryTime) changes.expiryTime = expiryTime;
    if (totalBytes) changes.totalGB = totalBytes;
    await this.clients.update(c.email, changes);
    if (totalBytes) await this.clients.resetTraffic(c.email);
    return { email: c.email, expiryTime };
  }
}
