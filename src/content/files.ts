import { z } from 'zod';
import {
  MAX_HOSTED_CONTENT_BYTES,
  HostedBytesSchema,
  HostedUploadSchema,
  FileMetadataSchema,
  PrivateFilePayloadSchema,
  ContentEnvelopeSchema,
} from '@daclify/core-protocol';
import { sealContent, openContent, sha256Hex } from '../auth/vault';

export type FileMetadata = z.infer<typeof FileMetadataSchema>;
const PreparedFileSchema = HostedUploadSchema.pick({
  content: true,
  metadata: true,
  bytes: true,
  commitment: true,
  envelopeVersion: true,
});
export type PreparedFile = z.infer<typeof PreparedFileSchema>;
export function encodeStoredBytes(value: Uint8Array): string {
  let binary = '';
  for (let start = 0; start < value.length; start += 0x8000)
    binary += String.fromCharCode(...value.subarray(start, start + 0x8000));
  return btoa(binary);
}
export function decodeStoredBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(HostedBytesSchema.parse(value)), (character) =>
    character.charCodeAt(0),
  );
}
function checkSize(value: Uint8Array): void {
  if (!value.length) throw new Error('FILE_EMPTY');
  if (value.length > MAX_HOSTED_CONTENT_BYTES) throw new Error('FILE_TOO_LARGE');
}
function fileMetadata(input: unknown): FileMetadata {
  const parsed = FileMetadataSchema.safeParse(input);
  if (!parsed.success) throw new Error('FILE_METADATA');
  return parsed.data;
}
async function prepare(
  bytes: Uint8Array,
  metadata: string,
  envelopeVersion: 0 | 1,
): Promise<PreparedFile> {
  checkSize(bytes);
  return PreparedFileSchema.parse({
    content: encodeStoredBytes(bytes),
    metadata,
    bytes: bytes.length,
    commitment: await sha256Hex(bytes),
    envelopeVersion,
  });
}
export async function preparePublicFile(
  bytes: Uint8Array,
  metadata: unknown,
): Promise<PreparedFile> {
  checkSize(bytes);
  return prepare(bytes, JSON.stringify(fileMetadata(metadata)), 0);
}
export async function preparePrivateFile(
  bytes: Uint8Array,
  metadata: unknown,
  key: Uint8Array,
  domain: string,
): Promise<PreparedFile> {
  checkSize(bytes);
  const payload = PrivateFilePayloadSchema.parse({
    ...fileMetadata(metadata),
    content: encodeStoredBytes(bytes),
  });
  const stored = new TextEncoder().encode(
    JSON.stringify(
      await sealContent(new TextEncoder().encode(JSON.stringify(payload)), key, domain),
    ),
  );
  return prepare(stored, '{}', 1);
}
export async function verifyStoredFile(
  document: Pick<PreparedFile, 'bytes' | 'commitment'>,
  bytes: Uint8Array,
): Promise<void> {
  if (
    bytes.length !== document.bytes ||
    bytes.length > MAX_HOSTED_CONTENT_BYTES ||
    (await sha256Hex(bytes)) !== document.commitment
  )
    throw new Error('DOCUMENT_INTEGRITY');
}
export async function openPrivateFile(
  stored: Uint8Array,
  key: Uint8Array,
  domain: string,
): Promise<{ metadata: FileMetadata; bytes: Uint8Array }> {
  checkSize(stored);
  const envelope = ContentEnvelopeSchema.parse(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stored)),
  );
  const payload = PrivateFilePayloadSchema.parse(
    JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(await openContent(envelope, key, domain)),
    ),
  );
  return {
    metadata: FileMetadataSchema.parse({
      version: payload.version,
      filename: payload.filename,
      mediaType: payload.mediaType,
    }),
    bytes: decodeStoredBytes(payload.content),
  };
}
export function downloadFile(bytes: Uint8Array, metadata: FileMetadata): void {
  const safe = fileMetadata(metadata);
  const url = URL.createObjectURL(
    new Blob([Uint8Array.from(bytes).buffer], { type: 'application/octet-stream' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safe.filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
