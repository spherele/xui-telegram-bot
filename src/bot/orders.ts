// Работа с заявками на стороне Telegram: доставка чека админам и решение по заявке.
import type { Api } from 'grammy';
import type { Order, PendingPayment, TelegramId } from '../domain/types.js';
import type { Customer, ReceiptFile, ShopService } from '../services/shop.js';
import { InlineKeyboard } from 'grammy';
import { CB } from './callbacks.js';
import type { Navigator } from './navigator.js';
import type { Panels, View } from './panel.js';
import { notifyKeyboard } from './screens/alerts.js';
import { type Ui, withSupport } from './screens/common.js';
import * as shop from './screens/shop.js';
import { ignoreError } from '../lib/async.js';

type OrderApi = Pick<Api, 'sendPhoto' | 'sendDocument' | 'sendMessage' | 'editMessageCaption'>;

export interface Admin {
  id: TelegramId;
  username?: string | undefined;
  first_name: string;
}

export class OrderFlow {
  constructor(
    private readonly api: OrderApi,
    private readonly ui: Ui,
    private readonly shop: ShopService,
    private readonly nav: Navigator,
    private readonly panels: Panels,
  ) {}

  /** Пользователь прислал подходящий чек — создаём заявку и рассылаем её админам. */
  async submit(customer: Customer, pending: PendingPayment, file: ReceiptFile, comment: string | null): Promise<View> {
    const r = this.shop.submit(customer, pending, file, comment);
    if (r.kind === 'duplicate') return shop.paymentView(this.ui, pending, shop.RECEIPT_NOTICE.duplicate);
    if (r.kind === 'waiting') return this.nav.home(customer.uid, { notice: shop.waitingNotice(r.order) });

    const caption = shop.orderCaption(this.ui, r.order);
    const opts = { caption, parse_mode: 'HTML' as const, reply_markup: shop.orderKeyboard(r.order) };
    const msgs = [];
    for (const admin of this.ui.config.adminIds) {
      try {
        const m =
          file.type === 'photo'
            ? await this.api.sendPhoto(admin, file.fileId, opts)
            : await this.api.sendDocument(admin, file.fileId, opts);
        msgs.push({ chat: admin, id: m.message_id });
      } catch (e) {
        console.warn(
          `Заявка №${r.order.id} → админ ${admin}:`,
          (e as { description?: string }).description ?? (e as Error).message,
        );
      }
    }
    if (!msgs.length) {
      this.shop.undeliverable(r.order.id);
      return shop.paymentView(this.ui, pending, shop.RECEIPT_NOTICE.undelivered);
    }
    this.shop.delivered(r.order.id, msgs);
    return this.nav.home(customer.uid, { notice: shop.submittedNotice(r.order) });
  }

  /** Админ нажал «Подтвердить»/«Отклонить». Возвращает текст всплывающего ответа на кнопку. */
  async decide(admin: Admin, orderId: number, approve: boolean): Promise<string | null> {
    if (!this.ui.config.adminIds.has(admin.id)) return 'Нет доступа';
    const by = admin.username ? `@${admin.username}` : admin.first_name;
    const r = await this.shop.decide(orderId, admin.id, approve);
    switch (r.kind) {
      case 'not_found':
        return 'Заявка не найдена';
      case 'already':
        return `Заявка уже обработана (${r.order.status})`;
      case 'error':
        console.error(`Заявка №${orderId}:`, r.error);
        await this.api
          .sendMessage(admin.id, shop.orderErrorText(r.order, r.error), { parse_mode: 'HTML' })
          .catch(ignoreError);
        return 'Не удалось активировать';
      case 'rejected':
        await this.finish(r.order, shop.orderRejectedLine(by));
        await this.notify(
          r.order.uid,
          shop.rejectedMessage(this.ui, r.order),
          withSupport(this.ui, new InlineKeyboard()).text('✖ Закрыть', CB.notifyClose),
        );
        return 'Отклонено';
      case 'approved':
        await this.finish(r.order, shop.orderApprovedLine(this.ui, by, r.email, r.expiryTime));
        await this.notify(r.order.uid, shop.approvedMessage(this.ui, r.order, r.email, r.expiryTime), notifyKeyboard());
        // обновим панель пользователя, чтобы там не висело «заявка отправлена»
        if (this.panels.hasPanel(r.order.uid)) {
          await this.panels.show(r.order.uid, () => this.nav.home(r.order.uid, { fresh: true })).catch(ignoreError);
        }
        return 'Подписка активирована';
    }
  }

  /** Дописываем решение в подпись заявки у всех админов и убираем кнопки. */
  private async finish(o: Order, statusLine: string): Promise<void> {
    const caption = `${shop.orderCaption(this.ui, o)}\n\n${statusLine}`;
    for (const m of o.adminMsgs) {
      await this.api.editMessageCaption(m.chat, m.id, { caption, parse_mode: 'HTML' }).catch(ignoreError);
    }
  }

  private async notify(uid: TelegramId, text: string, kb: InlineKeyboard): Promise<void> {
    await this.api.sendMessage(uid, text, { parse_mode: 'HTML', reply_markup: kb }).catch((e: unknown) => {
      console.warn(`Уведомление ${uid}:`, (e as Error).message);
    });
  }
}
