// Сквозные сценарии пользователя: настоящее приложение + фейковая панель 3x-ui.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CB } from '../../src/bot/callbacks.js';
import { UUID1 } from '../helpers/fake-panel.js';
import { ADMIN, Harness, USER } from '../helpers/harness.js';

test('новый пользователь видит приветственное меню', async () => {
  const h = new Harness();
  await h.msg('/start');
  const text = h.lastScreen();
  assert.match(text, /Добро пожаловать в TestVPN!/);
  assert.match(text, /🌍 Серверы: Москва, 🇩🇪 Германия/);
  const kb = h.buttons();
  for (const data of [CB.tariffs, CB.have, CB.status]) assert.ok(kb.includes(`"${data}"`), data);
  assert.ok(kb.includes('https://t.me/support'), 'ссылка поддержки нормализована');
});

test('привязка по ключу → подписка с QR → назад → отвязка', async () => {
  const h = new Harness();
  const methods = () => h.calls.map((c) => c.method).filter((m) => m !== 'answerCallbackQuery');

  await h.msg('/start');
  await h.click(CB.have);
  assert.match(h.lastScreen(), /Привязка подписки/);

  h.calls.length = 0;
  await h.msg(`vless://${UUID1}@h:443#x`);
  assert.deepEqual(methods(), ['deleteMessage', 'editMessageText']);
  assert.match(h.lastScreen(), /Аккаунт <b>ivan<\/b> привязан!/);
  assert.equal(h.panel.find('ivan')!.tgId, USER);

  const sub = h.callbackData(/"callback_data":"(sub:[0-9a-f]{12})"/);
  h.calls.length = 0;
  await h.click(sub);
  assert.deepEqual(methods(), ['deleteMessage', 'sendPhoto']);
  assert.match(h.lastScreen(), /s\.test\/sub\/subivan12345/);
  assert.equal(h.store.getPanel(USER)?.kind, 'photo');

  h.calls.length = 0;
  await h.click(CB.home);
  assert.deepEqual(methods(), ['deleteMessage', 'sendMessage']);
  assert.match(h.lastScreen(), /<b>👤 ivan<\/b>/);

  await h.click(sub.replace('sub:', 'ulc:'));
  assert.equal(h.panel.find('ivan')!.tgId, 0);
  assert.match(h.lastScreen(), /отвязан/);
});

test('чужой аккаунт не привязывается; неадмин не может /link', async () => {
  const h = new Harness();
  await h.msg('/start');
  await h.msg('subpetr12345'); // petr привязан к 555
  assert.match(h.lastScreen(), /другому Telegram/);
  await h.msg('/link petr 42');
  assert.equal(h.panel.find('petr')!.tgId, 555);
});

test('перебор ключей ограничен', async () => {
  const h = new Harness();
  await h.msg('/start');
  for (let i = 0; i < 5; i++) await h.msg(`nosuchkey${i}abc`);
  assert.match(h.lastScreen(), /не найден/);
  await h.msg(`vless://${UUID1}@h:443`);
  assert.match(h.lastScreen(), /Слишком много попыток/);
  assert.equal(h.panel.find('ivan')!.tgId, 0);
});

test('статус сервиса', async () => {
  const h = new Harness();
  h.panel.nodes[0]!.status = 'offline';
  await h.msg('/start');
  await h.click(CB.status);
  const t = h.lastScreen();
  assert.match(t, /Часть серверов недоступна/);
  assert.match(t, /<b>Москва<\/b>\nРаботает/);
  assert.match(t, /<b>🇩🇪 Германия<\/b>\n🔴 Недоступен/);
  assert.match(t, /онлайн: <b>1<\/b>/);
});

test('админ-команды', async () => {
  const h = new Harness();
  await h.msg('/start', ADMIN);
  await h.msg('/link ivan 777', ADMIN);
  assert.equal(h.panel.find('ivan')!.tgId, 777);
  await h.msg('/find iv', ADMIN);
  assert.match(h.lastScreen(ADMIN), /Найдено: 1/);
  await h.msg('/stats', ADMIN);
  assert.match(h.lastScreen(ADMIN), /Клиентов в панели: <b>2<\/b>/);
  await h.msg('/unlink ivan', ADMIN);
  assert.equal(h.panel.find('ivan')!.tgId, 0);
});

test('уведомления о сроке уходят один раз', async () => {
  const h = new Harness();
  Object.assign(h.panel.find('ivan')!, { tgId: USER, expiryTime: Date.now() + 86_400_000 });
  assert.equal(await h.app.notifier.checkOnce(), 1);
  assert.match(h.last('sendMessage')!.text!, /Подписка скоро закончится/);
  assert.equal(await h.app.notifier.checkOnce(), 0);
});
