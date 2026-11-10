// Composition root: собирает все слои. Здесь — единственное место, где создаются зависимости.
import { join } from 'node:path';
import { type AppBot, createBot } from './bot/bot.js';
import type { Config } from './config.js';
import { StateStore } from './infra/store.js';
import { XuiApi } from './infra/xui/api.js';
import { type FetchFn, XuiHttp } from './infra/xui/http.js';
import { AccountService } from './services/accounts.js';
import { ClientRepository } from './services/clients.js';
import { NotificationService } from './services/notifier.js';
import { ShopService } from './services/shop.js';
import { StatusService } from './services/status.js';

export interface App extends AppBot {
  config: Config;
  store: StateStore;
  api: XuiApi;
  http: XuiHttp;
  clients: ClientRepository;
  accounts: AccountService;
  shop: ShopService;
  status: StatusService;
  notifier: NotificationService;
}

export interface AppOptions {
  /** Подмена HTTP к панели (тесты). */
  fetch?: FetchFn;
  /** Готовое хранилище (тесты); по умолчанию — data/state.json. */
  store?: StateStore;
}

export function createApp(config: Config, opts: AppOptions = {}): App {
  const store = opts.store ?? new StateStore(join(config.dataDir, 'state.json'));
  const http = new XuiHttp({
    baseUrl: config.panel.url,
    apiToken: config.panel.apiToken,
    username: config.panel.username,
    password: config.panel.password,
    twoFactor: config.panel.twoFactor,
    verifySsl: config.panel.verifySsl,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  const api = new XuiApi(http);
  const clients = new ClientRepository(api);
  const accounts = new AccountService(clients);
  const shop = new ShopService(config.shop, config.adminIds.size, store, clients);
  const status = new StatusService(api);
  const appBot = createBot({ config, store, accounts, shop, status });
  const notifier = new NotificationService(
    clients,
    store,
    { days: config.notify.days, trafficPercent: config.notify.trafficPercent },
    appBot.sendAlerts,
  );
  return { ...appBot, config, store, api, http, clients, accounts, shop, status, notifier };
}

/** Недостающее (адрес подписки, название, поддержка) берём из настроек подписки в панели. */
export async function fillFromPanel(app: App): Promise<void> {
  const s = await app.api.settings().catch(() => null);
  app.config.subUrl ??= s?.subUri?.replace(/\/+$/, '') ?? null;
  app.config.title ??= s?.title ?? null;
  app.config.supportUrl ??= s?.supportUrl ?? null;
}
