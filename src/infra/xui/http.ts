// HTTP-транспорт к панели 3x-ui 3.x: авторизация, cookie, CSRF, повторный вход.
//
//   * API-токен (Настройки → Безопасность → API Token) — `Authorization: Bearer`, без CSRF;
//   * или логин/пароль: GET /csrf-token → POST /login (JSON) с X-CSRF-Token, сессия в cookie.
// Без CSRF-токена nginx перед панелью отвечает 404 — поэтому 404 тоже считаем «нет сессии».
import { Agent, fetch as undiciFetch } from 'undici';

export class XuiError extends Error {
  override name = 'XuiError';
}

/** Минимум от fetch, который нам нужен, — чтобы в тестах подставлять фейковую панель. */
export interface FetchResponse {
  status: number;
  headers: { getSetCookie?(): string[] };
  json(): Promise<unknown>;
}
export interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  redirect: 'manual';
  dispatcher?: unknown;
}
export type FetchFn = (url: string, init: FetchInit) => Promise<FetchResponse>;

export interface XuiAuth {
  baseUrl: string;
  apiToken?: string | null;
  username?: string;
  password?: string;
  twoFactor?: string | null;
  verifySsl?: boolean;
  fetch?: FetchFn;
}

interface Envelope<T> {
  success: boolean;
  msg?: string;
  obj?: T;
}

const isEnvelope = (v: unknown): v is Envelope<unknown> => typeof v === 'object' && v !== null && 'success' in v;

export class XuiHttp {
  private readonly base: string;
  private readonly fetchFn: FetchFn;
  private readonly dispatcher: Agent | undefined;
  private readonly cookies = new Map<string, string>();
  private csrf: string | null = null;
  private loggedIn = false;
  private loginPromise: Promise<void> | null = null;
  /** Сколько раз выполнялся логин — для диагностики и тестов. */
  logins = 0;

  constructor(private readonly auth: XuiAuth) {
    this.base = auth.baseUrl.replace(/\/+$/, '');
    this.fetchFn = auth.fetch ?? (undiciFetch as unknown as FetchFn);
    this.dispatcher = auth.verifySsl === false ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined;
  }

  get usesToken(): boolean {
    return !!this.auth.apiToken;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, json?: unknown): Promise<T> {
    return this.request<T>('POST', path, json);
  }

  async request<T>(method: string, path: string, json?: unknown): Promise<T> {
    let status = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.ensureAuth();
      const r = await this.raw(method, path, json);
      status = r.status;
      const authFail = [401, 403, 404].includes(r.status) || (r.status >= 300 && r.status < 400);
      const body = authFail ? null : await r.json().catch(() => null);
      if (!isEnvelope(body)) {
        if (this.usesToken) break;
        this.loggedIn = false;
        continue;
      }
      if (!body.success) throw new XuiError(body.msg || 'Ошибка API 3x-ui');
      return body.obj as T;
    }
    throw new XuiError(`${method} ${path}: HTTP ${status}${this.usesToken ? ' (проверьте API_TOKEN)' : ''}`);
  }

  // ---------- внутреннее ----------

  private async raw(method: string, path: string, json?: unknown): Promise<FetchResponse> {
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    if (this.auth.apiToken) headers.Authorization = `Bearer ${this.auth.apiToken}`;
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (method !== 'GET' && this.csrf && !this.usesToken) headers['X-CSRF-Token'] = this.csrf;
    if (json !== undefined) headers['Content-Type'] = 'application/json';
    const init: FetchInit = { method, headers, redirect: 'manual' };
    if (json !== undefined) init.body = JSON.stringify(json);
    if (this.dispatcher) init.dispatcher = this.dispatcher;
    const r = await this.fetchFn(this.base + path, init);
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const pair = c.split(';')[0] ?? '';
      const i = pair.indexOf('=');
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    return r;
  }

  private async fetchCsrf(): Promise<void> {
    const r = await this.raw('GET', '/csrf-token');
    const body = await r.json().catch(() => null);
    if (!isEnvelope(body) || !body.success || typeof body.obj !== 'string') {
      throw new XuiError(`Не удалось получить CSRF-токен (HTTP ${r.status}). Проверьте PANEL_URL (с webBasePath).`);
    }
    this.csrf = body.obj;
  }

  private async login(): Promise<void> {
    this.cookies.clear();
    this.csrf = null;
    this.loggedIn = false;
    await this.fetchCsrf();
    const creds: Record<string, string> = { username: this.auth.username ?? '', password: this.auth.password ?? '' };
    if (this.auth.twoFactor) creds.twoFactorCode = this.auth.twoFactor;
    const r = await this.raw('POST', '/login', creds);
    const body = await r.json().catch(() => null);
    if (!isEnvelope(body)) throw new XuiError(`Логин: неожиданный ответ HTTP ${r.status}`);
    if (!body.success) throw new XuiError(`Логин не удался: ${body.msg || 'неверные данные'}`);
    await this.fetchCsrf(); // токен привязан к сессии — после логина берём новый
    this.loggedIn = true;
    this.logins++;
  }

  private async ensureAuth(): Promise<void> {
    if (this.usesToken || this.loggedIn) return;
    this.loginPromise ??= this.login().finally(() => (this.loginPromise = null));
    await this.loginPromise;
  }
}
