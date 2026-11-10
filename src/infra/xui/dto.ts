// Сырые типы ответов API 3x-ui 3.x и их преобразование в доменные.
import type { Client, InboundRef, ServerStatus } from '../../domain/types.js';

export interface TrafficDto {
  up?: number;
  down?: number;
  enable?: boolean;
  lastOnline?: number;
}

/** Элемент GET /panel/api/clients/list. */
export interface ClientListItemDto {
  id: number; // номер строки в БД — НЕ uuid
  email: string;
  uuid?: string;
  password?: string;
  auth?: string;
  subId?: string;
  tgId?: number | string;
  enable?: boolean;
  expiryTime?: number;
  totalGB?: number; // несмотря на имя — байты
  inboundIds?: number[];
  traffic?: TrafficDto;
  [k: string]: unknown;
}

/** GET /panel/api/clients/get/{email} → obj. */
export interface ClientRecordDto {
  client: Record<string, unknown> & { email: string; uuid?: string; reverse?: unknown; allowedIPs?: unknown };
  inboundIds: number[];
  externalLinks: unknown[];
}

export interface InboundSlimDto {
  id: number;
  remark?: string;
  protocol?: string;
  enable?: boolean;
}

export interface NodeDto {
  remark?: string;
  name?: string;
  enable?: boolean;
  status?: string;
  xrayState?: string;
  cpuPct?: number;
  memPct?: number;
  latencyMs?: number;
  onlineCount?: number;
  uptimeSecs?: number;
}

export interface ServerStatusDto {
  cpu?: number;
  xray?: string | { state?: string };
  mem?: string | { current?: number; total?: number };
  uptime?: number;
}

export interface PanelSettingsDto {
  subURI?: string;
  subTitle?: string;
  subSupportUrl?: string;
}

// ---------- маппинг ----------

const toInt = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/** Некоторые поля статуса приходят JSON-строкой. */
export function parseMaybeJson<T extends object>(v: unknown): Partial<T> {
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as Partial<T>;
    } catch {
      return {};
    }
  }
  return v ?? {};
}

export function toClient(c: ClientListItemDto, inbounds: ReadonlyMap<number, InboundRef>): Client {
  const t = c.traffic ?? {};
  const inboundIds = c.inboundIds ?? [];
  return {
    email: c.email,
    uuid: c.uuid || null,
    password: c.password || null,
    auth: c.auth || null,
    subId: c.subId || '',
    tgId: toInt(c.tgId),
    enable: (c.enable ?? true) && (t.enable ?? true),
    expiryTime: toInt(c.expiryTime),
    totalBytes: toInt(c.totalGB),
    up: toInt(t.up),
    down: toInt(t.down),
    lastOnline: toInt(t.lastOnline),
    inboundIds,
    inbounds: inboundIds.map((id) => inbounds.get(id)).filter((i): i is InboundRef => !!i),
  };
}

export const toInboundRef = (i: InboundSlimDto): InboundRef => ({
  id: i.id,
  remark: i.remark || `#${i.id}`,
  enable: i.enable ?? true,
});

export function toMainServer(s: ServerStatusDto): ServerStatus {
  const xray = parseMaybeJson<{ state: string }>(s.xray);
  const mem = parseMaybeJson<{ current: number; total: number }>(s.mem);
  return {
    name: null,
    online: xray.state === 'running',
    cpu: Number(s.cpu) || 0,
    mem: mem.total ? ((mem.current ?? 0) / mem.total) * 100 : 0,
    uptimeSec: toInt(s.uptime),
  };
}

export const toNodeServer = (n: NodeDto): ServerStatus => ({
  name: n.remark || n.name || 'node',
  online: n.status === 'online' && n.xrayState === 'running',
  cpu: Number(n.cpuPct) || 0,
  mem: Number(n.memPct) || 0,
  latencyMs: toInt(n.latencyMs),
  users: toInt(n.onlineCount),
  uptimeSec: toInt(n.uptimeSecs),
});

// Поля, которые сервер отдаёт, но которые не являются частью тела /clients/update.
const READ_ONLY = new Set(['id', 'createdAt', 'updatedAt', 'inboundIds', 'traffic']);

/**
 * Тело для POST /clients/update: сервер ЗАМЕНЯЕТ запись целиком, поэтому берём
 * полную свежую запись и собираем тело так же, как веб-интерфейс панели.
 */
export function toUpdateBody(
  full: ClientRecordDto['client'],
  changes: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(full)) if (!READ_ONLY.has(k)) body[k] = v;
  body.id = full.uuid; // в теле id — это uuid
  if (body.reverse == null) delete body.reverse;
  // GET отдаёт allowedIPs строкой, а update ждёт []string (шлём только непустой — как UI)
  if (typeof body.allowedIPs === 'string') {
    const ips = body.allowedIPs
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (ips.length) body.allowedIPs = ips;
    else delete body.allowedIPs;
  }
  return Object.assign(body, changes);
}
