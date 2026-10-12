import { describe, expect, it } from 'vitest';
import { parsePayrollInputs } from '../../src/content/payroll-inputs';

const now = 1800000000;
const starts = new Date((now + 60) * 1000).toISOString().slice(0, 19);

describe('payroll input limits and exact totals', () => {
  it('converts whole-token installments and days into exact contract values', () => {
    expect(parsePayrollInputs('10', 2, 30, starts, 4, now)).toEqual({
      quantity: 100000n,
      total: 200000n,
      interval: 2592000,
      starts: now + 60,
    });
  });
  it('rejects ambiguous amounts, fractional terms and overflow without rounding', () => {
    for (const amount of ['', '0', '-1', '1.5', '1.0000', '1e3', '1,000', ' 1'])
      expect(() => parsePayrollInputs(amount, 2, 30, starts, 4, now)).toThrow();
    for (const periods of [0, 1.5, 13, NaN])
      expect(() => parsePayrollInputs('1', periods, 30, starts, 4, now)).toThrow();
    for (const days of [0, 1.5, 32, NaN])
      expect(() => parsePayrollInputs('1', 2, days, starts, 4, now)).toThrow();
    expect(() => parsePayrollInputs('461168601842738', 2, 30, starts, 4, now)).toThrow();
    expect(parsePayrollInputs('9007199254740993', 2, 30, starts, 0, now).total).toBe(
      18014398509481986n,
    );
  });
  it('bounds the first due date and final installment to the native schedule range', () => {
    for (const date of [
      '',
      'invalid',
      new Date((now - 1) * 1000).toISOString().slice(0, 19),
      new Date((now + 2678401) * 1000).toISOString().slice(0, 19),
    ])
      expect(() => parsePayrollInputs('1', 2, 30, date, 4, now)).toThrow();
    const nearLimit = 0xffffffff - 100;
    const date = new Date((nearLimit + 60) * 1000).toISOString().slice(0, 19);
    expect(() => parsePayrollInputs('1', 2, 1, date, 4, nearLimit)).toThrow();
    expect(parsePayrollInputs('1', 1, 1, date, 4, nearLimit).starts).toBe(nearLimit + 60);
  });
});
