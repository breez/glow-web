/**
 * Normalizes a decimal amount field value. iOS decimal keyboards follow the
 * device region, so comma-locales (Turkish, most of Europe) only offer ","
 * with no "." key. Maps "," to ".", keeps the first separator (a second
 * separator keystroke is dropped), and strips any other non-digit character.
 */
export function normalizeDecimalInput(raw: string): string {
  const cleaned = raw.replace(/,/g, '.').replace(/[^0-9.]/g, '');
  const [head, ...rest] = cleaned.split('.');
  return rest.length ? `${head}.${rest.join('')}` : head;
}
