// Извлечение «секретов» клиента из присланного пользователем текста.
//
//   * ссылка подписки  https://host:2096/sub/<subId>  (и json-подписки)
//   * vless://<uuid>@…, trojan://<password>@…, hysteria2://<pw>@…, tuic://<uuid>:<pw>@…
//   * vmess://<base64 json>
//   * ss://<base64(method:password)>@…  и старый формат ss://<base64(всё)>
//   * просто UUID или subId
// Email намеренно НЕ принимается — его легко угадать.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUBID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

function b64decode(data) {
  try {
    const s = data.trim().replace(/-/g, '+').replace(/_/g, '/');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
    const out = Buffer.from(s, 'base64').toString('utf8');
    return out.includes('�') ? null : out;
  } catch {
    return null;
  }
}

const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

function ssPassword(userinfo) {
  const decoded = b64decode(userinfo) ?? safeDecode(userinfo);
  if (!decoded.includes(':')) return null;
  // method:password  или  2022-method:serverPSK:clientPSK — нужен последний кусок
  return decoded.split(':').pop() || null;
}

function fromToken(token) {
  const low = token.toLowerCase();

  if (low.startsWith('vmess://')) {
    const decoded = b64decode(token.slice(8).split('#')[0]);
    if (!decoded) return [];
    try {
      const id = JSON.parse(decoded).id;
      return id ? [String(id)] : [];
    } catch {
      return [];
    }
  }

  if (low.startsWith('ss://')) {
    const body = token.slice(5).split('#')[0].split('?')[0];
    let pw = null;
    if (body.includes('@')) {
      pw = ssPassword(body.slice(0, body.lastIndexOf('@')));
    } else {
      const decoded = b64decode(body); // ss://base64(method:password@host:port)
      if (decoded?.includes('@')) pw = ssPassword(decoded.slice(0, decoded.lastIndexOf('@')));
    }
    return pw ? [pw] : [];
  }

  if (low.startsWith('http://') || low.startsWith('https://')) {
    try {
      const parts = new URL(token).pathname.split('/').filter(Boolean);
      return parts.length ? [safeDecode(parts.at(-1))] : [];
    } catch {
      return [];
    }
  }

  if (SCHEME_RE.test(token)) {
    // vless://, trojan://, hysteria2://, tuic:// …  — берём userinfo руками,
    // т.к. URL() по-разному парсит нестандартные схемы.
    const rest = token.slice(token.indexOf('://') + 3);
    const at = rest.lastIndexOf('@', rest.search(/[/?#]|$/));
    if (at <= 0) return [];
    const user = safeDecode(rest.slice(0, at));
    return [user.includes(':') ? user.split(':')[0] : user];
  }

  if (UUID_RE.test(token) || SUBID_RE.test(token)) return [token];
  return [];
}

export function extractSecrets(text) {
  const out = [];
  for (const raw of text.split(/\s+/)) {
    const token = raw.replace(/^[<"'`]+|[>"'`]+$/g, '');
    if (!token) continue;
    for (const s of fromToken(token)) if (s && !out.includes(s)) out.push(s);
  }
  return out;
}
