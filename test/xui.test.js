import assert from 'node:assert/strict';
import { test } from 'node:test';
import { XUIClient } from '../src/xui.js';
import { conditions } from '../src/notifier.js';
import { DAY_MS } from '../src/format.js';

const UUID1 = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';

/** Фейковая панель 3x-ui 3.x: CSRF + логин, clients/list|get|update, inbounds/list/slim. */
function fakePanel({ token = null } = {}) {
  const row = (id, email, uuid, sub, extra = {}) => ({
    id, email, uuid, subId: sub, password: `pw-${email}`, auth: `au-${email}`, flow: '', security: 'auto',
    limitIp: 0, limitHwid: 0, totalGB: 0, expiryTime: 0, enable: true, tgId: 0, group: 'g', comment: 'c',
    reset: 0, allowedIPs: '', createdAt: 1, updatedAt: 2, reverse: null, ...extra,
  });
  const state = {
    sessions: new Set(),
    csrf: new Map(), // session cookie -> token
    logins: 0,
    updates: [],
    rows: [row(1, 'ivan', UUID1, 'subivan12345'), row(2, 'petr', UUID2, 'subpetr12345', { tgId: 555 })],
  };
  const json = (obj, headers = {}) =>
    new Response(JSON.stringify(obj), { headers: { 'content-type': 'application/json', ...headers } });
  const nginx404 = () => new Response('<html>404 Not Found</html>', { status: 404 });
  const view = (r) => ({ ...r, inboundIds: [1, 2], traffic: { up: 100, down: 200, enable: true } });

  const fetch = async (url, init) => {
    const path = new URL(url).pathname.replace(/^\/secret/, '');
    const h = init.headers;
    const sid = /3x-ui=(\w+)/.exec(h.Cookie ?? '')?.[1];
    const bearer = token && h.Authorization === `Bearer ${token}`;

    if (path === '/csrf-token') {
      const s = sid ?? `anon${Math.random().toString(36).slice(2, 8)}`;
      const t = `tok-${s}-${Math.random().toString(36).slice(2, 6)}`;
      state.csrf.set(s, t);
      return json({ success: true, obj: t }, sid ? {} : { 'set-cookie': `3x-ui=${s}; Path=/; HttpOnly` });
    }
    // Без CSRF небезопасные запросы режутся (как в реальной панели за nginx — 404).
    if (init.method === 'POST' && !bearer && state.csrf.get(sid) !== h['X-CSRF-Token']) return nginx404();

    if (path === '/login') {
      const b = JSON.parse(init.body);
      if (b.username !== 'admin' || b.password !== 'pw') return json({ success: false, msg: 'bad' });
      const s = `s${++state.logins}`; // сессия ротируется
      state.sessions.add(s);
      return json({ success: true }, { 'set-cookie': `3x-ui=${s}; Path=/; HttpOnly` });
    }
    if (!bearer && !state.sessions.has(sid)) return nginx404();

    if (path === '/panel/api/clients/list') return json({ success: true, obj: state.rows.map(view) });
    if (path === '/panel/api/inbounds/list/slim')
      return json({ success: true, obj: [{ id: 1, remark: 'RU', enable: true }, { id: 2, remark: 'DE', enable: false }] });
    let m = /^\/panel\/api\/clients\/get\/(.+)$/.exec(path);
    if (m) {
      const r = state.rows.find((x) => x.email === decodeURIComponent(m[1]));
      return json(r ? { success: true, obj: { client: r, inboundIds: [1, 2], externalLinks: [] } } : { success: false, msg: 'not found' });
    }
    m = /^\/panel\/api\/clients\/update\/(.+)$/.exec(path);
    if (m && init.method === 'POST') {
      const email = decodeURIComponent(m[1]);
      const body = JSON.parse(init.body);
      if (typeof body.allowedIPs === 'string')
        return json({ success: false, msg: 'json: cannot unmarshal string into Go struct field .allowedIPs of type []string' });
      state.updates.push({ email, body });
      const i = state.rows.findIndex((x) => x.email === email);
      // замена записи целиком (как в 3x-ui): id в теле — это uuid
      const { id: uuid, ...rest } = body;
      state.rows[i] = { ...rest, id: state.rows[i].id, uuid, createdAt: state.rows[i].createdAt };
      return json({ success: true, msg: 'Client updated' });
    }
    return nginx404();
  };
  return { state, fetch };
}

const mk = (panel, extra = {}) =>
  new XUIClient({ baseUrl: 'https://panel.test/secret/', username: 'admin', password: 'pw', fetch: panel.fetch, ...extra });

test('логин с CSRF и разбор клиентов', async () => {
  const panel = fakePanel();
  const xui = mk(panel);
  const all = await xui.listClients();
  assert.equal(all.length, 2);
  const ivan = all.find((c) => c.email === 'ivan');
  assert.equal(ivan.up + ivan.down, 300);
  assert.deepEqual(ivan.inbounds.map((i) => i.remark), ['RU', 'DE']);
  assert.equal(all.find((c) => c.email === 'petr').tgId, 555);
  assert.equal(panel.state.logins, 1);
});

test('неверный пароль — понятная ошибка', async () => {
  const xui = mk(fakePanel(), { password: 'nope' });
  await assert.rejects(xui.listClients(), /Логин не удался/);
});

test('повторный логин при протухшей сессии', async () => {
  const panel = fakePanel();
  const xui = mk(panel);
  await xui.listClients(true);
  panel.state.sessions.clear();
  await xui.listClients(true);
  assert.equal(panel.state.logins, 2);
});

test('API-токен: без логина и CSRF', async () => {
  const panel = fakePanel({ token: 'T0K' });
  const xui = mk(panel, { apiToken: 'T0K', username: '', password: '' });
  const [ivan] = await xui.findBySecrets([UUID1]);
  await xui.setTgId(ivan, 42);
  assert.equal(panel.state.logins, 0);
  assert.equal(panel.state.rows[0].tgId, 42);
});

test('поиск по uuid / subId / паролю', async () => {
  const xui = mk(fakePanel());
  assert.deepEqual((await xui.findBySecrets([UUID1])).map((c) => c.email), ['ivan']);
  assert.deepEqual((await xui.findBySecrets(['subpetr12345'])).map((c) => c.email), ['petr']);
  assert.deepEqual((await xui.findBySecrets(['pw-ivan'])).map((c) => c.email), ['ivan']);
  assert.equal((await xui.findBySecrets(['nope'])).length, 0);
});

test('setTgId отправляет полную запись (id = uuid) и не теряет поля', async () => {
  const panel = fakePanel();
  const xui = mk(panel);
  const before = structuredClone(panel.state.rows[0]);
  const [ivan] = await xui.findBySecrets([UUID1]);
  await xui.setTgId(ivan, 777);
  const { body } = panel.state.updates[0];
  assert.equal(body.id, UUID1);
  assert.equal(body.tgId, 777);
  for (const k of ['createdAt', 'updatedAt', 'inboundIds', 'traffic', 'reverse']) assert.ok(!(k in body), k);
  const after = panel.state.rows[0];
  for (const k of ['uuid', 'subId', 'password', 'auth', 'group', 'comment', 'totalGB', 'expiryTime', 'enable'])
    assert.deepEqual(after[k], before[k], k);
  assert.equal((await xui.byTgId(777, true)).length, 1);
});

test('условия уведомлений', () => {
  const now = Date.now();
  const cfg = { days: 3, trafficPercent: 90 };
  const base = { email: 'e', up: 0, down: 0, totalBytes: 0, expiryTime: 0 };
  assert.equal(conditions(base, cfg, 'UTC', now).length, 0);
  assert.match(conditions({ ...base, expiryTime: now + DAY_MS }, cfg, 'UTC', now)[0][0], /^exp:/);
  assert.match(conditions({ ...base, expiryTime: now - 1 }, cfg, 'UTC', now)[0][0], /^exp0:/);
  assert.match(conditions({ ...base, totalBytes: 100, up: 95 }, cfg, 'UTC', now)[0][0], /^trf:/);
  assert.match(conditions({ ...base, totalBytes: 100, up: 100 }, cfg, 'UTC', now)[0][0], /^trf0:/);
});
