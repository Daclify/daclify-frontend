import { describe, expect, it } from 'vitest';
import { encodeDecide, decideAbi } from '@daclify/modules/sdk';
import { ABI, Serializer } from '@wharfkit/antelope';
import {
  durationFromInput,
  durationUntil,
  readableDuration,
  preferredDurationUnit,
  percentageToBasisPoints,
  percentageText,
} from '../../src/content/governance-inputs';

describe('human governance inputs preserve the signed native values', () => {
  it('converts days, fractional hours and weeks without rounding away the chosen duration', () => {
    expect(durationFromInput('3', 'days')).toBe(259200);
    expect(durationFromInput('1.5', 'hours')).toBe(5400);
    expect(durationFromInput('2', 'weeks')).toBe(1209600);
    expect(durationFromInput('1', 'minutes')).toBe(60);
    for (const [value, unit] of [
      ['0', 'days'],
      ['31', 'days'],
      ['1.001', 'minutes'],
      ['', 'hours'],
      ['Infinity', 'hours'],
    ] as const)
      expect(() => durationFromInput(value, unit)).toThrow();
  });
  it('keeps exact percentage precision and enforces the canonical quorum and majority limits', () => {
    expect(percentageToBasisPoints('50', 'quorum')).toBe(5000);
    expect(percentageToBasisPoints('50.01', 'approval')).toBe(5001);
    expect(percentageToBasisPoints('50.03', 'approval')).toBe(5003);
    expect(percentageToBasisPoints('0.01', 'quorum')).toBe(1);
    expect(percentageToBasisPoints('100', 'approval')).toBe(10000);
    for (const value of ['0', '100.01', 'NaN', '50.001', ''])
      expect(() => percentageToBasisPoints(value, 'quorum')).toThrow();
    expect(() => percentageToBasisPoints('50', 'approval')).toThrow();
    expect(percentageText(5001)).toBe('50.01');
  });
  it('formats legacy values using human units without changing their protocol representation', () => {
    expect(preferredDurationUnit(259200)).toBe('days');
    expect(preferredDurationUnit(604800)).toBe('weeks');
    expect(readableDuration(259200)).toBe('3 days');
    expect(readableDuration(5400)).toBe('1.5 hours');
    expect(readableDuration(60)).toBe('1 minute');
    expect(readableDuration(Number.NaN)).toBe('—');
    expect(percentageText(Number.NaN)).toBe('—');
  });
  it('uses the selected deadline at submission time and rejects elapsed or excessive dates', () => {
    expect(durationUntil(100000 + 259200, 100000)).toBe(259200);
    expect(durationUntil(100000 + 259200, 100060)).toBe(259140);
    expect(() => durationUntil(100000, 100000)).toThrow();
    expect(() => durationUntil(100000 + 2592001, 100000)).toThrow();
  });
  it('encodes user percentages and durations as the unchanged canonical ballot action', () => {
    const encoded = encodeDecide('open', {
      runtime: 'daclifycore',
      dao_id: '1',
      member_id: '1',
      ballot_id: '9',
      kind: 0,
      choices: 2,
      duration: durationFromInput('3', 'days'),
      quorum: percentageToBasisPoints('50', 'quorum'),
      approval: percentageToBasisPoints('50.01', 'approval'),
      metadata: '{}',
    });
    const decoded = Serializer.objectify(
      Serializer.decode({ abi: ABI.from(decideAbi), type: 'open', data: encoded }),
    );
    expect(decoded).toMatchObject({ duration: 259200, quorum: 5000, approval: 5001 });
  });
});
