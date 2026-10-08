export function hostedCheckoutUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'checkout.stripe.com' ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error('CHECKOUT_URL');
  }
  return url.toString();
}

export function formatReceiptAmount(currency: string | null, amountMinor: number | null): string {
  if (currency === 'usd' && amountMinor !== null) {
    const digits = String(amountMinor).padStart(3, '0');
    return `USD ${digits.slice(0, -2)}.${digits.slice(-2)}`;
  }
  if (currency && amountMinor !== null) return `${amountMinor} ${currency}`;
  return 'Amount pending';
}
