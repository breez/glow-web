import React from 'react';
import { useTranslation } from 'react-i18next';
import SlideInPage from '../components/layout/SlideInPage';
import { CheckIcon } from '../components/Icons';
import { LOCALES, SHIPPING_LANGUAGES, selectableLanguages, setLanguage } from '@/services/i18n';

interface LanguagePageProps {
  onBack: () => void;
}

/** Developer mode adds the unreviewed languages, so a translation can be read in the app before it ships. */
const LanguagePage: React.FC<LanguagePageProps> = ({ onBack }) => {
  const { t, i18n } = useTranslation('common');

  return (
    <SlideInPage title={t('settings.language')} closeStyle="back" onClose={onBack} slideFrom="right">
      <ul className="p-4 space-y-2">
        {selectableLanguages().map((code) => {
          const selected = i18n.language === code;
          return (
            <li key={code}>
              <button
                type="button"
                onClick={() => { void setLanguage(code); }}
                aria-current={selected}
                className="flex items-center justify-between w-full min-h-11 p-3 bg-spark-dark border border-spark-border rounded-xl text-start hover:bg-white/5 transition-colors"
              >
                <span className={selected ? 'font-display font-semibold text-spark-text-primary' : 'text-spark-text-secondary'}>
                  {LOCALES[code]?.name ?? code}
                  {SHIPPING_LANGUAGES.includes(code) ? '' : ' (unreviewed)'}
                </span>
                {selected && <CheckIcon size="md" className="text-spark-primary" />}
              </button>
            </li>
          );
        })}
      </ul>
    </SlideInPage>
  );
};

export default LanguagePage;
