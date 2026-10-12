import { parseUnits } from '@daclify/core-protocol';
import { DecideConfigSchema } from '@daclify/modules';

export const durationUnits = {
  minutes: 60,
  hours: 3600,
  days: 86400,
  weeks: 604800,
} as const;
export type DurationUnit = keyof typeof durationUnits;

export function preferredDurationUnit(seconds: number): DurationUnit {
  return seconds >= durationUnits.weeks
    ? 'weeks'
    : seconds >= durationUnits.days
      ? 'days'
      : seconds >= durationUnits.hours
        ? 'hours'
        : 'minutes';
}
export function durationFromInput(value: string, unit: DurationUnit): number {
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) throw new Error('Enter a valid duration.');
  const seconds = Number(value) * durationUnits[unit];
  const whole = Math.round(seconds);
  if (!Number.isFinite(seconds) || Math.abs(seconds - whole) > 1e-7)
    throw new Error('Choose a duration that resolves to a whole second.');
  return DecideConfigSchema.shape.duration.parse(whole);
}
export function durationUntil(closes: number, now: number): number {
  return DecideConfigSchema.shape.duration.parse(closes - now);
}
export function readableDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  const unit = preferredDurationUnit(seconds),
    value = seconds / durationUnits[unit];
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)} ${value === 1 ? unit.slice(0, -1) : unit}`;
}
export function percentageToBasisPoints(value: string, kind: 'quorum' | 'approval'): number {
  const points = Number(parseUnits(value, 2));
  return (
    kind === 'quorum'
      ? DecideConfigSchema.shape.quorumBasisPoints
      : DecideConfigSchema.shape.approvalBasisPoints
  ).parse(points);
}
export function percentageText(points: number): string {
  return Number.isFinite(points) ? String(points / 100) : '—';
}
