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

