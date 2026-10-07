import { afterEach, describe, expect, it } from 'vitest';
import {
  LOCALES,
  SHIPPING_LANGUAGES,
  pickLanguage,
  selectableLanguages,
  translatedLanguages,
} from './i18n';

// The shipping list is short today and grows as locales pass review, so these
// pass their own list rather than asserting against whatever ships right now.
const SHIPPING = ['en', 'hu', 'de', 'pt'];

describe('pickLanguage', () => {
  it('prefers an explicit stored choice over the system language', () => {
    expect(pickLanguage('hu', 'de-DE', SHIPPING)).toBe('hu');
  });

  it('falls back to the system language when nothing is stored', () => {
    expect(pickLanguage(null, 'de-DE', SHIPPING)).toBe('de');
  });

  it('matches on the base subtag, so regional variants resolve', () => {
    expect(pickLanguage(null, 'pt-BR', SHIPPING)).toBe('pt');
    expect(pickLanguage(null, 'hu_HU', SHIPPING)).toBe('hu');
    expect(pickLanguage(null, 'DE-de', SHIPPING)).toBe('de');
  });

  it('falls back to English for a language that is not shipping', () => {
    // The whole point of the gate: a locale can be translatable, and even be
    // what the reader's system asks for, without being complete enough to serve.
    expect(pickLanguage(null, 'bg-BG', SHIPPING)).toBe('en');
  });

  it('ignores a stored choice that has since stopped shipping', () => {
    // A locale can be pulled back out of SHIPPING if a translation regresses.
    // Someone who had already selected it must not be stranded in it.
    expect(pickLanguage('bg', 'de-DE', SHIPPING)).toBe('de');
  });

  it('falls back to English when the platform reports nothing', () => {
    expect(pickLanguage(null, null, SHIPPING)).toBe('en');
  });
});

describe('bundle shape', () => {
  const bundles = import.meta.glob<{ default: Record<string, unknown> }>(
    '../locales/*/*.json',
    { eager: true },
  );

  const flatten = (obj: Record<string, unknown>, prefix = ''): string[] =>
    Object.entries(obj).flatMap(([k, v]) =>
      v !== null && typeof v === 'object'
        ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
        : [`${prefix}${k}`],
    );

  const keysOf = (lang: string, ns: string) => {
    const mod = bundles[`../locales/${lang}/${ns}.json`];
    return mod ? flatten(mod.default) : null;
  };

  // Plural suffixes are language-specific: Polish needs _few and _many where
  // English has only _one and _other, so a suffix is stripped before comparing.
  // Without this the guard would reject a correct Slavic translation.
  const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
  const base = (key: string) => key.replace(PLURAL_SUFFIX, '');

  // A translation may lag English: that is normal for volunteer work, and the
  // missing keys fall back. Carrying a key English does not have is a typo or a
  // one-sided rename, and renders as nothing.
  it('has no key in a translation that English does not define', () => {
    for (const path of Object.keys(bundles)) {
      const [, , lang, file] = path.split('/');
      const ns = file!.replace('.json', '');
      if (lang === 'en') continue;
      const english = keysOf('en', ns);
      expect(english, `en/${ns}.json should exist for ${lang}/${ns}.json`).not.toBeNull();
      const englishBases = new Set(english!.map(base));
      for (const key of keysOf(lang!, ns)!) {
        expect(
          [...englishBases],
          `${lang}/${ns}.json has orphan key "${key}"`,
        ).toContain(base(key));
      }
    }
  });

  // Every plural category the language actually uses for a small count must be
  // present, or i18next falls through to English for that count alone. Polish
  // never selects `other` below a million, so an _other-only Polish plural is
  // English for every number.
  it('covers every plural form each language selects', () => {
    const missing: string[] = [];
    for (const path of Object.keys(bundles)) {
      const [, , lang, file] = path.split('/');
      const ns = file!.replace('.json', '');
      if (lang === 'en') continue;
      const keys = new Set(keysOf(lang!, ns)!);
      const plurals = new Set([...keys].filter((k) => PLURAL_SUFFIX.test(k)).map(base));
      const rules = new Intl.PluralRules(lang!);
      const needed = new Set(
        Array.from({ length: 12 }, (_, i) => rules.select(i + 1)),
      );
      for (const stem of plurals) {
        for (const form of needed) {
          if (!keys.has(`${stem}_${form}`)) missing.push(`${lang}/${ns} ${stem}_${form}`);
        }
      }
    }
    expect(missing, `missing plural forms:\n${missing.join('\n')}`).toEqual([]);
  });

  it('interpolation placeholders survive translation', () => {
    const placeholders = (s: string) => (s.match(/\{\{\s*\w+\s*\}\}/g) ?? []).sort();
    for (const path of Object.keys(bundles)) {
      const [, , lang, file] = path.split('/');
      const ns = file!.replace('.json', '');
      if (lang === 'en') continue;
      const en = bundles[`../locales/en/${ns}.json`]!.default;
      const other = bundles[path]!.default;
      const read = (obj: Record<string, unknown>, key: string): unknown =>
        key.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], obj);
      for (const key of flatten(other)) {
        // A language-specific plural form has no same-named English key, so
        // compare it against English's `other`, which carries the placeholders.
        const source = read(en, key) ?? read(en, `${key.replace(PLURAL_SUFFIX, '')}_other`);
        const target = read(other, key);
        if (typeof source !== 'string' || typeof target !== 'string') continue;
        expect(
          placeholders(target),
          `${lang}/${ns}.json "${key}" must keep the same placeholders as English`,
        ).toEqual(placeholders(source));
      }
    }
  });
});

describe('locale table', () => {
  it('ships only languages it has metadata for', () => {
    for (const lang of SHIPPING_LANGUAGES) expect(LOCALES[lang]).toBeDefined();
  });

  it('gives every non-Latin-1 language a warmup glyph outside Latin-1', () => {
    // The glyph exists to pull the right font subset in behind the splash. One
    // inside Latin-1 would warm the subset that was already loaded and quietly
    // do nothing, so the failure mode is invisible without this assertion.
    for (const [lang, meta] of Object.entries(LOCALES)) {
      if (!meta.warmup) continue;
      expect(meta.warmup.length, `${lang} warmup should be one character`).toBe(1);
      expect(
        meta.warmup.codePointAt(0)!,
        `${lang} warmup should sit outside Latin-1`,
      ).toBeGreaterThan(0xff);
    }
  });
});

describe('every referenced key exists', () => {
  // The one check that catches a key renamed or moved between namespaces on
  // one side only. i18next answers a missing key with the key itself, so
  // without this the symptom is a raw dotted path on screen, in whichever
  // language and screen nobody happened to open.
  const bundles = import.meta.glob<{ default: Record<string, unknown> }>(
    '../locales/en/*.json',
    { eager: true },
  );
  const sources = import.meta.glob('../**/*.{ts,tsx}', { eager: true, query: '?raw', import: 'default' });

  const flatten = (obj: Record<string, unknown>, prefix = ''): string[] =>
    Object.entries(obj).flatMap(([k, v]) =>
      v !== null && typeof v === 'object'
        ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
        : [`${prefix}${k}`],
    );

  const known = new Set<string>();
  for (const [path, mod] of Object.entries(bundles)) {
    const ns = path.split('/').pop()!.replace('.json', '');
    for (const key of flatten(mod.default)) {
      known.add(`${ns}:${key}`);
      // i18next strips the plural suffix before lookup, so the bare key counts.
      known.add(`${ns}:${key.replace(/_(one|other|few|many|two|zero)$/, '')}`);
    }
  }

  it('resolves every t() and Trans key in the source', () => {
    const missing: string[] = [];
    for (const [path, raw] of Object.entries(sources)) {
      if (path.includes('.test.') || path.includes('/locales/')) continue;
      const src = raw as string;
      // A file's default namespace is whichever it lists first.
      const declared = /useTranslation\(\s*\[?\s*'([a-z]+)'/.exec(src)?.[1] ?? 'common';
      const refs = [
        ...src.matchAll(/\bt\(\s*['"]([a-zA-Z][\w.:-]*)['"]/g),
        ...src.matchAll(/i18nKey="([\w.:-]+)"/g),
      ];
      for (const m of refs) {
        const ref = m[1]!;
        const full = ref.includes(':') ? ref : `${declared}:${ref}`;
        if (!known.has(full)) missing.push(`${path.replace(/^\.\.\//, '')} -> ${full}`);
      }
    }
    expect(missing, `unresolved keys:\n${missing.join('\n')}`).toEqual([]);
  });
});

describe('what the picker may offer', () => {
  // isDevMode reads localStorage, which the test setup already fakes, so the
  // gate can be driven directly rather than through a module double.
  afterEach(() => localStorage.removeItem('spark-dev-mode'));

  it('offers only languages that have files', () => {
    // A language with a home in LOCALES but no bundle would render as English
    // under a native name, which reads as a broken translation rather than an
    // absent one. Checked structurally rather than by naming a language, so it
    // keeps working as translations land.
    const withFiles = new Set(
      Object.keys(
        import.meta.glob('../locales/*/common.json', { eager: true }),
      ).map((path) => path.split('/')[2]),
    );
    withFiles.add('en');
    const offered = translatedLanguages();
    expect(offered).toContain('en');
    for (const lang of offered) {
      expect(LOCALES[lang], `${lang} is offered but has no metadata`).toBeDefined();
      expect(withFiles, `${lang} is offered but has no bundle`).toContain(lang);
    }
    for (const lang of Object.keys(LOCALES)) {
      if (!withFiles.has(lang)) expect(offered).not.toContain(lang);
    }
  });

  it('keeps the gate closed until dev mode opens it', () => {
    expect(selectableLanguages()).toEqual(SHIPPING_LANGUAGES);
    localStorage.setItem('spark-dev-mode', 'true');
    expect(selectableLanguages()).toEqual(translatedLanguages());
    expect(selectableLanguages().length).toBeGreaterThan(SHIPPING_LANGUAGES.length);
  });

  it('restores a dev-selected language at startup, and drops it once dev mode is off', () => {
    // The picker persists the choice, so startup has to accept it back or the
    // language would silently revert on the next launch.
    localStorage.setItem('spark-dev-mode', 'true');
    expect(pickLanguage('hu', null, selectableLanguages())).toBe('hu');
    localStorage.removeItem('spark-dev-mode');
    expect(pickLanguage('hu', null, selectableLanguages())).toBe('en');
  });
});
