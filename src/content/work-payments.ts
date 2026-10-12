import { parseUnits } from '@daclify/core-protocol';

// Antelope asset::max_amount also bounds the Works project total.
const maximumAssetUnits = (1n << 62n) - 1n;

export function parseWholeWorkPayments(amounts: string[], precision: number) {
  if (!amounts.length || amounts.length > 16) throw new Error('Add between 1 and 16 milestones.');
  const units = amounts.map((amount) => {
    if (!/^[1-9][0-9]*$/.test(amount))
      throw new Error('Enter a positive whole amount, such as 10.');
    const value = parseUnits(amount, precision);
    if (value > maximumAssetUnits) throw new Error('This payment exceeds the token payment limit.');
    return value;
  });
  const total = units.reduce((sum, value) => sum + value, 0n);
  if (total > maximumAssetUnits)
    throw new Error('The combined milestone payments exceed the token payment limit.');
  return { units, total };
}
