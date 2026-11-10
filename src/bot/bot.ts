// Сборка Telegram-бота из сервисов.
import { Bot } from 'grammy';
import type { Config } from '../config.js';
import type { Alert } from '../domain/rules.js';
import type { TelegramId } from '../domain/types.js';
import type { StateStore } from '../infra/store.js';
import type { AccountService } from '../services/accounts.js';
import type { ShopService } from '../services/shop.js';
import type { StatusService } from '../services/status.js';
import { registerAdmin } from './handlers/admin.js';
import { registerMenu } from './handlers/menu.js';
import { registerMessages } from './handlers/messages.js';
import { registerNotifications } from './handlers/notifications.js';
import type { HandlerDeps } from './handlers/types.js';
import { Navigator } from './navigator.js';
import { OrderFlow } from './orders.js';
import { Panels } from './panel.js';
import { alertsText, notifyKeyboard } from './screens/alerts.js';
import type { Ui } from './screens/common.js';

export interface BotServices {
  config: Config;
  store: StateStore;
  accounts: AccountService;
  shop: ShopService;
  status: StatusService;
}

export interface AppBot {
  bot: Bot;
  /** Доставка уведомлений — для NotificationService. */
  sendAlerts: (tgId: TelegramId, alerts: Alert[]) => Promise<void>;
}

export function createBot(s: BotServices): AppBot {
  const bot = new Bot(s.config.botToken);
  const ui: Ui = { config: s.config, shop: s.shop };
  const panels = new Panels(bot.api, s.store);
  const nav = new Navigator(ui, s.accounts, s.status);
  const orders = new OrderFlow(bot.api, ui, s.shop, nav, panels);
  const deps: HandlerDeps = { ui, nav, panels, orders, shop: s.shop };

  const pm = bot.chatType('private');
  // порядок важен: команды → кнопки отдельных сообщений → кнопки панели → прочие сообщения
  registerMenu(pm, deps);
  registerAdmin(pm, deps);
  registerNotifications(pm, deps);
  registerMessages(pm, deps);

  bot.catch((err) => {
    console.error('Ошибка обработки апдейта:', err.error ?? err);
  });

  const sendAlerts = async (tgId: TelegramId, alerts: Alert[]) => {
    await bot.api.sendMessage(tgId, alertsText(alerts, s.config.tz), {
      parse_mode: 'HTML',
      reply_markup: notifyKeyboard(),
    });
  };

  return { bot, sendAlerts };
}
