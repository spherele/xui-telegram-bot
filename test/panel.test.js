import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Panels } from '../src/panel.js';

function fakeApi() {
  let nextId = 100;
  const calls = [];
  const api = {
    calls,
    deleted: new Set(),
    async sendMessage(chat, text) {
      calls.push(['sendMessage', text]);
      return { message_id: ++nextId };
    },
    async sendPhoto(chat, photo, opts) {
      calls.push(['sendPhoto', opts.caption]);
      return { message_id: ++nextId };
    },
    async editMessageText(chat, id, text) {
      if (api.deleted.has(id)) throw Object.assign(new Error('x'), { description: 'Bad Request: message to edit not found' });
      calls.push(['editMessageText', id, text]);
    },
    async editMessageMedia(chat, id) {
      calls.push(['editMessageMedia', id]);
    },
    async deleteMessage(chat, id) {
      calls.push(['deleteMessage', id]);
      api.deleted.add(id);
    },
  };
  return api;
}

const memStore = () => {
  const panels = {};
  return { getPanel: (u) => panels[u] ?? null, setPanel: (u, p) => (panels[u] = p) };
};

test('панель редактируется, а при смене текст↔фото пересоздаётся', async () => {
  const api = fakeApi();
  const store = memStore();
  const p = new Panels(api, store);
  await p.render(1, { text: 'a' });
  await p.render(1, { text: 'b' });
  await p.render(1, { text: 'qr', photo: Buffer.from('x') });
  await p.render(1, { text: 'back' });
  assert.deepEqual(
    api.calls.map((c) => c[0]),
    ['sendMessage', 'editMessageText', 'deleteMessage', 'sendPhoto', 'deleteMessage', 'sendMessage'],
  );
  assert.equal(store.getPanel(1).kind, 'text');
});

test('если панель удалили — отправляется новая', async () => {
  const api = fakeApi();
  const store = memStore();
  const p = new Panels(api, store);
  await p.render(1, { text: 'a' });
  api.deleted.add(store.getPanel(1).id);
  await p.render(1, { text: 'b' });
  assert.equal(api.calls.at(-1)[0], 'sendMessage');
});

test('withLock выполняет действия пользователя по очереди', async () => {
  const p = new Panels(fakeApi(), memStore());
  const order = [];
  const slow = p.withLock(1, async () => {
    await new Promise((r) => setTimeout(r, 30));
    order.push('first');
  });
  const fast = p.withLock(1, async () => order.push('second'));
  await Promise.all([slow, fast]);
  assert.deepEqual(order, ['first', 'second']);
});
