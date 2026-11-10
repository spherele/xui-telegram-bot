// Клиент API панели 3x-ui 3.x (клиенты — отдельные сущности: /panel/api/clients/*).
//
// Авторизация:
//   * API-токен (Настройки → Безопасность → API Token) — `Authorization: Bearer`, без CSRF;
//   * или логин/пароль: GET /csrf-token → POST /login (JSON) с X-CSRF-Token, сессия в cookie.
import { randomBytes, randomUUID } from 'node:crypto';
import { Agent, fetch as undiciFetch } from 'undici';

export class XUIError extends Error {}

const randStr = (n) => {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return [...randomBytes(n)].map((b) => abc[b % abc.length]).join('');
};

const parseJson = (v) => {
  if (typeof v !== 'string') return v ?? {};
  try {
    return JSON.parse(v);
  } catch {
    return {};
  }
};

const toInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/** Клиент в 3.x — одна запись (email уникален), прикреплённая к нескольким инбаундам. */
export const accountKey = (c) => c.email;

// Поля, которые сервер отдаёт, но которые не являются частью тела /clients/update.
const READ_ONLY = new Set(['id', 'createdAt', 'updatedAt', 'inboundIds', 'traffic']);

export class XUIClient {
  static CACHE_TTL_MS = 30_000;

  constructor({ baseUrl, username, password, twoFactor = null, apiToken = null, verifySsl = true, fetch = undiciFetch }) {
    this.base = baseUrl.replace(/\/+$/, '');
    this.username = username;
    this.password = password;
    this.twoFactor = twoFactor;
    this.apiToken = apiToken;
    this.fetch = fetch;
    this.dispatcher = verifySsl ? undefined : new Agent({ connect: { rejectUnauthorized: false } });
    this.cookies = new Map();
    this.csrf = null;
    this.loggedIn = false;
    this.loginPromise = null;
    this.cache = null;
    this.cacheTs = 0;
    this.remarks = new Map();
  }

  // ---------- транспорт ----------

  async #raw(path, { method = 'GET', json, headers = {} } = {}) {
    const h = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', ...headers };
    if (this.apiToken) h.Authorization = `Bearer ${this.apiToken}`;
    if (this.cookies.size) h.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (method !== 'GET' && this.csrf && !this.apiToken) h['X-CSRF-Token'] = this.csrf;
    if (json !== undefined) h['Content-Type'] = 'application/json';
    const r = await this.fetch(this.base + path, {
      method,
      headers: h,
      body: json === undefined ? undefined : JSON.stringify(json),
      redirect: 'manual',
      dispatcher: this.dispatcher,
    });
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    return r;
  }

  async #fetchCsrf() {
    const r = await this.#raw('/csrf-token');
    const j = await r.json().catch(() => null);
    if (!j?.success || typeof j.obj !== 'string') {
      throw new XUIError(`Не удалось получить CSRF-токен (HTTP ${r.status}). Проверьте PANEL_URL (с webBasePath).`);
    }
    this.csrf = j.obj;
  }

  async login() {
    this.cookies.clear();
    this.csrf = null;
    this.loggedIn = false;
    await this.#fetchCsrf();
    const body = { username: this.username, password: this.password };
    if (this.twoFactor) body.twoFactorCode = this.twoFactor;
    const r = await this.#raw('/login', { method: 'POST', json: body });
    const j = await r.json().catch(() => null);
    if (!j) throw new XUIError(`Логин: неожиданный ответ HTTP ${r.status}`);
    if (!j.success) throw new XUIError(`Логин не удался: ${j.msg || 'неверные данные'}`);
    await this.#fetchCsrf(); // токен привязан к сессии — после логина берём новый
    this.loggedIn = true;
  }

  async #ensureAuth() {
    if (this.apiToken || this.loggedIn) return;
    this.loginPromise ??= this.login().finally(() => (this.loginPromise = null));
    await this.loginPromise;
  }

  async request(method, path, json) {
    let status;
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.#ensureAuth();
      const r = await this.#raw(path, { method, json });
      status = r.status;
      // Протухшая сессия / CSRF: панель (или nginx перед ней) отвечает 401/403/404 или редиректом.
      const authFail = [401, 403, 404].includes(r.status) || (r.status >= 300 && r.status < 400);
      const j = authFail ? null : await r.json().catch(() => null);
      if (!j) {
        if (this.apiToken) break;
        this.loggedIn = false;
        continue;
      }
      if (!j.success) throw new XUIError(j.msg || 'Ошибка API 3x-ui');
      return j.obj;
    }
    throw new XUIError(`${method} ${path}: HTTP ${status}${this.apiToken ? ' (проверьте API_TOKEN)' : ''}`);
  }

  // ---------- справочные данные ----------

  async #loadRemarks() {
    try {
      const list = (await this.request('GET', '/panel/api/inbounds/list/slim')) ?? [];
      this.remarks = new Map(list.map((i) => [i.id, { remark: i.remark || `#${i.id}`, enable: i.enable }]));
    } catch {
      /* не критично */
    }
  }

  /** Настройки подписки из панели: subURI, subTitle, subSupportUrl. */
  async getPanelSettings() {
    const s = (await this.request('POST', '/panel/api/setting/all')) ?? {};
    return { subUri: s.subURI || null, title: s.subTitle || null, supportUrl: s.subSupportUrl || null };
  }

  /** id включённых инбаундов — к ним прикрепляются новые клиенты по умолчанию. */
  async enabledInboundIds() {
    await this.#loadRemarks();
    return [...this.remarks].filter(([, i]) => i.enable).map(([id]) => id);
  }

  // ---------- статус сервиса ----------

  /**
   * Сводка для пользователей: главный сервер + ноды. Без IP и прочих деталей.
   * Кэшируется на 30 секунд.
   */
  async serviceStatus() {
    if (this.statusCache && Date.now() - this.statusTs < 30_000) return this.statusCache;
    const [main, nodes, onlines] = await Promise.all([
      this.request('GET', '/panel/api/server/status'),
      this.request('GET', '/panel/api/nodes/list').catch(() => []),
      this.request('POST', '/panel/api/clients/onlines').catch(() => null),
    ]);
    const xray = parseJson(main?.xray);
    const mem = parseJson(main?.mem);
    const servers = [
      {
        name: null, // подставляется из SERVER_NAME
        online: xray.state === 'running',
        cpu: Number(main?.cpu) || 0,
        mem: mem.total ? (mem.current / mem.total) * 100 : 0,
        uptimeSec: toInt(main?.uptime),
      },
      ...(nodes ?? [])
        .filter((n) => n.enable)
        .map((n) => ({
          name: n.remark || n.name,
          online: n.status === 'online' && n.xrayState === 'running',
          cpu: Number(n.cpuPct) || 0,
          mem: Number(n.memPct) || 0,
          latencyMs: toInt(n.latencyMs),
          users: toInt(n.onlineCount),
          uptimeSec: toInt(n.uptimeSecs),
        })),
    ];
    this.statusCache = { servers, onlineUsers: Array.isArray(onlines) ? onlines.length : null, at: Date.now() };
    this.statusTs = Date.now();
    return this.statusCache;
  }

  // ---------- клиенты ----------

  #parse(c) {
    const t = c.traffic ?? {};
    const inboundIds = c.inboundIds ?? [];
    return {
      email: c.email ?? '',
      uuid: c.uuid || null,
      password: c.password || null,
      auth: c.auth || null,
      subId: c.subId || '',
      tgId: toInt(c.tgId),
      enable: (c.enable ?? true) && (t.enable ?? true),
      expiryTime: toInt(c.expiryTime), // мс; 0 — бессрочно; <0 — срок пойдёт с первого подключения
      totalBytes: toInt(c.totalGB), // 0 — без лимита (несмотря на имя, это байты)
      up: toInt(t.up),
      down: toInt(t.down),
      lastOnline: toInt(t.lastOnline),
      inboundIds,
      inbounds: inboundIds.map((id) => this.remarks.get(id)).filter(Boolean),
    };
  }

  async listClients(fresh = false) {
    if (!fresh && this.cache && Date.now() - this.cacheTs < XUIClient.CACHE_TTL_MS) return this.cache;
    if (!this.remarks.size) await this.#loadRemarks();
    const list = (await this.request('GET', '/panel/api/clients/list')) ?? [];
    this.cache = list.map((c) => this.#parse(c));
    this.cacheTs = Date.now();
    return this.cache;
  }

  invalidate() {
    this.cache = null;
  }

  async byTgId(tgId, fresh = false) {
    return (await this.listClients(fresh)).filter((c) => c.tgId === tgId);
  }

  async findByEmail(email) {
    const q = email.toLowerCase();
    return (await this.listClients(true)).filter((c) => c.email.toLowerCase() === q);
  }

  async findBySecrets(secrets) {
    const s = new Set(secrets.filter(Boolean));
    if (!s.size) return [];
    return (await this.listClients(true)).filter(
      (c) => s.has(c.uuid) || s.has(c.password) || s.has(c.auth) || s.has(c.subId),
    );
  }

  /**
   * /clients/update ЗАМЕНЯЕТ запись целиком, поэтому берём свежую полную запись
   * и собираем тело так же, как это делает веб-интерфейс панели (id = uuid).
   */
  async updateClient(email, changes) {
    const got = await this.request('GET', `/panel/api/clients/get/${encodeURIComponent(email)}`);
    const full = got?.client;
    if (!full || full.email !== email) throw new XUIError(`Клиент ${email} не найден`);
    const body = {};
    for (const [k, v] of Object.entries(full)) if (!READ_ONLY.has(k)) body[k] = v;
    body.id = full.uuid;
    if (body.reverse == null) delete body.reverse;
    // GET отдаёт allowedIPs строкой, а update ждёт []string (как и веб-интерфейс, шлём только непустой).
    if (typeof body.allowedIPs === 'string') {
      const ips = body.allowedIPs.split(',').map((s) => s.trim()).filter(Boolean);
      if (ips.length) body.allowedIPs = ips;
      else delete body.allowedIPs;
    }
    Object.assign(body, changes);
    await this.request('POST', `/panel/api/clients/update/${encodeURIComponent(email)}`, body);
    this.invalidate();
  }

  /** Новый клиент; uuid/пароль/subId генерируем сами, остальные секреты — сервер. */
  async addClient({ email, tgId, expiryTime, totalBytes = 0, inboundIds, limitIp = 0, group = '', comment = '' }) {
    if (!inboundIds?.length) throw new XUIError('Нет инбаундов для нового клиента');
    const uuid = randomUUID();
    const client = {
      email,
      id: uuid,
      uuid,
      password: randStr(16),
      subId: randStr(16),
      flow: '',
      totalGB: totalBytes,
      expiryTime,
      limitIp,
      limitHwid: 0,
      tgId,
      group,
      comment,
      enable: true,
    };
    await this.request('POST', '/panel/api/clients/add', { client, inboundIds });
    this.invalidate();
    return client;
  }

  async resetTraffic(email) {
    await this.request('POST', `/panel/api/clients/resetTraffic/${encodeURIComponent(email)}`);
    this.invalidate();
  }

  /** tgId — число, 0 означает «не привязан». */
  async setTgId(client, tgId) {
    await this.updateClient(client.email, { tgId });
    client.tgId = tgId;
  }
}
