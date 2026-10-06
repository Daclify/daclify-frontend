import { describe, expect, it } from 'vitest';
import { telegramWidgetProof } from '../../src/auth/telegram-login';
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
