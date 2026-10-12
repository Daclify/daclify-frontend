import type { DaoContent } from '@daclify/core-protocol';
import { z } from 'zod';

const titleFields = z.object({
  title: z.string().optional(),
  name: z.string().optional(),
  filename: z.string().optional(),
  text: z.string().optional(),
});

export function documentLabel(document: DaoContent['documents'][number]) {
  const fallback = `${document.envelope_version === 0 ? 'DAO' : 'Private'} document #${document.document_id}`;
  let name = fallback;
  if (document.envelope_version === 0) {
    try {
      const value = titleFields.parse(JSON.parse(document.metadata));
      name =
        (value.title || value.name || value.filename || value.text || fallback)
          .trim()
          .slice(0, 100) || fallback;
    } catch {
      /* Untitled documents keep a stable reference. */
    }
  }
  return `${name} · version ${document.version}`;
}
