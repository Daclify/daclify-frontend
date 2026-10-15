import { runQuickCrypto } from './crypto';
self.onmessage = (event: MessageEvent<unknown>) => {
  try {
    self.postMessage({
      kind: 'result',
      result: runQuickCrypto(event.data, (progress) => self.postMessage(progress)),
    });
  } catch {
    self.postMessage({ kind: 'error', code: 'QUICK_CRYPTO_FAILED' });
  }
};
