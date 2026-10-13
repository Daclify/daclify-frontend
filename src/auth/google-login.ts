import { z } from 'zod';

type GoogleOptions = {
  client_id: string;
  nonce: string;
  auto_select: false;
  callback: (response: unknown) => void;
};
const GoogleIdentitySchema = z.object({
  accounts: z.object({
    id: z.object({
      initialize: z.custom<(options: GoogleOptions) => void>(
        (value) => typeof value === 'function',
      ),
      renderButton: z.custom<
        (
          host: HTMLElement,
          options: { type: 'standard'; theme: 'outline'; size: 'medium'; width: number },
        ) => void
      >((value) => typeof value === 'function'),
    }),
  }),
});
const CredentialSchema = z.object({ credential: z.string().min(1).max(16384) });

export function mountGoogleButton(
  host: HTMLElement,
  clientId: string,
  onProof: (credential: string, nonce: string) => void,
  onError: (cause: unknown) => void,
): () => void {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, ''),
    script = document.createElement('script');
  let disposed = false;
  const fail = () => {
    if (disposed) return;
    disposed = true;
    script.remove();
    onError(new Error('GOOGLE_SIGN_IN_UNAVAILABLE'));
  };
  const timer = setTimeout(fail, 10000);
  script.async = true;
  script.src = 'https://accounts.google.com/gsi/client';
  script.onerror = () => {
    clearTimeout(timer);
    fail();
  };
  script.onload = () => {
    clearTimeout(timer);
    if (disposed) return;
    try {
      const identity = GoogleIdentitySchema.parse(Reflect.get(window, 'google')).accounts.id;
      identity.initialize({
        client_id: clientId,
        nonce,
        auto_select: false,
        callback: (response) => {
          if (disposed) return;
          try {
            onProof(CredentialSchema.parse(response).credential, nonce);
          } catch (cause) {
            onError(cause);
          }
        },
      });
      identity.renderButton(host, {
        type: 'standard',
        theme: 'outline',
        size: 'medium',
        width: Math.min(320, host.clientWidth),
      });
    } catch {
      fail();
    }
  };
  document.head.append(script);
  return () => {
    disposed = true;
    clearTimeout(timer);
    script.onload = null;
    script.onerror = null;
    script.remove();
    host.replaceChildren();
  };
}
