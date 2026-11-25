import { describe, it, expect } from 'vitest';
import i18next from 'i18next';
import { keyRecorder, findTranslatedText, reportMailto } from './translationReport';

describe('translation report', () => {
  it('traces rendered text back to its key and builds the email', async () => {
    const inst = i18next.createInstance();
    await inst.use(keyRecorder).init({
      lng: 'de',
      postProcess: ['recordKey'],
      postProcessPassResolved: true,
      resources: { de: { common: { 'send.title': 'Zahlung {{n}}' } } },
      defaultNS: 'common',
    });
    // The recorder reads the global instance's language.
    await i18next.changeLanguage('de').catch(() => undefined);
    const text = inst.t('send.title', { n: 5 });
    const el = document.createElement('div');
    el.textContent = text;
    const found = findTranslatedText(el);
    expect(found?.keys).toEqual(['common:send.title']);
    expect(decodeURIComponent(reportMailto({ ...found!, suggestion: 'X' }))).toContain('Keys: common:send.title');
  });
});
