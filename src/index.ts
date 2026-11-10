// Точка входа: конфиг → приложение → запуск.
import { createApp, fillFromPanel } from './app.js';
import { loadConfig } from './config.js';
import { noop } from './lib/async.js';

const config = loadConfig();
const app = createApp(config);
await app.store.load();

// Проверяем доступ к панели сразу, чтобы ошибки конфигурации были видны при старте.
try {
  const clients = await app.clients.list(true);
  console.log(`3x-ui: OK, клиентов в панели: ${clients.length}, привязано: ${clients.filter((c) => c.tgId).length}`);
  await fillFromPanel(app);
} catch (e) {
  console.error('3x-ui недоступна:', (e as Error).message);
}
console.log(
  config.subUrl ? `Подписка: ${config.subUrl}` : 'SUB_URL не задан и не найден в панели — кнопка подписки скрыта',
);
if (!app.shop.enabled) console.log('Магазин выключен: заполните TARIFFS и PAYMENT_DETAILS (и ADMIN_IDS)');

await app.bot.api.setMyCommands([{ command: 'start', description: 'Открыть меню' }]);
const stopNotifier = config.notify.enabled ? app.notifier.start(config.notify.intervalMin) : noop;

const shutdown = async () => {
  stopNotifier();
  await app.bot.stop();
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

await app.bot.start({
  allowed_updates: ['message', 'callback_query'],
  onStart: (me) => {
    console.log(`Бот @${me.username} запущен`);
  },
});
await app.store.flush();
