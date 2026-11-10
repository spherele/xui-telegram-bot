// Статус VPN-сервиса: главный сервер + ноды, с коротким кэшем.
import type { ServiceStatus } from '../domain/types.js';
import type { XuiApi } from '../infra/xui/api.js';

export class StatusService {
  static readonly CACHE_TTL_MS = 30_000;
  private cache: ServiceStatus | null = null;

  constructor(private readonly api: XuiApi) {}

  async get(fresh = false): Promise<ServiceStatus> {
    if (!fresh && this.cache && Date.now() - this.cache.at < StatusService.CACHE_TTL_MS) return this.cache;
    const [main, nodes, onlineUsers] = await Promise.all([
      this.api.mainServer(),
      this.api.nodes(),
      this.api.onlineCount(),
    ]);
    this.cache = { servers: [main, ...nodes], onlineUsers, at: Date.now() };
    return this.cache;
  }
}
