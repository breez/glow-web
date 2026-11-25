import React, { useEffect, useState } from 'react';
import i18n from 'i18next';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/contexts/ToastContext';
import {
  BottomSheetContainer,
  BottomSheetCard,
  DialogHeader,
  FormLabel,
  FormTextarea,
  PaymentInfoCard,
  PrimaryButton,
} from './ui';
import { FlagIcon } from './Icons';
import { findTranslatedText, sendFeedback } from '@/services/translationFeedback';

const HOLD_MS = 3000;
const MOVE_TOLERANCE = 8;

interface Target {
  text: string;
  keys: string[];
}

/** Long-press translated text in any non-English language to give feedback on it. */
const TranslationFeedback: React.FC = () => {
  const { t } = useTranslation('common');
  const { showToast } = useToast();
  const [sending, setSending] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [chip, setChip] = useState<(Target & { x: number; y: number }) | null>(null);
  const [suggestion, setSuggestion] = useState('');

  useEffect(() => {
    let timer: number | undefined;
    let start = { x: 0, y: 0 };
    const cancel = () => window.clearTimeout(timer);

    const onDown = (e: PointerEvent) => {
      cancel();
      const el = e.target as Element | null;
      if (!el?.closest('[data-translation-feedback]')) setChip(null);
      if (i18n.language === 'en' || !el || el.closest('[data-translation-feedback], input, textarea')) return;
      start = { x: e.clientX, y: e.clientY };
      timer = window.setTimeout(() => {
        const found = findTranslatedText(document.elementFromPoint(start.x, start.y));
        if (!found) return;
        // The release after a hold would otherwise click whatever is underneath.
        const swallow = (ev: Event) => ev.stopPropagation();
        window.addEventListener('click', swallow, {
          capture: true,
          once: true,
        });
        window.setTimeout(() => window.removeEventListener('click', swallow, true), 500);
        setChip({ ...found, x: start.x, y: start.y });
      }, HOLD_MS);
    };
    const onMove = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_TOLERANCE) cancel();
    };
    const onScroll = () => {
      cancel();
      setChip(null);
    };
    const onContextMenu = (e: Event) => {
      if (target === null && timer !== undefined && findTranslatedText(e.target as Element)) e.preventDefault();
    };

    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', cancel);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('contextmenu', onContextMenu);
    return () => {
      cancel();
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cancel);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('contextmenu', onContextMenu);
    };
  }, [target]);

  useEffect(() => {
    if (!chip) return;
    const id = window.setTimeout(() => setChip(null), 5000);
    return () => window.clearTimeout(id);
  }, [chip]);

  const close = () => setTarget(null);
  const openSheet = () => {
    if (!chip) return;
    setSuggestion('');
    setTarget({ text: chip.text, keys: chip.keys });
    setChip(null);
  };
  const send = async () => {
    if (!target || sending) return;
    setSending(true);
    const feedback = { ...target, suggestion };
    const sent = await sendFeedback(feedback);
    setSending(false);
    if (!sent) {
      showToast('error', t('translationFeedback.failed'));
      return;
    }
    showToast('success', t('translationFeedback.sent'));
    close();
  };

  return (
    <>
      {chip && (
        <button
          type="button"
          data-translation-feedback
          onClick={openSheet}
          style={{
            position: 'fixed',
            top: Math.max(8, chip.y - 56),
            left: Math.min(Math.max(chip.x, 90), window.innerWidth - 90),
            transform: 'translateX(-50%)',
          }}
          className="z-[200] min-h-11 px-4 rounded-full bg-spark-surface border border-spark-border shadow-lg text-sm font-medium text-spark-text-primary whitespace-nowrap"
        >
          <span className="inline-flex items-center gap-2">
            <FlagIcon size="sm" />
            {t('translationFeedback.title')}
          </span>
        </button>
      )}
      <BottomSheetContainer isOpen={target !== null} onClose={close} showBackdrop>
        <BottomSheetCard>
          <div data-translation-feedback>
            <DialogHeader title={t('translationFeedback.title')} onClose={close} />
            <div className="space-y-4">
              <div>
                <span className="block text-sm font-medium text-spark-text-primary mb-1">
                  {t('translationFeedback.currentText')}
                </span>
                <PaymentInfoCard compact>
                  <p className="text-spark-text-primary break-words">{target?.text}</p>
                </PaymentInfoCard>
              </div>
              <div>
                <FormLabel htmlFor="translation-suggestion">{t('translationFeedback.suggestion')}</FormLabel>
                <FormTextarea
                  id="translation-suggestion"
                  value={suggestion}
                  onChange={(e) => setSuggestion(e.target.value)}
                />
              </div>
              <PrimaryButton onClick={send} disabled={!suggestion.trim() || sending} className="w-full">
                {t('translationFeedback.send')}
              </PrimaryButton>
            </div>
          </div>
        </BottomSheetCard>
      </BottomSheetContainer>
    </>
  );
};

export default TranslationFeedback;
