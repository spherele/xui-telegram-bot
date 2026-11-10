// Админ-команды и решения по заявкам.
import { CB_RE } from '../callbacks.js';
import { group, type HandlerDeps, type PrivateComposer } from './types.js';
import { ignoreError } from '../../lib/async.js';

export const ADMIN_COMMANDS = ['stats', 'find', 'link', 'unlink', 'orders'] as const;

export function registerAdmin(pm: PrivateComposer, { ui, nav, panels, orders }: HandlerDeps): void {
  pm.command([...ADMIN_COMMANDS], async (ctx) => {
    await ctx.deleteMessage().catch(ignoreError);
    const uid = ctx.from.id;
    if (!ui.config.adminIds.has(uid)) return panels.show(uid, () => nav.home(uid));
    const cmd = ctx.message.text.slice(1).split(/[\s@]/)[0] ?? '';
    const args = ctx.match.split(/\s+/).filter(Boolean);
    await panels.show(uid, () => nav.adminCommand(cmd, args));
  });

  pm.callbackQuery(CB_RE.order, async (ctx) => {
    const feedback = await orders.decide(ctx.from, Number(group(ctx.match, 2)), group(ctx.match, 1) === 'ok');
    await ctx.answerCallbackQuery(feedback ? { text: feedback } : {}).catch(ignoreError);
  });
}
