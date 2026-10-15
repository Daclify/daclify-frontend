import { z } from 'zod';
const keySchema = z.custom<CryptoKey>(
  (value) =>
    value instanceof CryptoKey &&
    value.type === 'secret' &&
    !value.extractable &&
    value.algorithm.name === 'AES-GCM' &&
    value.usages.includes('encrypt') &&
    value.usages.includes('decrypt'),
);
export async function receiptDeviceKey(
  scope: string,
  create: boolean,
): Promise<CryptoKey | undefined> {
  z.string().min(1).max(512).parse(scope);
  const candidate = create
    ? await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
        'encrypt',
        'decrypt',
      ])
    : undefined;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open('daclify-quick-receipts', 1),
      timer = setTimeout(() => {
        settled = true;
        reject(Error('QUICK_RECEIPT_STORAGE'));
      }, 3000);
    request.onupgradeneeded = () => request.result.createObjectStore('keys');
    request.onerror = () => {
      clearTimeout(timer);
      settled = true;
      reject(Error('QUICK_RECEIPT_STORAGE'));
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      if (settled) request.result.close();
      else {
        settled = true;
        resolve(request.result);
      }
    };
  });
  try {
    return await new Promise<CryptoKey | undefined>((resolve, reject) => {
      const transaction = db.transaction('keys', create ? 'readwrite' : 'readonly'),
        store = transaction.objectStore('keys'),
        request = store.get(scope);
      let key: CryptoKey | undefined;
      request.onsuccess = () => {
        try {
          if (request.result !== undefined) key = keySchema.parse(request.result);
          else if (candidate) {
            key = candidate;
            store.put(candidate, scope);
          }
        } catch {
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve(key);
      transaction.onabort = transaction.onerror = () => reject(Error('QUICK_RECEIPT_STORAGE'));
    });
  } finally {
    db.close();
  }
}
