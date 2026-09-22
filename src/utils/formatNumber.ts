// Hoisted RegExp pattern for number formatting (js-hoist-regexp optimization)
// Creating RegExp once at module level instead of on every function call

const THOUSAND_SEPARATOR_REGEX = /\B(?=(\d{3})+(?!\d))/g;

/**
 * Group a number into thousands with a plain space. The one separator for
 * user-facing amounts; mono displays tighten it with `word-spacing`, see
 * the amount rules in CLAUDE.md.
 */
export function formatWithSpaces(num: number | bigint): string {
  return num.toString().replace(THOUSAND_SEPARATOR_REGEX, ' ');
}

/**
 * Groups the whole part of a dollar figure, leaving the fraction alone:
 * "11049582.62" becomes "11,049,582.62". Commas, not the spaces sats are
 * grouped with: a dollar amount reads as a dollar amount, and a comma needs
 * none of the mono tightening a full-cell space does.
 */
export function groupUsd(value: string): string {
  const [whole, ...rest] = value.split('.');
  const grouped = whole.replace(THOUSAND_SEPARATOR_REGEX, ',');
  return rest.length ? `${grouped}.${rest.join('.')}` : grouped;
}

