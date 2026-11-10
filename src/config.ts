// Конфигурация из переменных окружения — единственное место, где читается process.env.
import type { Tariff } from './domain/types.js';

export interface WhitelistConfig {
  /** id инбаундов white-list; пусто — опция выключена. */
  inboundIds: number[];
  /** Доплата за месяц. */
  monthPrice: number;
  name: string;
}

export interface ShopConfig {
  tariffs: Tariff[];
  currency: string;
  paymentDetails: string;
  /** Цена месяца для «своего срока»; 0 — свой срок выключен. */
  monthPrice: number;
  customMaxMonths: number;
  whitelist: WhitelistConfig;
  /** id инбаундов для новых клиентов; пусто — все включённые (white-list — только по опции). */
  inboundIds: number[];
  limitIp: number;
  group: string;
}

export interface Config {
  botToken: string;
  panel: {
    url: string;
    apiToken: string | null;
    username: string;
    password: string;
    twoFactor: string | null;
    verifySsl: boolean;
  };
  adminIds: ReadonlySet<number>;
  tz: string;
  /** Подставляются из настроек панели, если не заданы. */
  subUrl: string | null;
  title: string | null;
  supportUrl: string | null;
  serverName: string;
  /** remark ноды → отображаемое имя; ключи `#0`, `#1`… — по порядку. */
  nodeNames: Record<string, string>;
  notify: { enabled: boolean; days: number; trafficPercent: number; intervalMin: number };
  shop: ShopConfig;
  dataDir: string;
}

type Env = Record<string, string | undefined>;

const str = (env: Env, name: string): string => (env[name] ?? '').trim();

function req(env: Env, name: string): string {
  const v = str(env, name);
  if (!v) throw new Error(`Не задана переменная окружения ${name}`);
  return v;
}

function bool(env: Env, name: string, def: boolean): boolean {
  const v = str(env, name).toLowerCase();
  return v ? ['1', 'true', 'yes', 'on'].includes(v) : def;
}

function int(env: Env, name: string, def: number): number {
  const v = str(env, name);
  const n = Number(v);
  return v && Number.isFinite(n) ? n : def;
}

function ids(v: string): number[] {
  return list(v, ',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
}

/** "1 490" / "1490.00" → 1490 */
const money = (v: string): number => Number(v.replace(/[\s\u00a0]/g, '').replace(',', '.'));

const list = (v: string, sep: string | RegExp): string[] =>
  v
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * TARIFFS="1 месяц|30|150;3 месяца|90|400;Год|365|1400|500"
 *          название | дней | цена | ГБ (необязательно; пусто/0 — безлимит)
 */
export function parseTariffs(raw: string): Tariff[] {
  return list(raw, ';').map((s) => {
    const [name = '', days = '', price = '', gb = ''] = s.split('|').map((x) => x.trim());
    if (!name || !(Number(days) > 0) || !(money(price) > 0)) throw new Error(`Неверный тариф в TARIFFS: "${s}"`);
    return { name, days: Number(days), price: money(price), gb: Number(gb) || 0 };
  });
}

/** "germany=🇩🇪 Германия;🇳🇱 Нидерланды" → { germany: …, '#1': … } */
export function parseNodeNames(raw: string): Record<string, string> {
  return Object.fromEntries(
    list(raw, ';').map((s, i) => {
      const eq = s.indexOf('=');
      return eq > 0 ? [s.slice(0, eq).trim(), s.slice(eq + 1).trim()] : [`#${i}`, s];
    }),
  );
}

export function loadConfig(env: Env = process.env): Config {
  const apiToken = str(env, 'API_TOKEN') || null;
  const tariffs = parseTariffs(str(env, 'TARIFFS'));
  // цена месяца: MONTH_PRICE или цена 30-дневного тарифа
  const monthPrice = str(env, 'MONTH_PRICE')
    ? money(str(env, 'MONTH_PRICE'))
    : (tariffs.find((t) => t.days === 30)?.price ?? 0);
  return {
    botToken: req(env, 'BOT_TOKEN'),
    panel: {
      url: req(env, 'PANEL_URL').replace(/\/+$/, ''),
      apiToken,
      username: apiToken ? str(env, 'PANEL_USERNAME') : req(env, 'PANEL_USERNAME'),
      password: apiToken ? str(env, 'PANEL_PASSWORD') : req(env, 'PANEL_PASSWORD'),
      twoFactor: str(env, 'PANEL_2FA_CODE') || null,
      verifySsl: bool(env, 'PANEL_VERIFY_SSL', true),
    },
    adminIds: new Set(list(str(env, 'ADMIN_IDS'), ',').map(Number).filter(Number.isFinite)),
    tz: str(env, 'TZ_NAME') || 'Europe/Moscow',
    subUrl: str(env, 'SUB_URL').replace(/\/+$/, '') || null,
    title: str(env, 'BOT_TITLE') || null,
    supportUrl: str(env, 'SUPPORT_URL') || null,
    serverName: str(env, 'SERVER_NAME') || 'Основной сервер',
    nodeNames: parseNodeNames(str(env, 'NODE_NAMES')),
    notify: {
      enabled: bool(env, 'NOTIFY_ENABLED', true),
      days: int(env, 'NOTIFY_DAYS', 3),
      trafficPercent: int(env, 'NOTIFY_TRAFFIC_PERCENT', 90),
      intervalMin: int(env, 'NOTIFY_INTERVAL_MIN', 60),
    },
    shop: {
      tariffs,
      currency: str(env, 'CURRENCY') || '₽',
      paymentDetails: str(env, 'PAYMENT_DETAILS').replace(/\\n/g, '\n'),
      monthPrice: Number.isFinite(monthPrice) && monthPrice > 0 ? monthPrice : 0,
      customMaxMonths: int(env, 'CUSTOM_MAX_MONTHS', 12),
      whitelist: {
        inboundIds: ids(str(env, 'WHITELIST_INBOUNDS')),
        monthPrice: money(str(env, 'WHITELIST_PRICE') || '150'),
        name: str(env, 'WHITELIST_NAME') || 'White-list',
      },
      inboundIds: ids(str(env, 'NEW_CLIENT_INBOUNDS')),
      limitIp: int(env, 'NEW_CLIENT_LIMIT_IP', 0),
      group: str(env, 'NEW_CLIENT_GROUP'),
    },
    dataDir: str(env, 'DATA_DIR') || 'data',
  };
}
