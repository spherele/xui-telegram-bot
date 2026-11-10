// Навигация по меню: /start и кнопки панели.
import { CB, CB_RE, isDetachedCallback } from '../callbacks.js';
import type { View } from '../panel.js';
import { group, type HandlerDeps, type PrivateComposer } from './types.js';
import { ignoreError } from '../../lib/async.js';

type Build = (uid: number, match: string | RegExpMatchArray | undefined) => Promise<View> | View;

export function registerMenu(pm: PrivateComposer, { nav, panels }: HandlerDeps): void {
  pm.command(['start', 'menu'], async (ctx) => {
    await ctx.deleteMessage().catch(ignoreError);
    // /start — пересоздаём панель внизу чата
    await panels.show(ctx.from.id, () => nav.home(ctx.from.id, { fresh: true }), { forceNew: true });
  });

  // Любая кнопка панели: сообщение с ней становится текущей панелью (самовосстановление после рестарта).
  pm.on('callback_query:data', async (ctx, next) => {
    if (isDetachedCallback(ctx.callbackQuery.data)) return next();
    await ctx.answerCallbackQuery().catch(ignoreError);
    const msg = ctx.callbackQuery.message;
    if (msg) await panels.withLock(ctx.from.id, () => panels.adopt(ctx.from.id, msg));
    await next();
  });

  const button = (trigger: string | RegExp, build: Build) =>
    pm.callbackQuery(trigger, (ctx) => panels.show(ctx.from.id, () => build(ctx.from.id, ctx.match)));

  button(CB.home, (uid) => nav.home(uid));
  button(CB.refresh, (uid) => nav.home(uid, { fresh: true }));
  button(CB.have, () => nav.linkHelp());
  button(CB.addAccount, () => nav.linkHelp());
  button(CB.status, () => nav.serviceStatus());
  button(CB.statusRefresh, () => nav.serviceStatus(true));
  button(CB.unlinkList, (uid) => nav.unlinkList(uid));
  button(CB_RE.subscription, (uid, m) => nav.subscription(uid, group(m, 1)));
  button(CB_RE.unlinkAsk, (uid, m) => nav.unlinkConfirm(uid, group(m, 1)));
  button(CB_RE.unlinkConfirm, (uid, m) => nav.unlink(uid, group(m, 1)));

  // магазин
  button(CB.tariffs, () => nav.tariffs());
  button(CB_RE.tariff, (uid, m) => nav.chooseTarget(uid, Number(group(m, 1))));
  button(CB_RE.pay, (uid, m) => nav.pay(uid, Number(group(m, 1)), group(m, 2) === 'new' ? null : group(m, 2)));
  button(CB.payCancel, (uid) => nav.cancelPayment(uid));
}
