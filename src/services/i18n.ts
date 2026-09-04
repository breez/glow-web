import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { Device } from '@capacitor/device';
import { Preferences } from '@capacitor/preferences';
import { isDevMode } from './settings';

import shipping from '../locales/shipping.json';
import enCommon from '../locales/en/common.json';
import enCritical from '../locales/en/critical.json';

export const FALLBACK_LANGUAGE = 'en';
export const LANGUAGE_KEY = 'language_v1';

/**
 * `critical` is the money path: recovery phrase, send confirmations, fee
 * disclosure, anything saying an action cannot be undone. Split out so a
 * language can be gated on a human having read those strings specifically.
 * See locales/README.md.
 */
export const NAMESPACES = ['common', 'critical'] as const;

interface LocaleMeta {
  /** Endonym, for the picker. */
  name: string;
  /**
   * One character outside Latin-1, used to warm the right font subset. Absent
   * when the language is written entirely within Latin-1. See `warmupSample`.
   */
  warmup?: string;
}

/** Every language with a home for its files, whether or not it is served. */
export const LOCALES: Record<string, LocaleMeta> = {
  en: { name: 'English' },
  bg: { name: 'Български', warmup: 'б' },
  cs: { name: 'Čeština', warmup: 'ě' },
  de: { name: 'Deutsch' },
  el: { name: 'Ελληνικά', warmup: 'α' },
  es: { name: 'Español' },
  fi: { name: 'Suomi' },
  fr: { name: 'Français' },
  hu: { name: 'Magyar', warmup: 'ő' },
  it: { name: 'Italiano' },
  nl: { name: 'Nederlands' },
  pl: { name: 'Polski', warmup: 'ł' },
  pt: { name: 'Português' },
  sk: { name: 'Slovenčina', warmup: 'ľ' },
  sv: { name: 'Svenska' },
  tr: { name: 'Türkçe', warmup: 'ğ' },
};

/**
 * The languages actually served, which is not the same as having a
 * translation. Volunteer work arrives partial, and a reader is better off in
 * English than in a half-translated send screen. A language joins once a
 * speaker has reviewed its `critical` bundle.
 *
 * Kept in its own JSON file because the native side reads it too: the iOS and
 * Android locale declarations must list exactly these, or the OS offers a
 * language it then renders in English. See scripts/ci/check-locale-declarations.sh
 * in the app repository.
 */
export const SHIPPING_LANGUAGES: readonly string[] = shipping;

/**
 * What the picker offers and what startup will restore. Dev mode widens it to
 * every language that has files, so an unreviewed translation can be read in
 * place; otherwise reviewing one means changing the whole device's language. It
 * gates startup too, not just the picker, or a chosen language would be
 * discarded on the next launch.
 */
export function selectableLanguages(): readonly string[] {
  return isDevMode() ? translatedLanguages() : SHIPPING_LANGUAGES;
}

/**
 * One lazily fetched chunk per file, so a reader downloads only their own
 * language. English is excluded because it is imported eagerly above: it
 * backs every missing key everywhere, so it must be resident before first
 * render.
 */
const BUNDLES = import.meta.glob<{ default: Record<string, string> }>([
  '../locales/*/*.json',
  '!../locales/en/*.json',
]);

/**
 * Languages that have bundle files, in LOCALES order. The rest of LOCALES is a
 * home for work nobody has started; offering one would just show English under
 * a native name.
 */
export function translatedLanguages(): string[] {
  const present = new Set([FALLBACK_LANGUAGE]);
  for (const path of Object.keys(BUNDLES)) {
    const lang = path.split('/')[2];
    if (lang) present.add(lang);
  }
  return Object.keys(LOCALES).filter((l) => present.has(l));
}

/**
 * Pure so the branching can be tested without plugin doubles. A stored choice
 * wins over the system one. Both match on the base subtag, so `pt-BR` and
 * `pt-PT` both land on `pt`. Anything unshipped falls back to English rather
 * than to a half-translated near match.
 */
export function pickLanguage(
  stored: string | null,
  systemTag: string | null,
  shipping: readonly string[] = SHIPPING_LANGUAGES,
): string {
  const normalise = (tag: string) => tag.split(/[-_]/)[0]!.toLowerCase();
  if (stored && shipping.includes(normalise(stored))) return normalise(stored);
  if (systemTag && shipping.includes(normalise(systemTag))) return normalise(systemTag);
  return FALLBACK_LANGUAGE;
}

async function readStoredLanguage(): Promise<string | null> {
  try {
    const { value } = await Preferences.get({ key: LANGUAGE_KEY });
    return value ?? null;
  } catch {
    return null;
  }
}

/**
 * Deliberately not `navigator.language`: in a WKWebView that reports the
 * localizations the app bundle claims, not the reader's preference order, so a
 * Hungarian reader reads as English until the bundle lists `hu`. The plugin
 * reads the OS preference directly and picks up the per-app language setting.
 */
async function detectSystemTag(): Promise<string | null> {
  try {
    const { value } = await Device.getLanguageTag();
    if (value) return value;
  } catch {
    /* plugin unavailable; fall through to the browser's answer */
  }
  return typeof navigator === 'undefined' ? null : navigator.language ?? null;
}

export async function resolveLanguage(): Promise<string> {
  const [stored, systemTag] = await Promise.all([readStoredLanguage(), detectSystemTag()]);
  return pickLanguage(stored, systemTag, selectableLanguages());
}

async function loadBundles(language: string): Promise<void> {
  if (language === FALLBACK_LANGUAGE) return; // already resident
  await Promise.all(
    NAMESPACES.map(async (ns) => {
      const load = BUNDLES[`../locales/${language}/${ns}.json`];
      if (!load) return; // namespace not started yet; English fills in
      try {
        const mod = await load();
        i18next.addResourceBundle(language, ns, mod.default, true, true);
      } catch {
        /* a missing chunk must not stop startup; English fills in */
      }
    }),
  );
}

/**
 * Load-bearing, not cosmetic: `lang` is what makes `text-transform: uppercase`
 * produce İ rather than I in Turkish, drives hyphenation, and tells a screen
 * reader which voice to use.
 */
function applyDocumentLanguage(language: string): void {
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}

/**
 * Sample text for `document.fonts.load()`. The faces carry a `unicode-range`,
 * so warming with Latin text warms only the Latin file and the language's own
 * accented characters would paint as nothing under `font-display: block`.
 * `BESbswy` is the browser default sample, kept so Latin is still warmed.
 */
export function warmupSample(): string {
  return `BESbswy${LOCALES[i18next.language]?.warmup ?? ''}`;
}

export async function initI18n(): Promise<string> {
  const language = await resolveLanguage();

  await i18next.use(initReactI18next).init({
    lng: language,
    fallbackLng: FALLBACK_LANGUAGE,
    // Every language with files, not the shipping list: dev mode can widen the
    // selection after init, and i18next freezes this at init. The real gate is
    // pickLanguage and setLanguage, which is where it can respond to the change.
    supportedLngs: Object.keys(LOCALES),
    ns: NAMESPACES,
    defaultNS: 'common',
    resources: { [FALLBACK_LANGUAGE]: { common: enCommon, critical: enCritical } },
    // React escapes interpolated values already; escaping here would double it.
    interpolation: { escapeValue: false },
    returnNull: false,
  });

  await loadBundles(language);
  applyDocumentLanguage(language);
  return language;
}

export async function setLanguage(language: string): Promise<void> {
  if (!selectableLanguages().includes(language)) return;
  await Preferences.set({ key: LANGUAGE_KEY, value: language });
  await loadBundles(language);
  await i18next.changeLanguage(language);
  applyDocumentLanguage(language);
  // Startup warms the font subset behind the splash. A switch at runtime has no
  // splash to hide behind, and font-display: block would paint the new
  // language's accented characters as nothing until the file arrived.
  const sample = warmupSample();
  for (const family of ['Plus Jakarta Sans', 'Manrope']) {
    void document.fonts?.load(`400 1rem "${family}"`, sample).catch(() => undefined);
  }
}
