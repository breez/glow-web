import React, { useEffect, useMemo, useState } from 'react';
import { SimpleAlert } from '../../../components/AlertCard';
import { PrimaryButton } from '../../../components/ui';
import ContactAutocomplete from '../components/ContactAutocomplete';
import { useContactsContext } from '../../../contexts/ContactsContext';
import { searchContacts } from '../../../hooks/useContacts';
import { logger, LogCategory } from '@/services/logger';
import { ClipboardIcon, QrCodeIcon, SpinnerIcon, ContactsIcon, CloseIcon } from '@/components/Icons';
import type { Contact } from '@breeztech/breez-sdk-spark';
import { dismissKeyboard } from '../../../utils/keyboard';

export interface InputStepProps {
  paymentInput: string;
  selectedContactAddress?: string | null;
  isLoading: boolean;
  error: string | null;
  onClearError?: () => void;
  onContinue: (paymentInput: string) => void;
  onScanQr?: () => void;
  onOpenContacts?: () => void;
}

const InputStep: React.FC<InputStepProps> = ({ paymentInput, selectedContactAddress, isLoading, error, onClearError, onContinue, onScanQr, onOpenContacts }) => {
  const [localPaymentInput, setLocalPaymentInput] = useState<string>(paymentInput || '');
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const { contacts } = useContactsContext();

  useEffect(() => {
    setLocalPaymentInput(paymentInput || '');
    // If the paymentInput matches a contact, show it as selected
    if (paymentInput) {
      const match = contacts.find(c => c.paymentIdentifier === paymentInput);
      if (match) setSelectedContact(match);
    }
  }, [paymentInput, contacts]);

  // Handle contact selected from ContactsSubView
  useEffect(() => {
    if (selectedContactAddress) {
      const match = contacts.find(c => c.paymentIdentifier === selectedContactAddress);
      if (match) {
        setSelectedContact(match);
        setLocalPaymentInput(selectedContactAddress);
      }
    }
  }, [selectedContactAddress, contacts]);

  const autocompleteContacts = useMemo(() => searchContacts(contacts, localPaymentInput), [contacts, localPaymentInput]);


  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text?.trim()) {
        setLocalPaymentInput(text);
        setSelectedContact(null);
        onContinue(text);
      }
    } catch (err) {
      logger.error(LogCategory.UI, 'Failed to read clipboard contents', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleContactSelect = (paymentIdentifier: string) => {
    const match = contacts.find(c => c.paymentIdentifier === paymentIdentifier);
    if (match) {
      setSelectedContact(match);
      setLocalPaymentInput(paymentIdentifier);
    } else {
      onContinue(paymentIdentifier);
    }
  };

  const handleClearContact = () => {
    setSelectedContact(null);
    setLocalPaymentInput('');
    onClearError?.();
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Input with autocomplete */}
      <div className="h-20">
        {selectedContact ? (
          // Selected contact chip
          <div className="w-full h-full px-4 bg-spark-dark border border-spark-border rounded-xl flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-spark-primary/15 flex items-center justify-center flex-shrink-0">
              <span className="text-spark-primary font-display font-bold text-xs">
                {selectedContact.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-spark-text-primary truncate">{selectedContact.name}</p>
              <p className="text-xs text-spark-text-muted truncate font-mono">{selectedContact.paymentIdentifier}</p>
            </div>
            <button
              onClick={handleClearContact}
              disabled={isLoading}
              className="p-1 text-spark-text-muted hover:text-spark-text-primary rounded-lg hover:bg-white/5 transition-colors flex-shrink-0"
              aria-label="Clear contact"
            >
              <CloseIcon size="sm" />
            </button>
          </div>
        ) : (
          // Text input with autocomplete. Rendered as a <textarea> so
          // long bolt11 invoices wrap visually instead of scrolling
          // horizontally, but Enter is intercepted and submits
          // instead of inserting a newline — this input never
          // accepts multi-line content, so the newline default is
          // user-hostile. Shift+Enter still inserts a newline for
          // desktop users who want to paste formatted content.
          <div className="relative h-full">
            <textarea
              value={localPaymentInput}
              onChange={(e) => setLocalPaymentInput(e.target.value)}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setTimeout(() => setIsInputFocused(false), 100)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  // Always dismiss the keyboard on Enter, even when
                  // the field is empty — tapping Go on an empty
                  // field should at minimum retract the keyboard
                  // so the user can see the Paste / Scan / Contacts
                  // shortcut buttons underneath. Only advance to
                  // the next step if there's actually content to
                  // submit.
                  await dismissKeyboard();
                  if (localPaymentInput.trim() && !isLoading) {
                    onContinue(localPaymentInput);
                  }
                }
              }}
              enterKeyHint="go"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="lnbc... / bc1... / sp1... / user@domain.com / contact"
              className="w-full h-full p-4 bg-spark-dark text-spark-text-primary placeholder-spark-text-muted focus:ring-0 resize-none font-mono text-sm border outline-none transition-all rounded-xl border-spark-border focus:border-spark-primary"
              disabled={isLoading}
              data-testid="payment-input"
            />
            <ContactAutocomplete
              contacts={autocompleteContacts}
              isVisible={isInputFocused}
              isLoading={isLoading}
              onSelect={handleContactSelect}
            />
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <SimpleAlert variant="error" dataTestId="send-error-banner">
          {error}
        </SimpleAlert>
      )}

      {/* Quick action buttons */}
      <div className="flex gap-2">
        <button
          onClick={handlePaste}
          disabled={isLoading}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-spark-surface border border-spark-border rounded-xl text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light transition-colors disabled:opacity-50"
        >
          <ClipboardIcon size="xs" />
          <span className="text-sm font-medium">Paste</span>
        </button>
        <button
          onClick={onScanQr}
          disabled={isLoading}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-spark-surface border border-spark-border rounded-xl text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light transition-colors disabled:opacity-50"
        >
          <QrCodeIcon size="xs" />
          <span className="text-sm font-medium">Scan</span>
        </button>
        <button
          onClick={onOpenContacts}
          disabled={isLoading}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-spark-surface border border-spark-border rounded-xl text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light transition-colors disabled:opacity-50"
        >
          <ContactsIcon size="xs" />
          <span className="text-sm font-medium">Contacts</span>
        </button>
      </div>

      {/* Continue button */}
      <PrimaryButton
        onClick={async () => {
          // Dismiss the keyboard so the parsing / amount-entry step
          // has the full viewport to work with.
          await dismissKeyboard();
          onContinue(localPaymentInput);
        }}
        disabled={isLoading || !localPaymentInput.trim()}
        className="w-full"
        data-testid="continue-button"
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <SpinnerIcon />
            Processing...
          </span>
        ) : 'Continue'}
      </PrimaryButton>

    </div>
  );
};

export default InputStep;
