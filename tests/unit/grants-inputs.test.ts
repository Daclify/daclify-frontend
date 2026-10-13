import { describe, expect, it } from 'vitest';
import { parseGrantTerms, parseRoundInputs } from '../../src/content/grants-inputs';

const now = Math.floor(new Date('2026-10-12T12:00').getTime() / 1000);
const date = (days: number) => {
  const value = new Date((now + days * 86400) * 1000);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const milestones = [
  { amount: '10', due: date(15) },
  { amount: '25', due: date(25) },
];

describe('grant round and application inputs', () => {
  it('encodes exact whole-token limits and three local deadlines', () => {
    expect(parseRoundInputs('100', date(7), date(14), date(21), 4, now)).toEqual({
      maximum: 1000000n,
      applicationsClose: now + 7 * 86400,
      reviewClose: now + 14 * 86400,
      awardsClose: now + 21 * 86400,
    });
  });
  it('rejects expired, unordered, oversized and malformed round dates', () => {
    for (const values of [
      [date(0), date(14), date(21)],
      [date(7), date(7), date(21)],
      [date(7), date(14), date(10)],
      [date(7), date(14), date(366)],
      ['2026-02-30T12:00', date(14), date(21)],
      ['', date(14), date(21)],
      [date(7), date(14), '2200-01-01T12:00'],
    ])
      expect(() =>
        parseRoundInputs('100', values[0] ?? '', values[1] ?? '', values[2] ?? '', 4, now),
      ).toThrow();
    expect(parseRoundInputs('100', date(7), date(14), date(365), 4, now).awardsClose).toBe(
      now + 365 * 86400,
    );
  });
  it('keeps independently dated milestones and exact aggregate base units', () => {
    expect(parseGrantTerms(milestones, date(10), date(30), 4, 1000000n, now)).toEqual({
      units: [100000n, 250000n],
      total: 350000n,
      dues: [now + 15 * 86400, now + 25 * 86400],
      termStart: now + 10 * 86400,
      termEnd: now + 30 * 86400,
    });
  });
  it('bounds payment totals by the round cap and never rounds legacy fractions', () => {
    for (const amount of ['', '0', '1.5', '1e3', '1,000', '-1', '461168601842739']) {
      expect(() => parseRoundInputs(amount, date(7), date(14), date(21), 4, now)).toThrow();
      expect(() =>
        parseGrantTerms([{ amount, due: date(15) }], date(10), date(30), 4, 1000000n, now),
      ).toThrow();
    }
    expect(() => parseGrantTerms(milestones, date(10), date(30), 4, 349999n, now)).toThrow(
      'funding limit',
    );
    expect(parseGrantTerms(milestones, date(10), date(30), 4, 350000n, now).total).toBe(350000n);
  });
  it('bounds terms, milestone counts and each due date without collapsing dates', () => {
    for (const due of [date(9), date(31), '', '2200-01-01T12:00'])
      expect(() =>
        parseGrantTerms([{ amount: '1', due }], date(10), date(30), 4, 1000000n, now),
      ).toThrow();
    for (const [start, end] of [
      [date(30), date(30)],
      [date(0), date(0)],
      [date(10), date(376)],
    ])
      expect(() => parseGrantTerms(milestones, start ?? '', end ?? '', 4, 1000000n, now)).toThrow();
    for (const count of [0, 17])
      expect(() =>
        parseGrantTerms(
          Array.from({ length: count }, () => milestones[0] ?? { amount: '', due: '' }),
          date(10),
          date(30),
          4,
          1000000n,
          now,
        ),
      ).toThrow();
    expect(
      parseGrantTerms(
        [
          { amount: '1', due: date(10) },
          { amount: '1', due: date(30) },
        ],
        date(10),
        date(30),
        4,
        1000000n,
        now,
      ).dues,
    ).toEqual([now + 10 * 86400, now + 30 * 86400]);
  });
});
