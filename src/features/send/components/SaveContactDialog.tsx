import React, { useState, useEffect, useRef } from 'react';
import { BottomSheetContainer, BottomSheetCard, DialogHeader, PrimaryButton, FormError } from '../../../components/ui';
import { ContactsIcon, CheckIcon } from '../../../components/Icons';
import { useContactsContext } from '../../../contexts/ContactsContext';

interface SaveContactDialogProps {
  isOpen: boolean;
  lightningAddress: string;
  onClose: () => void;
}

const SaveContactDialog: React.FC<SaveContactDialogProps> = ({ isOpen, lightningAddress, onClose }) => {
  // Initialise state from the address that was passed when this instance
  // mounted. Parents are expected to bump a `key` on each open so a new
  // open with a new address always gets fresh state via remount, instead
  // of the previous reset-in-effect pattern.
  const [name, setName] = useState(() => lightningAddress.split('@')[0] || '');
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { addContact } = useContactsContext();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear auto-close timer on unmount
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  // Auto-focus name input on mount (which is now per-open thanks to key)
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => nameInputRef.current?.focus(), 350);
    return () => clearTimeout(timer);
  }, [isOpen]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setIsSaving(true);
    setError(null);
    try {
      const result = await addContact(trimmed, lightningAddress);
      if (result) {
        setSaved(true);
        closeTimerRef.current = setTimeout(onClose, 2000);
      } else {
        setError('Failed to save contact');
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <BottomSheetContainer isOpen={isOpen} onClose={onClose}>
      <BottomSheetCard>
        {saved ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <div className="w-12 h-12 rounded-full bg-spark-success/15 flex items-center justify-center">
              <CheckIcon className="text-spark-success w-6 h-6" />
            </div>
            <p className="font-display font-semibold text-spark-text-primary">Contact saved</p>
          </div>
        ) : (
          <>
            <DialogHeader title="Save Contact" onClose={onClose} icon={<ContactsIcon />} />

            <div className="space-y-4">
              <p className="text-sm text-spark-text-muted text-center font-mono truncate">{lightningAddress}</p>

              <input
                ref={nameInputRef}
                id="save-contact-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) handleSave(); }}
                placeholder="Contact name"
                disabled={isSaving}
                className="w-full bg-spark-dark border border-spark-border rounded-xl px-4 py-3 text-spark-text-primary placeholder-spark-text-muted focus:border-spark-primary focus:ring-0 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              />

              <FormError error={error} />
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 py-3 font-display font-semibold text-spark-text-secondary border border-spark-border rounded-xl hover:text-spark-text-primary hover:border-spark-border-light transition-colors"
                >
                  Cancel
                </button>
                <PrimaryButton
                  onClick={handleSave}
                  disabled={!name.trim() || isSaving}
                  className="flex-1"
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </PrimaryButton>
              </div>
            </div>
          </>
        )}
      </BottomSheetCard>
    </BottomSheetContainer>
  );
};

export default SaveContactDialog;
