import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseNodeNames, parseTariffs } from '../../src/config.js';
import { alertsFor, clientState, DAY_MS, extendedExpiry } from '../../src/domain/rules.js';
import type { Client, Tariff } from '../../src/domain/types.js';
import { normalizeTgUrl } from '../../src/bot/ui/format.js';

const client = (o: Partial<Client> = {}): Client => ({
  email: 'e',
  uuid: null,
  password: null,
  auth: null,
  subId: '',
  tgId: 1,
  enable: true,
  expiryTime: 0,
  totalBytes: 0,
  up: 0,
  down: 0,
  lastOnline: 0,
  inboundIds: [],
  inbounds: [],
  ...o,
});
const month: Tariff = { name: 'm', days: 30, price: '1', gb: 0 };
const now = 1_800_000_000_000;

test('состояние клиента', () => {
  assert.equal(clientState(client(), now), 'active');
  assert.equal(clientState(client({ enable: false }), now), 'disabled');
  assert.equal(clientState(client({ expiryTime: now - 1 }), now), 'expired');
  assert.equal(clientState(client({ totalBytes: 10, up: 10 }), now), 'depleted');
});

test('продление: от текущего срока, от сегодня для истёкшей, бессрочная не меняется', () => {
  assert.equal(extendedExpiry(now + 5 * DAY_MS, month, now), now + 35 * DAY_MS);
  assert.equal(extendedExpiry(now - 5 * DAY_MS, month, now), now + 30 * DAY_MS);
  assert.equal(extendedExpiry(-10 * DAY_MS, month, now), -40 * DAY_MS);
  assert.equal(extendedExpiry(0, month, now), 0);
});

test('уведомления', () => {
  const t = { days: 3, trafficPercent: 90 };
  assert.deepEqual(alertsFor(client(), t, now), []);
  assert.equal(alertsFor(client({ expiryTime: now + DAY_MS }), t, now)[0]?.kind, 'expiring');
  assert.equal(alertsFor(client({ expiryTime: now - 1 }), t, now)[0]?.kind, 'expired');
  assert.equal(alertsFor(client({ totalBytes: 100, up: 95 }), t, now)[0]?.kind, 'traffic_low');
  assert.equal(alertsFor(client({ totalBytes: 100, up: 100 }), t, now)[0]?.kind, 'depleted');
});

test('разбор конфига', () => {
  assert.deepEqual(parseTariffs('1 месяц|30|150;Год|365|1400|500'), [
    { name: '1 месяц', days: 30, price: '150', gb: 0 },
    { name: 'Год', days: 365, price: '1400', gb: 500 },
  ]);
  assert.throws(() => parseTariffs('плохой|x|1'), /Неверный тариф/);
  assert.deepEqual(parseNodeNames('germany=🇩🇪 Германия;🇳🇱 Нидерланды'), {
    germany: '🇩🇪 Германия',
    '#1': '🇳🇱 Нидерланды',
  });
  assert.equal(normalizeTgUrl('https://t.me/@callme'), 'https://t.me/callme');
  assert.equal(normalizeTgUrl('@callme'), 'https://t.me/callme');
});
