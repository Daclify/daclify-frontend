import { describe, expect, it } from 'vitest';
import { MAX_HOSTED_CONTENT_BYTES, contentDomain } from '@daclify/core-protocol';
import {
  preparePublicFile,
  preparePrivateFile,
  openPrivateFile,
  verifyStoredFile,
  decodeStoredBytes,
} from '../../src/content/files.js';
const metadata = { version: 1 as const, filename: 'project-notes.txt', mediaType: 'text/plain' };
const domain = contentDomain(
  { chainId: '11'.repeat(32), contract: 'daclifycore', daoId: '1', interfaceVersion: 1 },
  '8',
  1,
  '1',
);
describe('hosted document files', () => {
  it('keeps public binary bytes unchanged and commits the exact stored file', async () => {
    const input = new Uint8Array([0, 1, 2, 128, 255]);
    const prepared = await preparePublicFile(input, metadata);
    expect(decodeStoredBytes(prepared.content)).toEqual(input);
    expect(JSON.parse(prepared.metadata)).toEqual(metadata);
    await expect(verifyStoredFile(prepared, input)).resolves.toBeUndefined();
    await expect(verifyStoredFile(prepared, new Uint8Array([0, 1, 2, 128, 254]))).rejects.toThrow(
      'DOCUMENT_INTEGRITY',
    );
  });
  it('accepts the full public upload limit', async () => {
    const prepared = await preparePublicFile(new Uint8Array(MAX_HOSTED_CONTENT_BYTES), metadata);
    expect(prepared.bytes).toBe(MAX_HOSTED_CONTENT_BYTES);
  });
  it('rejects empty and oversized files before publication', async () => {
    await expect(preparePublicFile(new Uint8Array(), metadata)).rejects.toThrow('FILE_EMPTY');
    await expect(
      preparePublicFile(new Uint8Array(MAX_HOSTED_CONTENT_BYTES + 1), metadata),
    ).rejects.toThrow('FILE_TOO_LARGE');
  });
  it('encrypts private filenames and bytes and restores the original download', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const input = new TextEncoder().encode('private fixture file contents');
    const prepared = await preparePrivateFile(input, metadata, key, domain);
    const stored = decodeStoredBytes(prepared.content);
    expect(prepared.metadata).toBe('{}');
    expect(new TextDecoder().decode(stored)).not.toContain(metadata.filename);
    expect(new TextDecoder().decode(stored)).not.toContain('private fixture file contents');
    expect(await openPrivateFile(stored, key, domain)).toEqual({ metadata, bytes: input });
  });
  it('applies the stored-byte limit after private envelope expansion', async () => {
    await expect(
      preparePrivateFile(
        new Uint8Array(MAX_HOSTED_CONTENT_BYTES),
        metadata,
        new Uint8Array(32),
        domain,
      ),
    ).rejects.toThrow('FILE_TOO_LARGE');
  });
  it('rejects unsafe download filenames and noncanonical encoded bytes', async () => {
    await expect(
      preparePublicFile(new Uint8Array([1]), { ...metadata, filename: '../notes.txt' }),
    ).rejects.toThrow('FILE_METADATA');
    expect(() => decodeStoredBytes('AB==')).toThrow();
  });
});
