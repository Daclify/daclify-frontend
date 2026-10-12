export function newDocumentId(existing: readonly { document_id: string }[]): string {
  const used = new Set(existing.map((row) => row.document_id));
  for (let attempt = 0; attempt < 8; attempt++) {
    const words = crypto.getRandomValues(new Uint32Array(2));
    const id = (BigInt(words[0] ?? 0) << 32n) | BigInt(words[1] ?? 0);
    if (id > 0n && !used.has(id.toString())) return id.toString();
  }
  throw new Error('DOCUMENT_ID_UNAVAILABLE');
}
