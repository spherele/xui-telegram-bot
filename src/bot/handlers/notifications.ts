// Кнопки отдельных сообщений-уведомлений: «Открыть меню» / «Закрыть».
import { CB } from '../callbacks.js';
import type { HandlerDeps, PrivateComposer } from './types.js';
import { ignoreError } from '../../lib/async.js';

export function registerNotifications(pm: PrivateComposer, { nav, panels }: HandlerDeps): void {
  pm.callbackQuery(CB.notifyClose, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(ignoreError);
  });

  pm.callbackQuery(CB.notifyOpen, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(ignoreError);
    await panels.show(ctx.from.id, () => nav.home(ctx.from.id), { forceNew: true });
  });
}
