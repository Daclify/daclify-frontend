import { describe, expect, it } from 'vitest';
import { parseWholeWorkPayments } from '../../src/content/work-payments';

describe('whole-token milestone payments', () => {
  it('converts whole token inputs into exact base units and sums them', () => {
    expect(parseWholeWorkPayments(['10', '25'], 4)).toEqual({
      units: [100000n, 250000n],
      total: 350000n,
    });
  });
  it('rejects blank, zero, fractional, signed, grouped and exponent inputs without rounding', () => {
    for (const value of [
      '',
      '0',
      '-1',
      '+1',
      '1.5',
      '1.0000',
      '1e3',
      '1,000',
      ' 10',
      '10\n20',
      '02',
      '100abc',
    ])
      expect(() => parseWholeWorkPayments([value], 4), value).toThrow();
  });
  it('accepts at most 16 explicitly entered milestone payments', () => {
    expect(
      parseWholeWorkPayments(
        Array.from({ length: 16 }, () => '1'),
        4,
      ).total,
    ).toBe(160000n);
    for (const count of [0, 17])
      expect(() =>
        parseWholeWorkPayments(
          Array.from({ length: count }, () => '1'),
          4,
        ),
      ).toThrow();
  });
  it('rejects both individual and combined totals outside the native asset range', () => {
    expect(parseWholeWorkPayments(['461168601842738'], 4).total).toBe(4611686018427380000n);
    expect(() => parseWholeWorkPayments(['461168601842739'], 4)).toThrow();
    expect(() => parseWholeWorkPayments(['461168601842738', '1'], 4)).toThrow();
  });
  it('preserves totals beyond JavaScript’s safe integer range', () => {
    expect(parseWholeWorkPayments(['9007199254740993', '2'], 0)).toEqual({
      units: [9007199254740993n, 2n],
      total: 9007199254740995n,
    });
  });
});
