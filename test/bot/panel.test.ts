import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Panels, type PanelApi } from '../../src/bot/panel.js';
import { StateStore } from '../../src/infra/store.js';

function fakeApi() {
  let nextId = 100;
  const calls: string[] = [];
  const deleted = new Set<number>();
  const api = {
    calls,
    deleted,
    sendMessage: async () => (calls.push('sendMessage'), { message_id: ++nextId }),
    sendPhoto: async () => (calls.push('sendPhoto'), { message_id: ++nextId }),
    editMessageText: async (_c: number, id: number) => {
      if (deleted.has(id))
        throw Object.assign(new Error('x'), { description: 'Bad Request: message to edit not found' });
      calls.push('editMessageText');
      return true;
    },
    editMessageMedia: async () => (calls.push('editMessageMedia'), true),
    deleteMessage: async (_c: number, id: number) => (calls.push('deleteMessage'), deleted.add(id), true),
  };
  return api as typeof api & PanelApi;
}

test('панель редактируется, а при смене текст↔фото пересоздаётся', async () => {
  const api = fakeApi();
  const store = StateStore.inMemory();
  const p = new Panels(api, store);
  await p.render(1, { text: 'a' });
  await p.render(1, { text: 'b' });
  await p.render(1, { text: 'qr', photo: Buffer.from('x') });
  await p.render(1, { text: 'back' });
  assert.deepEqual(api.calls, [
    'sendMessage',
    'editMessageText',
    'deleteMessage',
    'sendPhoto',
    'deleteMessage',
    'sendMessage',
  ]);
  assert.equal(store.getPanel(1)?.kind, 'text');
});

test('если панель удалили — отправляется новая', async () => {
  const api = fakeApi();
  const store = StateStore.inMemory();
  const p = new Panels(api, store);
  await p.render(1, { text: 'a' });
  api.deleted.add(store.getPanel(1)!.id);
  await p.render(1, { text: 'b' });
  assert.equal(api.calls.at(-1), 'sendMessage');
});

test('withLock выполняет действия пользователя по очереди', async () => {
  const p = new Panels(fakeApi(), StateStore.inMemory());
  const order: string[] = [];
  const slow = p.withLock(1, async () => {
    await new Promise((r) => setTimeout(r, 30));
    order.push('first');
  });
  const fast = p.withLock(1, async () => void order.push('second'));
  await Promise.all([slow, fast]);
  assert.deepEqual(order, ['first', 'second']);
});
