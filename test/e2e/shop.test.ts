// Сквозные сценарии покупки: тариф → чек → решение админа → клиент в панели.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CB } from '../../src/bot/callbacks.js';
import { ADMIN, Harness, USER } from '../helpers/harness.js';

const DAY = 86_400_000;
const photo = (uid: string) => ({
  photo: [
    { file_id: `small-${uid}`, file_unique_id: `s-${uid}` },
    { file_id: `big-${uid}`, file_unique_id: uid },
  ],
});
const toAdmins = (h: Harness) =>
  h.calls.filter((c) => ['sendPhoto', 'sendDocument'].includes(c.method) && c.payload.chat_id === ADMIN).length;

test('новая подписка: тариф → чек → подтверждение → клиент создан и привязан', async () => {
  const h = new Harness();
  await h.msg('/start');
  await h.click(CB.tariffs);
  assert.match(h.lastScreen(), /Тарифы/);
  await h.click(CB.tariff(0)); // подписок нет — сразу реквизиты
  assert.match(h.lastScreen(), /Карта 0000/);

  await h.msg('просто текст');
  assert.match(h.lastScreen(), /скриншот или фото чека/);

  await h.send(photo('r1'));
  const toAdmin = h.last('sendPhoto')!;
  assert.equal(toAdmin.chat_id, ADMIN);
  assert.equal(toAdmin.photo, 'big-r1');
  assert.match(toAdmin.caption!, /Заявка №1/);
  assert.match(h.lastScreen(), /Заявка №1 отправлена/);

  await h.click(CB.orderApprove(1), USER); // не админ
  assert.equal(h.store.getOrder(1)?.status, 'pending');

  await h.click(CB.orderApprove(1), ADMIN);
  const created = h.panel.find('ivan_user')!;
  assert.ok(created, 'клиент создан в панели');
  assert.equal(created.tgId, USER);
  assert.ok(Math.abs(created.expiryTime - (Date.now() + 30 * DAY)) < 5000);
  const add = h.panel.calls.find((c) => c.path === '/panel/api/clients/add')!.body as { inboundIds: number[] };
  assert.deepEqual(add.inboundIds, [1], 'включённые инбаунды без white-list (не оплачен)');
  assert.equal(h.store.getOrder(1)?.status, 'done');
  assert.match(h.last('editMessageCaption')!.caption!, /Подтверждено — @boss/);
  assert.ok(
    h.calls.some(
      (c) =>
        c.method === 'sendMessage' &&
        c.payload.chat_id === USER &&
        (c.payload.text ?? '').includes('Оплата подтверждена'),
    ),
  );

  const writes = h.panel.writes.length;
  await h.click(CB.orderApprove(1), ADMIN); // повторное нажатие ничего не делает
  assert.equal(h.panel.writes.length, writes);
});

test('продление существующей подписки (PDF-чек) и отказ по второй заявке', async () => {
  const h = new Harness();
  const exp = Date.now() + 5 * DAY;
  Object.assign(h.panel.find('ivan')!, { tgId: USER, expiryTime: exp });
  await h.msg('/start');
  await h.click(CB.tariff(0));
  const pay = h.callbackData(/"callback_data":"(pay:t0:[0-9a-f]{12})"/);
  await h.click(pay);
  assert.match(h.lastScreen(), /продление <b>ivan/);
  await h.send({
    document: {
      file_id: 'pdf',
      file_unique_id: 'pdf1',
      mime_type: 'application/pdf',
      file_name: 'чек.pdf',
      file_size: 1000,
    },
  });
  assert.equal(h.last('sendDocument')!.document, 'pdf');
  assert.match(h.last('sendDocument')!.caption!, /чек\.pdf/);
  await h.click(CB.orderApprove(1), ADMIN);
  assert.equal(h.panel.find('ivan')!.expiryTime, exp + 30 * DAY);
  assert.equal(h.panel.find('ivan')!.uuid, '11111111-1111-4111-8111-111111111111', 'ключи не затёрты');

  await h.click(pay);
  await h.send(photo('r2'));
  await h.click(CB.orderReject(2), ADMIN);
  assert.equal(h.store.getOrder(2)?.status, 'rejected');
  assert.equal(h.panel.find('ivan')!.expiryTime, exp + 30 * DAY);
  assert.match(h.last('sendMessage')!.text!, /Оплата не подтверждена/);
});

test('чек: только фото / картинка / PDF, без повторов и без второй заявки', async () => {
  const h = new Harness();
  await h.msg('/start');
  await h.click(CB.tariff(0));

  await h.send({ video: { file_id: 'v', file_unique_id: 'v1' } });
  assert.match(h.lastScreen(), /не похоже на чек/);
  await h.send({ sticker: { file_id: 'st', file_unique_id: 'st1' } });
  assert.match(h.lastScreen(), /не похоже на чек/);
  await h.send({ document: { file_id: 'z', file_unique_id: 'z1', mime_type: 'application/zip', file_size: 10 } });
  assert.match(h.lastScreen(), /не похоже на чек/);
  await h.send({
    document: { file_id: 'big', file_unique_id: 'big1', mime_type: 'image/png', file_size: 50 * 1024 * 1024 },
  });
  assert.match(h.lastScreen(), /слишком большой/);
  assert.equal(toAdmins(h), 0);
  assert.ok(h.store.getPending(USER), 'ожидание оплаты сохраняется');

  await h.send({
    document: { file_id: 'png', file_unique_id: 'png1', mime_type: 'image/png', file_size: 2000 },
    caption: 'перевёл с карты мамы',
  });
  assert.equal(toAdmins(h), 1);
  assert.match(h.last('sendDocument')!.caption!, /перевёл с карты мамы/);

  await h.click(CB.tariff(0)); // пока заявка №1 на проверке — новую не начать
  assert.match(h.lastScreen(), /Заявка №1 ещё на проверке/);
  assert.equal(h.store.getPending(USER), null);

  await h.click(CB.orderReject(1), ADMIN);
  await h.click(CB.tariff(0));
  await h.send({ photo: [{ file_id: 'p', file_unique_id: 'png1' }] }); // чек отклонённой заявки можно прислать снова
  assert.equal(toAdmins(h), 2);
  await h.click(CB.orderApprove(2), ADMIN);
  await h.click(CB.pay({ kind: 'tariff', index: 0 }, null)); // теперь подписка есть — сразу «новая»
  await h.send({ photo: [{ file_id: 'p2', file_unique_id: 'png1' }] }); // уже оплаченный чек — нельзя
  assert.match(h.lastScreen(), /чек уже отправлялся/);
  assert.equal(toAdmins(h), 2);
});

test('магазин выключен без реквизитов', async () => {
  const h = new Harness({ PAYMENT_DETAILS: '' });
  await h.msg('/start');
  assert.ok(!h.buttons().includes(`"${CB.tariffs}"`));
  await h.click(CB.tariff(0));
  assert.match(h.lastScreen(), /покупка недоступна/);
});

test('ошибка активации возвращает заявку в ожидание', async () => {
  const h = new Harness();
  Object.assign(h.panel.find('ivan')!, { tgId: USER, expiryTime: Date.now() + DAY });
  await h.msg('/start');
  await h.click(CB.tariff(0));
  await h.click(h.callbackData(/"callback_data":"(pay:t0:[0-9a-f]{12})"/));
  await h.send(photo('r9'));
  h.panel.rows = h.panel.rows.filter((r) => r.email !== 'ivan'); // клиента удалили в панели
  await h.click(CB.orderApprove(1), ADMIN);
  assert.equal(h.store.getOrder(1)?.status, 'pending');
  assert.match(h.last('sendMessage')!.text!, /не удалось активировать/);
});

test('свой срок + white-list: сумма, заявка и новый клиент с white-list', async () => {
  const h = new Harness();
  await h.msg('/start');
  await h.click(CB.tariffs);
  assert.match(h.lastScreen(), /Свой срок/);
  assert.match(h.lastScreen(), /White-list<\/b> — \+100 ₽ в месяц/);

  await h.click(CB.customTerm(1));
  await h.click(CB.customTerm(2));
  await h.click(CB.customTerm(3));
  assert.match(h.lastScreen(), /Срок: <b>3 мес\.<\/b> \(90 дн\.\)/);
  assert.match(h.lastScreen(), /Цена: <b>450 ₽<\/b>/, '3 × 150 ₽ (цена 30-дневного тарифа)');
  assert.ok(h.buttons().includes(CB.plan({ kind: 'custom', months: 3 })));

  await h.click(CB.plan({ kind: 'custom', months: 3 }));
  assert.match(h.lastScreen(), /К оплате: <b>450 ₽<\/b>/);
  assert.ok(h.buttons().includes('Добавить White-list +300 ₽'));

  await h.click(CB.toggleWhitelist);
  assert.match(h.lastScreen(), /К оплате: <b>750 ₽<\/b>/, '450 + 3 × 100');
  assert.ok(h.buttons().includes('✅ White-list +300 ₽'));

  await h.send(photo('c1'));
  const caption = h.last('sendPhoto')!.caption!;
  assert.match(caption, /3 мес\. · 90 дн\./);
  assert.match(caption, /White-list: да/);
  assert.match(caption, /К оплате: <b>750 ₽<\/b>/);

  await h.click(CB.orderApprove(1), ADMIN);
  const add = h.panel.calls.find((c) => c.path === '/panel/api/clients/add')!.body as { inboundIds: number[] };
  assert.deepEqual(add.inboundIds, [1, 3], 'white-list оплачен — подключён');
  assert.ok(Math.abs(h.panel.find('ivan_user')!.expiryTime - (Date.now() + 90 * DAY)) < 5000);
  assert.equal(h.store.getOrder(1)?.amount, 750);
});

test('продление: white-list по умолчанию как сейчас; снят — отключается, добавлен — подключается', async () => {
  const h = new Harness();
  const ivan = h.panel.find('ivan')!;
  Object.assign(ivan, { tgId: USER, expiryTime: Date.now() + DAY });
  assert.deepEqual(h.panel.clientInbounds('ivan'), [1, 2, 3], 'white-list (3) сейчас подключён');

  await h.msg('/start');
  await h.click(CB.tariff(0));
  await h.click(h.callbackData(/"callback_data":"(pay:t0:[0-9a-f]{12})"/));
  assert.match(h.lastScreen(), /White-list: <b>да<\/b>/, 'по умолчанию включён — как сейчас');
  assert.match(h.lastScreen(), /К оплате: <b>250 ₽<\/b>/);

  await h.click(CB.toggleWhitelist); // снимаем
  assert.match(h.lastScreen(), /White-list: нет — будет отключён от подписки/);
  assert.match(h.lastScreen(), /К оплате: <b>150 ₽<\/b>/);
  await h.send(photo('w1'));
  await h.click(CB.orderApprove(1), ADMIN);
  assert.deepEqual(h.panel.clientInbounds('ivan'), [1, 2], 'white-list отключён');

  // следующее продление: по умолчанию выключен (его нет), включаем — подключается обратно
  await h.click(CB.tariff(0));
  await h.click(h.callbackData(/"callback_data":"(pay:t0:[0-9a-f]{12})"/));
  assert.match(h.lastScreen(), /White-list: нет/);
  await h.click(CB.toggleWhitelist);
  await h.send(photo('w2'));
  await h.click(CB.orderApprove(2), ADMIN);
  assert.deepEqual(h.panel.clientInbounds('ivan'), [1, 2, 3], 'white-list снова подключён');
  assert.equal(h.panel.find('ivan')!.uuid, '11111111-1111-4111-8111-111111111111', 'ключи не затёрты');
});

test('без WHITELIST_INBOUNDS опции нет, инбаунды не трогаются', async () => {
  const h = new Harness({ WHITELIST_INBOUNDS: '' });
  Object.assign(h.panel.find('ivan')!, { tgId: USER, expiryTime: Date.now() + DAY });
  await h.msg('/start');
  await h.click(CB.tariffs);
  assert.doesNotMatch(h.lastScreen(), /White-list/);
  await h.click(CB.tariff(0));
  await h.click(h.callbackData(/"callback_data":"(pay:t0:[0-9a-f]{12})"/));
  assert.ok(!h.buttons().includes(CB.toggleWhitelist));
  await h.send(photo('n1'));
  await h.click(CB.orderApprove(1), ADMIN);
  assert.deepEqual(h.panel.clientInbounds('ivan'), [1, 2, 3]);
  assert.ok(!h.panel.calls.some((c) => /attach|detach/.test(c.path)));
});
