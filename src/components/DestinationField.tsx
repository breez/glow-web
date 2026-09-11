import React, { useId, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Clipboard } from '@capacitor/clipboard';
import { SimpleAlert } from '@/components/AlertCard';
import { ClipboardIcon, QrCodeIcon } from '@/components/Icons';
import { logger, LogCategory } from '@/services/logger';
import { dismissKeyboard } from '@/utils/keyboard';

/** The send flow's quick actions, so the address fields read as one control. */
const quickAction =
  'flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-spark-surface border border-spark-border rounded-xl ' +
  'text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light transition-colors';

/** An on-chain destination field with Paste and Scan, for the exit and refund flows. */
export const DestinationField: React.FC<{
  destination: string;
  onChange: (value: string) => void;
  error: string | null;
  onSubmit: () => void;
  onScanQr: () => void;
}> = ({ destination, onChange, error, onSubmit, onScanQr }) => {
  const id = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handlePaste = async () => {
    try {
      // The Capacitor plugin rather than navigator.clipboard: the WebView
      // blocks the latter on Android and shows the iOS paste pill.
      let text: string | null;
      if (Capacitor.isNativePlatform()) {
        text = (await Clipboard.read()).value ?? null;
      } else if (navigator.clipboard?.readText) {
        text = await navigator.clipboard.readText();
      } else {
        // No readText outside a secure context: let them paste by hand.
        inputRef.current?.focus();
        return;
      }
      if (text?.trim()) onChange(text.trim());
    } catch (e) {
      logger.warn(LogCategory.UI, 'Could not read the clipboard', {
        error: e instanceof Error ? e.message : String(e),
      });
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label
          htmlFor={id}
          className="block text-sm font-medium text-spark-text-primary mb-2"
        >
          Destination
        </label>
        {/* A textarea so a long address wraps instead of scrolling sideways,
            with Enter submitting: this field never takes a second line. */}
        <textarea
          id={id}
          ref={inputRef}
          value={destination}
          onChange={event => onChange(event.target.value)}
          onKeyDown={async event => {
            if (event.key !== 'Enter' || event.shiftKey) return;
            event.preventDefault();
            await dismissKeyboard();
            if (destination.trim()) onSubmit();
          }}
          rows={2}
          enterKeyHint="go"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="bc1q..."
          className="block w-full p-4 bg-spark-dark text-spark-text-primary placeholder-spark-text-muted focus:ring-0 resize-none font-mono text-sm border outline-hidden transition-all rounded-xl border-spark-border focus:border-spark-primary"
        />
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={() => void handlePaste()} className={quickAction}>
          <ClipboardIcon size="xs" />
          <span className="text-sm font-medium">Paste</span>
        </button>
        <button type="button" onClick={onScanQr} className={quickAction}>
          <QrCodeIcon size="xs" />
          <span className="text-sm font-medium">Scan</span>
        </button>
      </div>

      {error && <SimpleAlert variant="error">{error}</SimpleAlert>}
    </div>
  );
};
