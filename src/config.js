function req(name) {
  const v = (process.env[name] ?? '').trim();
  if (!v) throw new Error(`Не задана переменная окружения ${name}`);
  return v;
}

function bool(name, def) {
  const v = (process.env[name] ?? '').trim().toLowerCase();
  if (!v) return def;
  return ['1', 'true', 'yes', 'on'].includes(v);
}

function int(name, def) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name]?.trim() ? v : def;
}

/**
 * TARIFFS="1 месяц|30|150;3 месяца|90|400;Год|365|1400|500"
 *          название | дней | цена | ГБ трафика (необязательно, 0/пусто — безлимит)
 */
export function parseTariffs(raw) {
  return (raw ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [name, days, price, gb] = s.split('|').map((x) => x.trim());
      if (!name || !(Number(days) > 0) || !price) throw new Error(`Неверный тариф в TARIFFS: "${s}"`);
      return { name, days: Number(days), price, gb: Number(gb) || 0 };
    });
}

const multiline = (v) => (v ?? '').replace(/\\n/g, '\n').trim();

export function loadConfig() {
  const subUrl = (process.env.SUB_URL ?? '').trim().replace(/\/+$/, '');
  return {
    botToken: req('BOT_TOKEN'),
    panelUrl: req('PANEL_URL').replace(/\/+$/, ''), // https://host:port/<webBasePath>
    // Либо API-токен (рекомендуется), либо логин/пароль администратора.
    apiToken: (process.env.API_TOKEN ?? '').trim() || null,
    panelUsername: process.env.API_TOKEN?.trim() ? process.env.PANEL_USERNAME ?? '' : req('PANEL_USERNAME'),
    panelPassword: process.env.API_TOKEN?.trim() ? process.env.PANEL_PASSWORD ?? '' : req('PANEL_PASSWORD'),
    panel2fa: (process.env.PANEL_2FA_CODE ?? '').trim() || null,
    verifySsl: bool('PANEL_VERIFY_SSL', true),
    subUrl: subUrl || null, // https://host/<subPath>  (без subId); пусто — берём subURI из панели
    adminIds: new Set(
      (process.env.ADMIN_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean).map(Number),
    ),
    tz: process.env.TZ_NAME || 'Europe/Moscow',
    notify: {
      enabled: bool('NOTIFY_ENABLED', true),
      days: int('NOTIFY_DAYS', 3),
      trafficPercent: int('NOTIFY_TRAFFIC_PERCENT', 90),
      intervalMin: int('NOTIFY_INTERVAL_MIN', 60),
    },
    dataDir: process.env.DATA_DIR || 'data',
    title: (process.env.BOT_TITLE ?? '').trim() || null, // пусто — subTitle из панели
    supportUrl: (process.env.SUPPORT_URL ?? '').trim() || null, // пусто — subSupportUrl из панели
    serverName: (process.env.SERVER_NAME ?? '').trim() || 'Основной сервер',
    // NODE_NAMES="germany=🇩🇪 Германия;relay=🇳🇱 Нидерланды" — по remark/имени ноды,
    // или просто "🇩🇪 Германия;🇳🇱 Нидерланды" — по порядку нод в панели.
    nodeNames: Object.fromEntries(
      (process.env.NODE_NAMES ?? '')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s, i) => (s.includes('=') ? s.split('=').map((x) => x.trim()) : [`#${i}`, s])),
    ),
    shop: {
      tariffs: parseTariffs(process.env.TARIFFS),
      currency: (process.env.CURRENCY ?? '').trim() || '₽',
      paymentDetails: multiline(process.env.PAYMENT_DETAILS),
      // id инбаундов для новых клиентов через запятую; пусто — все включённые
      inboundIds: (process.env.NEW_CLIENT_INBOUNDS ?? '').split(',').map((s) => Number(s.trim())).filter((n) => n > 0),
      limitIp: int('NEW_CLIENT_LIMIT_IP', 0),
      group: (process.env.NEW_CLIENT_GROUP ?? '').trim(),
    },
  };
}
