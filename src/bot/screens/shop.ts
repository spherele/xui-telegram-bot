import { InlineKeyboard } from 'grammy';
import { tariffPurchase } from '../../domain/rules.js';
import type { Client, Order, PendingPayment, Plan, Purchase } from '../../domain/types.js';
import { CB } from '../callbacks.js';
import type { View } from '../panel.js';
import { card, esc, fmtExpiry, hint, screen, steps, title, withNotice } from '../ui/format.js';
import { backKb, type Ui, withSupport } from './common.js';

const money = (ui: Ui, n: number) => esc(ui.shop.format(n));
const traffic = (p: Pick<Purchase, 'gb'>) => (p.gb ? `${p.gb} ГБ` : 'безлимит');

const purchaseCard = (ui: Ui, p: Purchase): string =>
  card(`<b>${esc(p.name)}</b> — <b>${money(ui, p.price)}</b>`, `📅 ${p.days} дн. · 📶 ${traffic(p)}`);

const whitelistLine = (ui: Ui): string | null =>
  ui.shop.whitelistEnabled
    ? `🛡 <b>${esc(ui.shop.whitelistName)}</b> — +${money(ui, ui.shop.whitelistMonthPrice)} в месяц, подключается на шаге оплаты`
    : null;

// ---------- каталог ----------

export function tariffsView(ui: Ui, notice?: string): View {
  if (!ui.shop.enabled) {
    return {
      text: withNotice(notice, screen(title('💳', 'Покупка'), 'Сейчас покупка недоступна — напишите в поддержку.')),
      keyboard: withSupport(ui, backKb()),
    };
  }
  const kb = new InlineKeyboard();
  ui.shop.tariffs.forEach((t, i) => kb.text(`${t.name} — ${ui.shop.format(t.price)}`, CB.tariff(i)).row());
  if (ui.shop.customEnabled) kb.text('🗓 Свой срок', CB.customTerm(1)).row();
  kb.text('« Назад', CB.home);

  const cards = ui.shop.tariffs.map((t) => purchaseCard(ui, tariffPurchase(t)));
  if (ui.shop.customEnabled) {
    cards.push(
      card('<b>🗓 Свой срок</b>', `от 1 до ${ui.shop.customMaxMonths} мес. · ${money(ui, ui.shop.monthPrice)} за месяц`),
    );
  }
  return {
    text: withNotice(
      notice,
      screen(
        title('💳', 'Тарифы'),
        cards.join('\n'),
        whitelistLine(ui),
        hint('Все серверы и устройства включены в любой тариф. Выберите тариф 👇'),
      ),
    ),
    keyboard: kb,
  };
}

/** Свой срок: выбор числа месяцев кнопками ➖/➕. */
export function customTermView(ui: Ui, months: number): View {
  const max = ui.shop.customMaxMonths;
  const m = Math.min(Math.max(1, months), max);
  const p = ui.shop.resolve({ kind: 'custom', months: m });
  if (!p) return tariffsView(ui);
  const kb = new InlineKeyboard()
    .text(m > 1 ? '➖' : '·', CB.customTerm(Math.max(1, m - 1)))
    .text(`${m} мес.`, CB.customTerm(m))
    .text(m < max ? '➕' : '·', CB.customTerm(Math.min(max, m + 1)))
    .row()
    .text(`Продолжить — ${ui.shop.format(p.price)}`, CB.plan({ kind: 'custom', months: m }))
    .row()
    .text('« Назад', CB.tariffs);
  return {
    text: screen(
      title('🗓', 'Свой срок'),
      card(`Срок: <b>${m} мес.</b> (${p.days} дн.)`, `Цена: <b>${money(ui, p.price)}</b>`, `📶 ${traffic(p)}`),
      whitelistLine(ui),
      hint(`${money(ui, ui.shop.monthPrice)} за месяц. Меняйте срок кнопками ➖ и ➕.`),
    ),
    keyboard: kb,
  };
}

/** Есть подписки — спрашиваем: продлить какую-то или купить новую. */
export function chooseTargetView(ui: Ui, plan: Plan, own: Client[]): View {
  const p = ui.shop.resolve(plan);
  if (!p) return tariffsView(ui);
  const kb = new InlineKeyboard();
  for (const c of own) kb.text(`🔄 Продлить ${c.email}`, CB.pay(plan, c.email)).row();
  kb.text('🆕 Новая подписка', CB.pay(plan, null))
    .row()
    .text('« Назад', plan.kind === 'custom' ? CB.customTerm(plan.months) : CB.tariffs);
  return {
    text: screen(title('💳', esc(p.name)), purchaseCard(ui, p), 'Продлить текущую подписку или оформить новую?'),
    keyboard: kb,
  };
}

// ---------- оплата ----------

export function payKeyboard(ui: Ui, p: PendingPayment): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (ui.shop.whitelistEnabled) {
    const cost = ui.shop.format(ui.shop.whitelistCost(p.purchase));
    kb.text(
      p.whitelist ? `✅ ${ui.shop.whitelistName} +${cost}` : `⬜ Добавить ${ui.shop.whitelistName} +${cost}`,
      CB.toggleWhitelist,
    ).row();
  }
  return withSupport(ui, kb.text('❌ Отмена', CB.payCancel));
}

export function paymentView(ui: Ui, p: PendingPayment, notice?: string): View {
  const total = money(ui, ui.shop.total(p));
  const wl = ui.shop.whitelistEnabled
    ? p.whitelist
      ? `🛡 ${esc(ui.shop.whitelistName)}: <b>да</b> (+${money(ui, ui.shop.whitelistCost(p.purchase))})`
      : `🛡 ${esc(ui.shop.whitelistName)}: нет${p.target ? ' — будет отключён от подписки' : ''}`
    : null;
  return {
    text: withNotice(
      notice,
      screen(
        title('💳', 'Оплата'),
        card(
          `Тариф: <b>${esc(p.purchase.name)}</b> · ${p.purchase.days} дн.`,
          p.target ? `Действие: 🔄 продление <b>${esc(p.target)}</b>` : 'Действие: 🆕 новая подписка',
          wl,
          `К оплате: <b>${total}</b>`,
        ),
        `<b>Реквизиты для перевода</b>\n${card(esc(ui.shop.paymentDetails))}`,
        '<b>Как оплатить</b>\n' +
          steps(
            `Переведите <b>${total}</b> по реквизитам`,
            'Пришлите сюда <b>скриншот или фото чека</b> (можно PDF)',
            'Дождитесь подтверждения — я пришлю уведомление',
          ),
        hint(
          ui.shop.whitelistEnabled
            ? `${esc(ui.shop.whitelistName)} включается кнопкой ниже — сумма пересчитается сразу.`
            : 'Подписка активируется автоматически после проверки оплаты.',
        ),
      ),
    ),
    keyboard: payKeyboard(ui, p),
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

const orderSummary = (ui: Ui, o: Order): string =>
  `${esc(o.purchase.name)}${o.whitelist ? ` + ${esc(ui.shop.whitelistName)}` : ''} — ${money(ui, o.amount)}`;

export function orderCaption(ui: Ui, o: Order): string {
  const who = `<a href="tg://user?id=${o.uid}">${esc(o.name || 'пользователь')}</a>`;
  return screen(
    title('🧾', `Заявка №${o.id}`),
    card(
      `👤 ${who}${o.username ? ` · @${esc(o.username)}` : ''}`,
      `🆔 <code>${o.uid}</code>`,
      `💳 ${esc(o.purchase.name)} · ${o.purchase.days} дн.`,
      ui.shop.whitelistEnabled || o.whitelist ? `🛡 ${esc(ui.shop.whitelistName)}: ${o.whitelist ? 'да' : 'нет'}` : null,
      `💰 К оплате: <b>${money(ui, o.amount)}</b>`,
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

export const openOrderLine = (ui: Ui, o: Order): string => `№${o.id} · ${esc(o.name)} · ${orderSummary(ui, o)}`;

// ---------- пользователю ----------

export const approvedMessage = (ui: Ui, o: Order, email: string, expiry: number): string =>
  screen(
    title('✅', 'Оплата подтверждена!'),
    card(
      `Заявка №${o.id} · ${orderSummary(ui, o)}`,
      `👤 <b>${esc(email)}</b>`,
      `📅 ${fmtExpiry(expiry, ui.config.tz)}`,
    ),
    'Откройте меню, чтобы получить ссылку и QR-код для подключения.',
  );

export const rejectedMessage = (ui: Ui, o: Order): string =>
  screen(
    title('❌', 'Оплата не подтверждена'),
    card(`Заявка №${o.id} · ${orderSummary(ui, o)}`),
    'Если перевод прошёл, напишите в поддержку — разберёмся.',
  );
