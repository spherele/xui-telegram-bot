import { InlineKeyboard } from 'grammy';
import type { Client, Order, PendingPayment, Tariff } from '../../domain/types.js';
import { CB } from '../callbacks.js';
import type { View } from '../panel.js';
import { card, esc, fmtExpiry, hint, screen, steps, title, withNotice } from '../ui/format.js';
import { backKb, type Ui, withSupport } from './common.js';

const tariffCard = (ui: Ui, t: Tariff): string =>
  card(
    `<b>${esc(t.name)}</b> — <b>${esc(ui.shop.price(t))}</b>`,
    `📅 ${t.days} дн. · 📶 ${t.gb ? `${t.gb} ГБ` : 'безлимит'}`,
  );

export function tariffsView(ui: Ui, notice?: string): View {
  if (!ui.shop.enabled) {
    return {
      text: withNotice(notice, screen(title('💳', 'Покупка'), 'Сейчас покупка недоступна — напишите в поддержку.')),
      keyboard: withSupport(ui, backKb()),
    };
  }
  const kb = new InlineKeyboard();
  ui.shop.tariffs.forEach((t, i) => kb.text(`${t.name} — ${ui.shop.price(t)}`, CB.tariff(i)).row());
  kb.text('« Назад', CB.home);
  return {
    text: withNotice(
      notice,
      screen(
        title('💳', 'Тарифы'),
        ui.shop.tariffs.map((t) => tariffCard(ui, t)).join('\n'),
        hint('Все серверы и устройства включены в любой тариф. Выберите тариф 👇'),
      ),
    ),
    keyboard: kb,
  };
}

/** Есть подписки — спрашиваем: продлить какую-то или купить новую. */
export function chooseTargetView(ui: Ui, index: number, own: Client[]): View {
  const t = ui.shop.tariffs[index];
  if (!t) return tariffsView(ui);
  const kb = new InlineKeyboard();
  for (const c of own) kb.text(`🔄 Продлить ${c.email}`, CB.pay(index, c.email)).row();
  kb.text('🆕 Новая подписка', CB.pay(index, null)).row().text('« Назад', CB.tariffs);
  return {
    text: screen(title('💳', esc(t.name)), tariffCard(ui, t), 'Продлить текущую подписку или оформить новую?'),
    keyboard: kb,
  };
}

export const payKeyboard = (ui: Ui): InlineKeyboard =>
  withSupport(ui, new InlineKeyboard().text('❌ Отмена', CB.payCancel));

export function paymentView(ui: Ui, p: PendingPayment, notice?: string): View {
  const sum = esc(ui.shop.price(p.tariff));
  return {
    text: withNotice(
      notice,
      screen(
        title('💳', 'Оплата'),
        card(
          `Тариф: <b>${esc(p.tariff.name)}</b>`,
          p.target ? `Действие: 🔄 продление <b>${esc(p.target)}</b>` : 'Действие: 🆕 новая подписка',
          `К оплате: <b>${sum}</b>`,
        ),
        `<b>Реквизиты для перевода</b>\n${card(esc(ui.shop.paymentDetails))}`,
        '<b>Как оплатить</b>\n' +
          steps(
            `Переведите <b>${sum}</b> по реквизитам`,
            'Пришлите сюда <b>скриншот или фото чека</b> (можно PDF)',
            'Дождитесь подтверждения — я пришлю уведомление',
          ),
        hint('Подписка активируется автоматически после проверки оплаты.'),
      ),
    ),
    keyboard: payKeyboard(ui),
  };
}

export const RECEIPT_NOTICE = {
  type: '⚠️ Это не похоже на чек. Пришлите <b>скриншот, фото или PDF</b> чека.',
  size: '⚠️ Файл слишком большой — максимум 10 МБ.',
  text: '📸 Пришлите, пожалуйста, <b>скриншот или фото чека</b>.',
  duplicate: '⚠️ Этот чек уже отправлялся. Пришлите чек именно этого перевода.',
  undelivered: '⚠️ Не удалось передать чек администратору. Напишите, пожалуйста, в поддержку.',
} as const;

export const waitingNotice = (o: Order): string =>
  `⏳ Заявка №${o.id} ещё на проверке. Новую можно отправить после решения по ней.`;

export const submittedNotice = (o: Order): string =>
  `🧾 <b>Заявка №${o.id} отправлена!</b>\nКак только оплата будет проверена, подписка активируется — я пришлю уведомление.`;

// ---------- админ ----------

export function orderCaption(ui: Ui, o: Order): string {
  const who = `<a href="tg://user?id=${o.uid}">${esc(o.name || 'пользователь')}</a>`;
  return screen(
    title('🧾', `Заявка №${o.id}`),
    card(
      `👤 ${who}${o.username ? ` · @${esc(o.username)}` : ''}`,
      `🆔 <code>${o.uid}</code>`,
      `💳 ${esc(o.tariff.name)} — <b>${esc(ui.shop.price(o.tariff))}</b>`,
      `🎯 ${o.target ? `продление <code>${esc(o.target)}</code>` : 'новая подписка'}`,
      o.fileInfo ? `📎 ${esc(o.fileInfo)}` : null,
    ),
    o.comment ? `💬 ${esc(o.comment.slice(0, 300))}` : null,
    hint('Сверьте сумму и дату перевода, затем нажмите кнопку.'),
  );
}

export const orderKeyboard = (o: Order): InlineKeyboard =>
  new InlineKeyboard().text('✅ Подтвердить', CB.orderApprove(o.id)).text('❌ Отклонить', CB.orderReject(o.id));

export const orderApprovedLine = (ui: Ui, by: string, email: string, expiry: number): string =>
  `✅ Подтверждено — ${esc(by)}\n→ <code>${esc(email)}</code>, ${fmtExpiry(expiry, ui.config.tz)}`;

export const orderRejectedLine = (by: string): string => `❌ Отклонено — ${esc(by)}`;

export const orderErrorText = (o: Order, error: Error): string =>
  `⚠️ Заявка №${o.id}: не удалось активировать — ${esc(error.message)}\nКнопки в заявке снова активны.`;

// ---------- пользователю ----------

export const approvedMessage = (ui: Ui, o: Order, email: string, expiry: number): string =>
  screen(
    title('✅', 'Оплата подтверждена!'),
    card(`Заявка №${o.id} · ${esc(o.tariff.name)}`, `👤 <b>${esc(email)}</b>`, `📅 ${fmtExpiry(expiry, ui.config.tz)}`),
    'Откройте меню, чтобы получить ссылку и QR-код для подключения.',
  );

export const rejectedMessage = (ui: Ui, o: Order): string =>
  screen(
    title('❌', 'Оплата не подтверждена'),
    card(`Заявка №${o.id} · ${esc(o.tariff.name)} — ${esc(ui.shop.price(o.tariff))}`),
    'Если перевод прошёл, напишите в поддержку — разберёмся.',
  );
