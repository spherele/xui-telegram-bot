// Типизированные эндпоинты 3x-ui 3.x. Только транспорт и маппинг — без бизнес-логики.
import { randomBytes, randomUUID } from 'node:crypto';
import type { Client, InboundRef, ServerStatus } from '../../domain/types.js';
import {
  type ClientListItemDto,
  type ClientRecordDto,
  type InboundSlimDto,
  type NodeDto,
  type PanelSettingsDto,
  type ServerStatusDto,
  toClient,
  toInboundRef,
  toMainServer,
  toNodeServer,
  toUpdateBody,
} from './dto.js';
import { XuiError, type XuiHttp } from './http.js';

const enc = encodeURIComponent;

function randStr(n: number): string {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return [...randomBytes(n)].map((b) => abc[b % abc.length]).join('');
}

export interface NewClient {
  email: string;
  tgId: number;
  expiryTime: number;
  totalBytes: number;
  inboundIds: number[];
  limitIp?: number;
  group?: string;
  comment?: string;
}

export interface PanelSettings {
  subUri: string | null;
  title: string | null;
  supportUrl: string | null;
}

export class XuiApi {
  constructor(private readonly http: XuiHttp) {}

  async inbounds(): Promise<InboundRef[]> {
    const list = (await this.http.get<InboundSlimDto[] | null>('/panel/api/inbounds/list/slim')) ?? [];
    return list.map(toInboundRef);
  }

  async clients(inbounds: ReadonlyMap<number, InboundRef>): Promise<Client[]> {
    const list = (await this.http.get<ClientListItemDto[] | null>('/panel/api/clients/list')) ?? [];
    return list.map((c) => toClient(c, inbounds));
  }

  async clientRecord(email: string): Promise<ClientRecordDto> {
    const rec = await this.http.get<ClientRecordDto | null>(`/panel/api/clients/get/${enc(email)}`);
    if (rec?.client.email !== email) throw new XuiError(`Клиент ${email} не найден`);
    return rec;
  }

  /** Меняет поля клиента, сохраняя остальные (сервер заменяет запись целиком). */
  async updateClient(email: string, changes: Record<string, unknown>): Promise<void> {
    const { client } = await this.clientRecord(email);
    await this.http.post(`/panel/api/clients/update/${enc(email)}`, toUpdateBody(client, changes));
  }

  /** Новый клиент; uuid/пароль/subId генерируем сами, остальные секреты — сервер. */
  async addClient(c: NewClient): Promise<{ uuid: string; subId: string }> {
    if (!c.inboundIds.length) throw new XuiError('Нет инбаундов для нового клиента');
    const uuid = randomUUID();
    const subId = randStr(16);
    await this.http.post('/panel/api/clients/add', {
      client: {
        email: c.email,
        id: uuid,
        uuid,
        password: randStr(16),
        subId,
        flow: '',
        totalGB: c.totalBytes,
        expiryTime: c.expiryTime,
        limitIp: c.limitIp ?? 0,
        limitHwid: 0,
        tgId: c.tgId,
        group: c.group ?? '',
        comment: c.comment ?? '',
        enable: true,
      },
      inboundIds: c.inboundIds,
    });
    return { uuid, subId };
  }

  async deleteClient(email: string): Promise<void> {
    await this.http.post(`/panel/api/clients/del/${enc(email)}`);
  }

  async resetTraffic(email: string): Promise<void> {
    await this.http.post(`/panel/api/clients/resetTraffic/${enc(email)}`);
  }

  async onlineCount(): Promise<number | null> {
    const list = await this.http.post<string[] | null>('/panel/api/clients/onlines').catch(() => null);
    return Array.isArray(list) ? list.length : null;
  }

  async mainServer(): Promise<ServerStatus> {
    return toMainServer((await this.http.get<ServerStatusDto | null>('/panel/api/server/status')) ?? {});
  }

  async nodes(): Promise<ServerStatus[]> {
    const list = await this.http.get<NodeDto[] | null>('/panel/api/nodes/list').catch(() => null);
    return (list ?? []).filter((n) => n.enable).map(toNodeServer);
  }

  async settings(): Promise<PanelSettings> {
    const s = (await this.http.post<PanelSettingsDto | null>('/panel/api/setting/all')) ?? {};
    return { subUri: s.subURI || null, title: s.subTitle || null, supportUrl: s.subSupportUrl || null };
  }
}
