// Репозиторий клиентов: кэш поверх API панели и операции над клиентами.
import type { Client, InboundRef, TelegramId } from '../domain/types.js';
import type { NewClient, XuiApi } from '../infra/xui/api.js';

export class ClientRepository {
  static readonly CACHE_TTL_MS = 30_000;

  private cache: Client[] | null = null;
  private cacheAt = 0;
  private inboundMap = new Map<number, InboundRef>();

  constructor(private readonly api: XuiApi) {}

  async list(fresh = false): Promise<Client[]> {
    if (!fresh && this.cache && Date.now() - this.cacheAt < ClientRepository.CACHE_TTL_MS) return this.cache;
    if (!this.inboundMap.size) await this.refreshInbounds();
    this.cache = await this.api.clients(this.inboundMap);
    this.cacheAt = Date.now();
    return this.cache;
  }

  invalidate(): void {
    this.cache = null;
  }

  async byTgId(tgId: TelegramId, fresh = false): Promise<Client[]> {
    return (await this.list(fresh)).filter((c) => c.tgId === tgId);
  }

  async byEmail(email: string): Promise<Client | null> {
    const q = email.toLowerCase();
    return (await this.list(true)).find((c) => c.email.toLowerCase() === q) ?? null;
  }

  /** Поиск по uuid / паролю / auth / subId. */
  async bySecrets(secrets: readonly string[]): Promise<Client[]> {
    const s = new Set(secrets.filter(Boolean));
    if (!s.size) return [];
    const has = (v: string | null) => !!v && s.has(v);
    return (await this.list(true)).filter((c) => has(c.uuid) || has(c.password) || has(c.auth) || has(c.subId));
  }

  async enabledInboundIds(): Promise<number[]> {
    await this.refreshInbounds();
    return [...this.inboundMap.values()].filter((i) => i.enable).map((i) => i.id);
  }

  /** email на основе username; при занятости добавляется -2, -3… */
  async uniqueEmail(base: string): Promise<string> {
    const taken = new Set((await this.list(true)).map((c) => c.email.toLowerCase()));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }

  // ---------- изменения ----------

  async update(email: string, changes: Record<string, unknown>): Promise<void> {
    await this.api.updateClient(email, changes);
    this.invalidate();
  }

  async setTgId(email: string, tgId: TelegramId): Promise<void> {
    await this.update(email, { tgId });
  }

  async create(c: NewClient): Promise<void> {
    await this.api.addClient(c);
    this.invalidate();
  }

  async resetTraffic(email: string): Promise<void> {
    await this.api.resetTraffic(email);
    this.invalidate();
  }

  private async refreshInbounds(): Promise<void> {
    try {
      this.inboundMap = new Map((await this.api.inbounds()).map((i) => [i.id, i]));
    } catch {
      /* не критично: без названий инбаундов всё работает */
    }
  }
}
