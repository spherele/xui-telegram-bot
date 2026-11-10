// Сквозной стенд: настоящее приложение (createApp) + фейковая панель + перехват Bot API.
import assert from 'node:assert/strict';
import type { Update } from 'grammy/types';
import { type App, createApp } from '../../src/app.js';
import { type Config, loadConfig } from '../../src/config.js';
import { StateStore } from '../../src/infra/store.js';
import { FakePanel } from './fake-panel.js';

export const ADMIN = 9;
export const USER = 42;

// Разметка, которую принимает Telegram (parse_mode: HTML): только эти теги и все закрыты.
const TG_TAGS = new Set(['b', 'i', 'u', 's', 'code', 'pre', 'a', 'blockquote', 'tg-spoiler']);
export function assertTelegramHtml(text: string): void {
  const stack: string[] = [];
  for (const [, close, name = ''] of text.matchAll(/<(\/?)([a-z-]+)[^>]*>/g)) {
    assert.ok(TG_TAGS.has(name), `недопустимый тег <${name}> в: ${text.slice(0, 80)}`);
    if (close) assert.equal(stack.pop(), name, `несбалансированный </${name}> в: ${text.slice(0, 120)}`);
    else stack.push(name);
  }
  assert.deepEqual(stack, [], `незакрытые теги ${stack.join(',')} в: ${text.slice(0, 120)}`);
  assert.ok(!/<(?![a-z/])|&(?!(amp|lt|gt|quot);)/.test(text), `неэкранированный символ в: ${text.slice(0, 120)}`);
}

export interface ApiCall {
  method: string;
  payload: Record<string, unknown> & { chat_id?: number; text?: string; caption?: string; reply_markup?: unknown };
}

export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({
    BOT_TOKEN: '1:x',
    PANEL_URL: 'https://panel.test/secret/',
    PANEL_USERNAME: 'admin',
    PANEL_PASSWORD: 'pw',
    ADMIN_IDS: String(ADMIN),
    TZ_NAME: 'UTC',
    SUB_URL: 'https://s.test/sub',
    BOT_TITLE: 'TestVPN',
    SUPPORT_URL: 'https://t.me/@support',
    SERVER_NAME: 'Москва',
    NODE_NAMES: 'germany=🇩🇪 Германия',
    TARIFFS: '1 месяц|30|150',
    PAYMENT_DETAILS: 'Карта 0000',
    WHITELIST_INBOUNDS: '3',
    WHITELIST_PRICE: '100',
    ...env,
  });
}

export class Harness {
  readonly panel: FakePanel;
  readonly app: App;
  readonly calls: ApiCall[] = [];
  private seq = 0;
  private mid = 1000;

  constructor(env: Record<string, string> = {}, panel = new FakePanel()) {
    this.panel = panel;
    this.app = createApp(testConfig(env), { fetch: panel.fetch, store: StateStore.inMemory() });
    this.app.bot.botInfo = {
      id: 1,
      is_bot: true,
      first_name: 'b',
      username: 'b',
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
    } as never;
    this.app.bot.api.config.use(async (_prev, method, payload) => {
      const p = payload as ApiCall['payload'];
      for (const t of [p.text, p.caption]) if (typeof t === 'string') assertTelegramHtml(t);
      this.calls.push({ method, payload: p });
      const result = method.startsWith('send') ? { message_id: ++this.mid, chat: { id: p.chat_id }, date: 0 } : true;
      return { ok: true, result } as never;
    });
  }

  get store() {
    return this.app.store;
  }

  private who(id: number) {
    return {
      user: {
        id,
        is_bot: false,
        first_name: id === ADMIN ? 'Admin' : 'Ivan',
        username: id === ADMIN ? 'boss' : 'ivan_user',
      },
      chat: { id, type: 'private' as const, first_name: 'U' },
    };
  }

  async send(extra: Record<string, unknown>, id = USER): Promise<void> {
    const { user, chat } = this.who(id);
    await this.app.bot.handleUpdate({
      update_id: ++this.seq,
      message: { message_id: ++this.seq, date: 0, chat, from: user, ...extra },
    });
  }

  async msg(text: string, id = USER): Promise<void> {
    const entities = text.startsWith('/')
      ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }]
      : undefined;
    await this.send({ text, ...(entities ? { entities } : {}) }, id);
  }

  async click(data: string, id = USER): Promise<void> {
    const { user, chat } = this.who(id);
    const p = this.store.getPanel(id);
    await this.app.bot.handleUpdate({
      update_id: ++this.seq,
      callback_query: {
        id: String(this.seq),
        from: user,
        chat_instance: 'c',
        data,
        message: { message_id: p?.id ?? 1, date: 0, chat, text: 'x', ...(p?.kind === 'photo' ? { photo: [{}] } : {}) },
      },
    } as Update);
  }

  last(method: string): ApiCall['payload'] | undefined {
    return this.calls.filter((c) => c.method === method).at(-1)?.payload;
  }

  /** Текст последнего показанного пользователю экрана/подписи. */
  lastScreen(uid = USER): string {
    const c = this.calls.filter((x) => x.payload.chat_id === uid && /^(send|edit)/.test(x.method)).at(-1)?.payload;
    return c?.text ?? c?.caption ?? (c?.media as { caption?: string } | undefined)?.caption ?? '';
  }

  buttons(payload = this.calls.filter((c) => /^(send|edit)/.test(c.method)).at(-1)?.payload): string {
    return JSON.stringify(payload?.reply_markup ?? {});
  }

  callbackData(re: RegExp): string {
    const m = re.exec(this.buttons());
    assert.ok(m, `кнопка ${re} не найдена в ${this.buttons()}`);
    return m[1] ?? m[0];
  }
}
