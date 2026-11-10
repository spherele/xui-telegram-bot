import { InlineKeyboard } from 'grammy';
import type { Config } from '../../config.js';
import type { ShopService } from '../../services/shop.js';
import { CB } from '../callbacks.js';
import type { View } from '../panel.js';
import { normalizeTgUrl, screen, title, withNotice } from '../ui/format.js';

/** Всё, что нужно экранам для отрисовки (только чтение). */
export interface Ui {
  config: Config;
  shop: ShopService;
}

export const backKb = (to: string = CB.home): InlineKeyboard => new InlineKeyboard().text('« Назад', to);

export function withSupport(ui: Ui, kb: InlineKeyboard): InlineKeyboard {
  const url = normalizeTgUrl(ui.config.supportUrl);
  return url ? kb.url('💬 Поддержка', url) : kb;
}

export const errorView = (notice?: string): View => ({
  text: withNotice(
    notice,
    screen(title('⚠️', 'Сервис временно недоступен'), 'Не удалось получить данные. Попробуйте через минуту.'),
  ),
  keyboard: new InlineKeyboard().text('🔄 Повторить', CB.refresh),
});
