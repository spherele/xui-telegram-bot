import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { StateStore } from '../../src/infra/store.js';

test('старый state.json: заявки дополняются новыми полями', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'xbot-')), 'state.json');
  // формат JS-версии: у заявок нет fileUid / fileInfo / comment
  writeFileSync(
    file,
    JSON.stringify({
      panels: { 42: { id: 7, kind: 'text' } },
      notified: ['exp:a:1'],
      pending: {},
      orderSeq: 1,
      orders: {
        1: {
          id: 1,
          uid: 42,
          name: 'I',
          username: null,
          tariff: { name: 'm', days: 30, price: '1', gb: 0 },
          target: null,
          status: 'done',
          createdAt: 1,
          adminMsgs: [{ chat: 9, id: 5 }],
        },
      },
    }),
  );
  const store = new StateStore(file);
  await store.load();
  const o = store.getOrder(1)!;
  assert.equal(o.fileUid, null);
  assert.equal(o.comment, null);
  assert.deepEqual(o.adminMsgs, [{ chat: 9, id: 5 }]);
  assert.deepEqual(store.getPanel(42), { id: 7, kind: 'text' });
  assert.ok(store.getNotified().has('exp:a:1'));
  // нумерация продолжается
  assert.equal(store.createOrder({ ...o, fileUid: 'x' }).id, 2);
});

test('ожидание оплаты: установка и сброс', () => {
  const store = StateStore.inMemory();
  const p = { tariff: { name: 'm', days: 30, price: '1', gb: 0 }, target: null, at: 1 };
  store.setPending(1, p);
  store.setPending(2, p);
  store.setPending(1, null);
  assert.equal(store.getPending(1), null);
  assert.deepEqual(store.getPending(2), p);
});
