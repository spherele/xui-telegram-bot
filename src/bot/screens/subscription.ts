import { InlineKeyboard } from 'grammy';
import QRCode from 'qrcode';
import type { Client } from '../../domain/types.js';
import type { LinkResult } from '../../services/accounts.js';
import { CB } from '../callbacks.js';
import type { View } from '../panel.js';
import { card, esc, hint, screen, steps, title } from '../ui/format.js';
import { backKb } from './common.js';

export const linkHelpView = (): View => ({
  text: screen(
    title('🔑', 'Привязка подписки'),
    'Пришлите сюда <b>одно</b> из:',
    card(
      '🔗 ссылку подписки — <code>https://…</code>',
      '🔐 или ключ — <code>vless://</code>, <code>vmess://</code>, <code>trojan://</code>, <code>ss://</code>',
    ),
    hint('Ссылку можно скопировать в VPN-приложении. Сообщение с ней я сразу удалю — она никому не видна.'),
  ),
  keyboard: backKb(),
});

export const subscriptionUrl = (subUrl: string, c: Client): string => `${subUrl.replace(/\/+$/, '')}/${c.subId}`;

export async function subscriptionView(subUrl: string, c: Client): Promise<View> {
  const url = subscriptionUrl(subUrl, c);
  return {
    photo: await QRCode.toBuffer(url, { width: 512, margin: 2, errorCorrectionLevel: 'M' }),
    text: screen(
      title('🔗', `Подписка ${esc(c.email)}`),
      `<code>${esc(url)}</code>\n${hint('Нажмите на ссылку, чтобы скопировать')}`,
      '<b>Как подключиться</b>\n' +
        steps(
          'Установите приложение: <b>Happ</b>, v2RayTun, Hiddify, Streisand или v2rayNG',
          'Добавьте подписку по ссылке или отсканируйте QR-код',
          'Включите VPN — готово!',
        ),
    ),
    keyboard: backKb(),
  };
}

export function unlinkListView(clients: Client[]): View {
  const kb = new InlineKeyboard();
  for (const c of clients) kb.text(`🔓 ${c.email}`, CB.unlinkAsk(c.email)).row();
  kb.text('« Назад', CB.home);
  return { text: screen(title('🔓', 'Отвязка'), 'Какой аккаунт отвязать от Telegram?'), keyboard: kb };
}

export const unlinkConfirmView = (c: Client): View => ({
  text: screen(
    title('🔓', `Отвязать ${esc(c.email)}?`),
    card('VPN продолжит работать как обычно.', 'Но статус и напоминания здесь больше не будут приходить.'),
  ),
  keyboard: new InlineKeyboard().text('✅ Да, отвязать', CB.unlinkConfirm(c.email)).text('Отмена', CB.home),
});

/** Текст плашки по результату привязки. */
export function linkNotice(r: LinkResult): string {
  switch (r.kind) {
    case 'no_secrets':
      return '🤔 Не похоже на ссылку подписки или ключ. Пришлите <code>https://…</code> или <code>vless://…</code>.';
    case 'rate_limited':
      return '⏳ Слишком много попыток. Подождите 10 минут.';
    case 'not_found':
      return '❌ Такой аккаунт не найден. Проверьте ссылку или напишите в поддержку.';
    case 'foreign':
      return '⛔ Этот аккаунт уже привязан к другому Telegram. Напишите в поддержку.';
    case 'already':
      return 'ℹ️ Этот аккаунт уже привязан к вам.';
    case 'linked':
      return `✅ Аккаунт <b>${esc(r.clients.map((c) => c.email).join(', '))}</b> привязан!`;
  }
}
