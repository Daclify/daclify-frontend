import { describe, expect, it } from 'vitest';
import { telegramWidgetProof, telegramMiniAppProof } from '../../src/auth/telegram-login';
describe('Telegram website login proof', () => {
  it('uses the numeric id and omits empty profile fields', () => {
    const proof = new URLSearchParams(
      telegramWidgetProof({
        id: 4242,
        first_name: 'Ada',
        auth_date: 1_700_000_000,
        hash: 'ab'.repeat(32),
      }),
    );
    expect(proof.get('id')).toBe('4242');
    expect(proof.get('first_name')).toBe('Ada');
    expect(proof.get('username')).toBeNull();
    expect(proof.getAll('hash')).toHaveLength(1);
  });
});

it('reads bounded untrusted Mini App proof without treating profile data as authentication', () => {
  const proof = 'user=%7B%22id%22%3A123%7D&hash=untrusted';
  expect(telegramMiniAppProof({ Telegram: { WebApp: { initData: proof } } }, '')).toBe(proof);
  expect(telegramMiniAppProof({}, '#' + new URLSearchParams({ tgWebAppData: proof }))).toBe(proof);
  expect(
    telegramMiniAppProof({ Telegram: { WebApp: { initData: 'profile-only' } } }, ''),
  ).toBeUndefined();
  expect(
    telegramMiniAppProof({ Telegram: { WebApp: { initData: 'a'.repeat(16385) } } }, ''),
  ).toBeUndefined();
});
