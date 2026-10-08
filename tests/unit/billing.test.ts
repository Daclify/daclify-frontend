import { describe, expect, it } from 'vitest';
import { formatReceiptAmount, hostedCheckoutUrl } from '../../src/api/billing';
import { ApiFailure, friendlyError } from '../../src/api/client';

describe('card checkout display', () => {
  it('accepts only a hosted Stripe address and formats a recorded receipt', () => {
    expect(hostedCheckoutUrl('https://checkout.stripe.com/c/pay/cs_test_fixture')).toBe(
      'https://checkout.stripe.com/c/pay/cs_test_fixture',
    );
    expect(() => hostedCheckoutUrl('https://example.com/pay')).toThrow('CHECKOUT_URL');
    expect(() => hostedCheckoutUrl('http://checkout.stripe.com/c/pay/cs_test_fixture')).toThrow(
      'CHECKOUT_URL',
    );
    expect(() => hostedCheckoutUrl('https://checkout.stripe.com.evil.example/pay')).toThrow(
      'CHECKOUT_URL',
    );
    for (const value of [
      'https://name:password@checkout.stripe.com/pay',
      'https://checkout.stripe.com:444/pay',
    ])
      expect(() => hostedCheckoutUrl(value)).toThrow('CHECKOUT_URL');
    expect(formatReceiptAmount('usd', 1000)).toBe('USD 10.00');
    expect(formatReceiptAmount('usd', 0)).toBe('USD 0.00');
    expect(formatReceiptAmount('usd', 5)).toBe('USD 0.05');
    expect(formatReceiptAmount('eur', 1000)).toBe('1000 eur');
    expect(formatReceiptAmount('usd', null)).toBe('Amount pending');
    expect(formatReceiptAmount(null, 1000)).toBe('Amount pending');
    expect(formatReceiptAmount(null, null)).toBe('Amount pending');
  });

  it('explains a missing card service without treating the return page as payment', () => {
    expect(friendlyError(new ApiFailure('STRIPE_NOT_CONFIGURED'))).toBe(
      'Card payments are not configured on this service.',
    );
    expect(friendlyError(new ApiFailure('CHECKOUT_URL'))).toBe(
      'The card checkout address was not accepted.',
    );
    expect(friendlyError(new Error('CHECKOUT_URL'))).toBe(
      'The card checkout address was not accepted.',
    );
    expect(friendlyError(new ApiFailure('UNMAPPED'))).toBe(
      'The service could not complete the request.',
    );
  });
});
