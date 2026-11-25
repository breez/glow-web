import i18next from 'i18next';

/** Where translation reports are sent. `VITE_TRANSLATION_REPORT_EMAIL` overrides it at build time (internal builds). */
export const REPORT_EMAIL = import.meta.env.VITE_TRANSLATION_REPORT_EMAIL || 'contact@breez.technology';

const MAX_RECORDED = 3000;
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Rendered (post-interpolation) text to the keys that produced it. */
const rendered = new Map<string, Set<string>>();

/**
 * Remembers which key produced each string the app renders, so a long-press
 * on text on screen can be traced back to its key. Several keys can render
 * the same string, so a lookup returns all of them.
 */
export const keyRecorder = {
  type: 'postProcessor' as const,
  name: 'recordKey',
  process(
    value: string,
    _key: string | string[],
    options: { i18nResolved?: { usedKey?: string; usedNS?: string } },
  ): string {
    const resolved = options.i18nResolved;
    if (typeof value !== 'string' || !resolved?.usedKey || i18next.language === 'en') return value;
    const text = norm(value);
    if (!text) return value;
    let keys = rendered.get(text);
    if (!keys) {
      if (rendered.size >= MAX_RECORDED) rendered.delete(rendered.keys().next().value as string);
      keys = new Set();
      rendered.set(text, keys);
    }
    keys.add(`${resolved.usedNS ?? 'common'}:${resolved.usedKey}`);
    return value;
  },
};

export function keysForText(text: string): string[] {
  return [...(rendered.get(norm(text)) ?? [])];
}

/** Text a translated string has on screen at a point, with the keys behind it. */
export function findTranslatedText(el: Element | null): { text: string; keys: string[] } | null {
  for (let i = 0; el && i < 4; i++, el = el.parentElement) {
    const own = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('');
    for (const text of [own, el.textContent ?? '']) {
      const keys = keysForText(text);
      if (keys.length) return { text: norm(text), keys };
    }
  }
  return null;
}

export function reportMailto(r: { keys: string[]; text: string; suggestion: string }): string {
  const body = [
    `Language: ${i18next.language}`,
    `Keys: ${r.keys.join(', ')}`,
    `Shown text: ${r.text}`,
    `Suggested wording: ${r.suggestion.trim() || '(none)'}`,
  ].join('\n');
  const subject = `Glow translation report (${i18next.language}): ${r.keys[0]}`;
  return `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
