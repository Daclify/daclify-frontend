import { z } from 'zod';

const TelegramWidgetUserSchema = z.object({
  id: z.number().int().positive(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.number().int(),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});

export function telegramWidgetProof(value: unknown): string {
  const user = TelegramWidgetUserSchema.parse(value);
  const fields = new URLSearchParams();
  fields.set('auth_date', String(user.auth_date));
  if (user.first_name) fields.set('first_name', user.first_name);
  fields.set('hash', user.hash);
  fields.set('id', String(user.id));
  if (user.last_name) fields.set('last_name', user.last_name);
  if (user.photo_url) fields.set('photo_url', user.photo_url);
  if (user.username) fields.set('username', user.username);
  return fields.toString();
}

export function mountTelegramWidget(
  host: HTMLElement,
  username: string,
  onProof: (proof: string) => void,
): () => void {
  const callback = `daclifyTelegramAuth${Math.random().toString(36).slice(2)}`;
  Reflect.set(window, callback, (user: unknown) => {
    onProof(telegramWidgetProof(user));
  });
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://telegram.org/js/telegram-widget.js?22';
  script.dataset.telegramLogin = username;
  script.dataset.size = 'medium';
  script.dataset.onauth = `${callback}(user)`;
  host.replaceChildren(script);
  return () => {
    Reflect.deleteProperty(window, callback);
    host.replaceChildren();
  };
}
export function telegramMiniAppProof(host: unknown, fragment: string): string | undefined {
  let proof: unknown;
  if (typeof host === 'object' && host !== null && 'Telegram' in host) {
    const telegram = host.Telegram;
    if (typeof telegram === 'object' && telegram !== null && 'WebApp' in telegram) {
      const app = telegram.WebApp;
      if (typeof app === 'object' && app !== null && 'initData' in app) proof = app.initData;
    }
  }
  if (proof === undefined)
    proof = new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : fragment).get(
      'tgWebAppData',
    );
  if (typeof proof !== 'string' || proof.length === 0 || proof.length > 16384) return;
  const fields = new URLSearchParams(proof);
  if (!fields.has('user') || !fields.has('hash')) return;
  return proof; // Untrusted launch data. Only the backend verifies bot HMAC/freshness.
}
