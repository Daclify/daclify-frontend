import { z } from 'zod';
import {
  QuickCryptoInputSchema,
  QuickCryptoOutputSchema,
  QuickCryptoProgressSchema,
} from './crypto';
const messageSchema = z.discriminatedUnion('kind', [
  QuickCryptoProgressSchema,
  z.strictObject({ kind: z.literal('result'), result: QuickCryptoOutputSchema }),
  z.strictObject({ kind: z.literal('error'), code: z.literal('QUICK_CRYPTO_FAILED') }),
]);
export function quickCrypto(
  value: unknown,
  signal: AbortSignal,
  onProgress: (progress: z.infer<typeof QuickCryptoProgressSchema>) => void = () => {},
) {
  const input = QuickCryptoInputSchema.parse(value);
  return new Promise<z.infer<typeof QuickCryptoOutputSchema>>((resolve, reject) => {
    if (signal.aborted) {
      reject(Error('QUICK_CANCELLED'));
      return;
    }
    const worker = new Worker(new URL('./crypto.worker.ts', import.meta.url), { type: 'module' });
    function stop() {
      worker.terminate();
      signal.removeEventListener('abort', abort);
    }
    function abort() {
      stop();
      reject(Error('QUICK_CANCELLED'));
    }
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => {
      stop();
      reject(Error('QUICK_CRYPTO_FAILED'));
    };
    worker.onmessage = (event: MessageEvent<unknown>) => {
      const message = messageSchema.safeParse(event.data);
      if (!message.success) {
        stop();
        reject(Error('QUICK_CRYPTO_FAILED'));
        return;
      }
      if (message.data.kind === 'progress') {
        onProgress(message.data);
        return;
      }
      stop();
      if (message.data.kind === 'error') reject(Error(message.data.code));
      else resolve(message.data.result);
    };
    worker.postMessage(input);
  });
}
