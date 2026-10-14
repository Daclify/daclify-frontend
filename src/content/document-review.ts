import {
  daoPaymentKey,
  FileMetadataSchema,
  type DaoContent,
  type DaoRef,
} from '@daclify/core-protocol';
import { decryptDaoFile, decryptDaoJson } from '../auth/session';
import { sha256Hex } from '../auth/vault';
import { api } from '../api/client';
import { decodeStoredBytes, verifyStoredFile, type FileMetadata } from './files';

export async function readDocumentForReview(
  dao: DaoRef,
  memberId: string | undefined,
  document: DaoContent['documents'][number],
  records: DaoContent,
): Promise<{ text: string; file?: { bytes: Uint8Array; metadata: FileMetadata } }> {
  if (daoPaymentKey(dao) !== daoPaymentKey(records.dao)) throw new Error('DAO_REFERENCE');
  if (document.envelope_version === 1 && !memberId) throw new Error('EPOCH_UNAVAILABLE');
  if (!document.cid) {
    if (document.envelope_version === 1) {
      if (!memberId) throw new Error('EPOCH_UNAVAILABLE');
      return { text: await decryptDaoJson(dao, memberId, document, records) };
    }
    if ((await sha256Hex(new TextEncoder().encode(document.metadata))) !== document.commitment)
      throw new Error('DOCUMENT_INTEGRITY');
    return { text: document.metadata };
  }
  const stored = decodeStoredBytes(
    (await api.documentBytes(dao.daoId, document.document_id, document.version)).content,
  );
  await verifyStoredFile(document, stored);
  if (document.envelope_version === 1) {
    if (!memberId) throw new Error('EPOCH_UNAVAILABLE');
    const opened = await decryptDaoFile(dao, memberId, document, records, stored);
    return {
      text: 'The verified file is ready. Download and review it before accepting.',
      file: opened,
    };
  }
  const metadata = FileMetadataSchema.parse(
    document.metadata === '{}'
      ? {
          version: 1,
          filename: `document-${document.document_id}-v${document.version}.bin`,
          mediaType: 'application/octet-stream',
        }
      : JSON.parse(document.metadata),
  );
  return {
    text: 'The verified file is ready. Download and review it before accepting.',
    file: { bytes: stored, metadata },
  };
}
