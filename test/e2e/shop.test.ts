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
  assert.deepEqual(add.inboundIds, [1, 3], 'только включённые инбаунды');
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
  const pay = h.callbackData(/"callback_data":"(pay:0:[0-9a-f]{12})"/);
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
  await h.click(CB.pay(0, null)); // теперь подписка есть — сразу «новая»
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
  await h.click(h.callbackData(/"callback_data":"(pay:0:[0-9a-f]{12})"/));
  await h.send(photo('r9'));
  h.panel.rows = h.panel.rows.filter((r) => r.email !== 'ivan'); // клиента удалили в панели
  await h.click(CB.orderApprove(1), ADMIN);
  assert.equal(h.store.getOrder(1)?.status, 'pending');
  assert.match(h.last('sendMessage')!.text!, /не удалось активировать/);
});
