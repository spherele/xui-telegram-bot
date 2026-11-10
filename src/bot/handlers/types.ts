import type { ChatTypeContext, Composer, Context } from 'grammy';
import type { ShopService } from '../../services/shop.js';
import type { Navigator } from '../navigator.js';
import type { OrderFlow } from '../orders.js';
import type { Panels } from '../panel.js';
import type { Ui } from '../screens/common.js';

export type PrivateComposer = Composer<ChatTypeContext<Context, 'private'>>;

export interface HandlerDeps {
  ui: Ui;
  nav: Navigator;
  panels: Panels;
  orders: OrderFlow;
  shop: ShopService;
}

/** Группа из regex-совпадения callbackQuery/command. */
export const group = (match: string | RegExpMatchArray | undefined, i: number): string =>
  (typeof match === 'string' ? undefined : match?.[i]) ?? '';
