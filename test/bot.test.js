import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createBot, normalizeTgUrl } from '../src/bot.js';
import { Store } from '../src/store.js';

const UUID = '11111111-1111-4111-8111-111111111111';
const ADMIN = 9;
const USER = 42;

function fakeXui() {
  const clients = [
    { email: 'ivan', uuid: UUID, password: 'p', auth: 'a', subId: 'subivan12345', tgId: 0, enable: true,
      expiryTime: 0, totalBytes: 0, up: 1, down: 2, inbounds: [{ remark: 'RU', enable: true }] },
  ];
  const calls = [];
  return {
    clients,
    calls,
    statusTs: 0,
    byTgId: async (id) => clients.filter((c) => c.tgId === id),
    findBySecrets: async (s) => clients.filter((c) => s.includes(c.uuid) || s.includes(c.subId)),
    setTgId: async (c, id) => { c.tgId = id; },
    listClients: async () => clients,
    findByEmail: async (e) => clients.filter((c) => c.email === e),
    enabledInboundIds: async () => [1, 2],
    addClient: async (c) => {
      calls.push(['add', c]);
      clients.push({ email: c.email, uuid: 'new', subId: 'newsub123456', tgId: c.tgId, enable: true,
        expiryTime: c.expiryTime, totalBytes: c.totalBytes, up: 0, down: 0, inbounds: [] });
    },
    updateClient: async (email, ch) => {
      calls.push(['update', email, ch]);
      Object.assign(clients.find((c) => c.email === email), ch);
    },
    resetTraffic: async (email) => calls.push(['reset', email]),
    serviceStatus: async () => ({
      at: Date.now(),
      onlineUsers: 6,
      servers: [
        { online: true, cpu: 20, mem: 50 },
        { name: 'germany', online: false, cpu: 0, mem: 0 },
      ],
    }),
  };
}

function setup() {
  const config = {
    botToken: '1:x', adminIds: new Set([ADMIN]), tz: 'UTC', subUrl: 'https://s.test/sub',
    title: 'TestVPN', supportUrl: 'https://t.me/@support', serverName: 'Москва',
    shop: { tariffs: [{ name: '1 месяц', days: 30, price: '150', gb: 0 }], currency: '₽',
      paymentDetails: 'Карта 0000', inboundIds: [], limitIp: 0, group: '' },
  };
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'xbot-')), 'state.json'));
  const xui = fakeXui();
  const { bot } = createBot({ config, xui, store });
  bot.botInfo = { id: 1, is_bot: true, first_name: 'b', username: 'b' };
  const calls = [];
  let mid = 1000;
  bot.api.config.use(async (prev, method, payload) => {
    calls.push({ method, payload });
    const result = method.startsWith('send') ? { message_id: ++mid, chat: { id: payload.chat_id }, date: 0 } : true;
    return { ok: true, result };
  });
  let uid = 0;
  const who = (id) => ({ user: { id, is_bot: false, first_name: id === ADMIN ? 'Admin' : 'Ivan', username: id === ADMIN ? 'boss' : 'ivan_user' },
    chat: { id, type: 'private', first_name: 'U' } });
  const send = (extra, id = USER) => {
    const { user, chat } = who(id);
    return bot.handleUpdate({ update_id: ++uid, message: { message_id: ++uid, date: 0, chat, from: user, ...extra } });
  };
  const msg = (text, id = USER) =>
    send({ text, ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] } : {}) }, id);
  const click = (data, id = USER) => {
    const { user, chat } = who(id);
    const p = store.getPanel(id);
    return bot.handleUpdate({ update_id: ++uid, callback_query: { id: String(uid), from: user, chat_instance: 'c', data,
      message: { message_id: p?.id ?? 1, date: 0, chat, text: 'x', ...(p?.kind === 'photo' ? { photo: [{}] } : {}) } } });
  };
  const last = (method) => calls.filter((c) => c.method === method).at(-1)?.payload;
  const buttons = (payload) => JSON.stringify(payload?.reply_markup ?? {});
  return { calls, msg, send, click, xui, store, last, buttons };
}

test('нормализация ссылки поддержки', () => {
  assert.equal(normalizeTgUrl('https://t.me/@callme'), 'https://t.me/callme');
  assert.equal(normalizeTgUrl('@callme'), 'https://t.me/callme');
});

test('новый пользователь видит приветственное меню', async () => {
  const { msg, last, buttons } = setup();
  await msg('/start');
  const p = last('sendMessage');
  assert.match(p.text, /Добро пожаловать в <b>TestVPN<\/b>/);
  const kb = buttons(p);
  for (const data of ['"buy"', '"have"', '"status"']) assert.ok(kb.includes(data), data);
  assert.ok(kb.includes('https://t.me/support'));
});

test('полный сценарий: привязка → подписка → назад → отвязка', async () => {
  const { calls, msg, click, xui, store, last, buttons } = setup();
  const methods = () => calls.map((c) => c.method).filter((m) => m !== 'answerCallbackQuery');

  await msg('/start');
  await click('have');
  assert.match(last('editMessageText').text, /Привязка подписки/);

  calls.length = 0;
  await msg(`vless://${UUID}@h:443#x`);
  assert.deepEqual(methods(), ['deleteMessage', 'editMessageText']);
  assert.match(last('editMessageText').text, /привязан!/);
  assert.equal(xui.clients[0].tgId, USER);

  const subData = /"callback_data":"(sub:\w+)"/.exec(buttons(last('editMessageText')))[1];
  calls.length = 0;
  await click(subData);
  assert.deepEqual(methods(), ['deleteMessage', 'sendPhoto']);
  assert.match(last('sendPhoto').caption, /s\.test\/sub\/subivan12345/);
  assert.equal(store.getPanel(USER).kind, 'photo');

  calls.length = 0;
  await click('home');
  assert.deepEqual(methods(), ['deleteMessage', 'sendMessage']);

  await click(subData.replace('sub:', 'ulc:'));
  assert.equal(xui.clients[0].tgId, 0);
  assert.match(last('editMessageText').text, /отвязан/);
});

test('чужой аккаунт не привязывается, неадмин не может /link', async () => {
  const { msg, xui, last } = setup();
  xui.clients[0].tgId = 777;
  await msg('/start');
  await msg('subivan12345');
  assert.match(last('editMessageText').text, /другому Telegram/);
  await msg('/link ivan 42');
  assert.equal(xui.clients[0].tgId, 777);
});

test('статус сервиса', async () => {
  const { msg, click, last } = setup();
  await msg('/start');
  await click('status');
  const t = last('editMessageText').text;
  assert.match(t, /Часть серверов недоступна/);
  assert.match(t, /Москва<\/b> — работает/);
  assert.match(t, /germany<\/b> — недоступен/);
  assert.match(t, /онлайн: 6/);
});

test('покупка новой подписки: тариф → чек → подтверждение админом', async () => {
  const { msg, send, click, xui, store, last, calls } = setup();
  await msg('/start');
  await click('buy');
  assert.match(last('editMessageText').text, /Тарифы/);
  await click('buy:0'); // у пользователя нет подписок — сразу реквизиты
  assert.match(last('editMessageText').text, /Карта 0000/);
  assert.ok(store.getPending(USER));

  await msg('просто текст');
  assert.match(last('editMessageText').text, /скриншот или фото чека/);

  await send({ photo: [{ file_id: 'small' }, { file_id: 'big' }] });
  const toAdmin = last('sendPhoto');
  assert.equal(toAdmin.chat_id, ADMIN);
  assert.equal(toAdmin.photo, 'big');
  assert.match(toAdmin.caption, /Заявка №1/);
  assert.match(last('editMessageText').text, /Заявка №1 отправлена/);
  assert.equal(store.getPending(USER), null);

  await click('ord:ok:1', USER); // не админ
  assert.equal(store.getOrder(1).status, 'pending');

  await click('ord:ok:1', ADMIN);
  const [, added] = xui.calls.find((c) => c[0] === 'add');
  assert.equal(added.email, 'ivan_user');
  assert.equal(added.tgId, USER);
  assert.deepEqual(added.inboundIds, [1, 2]);
  assert.ok(Math.abs(added.expiryTime - (Date.now() + 30 * 86_400_000)) < 5000);
  assert.equal(store.getOrder(1).status, 'done');
  assert.match(last('editMessageCaption').caption, /Подтверждено — @boss/);
  const userNote = calls.filter((c) => c.method === 'sendMessage' && c.payload.chat_id === USER).at(-1).payload;
  assert.match(userNote.text, /Оплата подтверждена/);

  await click('ord:ok:1', ADMIN); // повторное нажатие ничего не делает
  assert.equal(xui.calls.filter((c) => c[0] === 'add').length, 1);
});

test('продление существующей подписки и отказ', async () => {
  const { msg, send, click, xui, store, last, buttons } = setup();
  const exp = Date.now() + 5 * 86_400_000;
  Object.assign(xui.clients[0], { tgId: USER, expiryTime: exp });
  await msg('/start');
  await click('buy:0');
  const payData = /"callback_data":"(pay:0:[0-9a-f]+)"/.exec(buttons(last('editMessageText')))[1];
  await click(payData);
  assert.match(last('editMessageText').text, /Продление <b>ivan/);
  await send({ document: { file_id: 'pdf' } });
  assert.equal(last('sendDocument').document, 'pdf');
  await click('ord:ok:1', ADMIN);
  const upd = xui.calls.find((c) => c[0] === 'update');
  assert.equal(upd[1], 'ivan');
  assert.equal(upd[2].expiryTime, exp + 30 * 86_400_000);

  // вторая заявка — отказ
  await click('buy:0');
  await click(payData);
  await send({ photo: [{ file_id: 'x' }] });
  await click('ord:no:2', ADMIN);
  assert.equal(store.getOrder(2).status, 'rejected');
  assert.equal(xui.calls.filter((c) => c[0] === 'update').length, 1);
});
