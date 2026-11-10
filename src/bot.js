import { createHash } from 'node:crypto';
import { Bot, InlineKeyboard } from 'grammy';
import QRCode from 'qrcode';
import { extractSecrets } from './links.js';
import { accountLabel, DAY_MS, esc, fmtAccount, fmtExpiry, groupAccounts, isActive } from './format.js';
import { Panels } from './panel.js';
import { fmtServiceStatus } from './status.js';
import { XUIError } from './xui.js';

const h = (key) => createHash('sha1').update(key).digest('hex').slice(0, 12);

const LINK_HELP_TEXT =
  '🔑 <b>Привязка подписки</b>\n\n' +
  'Пришлите сюда <b>одно</b> из:\n' +
  '• ссылку подписки — <code>https://…</code>\n' +
  '• ключ — <code>vless://…</code>, <code>vmess://…</code>, <code>trojan://…</code>, <code>ss://…</code>\n\n' +
  'Её можно скопировать в вашем VPN-приложении. Сообщение со ссылкой я сразу удалю.';

// Защита от перебора: не более 5 неудачных попыток за 10 минут.
const FAIL_LIMIT = 5;
const FAIL_WINDOW_MS = 10 * 60_000;
// Выбранный тариф ждёт чек не дольше суток.
const PENDING_TTL_MS = DAY_MS;

/** t.me/@name → t.me/name, @name → https://t.me/name */
export function normalizeTgUrl(url) {
  if (!url) return null;
  if (/^@\w+$/.test(url)) return `https://t.me/${url.slice(1)}`;
  return url.replace(/(t\.me\/)@/i, '$1');
}

export function createBot({ config, xui, store }) {
  const bot = new Bot(config.botToken);
  const panels = new Panels(bot.api, store);
  const isAdmin = (id) => config.adminIds.has(id);
  const fails = new Map();
  const shop = config.shop ?? { tariffs: [] };
  const shopEnabled = () => shop.tariffs.length > 0 && !!shop.paymentDetails && config.adminIds.size > 0;
  const supportUrl = () => normalizeTgUrl(config.supportUrl);
  const price = (t) => `${t.price} ${shop.currency}`;

  const tooManyFails = (uid) => {
    const now = Date.now();
    const list = (fails.get(uid) ?? []).filter((t) => now - t < FAIL_WINDOW_MS);
    fails.set(uid, list);
    return list.length >= FAIL_LIMIT;
  };
  const addFail = (uid) => fails.set(uid, [...(fails.get(uid) ?? []), Date.now()]);

  const backKb = (to = 'home') => new InlineKeyboard().text('« Назад', to);
  const withNotice = (notice, text) => (notice ? `${notice}\n\n${text}` : text);
  const addSupport = (kb) => {
    const url = supportUrl();
    if (url) kb.url('💬 Поддержка', url);
    return kb;
  };

  const errorView = (e, notice) => {
    console.error('3x-ui:', e);
    return {
      text: withNotice(notice, '⚠️ Панель сейчас недоступна, попробуйте чуть позже.'),
      keyboard: new InlineKeyboard().text('🔄 Повторить', 'home:r'),
    };
  };

  // ---------- главное меню ----------

  function welcomeView(notice) {
    const title = config.title ? ` в <b>${esc(config.title)}</b>` : '';
    const kb = new InlineKeyboard();
    if (shopEnabled()) kb.text('💳 Купить подписку', 'buy').row();
    kb.text('🔑 У меня уже есть подписка', 'have').row();
    kb.text('📡 Статус сервиса', 'status');
    addSupport(kb);
    return {
      text: withNotice(
        notice,
        `👋 <b>Добро пожаловать${title}!</b>\n\n` +
          '🔐 Быстрый и стабильный VPN для телефона, компьютера и ТВ — подключение по одной ссылке.\n\n' +
          (shopEnabled()
            ? '• Нет подписки — нажмите «Купить подписку».\n• Уже пользуетесь — привяжите её, чтобы видеть трафик, срок и получать напоминания.'
            : 'Уже пользуетесь — привяжите подписку, чтобы видеть трафик, срок и получать напоминания.'),
      ),
      keyboard: kb,
    };
  }

  async function homeView(uid, { notice, fresh = false } = {}) {
    let clients;
    try {
      clients = await xui.byTgId(uid, fresh);
    } catch (e) {
      return errorView(e, notice);
    }
    const groups = groupAccounts(clients);
    if (!groups.size) return welcomeView(notice);

    const kb = new InlineKeyboard();
    const parts = [];
    for (const [key, list] of groups) {
      parts.push(fmtAccount(list, config.tz));
      if (config.subUrl && list.some((c) => c.subId)) {
        kb.text(groups.size > 1 ? `🔗 ${accountLabel(list)}` : '🔗 Подписка и QR-код', `sub:${h(key)}`).row();
      }
    }
    if (shopEnabled()) kb.text('💳 Продлить / купить', 'buy').row();
    kb.text('🔄 Обновить', 'home:r').text('📡 Статус', 'status').row();
    kb.text('➕ Ещё аккаунт', 'add').text('🔓 Отвязать', 'ul').row();
    addSupport(kb);
    return { text: withNotice(notice, parts.join('\n\n— — — — —\n\n')), keyboard: kb };
  }

  async function statusView({ fresh = false } = {}) {
    try {
      if (fresh) xui.statusTs = 0;
      const st = await xui.serviceStatus();
      return {
        text: fmtServiceStatus(st, { serverName: config.serverName, nodeNames: config.nodeNames, tz: config.tz }),
        keyboard: new InlineKeyboard().text('🔄 Обновить', 'status:r').text('« Назад', 'home'),
      };
    } catch (e) {
      console.error('status:', e.message);
      return { text: '📡 <b>Статус сервиса</b>\n\n⚠️ Не удалось получить статус, попробуйте позже.', keyboard: backKb() };
    }
  }

  // ---------- подписка / отвязка / привязка ----------

  async function findOwnGroup(uid, hash) {
    const groups = groupAccounts(await xui.byTgId(uid));
    for (const [key, list] of groups) if (h(key) === hash) return list;
    return null;
  }

  async function subView(uid, hash) {
    let list;
    try {
      list = await findOwnGroup(uid, hash);
    } catch (e) {
      return errorView(e);
    }
    const subId = list?.find((c) => c.subId)?.subId;
    if (!list || !subId || !config.subUrl) return homeView(uid, { notice: '🤷 Подписка не найдена.' });
    const url = `${config.subUrl.replace(/\/+$/, '')}/${subId}`;
    const photo = await QRCode.toBuffer(url, { width: 512, margin: 2, errorCorrectionLevel: 'M' });
    return {
      photo,
      text:
        `🔗 <b>${esc(accountLabel(list))}</b>\n\n<code>${esc(url)}</code>\n\n` +
        'Нажмите на ссылку, чтобы скопировать, и добавьте её в приложение как подписку ' +
        '(Happ, Hiddify, v2rayNG, v2RayTun, Streisand…) — или отсканируйте QR-код.',
      keyboard: backKb(),
    };
  }

  async function unlinkListView(uid) {
    let groups;
    try {
      groups = groupAccounts(await xui.byTgId(uid));
    } catch (e) {
      return errorView(e);
    }
    if (!groups.size) return homeView(uid);
    const kb = new InlineKeyboard();
    for (const [key, list] of groups) kb.text(`🔓 ${accountLabel(list)}`, `ul:${h(key)}`).row();
    kb.text('« Назад', 'home');
    return { text: '🔓 <b>Какой аккаунт отвязать от Telegram?</b>', keyboard: kb };
  }

  async function unlinkConfirmView(uid, hash) {
    const list = await findOwnGroup(uid, hash).catch(() => null);
    if (!list) return homeView(uid);
    return {
      text:
        `Отвязать <b>${esc(accountLabel(list))}</b>?\n\n` +
        'VPN продолжит работать, но статус и уведомления здесь больше не будут приходить.',
      keyboard: new InlineKeyboard().text('✅ Да, отвязать', `ulc:${hash}`).text('Отмена', 'home'),
    };
  }

  async function doUnlink(uid, hash) {
    try {
      const list = await findOwnGroup(uid, hash);
      if (!list) return homeView(uid);
      for (const c of list) await xui.setTgId(c, 0);
      return homeView(uid, { notice: `✅ Аккаунт <b>${esc(accountLabel(list))}</b> отвязан.`, fresh: true });
    } catch (e) {
      return errorView(e);
    }
  }

  async function linkView(uid, text) {
    const secrets = extractSecrets(text);
    if (!secrets.length) {
      return homeView(uid, {
        notice: '🤔 Не похоже на ссылку подписки или ключ. Пришлите <code>https://…</code> или <code>vless://…</code>.',
      });
    }
    if (tooManyFails(uid)) return homeView(uid, { notice: '⏳ Слишком много попыток. Подождите 10 минут.' });
    try {
      const found = await xui.findBySecrets(secrets);
      if (!found.length) {
        addFail(uid);
        return homeView(uid, { notice: '❌ Такой аккаунт не найден. Проверьте ссылку или напишите в поддержку.' });
      }
      if (found.some((c) => c.tgId && c.tgId !== uid)) {
        return homeView(uid, { notice: '⛔ Этот аккаунт уже привязан к другому Telegram. Напишите в поддержку.' });
      }
      const toLink = found.filter((c) => c.tgId !== uid);
      if (!toLink.length) return homeView(uid, { notice: 'ℹ️ Этот аккаунт уже привязан к вам.' });
      for (const c of toLink) await xui.setTgId(c, uid);
      return homeView(uid, { notice: `✅ Аккаунт <b>${esc(accountLabel(found))}</b> привязан!`, fresh: true });
    } catch (e) {
      return errorView(e);
    }
  }

  // ---------- покупка: тариф → реквизиты → чек → подтверждение админом ----------

  const tariffLine = (t) =>
    `<b>${esc(t.name)}</b> — ${esc(price(t))}\n     ${t.days} дн., ${t.gb ? `${t.gb} ГБ трафика` : 'безлимитный трафик'}`;

  function tariffsView(notice) {
    if (!shopEnabled()) {
      return { text: withNotice(notice, '💳 Покупка сейчас недоступна — напишите в поддержку.'), keyboard: addSupport(backKb()) };
    }
    const kb = new InlineKeyboard();
    shop.tariffs.forEach((t, i) => kb.text(`${t.name} — ${price(t)}`, `buy:${i}`).row());
    kb.text('« Назад', 'home');
    return {
      text: withNotice(notice, `💳 <b>Тарифы</b>\n\n${shop.tariffs.map((t) => `• ${tariffLine(t)}`).join('\n\n')}\n\nВыберите тариф:`),
      keyboard: kb,
    };
  }

  async function buyView(uid, i) {
    const t = shop.tariffs[i];
    if (!t || !shopEnabled()) return tariffsView();
    let own = [];
    try {
      own = await xui.byTgId(uid);
    } catch (e) {
      return errorView(e);
    }
    if (!own.length) return payView(uid, i, 'new');
    const kb = new InlineKeyboard();
    for (const c of own) kb.text(`🔄 Продлить ${c.email}`, `pay:${i}:${h(c.email)}`).row();
    kb.text('🆕 Новая подписка', `pay:${i}:new`).row().text('« Назад', 'buy');
    return { text: `💳 <b>${esc(t.name)}</b> — ${esc(price(t))}\n\nЧто оплачиваем?`, keyboard: kb };
  }

  function paymentText(p, notice) {
    const action = p.target ? `🔄 Продление <b>${esc(p.target)}</b>` : '🆕 Новая подписка';
    return withNotice(
      notice,
      `💳 <b>Оплата: ${esc(p.tariff.name)}</b>\n${action}\n\n` +
        `Сумма к оплате: <b>${esc(price(p.tariff))}</b>\n\n` +
        `<b>Реквизиты для перевода:</b>\n${esc(shop.paymentDetails)}\n\n` +
        '📸 После перевода пришлите сюда <b>скриншот или фото чека</b>. ' +
        'Администратор проверит оплату, и подписка активируется автоматически — я пришлю уведомление.',
    );
  }

  const payKb = () => addSupport(new InlineKeyboard().text('❌ Отмена', 'paycancel'));

  async function payView(uid, i, targetHash) {
    const tariff = shop.tariffs[i];
    if (!tariff || !shopEnabled()) return tariffsView();
    let target = null;
    if (targetHash !== 'new') {
      const own = await xui.byTgId(uid).catch(() => []);
      target = own.find((c) => h(c.email) === targetHash)?.email;
      if (!target) return tariffsView('🤷 Подписка для продления не найдена.');
    }
    const p = { tariff, target, at: Date.now() };
    store.setPending(uid, p);
    return { text: paymentText(p), keyboard: payKb() };
  }

  const activePending = (uid) => {
    const p = store.getPending(uid);
    return p && Date.now() - p.at < PENDING_TTL_MS ? p : null;
  };

  function orderCaption(o) {
    const who = `<a href="tg://user?id=${o.uid}">${esc(o.name || 'пользователь')}</a>`;
    return (
      `🧾 <b>Заявка №${o.id}</b>\n\n` +
      `👤 ${who}${o.username ? ` @${esc(o.username)}` : ''} · <code>${o.uid}</code>\n` +
      `💳 ${esc(o.tariff.name)} — <b>${esc(price(o.tariff))}</b>\n` +
      `🎯 ${o.target ? `Продление <code>${esc(o.target)}</code>` : 'Новая подписка'}`
    );
  }

  async function submitReceipt(ctx, p, file) {
    const uid = ctx.from.id;
    const order = store.newOrder({
      uid,
      name: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '),
      username: ctx.from.username ?? null,
      tariff: p.tariff,
      target: p.target,
    });
    const caption = orderCaption(order);
    const kb = new InlineKeyboard().text('✅ Подтвердить', `ord:ok:${order.id}`).text('❌ Отклонить', `ord:no:${order.id}`);
    const adminMsgs = [];
    for (const admin of config.adminIds) {
      try {
        const opts = { caption, parse_mode: 'HTML', reply_markup: kb };
        const m =
          file.type === 'photo'
            ? await bot.api.sendPhoto(admin, file.id, opts)
            : await bot.api.sendDocument(admin, file.id, opts);
        adminMsgs.push({ chat: admin, id: m.message_id });
      } catch (e) {
        console.warn(`Заявка №${order.id} → админ ${admin}:`, e.description ?? e.message);
      }
    }
    if (!adminMsgs.length) {
      store.updateOrder(order.id, { status: 'failed' });
      return { text: paymentText(p, '⚠️ Не удалось передать чек администратору. Напишите, пожалуйста, в поддержку.'), keyboard: payKb() };
    }
    store.updateOrder(order.id, { caption, adminMsgs });
    store.setPending(uid, null);
    return homeView(uid, {
      notice:
        `🧾 <b>Заявка №${order.id} отправлена!</b>\n` +
        'Как только администратор проверит оплату, подписка активируется — я пришлю уведомление.',
    });
  }

  async function uniqueEmail(o) {
    const all = await xui.listClients(true);
    const taken = new Set(all.map((c) => c.email.toLowerCase()));
    const base = (o.username ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '') || `tg${o.uid}`;
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }

  /** Создаёт или продлевает клиента по оплаченной заявке. */
  async function fulfill(o) {
    const days = o.tariff.days * DAY_MS;
    const totalBytes = o.tariff.gb ? o.tariff.gb * 1024 ** 3 : 0;
    const now = Date.now();
    if (!o.target) {
      const email = await uniqueEmail(o);
      const inboundIds = shop.inboundIds?.length ? shop.inboundIds : await xui.enabledInboundIds();
      const expiryTime = now + days;
      await xui.addClient({
        email,
        tgId: o.uid,
        expiryTime,
        totalBytes,
        inboundIds,
        limitIp: shop.limitIp ?? 0,
        group: shop.group ?? '',
        comment: `Telegram, заявка №${o.id}`,
      });
      return { email, expiryTime };
    }
    const [c] = await xui.findByEmail(o.target);
    if (!c) throw new XUIError(`Клиент ${o.target} не найден`);
    const changes = { enable: true };
    if (c.expiryTime > 0) changes.expiryTime = Math.max(c.expiryTime, now) + days;
    else if (c.expiryTime < 0) changes.expiryTime = c.expiryTime - days; // срок ещё не начался — добавляем дни
    if (totalBytes) changes.totalGB = totalBytes;
    await xui.updateClient(c.email, changes);
    if (totalBytes) await xui.resetTraffic(c.email);
    return { email: c.email, expiryTime: changes.expiryTime ?? c.expiryTime };
  }

  async function finishOrder(o, statusLine) {
    for (const m of o.adminMsgs ?? []) {
      await bot.api
        .editMessageCaption(m.chat, m.id, { caption: `${o.caption}\n\n${statusLine}`, parse_mode: 'HTML' })
        .catch(() => {});
    }
  }

  const notifyKb = () => new InlineKeyboard().text('📊 Открыть меню', 'n:open').text('✖ Закрыть', 'n:close');

  async function decideOrder(ctx, approve, id) {
    const admin = ctx.from;
    if (!isAdmin(admin.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа' });
    const o = store.getOrder(id);
    if (!o) return ctx.answerCallbackQuery({ text: 'Заявка не найдена' });
    if (o.status !== 'pending') return ctx.answerCallbackQuery({ text: `Заявка уже обработана (${o.status})` });
    store.updateOrder(id, { status: 'processing' });
    await ctx.answerCallbackQuery({ text: approve ? 'Активирую подписку…' : 'Отклоняю…' });
    const by = esc(admin.username ? `@${admin.username}` : admin.first_name);

    if (!approve) {
      store.updateOrder(id, { status: 'rejected', decidedBy: admin.id, decidedAt: Date.now() });
      await finishOrder(o, `❌ Отклонено — ${by}`);
      const kb = addSupport(new InlineKeyboard()).text('✖ Закрыть', 'n:close');
      await bot.api
        .sendMessage(
          o.uid,
          `❌ <b>Оплата по заявке №${o.id} не подтверждена.</b>\n\nЕсли перевод прошёл, напишите в поддержку — разберёмся.`,
          { parse_mode: 'HTML', reply_markup: kb },
        )
        .catch(() => {});
      return;
    }

    try {
      const res = await fulfill(o);
      store.updateOrder(id, { status: 'done', email: res.email, decidedBy: admin.id, decidedAt: Date.now() });
      await finishOrder(o, `✅ Подтверждено — ${by}\n→ <code>${esc(res.email)}</code>, ${fmtExpiry(res.expiryTime, config.tz)}`);
      await bot.api
        .sendMessage(
          o.uid,
          `✅ <b>Оплата подтверждена!</b> (заявка №${o.id})\n\n` +
            `Подписка <b>${esc(res.email)}</b>: ${fmtExpiry(res.expiryTime, config.tz)}\n\n` +
            'Откройте меню, чтобы получить ссылку и QR-код для подключения.',
          { parse_mode: 'HTML', reply_markup: notifyKb() },
        )
        .catch((e) => console.warn(`Уведомление ${o.uid}:`, e.description ?? e.message));
      // обновим панель пользователя, чтобы там не висело «заявка отправлена»
      await panels
        .withLock(o.uid, async () => {
          if (store.getPanel(o.uid)) await panels.render(o.uid, await homeView(o.uid, { fresh: true }));
        })
        .catch(() => {});
    } catch (e) {
      console.error(`Заявка №${id}:`, e);
      store.updateOrder(id, { status: 'pending' });
      await bot.api.sendMessage(admin.id, `⚠️ Заявка №${id}: не удалось активировать — ${esc(e.message)}\nКнопки в заявке снова активны.`, {
        parse_mode: 'HTML',
      });
    }
  }

  // ---------- админ-команды ----------

  const fmtRow = (c) =>
    `${isActive(c) ? '🟢' : '🔴'} <code>${esc(c.email)}</code> · ` + (c.tgId ? `tg <code>${c.tgId}</code>` : 'не привязан');

  async function adminView(cmd, args) {
    const kb = new InlineKeyboard().text('« Меню', 'home');
    const out = (text) => ({ text, keyboard: kb });
    try {
      switch (cmd) {
        case 'stats': {
          const all = await xui.listClients(true);
          const users = new Set(all.filter((c) => c.tgId).map((c) => c.tgId));
          const orders = Object.values(store.data?.orders ?? {});
          return out(
            `📈 <b>Статистика</b>\n\nКлиентов в панели: ${all.length}\n` +
              `Привязано к Telegram: ${all.filter((c) => c.tgId).length} (пользователей: ${users.size})\n` +
              `Активных: ${all.filter((c) => isActive(c)).length}\n\n` +
              `Заявок: ${orders.length}, ждут проверки: ${orders.filter((o) => o.status === 'pending').length}, ` +
              `оплачено: ${orders.filter((o) => o.status === 'done').length}`,
          );
        }
        case 'find': {
          const q = args.join(' ').trim().toLowerCase();
          if (!q) return out('Использование: <code>/find &lt;email | tg id | часть email&gt;</code>');
          const all = await xui.listClients(true);
          const res = /^\d+$/.test(q)
            ? all.filter((c) => String(c.tgId) === q)
            : all.filter((c) => c.email.toLowerCase().includes(q));
          if (!res.length) return out('Ничего не найдено.');
          const rows = res.slice(0, 30).map(fmtRow).join('\n');
          return out(`🔎 Найдено: ${res.length}\n\n${rows}${res.length > 30 ? '\n…' : ''}`);
        }
        case 'link': {
          const [email, tg] = args;
          if (!email || !/^\d+$/.test(tg ?? '')) return out('Использование: <code>/link &lt;email&gt; &lt;tg_id&gt;</code>');
          const list = await xui.findByEmail(email);
          if (!list.length) return out('Клиент с таким email не найден.');
          for (const c of list) await xui.setTgId(c, Number(tg));
          return out(`✅ Привязано к <code>${tg}</code>:\n\n${list.map(fmtRow).join('\n')}`);
        }
        case 'unlink': {
          const [email] = args;
          if (!email) return out('Использование: <code>/unlink &lt;email&gt;</code>');
          const list = await xui.findByEmail(email);
          if (!list.length) return out('Клиент с таким email не найден.');
          for (const c of list) await xui.setTgId(c, 0);
          return out(`✅ Отвязано:\n\n${list.map(fmtRow).join('\n')}`);
        }
        case 'orders': {
          const pending = Object.values(store.data?.orders ?? {}).filter((o) => o.status === 'pending');
          if (!pending.length) return out('🧾 Заявок, ожидающих проверки, нет.');
          return out(
            `🧾 <b>Ждут проверки: ${pending.length}</b>\n\n` +
              pending
                .slice(-20)
                .map((o) => `№${o.id} · ${esc(o.name)} · ${esc(o.tariff.name)} — ${esc(price(o.tariff))}`)
                .join('\n') +
              '\n\nПодтвердить или отклонить — кнопками в сообщении с чеком.',
          );
        }
      }
    } catch (e) {
      return out(`⚠️ ${esc(e.message)}`);
    }
  }

  // ---------- обработчики ----------

  const pm = bot.chatType('private');
  const dropMessage = (ctx) => ctx.deleteMessage().catch(() => {});
  const show = (uid, view, opts) => panels.withLock(uid, async () => panels.render(uid, await view(), opts));

  pm.command(['start', 'menu'], async (ctx) => {
    await dropMessage(ctx);
    // /start — пересоздаём панель внизу чата
    await show(ctx.from.id, () => homeView(ctx.from.id, { fresh: true }), { forceNew: true });
  });

  pm.command(['stats', 'find', 'link', 'unlink', 'orders'], async (ctx) => {
    await dropMessage(ctx);
    const uid = ctx.from.id;
    if (!isAdmin(uid)) return show(uid, () => homeView(uid));
    const args = ctx.match.split(/\s+/).filter(Boolean);
    const cmd = ctx.message.text.slice(1).split(/[\s@]/)[0];
    await show(uid, () => adminView(cmd, args));
  });

  pm.on('message', async (ctx) => {
    const uid = ctx.from.id;
    const m = ctx.message;
    const pending = activePending(uid);
    const file = m.photo
      ? { type: 'photo', id: m.photo.at(-1).file_id }
      : m.document
        ? { type: 'document', id: m.document.file_id }
        : null;

    if (pending && file) {
      // сначала передаём чек админам, потом удаляем сообщение
      await panels.withLock(uid, async () => panels.render(uid, await submitReceipt(ctx, pending, file)));
      return dropMessage(ctx);
    }

    await dropMessage(ctx);
    const text = m.text ?? m.caption ?? '';
    await show(uid, async () => {
      if (pending && !extractSecrets(text).length) {
        return { text: paymentText(pending, '📸 Пришлите, пожалуйста, <b>скриншот или фото чека</b>.'), keyboard: payKb() };
      }
      if (file) return homeView(uid, { notice: '🤔 Не знаю, что сделать с этим файлом. Чек можно прислать после выбора тарифа.' });
      return text ? linkView(uid, text) : homeView(uid);
    });
  });

  // Отдельные сообщения (уведомления, заявки) — не панель, их не «усыновляем».
  pm.callbackQuery('n:close', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => {});
  });
  pm.callbackQuery('n:open', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => {});
    await show(ctx.from.id, () => homeView(ctx.from.id), { forceNew: true });
  });
  pm.callbackQuery(/^ord:(ok|no):(\d+)$/, (ctx) => decideOrder(ctx, ctx.match[1] === 'ok', Number(ctx.match[2])));

  // Любая другая кнопка: сообщение с ней становится текущей панелью.
  pm.on('callback_query:data', async (ctx, next) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const msg = ctx.callbackQuery.message;
    if (msg) await panels.withLock(ctx.from.id, () => panels.adopt(ctx.from.id, msg));
    await next();
  });

  const onButton = (trigger, makeView) =>
    pm.callbackQuery(trigger, (ctx) => show(ctx.from.id, () => makeView(ctx.from.id, ctx.match)));

  onButton('home', (uid) => homeView(uid));
  onButton('home:r', (uid) => homeView(uid, { fresh: true }));
  onButton('have', () => ({ text: LINK_HELP_TEXT, keyboard: backKb() }));
  onButton('add', () => ({ text: LINK_HELP_TEXT, keyboard: backKb() }));
  onButton('status', () => statusView());
  onButton('status:r', () => statusView({ fresh: true }));
  onButton('ul', (uid) => unlinkListView(uid));
  onButton(/^sub:(\w+)$/, (uid, m) => subView(uid, m[1]));
  onButton(/^ul:(\w+)$/, (uid, m) => unlinkConfirmView(uid, m[1]));
  onButton(/^ulc:(\w+)$/, (uid, m) => doUnlink(uid, m[1]));
  onButton('buy', () => tariffsView());
  onButton(/^buy:(\d+)$/, (uid, m) => buyView(uid, Number(m[1])));
  onButton(/^pay:(\d+):(\w+)$/, (uid, m) => payView(uid, Number(m[1]), m[2]));
  onButton('paycancel', (uid) => {
    store.setPending(uid, null);
    return homeView(uid, { notice: 'Оплата отменена.' });
  });

  bot.catch((err) => console.error('Ошибка обработки апдейта:', err.error ?? err));

  return { bot, panels };
}
