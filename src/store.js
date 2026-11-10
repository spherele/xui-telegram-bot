// Небольшое JSON-хранилище: id «панельного» сообщения каждого пользователя,
// состояние уведомлений, ожидаемые оплаты и заявки на покупку.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class Store {
  constructor(file) {
    this.file = file;
    this.data = { panels: {}, notified: [], pending: {}, orders: {}, orderSeq: 0 };
    this.timer = null;
  }

  async load() {
    try {
      this.data = { ...this.data, ...JSON.parse(await readFile(this.file, 'utf8')) };
    } catch (e) {
      if (e.code !== 'ENOENT') console.warn('Не удалось прочитать состояние:', e.message);
    }
  }

  getPanel(uid) {
    return this.data.panels[uid] ?? null;
  }

  setPanel(uid, panel) {
    this.data.panels[uid] = panel;
    this.save();
  }

  /** Пользователь выбрал тариф и должен прислать чек. */
  getPending(uid) {
    return this.data.pending[uid] ?? null;
  }

  setPending(uid, p) {
    if (p) this.data.pending[uid] = p;
    else delete this.data.pending[uid];
    this.save();
  }

  newOrder(order) {
    const id = ++this.data.orderSeq;
    this.data.orders[id] = { id, status: 'pending', createdAt: Date.now(), ...order };
    this.save();
    return this.data.orders[id];
  }

  getOrder(id) {
    return this.data.orders[id] ?? null;
  }

  updateOrder(id, patch) {
    Object.assign(this.data.orders[id], patch);
    this.save();
    return this.data.orders[id];
  }

  getNotified() {
    return new Set(this.data.notified);
  }

  setNotified(set) {
    this.data.notified = [...set];
    this.save();
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush().catch((e) => console.error('Сохранение:', e)), 500);
  }

  async flush() {
    clearTimeout(this.timer);
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(this.data));
    await rename(tmp, this.file);
  }
}
