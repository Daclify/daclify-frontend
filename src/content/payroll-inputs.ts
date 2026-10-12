import { maximumAssetUnits, parseWholeTokenAmount } from './token-payments';

export function parsePayrollInputs(
  amount: string,
  periods: number,
  intervalDays: number,
  firstDueUtc: string,
  precision: number,
  now: number,
) {
  const quantity = parseWholeTokenAmount(amount, precision);
  if (!Number.isInteger(periods) || periods < 1 || periods > 12)
    throw new Error('Choose between 1 and 12 installments.');
  if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 31)
    throw new Error('Choose between 1 and 31 whole days between payments.');
  const total = quantity * BigInt(periods);
  if (total > maximumAssetUnits)
    throw new Error('The payroll total exceeds the token payment limit.');
  const starts = Math.floor(Date.parse(`${firstDueUtc}Z`) / 1000);
  if (!Number.isSafeInteger(starts) || starts <= now || starts > now + 2678400)
    throw new Error('Choose a future first payment within the next 31 days (UTC).');
  const interval = intervalDays * 86400;
  if (starts + interval * (periods - 1) > 0xffffffff)
    throw new Error('The final installment exceeds the supported date range.');
  return { quantity, total, interval, starts };
}
