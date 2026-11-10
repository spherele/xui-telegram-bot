// Фейковая панель 3x-ui 3.x на уровне HTTP: CSRF + логин (или Bearer), клиенты, инбаунды, статус.
// Поведение повторяет реальную панель там, где это важно:
//   * без CSRF небезопасные запросы режутся nginx-ом (404);
//   * /clients/update ЗАМЕНЯЕТ запись целиком, id в теле — uuid;
//   * allowedIPs в update должен быть массивом.
import type { FetchFn, FetchInit, FetchResponse } from '../../src/infra/xui/http.js';

export interface Row extends Record<string, unknown> {
  id: number;
  email: string;
  uuid: string;
  subId: string;
  tgId: number;
  expiryTime: number;
  totalGB: number;
  enable: boolean;
}

export interface FakePanelOptions {
  token?: string;
  username?: string;
  password?: string;
}

export const UUID1 = '11111111-1111-4111-8111-111111111111';
export const UUID2 = '22222222-2222-4222-8222-222222222222';

export function row(id: number, email: string, uuid: string, subId: string, extra: Partial<Row> = {}): Row {
  return {
    id,
    email,
    uuid,
    subId,
    password: `pw-${email}`,
    auth: `au-${email}`,
    flow: '',
    security: 'auto',
    limitIp: 0,
    limitHwid: 0,
    totalGB: 0,
    expiryTime: 0,
    enable: true,
    tgId: 0,
    group: 'g',
    comment: 'c',
    reset: 0,
    allowedIPs: '',
    createdAt: 1,
    updatedAt: 2,
    reverse: null,
    ...extra,
  };
}

const res = (status: number, body: unknown, cookies: string[] = []): FetchResponse => ({
  status,
  headers: { getSetCookie: () => cookies },
  json: async () => {
    if (typeof body === 'string') throw new SyntaxError('not json');
    return body;
  },
});
const ok = (obj?: unknown, cookies?: string[]) => res(200, { success: true, obj }, cookies);
const fail = (msg: string) => res(200, { success: false, msg });
const nginx404 = () => res(404, '<html>404 Not Found</html>');

export class FakePanel {
  rows: Row[];
  traffic = new Map<string, { up: number; down: number }>();
  inbounds = [
    { id: 1, remark: 'RU', enable: true },
    { id: 2, remark: 'DE', enable: false },
    { id: 3, remark: 'NL', enable: true },
  ];
  nodes = [
    {
      remark: 'germany',
      enable: true,
      status: 'online',
      xrayState: 'running',
      cpuPct: 5,
      memPct: 30,
      latencyMs: 60,
      onlineCount: 2,
      uptimeSecs: 10,
    },
  ];
  xrayState = 'running';
  onlines = ['ivan'];
  settings = { subURI: 'https://sub.test/s/', subTitle: 'TestVPN', subSupportUrl: 'https://t.me/@support' };

  sessions = new Set<string>();
  csrf = new Map<string, string>();
  logins = 0;
  calls: { method: string; path: string; body?: unknown }[] = [];
  private seq = 0;

  constructor(private readonly opts: FakePanelOptions = {}) {
    this.rows = [row(1, 'ivan', UUID1, 'subivan12345'), row(2, 'petr', UUID2, 'subpetr12345', { tgId: 555 })];
    this.traffic.set('ivan', { up: 100, down: 200 });
  }

  get writes() {
    return this.calls.filter(
      (c) =>
        c.method === 'POST' && !['/login', '/panel/api/clients/onlines', '/panel/api/setting/all'].includes(c.path),
    );
  }

  find(email: string): Row | undefined {
    return this.rows.find((r) => r.email === email);
  }

  fetch: FetchFn = async (url: string, init: FetchInit) => {
    const path = new URL(url).pathname.replace(/^\/secret/, '');
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    this.calls.push({ method: init.method, path, body });
    const h = init.headers;
    const sid = /3x-ui=(\w+)/.exec(h.Cookie ?? '')?.[1];
    const bearer = !!this.opts.token && h.Authorization === `Bearer ${this.opts.token}`;

    if (path === '/csrf-token') {
      const s = sid ?? `anon${++this.seq}`;
      const t = `tok-${s}-${++this.seq}`;
      this.csrf.set(s, t);
      return ok(t, sid ? [] : [`3x-ui=${s}; Path=/; HttpOnly`]);
    }
    if (init.method === 'POST' && !bearer && (!sid || this.csrf.get(sid) !== h['X-CSRF-Token'])) return nginx404();

    if (path === '/login') {
      const creds = body ?? {};
      if (creds.username !== (this.opts.username ?? 'admin') || creds.password !== (this.opts.password ?? 'pw'))
        return fail('bad');
      const s = `s${++this.logins}`; // сессия ротируется
      this.sessions.add(s);
      return ok(null, [`3x-ui=${s}; Path=/; HttpOnly`]);
    }
    if (!bearer && !(sid && this.sessions.has(sid))) return nginx404();

    const view = (r: Row) => ({
      ...r,
      inboundIds: [1, 2, 3],
      traffic: { ...(this.traffic.get(r.email) ?? { up: 0, down: 0 }), enable: true },
    });
    const m = (re: RegExp) => re.exec(path)?.[1];
    let email: string | undefined;

    if (path === '/panel/api/clients/list') return ok(this.rows.map(view));
    if (path === '/panel/api/inbounds/list/slim') return ok(this.inbounds);
    if (path === '/panel/api/clients/onlines') return ok(this.onlines);
    if (path === '/panel/api/server/status')
      return ok({
        cpu: 12,
        xray: JSON.stringify({ state: this.xrayState }),
        mem: JSON.stringify({ current: 1, total: 4 }),
        uptime: 100,
      });
    if (path === '/panel/api/nodes/list') return ok(this.nodes);
    if (path === '/panel/api/setting/all') return ok(this.settings);

    if ((email = m(/^\/panel\/api\/clients\/get\/(.+)$/))) {
      const r = this.find(decodeURIComponent(email));
      return r ? ok({ client: r, inboundIds: [1, 2, 3], externalLinks: [] }) : fail('not found');
    }
    if ((email = m(/^\/panel\/api\/clients\/update\/(.+)$/))) {
      email = decodeURIComponent(email);
      const i = this.rows.findIndex((r) => r.email === email);
      if (i < 0) return fail('not found');
      if (typeof body?.allowedIPs === 'string')
        return fail('json: cannot unmarshal string into Go struct field .allowedIPs of type []string');
      const { id: uuid, ...rest } = body!;
      const prev = this.rows[i]!;
      this.rows[i] = { ...(rest as Row), id: prev.id, uuid: uuid as string, createdAt: prev.createdAt };
      return ok(null);
    }
    if (path === '/panel/api/clients/add') {
      const c = (body as { client: Row & { id: string } }).client;
      if (this.find(c.email)) return fail('email exists');
      const { id: uuid, ...rest } = c;
      this.rows.push({ ...(rest as unknown as Row), id: this.rows.length + 1, uuid });
      return ok(null);
    }
    if ((email = m(/^\/panel\/api\/clients\/del\/(.+)$/))) {
      this.rows = this.rows.filter((r) => r.email !== decodeURIComponent(email!));
      return ok(null);
    }
    if ((email = m(/^\/panel\/api\/clients\/resetTraffic\/(.+)$/))) {
      this.traffic.set(decodeURIComponent(email), { up: 0, down: 0 });
      return ok(null);
    }
    return nginx404();
  };
}
