// «Одно сообщение»: у каждого пользователя ровно одно сообщение-панель, которое бот редактирует.
// Текстовое сообщение нельзя превратить в фото редактированием (и наоборот),
// поэтому при смене типа панель пересоздаётся — визуально это всё равно одно сообщение.
import { type Api, GrammyError, InputFile, type InlineKeyboard } from 'grammy';
import type { TelegramId } from '../domain/types.js';
import type { PanelRef, StateStore } from '../infra/store.js';
import { ignoreError } from '../lib/async.js';

export interface View {
  text: string;
  keyboard?: InlineKeyboard;
  /** PNG — панель становится фото с подписью. */
  photo?: Buffer;
}

export interface RenderOptions {
  /** Отправить новое сообщение внизу чата (например, на /start). */
  forceNew?: boolean;
}

/** Часть Api, которой пользуется панель, — удобно подменять в тестах. */
export type PanelApi = Pick<
  Api,
  'sendMessage' | 'sendPhoto' | 'editMessageText' | 'editMessageMedia' | 'deleteMessage'
>;

interface MessageLike {
  message_id: number;
  photo?: unknown;
}

const MAX_TEXT = 4000;
const MAX_CAPTION = 1000;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const notModified = (e: unknown): boolean => e instanceof GrammyError && /message is not modified/i.test(e.description);

export class Panels {
  private readonly locks = new Map<TelegramId, Promise<unknown>>();

  constructor(
    private readonly api: PanelApi,
    private readonly store: StateStore,
  ) {}

  /** Действия одного пользователя выполняются по очереди (защита от двойных кликов). */
  withLock<T>(uid: TelegramId, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(uid) ?? Promise.resolve();
    const next = prev.catch(ignoreError).then(fn);
    const tail = next.catch(ignoreError);
    this.locks.set(uid, tail);
    void tail.then(() => {
      if (this.locks.get(uid) === tail) this.locks.delete(uid);
    });
    return next;
  }

  /** Строит экран и показывает его — под блокировкой пользователя. */
  show(uid: TelegramId, build: () => Promise<View> | View, opts: RenderOptions = {}): Promise<void> {
    return this.withLock(uid, async () => this.render(uid, await build(), opts));
  }

  /** Сделать сообщение текущей панелью (например, после перезапуска без state). */
  async adopt(uid: TelegramId, message: MessageLike): Promise<void> {
    const cur = this.store.getPanel(uid);
    if (cur?.id === message.message_id) return;
    if (cur) await this.api.deleteMessage(uid, cur.id).catch(ignoreError);
    this.store.setPanel(uid, { id: message.message_id, kind: message.photo ? 'photo' : 'text' });
  }

  hasPanel(uid: TelegramId): boolean {
    return !!this.store.getPanel(uid);
  }

  async render(uid: TelegramId, view: View, { forceNew = false }: RenderOptions = {}): Promise<void> {
    const kind: PanelRef['kind'] = view.photo ? 'photo' : 'text';
    const markup = view.keyboard ? { reply_markup: view.keyboard } : {};
    const cur = this.store.getPanel(uid);

    if (cur && !forceNew && cur.kind === kind) {
      try {
        if (view.photo) {
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
        } else {
          await this.api.editMessageText(uid, cur.id, clip(view.text, MAX_TEXT), {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
            ...markup,
          });
        }
        return;
      } catch (e) {
        if (notModified(e)) return;
        // сообщение удалено/слишком старое — отправим новое
      }
    }

    if (cur) await this.api.deleteMessage(uid, cur.id).catch(ignoreError);
    const msg = view.photo
      ? await this.api.sendPhoto(uid, new InputFile(view.photo, 'qr.png'), {
          caption: clip(view.text, MAX_CAPTION),
          parse_mode: 'HTML',
          ...markup,
        })
      : await this.api.sendMessage(uid, clip(view.text, MAX_TEXT), {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          ...markup,
        });
    this.store.setPanel(uid, { id: msg.message_id, kind });
  }
}
