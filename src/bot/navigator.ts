// Контроллеры экранов: сервис → экран. Ловят ошибки панели и показывают их одинаково.
import type { Client, Plan, TelegramId } from '../domain/types.js';
import type { AccountService } from '../services/accounts.js';
import type { StatusService } from '../services/status.js';
import { hashKey } from './callbacks.js';
import type { View } from './panel.js';
import * as admin from './screens/admin.js';
import { errorView, type Ui } from './screens/common.js';
import { homeView } from './screens/home.js';
import * as shop from './screens/shop.js';
import { statusErrorView, statusView } from './screens/status.js';
import * as sub from './screens/subscription.js';
import { esc } from './ui/format.js';

export interface HomeOptions {
  notice?: string;
  fresh?: boolean;
}

export class Navigator {
  constructor(
    private readonly ui: Ui,
    private readonly accounts: AccountService,
    private readonly status: StatusService,
  ) {}

  /** Любая ошибка панели → экран «сервис недоступен» вместо падения. */
  private async safe(build: () => Promise<View>, notice?: string): Promise<View> {
    try {
      return await build();
    } catch (e) {
      console.error('3x-ui:', e);
      return errorView(notice);
    }
  }

  private async own(uid: TelegramId, hash: string): Promise<Client | null> {
    return (await this.accounts.mine(uid)).find((c) => hashKey(c.email) === hash) ?? null;
  }

  // ---------- главное ----------

  home(uid: TelegramId, { notice, fresh = false }: HomeOptions = {}): Promise<View> {
    return this.safe(async () => homeView(this.ui, await this.accounts.mine(uid, fresh), notice), notice);
  }

  async serviceStatus(fresh = false): Promise<View> {
    try {
      const { serverName, nodeNames, tz } = this.ui.config;
      return statusView(await this.status.get(fresh), { serverName, nodeNames, tz });
    } catch (e) {
      console.error('status:', (e as Error).message);
      return statusErrorView();
    }
  }

  // ---------- подписка ----------

  linkHelp(): View {
    return sub.linkHelpView();
  }

  link(uid: TelegramId, text: string): Promise<View> {
    return this.safe(async () => {
      const r = await this.accounts.link(uid, text);
      return this.home(uid, { notice: sub.linkNotice(r), fresh: r.kind === 'linked' });
    });
  }

  subscription(uid: TelegramId, hash: string): Promise<View> {
    return this.safe(async () => {
      const c = await this.own(uid, hash);
      if (!c?.subId || !this.ui.config.subUrl) return this.home(uid, { notice: '🤷 Подписка не найдена.' });
      return sub.subscriptionView(this.ui.config.subUrl, c);
    });
  }

  unlinkList(uid: TelegramId): Promise<View> {
    return this.safe(async () => {
      const own = await this.accounts.mine(uid);
      return own.length ? sub.unlinkListView(own) : homeView(this.ui, own);
    });
  }

  unlinkConfirm(uid: TelegramId, hash: string): Promise<View> {
    return this.safe(async () => {
      const c = await this.own(uid, hash);
      return c ? sub.unlinkConfirmView(c) : this.home(uid);
    });
  }

  unlink(uid: TelegramId, hash: string): Promise<View> {
    return this.safe(async () => {
      const c = await this.own(uid, hash);
      if (!c) return this.home(uid);
      await this.accounts.unlink(uid, c.email);
      return this.home(uid, { notice: `✅ Аккаунт <b>${esc(c.email)}</b> отвязан.`, fresh: true });
    });
  }

  // ---------- магазин ----------

  tariffs(notice?: string): View {
    return shop.tariffsView(this.ui, notice);
  }

  customTerm(months: number): View {
    return shop.customTermView(this.ui, months);
  }

  chooseTarget(uid: TelegramId, plan: Plan): Promise<View> {
    return this.safe(async () => {
      const own = await this.accounts.mine(uid);
      return own.length ? shop.chooseTargetView(this.ui, plan, own) : this.pay(uid, plan, null);
    });
  }

  /** targetHash — хэш email продлеваемой подписки; null — новая. */
  pay(uid: TelegramId, plan: Plan, targetHash: string | null): Promise<View> {
    return this.safe(async () => {
      const target = targetHash ? await this.own(uid, targetHash) : null;
      if (targetHash && !target) return this.tariffs('🤷 Подписка для продления не найдена.');
      const r = await this.ui.shop.startPayment(uid, plan, target?.email ?? null);
      switch (r.kind) {
        case 'ok':
          return shop.paymentView(this.ui, r.pending);
        case 'waiting':
          return this.home(uid, { notice: shop.waitingNotice(r.order) });
        case 'target_not_found':
          return this.tariffs('🤷 Подписка для продления не найдена.');
        case 'unavailable':
          return this.tariffs();
      }
    });
  }

  toggleWhitelist(uid: TelegramId): View {
    const p = this.ui.shop.toggleWhitelist(uid);
    return p ? shop.paymentView(this.ui, p) : this.tariffs('⏳ Время на оплату вышло — выберите тариф заново.');
  }

  cancelPayment(uid: TelegramId): Promise<View> {
    this.ui.shop.cancel(uid);
    return this.home(uid, { notice: 'Оплата отменена.' });
  }

  // ---------- админ ----------

  async adminCommand(cmd: string, args: string[]): Promise<View> {
    try {
      switch (cmd) {
        case 'stats':
          return admin.statsView(await this.accounts.stats(), this.ui.shop.allOrders());
        case 'orders':
          return admin.openOrdersView(this.ui, this.ui.shop.openOrders());
        case 'find': {
          const q = args.join(' ');
          return q
            ? admin.findView(await this.accounts.find(q))
            : admin.usageView('/find <email | tg id | часть email>');
        }
        case 'link': {
          const [email, tg] = args;
          if (!email || !/^\d+$/.test(tg ?? '')) return admin.usageView('/link <email> <tg_id>');
          const r = await this.accounts.adminSetTg(email, Number(tg));
          return r.kind === 'ok' ? admin.linkedView(r.client) : admin.clientNotFoundView();
        }
        case 'unlink': {
          const [email] = args;
          if (!email) return admin.usageView('/unlink <email>');
          const r = await this.accounts.adminSetTg(email, 0);
          return r.kind === 'ok' ? admin.unlinkedView(r.client) : admin.clientNotFoundView();
        }
        default:
          return admin.usageView('/stats | /orders | /find | /link | /unlink');
      }
    } catch (e) {
      return admin.adminErrorView(e as Error);
    }
  }
}
