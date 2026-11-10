import { join } from 'node:path';
import { createBot } from './bot.js';
import { loadConfig } from './config.js';
import { startNotifier } from './notifier.js';
import { Store } from './store.js';
import { XUIClient } from './xui.js';

const config = loadConfig();

const store = new Store(join(config.dataDir, 'state.json'));
await store.load();

const xui = new XUIClient({
  baseUrl: config.panelUrl,
  username: config.panelUsername,
  password: config.panelPassword,
  twoFactor: config.panel2fa,
  apiToken: config.apiToken,
  verifySsl: config.verifySsl,
});

// Проверяем доступ к панели сразу, чтобы ошибки конфигурации были видны при старте.
try {
  const clients = await xui.listClients(true);
  console.log(`3x-ui: OK, клиентов в панели: ${clients.length}, привязано: ${clients.filter((c) => c.tgId).length}`);
  // Недостающее берём из настроек подписки в панели.
  const ps = await xui.getPanelSettings().catch(() => ({}));
  config.subUrl ??= ps.subUri ?? null;
  config.title ??= ps.title ?? null;
  config.supportUrl ??= ps.supportUrl ?? null;
  console.log(config.subUrl ? `Подписка: ${config.subUrl}` : 'SUB_URL не задан и не найден в панели — кнопка подписки скрыта');
} catch (e) {
  console.error('3x-ui недоступна:', e.message);
}

const { bot } = createBot({ config, xui, store });
await bot.api.setMyCommands([{ command: 'start', description: 'Открыть меню' }]);

const stopNotifier = startNotifier({ api: bot.api, xui, store, config });

const shutdown = async () => {
  stopNotifier();
  await bot.stop();
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

await bot.start({
  allowed_updates: ['message', 'callback_query'],
  onStart: (me) => console.log(`Бот @${me.username} запущен`),
});
await store.flush();
