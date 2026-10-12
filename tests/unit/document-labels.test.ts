import { describe, expect, it } from 'vitest';
import { DaoContentSchema } from '@daclify/core-protocol';
import { documentLabel } from '../../src/content/document-labels';

const document = DaoContentSchema.shape.documents.element.parse({
  id: '12',
  document_id: '42',
  version: 2,
  author: '1',
  cid: '',
  metadata: JSON.stringify({ title: 'Work proposal' }),
  commitment: 'ab'.repeat(32),
  bytes: 32,
  envelope_version: 0,
  key_epoch: '0',
});

describe('published document labels', () => {
  it('keeps the chosen version visible with public titles, files and text', () => {
    expect(documentLabel(document)).toBe('Work proposal · version 2');
    for (const field of ['name', 'filename', 'text'])
      expect(
        documentLabel({ ...document, metadata: JSON.stringify({ [field]: 'Readable proposal' }) }),
      ).toBe('Readable proposal · version 2');
  });
  it('never uses an encrypted document’s untrusted title as a public label', () => {
    expect(documentLabel({ ...document, envelope_version: 1 })).toBe(
      'Private document #42 · version 2',
    );
  });
  it('keeps a stable reference for malformed and untitled metadata', () => {
    for (const metadata of ['broken JSON', 'null', '{}', '{"title":"  "}', '{"title":7}'])
      expect(documentLabel({ ...document, metadata })).toBe('DAO document #42 · version 2');
  });
  it('bounds long public previews', () => {
    expect(
      documentLabel({ ...document, metadata: JSON.stringify({ text: 'x'.repeat(200) }) }),
    ).toBe(`${'x'.repeat(100)} · version 2`);
  });
});
