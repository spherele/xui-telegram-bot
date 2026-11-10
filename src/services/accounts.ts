// Привязка подписок к Telegram и админские операции над привязками.
import { isActive } from '../domain/rules.js';
import type { Client, TelegramId } from '../domain/types.js';
import { extractSecrets } from '../lib/links.js';
import type { ClientRepository } from './clients.js';

export type LinkResult =
  | { kind: 'no_secrets' }
  | { kind: 'rate_limited' }
  | { kind: 'not_found' }
  | { kind: 'foreign' }
  | { kind: 'already'; client: Client }
  | { kind: 'linked'; clients: Client[] };

export type AdminLinkResult = { kind: 'not_found' } | { kind: 'ok'; client: Client };

export interface Stats {
  clients: number;
  linked: number;
  users: number;
  active: number;
}

/** Не больше `limit` неудачных попыток за `windowMs` — защита от перебора. */
class FailLimiter {
  private readonly fails = new Map<TelegramId, number[]>();
  constructor(
    private readonly limit = 5,
    private readonly windowMs = 10 * 60_000,
  ) {}

  blocked(uid: TelegramId): boolean {
    const now = Date.now();
    const list = (this.fails.get(uid) ?? []).filter((t) => now - t < this.windowMs);
    this.fails.set(uid, list);
    return list.length >= this.limit;
  }

  hit(uid: TelegramId): void {
    this.fails.set(uid, [...(this.fails.get(uid) ?? []), Date.now()]);
  }
}

export class AccountService {
  private readonly limiter = new FailLimiter();

  constructor(private readonly clients: ClientRepository) {}

  mine(uid: TelegramId, fresh = false): Promise<Client[]> {
    return this.clients.byTgId(uid, fresh);
  }

  async mineByEmail(uid: TelegramId, email: string): Promise<Client | null> {
    return (await this.mine(uid)).find((c) => c.email === email) ?? null;
  }

  /** Есть ли в тексте ссылка/ключ — без запроса к панели. */
  static looksLikeKey(text: string): boolean {
    return extractSecrets(text).length > 0;
  }

  /** Пользователь прислал ссылку подписки или ключ. */
  async link(uid: TelegramId, text: string): Promise<LinkResult> {
    const secrets = extractSecrets(text);
    if (!secrets.length) return { kind: 'no_secrets' };
    if (this.limiter.blocked(uid)) return { kind: 'rate_limited' };
    const found = await this.clients.bySecrets(secrets);
    const [first] = found;
    if (!first) {
      this.limiter.hit(uid);
      return { kind: 'not_found' };
    }
    if (found.some((c) => c.tgId && c.tgId !== uid)) return { kind: 'foreign' };
    const toLink = found.filter((c) => c.tgId !== uid);
    if (!toLink.length) return { kind: 'already', client: first };
    for (const c of toLink) await this.clients.setTgId(c.email, uid);
    return { kind: 'linked', clients: found };
  }

  async unlink(uid: TelegramId, email: string): Promise<Client | null> {
    const c = await this.mineByEmail(uid, email);
    if (!c) return null;
    await this.clients.setTgId(c.email, 0);
    return c;
  }

  // ---------- админ ----------

  async adminSetTg(email: string, tgId: TelegramId): Promise<AdminLinkResult> {
    const c = await this.clients.byEmail(email);
    if (!c) return { kind: 'not_found' };
    await this.clients.setTgId(c.email, tgId);
    return { kind: 'ok', client: { ...c, tgId } };
  }

  async find(query: string): Promise<Client[]> {
    const q = query.trim().toLowerCase();
    const all = await this.clients.list(true);
    return /^\d+$/.test(q)
      ? all.filter((c) => String(c.tgId) === q)
      : all.filter((c) => c.email.toLowerCase().includes(q));
  }

  async stats(): Promise<Stats> {
    const all = await this.clients.list(true);
    const linked = all.filter((c) => c.tgId);
    return {
      clients: all.length,
      linked: linked.length,
      users: new Set(linked.map((c) => c.tgId)).size,
      active: all.filter((c) => isActive(c)).length,
    };
  }
}
