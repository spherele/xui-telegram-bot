import assert from 'node:assert/strict';
import { test } from 'node:test';
import { XuiApi } from '../../src/infra/xui/api.js';
import { XuiHttp } from '../../src/infra/xui/http.js';
import { ClientRepository } from '../../src/services/clients.js';
import { FakePanel, UUID1 } from '../helpers/fake-panel.js';

function setup(opts: { token?: string; password?: string } = {}) {
  const panel = new FakePanel(opts.token ? { token: opts.token } : {});
  const http = new XuiHttp({
    baseUrl: 'https://panel.test/secret/',
    username: 'admin',
    password: opts.password ?? 'pw',
    apiToken: opts.token ?? null,
    fetch: panel.fetch,
  });
  const repo = new ClientRepository(new XuiApi(http));
  return { panel, http, repo };
}

test('логин с CSRF и разбор клиентов', async () => {
  const { panel, repo } = setup();
  const all = await repo.list();
  assert.equal(all.length, 2);
  const ivan = all.find((c) => c.email === 'ivan')!;
  assert.equal(ivan.up + ivan.down, 300);
  assert.deepEqual(
    ivan.inbounds.map((i) => i.remark),
    ['RU', 'DE', 'NL'],
  );
  assert.equal(all.find((c) => c.email === 'petr')!.tgId, 555);
  assert.equal(panel.logins, 1);
});

test('неверный пароль — понятная ошибка', async () => {
  await assert.rejects(setup({ password: 'nope' }).repo.list(), /Логин не удался/);
});

test('повторный логин при протухшей сессии', async () => {
  const { panel, repo } = setup();
  await repo.list(true);
  panel.sessions.clear();
  await repo.list(true);
  assert.equal(panel.logins, 2);
});

test('API-токен: без логина и CSRF', async () => {
  const { panel, repo } = setup({ token: 'T0K' });
  await repo.setTgId('ivan', 42);
  assert.equal(panel.logins, 0);
  assert.equal(panel.find('ivan')!.tgId, 42);
});

test('поиск по uuid / subId / паролю', async () => {
  const { repo } = setup();
  assert.deepEqual(
    (await repo.bySecrets([UUID1])).map((c) => c.email),
    ['ivan'],
  );
  assert.deepEqual(
    (await repo.bySecrets(['subpetr12345'])).map((c) => c.email),
    ['petr'],
  );
  assert.deepEqual(
    (await repo.bySecrets(['pw-ivan'])).map((c) => c.email),
    ['ivan'],
  );
  assert.equal((await repo.bySecrets(['nope'])).length, 0);
});

test('update отправляет полную запись (id = uuid) и не теряет поля', async () => {
  const { panel, repo } = setup();
  const before = structuredClone(panel.find('ivan')!);
  await repo.setTgId('ivan', 777);
  const body = panel.calls.find((c) => c.path === '/panel/api/clients/update/ivan')!.body as Record<string, unknown>;
  assert.equal(body.id, UUID1);
  assert.equal(body.tgId, 777);
  for (const k of ['createdAt', 'updatedAt', 'inboundIds', 'traffic', 'reverse', 'allowedIPs'])
    assert.ok(!(k in body), k);
  const after = panel.find('ivan')!;
  for (const k of ['uuid', 'subId', 'password', 'auth', 'group', 'comment', 'totalGB', 'expiryTime', 'enable'])
    assert.deepEqual(after[k], before[k], k);
});

test('создание клиента и уникальный email', async () => {
  const { panel, repo } = setup();
  assert.equal(await repo.uniqueEmail('ivan'), 'ivan-2');
  assert.deepEqual(await repo.enabledInboundIds(), [1, 3]);
  await repo.create({ email: 'new', tgId: 5, expiryTime: 1, totalBytes: 0, inboundIds: [1, 3] });
  const created = panel.find('new')!;
  assert.match(created.uuid, /^[0-9a-f-]{36}$/);
  assert.equal(created.subId.length, 16);
  assert.equal(created.tgId, 5);
});
