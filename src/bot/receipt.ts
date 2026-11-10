// Проверка присланного чека: только фото, картинка или PDF не больше 10 МБ.
import type { Message } from 'grammy/types';
import type { ReceiptFile } from '../services/shop.js';
import { fmtBytes } from './ui/format.js';

export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
const RECEIPT_MIME = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;
const NOT_A_RECEIPT = [
  'video',
  'animation',
  'video_note',
  'audio',
  'voice',
  'sticker',
  'contact',
  'location',
  'venue',
  'poll',
  'dice',
  'story',
] as const;

export type ReceiptCheck =
  { kind: 'none' } | { kind: 'invalid'; reason: 'type' | 'size' } | { kind: 'ok'; file: ReceiptFile };

export function checkReceipt(m: Message): ReceiptCheck {
  const photo = m.photo?.at(-1);
  if (photo)
    return { kind: 'ok', file: { type: 'photo', fileId: photo.file_id, fileUid: photo.file_unique_id, info: null } };
  if (m.document) {
    const d = m.document;
    if (!RECEIPT_MIME.test(d.mime_type ?? '')) return { kind: 'invalid', reason: 'type' };
    if ((d.file_size ?? 0) > RECEIPT_MAX_BYTES) return { kind: 'invalid', reason: 'size' };
    return {
      kind: 'ok',
      file: {
        type: 'document',
        fileId: d.file_id,
        fileUid: d.file_unique_id,
        info: `${d.file_name ?? 'файл'} · ${fmtBytes(d.file_size ?? 0)}`,
      },
    };
  }
  if (NOT_A_RECEIPT.some((k) => k in m && (m as unknown as Record<string, unknown>)[k]))
    return { kind: 'invalid', reason: 'type' };
  return { kind: 'none' };
}
