// Hoisted RegExp patterns for number formatting (js-hoist-regexp optimization)
// Creating RegExp once at module level instead of on every function call

const THOUSAND_SEPARATOR_REGEX = /\B(?=(\d{3})+(?!\d))/g;
const COMMA_REGEX = /,/g;

/**
 * Format number with space as thousand separator
 */
export function formatWithSpaces(num: number | bigint): string {
  return num.toString().replace(THOUSAND_SEPARATOR_REGEX, ' ');
}

/**
 * Format number with thin space (U+2009) as thousand separator
 * Better for monospace fonts
 */
export function formatWithThinSpaces(num: number): string {
  return num.toString().replace(THOUSAND_SEPARATOR_REGEX, '\u2009');
}

/**
 * Format number with comma as thousand separator
 */
export function formatWithCommas(num: number): string {
  return num.toString().replace(THOUSAND_SEPARATOR_REGEX, ',');
}

/**
 * Format number using toLocaleString and replace commas with spaces
 */
export function formatLocaleWithSpaces(num: number): string {
  return num.toLocaleString('en-US').replace(COMMA_REGEX, ' ');
}

/**
 * Format number using toLocaleString and replace commas with thin spaces
 */
export function formatLocaleWithThinSpaces(num: number): string {
  return num.toLocaleString('en-US').replace(COMMA_REGEX, '\u2009');
}
