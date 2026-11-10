// Все callback_data в одном месте: построители и шаблоны для разбора.
// Email в callback_data не кладём (лимит 64 байта и лишняя утечка) — только короткий хэш.
import { createHash } from 'node:crypto';

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
  tariff: (index: number) => `buy:${index}`,
  pay: (index: number, email: string | null) => `pay:${index}:${email ? hashKey(email) : 'new'}`,
  orderApprove: (id: number) => `ord:ok:${id}`,
  orderReject: (id: number) => `ord:no:${id}`,
} as const;

export const CB_RE = {
  subscription: /^sub:([0-9a-f]{12})$/,
  unlinkAsk: /^ul:([0-9a-f]{12})$/,
  unlinkConfirm: /^ulc:([0-9a-f]{12})$/,
  tariff: /^buy:(\d+)$/,
  pay: /^pay:(\d+):([0-9a-f]{12}|new)$/,
  order: /^ord:(ok|no):(\d+)$/,
} as const;

/** Кнопки отдельных сообщений (уведомления, заявки) — они не становятся панелью. */
export const isDetachedCallback = (data: string): boolean => data.startsWith('n:') || data.startsWith('ord:');
