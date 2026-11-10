// «Одно сообщение»: у каждого пользователя есть ровно одно сообщение-панель,
// которое бот редактирует. Сообщения пользователя удаляются сразу после обработки.
//
// view = { text: string, keyboard?: InlineKeyboard, photo?: Buffer }
// Текстовое сообщение нельзя превратить в фото редактированием (и наоборот),
// поэтому при смене типа панель пересоздаётся — визуально это всё равно одно сообщение.
import { InputFile } from 'grammy';

const MAX_TEXT = 4000;
const MAX_CAPTION = 1000;

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const notModified = (e) => /message is not modified/i.test(e?.description ?? e?.message ?? '');

export class Panels {
  constructor(api, store) {
    this.api = api;
    this.store = store;
    this.locks = new Map();
  }

  /** Последовательно выполняет действия одного пользователя (защита от двойных кликов). */
  withLock(uid, fn) {
    const prev = this.locks.get(uid) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    const tail = next.catch(() => {});
    this.locks.set(uid, tail);
    tail.then(() => this.locks.get(uid) === tail && this.locks.delete(uid));
    return next;
  }

  /** Сделать указанное сообщение текущей панелью (например, после перезапуска без state). */
  async adopt(uid, message) {
    const cur = this.store.getPanel(uid);
    if (cur?.id === message.message_id) return;
    if (cur) await this.api.deleteMessage(uid, cur.id).catch(() => {});
    this.store.setPanel(uid, { id: message.message_id, kind: message.photo ? 'photo' : 'text' });
  }

  async render(uid, view, { forceNew = false } = {}) {
    const kind = view.photo ? 'photo' : 'text';
    const markup = view.keyboard ? { reply_markup: view.keyboard } : {};
    const cur = this.store.getPanel(uid);

    if (cur && !forceNew && cur.kind === kind) {
      try {
        if (kind === 'text') {
          await this.api.editMessageText(uid, cur.id, clip(view.text, MAX_TEXT), {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
            ...markup,
          });
        } else {
          await this.api.editMessageMedia(
            uid,
            cur.id,
            {
              type: 'photo',
              media: new InputFile(view.photo, 'qr.png'),
              caption: clip(view.text, MAX_CAPTION),
              parse_mode: 'HTML',
            },
            markup,
          );
        }
        return;
      } catch (e) {
        if (notModified(e)) return;
        // сообщение удалено/слишком старое — отправим новое
      }
    }

    if (cur) await this.api.deleteMessage(uid, cur.id).catch(() => {});
    const msg =
      kind === 'text'
        ? await this.api.sendMessage(uid, clip(view.text, MAX_TEXT), {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
            ...markup,
          })
        : await this.api.sendPhoto(uid, new InputFile(view.photo, 'qr.png'), {
            caption: clip(view.text, MAX_CAPTION),
            parse_mode: 'HTML',
            ...markup,
          });
    this.store.setPanel(uid, { id: msg.message_id, kind });
  }
}
