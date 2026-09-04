export type Money = {
  amountMinor: number;
  currency: string;
};

const ISO_4217 = /^[A-Z]{3}$/;

export function money(amountMinor: number, currency: string): Money {
  const normalized = currency.toUpperCase();
  if (!ISO_4217.test(normalized)) {
    throw new Error("currency_invalid");
  }
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error("amount_minor_invalid");
  }
  return { amountMinor, currency: normalized };
}

export function assertIso4217(currency: string): string {
  const normalized = currency.toUpperCase();
  if (!ISO_4217.test(normalized)) {
    throw new Error("currency_invalid");
  }
  return normalized;
}

export function sameMoney(left: Money, right: Money): boolean {
  return left.amountMinor === right.amountMinor && left.currency === right.currency;
}
