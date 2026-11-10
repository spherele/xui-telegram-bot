// Типы предметной области. Ничего не знают ни о Telegram, ни о HTTP.

export type TelegramId = number;

export interface InboundRef {
  id: number;
  remark: string;
  enable: boolean;
}

/** Клиент 3x-ui 3.x: одна запись (email уникален), прикреплённая к нескольким инбаундам. */
export interface Client {
  email: string;
  uuid: string | null;
  password: string | null;
  auth: string | null;
  subId: string;
  /** 0 — не привязан. */
  tgId: TelegramId;
  enable: boolean;
  /** мс; 0 — бессрочно; < 0 — длительность, отсчёт пойдёт с первого подключения. */
  expiryTime: number;
  /** байты; 0 — без лимита. */
  totalBytes: number;
  up: number;
  down: number;
  lastOnline: number;
  inboundIds: number[];
  inbounds: InboundRef[];
}

export interface Tariff {
  name: string;
  days: number;
  /** Цена как её задал админ («150», «1 490»). */
  price: string;
  /** 0 — безлимит. */
  gb: number;
}

/** Пользователь выбрал тариф и должен прислать чек. */
export interface PendingPayment {
  tariff: Tariff;
  /** email продлеваемого клиента; null — новая подписка. */
  target: string | null;
  at: number;
}

export type OrderStatus = 'pending' | 'processing' | 'done' | 'rejected' | 'failed';

export interface AdminMessageRef {
  chat: TelegramId;
  id: number;
}

export interface Order {
  id: number;
  uid: TelegramId;
  name: string;
  username: string | null;
  tariff: Tariff;
  target: string | null;
  status: OrderStatus;
  createdAt: number;
  fileUid: string | null;
  fileInfo: string | null;
  comment: string | null;
  adminMsgs: AdminMessageRef[];
  /** Итоговый email клиента после выполнения. */
  email?: string;
  decidedBy?: TelegramId;
  decidedAt?: number;
}

export interface ServerStatus {
  /** null — главный сервер (название берётся из конфига). */
  name: string | null;
  online: boolean;
  cpu: number;
  mem: number;
  latencyMs?: number;
  users?: number;
  uptimeSec: number;
}

export interface ServiceStatus {
  servers: ServerStatus[];
  onlineUsers: number | null;
  at: number;
}
