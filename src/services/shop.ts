// Магазин: тариф или свой срок (+ white-list) → ожидание чека → заявка → решение админа
// → создание или продление клиента в панели.
import type { ShopConfig } from '../config.js';
import {
  customPurchase,
  DAY_MS,
  extendedExpiry,
  inboundsWith,
  purchaseBytes,
  purchaseTotal,
  tariffPurchase,
} from '../domain/rules.js';
import type { AdminMessageRef, Order, PendingPayment, Plan, Purchase, Tariff, TelegramId } from '../domain/types.js';
import type { StateStore } from '../infra/store.js';
import type { ClientRepository } from './clients.js';

/** Выбранная покупка ждёт чек не дольше суток. */
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

  // ---------- каталог ----------

  get enabled(): boolean {
    return (this.cfg.tariffs.length > 0 || this.customEnabled) && !!this.cfg.paymentDetails && this.adminCount > 0;
  }

  get tariffs(): readonly Tariff[] {
    return this.cfg.tariffs;
  }

  get paymentDetails(): string {
    return this.cfg.paymentDetails;
  }

  /** «Свой срок»: от 1 до customMaxMonths месяцев по цене месяца. */
  get customEnabled(): boolean {
    return this.cfg.monthPrice > 0 && this.cfg.customMaxMonths > 0;
  }

  get monthPrice(): number {
    return this.cfg.monthPrice;
  }

  get customMaxMonths(): number {
    return this.cfg.customMaxMonths;
  }

  get whitelistEnabled(): boolean {
    return this.cfg.whitelist.inboundIds.length > 0 && this.cfg.whitelist.monthPrice > 0;
  }

  get whitelistName(): string {
    return this.cfg.whitelist.name;
  }

  get whitelistMonthPrice(): number {
    return this.cfg.whitelist.monthPrice;
  }

  /** Расшифровка плана; null — такого тарифа/срока нет. */
  resolve(plan: Plan): Purchase | null {
    if (plan.kind === 'tariff') {
      const t = this.cfg.tariffs[plan.index];
      return t ? tariffPurchase(t) : null;
    }
    if (!this.customEnabled || plan.months < 1 || plan.months > this.cfg.customMaxMonths) return null;
    return customPurchase(plan.months, this.cfg.monthPrice);
  }

  /** Доплата за white-list на срок покупки. */
  whitelistCost(p: Purchase): number {
    return this.cfg.whitelist.monthPrice * p.months;
  }

  total(p: Pick<PendingPayment, 'purchase' | 'whitelist'>): number {
    return purchaseTotal(p.purchase, p.whitelist && this.whitelistEnabled, this.cfg.whitelist.monthPrice);
  }

  format(amount: number): string {
    return `${amount.toLocaleString('ru-RU')} ${this.cfg.currency}`;
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
  async startPayment(uid: TelegramId, plan: Plan, targetEmail: string | null): Promise<StartPaymentResult> {
    const purchase = this.resolve(plan);
    if (!purchase || !this.enabled) return { kind: 'unavailable' };
    const waiting = this.openOrderOf(uid);
    if (waiting) return { kind: 'waiting', order: waiting };
    let whitelist = false;
    if (targetEmail !== null) {
      const target = (await this.clients.byTgId(uid)).find((c) => c.email === targetEmail);
      if (!target) return { kind: 'target_not_found' };
      // по умолчанию — как сейчас: у кого white-list подключён, переключатель включён
      whitelist = this.hasWhitelist(target.inboundIds);
    }
    const pending: PendingPayment = { purchase, target: targetEmail, whitelist, at: Date.now() };
    this.store.setPending(uid, pending);
    return { kind: 'ok', pending };
  }

  /** Переключить white-list в текущей оплате. */
  toggleWhitelist(uid: TelegramId): PendingPayment | null {
    const p = this.pendingOf(uid);
    if (!p || !this.whitelistEnabled) return p;
    const next = { ...p, whitelist: !p.whitelist };
    this.store.setPending(uid, next);
    return next;
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
    const whitelist = pending.whitelist && this.whitelistEnabled;
    const order = this.store.createOrder({
      uid: customer.uid,
      name: customer.name,
      username: customer.username,
      purchase: pending.purchase,
      target: pending.target,
      whitelist,
      amount: this.total({ purchase: pending.purchase, whitelist }),
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

  // ---------- выполнение ----------

  private hasWhitelist(inboundIds: readonly number[]): boolean {
    return this.cfg.whitelist.inboundIds.some((id) => inboundIds.includes(id));
  }

  private async fulfill(o: Order): Promise<{ email: string; expiryTime: number }> {
    const totalBytes = purchaseBytes(o.purchase);
    const wl = this.cfg.whitelist.inboundIds;

    if (!o.target) {
      const base = (o.username ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '') || `tg${o.uid}`;
      const email = await this.clients.uniqueEmail(base);
      const expiryTime = Date.now() + o.purchase.days * DAY_MS;
      const defaults = this.cfg.inboundIds.length ? this.cfg.inboundIds : await this.clients.enabledInboundIds();
      await this.clients.create({
        email,
        tgId: o.uid,
        expiryTime,
        totalBytes,
        // white-list — только если оплачен
        inboundIds: inboundsWith(defaults, wl, o.whitelist),
        limitIp: this.cfg.limitIp,
        group: this.cfg.group,
        comment: `Telegram, заявка №${o.id}`,
      });
      return { email, expiryTime };
    }

    const c = await this.clients.byEmail(o.target);
    if (!c) throw new Error(`Клиент ${o.target} не найден`);
    const expiryTime = extendedExpiry(c.expiryTime, o.purchase);
    const changes: Record<string, unknown> = { enable: true };
    if (expiryTime !== c.expiryTime) changes.expiryTime = expiryTime;
    if (totalBytes) changes.totalGB = totalBytes;
    await this.clients.update(c.email, changes);
    if (totalBytes) await this.clients.resetTraffic(c.email);
    // white-list: оплачен — подключаем, снят — отключаем (если опция настроена)
    if (wl.length) await this.clients.setInbounds(c.email, c.inboundIds, inboundsWith(c.inboundIds, wl, o.whitelist));
    return { email: c.email, expiryTime };
  }
}
