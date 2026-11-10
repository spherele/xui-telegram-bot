// Состояние бота в JSON-файле (запись атомарная, с отложенным сохранением).
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Order, PendingPayment, TelegramId } from '../domain/types.js';

export interface PanelRef {
  id: number;
  kind: 'text' | 'photo';
}

export interface State {
  panels: Record<string, PanelRef>;
  notified: string[];
  pending: Record<string, PendingPayment>;
  orders: Record<string, Order>;
  orderSeq: number;
}

/** Заявка из старых версий: поля, появившиеся позже, могут отсутствовать. */
type LegacyOrder = Omit<Order, 'adminMsgs' | 'fileUid' | 'fileInfo' | 'comment'> &
  Partial<Pick<Order, 'adminMsgs' | 'fileUid' | 'fileInfo' | 'comment'>>;

const upgradeOrder = (o: LegacyOrder): Order => ({ adminMsgs: [], fileUid: null, fileInfo: null, comment: null, ...o });

const mapValues = <A, B>(r: Record<string, A>, fn: (a: A) => B): Record<string, B> =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, fn(v)]));

const empty = (): State => ({ panels: {}, notified: [], pending: {}, orders: {}, orderSeq: 0 });

export class StateStore {
  private data: State = empty();
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly file: string | null) {}

  /** Хранилище в памяти — для тестов. */
  static inMemory(): StateStore {
    return new StateStore(null);
  }

  async load(): Promise<void> {
    if (!this.file) return;
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Partial<Omit<State, 'orders'>> & {
        orders?: Record<string, LegacyOrder>;
      };
      this.data = { ...empty(), ...raw, orders: mapValues(raw.orders ?? {}, upgradeOrder) };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
        console.warn('Не удалось прочитать состояние:', (e as Error).message);
    }
  }

  // ---------- панели ----------

  getPanel(uid: TelegramId): PanelRef | null {
    return this.data.panels[uid] ?? null;
  }

  setPanel(uid: TelegramId, panel: PanelRef): void {
    this.data.panels[uid] = panel;
    this.save();
  }

  // ---------- уведомления ----------

  getNotified(): Set<string> {
    return new Set(this.data.notified);
  }

  setNotified(keys: Iterable<string>): void {
    this.data.notified = [...keys];
    this.save();
  }

  // ---------- оплата ----------

  getPending(uid: TelegramId): PendingPayment | null {
    return this.data.pending[uid] ?? null;
  }

  setPending(uid: TelegramId, p: PendingPayment | null): void {
    const { [String(uid)]: _removed, ...rest } = this.data.pending;
    this.data.pending = p ? { ...rest, [uid]: p } : rest;
    this.save();
  }

  createOrder(fields: Omit<Order, 'id' | 'status' | 'createdAt' | 'adminMsgs'>): Order {
    const id = ++this.data.orderSeq;
    const order: Order = { ...fields, id, status: 'pending', createdAt: Date.now(), adminMsgs: [] };
    this.data.orders[id] = order;
    this.save();
    return order;
  }

  getOrder(id: number): Order | null {
    return this.data.orders[id] ?? null;
  }

  updateOrder(id: number, patch: Partial<Order>): Order {
    const o = this.data.orders[id];
    if (!o) throw new Error(`Заявка ${id} не найдена`);
    Object.assign(o, patch);
    this.save();
    return o;
  }

  orders(): Order[] {
    return Object.values(this.data.orders);
  }

  // ---------- сохранение ----------

  private save(): void {
    if (!this.file) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () =>
        void this.flush().catch((e: unknown) => {
          console.error('Сохранение:', e);
        }),
      500,
    );
  }

  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (!this.file) return;
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(this.data));
    await rename(tmp, this.file);
  }
}
