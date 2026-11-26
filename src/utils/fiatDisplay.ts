/** The symbol a currency is written with in the user's language ($, €, ₺), or its code when the runtime has none. */
export function fiatSymbol(currencyId: string, language: string): string {
  try {
    const part = new Intl.NumberFormat(language, { style: 'currency', currency: currencyId, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0)
      .find((p) => p.type === 'currency');
    return part?.value ?? currencyId;
  } catch {
    return currencyId;
  }
}

/** A currency's long name in the user's language. `fallback` is the SDK's English name, kept when the runtime cannot translate. */
export function fiatName(currencyId: string, language: string, fallback: string): string {
  try {
    return new Intl.DisplayNames(language, { type: 'currency', fallback: 'none' }).of(currencyId) ?? fallback;
  } catch {
    return fallback;
  }
}
