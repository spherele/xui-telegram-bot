// Все callback_data в одном месте: построители и шаблоны для разбора.
// Email в callback_data не кладём (лимит 64 байта и лишняя утечка) — только короткий хэш.
import { createHash } from 'node:crypto';
import type { Plan } from '../domain/types.js';

/** План в callback_data: `t0` — тариф №0, `m4` — свой срок 4 мес. */
export const encodePlan = (p: Plan): string => (p.kind === 'tariff' ? `t${p.index}` : `m${p.months}`);

export function decodePlan(kind: string, n: string): Plan {
  return kind === 't' ? { kind: 'tariff', index: Number(n) } : { kind: 'custom', months: Number(n) };
}

export const hashKey = (key: string): string => createHash('sha1').update(key).digest('hex').slice(0, 12);

export const CB = {
  home: 'home',
  refresh: 'home:r',
  have: 'have',
  addAccount: 'add',
  status: 'status',
  statusRefresh: 'status:r',
  unlinkList: 'ul',
  tariffs: 'buy',
  payCancel: 'paycancel',
  notifyOpen: 'n:open',
  notifyClose: 'n:close',

  subscription: (email: string) => `sub:${hashKey(email)}`,
  unlinkAsk: (email: string) => `ul:${hashKey(email)}`,
  unlinkConfirm: (email: string) => `ulc:${hashKey(email)}`,
  toggleWhitelist: 'wl',
  plan: (p: Plan) => `buy:${encodePlan(p)}`,
  tariff: (index: number) => `buy:${encodePlan({ kind: 'tariff', index })}`,
  /** Экран выбора своего срока с выбранным числом месяцев. */
  customTerm: (months: number) => `cm:${months}`,
  pay: (p: Plan, email: string | null) => `pay:${encodePlan(p)}:${email ? hashKey(email) : 'new'}`,
  orderApprove: (id: number) => `ord:ok:${id}`,
  orderReject: (id: number) => `ord:no:${id}`,
} as const;

export const CB_RE = {
  subscription: /^sub:([0-9a-f]{12})$/,
  unlinkAsk: /^ul:([0-9a-f]{12})$/,
  unlinkConfirm: /^ulc:([0-9a-f]{12})$/,
  plan: /^buy:([tm])(\d+)$/,
  customTerm: /^cm:(\d+)$/,
  pay: /^pay:([tm])(\d+):([0-9a-f]{12}|new)$/,
  order: /^ord:(ok|no):(\d+)$/,
} as const;

/** Кнопки отдельных сообщений (уведомления, заявки) — они не становятся панелью. */
export const isDetachedCallback = (data: string): boolean => data.startsWith('n:') || data.startsWith('ord:');
