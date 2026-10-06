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
  script.dataset.requestAccess = 'write';
  host.replaceChildren(script);
  return () => {
    Reflect.deleteProperty(window, callback);
    host.replaceChildren();
  };
}
