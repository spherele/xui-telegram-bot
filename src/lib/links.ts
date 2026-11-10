// Извлечение «секретов» клиента из присланного пользователем текста.
//
//   * ссылка подписки  https://host/<subPath>/<subId>  (и json-подписки)
//   * vless://<uuid>@…, trojan://<password>@…, hysteria2://<pw>@…, tuic://<uuid>:<pw>@…
//   * vmess://<base64 json>
//   * ss://<base64(method:password)>@…  и старый формат ss://<base64(всё)>
//   * просто UUID или subId
// Email намеренно НЕ принимается — его легко угадать.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUBID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

function b64decode(data: string): string | null {
  const s = data.trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  const out = Buffer.from(s, 'base64').toString('utf8');
  return out.includes('�') ? null : out;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function ssPassword(userinfo: string): string | null {
  const decoded = b64decode(userinfo) ?? safeDecode(userinfo);
  if (!decoded.includes(':')) return null;
  // method:password  или  2022-method:serverPSK:clientPSK — нужен последний кусок
  return decoded.split(':').pop() || null;
}

function fromToken(token: string): string[] {
  const low = token.toLowerCase();

  if (low.startsWith('vmess://')) {
    const decoded = b64decode(token.slice(8).split('#')[0] ?? '');
    if (!decoded) return [];
    try {
      const { id } = JSON.parse(decoded) as { id?: unknown };
      return typeof id === 'string' && id ? [id] : [];
    } catch {
      return [];
    }
  }

  if (low.startsWith('ss://')) {
    const body = token.slice(5).split('#')[0]?.split('?')[0] ?? '';
    let pw: string | null = null;
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
      const last = new URL(token).pathname.split('/').filter(Boolean).at(-1);
      return last ? [safeDecode(last)] : [];
    } catch {
      return [];
    }
  }

  if (SCHEME_RE.test(token)) {
    // vless://, trojan://, hysteria2://, tuic:// … — userinfo разбираем руками,
    // т.к. URL() по-разному парсит нестандартные схемы.
    const rest = token.slice(token.indexOf('://') + 3);
    const at = rest.lastIndexOf('@', rest.search(/[/?#]|$/));
    if (at <= 0) return [];
    const user = safeDecode(rest.slice(0, at));
    return [user.includes(':') ? (user.split(':')[0] ?? user) : user];
  }

  if (UUID_RE.test(token) || SUBID_RE.test(token)) return [token];
  return [];
}

export function extractSecrets(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\s+/)) {
    const token = raw.replace(/^[<"'`]+|[>"'`]+$/g, '');
    if (!token) continue;
    for (const s of fromToken(token)) if (s && !out.includes(s)) out.push(s);
  }
  return out;
}
