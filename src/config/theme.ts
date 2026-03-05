import { brand } from './brand';

/**
 * Convert hex color (#rrggbb) to "r g b" string for Tailwind's
 * rgb(var(--color-rgb) / <alpha-value>) pattern.
 */
function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r} ${g} ${b}`;
}

/**
 * Convert hex color to rgba string with given alpha.
 */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** CSS variable name → brand.theme mapping */
const COLOR_MAP = {
  'spark-primary': 'primary',
  'spark-primary-light': 'primaryLight',
  'spark-void': 'background',
  'spark-dark': 'dark',
  'spark-surface': 'surface',
  'spark-elevated': 'elevated',
  'spark-border': 'border',
  'spark-border-light': 'borderLight',
  'spark-electric': 'accent',
  'spark-electric-light': 'accentLight',
  'spark-success': 'success',
  'spark-error': 'error',
} as const;

/**
 * Inject brand theme as CSS custom properties on :root.
 * Call this before React renders so all components pick up the values.
 *
 * Sets both --name (hex) and --name-rgb (r g b) for each color,
 * enabling Tailwind's opacity modifier syntax (e.g. bg-spark-primary/20).
 */
export function injectTheme(): void {
  const { colors, fonts } = brand.theme;
  const s = document.documentElement.style;

  // Set color variables (hex + rgb for opacity support)
  for (const [cssName, configKey] of Object.entries(COLOR_MAP)) {
    const hex = colors[configKey as keyof typeof colors];
    s.setProperty(`--${cssName}`, hex);
    s.setProperty(`--${cssName}-rgb`, hexToRgb(hex));
  }

  // Derived glow/transparency variants
  s.setProperty('--glow-primary', hexToRgba(colors.primary, 0.35));
  s.setProperty('--glow-electric', hexToRgba(colors.accent, 0.3));
  s.setProperty('--glow-success', hexToRgba(colors.success, 0.4));
  s.setProperty('--glow-error', hexToRgba(colors.error, 0.4));

  // Warning = primary
  s.setProperty('--spark-warning', colors.primary);
  s.setProperty('--spark-warning-rgb', hexToRgb(colors.primary));

  // Text colors (derived from theme — always white-on-dark for now)
  s.setProperty('--spark-text-primary', '#ffffff');
  s.setProperty('--spark-text-primary-rgb', '255 255 255');
  s.setProperty('--spark-text-secondary', 'rgba(255, 255, 255, 0.7)');
  s.setProperty('--spark-text-secondary-rgb', '255 255 255');
  s.setProperty('--spark-text-muted', 'rgba(255, 255, 255, 0.4)');
  s.setProperty('--spark-text-muted-rgb', '255 255 255');

  // Fonts
  s.setProperty('--brand-font-display', `'${fonts.display}', system-ui, sans-serif`);
  s.setProperty('--brand-font-mono', `'${fonts.mono}', ui-monospace, monospace`);
}
