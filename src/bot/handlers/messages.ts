// Входящие сообщения: чек (если ждём оплату) или ссылка/ключ для привязки.
// Сообщения пользователя не засоряют чат — удаляются после обработки.
import { AccountService } from '../../services/accounts.js';
import { checkReceipt } from '../receipt.js';
import { paymentView, RECEIPT_NOTICE } from '../screens/shop.js';
import type { HandlerDeps, PrivateComposer } from './types.js';
import { ignoreError } from '../../lib/async.js';

export function registerMessages(pm: PrivateComposer, { ui, nav, panels, orders, shop }: HandlerDeps): void {
  pm.on('message', async (ctx) => {
    const uid = ctx.from.id;
    const m = ctx.message;
    const drop = () => ctx.deleteMessage().catch(ignoreError);
    const pending = shop.pendingOf(uid);
    const receipt = checkReceipt(m);
    const text = m.text ?? m.caption ?? '';

    if (pending) {
      if (receipt.kind === 'ok') {
        // сначала передаём файл админам, потом удаляем сообщение
        const customer = {
          uid,
          name: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '),
          username: ctx.from.username ?? null,
        };
        await panels.show(uid, () => orders.submit(customer, pending, receipt.file, m.caption ?? null));
        return drop();
      }
      await drop();
      if (receipt.kind === 'invalid')
        return panels.show(uid, () => paymentView(ui, pending, RECEIPT_NOTICE[receipt.reason]));
      // текст без ключа во время оплаты — напоминаем про чек; ключ — привязываем как обычно
      if (!AccountService.looksLikeKey(text))
        return panels.show(uid, () => paymentView(ui, pending, RECEIPT_NOTICE.text));
      return panels.show(uid, () => nav.link(uid, text));
    }

    await drop();
    if (receipt.kind !== 'none') {
      return panels.show(uid, () =>
        nav.home(uid, { notice: '🤔 Не знаю, что сделать с этим файлом. Чек можно прислать после выбора тарифа.' }),
      );
    }
    await panels.show(uid, () => (text ? nav.link(uid, text) : nav.home(uid)));
  });
}
