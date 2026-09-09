/** Parse a dollars string into integer cents. No floats. */
export function dollarsToCents(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const dollars = Number(match[1]);
  const cents = Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isInteger(dollars) || !Number.isInteger(cents)) return null;
  return dollars * 100 + cents;
}
