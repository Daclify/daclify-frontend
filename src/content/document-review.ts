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
import { LEGAL_DOCUMENT_MAX_BYTES } from './legal-templates/render';

export type ReviewedDocument = { text: string; markdown?: string; file?: { bytes: Uint8Array; metadata: FileMetadata } };
function reviewFile(file: NonNullable<ReviewedDocument['file']>, previewMarkdown: boolean): ReviewedDocument {
  if (!previewMarkdown || file.metadata.mediaType !== 'text/markdown')
    return { text: 'The verified file is ready. Download and review it before accepting.', file };
  if (file.bytes.length > LEGAL_DOCUMENT_MAX_BYTES) throw new Error('DOCUMENT_TEXT_SIZE');
  let markdown: string;
  try { markdown = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes); }
  catch { throw new Error('DOCUMENT_TEXT_ENCODING'); }
  return { text: markdown, markdown, file };
}

export async function readDocumentForReview(
  dao: DaoRef,
  memberId: string | undefined,
  document: DaoContent['documents'][number],
  records: DaoContent,
  options: { previewMarkdown?: boolean } = {},
): Promise<ReviewedDocument> {
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
    return reviewFile(opened, options.previewMarkdown !== false);
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
  return reviewFile({ bytes: stored, metadata }, options.previewMarkdown !== false);
}
